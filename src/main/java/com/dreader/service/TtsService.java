package com.dreader.service;

import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.*;

@Service
public class TtsService {

    private static final Logger log = LoggerFactory.getLogger(TtsService.class);
    private static final int MAX_CHUNK_LENGTH = 180;
    private static final String[] GOOGLE_CLIENTS = {"tw-ob", "gtx", "dict-chrome-ex"};
    private static final long MAX_CACHE_SIZE_BYTES = 500L * 1024 * 1024; // 500MB
    private static final long TARGET_CACHE_SIZE_BYTES = 400L * 1024 * 1024; // 400MB
    private static final long MAX_FILE_AGE_MS = 7L * 24 * 60 * 60 * 1000; // 7 ngày

    @Autowired
    private StorageService storageService;

    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(8))
            .followRedirects(HttpClient.Redirect.NORMAL)
            .build();

    // Bộ nhớ đệm RAM LRU giữ 200 câu gần nhất để phát siêu nhanh
    private final Map<String, byte[]> memoryAudioCache = Collections.synchronizedMap(
            new LinkedHashMap<>(256, 0.75f, true) {
                @Override
                protected boolean removeEldestEntry(Map.Entry<String, byte[]> eldest) {
                    return size() > 200;
                }
            }
    );

    @PostConstruct
    public void onInit() {
        cleanOldCache();
    }

    public byte[] synthesizeGoogleTts(String rawText, String lang) {
        if (rawText == null || rawText.isBlank()) {
            throw new IllegalArgumentException("Văn bản trống");
        }

        String cleanText = rawText.trim();
        String fileHash = computeSha256(lang + ":" + cleanText);

        // 1. Kiểm tra RAM cache
        if (memoryAudioCache.containsKey(fileHash)) {
            return memoryAudioCache.get(fileHash);
        }

        // 2. Kiểm tra Disk cache (storage/tts_cache/)
        Path cacheDir = storageService.getTtsCachePath();
        Path cachedFile = cacheDir.resolve(fileHash + ".mp3");
        if (Files.exists(cachedFile)) {
            try {
                byte[] bytes = Files.readAllBytes(cachedFile);
                if (bytes.length > 200) {
                    memoryAudioCache.put(fileHash, bytes);
                    // Cập nhật lastModified để không bị xóa sớm
                    try { cachedFile.toFile().setLastModified(System.currentTimeMillis()); } catch (Exception ignored) {}
                    return bytes;
                }
            } catch (IOException ignored) {}
        }

        // 3. Gọi Google TTS tạo âm thanh
        List<String> chunks = splitIntoSafeChunks(cleanText, MAX_CHUNK_LENGTH);
        ByteArrayOutputStream combinedAudio = new ByteArrayOutputStream();

        for (String chunk : chunks) {
            byte[] chunkBytes = fetchChunkWithRetry(chunk, lang);
            combinedAudio.writeBytes(chunkBytes);
        }

        byte[] result = combinedAudio.toByteArray();

        // 4. Lưu vào RAM & lưu ra file Disk cache
        memoryAudioCache.put(fileHash, result);
        try {
            Files.write(cachedFile, result);
        } catch (IOException e) {
            log.warn("Không thể lưu cache TTS vào file: {}", e.getMessage());
        }

        return result;
    }

    private byte[] fetchChunkWithRetry(String chunk, String lang) {
        String encodedText = URLEncoder.encode(chunk, StandardCharsets.UTF_8);
        Exception lastError = null;

        // Thử lần lượt qua 3 client của Google nếu gặp lỗi mạng hoặc rate-limit
        for (int attempt = 0; attempt < GOOGLE_CLIENTS.length; attempt++) {
            String client = GOOGLE_CLIENTS[attempt];
            String url = String.format(
                    "https://translate.google.com/translate_tts?ie=UTF-8&q=%s&tl=%s&total=1&idx=0&textlen=%d&client=%s",
                    encodedText, lang, chunk.length(), client
            );

            try {
                HttpRequest request = HttpRequest.newBuilder()
                        .uri(URI.create(url))
                        .timeout(Duration.ofSeconds(10))
                        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
                        .header("Referer", "https://translate.google.com/")
                        .GET()
                        .build();

                HttpResponse<byte[]> response = httpClient.send(request, HttpResponse.BodyHandlers.ofByteArray());
                byte[] body = response.body();

                // Kiểm tra kích thước audio hợp lệ (tránh lỗi HTTP 200 nhưng trả về file rỗng/hỏng)
                if (response.statusCode() == 200 && body != null && body.length > 200) {
                    return body;
                }
                lastError = new RuntimeException("Google TTS trả về dữ liệu không hợp lệ (status=" + response.statusCode() + ")");
            } catch (Exception e) {
                lastError = e;
            }

            // Nghỉ ngắn 250ms trước khi đổi sang client dự phòng
            try { Thread.sleep(250L * (attempt + 1)); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
        }

        throw new RuntimeException("Không thể tải giọng đọc Google sau khi thử lại: " + (lastError != null ? lastError.getMessage() : ""));
    }

    private List<String> splitIntoSafeChunks(String text, int maxLen) {
        if (text.length() <= maxLen) {
            return Collections.singletonList(text);
        }
        List<String> chunks = new ArrayList<>();
        String[] parts = text.split("(?<=[,;:.!?—\\-])\\s+");
        StringBuilder current = new StringBuilder();

        for (String part : parts) {
            if (current.length() + part.length() + 1 <= maxLen) {
                if (!current.isEmpty()) current.append(" ");
                current.append(part);
            } else {
                if (!current.isEmpty()) {
                    chunks.add(current.toString());
                    current.setLength(0);
                }
                // Nếu bản thân 1 vế vẫn dài hơn maxLen thì cắt theo khoảng trắng
                if (part.length() > maxLen) {
                    String[] words = part.split("\\s+");
                    for (String w : words) {
                        if (current.length() + w.length() + 1 <= maxLen) {
                            if (!current.isEmpty()) current.append(" ");
                            current.append(w);
                        } else {
                            if (!current.isEmpty()) chunks.add(current.toString());
                            current = new StringBuilder(w);
                        }
                    }
                } else {
                    current.append(part);
                }
            }
        }
        if (!current.isEmpty()) {
            chunks.add(current.toString());
        }
        return chunks;
    }

    private String computeSha256(String input) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] digest = md.digest(input.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (byte b : digest) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (Exception e) {
            return Integer.toHexString(input.hashCode());
        }
    }

    /**
     * Dọn dẹp định kỳ tts_cache (3h sáng hàng ngày hoặc khi khởi động):
     * - Xóa file có lastModified > 7 ngày.
     * - Nếu tổng dung lượng > 500MB, xóa bớt file cũ nhất cho đến khi < 400MB.
     */
    @Scheduled(cron = "0 0 3 * * ?")
    public void cleanOldCache() {
        try {
            Path cacheDir = storageService.getTtsCachePath();
            if (!Files.exists(cacheDir)) return;

            File[] files = cacheDir.toFile().listFiles((dir, name) -> name.endsWith(".mp3"));
            if (files == null || files.length == 0) return;

            long now = System.currentTimeMillis();
            long totalSize = 0;
            List<File> fileList = new ArrayList<>(Arrays.asList(files));

            // Xóa file quá 7 ngày
            Iterator<File> it = fileList.iterator();
            while (it.hasNext()) {
                File f = it.next();
                if (now - f.lastModified() > MAX_FILE_AGE_MS) {
                    f.delete();
                    it.remove();
                } else {
                    totalSize += f.length();
                }
            }

            // Nếu vượt quá 500MB, xóa các file cũ nhất theo thời gian truy cập
            if (totalSize > MAX_CACHE_SIZE_BYTES) {
                fileList.sort(Comparator.comparingLong(File::lastModified));
                for (File f : fileList) {
                    if (totalSize <= TARGET_CACHE_SIZE_BYTES) break;
                    long sz = f.length();
                    if (f.delete()) {
                        totalSize -= sz;
                    }
                }
            }
            log.info("[TTS Cache Cleaner] Checked cache directory, active size: {} KB", totalSize / 1024);
        } catch (Exception e) {
            log.warn("[TTS Cache Cleaner] Error cleaning cache: {}", e.getMessage());
        }
    }
}

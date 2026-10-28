package com.dreader.service;

import org.springframework.stereotype.Service;

import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;

@Service
public class TtsService {

    private static final int MAX_CHUNK_LENGTH = 180;
    private static final String[] GOOGLE_CLIENTS = {"tw-ob", "gtx", "dict-chrome-ex"};

    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(8))
            .followRedirects(HttpClient.Redirect.NORMAL)
            .build();

    // Bộ nhớ đệm LRU giữ 200 câu gần nhất để giảm tải request lên Google
    private final Map<String, byte[]> audioCache = Collections.synchronizedMap(
            new LinkedHashMap<>(256, 0.75f, true) {
                @Override
                protected boolean removeEldestEntry(Map.Entry<String, byte[]> eldest) {
                    return size() > 200;
                }
            }
    );

    public byte[] synthesizeGoogleTts(String rawText, String lang) {
        if (rawText == null || rawText.isBlank()) {
            throw new IllegalArgumentException("Văn bản trống");
        }

        String cleanText = rawText.trim();
        String cacheKey = lang + ":" + cleanText;
        if (audioCache.containsKey(cacheKey)) {
            return audioCache.get(cacheKey);
        }

        List<String> chunks = splitIntoSafeChunks(cleanText, MAX_CHUNK_LENGTH);
        ByteArrayOutputStream combinedAudio = new ByteArrayOutputStream();

        for (String chunk : chunks) {
            byte[] chunkBytes = fetchChunkWithRetry(chunk, lang);
            combinedAudio.writeBytes(chunkBytes);
        }

        byte[] result = combinedAudio.toByteArray();
        audioCache.put(cacheKey, result);
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
}

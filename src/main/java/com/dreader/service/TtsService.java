package com.dreader.service;

import org.springframework.stereotype.Service;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import org.springframework.beans.factory.annotation.Autowired;

@Service
public class TtsService {

    @Autowired
    private VieNeuTtsService vieNeuTtsService;

    public static final Set<String> VIENEU_VOICES = new HashSet<>(Arrays.asList(
            "Adam bựa", "Trúc Ly", "Anh Khôi", "Mai Anh", "Minh Quân Pro", "Thùy Dung", "Thiền Tâm Đức", "Ngọc Huyền", "Quang Sơn", "Ngọc Trân",
            "Minh Đức", "Phạm Tuyên", "Xuân Vĩnh", "Thanh Bình", "Ngọc Linh", "Đoan Trang", "Quỳnh Anh", "Mạnh Dũng",
            "Adam", "Thái Sơn", "Thục Đoan", "Minh Triết", "Mỹ Duyên", "Đức Trí", "Kim Thanh"
    ));

    static {
        System.setProperty("java.net.preferIPv4Stack", "true");
        System.setProperty("java.net.preferIPv6Addresses", "false");
    }

    private static final String[] GOOGLE_TTS_ENDPOINTS = {
            "https://translate.googleapis.com/translate_tts?ie=UTF-8&client=gtx&tl=",
            "https://translate.google.com.vn/translate_tts?ie=UTF-8&client=tw-ob&tl=",
            "https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=",
            "https://translate.google.com/translate_tts?ie=UTF-8&client=gtx&tl="
    };
    private static final String CACHE_DIR = "./storage/tts_cache/";

    public TtsService() {
        try {
            Files.createDirectories(Paths.get(CACHE_DIR));
        } catch (Exception e) {
            System.err.println("Failed to create TTS cache directory: " + e.getMessage());
        }
    }

    public boolean isVieNeuVoice(String voice) {
        String actualVoice = getActualVoice(voice);
        return VIENEU_VOICES.contains(actualVoice);
    }

    public String getActualVoice(String voice) {
        return (voice != null) ? voice.replace("vi-VN-", "") : "";
    }

    public Path getCacheFile(String text, String lang, String voice) {
        String actualVoice = getActualVoice(voice);
        String cacheKey = generateCacheKey(text, lang, actualVoice);
        boolean isVieNeu = isVieNeuVoice(voice);
        String extension = isVieNeu ? ".wav" : ".mp3";
        return Paths.get(CACHE_DIR, cacheKey + extension);
    }

    public void streamSpeech(String text, String lang, String voice, OutputStream clientOut) throws Exception {
        if (text == null || text.trim().isEmpty()) {
            return;
        }

        Path cacheFile = getCacheFile(text, lang, voice);
        if (Files.exists(cacheFile)) {
            try (InputStream fis = Files.newInputStream(cacheFile)) {
                byte[] buffer = new byte[8192];
                int n;
                while ((n = fis.read(buffer)) != -1) {
                    clientOut.write(buffer, 0, n);
                }
                clientOut.flush();
                return;
            }
        }

        if (isVieNeuVoice(voice)) {
            String actualVoice = getActualVoice(voice);
            vieNeuTtsService.streamSpeech(text, actualVoice, clientOut, cacheFile);
        } else {
            byte[] audioData = synthesizeSpeech(text, lang, voice);
            if (audioData != null && audioData.length > 0) {
                clientOut.write(audioData);
                clientOut.flush();
            }
        }
    }

    public byte[] synthesizeSpeech(String text, String lang, String voice) throws Exception {
        if (text == null || text.trim().isEmpty()) {
            return new byte[0];
        }

        Path cacheFile = getCacheFile(text, lang, voice);

        if (Files.exists(cacheFile)) {
            return Files.readAllBytes(cacheFile);
        }

        byte[] audioData = null;
        if (isVieNeuVoice(voice)) {
            String actualVoice = getActualVoice(voice);
            audioData = vieNeuTtsService.synthesizeSpeech(text, actualVoice);
        } else {
            String targetLang = (lang == null || lang.trim().isEmpty()) ? "vi" : lang.trim();
            List<String> chunks = splitTextForTts(text, 140);

            if (chunks.size() == 1) {
                audioData = fetchTtsAudioChunk(chunks.get(0), targetLang);
            } else {
                ByteArrayOutputStream outputStream = new ByteArrayOutputStream();
                for (int i = 0; i < chunks.size(); i++) {
                    if (i > 0) {
                        // Tránh dồn request liên tiếp gây TCP RST từ Google
                        Thread.sleep(60);
                    }
                    byte[] audioChunk = fetchTtsAudioChunk(chunks.get(i), targetLang);
                    if (audioChunk != null && audioChunk.length > 0) {
                        if (i == 0) {
                            outputStream.write(audioChunk);
                        } else {
                            // Ghép nối an toàn: bóc tách ID3v2 header từ chunk thứ 2 trở đi
                            // để tránh làm lệch frame header của trình phát MP3
                            int audioOffset = skipId3v2Header(audioChunk);
                            outputStream.write(audioChunk, audioOffset, audioChunk.length - audioOffset);
                        }
                    }
                }
                audioData = outputStream.toByteArray();
            }
        }

        if (audioData != null && audioData.length > 0) {
            try {
                Files.write(cacheFile, audioData);
            } catch (Exception e) {
                System.err.println("Failed to write TTS cache file: " + e.getMessage());
            }
        }

        return audioData;
    }

    private int skipId3v2Header(byte[] data) {
        if (data == null || data.length < 10) return 0;
        // ID3 header starts with 'I', 'D', '3'
        if (data[0] == 'I' && data[1] == 'D' && data[2] == '3') {
            int size = (data[6] & 0x7F) << 21
                    | (data[7] & 0x7F) << 14
                    | (data[8] & 0x7F) << 7
                    | (data[9] & 0x7F);
            int totalHeader = 10 + size;
            // Check for optional footer flag
            if ((data[5] & 0x10) != 0) {
                totalHeader += 10;
            }
            if (totalHeader < data.length) {
                return totalHeader;
            }
        }
        return 0;
    }

    private String generateCacheKey(String text, String lang, String voice) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            String input = text + "|" + lang + "|" + voice;
            byte[] hash = digest.digest(input.getBytes(StandardCharsets.UTF_8));
            StringBuilder hexString = new StringBuilder(2 * hash.length);
            for (byte b : hash) {
                String hex = Integer.toHexString(0xff & b);
                if (hex.length() == 1) {
                    hexString.append('0');
                }
                hexString.append(hex);
            }
            return hexString.toString();
        } catch (Exception e) {
            return String.valueOf(Math.abs((text + lang + voice).hashCode()));
        }
    }

    private byte[] fetchTtsAudioChunk(String chunk, String lang) throws Exception {
        Exception lastException = null;
        String encodedText = URLEncoder.encode(chunk, StandardCharsets.UTF_8.toString());

        // Vòng 1: Thử lần lượt các endpoint dự phòng (Google APIs, Google VN, Google COM)
        for (String baseUrl : GOOGLE_TTS_ENDPOINTS) {
            String fullUrlStr = baseUrl + lang + "&q=" + encodedText;
            try {
                byte[] audio = tryFetchChunkFromUrl(fullUrlStr, chunk);
                if (audio != null && audio.length > 0) {
                    return audio;
                }
            } catch (Exception e) {
                lastException = e;
                System.err.println("Google TTS endpoint " + baseUrl + " error: " + e.getMessage() + ". Trying next endpoint...");
            }
        }

        // Vòng 2: Nếu vòng 1 chưa lấy được, chờ 800ms rồi thử lại một lượt cuối
        try {
            Thread.sleep(800);
        } catch (InterruptedException ignored) {}

        for (String baseUrl : GOOGLE_TTS_ENDPOINTS) {
            String fullUrlStr = baseUrl + lang + "&q=" + encodedText;
            try {
                byte[] audio = tryFetchChunkFromUrl(fullUrlStr, chunk);
                if (audio != null && audio.length > 0) {
                    return audio;
                }
            } catch (Exception e) {
                lastException = e;
            }
        }

        throw (lastException != null) ? lastException : new RuntimeException("Tất cả các endpoint Google TTS đều không phản hồi.");
    }

    private byte[] tryFetchChunkFromUrl(String fullUrlStr, String chunk) throws Exception {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(fullUrlStr);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36");
            conn.setRequestProperty("Referer", "https://translate.google.com/");
            conn.setRequestProperty("Accept-Language", "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7");
            conn.setRequestProperty("Accept", "audio/mpeg, audio/*;q=0.9, */*;q=0.8");
            conn.setRequestProperty("Connection", "keep-alive");
            conn.setConnectTimeout(3500);
            conn.setReadTimeout(6000);

            int responseCode = conn.getResponseCode();
            if (responseCode != HttpURLConnection.HTTP_OK) {
                throw new RuntimeException("Google TTS HTTP status: " + responseCode);
            }

            try (InputStream inputStream = conn.getInputStream();
                 ByteArrayOutputStream buffer = new ByteArrayOutputStream()) {
                byte[] data = new byte[4096];
                int nRead;
                while ((nRead = inputStream.read(data, 0, data.length)) != -1) {
                    buffer.write(data, 0, nRead);
                }
                byte[] audioData = buffer.toByteArray();

                int minExpectedSize = Math.min(1500, chunk.length() * 20);
                if (chunk.length() > 10 && audioData.length < minExpectedSize) {
                    throw new RuntimeException("TTS Audio suspiciously small: " + audioData.length + " bytes");
                }

                return audioData;
            }
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    public List<String> splitTextForTts(String text, int maxLength) {
        List<String> result = new ArrayList<>();
        String sanitized = text.replaceAll("\\s+", " ").trim();

        if (sanitized.length() <= maxLength) {
            result.add(sanitized);
            return result;
        }

        // Tách câu ưu tiên theo dấu câu tự nhiên
        String[] clauses = sanitized.split("(?<=[.!?,;:])\\s+");
        StringBuilder currentChunk = new StringBuilder();

        for (String clause : clauses) {
            clause = clause.trim();
            if (clause.isEmpty()) continue;

            if (currentChunk.length() + clause.length() + 1 <= maxLength) {
                if (currentChunk.length() > 0) {
                    currentChunk.append(" ");
                }
                currentChunk.append(clause);
            } else {
                if (currentChunk.length() > 0) {
                    result.add(currentChunk.toString().trim());
                    currentChunk.setLength(0);
                }

                if (clause.length() <= maxLength) {
                    currentChunk.append(clause);
                } else {
                    // Nếu một mệnh đề vẫn dài hơn maxLength, ngắt theo từ
                    String[] words = clause.split(" ");
                    for (String word : words) {
                        if (currentChunk.length() + word.length() + 1 <= maxLength) {
                            if (currentChunk.length() > 0) {
                                currentChunk.append(" ");
                            }
                            currentChunk.append(word);
                        } else {
                            if (currentChunk.length() > 0) {
                                result.add(currentChunk.toString().trim());
                                currentChunk.setLength(0);
                            }
                            currentChunk.append(word);
                        }
                    }
                }
            }
        }

        if (currentChunk.length() > 0) {
            result.add(currentChunk.toString().trim());
        }

        return result;
    }
}

package com.dreader.service;

import org.springframework.stereotype.Service;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;

import org.springframework.beans.factory.annotation.Autowired;

@Service
public class TtsService {

    @Autowired
    private EdgeTtsService edgeTtsService;

    private static final String GOOGLE_TTS_URL = "https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=";
    private static final String CACHE_DIR = "./storage/tts_cache/";

    public TtsService() {
        try {
            Files.createDirectories(Paths.get(CACHE_DIR));
        } catch (Exception e) {
            System.err.println("Failed to create TTS cache directory: " + e.getMessage());
        }
    }

    public byte[] synthesizeSpeech(String text, String lang, String voice) throws Exception {
        if (text == null || text.trim().isEmpty()) {
            return new byte[0];
        }

        String cacheKey = generateCacheKey(text, lang, voice);
        Path cacheFile = Paths.get(CACHE_DIR, cacheKey + ".mp3");

        if (Files.exists(cacheFile)) {
            System.out.println("Returning TTS from cache: " + cacheKey);
            return Files.readAllBytes(cacheFile);
        }

        byte[] audioData;
        if (voice != null && (voice.equals("vi-VN-HoaiMyNeural") || voice.equals("vi-VN-NamMinhNeural"))) {
            audioData = edgeTtsService.synthesizeSpeech(text, voice);
        } else {
            String targetLang = (lang == null || lang.trim().isEmpty()) ? "vi" : lang.trim();
            List<String> chunks = splitTextForTts(text, 150);

            ByteArrayOutputStream outputStream = new ByteArrayOutputStream();
            for (String chunk : chunks) {
                byte[] audioChunk = fetchTtsAudioChunk(chunk, targetLang);
                if (audioChunk != null && audioChunk.length > 0) {
                    outputStream.write(audioChunk);
                }
            }
            audioData = outputStream.toByteArray();
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
        String encodedText = URLEncoder.encode(chunk, StandardCharsets.UTF_8.toString());
        String fullUrlStr = GOOGLE_TTS_URL + lang + "&q=" + encodedText;

        URL url = new URL(fullUrlStr);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod("GET");
        conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
        conn.setRequestProperty("Accept", "audio/mpeg, audio/*;q=0.9, */*;q=0.8");
        conn.setConnectTimeout(5000);
        conn.setReadTimeout(5000);

        int responseCode = conn.getResponseCode();
        if (responseCode != HttpURLConnection.HTTP_OK) {
            throw new RuntimeException("Google TTS returned HTTP status: " + responseCode);
        }

        try (InputStream inputStream = conn.getInputStream();
             ByteArrayOutputStream buffer = new ByteArrayOutputStream()) {
            byte[] data = new byte[4096];
            int nRead;
            while ((nRead = inputStream.read(data, 0, data.length)) != -1) {
                buffer.write(data, 0, nRead);
            }
            return buffer.toByteArray();
        } finally {
            conn.disconnect();
        }
    }

    private List<String> splitTextForTts(String text, int maxLength) {
        List<String> result = new ArrayList<>();
        String sanitized = text.replaceAll("\\s+", " ").trim();

        if (sanitized.length() <= maxLength) {
            result.add(sanitized);
            return result;
        }

        String[] words = sanitized.split(" ");
        StringBuilder currentChunk = new StringBuilder();

        for (String word : words) {
            if (currentChunk.length() + word.length() + 1 > maxLength) {
                if (currentChunk.length() > 0) {
                    result.add(currentChunk.toString().trim());
                    currentChunk.setLength(0);
                }
                if (word.length() > maxLength) {
                    // Force slice very long words if any
                    for (int i = 0; i < word.length(); i += maxLength) {
                        result.add(word.substring(i, Math.min(i + maxLength, word.length())));
                    }
                    continue;
                }
            }
            if (currentChunk.length() > 0) {
                currentChunk.append(" ");
            }
            currentChunk.append(word);
        }

        if (currentChunk.length() > 0) {
            result.add(currentChunk.toString().trim());
        }

        return result;
    }
}

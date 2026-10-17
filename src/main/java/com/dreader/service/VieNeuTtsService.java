package com.dreader.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;

@Service
public class VieNeuTtsService {

    @Value("${vieneu.tts.base-url:http://localhost:8001}")
    private String baseUrl;

    private final ObjectMapper objectMapper = new ObjectMapper();

    public byte[] synthesizeSpeech(String text, String voice) throws Exception {
        String streamUrl = baseUrl.endsWith("/") ? baseUrl + "stream" : baseUrl + "/stream";

        URL url = new URL(streamUrl);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod("POST");
        conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        conn.setRequestProperty("Accept", "audio/wav, audio/*;q=0.9, */*;q=0.8");
        conn.setDoOutput(true);
        conn.setConnectTimeout(5000);
        conn.setReadTimeout(60000);

        Map<String, String> requestBody = new HashMap<>();
        requestBody.put("text", text);
        requestBody.put("voice_id", voice);

        String jsonBody = objectMapper.writeValueAsString(requestBody);

        try {
            try (OutputStream os = conn.getOutputStream()) {
                byte[] input = jsonBody.getBytes(StandardCharsets.UTF_8);
                os.write(input, 0, input.length);
            }

            int responseCode = conn.getResponseCode();
            if (responseCode != HttpURLConnection.HTTP_OK) {
                String errorMsg = "";
                try (InputStream errorStream = conn.getErrorStream()) {
                    if (errorStream != null) {
                        ByteArrayOutputStream result = new ByteArrayOutputStream();
                        byte[] buffer = new byte[1024];
                        int length;
                        while ((length = errorStream.read(buffer)) != -1) {
                            result.write(buffer, 0, length);
                        }
                        errorMsg = result.toString(StandardCharsets.UTF_8.name());
                    }
                } catch (Exception ignored) {}
                throw new RuntimeException("VieNeu Streaming Server returned HTTP status: " + responseCode + " - " + errorMsg);
            }

            try (InputStream inputStream = conn.getInputStream();
                 ByteArrayOutputStream buffer = new ByteArrayOutputStream()) {
                byte[] data = new byte[8192];
                int nRead;
                while ((nRead = inputStream.read(data, 0, data.length)) != -1) {
                    buffer.write(data, 0, nRead);
                }
                byte[] audioBytes = buffer.toByteArray();

                if (!isValidWav(audioBytes)) {
                    throw new RuntimeException("VieNeu trả về dữ liệu không phải WAV hợp lệ! Kích thước: " + audioBytes.length + " bytes.");
                }

                return audioBytes;
            }
        } catch (java.net.ConnectException | java.net.SocketTimeoutException e) {
            throw new RuntimeException("Không thể kết nối tới VieNeu-TTS (" + baseUrl + "). Hãy kiểm tra server VieNeu-TTS trên máy của bạn.", e);
        } finally {
            conn.disconnect();
        }
    }

    public void streamSpeech(String text, String voice, OutputStream clientOut, Path cacheFile) throws Exception {
        if (cacheFile != null && Files.exists(cacheFile)) {
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

        String streamUrl = baseUrl.endsWith("/") ? baseUrl + "stream" : baseUrl + "/stream";
        URL url = new URL(streamUrl);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod("POST");
        conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        conn.setRequestProperty("Accept", "audio/wav, audio/*;q=0.9, */*;q=0.8");
        conn.setDoOutput(true);
        conn.setConnectTimeout(5000);
        conn.setReadTimeout(60000);

        Map<String, String> requestBody = new HashMap<>();
        requestBody.put("text", text);
        requestBody.put("voice_id", voice);

        String jsonBody = objectMapper.writeValueAsString(requestBody);
        ByteArrayOutputStream cacheBuffer = (cacheFile != null) ? new ByteArrayOutputStream() : null;

        try {
            try (OutputStream os = conn.getOutputStream()) {
                byte[] input = jsonBody.getBytes(StandardCharsets.UTF_8);
                os.write(input, 0, input.length);
            }

            int responseCode = conn.getResponseCode();
            if (responseCode != HttpURLConnection.HTTP_OK) {
                String errorMsg = "";
                try (InputStream errorStream = conn.getErrorStream()) {
                    if (errorStream != null) {
                        ByteArrayOutputStream result = new ByteArrayOutputStream();
                        byte[] buffer = new byte[1024];
                        int length;
                        while ((length = errorStream.read(buffer)) != -1) {
                            result.write(buffer, 0, length);
                        }
                        errorMsg = result.toString(StandardCharsets.UTF_8.name());
                    }
                } catch (Exception ignored) {}
                throw new RuntimeException("VieNeu Streaming Server returned HTTP status: " + responseCode + " - " + errorMsg);
            }

            try (InputStream inputStream = conn.getInputStream()) {
                byte[] buffer = new byte[4096];
                int n;
                while ((n = inputStream.read(buffer)) != -1) {
                    try {
                        clientOut.write(buffer, 0, n);
                        clientOut.flush();
                    } catch (Exception clientEx) {
                        // Client aborted connection (e.g. skipped to next sentence)
                        break;
                    }
                    if (cacheBuffer != null) {
                        cacheBuffer.write(buffer, 0, n);
                    }
                }
            }
        } catch (java.net.ConnectException | java.net.SocketTimeoutException e) {
            throw new RuntimeException("Không thể kết nối tới VieNeu-TTS Streaming Server (" + baseUrl + "). Hãy kiểm tra server VieNeu-TTS.", e);
        } finally {
            conn.disconnect();
        }

        if (cacheFile != null && cacheBuffer != null && cacheBuffer.size() > 44) {
            try {
                byte[] audioData = cacheBuffer.toByteArray();
                if (isValidWav(audioData)) {
                    Files.write(cacheFile, audioData);
                }
            } catch (Exception e) {
                System.err.println("Failed to write VieNeu cache file: " + e.getMessage());
            }
        }
    }

    private boolean isValidWav(byte[] audioBytes) {
        return audioBytes != null && audioBytes.length >= 12
                && audioBytes[0] == 'R' && audioBytes[1] == 'I'
                && audioBytes[2] == 'F' && audioBytes[3] == 'F'
                && audioBytes[8] == 'W' && audioBytes[9] == 'A'
                && audioBytes[10] == 'V' && audioBytes[11] == 'E';
    }
}

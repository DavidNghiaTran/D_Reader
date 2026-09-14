package com.dreader.service;

import org.springframework.stereotype.Service;

import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.nio.ByteBuffer;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.TimeZone;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.ReentrantLock;

@Service
public class EdgeTtsService {

    private static final String EDGE_URL = "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4";
    
    private WebSocket currentWebSocket;
    private final ReentrantLock lock = new ReentrantLock();
    
    // State for the current request
    private CompletableFuture<byte[]> currentAudioResult;
    private ByteArrayOutputStream currentAudioBuffer;

    private void ensureConnected() throws Exception {
        if (currentWebSocket != null && !currentWebSocket.isInputClosed() && !currentWebSocket.isOutputClosed()) {
            return;
        }

        HttpClient client = HttpClient.newHttpClient();
        CompletableFuture<WebSocket> wsFuture = client.newWebSocketBuilder()
                .header("Origin", "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold")
                .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0")
                .buildAsync(URI.create(EDGE_URL), new WebSocket.Listener() {
                    @Override
                    public void onOpen(WebSocket webSocket) {
                        String configMsg = "X-Timestamp:" + getTimestamp() + "\r\n" +
                                "Content-Type:application/json; charset=utf-8\r\n" +
                                "Path:speech.config\r\n\r\n" +
                                "{\"context\":{\"synthesis\":{\"audio\":{\"metadataoptions\":{\"sentenceBoundaryEnabled\":\"false\",\"wordBoundaryEnabled\":\"true\"},\"outputFormat\":\"audio-24khz-48kbitrate-mono-mp3\"}}}}";
                        webSocket.sendText(configMsg, true);
                        WebSocket.Listener.super.onOpen(webSocket);
                    }

                    @Override
                    public CompletionStage<?> onText(WebSocket webSocket, CharSequence data, boolean last) {
                        String message = data.toString();
                        if (message.contains("Path:turn.end")) {
                            if (currentAudioResult != null) {
                                currentAudioResult.complete(currentAudioBuffer.toByteArray());
                            }
                        }
                        return WebSocket.Listener.super.onText(webSocket, data, last);
                    }

                    @Override
                    public CompletionStage<?> onBinary(WebSocket webSocket, ByteBuffer data, boolean last) {
                        if (currentAudioBuffer != null) {
                            byte[] bytes = new byte[data.remaining()];
                            data.get(bytes);
                            if (bytes.length > 2) {
                                int headerLength = ((bytes[0] & 0xFF) << 8) | (bytes[1] & 0xFF);
                                int payloadStart = 2 + headerLength;
                                if (payloadStart < bytes.length) {
                                    currentAudioBuffer.write(bytes, payloadStart, bytes.length - payloadStart);
                                }
                            }
                        }
                        return WebSocket.Listener.super.onBinary(webSocket, data, last);
                    }

                    @Override
                    public void onError(WebSocket webSocket, Throwable error) {
                        if (currentAudioResult != null && !currentAudioResult.isDone()) {
                            currentAudioResult.completeExceptionally(error);
                        }
                        currentWebSocket = null;
                    }

                    @Override
                    public CompletionStage<?> onClose(WebSocket webSocket, int statusCode, String reason) {
                        if (currentAudioResult != null && !currentAudioResult.isDone()) {
                            currentAudioResult.completeExceptionally(new RuntimeException("WebSocket closed: " + reason));
                        }
                        currentWebSocket = null;
                        return WebSocket.Listener.super.onClose(webSocket, statusCode, reason);
                    }
                });

        currentWebSocket = wsFuture.get(10, TimeUnit.SECONDS);
    }

    public byte[] synthesizeSpeech(String text, String voiceName) throws Exception {
        lock.lock();
        try {
            ensureConnected();
            currentAudioResult = new CompletableFuture<>();
            currentAudioBuffer = new ByteArrayOutputStream();

            String ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='vi-VN'>" +
                    "<voice name='" + voiceName + "'><prosody pitch='+0Hz' rate='+0%'>" +
                    escapeXml(text) +
                    "</prosody></voice></speak>";

            String requestMsg = "X-RequestId:" + UUID.randomUUID().toString().replace("-", "") + "\r\n" +
                    "Content-Type:application/ssml+xml\r\n" +
                    "X-Timestamp:" + getTimestamp() + "Z\r\n" +
                    "Path:ssml\r\n\r\n" + ssml;

            currentWebSocket.sendText(requestMsg, true);

            return currentAudioResult.get(30, TimeUnit.SECONDS);
        } catch (Exception e) {
            if (currentWebSocket != null) {
                currentWebSocket.abort();
            }
            currentWebSocket = null; // Force reconnect on error
            throw e;
        } finally {
            currentAudioResult = null;
            currentAudioBuffer = null;
            lock.unlock();
        }
    }

    private String getTimestamp() {
        SimpleDateFormat sdf = new SimpleDateFormat("EEE MMM dd yyyy HH:mm:ss 'GMT'Z (z)");
        sdf.setTimeZone(TimeZone.getTimeZone("UTC"));
        return sdf.format(new Date());
    }

    private String escapeXml(String s) {
        return s.replaceAll("&", "&amp;")
                .replaceAll("<", "&lt;")
                .replaceAll(">", "&gt;")
                .replaceAll("\"", "&quot;")
                .replaceAll("'", "&apos;");
    }
}

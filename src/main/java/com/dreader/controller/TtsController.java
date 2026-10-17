package com.dreader.controller;

import com.dreader.service.TtsService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

import java.util.concurrent.TimeUnit;

@RestController
@RequestMapping("/api/tts")
@CrossOrigin(origins = "*")
public class TtsController {

    @Autowired
    private TtsService ttsService;

    @Autowired
    private com.dreader.service.VieNeuTtsService vieNeuTtsService;

    @GetMapping
    public ResponseEntity<?> getTtsAudio(
            @RequestParam("text") String text,
            @RequestParam(value = "voice", defaultValue = "") String voice,
            @RequestParam(value = "lang", defaultValue = "vi") String lang) {
        try {
            if (text == null || text.trim().isEmpty()) {
                return ResponseEntity.badRequest().body("Parameter 'text' cannot be empty.");
            }

            byte[] audioBytes = ttsService.synthesizeSpeech(text, lang, voice);
            if (audioBytes == null || audioBytes.length == 0) {
                return ResponseEntity.status(HttpStatus.NO_CONTENT).build();
            }

            String contentType = "audio/mpeg";
            if (audioBytes.length > 4 && audioBytes[0] == 'R' && audioBytes[1] == 'I' && audioBytes[2] == 'F' && audioBytes[3] == 'F') {
                contentType = "audio/wav";
            }

            return ResponseEntity.ok()
                    .contentType(MediaType.parseMediaType(contentType))
                    .cacheControl(CacheControl.maxAge(1, TimeUnit.DAYS).cachePublic())
                    .body(audioBytes);
        } catch (Exception e) {
            System.err.println("Error synthesizing speech for text: " + text + " - " + e.getMessage());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body("TTS error: " + e.getMessage());
        }
    }

    @GetMapping("/stream")
    public ResponseEntity<StreamingResponseBody> streamTtsAudio(
            @RequestParam("text") String text,
            @RequestParam(value = "voice", defaultValue = "") String voice,
            @RequestParam(value = "lang", defaultValue = "vi") String lang) {
        if (text == null || text.trim().isEmpty()) {
            return ResponseEntity.badRequest().build();
        }

        boolean isVieNeu = ttsService.isVieNeuVoice(voice);
        String contentType = isVieNeu ? "audio/wav" : "audio/mpeg";

        StreamingResponseBody responseBody = outputStream -> {
            try {
                ttsService.streamSpeech(text, lang, voice, outputStream);
            } catch (Exception e) {
                System.err.println("Error streaming TTS: " + e.getMessage());
            }
        };

        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(contentType))
                .header(HttpHeaders.CACHE_CONTROL, "no-cache, no-store, must-revalidate")
                .header(HttpHeaders.PRAGMA, "no-cache")
                .header(HttpHeaders.EXPIRES, "0")
                .body(responseBody);
    }

    @GetMapping("/status")
    public ResponseEntity<java.util.Map<String, Object>> getTtsStatus() {
        java.util.Map<String, Object> status = new java.util.HashMap<>();
        status.put("googleTts", "READY");
        boolean localAiReady = vieNeuTtsService.isAvailable();
        status.put("localAiTts", localAiReady ? "READY" : "OFFLINE");
        status.put("voices", TtsService.VIENEU_VOICES);
        return ResponseEntity.ok(status);
    }
}

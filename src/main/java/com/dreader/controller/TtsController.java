package com.dreader.controller;

import com.dreader.service.TtsService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.concurrent.TimeUnit;

@RestController
@RequestMapping("/api/tts")
@CrossOrigin(origins = "*")
public class TtsController {

    @Autowired
    private TtsService ttsService;

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

            return ResponseEntity.ok()
                    .contentType(MediaType.parseMediaType("audio/mpeg"))
                    .cacheControl(CacheControl.maxAge(1, TimeUnit.DAYS).cachePublic())
                    .body(audioBytes);
        } catch (Exception e) {
            System.err.println("Error synthesizing speech for text: " + text + " - " + e.getMessage());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body("TTS error: " + e.getMessage());
        }
    }
}

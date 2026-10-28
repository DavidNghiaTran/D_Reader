package com.dreader.controller;

import com.dreader.service.TtsService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
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

    @GetMapping({"", "/speak"})
    public ResponseEntity<byte[]> speak(
            @RequestParam("text") String text,
            @RequestParam(value = "lang", defaultValue = "vi") String lang) {
        
        byte[] audioBytes = ttsService.synthesizeGoogleTts(text, lang);

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.valueOf("audio/mpeg"));
        headers.setContentLength(audioBytes.length);
        // Cho phép trình duyệt cache lại câu đã đọc trong 1 giờ để tua lại không tốn request
        headers.setCacheControl(CacheControl.maxAge(1, TimeUnit.HOURS).cachePublic());

        return ResponseEntity.ok()
                .headers(headers)
                .body(audioBytes);
    }
}

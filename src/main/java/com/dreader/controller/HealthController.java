package com.dreader.controller;

import com.dreader.service.StorageService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/health")
@CrossOrigin(origins = "*")
public class HealthController {

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private StorageService storageService;

    @GetMapping
    public ResponseEntity<Map<String, Object>> checkHealth() {
        Map<String, Object> health = new HashMap<>();
        health.put("status", "UP");

        try {
            jdbcTemplate.queryForObject("SELECT 1", Integer.class);
            health.put("database", "UP");
        } catch (Exception e) {
            health.put("database", "DOWN: " + e.getMessage());
            health.put("status", "DOWN");
        }

        try {
            boolean booksExist = storageService.getBooksPath().toFile().exists();
            boolean coversExist = storageService.getCoversPath().toFile().exists();
            health.put("storage", (booksExist && coversExist) ? "UP" : "DOWN");
        } catch (Exception e) {
            health.put("storage", "DOWN: " + e.getMessage());
            health.put("status", "DOWN");
        }

        health.put("ttsEngine", "Google TTS");

        return ResponseEntity.ok(health);
    }
}

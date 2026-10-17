package com.dreader.controller;

import com.dreader.dto.ProgressRequest;
import com.dreader.entity.ReadingProgress;
import com.dreader.service.ProgressService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/progress")
@CrossOrigin(origins = "*")
public class ProgressController {

    @Autowired
    private ProgressService progressService;

    @GetMapping("/{bookId}")
    public ResponseEntity<ReadingProgress> getProgress(@PathVariable("bookId") Long bookId) {
        return ResponseEntity.ok(progressService.getProgress(bookId));
    }

    @PutMapping("/{bookId}")
    public ResponseEntity<ReadingProgress> updateProgress(
            @PathVariable("bookId") Long bookId,
            @RequestBody ProgressRequest request) {
        ReadingProgress updated = progressService.updateProgress(
                bookId,
                request.getCfi(),
                request.getPercentage(),
                request.getChapterTitle(),
                request.getChapterIndex(),
                request.getReadingTimeSeconds()
        );
        return ResponseEntity.ok(updated);
    }
}

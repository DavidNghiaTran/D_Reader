package com.dreader.controller;

import com.dreader.dto.BookmarkDto;
import com.dreader.service.BookmarkService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/bookmarks")
public class BookmarkController {

    @Autowired
    private BookmarkService bookmarkService;

    @GetMapping("/book/{bookId}")
    public ResponseEntity<List<BookmarkDto>> getBookmarksByBook(@PathVariable Long bookId) {
        return ResponseEntity.ok(bookmarkService.getBookmarksByBookId(bookId));
    }

    @PostMapping
    public ResponseEntity<?> addBookmark(@RequestBody Map<String, Object> payload) {
        try {
            Long bookId = Long.parseLong(payload.get("bookId").toString());
            String name = payload.getOrDefault("name", "Dấu trang").toString();
            String cfi = payload.get("cfi").toString();
            String chapterTitle = payload.getOrDefault("chapterTitle", "").toString();
            String selectedText = payload.containsKey("selectedText") ? payload.get("selectedText").toString() : null;
            String note = payload.containsKey("note") ? payload.get("note").toString() : null;
            String color = payload.getOrDefault("color", "yellow").toString();

            BookmarkDto dto = bookmarkService.addBookmark(bookId, name, cfi, chapterTitle, selectedText, note, color);
            return ResponseEntity.ok(dto);
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> deleteBookmark(@PathVariable Long id) {
        bookmarkService.deleteBookmark(id);
        return ResponseEntity.ok().build();
    }
}

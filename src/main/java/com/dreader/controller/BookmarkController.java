package com.dreader.controller;

import com.dreader.entity.Book;
import com.dreader.entity.Bookmark;
import com.dreader.exception.BookNotFoundException;
import com.dreader.repository.BookRepository;
import com.dreader.repository.BookmarkRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/bookmarks")
public class BookmarkController {

    @Autowired
    private BookmarkRepository bookmarkRepository;

    @Autowired
    private BookRepository bookRepository;

    @GetMapping("/book/{bookId}")
    public ResponseEntity<List<Bookmark>> getBookmarksByBook(@PathVariable Long bookId) {
        return ResponseEntity.ok(bookmarkRepository.findByBookId(bookId));
    }

    @PostMapping
    public ResponseEntity<?> addBookmark(@RequestBody Map<String, Object> payload) {
        try {
            Long bookId = Long.parseLong(payload.get("bookId").toString());
            String name = payload.get("name").toString();
            String cfi = payload.get("cfi").toString();
            String chapterTitle = payload.getOrDefault("chapterTitle", "").toString();

            Book book = bookRepository.findById(bookId)
                    .orElseThrow(() -> new BookNotFoundException("Book not found"));

            Bookmark bookmark = new Bookmark();
            bookmark.setBook(book);
            bookmark.setName(name);
            bookmark.setCfi(cfi);
            bookmark.setChapterTitle(chapterTitle);

            return ResponseEntity.ok(bookmarkRepository.save(bookmark));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> deleteBookmark(@PathVariable Long id) {
        bookmarkRepository.deleteById(id);
        return ResponseEntity.ok().build();
    }
}

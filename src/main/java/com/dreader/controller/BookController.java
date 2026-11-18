package com.dreader.controller;

import com.dreader.dto.BookDto;
import com.dreader.entity.Book;
import com.dreader.service.BookService;
import com.dreader.service.FormatConverterService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.File;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/books")
@CrossOrigin(origins = "*")
public class BookController {

    @Autowired
    private BookService bookService;

    @PostMapping("/upload")
    public ResponseEntity<?> uploadBook(@RequestParam("file") MultipartFile file) {
        try {
            if (file.isEmpty()) {
                return ResponseEntity.badRequest().body("Tệp tải lên không được để trống.");
            }
            String origName = file.getOriginalFilename();
            if (!FormatConverterService.isSupportedFilename(origName)) {
                return ResponseEntity.badRequest().body("Định dạng không được hỗ trợ. Vui lòng chọn tệp .epub, .pdf, .mobi, .azw3, .txt hoặc .docx.");
            }
            String fileHash = bookService.calculateFileHash(file);
            boolean isDuplicate = bookService.existsByFileHash(fileHash);
            BookDto bookDto = bookService.uploadBook(file);
            if (isDuplicate) {
                return ResponseEntity.ok()
                        .header("X-Book-Duplicate", "true")
                        .body(bookDto);
            }
            return ResponseEntity.status(HttpStatus.CREATED).body(bookDto);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body("Upload error: " + e.getMessage());
        }
    }

    @GetMapping
    public ResponseEntity<List<BookDto>> getAllBooks() {
        return ResponseEntity.ok(bookService.getAllBooks());
    }

    @GetMapping("/{id}")
    public ResponseEntity<BookDto> getBookById(@PathVariable("id") Long id) {
        return ResponseEntity.ok(bookService.getBookById(id));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteBook(@PathVariable("id") Long id) {
        bookService.deleteBook(id);
        return ResponseEntity.noContent().build();
    }

    @PatchMapping("/{id}")
    public ResponseEntity<BookDto> updateBook(
            @PathVariable("id") Long id,
            @RequestBody Map<String, String> body) {
        String title = body.get("title");
        String author = body.get("author");
        return ResponseEntity.ok(bookService.updateBookMetadata(id, title, author));
    }

    @GetMapping("/{id}/file")
    public ResponseEntity<Resource> getBookFile(@PathVariable("id") Long id) {
        Book book = bookService.getBookEntityById(id);
        File file = new File(book.getFilePath());
        if (!file.exists()) {
            return ResponseEntity.notFound().build();
        }
        Resource resource = new FileSystemResource(file);
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType("application/epub+zip"))
                .header(HttpHeaders.CONTENT_DISPOSITION, "inline; filename=\"" + file.getName() + "\"")
                .body(resource);
    }

    @GetMapping("/{id}/cover")
    public ResponseEntity<Resource> getBookCover(@PathVariable("id") Long id) {
        Book book = bookService.getBookEntityById(id);
        if (book.getCoverPath() == null) {
            return ResponseEntity.notFound().build();
        }
        File file = new File(book.getCoverPath());
        if (!file.exists()) {
            return ResponseEntity.notFound().build();
        }
        Resource resource = new FileSystemResource(file);
        String contentType = "image/jpeg";
        if (file.getName().endsWith(".png")) contentType = "image/png";
        else if (file.getName().endsWith(".webp")) contentType = "image/webp";

        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(contentType))
                .header(HttpHeaders.CACHE_CONTROL, "public, max-age=604800")
                .body(resource);
    }

    @GetMapping("/{id}/toc")
    public ResponseEntity<List<com.dreader.util.EpubParser.ChapterInfo>> getBookToc(@PathVariable("id") Long id) {
        return ResponseEntity.ok(bookService.getBookToc(id));
    }

    @GetMapping("/{id}/chapters/{chapterIndex}")
    public ResponseEntity<com.dreader.dto.ChapterContentDto> getChapterContent(
            @PathVariable("id") Long id,
            @PathVariable("chapterIndex") int chapterIndex) {
        return ResponseEntity.ok(bookService.getChapterContent(id, chapterIndex));
    }
}

package com.dreader.service;

import com.dreader.dto.BookDto;
import com.dreader.entity.Book;
import com.dreader.entity.ReadingProgress;
import com.dreader.repository.BookmarkRepository;
import com.dreader.repository.BookRepository;
import com.dreader.repository.ReadingProgressRepository;
import com.dreader.util.EpubParser;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import com.dreader.exception.BookNotFoundException;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;
import java.util.stream.Collectors;

@Service
public class BookService {

    @Autowired
    private BookRepository bookRepository;

    @Autowired
    private ReadingProgressRepository progressRepository;

    @Autowired
    private BookmarkRepository bookmarkRepository;

    @Autowired
    private StorageService storageService;

    @Transactional
    public BookDto uploadBook(MultipartFile file) throws IOException {
        String fileHash = calculateSha256(file);

        // Check for duplicate book upload
        Optional<Book> existing = bookRepository.findByFileHash(fileHash);
        if (existing.isPresent()) {
            Book b = existing.get();
            Optional<ReadingProgress> pOpt = progressRepository.findByBookId(b.getId());
            return convertToDto(b, pOpt.orElse(null));
        }

        String savedFilePath = storageService.saveBookFile(file);
        File savedFile = new File(savedFilePath);

        EpubParser.Metadata metadata = EpubParser.parseEpub(savedFile);

        String savedCoverPath = null;
        if (metadata.getCoverBytes() != null && metadata.getCoverBytes().length > 0) {
            savedCoverPath = storageService.saveCoverBytes(metadata.getCoverBytes(), metadata.getCoverFormat());
        }

        Book book = new Book();
        book.setTitle(metadata.getTitle());
        book.setAuthor(metadata.getAuthor());
        book.setDescription(metadata.getDescription());
        book.setLanguage(metadata.getLanguage() != null ? metadata.getLanguage() : "vi");
        book.setPublisher(metadata.getPublisher());
        book.setIsbn(metadata.getIsbn());
        book.setFilePath(savedFilePath);
        book.setCoverPath(savedCoverPath);
        book.setFileSize(file.getSize());
        book.setFileHash(fileHash);
        book.setTotalChapters(metadata.getTotalChapters());
        book.setProcessingStatus("READY");

        Book savedBook = bookRepository.save(book);

        // Initialize progress (1:1 with bookId as PK)
        ReadingProgress progress = new ReadingProgress();
        progress.setBookId(savedBook.getId());
        progress.setCurrentCfi("");
        progress.setProgressPercentage(0.0f);
        progressRepository.save(progress);

        return convertToDto(savedBook, progress);
    }

    public List<BookDto> getAllBooks() {
        List<Book> books = bookRepository.findAll();
        return books.stream().map(book -> {
            Optional<ReadingProgress> progressOpt = progressRepository.findByBookId(book.getId());
            return convertToDto(book, progressOpt.orElse(null));
        }).collect(Collectors.toList());
    }

    public BookDto getBookById(Long id) {
        Book book = bookRepository.findById(id)
                .orElseThrow(() -> new BookNotFoundException("Không tìm thấy sách với ID: " + id));
        Optional<ReadingProgress> progressOpt = progressRepository.findByBookId(id);
        return convertToDto(book, progressOpt.orElse(null));
    }

    public Book getBookEntityById(Long id) {
        return bookRepository.findById(id)
                .orElseThrow(() -> new BookNotFoundException("Không tìm thấy sách với ID: " + id));
    }

    @Transactional
    public void deleteBook(Long id) {
        Book book = bookRepository.findById(id)
                .orElseThrow(() -> new BookNotFoundException("Không tìm thấy sách với ID: " + id));

        // 1. Delete physical files on Windows storage first
        storageService.deleteFile(book.getFilePath());
        if (book.getCoverPath() != null) {
            storageService.deleteFile(book.getCoverPath());
        }

        // 2. Delete database records (cascade: bookmarks -> progress -> book)
        bookmarkRepository.deleteByBookId(id);
        progressRepository.deleteById(id);
        bookRepository.deleteById(id);
    }

    @Transactional
    public BookDto updateBookMetadata(Long id, String title, String author) {
        Book book = bookRepository.findById(id)
                .orElseThrow(() -> new BookNotFoundException("Không tìm thấy sách với ID: " + id));
        if (title != null && !title.trim().isEmpty()) {
            book.setTitle(title.trim());
        }
        if (author != null && !author.trim().isEmpty()) {
            book.setAuthor(author.trim());
        }
        Book saved = bookRepository.save(book);
        Optional<ReadingProgress> progressOpt = progressRepository.findByBookId(id);
        return convertToDto(saved, progressOpt.orElse(null));
    }

    private String calculateSha256(MultipartFile file) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            try (InputStream is = file.getInputStream();
                 DigestInputStream dis = new DigestInputStream(is, digest)) {
                byte[] buffer = new byte[8192];
                while (dis.read(buffer) != -1) {}
            }
            return HexFormat.of().formatHex(digest.digest());
        } catch (Exception e) {
            return String.valueOf(file.getSize());
        }
    }

    private BookDto convertToDto(Book book, ReadingProgress progress) {
        BookDto dto = new BookDto();
        dto.setId(book.getId());
        dto.setTitle(book.getTitle());
        dto.setAuthor(book.getAuthor());
        dto.setDescription(book.getDescription());
        dto.setLanguage(book.getLanguage());
        dto.setPublisher(book.getPublisher());
        dto.setIsbn(book.getIsbn());
        dto.setFilePath(book.getFilePath());
        dto.setCoverPath(book.getCoverPath());
        dto.setFileUrl("/api/books/" + book.getId() + "/file");
        dto.setCoverUrl(book.getCoverPath() != null ? "/api/books/" + book.getId() + "/cover" : null);
        dto.setFileSize(book.getFileSize());
        dto.setFileHash(book.getFileHash());
        dto.setTotalChapters(book.getTotalChapters());
        dto.setProcessingStatus(book.getProcessingStatus());
        dto.setCreatedAt(book.getCreatedAt());

        if (progress != null) {
            dto.setProgressPercentage(progress.getProgressPercentage());
            dto.setCurrentCfi(progress.getCurrentCfi());
            dto.setChapterTitle(progress.getChapterTitle());
            dto.setChapterIndex(progress.getChapterIndex());
        } else {
            dto.setProgressPercentage(0.0f);
            dto.setCurrentCfi("");
            dto.setChapterTitle(null);
            dto.setChapterIndex(0);
        }

        return dto;
    }
}

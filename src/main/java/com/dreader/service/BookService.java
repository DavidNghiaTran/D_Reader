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

    @Autowired
    private FormatConverterService formatConverterService;

    public String calculateFileHash(MultipartFile file) {
        return calculateSha256(file);
    }

    public boolean existsByFileHash(String fileHash) {
        return bookRepository.existsByFileHash(fileHash);
    }

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

        String detectedFmt = FormatConverterService.detectFormat(file.getOriginalFilename());
        String originalFormat = detectedFmt != null ? detectedFmt : "EPUB";

        String savedFilePath;
        if ("EPUB".equalsIgnoreCase(originalFormat)) {
            savedFilePath = storageService.saveBookFile(file);
        } else {
            savedFilePath = formatConverterService.convertToEpubAndStore(file, originalFormat);
        }
        File savedFile = new File(savedFilePath);

        EpubParser.Metadata metadata = EpubParser.parseEpub(savedFile);
        String savedBaseUuid = savedFile.getName().replaceAll("(?i)\\.epub$", "");
        if (metadata.getTitle() == null || metadata.getTitle().isBlank() || metadata.getTitle().equalsIgnoreCase(savedBaseUuid)) {
            metadata.setTitle(FormatConverterService.extractCleanBaseTitle(file.getOriginalFilename()));
        }

        String savedCoverPath = null;
        if (metadata.getCoverBytes() != null && metadata.getCoverBytes().length > 0) {
            savedCoverPath = storageService.saveCoverBytes(metadata.getCoverBytes(), metadata.getCoverFormat());
        }

        Book book = new Book();
        book.setTitle(safeTruncate(metadata.getTitle(), 500));
        book.setAuthor(safeTruncate(metadata.getAuthor(), 255));
        book.setDescription(metadata.getDescription());
        book.setLanguage(safeTruncate(metadata.getLanguage() != null ? metadata.getLanguage() : "vi", 50));
        book.setPublisher(safeTruncate(metadata.getPublisher(), 255));
        book.setIsbn(safeTruncate(metadata.getIsbn(), 255));
        book.setFilePath(savedFilePath);
        book.setCoverPath(savedCoverPath);
        book.setFileSize(file.getSize());
        book.setFileHash(fileHash);
        book.setTotalChapters(metadata.getTotalChapters());
        book.setOriginalFormat(originalFormat);
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
        dto.setOriginalFormat(book.getOriginalFormat() != null && !book.getOriginalFormat().isBlank()
                ? book.getOriginalFormat().toUpperCase()
                : "EPUB");
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

    private static String safeTruncate(String value, int maxLength) {
        if (value == null) return null;
        String trimmed = value.trim();
        return trimmed.length() <= maxLength ? trimmed : trimmed.substring(0, maxLength);
    }

    public String cleanAndFormatChapterHtml(String rawHtml) {
        return EpubParser.cleanAndFormatChapterHtml(rawHtml);
    }

    public List<EpubParser.ChapterInfo> getBookToc(Long bookId) {
        Book book = getBookEntityById(bookId);
        File epubFile = new File(book.getFilePath());
        if (!epubFile.exists()) {
            throw new RuntimeException("Tệp EPUB không tồn tại: " + book.getFilePath());
        }
        List<EpubParser.ChapterInfo> toc = EpubParser.extractToc(epubFile);
        if (toc != null && !toc.isEmpty() && (book.getTotalChapters() == null || book.getTotalChapters() < toc.size())) {
            book.setTotalChapters(toc.size());
            bookRepository.save(book);
        }
        return toc;
    }

    public com.dreader.dto.ChapterContentDto getChapterContent(Long bookId, int chapterIndex) {
        Book book = getBookEntityById(bookId);
        File epubFile = new File(book.getFilePath());
        if (!epubFile.exists()) {
            throw new RuntimeException("Tệp EPUB không tồn tại: " + book.getFilePath());
        }

        List<EpubParser.ChapterInfo> toc = EpubParser.extractToc(epubFile);
        int total = toc.size();
        if (chapterIndex < 0 || chapterIndex >= total) {
            throw new IllegalArgumentException("Chỉ mục chương không hợp lệ: " + chapterIndex + " (Tổng số: " + total + ")");
        }

        EpubParser.ChapterInfo chapterInfo = toc.get(chapterIndex);
        String rawHref = chapterInfo.getHref();
        String fileHref = rawHref.contains("#") ? rawHref.split("#")[0] : rawHref;

        try (java.util.zip.ZipFile zip = new java.util.zip.ZipFile(epubFile)) {
            java.util.zip.ZipEntry targetEntry = null;
            java.util.Enumeration<? extends java.util.zip.ZipEntry> entries = zip.entries();
            while (entries.hasMoreElements()) {
                java.util.zip.ZipEntry e = entries.nextElement();
                String name = e.getName();
                if (name.equals(fileHref) || name.endsWith("/" + fileHref) || fileHref.endsWith(name) || name.equalsIgnoreCase(fileHref)) {
                    targetEntry = e;
                    break;
                }
            }

            if (targetEntry == null) {
                String simpleName = fileHref.contains("/") ? fileHref.substring(fileHref.lastIndexOf('/') + 1) : fileHref;
                entries = zip.entries();
                while (entries.hasMoreElements()) {
                    java.util.zip.ZipEntry e = entries.nextElement();
                    if (e.getName().endsWith(simpleName)) {
                        targetEntry = e;
                        break;
                    }
                }
            }

            if (targetEntry == null) {
                throw new RuntimeException("Không tìm thấy tệp nội dung chương trong file EPUB: " + fileHref);
            }

            String rawContent;
            try (java.io.InputStream is = zip.getInputStream(targetEntry)) {
                rawContent = new String(is.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
            }

            org.jsoup.nodes.Document doc = org.jsoup.Jsoup.parse(rawContent);
            doc.select("script, style, link[rel=stylesheet]").remove();
            String cleanHtml = cleanAndFormatChapterHtml(doc.body().html());

            return new com.dreader.dto.ChapterContentDto(
                    chapterIndex,
                    chapterInfo.getTitle(),
                    chapterInfo.getHref(),
                    cleanHtml,
                    total
            );

        } catch (Exception e) {
            throw new RuntimeException("Lỗi khi đọc nội dung chương: " + e.getMessage(), e);
        }
    }
}

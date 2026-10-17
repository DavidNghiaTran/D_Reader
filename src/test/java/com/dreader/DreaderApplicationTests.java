package com.dreader;

import com.dreader.dto.BookDto;
import com.dreader.dto.BookmarkDto;
import com.dreader.entity.Book;
import com.dreader.entity.Bookmark;
import com.dreader.entity.ReadingProgress;
import com.dreader.repository.BookRepository;
import com.dreader.repository.BookmarkRepository;
import com.dreader.repository.ReadingProgressRepository;
import com.dreader.service.BookService;
import com.dreader.service.BookmarkService;
import com.dreader.service.StorageService;
import com.dreader.util.EpubParser;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockMultipartFile;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class DreaderApplicationTests {

    @Mock
    private BookRepository bookRepository;

    @Mock
    private BookmarkRepository bookmarkRepository;

    @Mock
    private ReadingProgressRepository progressRepository;

    @Mock
    private StorageService storageService;

    @InjectMocks
    private BookService bookService;

    @InjectMocks
    private BookmarkService bookmarkService;

    @Test
    @DisplayName("Test 1: EpubParser xử lý tệp lỗi hoặc không tồn tại một cách an toàn")
    void testEpubParserFallback() {
        File dummyFile = new File("test_sample_book.epub");
        EpubParser.Metadata metadata = EpubParser.parseEpub(dummyFile);
        assertNotNull(metadata);
        assertEquals("test_sample_book", metadata.getTitle());
        assertEquals("Chưa rõ tác giả", metadata.getAuthor());
    }

    @Test
    @DisplayName("Test 2: BookmarkService thêm dấu trang mới và lấy danh sách thành công")
    void testBookmarkServiceAddAndGet() {
        Book mockBook = new Book();
        mockBook.setId(10L);
        mockBook.setTitle("Đắc Nhân Tâm");

        when(bookRepository.findById(10L)).thenReturn(Optional.of(mockBook));

        Bookmark savedBookmark = new Bookmark();
        savedBookmark.setId(100L);
        savedBookmark.setBook(mockBook);
        savedBookmark.setName("Đoạn tâm đắc");
        savedBookmark.setCfi("epubcfi(/6/4[chap01]!/4/2/1:0)");
        savedBookmark.setChapterTitle("Chương 1");
        savedBookmark.setSelectedText("Muốn lấy mật thì đừng phá tổ ong");
        savedBookmark.setColor("yellow");

        when(bookmarkRepository.save(any(Bookmark.class))).thenReturn(savedBookmark);
        when(bookmarkRepository.findByBookId(10L)).thenReturn(Collections.singletonList(savedBookmark));

        BookmarkDto dto = bookmarkService.addBookmark(10L, "Đoạn tâm đắc", "epubcfi(/6/4[chap01]!/4/2/1:0)",
                "Chương 1", "Muốn lấy mật thì đừng phá tổ ong", null, "yellow");

        assertNotNull(dto);
        assertEquals(100L, dto.getId());
        assertEquals("Đoạn tâm đắc", dto.getName());
        assertEquals("Chương 1", dto.getChapterTitle());

        List<BookmarkDto> list = bookmarkService.getBookmarksByBookId(10L);
        assertEquals(1, list.size());
        assertEquals("Muốn lấy mật thì đừng phá tổ ong", list.get(0).getSelectedText());
    }

    @Test
    @DisplayName("Test 3: BookService cập nhật metadata (Tên & Tác giả) qua PATCH API")
    void testBookServiceUpdateMetadata() {
        Book book = new Book();
        book.setId(1L);
        book.setTitle("Tên Cũ");
        book.setAuthor("Tác Giả Cũ");

        ReadingProgress progress = new ReadingProgress();
        progress.setBookId(1L);
        progress.setProgressPercentage(45.5f);
        progress.setChapterTitle("Chương 5");

        when(bookRepository.findById(1L)).thenReturn(Optional.of(book));
        when(bookRepository.save(any(Book.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(progressRepository.findByBookId(1L)).thenReturn(Optional.of(progress));

        BookDto updated = bookService.updateBookMetadata(1L, "Tên Mới", "Tác Giả Mới");

        assertNotNull(updated);
        assertEquals("Tên Mới", updated.getTitle());
        assertEquals("Tác Giả Mới", updated.getAuthor());
        assertEquals(45.5f, updated.getProgressPercentage());
        assertEquals("Chương 5", updated.getChapterTitle());
        verify(bookRepository, times(1)).save(book);
    }

    @Test
    @DisplayName("Test 4: BookService xóa sách đồng bộ cascade bookmarks, progress và storage files")
    void testBookServiceDeleteBookCascade() {
        Book book = new Book();
        book.setId(5L);
        book.setFilePath("./storage/books/test.epub");
        book.setCoverPath("./storage/covers/test.jpg");

        when(bookRepository.findById(5L)).thenReturn(Optional.of(book));

        bookService.deleteBook(5L);

        verify(storageService, times(1)).deleteFile("./storage/books/test.epub");
        verify(storageService, times(1)).deleteFile("./storage/covers/test.jpg");
        verify(bookmarkRepository, times(1)).deleteByBookId(5L);
        verify(progressRepository, times(1)).deleteById(5L);
        verify(bookRepository, times(1)).deleteById(5L);
    }

    @Test
    @DisplayName("Test 5: BookService phát hiện sách trùng bằng SHA-256 không tạo file mới")
    void testBookServiceDuplicateDetection() throws IOException {
        byte[] content = "PK Dummy EPUB Content for hash testing".getBytes(StandardCharsets.UTF_8);
        MockMultipartFile file = new MockMultipartFile("file", "test.epub", "application/epub+zip", content);

        Book existingBook = new Book();
        existingBook.setId(99L);
        existingBook.setTitle("Sách Đã Tồn Tại");

        when(bookRepository.findByFileHash(any())).thenReturn(Optional.of(existingBook));
        when(progressRepository.findByBookId(99L)).thenReturn(Optional.empty());

        BookDto result = bookService.uploadBook(file);

        assertNotNull(result);
        assertEquals(99L, result.getId());
        assertEquals("Sách Đã Tồn Tại", result.getTitle());
        verify(storageService, never()).saveBookFile(any());
    }
}

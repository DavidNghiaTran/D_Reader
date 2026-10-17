package com.dreader.service;

import com.dreader.dto.BookmarkDto;
import com.dreader.entity.Book;
import com.dreader.entity.Bookmark;
import com.dreader.exception.BookNotFoundException;
import com.dreader.repository.BookRepository;
import com.dreader.repository.BookmarkRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.stream.Collectors;

@Service
public class BookmarkService {

    @Autowired
    private BookmarkRepository bookmarkRepository;

    @Autowired
    private BookRepository bookRepository;

    public List<BookmarkDto> getBookmarksByBookId(Long bookId) {
        return bookmarkRepository.findByBookId(bookId)
                .stream()
                .map(this::toDto)
                .collect(Collectors.toList());
    }

    public BookmarkDto addBookmark(Long bookId, String name, String cfi,
                                   String chapterTitle, String selectedText,
                                   String note, String color) {
        Book book = bookRepository.findById(bookId)
                .orElseThrow(() -> new BookNotFoundException("Book not found: " + bookId));

        Bookmark bookmark = new Bookmark();
        bookmark.setBook(book);
        bookmark.setName(name != null ? name : "Dấu trang");
        bookmark.setCfi(cfi);
        bookmark.setChapterTitle(chapterTitle);
        bookmark.setSelectedText(selectedText);
        bookmark.setNote(note);
        bookmark.setColor(color != null ? color : "yellow");

        return toDto(bookmarkRepository.save(bookmark));
    }

    public void deleteBookmark(Long id) {
        bookmarkRepository.deleteById(id);
    }

    private BookmarkDto toDto(Bookmark bm) {
        BookmarkDto dto = new BookmarkDto();
        dto.setId(bm.getId());
        dto.setBookId(bm.getBook().getId());
        dto.setName(bm.getName());
        dto.setCfi(bm.getCfi());
        dto.setChapterTitle(bm.getChapterTitle());
        dto.setSelectedText(bm.getSelectedText());
        dto.setNote(bm.getNote());
        dto.setColor(bm.getColor());
        return dto;
    }
}

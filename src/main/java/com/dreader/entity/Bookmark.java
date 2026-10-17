package com.dreader.entity;

import jakarta.persistence.*;

@Entity
@Table(name = "bookmarks")
public class Bookmark {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "book_id", nullable = false)
    private Book book;

    @Column(nullable = false)
    private String name;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String cfi;

    @Column(name = "chapter_title", length = 255)
    private String chapterTitle;

    @Column(name = "selected_text", columnDefinition = "TEXT")
    private String selectedText;

    @Column(columnDefinition = "TEXT")
    private String note;

    @Column(length = 20)
    private String color = "yellow";

    public Bookmark() {}

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public Book getBook() { return book; }
    public void setBook(Book book) { this.book = book; }

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }

    public String getCfi() { return cfi; }
    public void setCfi(String cfi) { this.cfi = cfi; }

    public String getChapterTitle() { return chapterTitle; }
    public void setChapterTitle(String chapterTitle) { this.chapterTitle = chapterTitle; }

    public String getSelectedText() { return selectedText; }
    public void setSelectedText(String selectedText) { this.selectedText = selectedText; }

    public String getNote() { return note; }
    public void setNote(String note) { this.note = note; }

    public String getColor() { return color; }
    public void setColor(String color) { this.color = color; }
}

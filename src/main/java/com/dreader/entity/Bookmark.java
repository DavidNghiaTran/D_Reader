package com.dreader.entity;

import jakarta.persistence.*;
@Entity
public class Bookmark {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "book_id", nullable = false)
    private Book book;

    @Column(nullable = false)
    private String name;

    @Column(nullable = false)
    private String cfi;
    
    private String chapterTitle;

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
}

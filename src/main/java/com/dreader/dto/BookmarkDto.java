package com.dreader.dto;

public class BookmarkDto {
    private Long id;
    private Long bookId;
    private String name;
    private String cfi;
    private String chapterTitle;
    private String selectedText;
    private String note;
    private String color;

    public BookmarkDto() {}

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public Long getBookId() { return bookId; }
    public void setBookId(Long bookId) { this.bookId = bookId; }

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

package com.dreader.dto;

import java.time.LocalDateTime;

public class BookDto {
    private Long id;
    private String title;
    private String author;
    private String description;
    private String language;
    private String publisher;
    private String isbn;
    private String filePath;
    private String coverPath;
    private String fileUrl;
    private String coverUrl;
    private Long fileSize;
    private String fileHash;
    private Integer totalChapters;
    private String processingStatus;
    private LocalDateTime createdAt;
    private Float progressPercentage;
    private String currentCfi;
    private String chapterTitle;
    private Integer chapterIndex;

    public BookDto() {}

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }

    public String getAuthor() { return author; }
    public void setAuthor(String author) { this.author = author; }

    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }

    public String getLanguage() { return language; }
    public void setLanguage(String language) { this.language = language; }

    public String getPublisher() { return publisher; }
    public void setPublisher(String publisher) { this.publisher = publisher; }

    public String getIsbn() { return isbn; }
    public void setIsbn(String isbn) { this.isbn = isbn; }

    public String getFilePath() { return filePath; }
    public void setFilePath(String filePath) { this.filePath = filePath; }

    public String getCoverPath() { return coverPath; }
    public void setCoverPath(String coverPath) { this.coverPath = coverPath; }

    public String getFileUrl() { return fileUrl; }
    public void setFileUrl(String fileUrl) { this.fileUrl = fileUrl; }

    public String getCoverUrl() { return coverUrl; }
    public void setCoverUrl(String coverUrl) { this.coverUrl = coverUrl; }

    public Long getFileSize() { return fileSize; }
    public void setFileSize(Long fileSize) { this.fileSize = fileSize; }

    public String getFileHash() { return fileHash; }
    public void setFileHash(String fileHash) { this.fileHash = fileHash; }

    public Integer getTotalChapters() { return totalChapters; }
    public void setTotalChapters(Integer totalChapters) { this.totalChapters = totalChapters; }

    public String getProcessingStatus() { return processingStatus; }
    public void setProcessingStatus(String processingStatus) { this.processingStatus = processingStatus; }

    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }

    public Float getProgressPercentage() { return progressPercentage; }
    public void setProgressPercentage(Float progressPercentage) { this.progressPercentage = progressPercentage; }

    public String getCurrentCfi() { return currentCfi; }
    public void setCurrentCfi(String currentCfi) { this.currentCfi = currentCfi; }

    public String getChapterTitle() { return chapterTitle; }
    public void setChapterTitle(String chapterTitle) { this.chapterTitle = chapterTitle; }

    public Integer getChapterIndex() { return chapterIndex; }
    public void setChapterIndex(Integer chapterIndex) { this.chapterIndex = chapterIndex; }
}

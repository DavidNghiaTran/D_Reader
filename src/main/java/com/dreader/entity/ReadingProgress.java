package com.dreader.entity;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "reading_progress")
public class ReadingProgress {

    @Id
    @Column(name = "book_id", nullable = false)
    private Long bookId;

    @Column(name = "current_cfi", nullable = false, columnDefinition = "TEXT")
    private String currentCfi;

    @Column(name = "progress_percentage")
    private Float progressPercentage = 0.0f;

    @Column(name = "chapter_title")
    private String chapterTitle;

    @Column(name = "chapter_index")
    private Integer chapterIndex = 0;

    @Column(name = "total_reading_seconds")
    private Long totalReadingSeconds = 0L;

    @Column(name = "last_read_at", insertable = false, updatable = false)
    private LocalDateTime lastReadAt;

    public ReadingProgress() {}

    public ReadingProgress(Long bookId, String currentCfi, Float progressPercentage) {
        this.bookId = bookId;
        this.currentCfi = currentCfi;
        this.progressPercentage = progressPercentage;
    }

    public String getChapterTitle() { return chapterTitle; }
    public void setChapterTitle(String chapterTitle) { this.chapterTitle = chapterTitle; }

    public Integer getChapterIndex() { return chapterIndex; }
    public void setChapterIndex(Integer chapterIndex) { this.chapterIndex = chapterIndex; }

    public Long getBookId() { return bookId; }
    public void setBookId(Long bookId) { this.bookId = bookId; }

    public String getCurrentCfi() { return currentCfi; }
    public void setCurrentCfi(String currentCfi) { this.currentCfi = currentCfi; }

    public Float getProgressPercentage() { return progressPercentage; }
    public void setProgressPercentage(Float progressPercentage) { this.progressPercentage = progressPercentage; }

    public Long getTotalReadingSeconds() { return totalReadingSeconds; }
    public void setTotalReadingSeconds(Long totalReadingSeconds) { this.totalReadingSeconds = totalReadingSeconds; }

    public LocalDateTime getLastReadAt() { return lastReadAt; }
    public void setLastReadAt(LocalDateTime lastReadAt) { this.lastReadAt = lastReadAt; }
}

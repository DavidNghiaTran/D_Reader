package com.dreader.dto;

public class ProgressRequest {
    private String cfi;
    private Float percentage;
    private String chapterTitle;
    private Integer chapterIndex;
    private Long readingTimeSeconds;

    public ProgressRequest() {}

    public ProgressRequest(String cfi, Float percentage) {
        this.cfi = cfi;
        this.percentage = percentage;
    }

    public String getCfi() { return cfi; }
    public void setCfi(String cfi) { this.cfi = cfi; }

    public Float getPercentage() { return percentage; }
    public void setPercentage(Float percentage) { this.percentage = percentage; }

    public String getChapterTitle() { return chapterTitle; }
    public void setChapterTitle(String chapterTitle) { this.chapterTitle = chapterTitle; }

    public Integer getChapterIndex() { return chapterIndex; }
    public void setChapterIndex(Integer chapterIndex) { this.chapterIndex = chapterIndex; }

    public Long getReadingTimeSeconds() { return readingTimeSeconds; }
    public void setReadingTimeSeconds(Long readingTimeSeconds) { this.readingTimeSeconds = readingTimeSeconds; }
}

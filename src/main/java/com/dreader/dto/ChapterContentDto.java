package com.dreader.dto;

public class ChapterContentDto {
    private int chapterIndex;
    private String chapterTitle;
    private String href;
    private String htmlContent;
    private int totalChapters;

    public ChapterContentDto() {}

    public ChapterContentDto(int chapterIndex, String chapterTitle, String href, String htmlContent, int totalChapters) {
        this.chapterIndex = chapterIndex;
        this.chapterTitle = chapterTitle;
        this.href = href;
        this.htmlContent = htmlContent;
        this.totalChapters = totalChapters;
    }

    public int getChapterIndex() { return chapterIndex; }
    public void setChapterIndex(int chapterIndex) { this.chapterIndex = chapterIndex; }

    public String getChapterTitle() { return chapterTitle; }
    public void setChapterTitle(String chapterTitle) { this.chapterTitle = chapterTitle; }

    public String getHref() { return href; }
    public void setHref(String href) { this.href = href; }

    public String getHtmlContent() { return htmlContent; }
    public void setHtmlContent(String htmlContent) { this.htmlContent = htmlContent; }

    public int getTotalChapters() { return totalChapters; }
    public void setTotalChapters(int totalChapters) { this.totalChapters = totalChapters; }
}


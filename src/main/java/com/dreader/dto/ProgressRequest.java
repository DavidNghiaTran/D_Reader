package com.dreader.dto;

public class ProgressRequest {
    private String cfi;
    private Float percentage;
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

    public Long getReadingTimeSeconds() { return readingTimeSeconds; }
    public void setReadingTimeSeconds(Long readingTimeSeconds) { this.readingTimeSeconds = readingTimeSeconds; }
}

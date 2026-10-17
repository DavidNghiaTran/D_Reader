package com.dreader.entity;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "reader_settings")
public class ReaderSetting {

    @Id
    private Long id = 1L;

    @Column(length = 50)
    private String theme = "dark";

    @Column(name = "font_family", length = 50)
    private String fontFamily = "sans-serif";

    @Column(name = "font_size")
    private Integer fontSize = 16;

    @Column(name = "line_height")
    private Float lineHeight = 1.6f;

    @Column(name = "flow_mode", length = 50)
    private String flowMode = "scrolled-doc";

    @Column(name = "content_width", length = 50)
    private String contentWidth = "wide";

    @Column(name = "tts_rate")
    private Float ttsRate = 1.0f;

    @Column(name = "tts_pitch")
    private Float ttsPitch = 1.0f;

    @Column(name = "tts_volume")
    private Float ttsVolume = 1.0f;

    @Column(name = "voice_uri", length = 500)
    private String voiceUri = "google-vi-online";

    @Column(name = "voice_name", length = 255)
    private String voiceName = "Google Tiếng Việt";

    @Column(name = "voice_lang", length = 20)
    private String voiceLang = "vi-VN";

    @Column(name = "auto_continue")
    private Boolean autoContinue = true;

    @Column(name = "auto_scroll")
    private Boolean autoScroll = true;

    @Column(name = "highlight_enabled")
    private Boolean highlightEnabled = true;

    @Column(name = "updated_at", insertable = false, updatable = false)
    private LocalDateTime updatedAt;

    public ReaderSetting() {}

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public String getFlowMode() { return flowMode; }
    public void setFlowMode(String flowMode) { this.flowMode = flowMode; }

    public String getContentWidth() { return contentWidth; }
    public void setContentWidth(String contentWidth) { this.contentWidth = contentWidth; }

    public String getTheme() { return theme; }
    public void setTheme(String theme) { this.theme = theme; }

    public String getFontFamily() { return fontFamily; }
    public void setFontFamily(String fontFamily) { this.fontFamily = fontFamily; }

    public Integer getFontSize() { return fontSize; }
    public void setFontSize(Integer fontSize) { this.fontSize = fontSize; }

    public Float getLineHeight() { return lineHeight; }
    public void setLineHeight(Float lineHeight) { this.lineHeight = lineHeight; }

    public Float getTtsRate() { return ttsRate; }
    public void setTtsRate(Float ttsRate) { this.ttsRate = ttsRate; }

    public Float getTtsPitch() { return ttsPitch; }
    public void setTtsPitch(Float ttsPitch) { this.ttsPitch = ttsPitch; }

    public Float getTtsVolume() { return ttsVolume; }
    public void setTtsVolume(Float ttsVolume) { this.ttsVolume = ttsVolume; }

    public String getVoiceUri() { return voiceUri; }
    public void setVoiceUri(String voiceUri) { this.voiceUri = voiceUri; }

    public String getVoiceName() { return voiceName; }
    public void setVoiceName(String voiceName) { this.voiceName = voiceName; }

    public String getVoiceLang() { return voiceLang; }
    public void setVoiceLang(String voiceLang) { this.voiceLang = voiceLang; }

    public Boolean getAutoContinue() { return autoContinue; }
    public void setAutoContinue(Boolean autoContinue) { this.autoContinue = autoContinue; }

    public Boolean getAutoScroll() { return autoScroll; }
    public void setAutoScroll(Boolean autoScroll) { this.autoScroll = autoScroll; }

    public Boolean getHighlightEnabled() { return highlightEnabled; }
    public void setHighlightEnabled(Boolean highlightEnabled) { this.highlightEnabled = highlightEnabled; }

    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
}

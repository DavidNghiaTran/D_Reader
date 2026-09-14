package com.dreader.service;

import com.dreader.entity.ReaderSetting;
import com.dreader.repository.ReaderSettingRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SettingService {

    @Autowired
    private ReaderSettingRepository settingRepository;

    public ReaderSetting getSettings() {
        return settingRepository.findById(1L).orElseGet(() -> {
            ReaderSetting s = new ReaderSetting();
            s.setId(1);
            s.setTheme("dark");
            s.setFontFamily("sans-serif");
            s.setFontSize(16);
            s.setLineHeight(1.6f);
            s.setTtsRate(1.0f);
            s.setTtsPitch(1.0f);
            s.setVoiceUri("google-vi-online");
            s.setVoiceName("Google Tiếng Việt");
            s.setVoiceLang("vi-VN");
            s.setAutoContinue(true);
            s.setAutoScroll(true);
            s.setHighlightEnabled(true);
            return settingRepository.save(s);
        });
    }

    @Transactional
    public ReaderSetting updateSettings(ReaderSetting input) {
        ReaderSetting existing = getSettings();
        if (input.getTheme() != null) existing.setTheme(input.getTheme());
        if (input.getFontFamily() != null) existing.setFontFamily(input.getFontFamily());
        if (input.getFontSize() != null) existing.setFontSize(input.getFontSize());
        if (input.getLineHeight() != null) existing.setLineHeight(input.getLineHeight());
        if (input.getTtsRate() != null) existing.setTtsRate(input.getTtsRate());
        if (input.getTtsPitch() != null) existing.setTtsPitch(input.getTtsPitch());
        if (input.getVoiceUri() != null) existing.setVoiceUri(input.getVoiceUri());
        if (input.getVoiceName() != null) existing.setVoiceName(input.getVoiceName());
        if (input.getVoiceLang() != null) existing.setVoiceLang(input.getVoiceLang());
        if (input.getAutoContinue() != null) existing.setAutoContinue(input.getAutoContinue());
        if (input.getAutoScroll() != null) existing.setAutoScroll(input.getAutoScroll());
        if (input.getHighlightEnabled() != null) existing.setHighlightEnabled(input.getHighlightEnabled());
        return settingRepository.save(existing);
    }
}

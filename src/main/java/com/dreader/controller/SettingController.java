package com.dreader.controller;

import com.dreader.entity.ReaderSetting;
import com.dreader.service.SettingService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/settings")
@CrossOrigin(origins = "*")
public class SettingController {

    @Autowired
    private SettingService settingService;

    @GetMapping
    public ResponseEntity<ReaderSetting> getSettings() {
        return ResponseEntity.ok(settingService.getSettings());
    }

    @PutMapping
    public ResponseEntity<ReaderSetting> updateSettings(@RequestBody ReaderSetting settings) {
        return ResponseEntity.ok(settingService.updateSettings(settings));
    }
}

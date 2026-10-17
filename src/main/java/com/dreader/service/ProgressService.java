package com.dreader.service;

import com.dreader.entity.ReadingProgress;
import com.dreader.repository.ReadingProgressRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ProgressService {

    @Autowired
    private ReadingProgressRepository progressRepository;

    public ReadingProgress getProgress(Long bookId) {
        return progressRepository.findByBookId(bookId)
                .orElseGet(() -> {
                    ReadingProgress newProgress = new ReadingProgress();
                    newProgress.setBookId(bookId);
                    newProgress.setCurrentCfi("");
                    newProgress.setProgressPercentage(0.0f);
                    return progressRepository.save(newProgress);
                });
    }

    @Transactional
    public ReadingProgress updateProgress(Long bookId, String cfi, Float percentage, String chapterTitle, Integer chapterIndex, Long readingTimeSeconds) {
        ReadingProgress progress = progressRepository.findByBookId(bookId)
                .orElseGet(() -> {
                    ReadingProgress p = new ReadingProgress();
                    p.setBookId(bookId);
                    p.setTotalReadingSeconds(0L);
                    return p;
                });

        if (cfi != null) {
            progress.setCurrentCfi(cfi);
        }
        if (percentage != null) {
            progress.setProgressPercentage(percentage);
        }
        if (chapterTitle != null && !chapterTitle.trim().isEmpty()) {
            progress.setChapterTitle(chapterTitle.trim());
        }
        if (chapterIndex != null) {
            progress.setChapterIndex(chapterIndex);
        }
        if (readingTimeSeconds != null) {
            Long current = progress.getTotalReadingSeconds() == null ? 0L : progress.getTotalReadingSeconds();
            progress.setTotalReadingSeconds(current + readingTimeSeconds);
        }

        return progressRepository.save(progress);
    }

    @Transactional
    public ReadingProgress updateProgress(Long bookId, String cfi, Float percentage, Long readingTimeSeconds) {
        return updateProgress(bookId, cfi, percentage, null, null, readingTimeSeconds);
    }
}

/**
 * D_Reader Modular TTS Engine (Google TTS & Web Speech API)
 * State Machine: IDLE | LOADING | PLAYING | PAUSED | STOPPED | ERROR
 */
const TTSEngine = {
    // State
    status: 'IDLE', // IDLE, LOADING, PLAYING, PAUSED, STOPPED, ERROR
    sentences: [],  // [{ id: 0, clean: "...", raw: "..." }]
    currentIndex: 0,
    isTurningPage: false,
    playToken: 0,

    // Concurrency & Network Control
    currentFetchController: null,
    startTimeout: null,
    rate: 1.0,
    isPlaying: false,
    isPaused: false,

    // Audio Providers
    audioPlayer: null, // HTML5 Audio for Google Cloud TTS
    audioBlobCache: new Map(), // Blob URL cache: index -> blobUrl (pre-fetched N+1, N+2)
    nextAudioCache: { index: -1, blobUrl: null }, // Compatibility fallback
    synth: window.speechSynthesis,
    voices: [],
    selectedVoiceUri: 'google-translate-vi',

    // Highlight tracking
    highlightElement: null,
    currentHighlightSpan: null,
    lastHighlightNode: null,
    errorCount: 0,

    // Sleep Timer
    sleepTimerTimeout: null,
    sleepTimerMinutes: 0,
    sleepAfterChapter: false,

    init() {
        this.audioPlayer = new Audio();

        this.bindEvents();
        this.populateVoiceSelect();
        this.checkTtsStatus();

        if (this.synth && this.synth.onvoiceschanged !== undefined) {
            this.synth.onvoiceschanged = () => this.populateVoiceSelect();
        }
    },

    // Backward compatibility no-op
    initAudioContext() {
        // No-op for compatibility
    },

    bindEvents() {
        const btnPlay = document.getElementById('btnTtsPlay');
        const btnStop = document.getElementById('btnTtsStop');
        const voiceSelect = document.getElementById('selectVoice');
        const rateInput = document.getElementById('inputTtsRate');
        const pitchInput = document.getElementById('inputTtsPitch');

        if (btnPlay) {
            btnPlay.addEventListener('click', () => {
                this.togglePlayPause();
            });
        }
        if (btnStop) btnStop.addEventListener('click', () => this.stop());

        // Prev / Next sentence
        document.getElementById('btnTtsPrevSentence')?.addEventListener('click', () => this.prevParagraph());
        document.getElementById('btnTtsNextSentence')?.addEventListener('click', () => this.nextParagraph());

        // Sleep Timer
        const sleepBtn = document.getElementById('btnSleepTimer');
        const sleepDropdown = document.getElementById('sleepTimerDropdown');
        if (sleepBtn && sleepDropdown) {
            sleepBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                sleepDropdown.classList.toggle('open');
            });
            document.addEventListener('click', () => sleepDropdown.classList.remove('open'));
            document.querySelectorAll('.sleep-timer-option').forEach(opt => {
                opt.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const minutes = opt.dataset.minutes;
                    this.setSleepTimer(minutes);
                    sleepDropdown.classList.remove('open');
                });
            });
        }

        // Settings Cog Button & Popover
        const btnTogglePopover = document.getElementById('btnTtsSettingsToggle');
        const popover = document.getElementById('ttsSettingsPopover');
        const btnClosePopover = document.getElementById('btnCloseTtsPopover');
        const btnQuickSpeed = document.getElementById('btnQuickSpeed');

        if (btnTogglePopover && popover) {
            btnTogglePopover.addEventListener('click', (e) => {
                e.stopPropagation();
                popover.classList.toggle('active');
                if (popover.classList.contains('active')) {
                    this.checkTtsStatus();
                }
            });
        }

        if (btnClosePopover && popover) {
            btnClosePopover.addEventListener('click', (e) => {
                e.stopPropagation();
                popover.classList.remove('active');
            });
        }

        if (btnQuickSpeed) {
            btnQuickSpeed.addEventListener('click', (e) => {
                e.stopPropagation();
                const speeds = [1.0, 1.5, 2.0, 3.0];
                const current = Reader.settings.ttsRate || 1.0;
                let nextIdx = speeds.findIndex(s => Math.abs(s - current) < 0.1) + 1;
                if (nextIdx >= speeds.length || nextIdx === 0) nextIdx = 0;
                const nextSpeed = speeds[nextIdx];
                if (rateInput) {
                    rateInput.value = nextSpeed;
                    rateInput.dispatchEvent(new Event('input'));
                }
            });
        }

        // Close popover on outside click
        document.addEventListener('click', (e) => {
            if (popover && popover.classList.contains('active')) {
                if (!popover.contains(e.target) && !btnTogglePopover?.contains(e.target) && !btnQuickSpeed?.contains(e.target)) {
                    popover.classList.remove('active');
                }
            }
        });

        if (voiceSelect) {
            voiceSelect.addEventListener('change', (e) => {
                this.selectedVoiceUri = e.target.value;
                Reader.settings.voiceUri = this.selectedVoiceUri;
                Reader.saveSettings();
            });
        }

        if (rateInput) {
            rateInput.addEventListener('input', (e) => {
                const rate = parseFloat(e.target.value);
                this.rate = rate;
                const display = document.getElementById('ttsRateDisplay');
                if (display) display.textContent = `${rate.toFixed(1)}x`;
                const qSpeed = document.getElementById('btnQuickSpeed');
                if (qSpeed) qSpeed.textContent = `${rate.toFixed(1)}x`;
                Reader.settings.ttsRate = rate;
                Reader.saveSettings();
                if (this.audioPlayer) {
                    this.audioPlayer.playbackRate = rate;
                }
                this.updateSpeedButtons(rate);
            });
        }

        document.querySelectorAll('.speed-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const speed = parseFloat(btn.dataset.speed);
                if (rateInput) {
                    rateInput.value = speed;
                    rateInput.dispatchEvent(new Event('input'));
                }
            });
        });

        if (pitchInput) {
            pitchInput.addEventListener('input', (e) => {
                const pitch = parseFloat(e.target.value);
                const display = document.getElementById('ttsPitchDisplay');
                if (display) display.textContent = `${pitch.toFixed(1)}`;
                Reader.settings.ttsPitch = pitch;
                Reader.saveSettings();
            });
        }

        const volumeInput = document.getElementById('inputTtsVolume');
        if (volumeInput) {
            volumeInput.addEventListener('input', (e) => {
                const volume = parseFloat(e.target.value);
                const display = document.getElementById('ttsVolumeDisplay');
                if (display) display.textContent = `${Math.round(volume * 100)}%`;
                Reader.settings.ttsVolume = volume;
                Reader.saveSettings();
                if (this.audioPlayer) {
                    this.audioPlayer.volume = volume;
                }
            });
        }
    },

    syncControlsFromSettings() {
        const rateInput = document.getElementById('inputTtsRate');
        if (rateInput && Reader.settings.ttsRate != null) {
            rateInput.value = Reader.settings.ttsRate;
            const d = document.getElementById('ttsRateDisplay');
            if (d) d.textContent = `${Reader.settings.ttsRate.toFixed(1)}x`;
            const q = document.getElementById('btnQuickSpeed');
            if (q) q.textContent = `${Reader.settings.ttsRate.toFixed(1)}x`;
            this.updateSpeedButtons(Reader.settings.ttsRate);
        }

        const pitchInput = document.getElementById('inputTtsPitch');
        if (pitchInput && Reader.settings.ttsPitch != null) {
            pitchInput.value = Reader.settings.ttsPitch;
            const d = document.getElementById('ttsPitchDisplay');
            if (d) d.textContent = `${Reader.settings.ttsPitch.toFixed(1)}`;
        }

        const volumeInput = document.getElementById('inputTtsVolume');
        const volume = Reader.settings.ttsVolume != null ? Reader.settings.ttsVolume : 1.0;
        if (volumeInput) {
            volumeInput.value = volume;
            const d = document.getElementById('ttsVolumeDisplay');
            if (d) d.textContent = `${Math.round(volume * 100)}%`;
        }
        if (this.audioPlayer) {
            this.audioPlayer.volume = volume;
        }
    },

    updateSpeedButtons(currentRate) {
        document.querySelectorAll('.speed-btn').forEach(btn => {
            const speed = parseFloat(btn.dataset.speed);
            if (Math.abs(speed - currentRate) < 0.05) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    },

    populateVoiceSelect() {
        const select = document.getElementById('selectVoice') || document.getElementById('selectTtsVoice');
        if (!select) return;

        select.innerHTML = '';

        // 1. Giọng Google chuẩn (Stream MP3 từ Backend - Ổn định nhất)
        const optGoogleCloud = document.createElement('option');
        optGoogleCloud.value = 'google-translate-vi';
        optGoogleCloud.textContent = '🌐 Google Tiếng Việt (Chuẩn - Ổn định nhất)';
        select.appendChild(optGoogleCloud);

        // 2. Giọng Google Local trên Chrome (Dự phòng khi mất mạng)
        if ('speechSynthesis' in window) {
            const localVoices = window.speechSynthesis.getVoices().filter(
                v => v.lang && v.lang.toLowerCase().includes('vi')
            );
            localVoices.forEach(v => {
                const opt = document.createElement('option');
                opt.value = `local:${v.voiceURI}`;
                opt.textContent = `💻 ${v.name} (Trình duyệt)`;
                select.appendChild(opt);
            });
        }

        // Ép về giọng Google chuẩn nếu cấu hình cũ đang lưu tên giọng VieNeu đã bị xóa
        if (!this.selectedVoiceUri || (!this.selectedVoiceUri.startsWith('google') && !this.selectedVoiceUri.startsWith('local:'))) {
            this.selectedVoiceUri = 'google-translate-vi';
        }
        if (this.selectedVoiceUri === 'google-vi-online') {
            this.selectedVoiceUri = 'google-translate-vi';
        }
        select.value = this.selectedVoiceUri;
        if (!select.value) {
            this.selectedVoiceUri = 'google-translate-vi';
            select.value = this.selectedVoiceUri;
        }
    },

    loadVoices() {
        this.populateVoiceSelect();
    },

    // Tải trước các câu tiếp theo (N+1, N+2) vào bộ nhớ RAM blob URL
    prefetchNextSentences(currentIndex, token) {
        if (!this.sentences || !this.sentences.length) return;
        [currentIndex + 1, currentIndex + 2].forEach(nextIdx => {
            if (nextIdx >= this.sentences.length) return;
            if (this.audioBlobCache && this.audioBlobCache.has(nextIdx)) return;

            const rawNext = this.sentences[nextIdx]?.clean || this.sentences[nextIdx]?.text || this.sentences[nextIdx]?.raw || this.sentences[nextIdx];
            const cleanNext = this.sanitizeText(rawNext);
            if (!cleanNext || !/[\p{L}\p{N}]/u.test(cleanNext)) return;

            const url = `/api/tts/speak?text=${encodeURIComponent(cleanNext)}&lang=vi`;
            fetch(url)
                .then(res => res.ok ? res.blob() : Promise.reject())
                .then(blob => {
                    if (token !== this.playToken) return;
                    if (this.audioBlobCache && !this.audioBlobCache.has(nextIdx)) {
                        this.audioBlobCache.set(nextIdx, URL.createObjectURL(blob));
                    }
                })
                .catch(() => {});
        });
    },

    clearAudioBlobCache() {
        if (this.audioBlobCache) {
            for (const url of this.audioBlobCache.values()) {
                try { URL.revokeObjectURL(url); } catch(e) {}
            }
            this.audioBlobCache.clear();
        }
        if (this.nextAudioCache && this.nextAudioCache.blobUrl) {
            try { URL.revokeObjectURL(this.nextAudioCache.blobUrl); } catch(e) {}
            this.nextAudioCache = { index: -1, blobUrl: null };
        }
    },

    cleanOldAudioBlobs(currentIndex) {
        if (!this.audioBlobCache) return;
        for (const [idx, url] of this.audioBlobCache.entries()) {
            if (idx < currentIndex - 1 || idx > currentIndex + 5) {
                try { URL.revokeObjectURL(url); } catch(e) {}
                this.audioBlobCache.delete(idx);
            }
        }
    },

    togglePlayPause() {
        if (this.status === 'PLAYING') {
            this.pause();
        } else if (this.status === 'PAUSED') {
            this.resume();
        } else {
            this.start();
        }
    },

    /** Jump to previous sentence */
    prevParagraph() {
        if (this.sentences.length === 0) return;
        this.currentIndex = Math.max(0, this.currentIndex - 2);
        this.cleanOldAudioBlobs(this.currentIndex);
        if (this.status === 'PLAYING') {
            if (this.audioPlayer) { this.audioPlayer.pause(); this.audioPlayer.removeAttribute('src'); }
            if (this.synth) this.synth.cancel();
            this.playToken++;
            this.speakSentenceQueue();
        }
    },

    /** Jump to next sentence */
    nextParagraph() {
        if (this.sentences.length === 0) return;
        this.currentIndex = Math.min(this.sentences.length - 1, this.currentIndex + 1);
        this.cleanOldAudioBlobs(this.currentIndex);
        if (this.status === 'PLAYING') {
            if (this.audioPlayer) { this.audioPlayer.pause(); this.audioPlayer.removeAttribute('src'); }
            if (this.synth) this.synth.cancel();
            this.playToken++;
            this.speakSentenceQueue();
        }
    },

    /** Sleep Timer — fade out & stop after given minutes */
    setSleepTimer(minutesOrMode) {
        // Clear existing timer
        if (this.sleepTimerTimeout) {
            clearTimeout(this.sleepTimerTimeout);
            this.sleepTimerTimeout = null;
        }
        this.sleepAfterChapter = false;

        const label = document.getElementById('sleepTimerLabel');
        const btn = document.getElementById('btnSleepTimer');

        if (minutesOrMode === '0' || minutesOrMode === 0) {
            if (label) label.textContent = 'Hẹn giờ';
            btn?.classList.remove('active');
            return;
        }

        if (minutesOrMode === 'chapter') {
            this.sleepAfterChapter = true;
            if (label) label.textContent = 'Hết chương';
            btn?.classList.add('active');
            App.showToast('Sẽ tắt TTS sau khi đọc hết chương hiện tại', 'info');
            return;
        }

        const minutes = parseInt(minutesOrMode);
        const ms = minutes * 60 * 1000;
        if (label) label.textContent = `${minutes}p`;
        btn?.classList.add('active');
        App.showToast(`Hẹn giờ tắt sau ${minutes} phút`, 'info');

        this.sleepTimerTimeout = setTimeout(() => {
            this.fadeOutAndStop();
            if (label) label.textContent = 'Hẹn giờ';
            btn?.classList.remove('active');
        }, ms);
    },

    /** Fade volume to 0 over 30 seconds then stop */
    fadeOutAndStop() {
        const steps = 30;
        const interval = 1000;
        let step = 0;
        const originalVolume = this.audioPlayer?.volume ?? 1;

        App.showToast('Hẹn giờ: đang giảm âm lượng...', 'info');

        const fadeInterval = setInterval(() => {
            step++;
            const vol = originalVolume * (1 - step / steps);
            if (this.audioPlayer) this.audioPlayer.volume = Math.max(0, vol);

            if (step >= steps) {
                clearInterval(fadeInterval);
                this.flushSaveProgress?.();
                Reader.flushSaveProgress();
                this.stop();
                // Restore volume
                if (this.audioPlayer) this.audioPlayer.volume = originalVolume;
            }
        }, interval);
    },

    start(startFragment = null) {
        this.stop();
        const startToken = this.playToken;
        this.setStatus('LOADING');

        if (this.startTimeout) {
            clearTimeout(this.startTimeout);
            this.startTimeout = null;
        }

        this.startTimeout = setTimeout(() => {
            this.startTimeout = null;
            if (this.playToken !== startToken) return;

            const pageText = this.extractCurrentPageText();
            if (!pageText || pageText.trim() === '') {
                this.setStatus('IDLE');
                this.updateStatusText('Không tìm thấy văn bản trên trang');
                return;
            }

            const rawSentences = this.chunkTextIntoSentences(pageText);
            if (rawSentences.length === 0) {
                this.setStatus('IDLE');
                this.updateStatusText('Không có câu hợp lệ để đọc');
                return;
            }

            this.sentences = rawSentences.map((s, idx) => ({
                id: idx,
                raw: s,
                clean: this.sanitizeText(s)
            })).filter(s => /[\p{L}\p{N}]/u.test(s.clean));

            this.lastHighlightNode = null;
            
            if (startFragment) {
                const cleanFrag = this.sanitizeText(startFragment).substring(0, 20);
                const foundIdx = this.sentences.findIndex(s => s.clean.includes(cleanFrag));
                this.currentIndex = foundIdx !== -1 ? foundIdx : this.getVisibleSentenceIndex();
            } else {
                this.currentIndex = this.getVisibleSentenceIndex();
            }
            
            if (this.playToken !== startToken) return;
            this.setStatus('PLAYING');
            this.speakSentenceQueue();
        }, 150);
    },

    pause() {
        if (this.selectedVoiceUri.startsWith('local:')) {
            if (this.synth && this.synth.speaking) {
                this.synth.pause();
            }
        } else {
            if (this.audioPlayer) this.audioPlayer.pause();
        }

        this.setStatus('PAUSED');
        this.updateStatusText('Tạm dừng đọc');
    },

    resume() {
        if (this.selectedVoiceUri.startsWith('local:')) {
            if (this.synth && this.synth.paused) {
                this.synth.resume();
            } else {
                this.speakSentenceQueue();
            }
        } else {
            if (this.audioPlayer && this.audioPlayer.src) {
                this.audioPlayer.play();
            } else {
                this.speakSentenceQueue();
            }
        }

        this.setStatus('PLAYING');
        this.updateStatusText('Đang đọc...');
    },

    stop() {
        // Tăng playToken ngay lập tức để vô hiệu hóa MỌI callback/Promise của lần bấm trước
        this.playToken = (this.playToken || 0) + 1;

        // Hủy ngay lập tức request tải audio đang treo (nếu có)
        if (this.currentFetchController) {
            try { this.currentFetchController.abort(); } catch (e) {}
            this.currentFetchController = null;
        }

        if (this.startTimeout) {
            clearTimeout(this.startTimeout);
            this.startTimeout = null;
        }

        // Cancel sleep timer on manual stop
        if (this.sleepTimerTimeout) {
            clearTimeout(this.sleepTimerTimeout);
            this.sleepTimerTimeout = null;
        }
        this.sleepAfterChapter = false;

        this.clearAudioBlobCache();

        if (this.audioPlayer) {
            this.audioPlayer.onended = null;
            this.audioPlayer.onerror = null;
            this.audioPlayer.pause();
            try { this.audioPlayer.currentTime = 0; } catch (e) {}
            this.audioPlayer.removeAttribute('src');
        }

        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
        }

        this.isPlaying = false;
        this.isPaused = false;
        this.currentIndex = 0;
        this.sentences = [];
        this.isTurningPage = false;
        this.clearHighlight();
        this.setStatus('STOPPED');
        this.updateStatusText('Sẵn sàng');
    },

    speakSentenceQueue() {
        if (this.status !== 'PLAYING') return;

        if (this.currentIndex >= this.sentences.length) {
            // Sleep after chapter
            if (this.sleepAfterChapter) {
                this.sleepAfterChapter = false;
                this.fadeOutAndStop();
                return;
            }

            if (Reader.settings.autoContinue !== false && !this.isTurningPage) {
                this.isTurningPage = true;
                this.setStatus('LOADING');
                this.updateStatusText('Tự động chuyển trang...');
                if (Reader.rendition) {
                    Reader.nextChapter(true).then((success) => {
                        this.isTurningPage = false;
                        if (this.status !== 'LOADING') return;
                        if (!success) {
                            this.stop();
                            this.updateStatusText('Đã đọc hết truyện');
                            return;
                        }
                        const unthrottledTimer = window.unthrottledTimeout || window.setTimeout;
                        unthrottledTimer(() => this.start(), 300);
                    }).catch(err => {
                        console.error('Error turning page', err);
                        this.stop();
                    });
                } else {
                    this.stop();
                }
            } else if (!this.isTurningPage) {
                this.stop();
            }
            return;
        }

        const sentenceObj = this.sentences[this.currentIndex];
        const cleanedText = sentenceObj.clean;

        if (!cleanedText || !/[\p{L}\p{N}]/u.test(cleanedText)) {
            this.currentIndex++;
            this.speakSentenceQueue();
            return;
        }

        // Highlight câu đang đọc
        if (Reader.settings.highlightEnabled !== false) {
            this.highlightSentence(sentenceObj.raw);
        }

        this.updateStatusText(`Đang đọc câu ${this.currentIndex + 1}/${this.sentences.length}`);

        const rateInput = document.getElementById('inputTtsRate');
        const pitchInput = document.getElementById('inputTtsPitch');
        const volumeInput = document.getElementById('inputTtsVolume');
        const rate = rateInput ? parseFloat(rateInput.value) : (Reader.settings.ttsRate || 1.0);
        const pitch = pitchInput ? parseFloat(pitchInput.value) : (Reader.settings.ttsPitch || 1.0);
        const volume = volumeInput ? parseFloat(volumeInput.value) : (Reader.settings.ttsVolume != null ? Reader.settings.ttsVolume : 1.0);

        const currentPlayToken = this.playToken;

        if (!this.selectedVoiceUri.startsWith('local:')) {
            // 🌐 Engine 1: Google Tiếng Việt (Stream MP3 qua /api/tts/speak)
            const currentToken = currentPlayToken;
            let audioSrc = `/api/tts/speak?text=${encodeURIComponent(cleanedText)}&lang=vi`;
            let isFromCache = false;

            if (this.audioBlobCache && this.audioBlobCache.has(this.currentIndex)) {
                audioSrc = this.audioBlobCache.get(this.currentIndex);
                isFromCache = true;
            } else if (this.nextAudioCache && this.nextAudioCache.index === this.currentIndex && this.nextAudioCache.blobUrl) {
                audioSrc = this.nextAudioCache.blobUrl;
                isFromCache = true;
            }

            this.audioPlayer.src = audioSrc;
            this.audioPlayer.playbackRate = rate;
            this.audioPlayer.volume = volume;

            this.audioPlayer.onended = () => {
                if (this.playToken !== currentToken) return;
                if (this.status !== 'PLAYING') return;
                this.errorCount = 0;
                this.cleanOldAudioBlobs(this.currentIndex);
                this.currentIndex++;
                this.speakSentenceQueue();
            };

            this.audioPlayer.onerror = (e) => {
                if (this.playToken !== currentToken) return;
                console.error('Audio playback error', e);
                this.errorCount++;
                if (this.errorCount >= 2) {
                    console.warn(`Lỗi tải câu ${this.currentIndex + 1} sau 2 lần thử lại, tự động lướt qua câu tiếp theo.`);
                    this.errorCount = 0;
                    this.cleanOldAudioBlobs(this.currentIndex);
                    this.currentIndex++;
                    setTimeout(() => {
                        if (this.status === 'PLAYING' && this.playToken === currentToken) {
                            this.speakSentenceQueue();
                        }
                    }, 300);
                    return;
                }

                this.updateStatusText(`Kết nối gián đoạn, đang thử lại (${this.errorCount}/2)...`);
                setTimeout(() => {
                    if (this.status === 'PLAYING' && this.playToken === currentToken) {
                        this.speakSentenceQueue();
                    }
                }, 1000);
            };

            const playPromise = this.audioPlayer.play();
            if (playPromise !== undefined) {
                playPromise.then(() => {
                    if (this.playToken !== currentToken) return;
                    // Tải ngầm 2 câu tiếp theo ngay lập tức để chuyển câu mượt mà
                    this.prefetchNextSentences(this.currentIndex, currentToken);
                }).catch(err => {
                    if (this.playToken !== currentToken) return;
                    if (err.name === 'AbortError') return;

                    console.error('Play promise error', err);
                    if (err.name === 'NotAllowedError') {
                        this.stop();
                        this.updateStatusText('Trình duyệt chặn phát âm thanh tự động. Hãy nhấn nút Đọc để tiếp tục.');
                    }
                });
            }

        } else {
            // 💻 Engine 2: Web Speech API Local Voice (Dự phòng ngoại tuyến)
            if (!this.synth) return;
            this.synth.cancel();

            const utterance = new SpeechSynthesisUtterance(cleanedText);
            utterance.lang = 'vi-VN';
            utterance.rate = rate;
            utterance.pitch = pitch;
            utterance.volume = volume;

            const targetVoiceUri = this.selectedVoiceUri.replace('local:', '');
            const localVoices = window.speechSynthesis.getVoices();
            const voice = localVoices.find(v => (v.voiceURI || v.name) === targetVoiceUri);
            if (voice) utterance.voice = voice;

            utterance.onstart = () => {
                if (this.playToken !== currentPlayToken) {
                    this.synth.cancel();
                    return;
                }
                if (Reader.settings.highlightEnabled !== false) {
                    this.highlightSentence(sentenceObj.raw);
                }
            };

            utterance.onend = () => {
                if (this.playToken !== currentPlayToken) return;
                if (this.status !== 'PLAYING') return;
                this.errorCount = 0;
                this.currentIndex++;
                this.speakSentenceQueue();
            };

            utterance.onerror = (e) => {
                if (this.playToken !== currentPlayToken) return;
                console.error('Speech error', e);
                this.errorCount++;
                if (this.errorCount >= 2) {
                    this.errorCount = 0;
                    this.currentIndex++;
                    setTimeout(() => { if (this.status === 'PLAYING') this.speakSentenceQueue(); }, 300);
                    return;
                }
                setTimeout(() => { if (this.status === 'PLAYING') this.speakSentenceQueue(); }, 500);
            };

            this.synth.speak(utterance);
        }
    },

    onPageNavigated() {
        if (this.status === 'PLAYING' || this.status === 'LOADING') {
            this.stop();
            setTimeout(() => {
                this.start();
            }, 300);
        } else {
            this.stop();
        }
    },

    extractCurrentPageText() {
        if (!Reader.rendition) return '';
        try {
            const contents = Reader.rendition.getContents();
            if (contents && contents.length > 0) {
                for (let c of contents) {
                    if (c && c.document && c.document.body) {
                        const txt = c.document.body.innerText || c.document.body.textContent || '';
                        if (txt.trim().length > 0) return txt;
                    }
                }
            }
            const iframes = document.querySelectorAll('#viewer iframe');
            for (let iframe of iframes) {
                try {
                    const doc = iframe.contentDocument || iframe.contentWindow.document;
                    if (doc && doc.body) {
                        const txt = doc.body.innerText || doc.body.textContent || '';
                        if (txt.trim().length > 0) return txt;
                    }
                } catch (err) {}
            }
        } catch (e) {
            console.error('Extract text error', e);
        }
        return '';
    },

    getVisibleSentenceIndex() {
        if (!Reader.rendition) return 0;
        try {
            const contents = Reader.rendition.getContents();
            if (!contents || contents.length === 0) return 0;
            const doc = contents[0].document;
            const win = contents[0].window;
            
            let scrollY = 0;
            if (win.scrollY > 0) {
                scrollY = win.scrollY;
            } else {
                const iframe = document.querySelector('#viewer iframe');
                if (iframe) {
                    const rect = iframe.getBoundingClientRect();
                    if (rect.top < 0) scrollY = -rect.top;
                }
            }

            const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null, false);
            let node;
            let firstVisibleText = '';
            
            while (node = walker.nextNode()) {
                const txt = node.nodeValue.trim();
                if (txt.length > 0) {
                    const parent = node.parentNode;
                    if (parent && parent.nodeType === 1) {
                        const rect = parent.getBoundingClientRect();
                        const absoluteTop = rect.top + win.scrollY; 
                        if (absoluteTop >= scrollY - 50) {
                            firstVisibleText = txt;
                            break;
                        }
                    }
                }
            }

            if (firstVisibleText) {
                const cleanSub = this.sanitizeText(firstVisibleText).substring(0, 20);
                const foundIdx = this.sentences.findIndex(s => s.clean.includes(cleanSub));
                if (foundIdx !== -1) return foundIdx;
            }
        } catch (e) {
            console.error('Error finding visible sentence', e);
        }
        return 0;
    },

    chunkTextIntoSentences(text) {
        if (!text) return [];
        const cleanStr = text.replace(/\r\n/g, '\n').replace(/\n+/g, '.\n');
        
        // Tách câu ưu tiên theo dấu chấm câu tự nhiên (. ? ! ; hoặc xuống dòng)
        const rawMajor = cleanStr.split(/(?<=[.!?;\n])\s+/);
        const result = [];
        const MAX_LEN = 120; // 80 - 120 ký tự lý tưởng cho chất lượng âm thanh Google TTS

        for (let major of rawMajor) {
            let trimmed = major.trim();
            if (!trimmed) continue;

            if (trimmed.length <= MAX_LEN) {
                result.push(trimmed);
                continue;
            }

            // Nếu câu dài hơn MAX_LEN, tách theo dấu ngắt nghỉ (, : - —)
            const subClauses = trimmed.split(/(?<=[,:\-—])\s+/);
            let current = '';

            for (let sub of subClauses) {
                sub = sub.trim();
                if (!sub) continue;

                if (current.length + sub.length + 1 <= MAX_LEN) {
                    current = (current ? current + ' ' : '') + sub;
                } else {
                    if (current) result.push(current);

                    if (sub.length <= MAX_LEN) {
                        current = sub;
                    } else {
                        // Trường hợp mệnh đề không có dấu phẩy vẫn dài hơn MAX_LEN
                        const words = sub.split(/\s+/);
                        current = '';
                        for (let w of words) {
                            if ((current + ' ' + w).length <= MAX_LEN) {
                                current = (current ? current + ' ' : '') + w;
                            } else {
                                if (current) result.push(current);
                                current = w;
                            }
                        }
                    }
                }
            }
            if (current) result.push(current);
        }

        return result;
    },

    applyTextFilters(text) {
        if (!text) return '';
        let rules = [];
        try {
            if (typeof Reader !== 'undefined' && Reader.getReplaceRules) {
                rules = Reader.getReplaceRules();
            } else {
                const raw = localStorage.getItem('dreader_replace_rules');
                if (raw) rules = JSON.parse(raw);
            }
        } catch(e) {}

        if (Array.isArray(rules)) {
            for (const r of rules) {
                if (!r || !r.pattern || r.enabled === false) continue;
                try {
                    const regex = new RegExp(r.pattern, r.flags || 'gi');
                    text = text.replace(regex, r.replacement ?? '');
                } catch(e) {
                    text = text.split(r.pattern).join(r.replacement ?? '');
                }
            }
        }
        return text;
    },

    sanitizeText(text) {
        if (!text) return '';
        let cleaned = this.applyTextFilters(text);
        cleaned = cleaned.replace(/<[^>]*>?/gm, '');

        // Bỏ hẳn dấu ngoặc kép/nháy đơn kiểu chữ - không cần đọc thành lời,
        // và là nguyên nhân phổ biến nhất gây lỗi khi đứng sát dấu chấm/phẩy
        // lúc đóng lời thoại (`."`, `,"` rất hay gặp trong truyện).
        cleaned = cleaned.replace(/["“”‘’„‟«»]/g, '');

        // Dấu ba chấm 1 ký tự "…" -> dấu chấm thường
        cleaned = cleaned.replace(/…/g, '.');

        cleaned = cleaned.replace(/\.{2,}/g, '.');
        // Gộp các cụm dấu câu lặp liền nhau (!!, ??, ,,...) về 1 dấu
        cleaned = cleaned.replace(/([!?,;:])\1+/g, '$1');
        // Bỏ khoảng trắng thừa ngay trước dấu câu (phát sinh sau khi xoá dấu ngoặc kép)
        cleaned = cleaned.replace(/\s+([.,!?;:])/g, '$1');

        cleaned = cleaned.replace(/[\*\_\#\~\`\^]/g, '');
        cleaned = cleaned.replace(/\s+/g, ' ').trim();
        return cleaned;
    },

    scrollToHighlight(spanElement) {
        if (typeof window.checkDReaderAutoScroll === 'function') {
            window.checkDReaderAutoScroll();
            return;
        }
        if (!spanElement) return;

        const iframeDoc = spanElement.ownerDocument;
        const iframeWin = iframeDoc ? iframeDoc.defaultView : null;
        const iframeEl = iframeWin ? iframeWin.frameElement : null;

        // Tìm đúng khung chứa có thanh cuộn của epub.js (.epub-container)
        const scrollContainer = document.querySelector('.epub-container') 
                             || document.getElementById('viewer') 
                             || document.scrollingElement;

        if (!iframeEl || !scrollContainer) {
            spanElement.scrollIntoView({ behavior: 'auto', block: 'center' });
            return;
        }

        // Tọa độ của câu đang đọc so với đỉnh của iframe
        const spanRect = spanElement.getBoundingClientRect();
        // Tọa độ của iframe so với màn hình hiện tại (sẽ mang giá trị âm khi cuộn xuống)
        const iframeRect = iframeEl.getBoundingClientRect();
        // Tọa độ của khung đọc sách trên màn hình
        const containerRect = scrollContainer.getBoundingClientRect();

        // Vị trí thực tế (pixel) của câu đang đọc trên màn hình hiển thị của bạn
        const visualTopInContainer = (iframeRect.top + spanRect.top) - containerRect.top;
        const visualBottomInContainer = visualTopInContainer + spanRect.height;

        // Giới hạn vùng an toàn: cách mép trên 80px và cách mép dưới 180px (tránh thanh Audio dưới đáy)
        const topLimit = 80;
        const bottomLimit = containerRect.height - 180;

        // Nếu câu màu vàng vượt xuống dưới vùng an toàn (hoặc bị khuất ở trên) -> Kéo thanh cuộn ngay!
        if (visualBottomInContainer > bottomLimit || visualTopInContainer < topLimit) {
            // Đưa câu đang đọc về vị trí 1/3 phía trên màn hình để mắt dễ theo dõi các câu tiếp theo
            const targetScrollTop = scrollContainer.scrollTop + visualTopInContainer - (containerRect.height * 0.32);

            const rateInput = document.getElementById('inputTtsRate');
            const currentRate = this.rate || (window.Reader && Reader.settings ? Reader.settings.ttsRate : null) || (rateInput ? parseFloat(rateInput.value) : 1.0);

            scrollContainer.scrollTo({
                top: Math.max(0, targetScrollTop),
                // Ở tốc độ cao (>= 2.0x như 3.0x), cuộn tức thì để chữ không bị trôi chậm hơn tiếng
                behavior: (currentRate && currentRate >= 2.0) ? 'auto' : 'smooth'
            });
        }
    },

    scrollToHighlightSafely(spanElement) {
        this.scrollToHighlight(spanElement);
    },

    highlightSentence(sentenceText) {
        this.clearHighlight();
        if (!Reader.rendition) return;

        try {
            const contents = Reader.rendition.getContents();
            if (!contents || contents.length === 0) return;
            const doc = contents[0].document;

            const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null, false);
            let node;
            const targetSub = sentenceText.substring(0, Math.min(25, sentenceText.length)).trim();

            if (this.lastHighlightNode && doc.contains(this.lastHighlightNode)) {
                while (node = walker.nextNode()) {
                    if (node === this.lastHighlightNode || node.parentNode === this.lastHighlightNode) {
                        break;
                    }
                }
            }

            let found = false;
            while (node = walker.nextNode()) {
                if (node.nodeValue && node.nodeValue.includes(targetSub)) {
                    found = true;
                    break;
                }
            }

            if (!found) {
                const walker2 = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null, false);
                while (node = walker2.nextNode()) {
                    if (node.nodeValue && node.nodeValue.includes(targetSub)) {
                        found = true;
                        break;
                    }
                }
            }

            if (found && node) {
                const parent = node.parentNode;
                if (parent && parent.nodeName !== 'SCRIPT' && parent.nodeName !== 'STYLE') {
                    const span = doc.createElement('span');
                    span.className = 'tts-karaoke-highlight';

                    parent.replaceChild(span, node);
                    span.appendChild(node);
                    this.highlightElement = span;
                    this.currentHighlightSpan = span;
                    this.lastHighlightNode = parent;

                    if (Reader.settings.autoScroll !== false) {
                        this.scrollToHighlight(span);
                    }
                }
            }
        } catch (e) {
            console.error('Highlight error', e);
        }
    },

    clearHighlight(doc) {
        // 1. Lấy toàn bộ document bên trong các iframe đang mở của epub.js và trang chính
        const docs = [];
        if (doc && doc.querySelectorAll) {
            docs.push(doc);
        }
        if (window.Reader && Reader.rendition && typeof Reader.rendition.getContents === 'function') {
            try {
                Reader.rendition.getContents().forEach(content => {
                    if (content && content.document && !docs.includes(content.document)) {
                        docs.push(content.document);
                    }
                });
            } catch (e) {}
        }
        try {
            const iframes = document.querySelectorAll('#viewer iframe, .epub-container iframe');
            iframes.forEach(iframe => {
                const idoc = iframe.contentDocument || iframe.contentWindow?.document;
                if (idoc && !docs.includes(idoc)) docs.push(idoc);
            });
        } catch (e) {}
        if (!docs.includes(document)) docs.push(document);

        // 2. Mở bọc (unwrap) toàn bộ thẻ .tts-karaoke-highlight (KHÔNG gọi parent.normalize())
        docs.forEach(targetDoc => {
            try {
                const highlightedNodes = targetDoc.querySelectorAll('.tts-karaoke-highlight');
                highlightedNodes.forEach(span => {
                    span.classList.remove('tts-karaoke-highlight');
                    const parent = span.parentNode;
                    if (parent) {
                        while (span.firstChild) {
                            parent.insertBefore(span.firstChild, span);
                        }
                        parent.removeChild(span);
                    }
                });
            } catch (e) {
                console.error('Clear highlight error', e);
            }
        });

        this.highlightElement = null;
        this.currentHighlightSpan = null;
    },

    removeHighlight(doc) {
        this.clearHighlight(doc);
    },

    setStatus(newStatus) {
        this.status = newStatus;
        this.isPlaying = (newStatus === 'PLAYING');
        this.isPaused = (newStatus === 'PAUSED');
        this.updateUiState();
    },

    updateUiState() {
        const btnPlay = document.getElementById('btnTtsPlay');
        if (!btnPlay) return;

        const icon = btnPlay.querySelector('i');
        if (!icon) return;

        if (this.status === 'PLAYING') {
            icon.className = 'ri-pause-fill';
            btnPlay.title = 'Tạm dừng (Pause)';
        } else {
            icon.className = 'ri-play-fill';
            btnPlay.title = 'Phát (Play)';
        }
    },

    updateStatusText(msg) {
        const statusElem = document.getElementById('ttsStatus');
        if (statusElem) statusElem.textContent = msg;
    },

    async checkTtsStatus() {
        const badge = document.getElementById('ttsEngineStatusBadge');
        if (!badge) return;
        badge.textContent = '🌐 Google TTS: Chuẩn';
        badge.className = 'tts-engine-badge ready';
    }
};

// Aliasing for compatibility
const TTS = TTSEngine;

/* ==========================================================================
   AUTO-SCROLL CHO D_READER — bám theo câu đang đọc (.tts-karaoke-highlight)
   Nguyên tắc:
   - Thanh cuộn thật của chế độ scrolled-doc là .epub-container (epub.js tạo ra),
     lấy trực tiếp từ Reader.rendition.manager.container, KHÔNG dò đoán.
   - Tính vị trí theo CÂU đang đọc (Range), không theo cả đoạn văn.
   ========================================================================== */
(function initDReaderAutoScroll() {
    let lastSpan = null;
    let rafId = null;

    function getScroller() {
        const mgr = window.Reader && Reader.rendition && Reader.rendition.manager;
        if (mgr && mgr.container) return mgr.container;
        return document.querySelector('#viewer .epub-container') || document.getElementById('viewer');
    }

    // Toạ độ (theo viewport của iframe) của riêng câu đang đọc
    function getSentenceRect(span) {
        try {
            const sent = TTSEngine.sentences[TTSEngine.currentIndex];
            const textNode = span.firstChild;
            if (sent && textNode && textNode.nodeType === 3) {
                const sub = (sent.raw || '').substring(0, 25).trim();
                const start = sub ? textNode.nodeValue.indexOf(sub) : -1;
                if (start >= 0) {
                    const end = Math.min(textNode.nodeValue.length, start + sent.raw.length);
                    const range = span.ownerDocument.createRange();
                    range.setStart(textNode, start);
                    range.setEnd(textNode, end);
                    const rects = range.getClientRects();
                    if (rects.length > 0) {
                        return { top: rects[0].top, bottom: rects[rects.length - 1].bottom };
                    }
                }
            }
        } catch (e) { /* rơi xuống dùng rect của cả span */ }
        const b = span.getBoundingClientRect();
        return { top: b.top, bottom: b.bottom };
    }

    function animateScrollTo(el, targetTop, duration) {
        if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
        const startTop = el.scrollTop;
        const delta = targetTop - startTop;
        if (Math.abs(delta) < 2) return;
        if (duration <= 0) { el.scrollTop = targetTop; return; }
        const t0 = performance.now();
        function step(now) {
            const p = Math.min(1, (now - t0) / duration);
            el.scrollTop = startTop + delta * (1 - Math.pow(1 - p, 3));
            rafId = p < 1 ? requestAnimationFrame(step) : null;
        }
        rafId = requestAnimationFrame(step);
    }

    function checkAndScrollToHighlight(force) {
        if (window.Reader && Reader.settings && Reader.settings.autoScroll === false) return;
        if (TTSEngine.status !== 'PLAYING') return;

        const scroller = getScroller();
        if (!scroller) return;

        for (const iframeEl of scroller.querySelectorAll('iframe')) {
            let doc;
            try { doc = iframeEl.contentDocument; } catch (e) { continue; }
            if (!doc) continue;

            const span = doc.querySelector('.tts-karaoke-highlight');
            if (!span) continue;
            if (force !== true && span === lastSpan) return; // câu này đã xử lý rồi
            lastSpan = span;

            const sr = getSentenceRect(span);
            const iframeTop = iframeEl.getBoundingClientRect().top;
            const scrollerTop = scroller.getBoundingClientRect().top;
            const viewH = scroller.clientHeight;

            // Vị trí câu so với mép trên của khung cuộn
            const top = iframeTop + sr.top - scrollerTop;
            const bottom = iframeTop + sr.bottom - scrollerTop;

            // Vùng an toàn theo tỉ lệ: 12% trên - 72% dưới
            if (bottom > viewH * 0.72 || top < viewH * 0.12) {
                const rate = (window.TTSEngine && TTSEngine.rate) || 1;
                const maxTop = Math.max(0, scroller.scrollHeight - viewH);
                const target = Math.min(maxTop, Math.max(0, scroller.scrollTop + top - viewH * 0.30));
                animateScrollTo(scroller, target, rate >= 2 ? 0 : 160);
            }
            return;
        }
    }

    // TTSEngine.scrollToHighlight() sẽ gọi hàm này ngay khi tô câu mới
    window.checkDReaderAutoScroll = checkAndScrollToHighlight;

    // Lưới an toàn: quét định kỳ phòng khi span được tạo mà không đi qua scrollToHighlight
    setInterval(checkAndScrollToHighlight, 150);
})();

/* ==========================================================================
   BACKGROUND KEEP-ALIVE CHO D_READER (CHỐNG NGẮT KHI CHUYỂN SANG TAB KHÁC)
   ========================================================================== */
(function initDReaderBackgroundKeepAlive() {
    // 1. Tạo Web Worker Timer (Không bao giờ bị Chrome/Edge đóng băng khi ẩn tab)
    const workerCode = `
        const timers = new Map();
        self.onmessage = function(e) {
            const { cmd, id, delay } = e.data;
            if (cmd === 'setTimeout') {
                const ref = setTimeout(() => {
                    timers.delete(id);
                    self.postMessage({ id });
                }, delay || 16);
                timers.set(id, ref);
            } else if (cmd === 'clear') {
                if (timers.has(id)) {
                    clearTimeout(timers.get(id));
                    timers.delete(id);
                }
            }
        };
    `;
    let bgWorker = null;
    const workerCallbacks = new Map();
    let seqId = 1;

    try {
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        bgWorker = new Worker(URL.createObjectURL(blob));
        bgWorker.onmessage = (e) => {
            const cb = workerCallbacks.get(e.data.id);
            if (cb) {
                workerCallbacks.delete(e.data.id);
                try { cb(performance.now()); } catch (err) { console.error(err); }
            }
        };
    } catch (e) {
        console.warn('Web Worker timer not available, fallback to window timers:', e);
    }

    function unthrottledTick(callback, delay = 16) {
        if (bgWorker) {
            const id = seqId++;
            workerCallbacks.set(id, callback);
            bgWorker.postMessage({ cmd: 'setTimeout', id, delay });
            return id;
        }
        return window.setTimeout(() => callback(performance.now()), delay);
    }

    window.unthrottledTimeout = unthrottledTick;

    // 2. Vá requestAnimationFrame & Hàng đợi (Queue) của epub.js khi tab bị ẩn
    const nativeRAF = window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : (cb => setTimeout(cb, 16));
    const nativeCAF = window.cancelAnimationFrame ? window.cancelAnimationFrame.bind(window) : (id => clearTimeout(id));

    window.requestAnimationFrame = function (callback) {
        if (document.hidden) {
            return unthrottledTick(callback, 16);
        }
        return nativeRAF(callback);
    };

    window.cancelAnimationFrame = function (id) {
        if (bgWorker && workerCallbacks.has(id)) {
            workerCallbacks.delete(id);
            bgWorker.postMessage({ cmd: 'clear', id });
            return;
        }
        clearTimeout(id);
        return nativeCAF(id);
    };

    function patchEpubQueues() {
        const reader = (typeof Reader !== 'undefined' && Reader) ? Reader : window.Reader;
        if (!reader || !reader.rendition) return;

        const customTick = (cb) => window.requestAnimationFrame(cb);
        if (reader.rendition.q) {
            reader.rendition.q.tick = customTick;
        }
        if (reader.rendition.manager && reader.rendition.manager.q) {
            reader.rendition.manager.q.tick = customTick;
        }
    }

    // 3. Tạo luồng âm thanh nền siêu nhỏ (Silent AudioContext) để giữ Tab luôn Active
    let audioCtx = null;
    let silentOsc = null;
    let wakeLockSentinel = null;

    function startSilentKeepAlive() {
        try {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (!AudioContextClass) return;

            if (!audioCtx) {
                audioCtx = new AudioContextClass();
            }
            if (audioCtx.state === 'suspended') {
                audioCtx.resume();
            }
            if (!silentOsc) {
                silentOsc = audioCtx.createOscillator();
                const gainNode = audioCtx.createGain();
                // Âm lượng gần bằng 0 (tai không nghe thấy nhưng Chrome vẫn tính là đang phát âm thanh)
                gainNode.gain.setValueAtTime(0.0001, audioCtx.currentTime);
                silentOsc.frequency.setValueAtTime(440, audioCtx.currentTime);
                silentOsc.connect(gainNode);
                gainNode.connect(audioCtx.destination);
                silentOsc.start();
            }
        } catch (e) {}

        // Giữ màn hình/CPU không bị hệ thống đưa vào trạng thái ngủ sâu
        if ('wakeLock' in navigator && !wakeLockSentinel && !document.hidden) {
            navigator.wakeLock.request('screen').then(lock => {
                wakeLockSentinel = lock;
                lock.addEventListener('release', () => { wakeLockSentinel = null; });
            }).catch(() => {});
        }
    }

    function stopSilentKeepAlive() {
        try {
            if (silentOsc) {
                silentOsc.stop();
                silentOsc.disconnect();
                silentOsc = null;
            }
            if (wakeLockSentinel) {
                wakeLockSentinel.release().catch(() => {});
                wakeLockSentinel = null;
            }
        } catch (e) {}
    }

    // 4. Đăng ký MediaSession API (Điều khiển qua phím Media bàn phím & giữ quyền phát nền)
    function updateMediaSessionState(isPlaying) {
        if (!('mediaSession' in navigator)) return;
        try {
            navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
            if (isPlaying) {
                const bookTitle = document.querySelector('#currentBookTitle, .current-book-title, #bookTitle')?.textContent?.trim() || 'D_Reader Audio';
                navigator.mediaSession.metadata = new MediaMetadata({
                    title: bookTitle,
                    artist: 'D_Reader TTS',
                    album: 'Đọc truyện nền'
                });

                const engine = (typeof TTSEngine !== 'undefined' && TTSEngine) ? TTSEngine : window.TTSEngine;
                if (engine) {
                    navigator.mediaSession.setActionHandler('play', () => engine.resume && engine.resume());
                    navigator.mediaSession.setActionHandler('pause', () => engine.pause && engine.pause());
                    navigator.mediaSession.setActionHandler('previoustrack', () => (engine.prevParagraph ? engine.prevParagraph() : (engine.prevSentence && engine.prevSentence())));
                    navigator.mediaSession.setActionHandler('nexttrack', () => (engine.nextParagraph ? engine.nextParagraph() : (engine.nextSentence && engine.nextSentence())));
                }
            }
        } catch (e) {}
    }

    // 5. Mở khóa AudioContext ngay khi người dùng bấm nút Play hoặc click vào trang
    ['click', 'keydown', 'touchstart'].forEach(evtName => {
        document.addEventListener(evtName, () => {
            const engine = (typeof TTSEngine !== 'undefined' && TTSEngine) ? TTSEngine : window.TTSEngine;
            if (engine && (engine.status === 'PLAYING' || engine.status === 'LOADING' || engine.isPlaying) && !engine.isPaused) {
                startSilentKeepAlive();
            } else if (audioCtx && audioCtx.state === 'suspended') {
                audioCtx.resume().catch(() => {});
            }
        }, { passive: true });
    });

    // 6. Khi người dùng chuyển sang tab khác (visibilitychange), ép chạy tiếp hàng đợi epub.js
    document.addEventListener('visibilitychange', () => {
        patchEpubQueues();
        const engine = (typeof TTSEngine !== 'undefined' && TTSEngine) ? TTSEngine : window.TTSEngine;
        if (!engine || (!engine.isPlaying && engine.status !== 'LOADING') || engine.isPaused) return;

        startSilentKeepAlive();

        const reader = (typeof Reader !== 'undefined' && Reader) ? Reader : window.Reader;
        if (reader && reader.rendition) {
            if (reader.rendition.q && reader.rendition.q.running) {
                reader.rendition.q.run();
            }
            if (reader.rendition.manager?.q && reader.rendition.manager.q.running) {
                reader.rendition.manager.q.run();
            }
        }
    });

    // 7. Vòng lặp canh gác chạy ngầm mỗi 800ms bằng Web Worker
    function backgroundWatchdog() {
        patchEpubQueues();
        const engine = (typeof TTSEngine !== 'undefined' && TTSEngine) ? TTSEngine : window.TTSEngine;

        if (engine && (engine.status === 'PLAYING' || engine.status === 'LOADING' || engine.isPlaying) && !engine.isPaused) {
            startSilentKeepAlive();
            updateMediaSessionState(true);

            // Chống lỗi Chrome tự pause speechSynthesis sau 15 giây ở dưới nền
            if ('speechSynthesis' in window && window.speechSynthesis.speaking && window.speechSynthesis.paused) {
                window.speechSynthesis.resume();
            }

            // Nếu đang ở tab ẩn mà hàng đợi epub.js bị kẹt khi chuyển chương -> Kích hoạt chạy tiếp
            if (document.hidden) {
                const reader = (typeof Reader !== 'undefined' && Reader) ? Reader : window.Reader;
                if (reader && reader.rendition?.q && reader.rendition.q._q && reader.rendition.q._q.length > 0 && !reader.rendition.q.paused) {
                    reader.rendition.q.run();
                }
                if (reader && reader.rendition?.manager?.q && reader.rendition.manager.q._q && reader.rendition.manager.q._q.length > 0 && !reader.rendition.manager.q.paused) {
                    reader.rendition.manager.q.run();
                }
            }
        } else {
            stopSilentKeepAlive();
            updateMediaSessionState(false);
        }

        unthrottledTick(backgroundWatchdog, 800);
    }

    unthrottledTick(backgroundWatchdog, 800);
})();

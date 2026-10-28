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
    nextAudioCache: { index: -1, blobUrl: null }, // Blob URL cache for pre-fetched next sentence
    synth: window.speechSynthesis,
    voices: [],
    selectedVoiceUri: 'google-translate-vi',

    // Highlight tracking
    highlightElement: null,
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

    // Hàm tải ngầm câu tiếp theo trong lúc đang đọc câu hiện tại
    prefetchNextSentence(nextIndex, token) {
        if (nextIndex >= this.sentences.length) return;
        const rawNext = this.sentences[nextIndex]?.clean || this.sentences[nextIndex]?.text || this.sentences[nextIndex]?.raw || this.sentences[nextIndex];
        const cleanNext = this.sanitizeText(rawNext);
        if (!cleanNext || !/[\p{L}\p{N}]/u.test(cleanNext)) return;

        if (this.currentFetchController) {
            try { this.currentFetchController.abort(); } catch (e) {}
        }
        this.currentFetchController = new AbortController();

        const url = `/api/tts/speak?text=${encodeURIComponent(cleanNext)}&lang=vi`;
        fetch(url, { signal: this.currentFetchController.signal })
            .then(res => res.ok ? res.blob() : Promise.reject())
            .then(blob => {
                if (token !== this.playToken) return; // Đã đổi luồng đọc khác
                if (this.nextAudioCache.blobUrl) {
                    URL.revokeObjectURL(this.nextAudioCache.blobUrl);
                }
                this.nextAudioCache = {
                    index: nextIndex,
                    blobUrl: URL.createObjectURL(blob)
                };
            })
            .catch(() => {}); // Tải ngầm thất bại thì lúc đọc thật sẽ tải lại sau
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
        if (this.nextAudioCache.blobUrl) {
            URL.revokeObjectURL(this.nextAudioCache.blobUrl);
            this.nextAudioCache = { index: -1, blobUrl: null };
        }
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
        if (this.nextAudioCache.blobUrl) {
            URL.revokeObjectURL(this.nextAudioCache.blobUrl);
            this.nextAudioCache = { index: -1, blobUrl: null };
        }
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

        if (this.nextAudioCache && this.nextAudioCache.blobUrl) {
            URL.revokeObjectURL(this.nextAudioCache.blobUrl);
            this.nextAudioCache = { index: -1, blobUrl: null };
        }

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
                        setTimeout(() => this.start(), 300);
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

            if (this.nextAudioCache && this.nextAudioCache.index === this.currentIndex && this.nextAudioCache.blobUrl) {
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
                if (isFromCache && this.nextAudioCache.blobUrl) {
                    URL.revokeObjectURL(this.nextAudioCache.blobUrl);
                    this.nextAudioCache = { index: -1, blobUrl: null };
                }
                this.currentIndex++;
                this.speakSentenceQueue();
            };

            this.audioPlayer.onerror = (e) => {
                if (this.playToken !== currentToken) return;
                console.error('Audio playback error', e);
                if (isFromCache && this.nextAudioCache.blobUrl) {
                    URL.revokeObjectURL(this.nextAudioCache.blobUrl);
                    this.nextAudioCache = { index: -1, blobUrl: null };
                }
                this.errorCount++;
                if (this.errorCount >= 2) {
                    console.warn(`Lỗi tải câu ${this.currentIndex + 1} sau 2 lần thử lại, tự động lướt qua câu tiếp theo.`);
                    this.errorCount = 0;
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
                    // Ngay khi play thành công cho câu currentIndex, tải ngầm ngay câu tiếp theo
                    this.prefetchNextSentence(this.currentIndex + 1, currentToken);
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

    sanitizeText(text) {
        if (!text) return '';
        let cleaned = text;
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

    scrollToHighlightSafely(spanElement) {
        if (!spanElement) return;

        const rect = spanElement.getBoundingClientRect();
        const win = spanElement.ownerDocument?.defaultView || window;
        const viewHeight = win.innerHeight || document.documentElement.clientHeight;

        // Vùng an toàn: Cách mép trên 15% (tránh thanh Toolbar) và cách mép dưới 28% (tránh thanh Audio)
        const topSafeBound = viewHeight * 0.15;
        const bottomSafeBound = viewHeight * 0.72;

        // Nếu câu đang đọc vẫn nằm gọn trong vùng nhìn thấy an toàn -> KHÔNG cuộn để tránh giật màn hình
        if (rect.top >= topSafeBound && rect.bottom <= bottomSafeBound) {
            return;
        }

        const rateInput = document.getElementById('inputTtsRate');
        const currentRate = this.rate || (window.Reader && Reader.settings ? Reader.settings.ttsRate : null) || (rateInput ? parseFloat(rateInput.value) : 1.0);

        // Nếu tốc độ đọc >= 2.0x (như 3.0x), dùng cuộn tức thì ('auto') thay vì 'smooth' để không bị trễ nhịp
        const scrollBehavior = (currentRate && currentRate >= 2.0) ? 'auto' : 'smooth';

        spanElement.scrollIntoView({
            behavior: scrollBehavior,
            block: 'center',
            inline: 'nearest'
        });
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
                    this.lastHighlightNode = parent;

                    if (Reader.settings.autoScroll !== false) {
                        this.scrollToHighlightSafely(span);
                    }
                }
            }
        } catch (e) {
            console.error('Highlight error', e);
        }
    },

    clearHighlight(doc) {
        let docs = [];
        if (doc) {
            docs.push(doc);
        } else if (window.Reader && Reader.rendition?.getContents) {
            try {
                const contents = Reader.rendition.getContents();
                if (contents && contents.length > 0) {
                    contents.forEach(c => { if (c.document) docs.push(c.document); });
                }
            } catch (e) {}
        }
        if (docs.length === 0) {
            const defaultDoc = window.Reader?.getCurrentIframeDoc ? Reader.getCurrentIframeDoc() : document;
            if (defaultDoc) docs.push(defaultDoc);
        }

        docs.forEach(targetDoc => {
            try {
                const highlights = targetDoc.querySelectorAll('.tts-karaoke-highlight');
                highlights.forEach(span => {
                    const parent = span.parentNode;
                    if (!parent) return;

                    // Đưa toàn bộ text bên trong <span> ra ngoài trả lại vị trí cũ
                    while (span.firstChild) {
                        parent.insertBefore(span.firstChild, span);
                    }
                    parent.removeChild(span);

                    // QUAN TRỌNG NHẤT: Gộp các TextNode bị cắt rời thành 1 TextNode nguyên vẹn như ban đầu
                    parent.normalize();
                });
            } catch (e) {
                console.error('Clear highlight error', e);
            }
        });

        this.highlightElement = null;
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

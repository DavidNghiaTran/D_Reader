/**
 * D_Reader Modular TTS Engine (SRS v2.0 Architecture)
 * State Machine: IDLE | LOADING | PLAYING | PAUSED | STOPPED | ERROR
 */
const TTSEngine = {
    // State
    status: 'IDLE', // IDLE, LOADING, PLAYING, PAUSED, STOPPED, ERROR
    sentences: [],  // [{ id: 0, clean: "...", raw: "..." }]
    currentIndex: 0,
    isTurningPage: false,
    playToken: 0,

    // Audio Providers
    audioPlayer: null, // HTML5 Audio for Google Cloud TTS
    nextAudioPlayer: null,
    synth: window.speechSynthesis,
    voices: [],
    selectedVoiceUri: 'google-vi-online',

    // Web Audio API for VieNeu Realtime Streaming
    audioCtx: null,
    gainNode: null,
    activeSources: [],
    currentStreamReader: null,
    playHead: 0,
    streamSentenceTimer: null,

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
        this.nextAudioPlayer = new Audio();
        this.nextAudioPlayer.onerror = () => {}; // Tránh log lỗi khi prefetch câu sau ở chế độ nền

        this.bindEvents();
        this.loadVoices();

        if (this.synth && this.synth.onvoiceschanged !== undefined) {
            this.synth.onvoiceschanged = () => this.loadVoices();
        }

        // Đảm bảo AudioContext không bị suspend khi tab quay lại hoạt động
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && this.audioCtx && this.audioCtx.state === 'suspended' && this.status === 'PLAYING') {
                this.audioCtx.resume();
            }
        });
    },

    initAudioContext() {
        if (!this.audioCtx) {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (AudioContextClass) {
                this.audioCtx = new AudioContextClass();
                this.gainNode = this.audioCtx.createGain();
                this.gainNode.connect(this.audioCtx.destination);
                const volume = Reader.settings.ttsVolume != null ? Reader.settings.ttsVolume : 1.0;
                this.gainNode.gain.value = volume;
            }
        }
        if (this.audioCtx && this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
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
                this.initAudioContext();
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
                const display = document.getElementById('ttsRateDisplay');
                if (display) display.textContent = `${rate.toFixed(1)}x`;
                Reader.settings.ttsRate = rate;
                Reader.saveSettings();
                if (this.audioPlayer) {
                    this.audioPlayer.playbackRate = rate;
                }
                for (const src of this.activeSources) {
                    try { src.playbackRate.value = rate; } catch (err) {}
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
                if (this.gainNode) {
                    this.gainNode.gain.value = volume;
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
        if (this.gainNode) {
            this.gainNode.gain.value = volume;
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

    loadVoices() {
        const voiceSelect = document.getElementById('selectVoice');
        if (!voiceSelect) return;

        voiceSelect.innerHTML = '';

        // ☁️ Online Google Tiếng Việt
        const onlineOpt = document.createElement('option');
        onlineOpt.value = 'google-vi-online';
        onlineOpt.textContent = '☁️ Google Tiếng Việt (Cloud)';
        voiceSelect.appendChild(onlineOpt);

        const vieneuVoices = {
            "Khuyến nghị": ["Minh Quân Pro", "Mai Anh", "Adam bựa", "Trúc Ly", "Anh Khôi", "Thùy Dung", "Thiền Tâm Đức", "Ngọc Huyền", "Quang Sơn", "Ngọc Trân"],
            "Miền Bắc": ["Minh Đức", "Phạm Tuyên", "Xuân Vĩnh", "Thanh Bình", "Ngọc Linh", "Đoan Trang", "Quỳnh Anh", "Mạnh Dũng"],
            "Miền Trung": ["Quang Sơn", "Ngọc Trân"],
            "Miền Nam": ["Adam", "Thái Sơn", "Thục Đoan", "Minh Triết", "Mỹ Duyên", "Đức Trí", "Kim Thanh", "Thùy Dung"]
        };
        
        for (const group in vieneuVoices) {
            const optgroup = document.createElement('optgroup');
            optgroup.label = `⚡ VieNeu-TTS (Streaming): ${group}`;
            
            for (const voiceName of vieneuVoices[group]) {
                const opt = document.createElement('option');
                opt.value = `vi-VN-${voiceName}`;
                opt.textContent = voiceName;
                optgroup.appendChild(opt);
            }
            voiceSelect.appendChild(optgroup);
        }

        if (Reader.settings.voiceUri) {
            const exists = Array.from(voiceSelect.options).some(o => o.value === Reader.settings.voiceUri);
            if (exists) {
                this.selectedVoiceUri = Reader.settings.voiceUri;
            } else {
                this.selectedVoiceUri = 'google-vi-online';
            }
        } else {
            this.selectedVoiceUri = 'google-vi-online';
        }

        voiceSelect.value = this.selectedVoiceUri;
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
        if (this.status === 'PLAYING') {
            this.stopCurrentStream();
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
        if (this.status === 'PLAYING') {
            this.stopCurrentStream();
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
        const originalVolume = this.gainNode?.gain.value ?? (this.audioPlayer?.volume ?? 1);

        App.showToast('Hẹn giờ: đang giảm âm lượng...', 'info');

        const fadeInterval = setInterval(() => {
            step++;
            const vol = originalVolume * (1 - step / steps);
            if (this.gainNode) this.gainNode.gain.value = Math.max(0, vol);
            if (this.audioPlayer) this.audioPlayer.volume = Math.max(0, vol);

            if (step >= steps) {
                clearInterval(fadeInterval);
                this.flushSaveProgress?.();
                Reader.flushSaveProgress();
                this.stop();
                // Restore volume
                if (this.gainNode) this.gainNode.gain.value = originalVolume;
                if (this.audioPlayer) this.audioPlayer.volume = originalVolume;
            }
        }, interval);
    },

    start(startFragment = null) {
        this.stop();
        this.initAudioContext();
        this.setStatus('LOADING');

        setTimeout(() => {
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
            
            this.setStatus('PLAYING');
            this.speakSentenceQueue();
        }, 150);
    },

    pause() {
        if (this.selectedVoiceUri.startsWith('vi-VN-')) {
            if (this.audioCtx && this.audioCtx.state === 'running') {
                this.audioCtx.suspend();
            }
        } else if (this.selectedVoiceUri === 'google-vi-online') {
            if (this.audioPlayer) this.audioPlayer.pause();
        } else if (this.synth && this.synth.speaking) {
            this.synth.pause();
        }

        this.setStatus('PAUSED');
        this.updateStatusText('Tạm dừng đọc');
    },

    resume() {
        if (this.selectedVoiceUri.startsWith('vi-VN-')) {
            if (this.audioCtx && this.audioCtx.state === 'suspended') {
                this.audioCtx.resume();
            } else {
                this.speakSentenceQueue();
            }
        } else if (this.selectedVoiceUri === 'google-vi-online') {
            if (this.audioPlayer && this.audioPlayer.src) {
                this.audioPlayer.play();
            } else {
                this.speakSentenceQueue();
            }
        } else if (this.synth && this.synth.paused) {
            this.synth.resume();
        } else {
            this.speakSentenceQueue();
        }

        this.setStatus('PLAYING');
        this.updateStatusText('Đang đọc...');
    },

    stopCurrentStream() {
        if (this.currentStreamReader) {
            try { this.currentStreamReader.cancel(); } catch (e) {}
            this.currentStreamReader = null;
        }
        if (this.streamSentenceTimer) {
            clearTimeout(this.streamSentenceTimer);
            this.streamSentenceTimer = null;
        }
        for (const src of this.activeSources) {
            try {
                src.stop();
                src.disconnect();
            } catch (e) {}
        }
        this.activeSources = [];
        this.playHead = 0;
    },

    stop() {
        this.setStatus('STOPPED');
        this.stopCurrentStream();

        // Cancel sleep timer on manual stop
        if (this.sleepTimerTimeout) {
            clearTimeout(this.sleepTimerTimeout);
            this.sleepTimerTimeout = null;
        }
        this.sleepAfterChapter = false;

        if (this.audioCtx && this.audioCtx.state === 'running') {
            this.audioCtx.suspend();
        }

        if (this.audioPlayer) {
            this.audioPlayer.pause();
            this.audioPlayer.removeAttribute('src');
            this.audioPlayer.onended = null;
            this.audioPlayer.onerror = null;
        }
        if (this.nextAudioPlayer) {
            this.nextAudioPlayer.pause();
            this.nextAudioPlayer.removeAttribute('src');
            this.nextAudioPlayer.onended = null;
            this.nextAudioPlayer.onerror = null;
        }

        if (this.synth) this.synth.cancel();

        this.playToken++;
        this.currentIndex = 0;
        this.sentences = [];
        this.isTurningPage = false;
        this.removeHighlight();
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

        if (this.selectedVoiceUri.startsWith('vi-VN-')) {
            // ⚡ Engine 1: VieNeu-TTS Realtime Streaming qua /api/tts/stream
            this.playVieNeuStream(cleanedText, this.selectedVoiceUri, rate, volume, currentPlayToken);

        } else if (this.selectedVoiceUri === 'google-vi-online') {
            // ☁️ Engine 2: Google Tiếng Việt (Cloud) via /api/tts
            const getAudioUrl = (text) => `/api/tts?text=${encodeURIComponent(text)}&lang=vi`;

            this.audioPlayer.preload = 'auto';
            this.nextAudioPlayer.preload = 'auto';

            const expectedUrl = getAudioUrl(cleanedText);
            if (this.audioPlayer.dataset.sentenceText !== cleanedText) {
                this.audioPlayer.src = expectedUrl;
                this.audioPlayer.dataset.sentenceText = cleanedText;
                this.audioPlayer.load();
            }
            
            this.audioPlayer.playbackRate = rate;
            this.audioPlayer.volume = volume;

            this.audioPlayer.onended = () => {
                if (this.playToken !== currentPlayToken) return;
                if (this.status !== 'PLAYING') return;
                this.errorCount = 0;
                this.currentIndex++;
                
                // Đổi buffer cho câu kế
                const temp = this.audioPlayer;
                this.audioPlayer = this.nextAudioPlayer;
                this.nextAudioPlayer = temp;
                
                this.speakSentenceQueue();
            };

            this.audioPlayer.onerror = (e) => {
                if (this.playToken !== currentPlayToken) return;
                console.error('Google audio error', e);
                this.errorCount++;
                if (this.errorCount > 3) {
                    // Nếu Google TTS gặp sự cố, tự động chuyển đổi sang giọng máy Web Speech nếu có
                    const localViVoice = this.voices.find(v => v.lang && v.lang.toLowerCase().includes('vi'));
                    if (localViVoice) {
                        this.updateStatusText('Google TTS mất kết nối. Đang chuyển sang giọng đọc máy...');
                        this.selectedVoiceUri = localViVoice.voiceURI || localViVoice.name;
                        const voiceSelect = document.getElementById('selectVoice');
                        if (voiceSelect) voiceSelect.value = this.selectedVoiceUri;
                        this.errorCount = 0;
                        setTimeout(() => {
                            if (this.status === 'PLAYING' && this.playToken === currentPlayToken) {
                                this.speakSentenceQueue();
                            }
                        }, 500);
                        return;
                    }

                    this.stop();
                    this.updateStatusText('Lỗi kết nối âm thanh Google, vui lòng thử lại sau giây lát');
                    return;
                }
                
                this.updateStatusText(`Kết nối gián đoạn, đang thử lại (${this.errorCount}/3)...`);
                setTimeout(() => {
                    if (this.status === 'PLAYING' && this.playToken === currentPlayToken) {
                        this.speakSentenceQueue();
                    }
                }, 1000);
            };

            // Prefetch câu tiếp theo nếu có
            if (this.currentIndex + 1 < this.sentences.length) {
                const nextSentence = this.sentences[this.currentIndex + 1].clean;
                if (nextSentence && /[\p{L}\p{N}]/u.test(nextSentence)) {
                    if (this.nextAudioPlayer.dataset.sentenceText !== nextSentence) {
                        this.nextAudioPlayer.src = getAudioUrl(nextSentence);
                        this.nextAudioPlayer.dataset.sentenceText = nextSentence;
                        this.nextAudioPlayer.load();
                    }
                }
            }

            const playPromise = this.audioPlayer.play();
            if (playPromise !== undefined) {
                playPromise.catch(err => {
                    if (this.playToken !== currentPlayToken) return;
                    if (err.name === 'AbortError') return;

                    console.error('Play promise error', err);
                    if (err.name === 'NotAllowedError') {
                        this.stop();
                        this.updateStatusText('Trình duyệt chặn phát âm thanh tự động. Hãy nhấn nút Đọc để tiếp tục.');
                    }
                    // Không tự động tăng currentIndex++ khi gặp NotSupportedError (lỗi tải audio),
                    // sự kiện audioPlayer.onerror đã đảm nhiệm việc thử lại để chống nhảy cóc câu văn.
                });
            }

        } else {
            // 💻 Engine 3: Web Speech API Local Voice
            if (!this.synth) return;
            this.synth.cancel();

            const utterance = new SpeechSynthesisUtterance(cleanedText);
            utterance.lang = 'vi-VN';
            utterance.rate = rate;
            utterance.pitch = pitch;
            utterance.volume = volume;

            const voice = this.voices.find(v => (v.voiceURI || v.name) === this.selectedVoiceUri);
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
                if (this.errorCount > 5) {
                    this.stop();
                    this.updateStatusText('Lỗi giọng đọc cục bộ liên tục, đã dừng đọc');
                    return;
                }
                
                if (this.status === 'PLAYING') {
                    this.currentIndex++;
                    setTimeout(() => { this.speakSentenceQueue(); }, 500);
                }
            };

            this.synth.speak(utterance);
        }
    },

    async playVieNeuStream(cleanedText, voice, rate, volume, currentPlayToken) {
        this.initAudioContext();
        if (!this.audioCtx) {
            this.stop();
            this.updateStatusText('Trình duyệt không hỗ trợ Web Audio API');
            return;
        }
        if (this.audioCtx.state === 'suspended') {
            try { await this.audioCtx.resume(); } catch (e) {}
        }

        this.stopCurrentStream();

        const url = `/api/tts/stream?text=${encodeURIComponent(cleanedText)}&voice=${encodeURIComponent(voice)}&lang=vi`;
        let resp;
        try {
            resp = await fetch(url);
        } catch (e) {
            if (this.playToken !== currentPlayToken) return;
            console.error('Fetch stream error', e);
            this.handleVieNeuError(currentPlayToken);
            return;
        }

        if (!resp.ok) {
            if (this.playToken !== currentPlayToken) return;
            console.error('VieNeu Stream HTTP error', resp.status);
            this.handleVieNeuError(currentPlayToken);
            return;
        }

        const reader = resp.body && resp.body.getReader();
        if (!reader) {
            this.handleVieNeuError(currentPlayToken);
            return;
        }
        this.currentStreamReader = reader;

        const SAMPLE_RATE = 48000;
        let headerConsumed = false;
        let leftover = new Uint8Array(0);
        this.playHead = Math.max(this.audioCtx.currentTime + 0.15, this.playHead);

        try {
            while (this.status === 'PLAYING' && this.playToken === currentPlayToken) {
                const { done, value } = await reader.read();
                if (done) break;

                let combined = value;
                if (leftover.length) {
                    combined = new Uint8Array(leftover.length + value.length);
                    combined.set(leftover, 0);
                    combined.set(value, leftover.length);
                    leftover = new Uint8Array(0);
                }

                if (!headerConsumed) {
                    if (combined.length < 44) {
                        leftover = combined;
                        continue;
                    }
                    combined = combined.slice(44); // Bóc tách 44-byte WAV header
                    headerConsumed = true;
                }

                const usable = combined.length - (combined.length % 2);
                if (usable < combined.length) {
                    leftover = combined.slice(usable);
                }

                if (usable > 0) {
                    const chunkPcm = combined.subarray(0, usable);
                    this.schedulePcmChunk(chunkPcm, SAMPLE_RATE, rate, currentPlayToken);
                }
            }
        } catch (err) {
            if (this.playToken !== currentPlayToken) return;
            console.error('Stream reading error', err);
        } finally {
            this.currentStreamReader = null;
        }

        if (this.playToken !== currentPlayToken || this.status !== 'PLAYING') return;

        // Đợi các chunk đã lên lịch phát xong trước khi chuyển sang câu tiếp theo
        const remainingTime = Math.max(0, this.playHead - this.audioCtx.currentTime);
        const waitMs = (remainingTime * 1000) / rate + 60;

        this.streamSentenceTimer = setTimeout(() => {
            if (this.playToken !== currentPlayToken || this.status !== 'PLAYING') return;
            this.errorCount = 0;
            this.currentIndex++;
            this.speakSentenceQueue();
        }, waitMs);
    },

    schedulePcmChunk(uint8arr, sampleRate, rate, currentPlayToken) {
        if (!uint8arr || uint8arr.length === 0 || !this.audioCtx) return;
        if (this.playToken !== currentPlayToken || this.status !== 'PLAYING') return;

        // Chuyển đổi PCM16 LE -> Float32
        const view = new DataView(uint8arr.buffer, uint8arr.byteOffset, uint8arr.byteLength);
        const n = Math.floor(uint8arr.byteLength / 2);
        const float32 = this.audioCtx.createBuffer(1, n, sampleRate);
        const ch = float32.getChannelData(0);
        for (let i = 0; i < n; i++) {
            const val = view.getInt16(i * 2, true);
            ch[i] = Math.max(-1, Math.min(1, val / 32768));
        }

        const src = this.audioCtx.createBufferSource();
        src.buffer = float32;
        src.playbackRate.value = rate;
        src.connect(this.gainNode);

        const chunkDuration = float32.duration / rate;
        const startAt = Math.max(this.playHead, this.audioCtx.currentTime + 0.05);
        src.start(startAt);
        this.playHead = startAt + chunkDuration;

        this.activeSources.push(src);
        src.onended = () => {
            const idx = this.activeSources.indexOf(src);
            if (idx !== -1) this.activeSources.splice(idx, 1);
        };
    },

    handleVieNeuError(currentPlayToken) {
        this.errorCount++;
        if (this.errorCount > 3) {
            this.stop();
            this.updateStatusText('Lỗi kết nối VieNeu-TTS Streaming Server, vui lòng kiểm tra server');
            return;
        }

        this.updateStatusText(`VieNeu đang bận, thử lại (${this.errorCount}/3)...`);
        setTimeout(() => {
            if (this.status === 'PLAYING' && this.playToken === currentPlayToken) {
                this.speakSentenceQueue();
            }
        }, 1200);
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
        const MAX_LEN = 120; // 80 - 120 ký tự lý tưởng cho chất lượng âm thanh Google TTS và tốc độ VieNeu

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

    highlightSentence(sentenceText) {
        this.removeHighlight();
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
                        span.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                }
            }
        } catch (e) {
            console.error('Highlight error', e);
        }
    },

    removeHighlight() {
        if (this.highlightElement && this.highlightElement.parentNode) {
            try {
                const parent = this.highlightElement.parentNode;
                while (this.highlightElement.firstChild) {
                    parent.insertBefore(this.highlightElement.firstChild, this.highlightElement);
                }
                parent.removeChild(this.highlightElement);
                parent.normalize();
            } catch (e) {}
            this.highlightElement = null;
        }
    },

    setStatus(newStatus) {
        this.status = newStatus;
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
    }
};

// Aliasing for compatibility
const TTS = TTSEngine;

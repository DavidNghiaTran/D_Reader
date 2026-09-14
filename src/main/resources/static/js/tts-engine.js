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
    audioPlayer: null, // HTML5 Audio for Online Cloud Engine
    nextAudioPlayer: null, // For Double Buffering (Prefetch)
    synth: window.speechSynthesis,
    voices: [],
    selectedVoiceUri: 'google-vi-online',

    // Highlight tracking
    highlightElement: null,
    lastHighlightNode: null,
    errorCount: 0,

    init() {
        this.audioPlayer = new Audio();
        this.nextAudioPlayer = new Audio();

        this.bindEvents();
        this.loadVoices();

        if (this.synth && this.synth.onvoiceschanged !== undefined) {
            this.synth.onvoiceschanged = () => this.loadVoices();
        }
    },

    bindEvents() {
        const btnPlay = document.getElementById('btnTtsPlay');
        const btnPause = document.getElementById('btnTtsPause');
        const btnStop = document.getElementById('btnTtsStop');
        const voiceSelect = document.getElementById('selectVoice');
        const rateInput = document.getElementById('inputTtsRate');
        const pitchInput = document.getElementById('inputTtsPitch');

        if (btnPlay) btnPlay.addEventListener('click', () => this.togglePlayPause());
        if (btnPause) btnPause.addEventListener('click', () => this.pause());
        if (btnStop) btnStop.addEventListener('click', () => this.stop());

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

        // 🌟 Edge TTS Tiếng Việt (Recommended Default)
        const edgeHoaiMy = document.createElement('option');
        edgeHoaiMy.value = 'vi-VN-HoaiMyNeural';
        edgeHoaiMy.textContent = '🌟 Hoài My (Edge TTS - Nữ)';
        voiceSelect.appendChild(edgeHoaiMy);

        const edgeNamMinh = document.createElement('option');
        edgeNamMinh.value = 'vi-VN-NamMinhNeural';
        edgeNamMinh.textContent = '🌟 Nam Minh (Edge TTS - Nam)';
        voiceSelect.appendChild(edgeNamMinh);

        // ☁️ Online Google Tiếng Việt
        const onlineOpt = document.createElement('option');
        onlineOpt.value = 'google-vi-online';
        onlineOpt.textContent = '☁️ Google Tiếng Việt (Cloud)';
        voiceSelect.appendChild(onlineOpt);

        if (this.synth) {
            this.voices = this.synth.getVoices() || [];
            this.voices.forEach(voice => {
                const option = document.createElement('option');
                option.value = voice.voiceURI || voice.name;
                option.textContent = `💻 ${voice.name} (${voice.lang})`;
                voiceSelect.appendChild(option);
            });
        }

        if (Reader.settings.voiceUri) {
            const exists = Array.from(voiceSelect.options).some(o => o.value === Reader.settings.voiceUri);
            if (exists) {
                this.selectedVoiceUri = Reader.settings.voiceUri;
            } else {
                this.selectedVoiceUri = 'vi-VN-HoaiMyNeural';
            }
        } else {
            this.selectedVoiceUri = 'vi-VN-HoaiMyNeural';
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

    start(startFragment = null) {
        this.stop();
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
            }));

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
        if (this.selectedVoiceUri === 'google-vi-online' || this.selectedVoiceUri.startsWith('vi-VN-')) {
            if (this.audioPlayer) this.audioPlayer.pause();
        } else if (this.synth && this.synth.speaking) {
            this.synth.pause();
        }

        this.setStatus('PAUSED');
        this.updateStatusText('Tạm dừng đọc');
    },

    resume() {
        if (this.selectedVoiceUri === 'google-vi-online' || this.selectedVoiceUri.startsWith('vi-VN-')) {
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

    stop() {
        this.setStatus('STOPPED');
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
        if (this.synth) {
            this.synth.cancel();
        }

        this.playToken++; // Invalidate pending callbacks
        this.currentIndex = 0;
        this.sentences = [];
        this.isTurningPage = false;
        this.removeHighlight();
        this.updateStatusText('Sẵn sàng');
    },

    speakSentenceQueue() {
        if (this.status !== 'PLAYING') return;

        if (this.currentIndex >= this.sentences.length) {
            if (Reader.settings.autoContinue !== false && !this.isTurningPage) {
                this.isTurningPage = true;
                this.setStatus('LOADING');
                this.updateStatusText('Tự động chuyển trang...');
                if (Reader.rendition) {
                    const hrefBefore = Reader.currentHref;
                    Reader.nextPage(true).then(() => {
                        this.isTurningPage = false;
                        if (this.status !== 'LOADING') return;
                        if (Reader.currentHref === hrefBefore) {
                            // không sang chương mới được -> đã hết truyện
                            this.stop();
                            this.updateStatusText('Đã đọc hết truyện');
                            return;
                        }
                        this.start();
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

        if (!cleanedText || cleanedText.trim() === '') {
            this.currentIndex++;
            this.speakSentenceQueue();
            return;
        }

        // Highlight sentence immediately on queue start
        if (Reader.settings.highlightEnabled !== false) {
            this.highlightSentence(sentenceObj.raw);
        }

        this.updateStatusText(`Đang đọc câu ${this.currentIndex + 1}/${this.sentences.length}`);

        const rateInput = document.getElementById('inputTtsRate');
        const pitchInput = document.getElementById('inputTtsPitch');
        const rate = rateInput ? parseFloat(rateInput.value) : (Reader.settings.ttsRate || 1.0);
        const pitch = pitchInput ? parseFloat(pitchInput.value) : (Reader.settings.ttsPitch || 1.0);

        const currentPlayToken = this.playToken;

        if (this.selectedVoiceUri === 'google-vi-online' || this.selectedVoiceUri.startsWith('vi-VN-')) {
            // 🌟 Engine 1: Online Cloud via Spring Boot Proxy (/api/tts)
            
            // Generate URL helper
            const getAudioUrl = (text) => {
                let voiceParam = '';
                if (this.selectedVoiceUri.startsWith('vi-VN-')) {
                    voiceParam = `&voice=${this.selectedVoiceUri}`;
                }
                return `/api/tts?text=${encodeURIComponent(text)}&lang=vi${voiceParam}`;
            };

            // If audioPlayer doesn't have the correct src (not prefetched), load it
            const expectedUrl = getAudioUrl(cleanedText);
            if (!this.audioPlayer.src || !this.audioPlayer.src.includes(encodeURIComponent(cleanedText))) {
                this.audioPlayer.src = expectedUrl;
            }
            
            this.audioPlayer.playbackRate = rate;

            this.audioPlayer.onended = () => {
                if (this.playToken !== currentPlayToken) return;
                if (this.status !== 'PLAYING') return;
                this.errorCount = 0; // Reset on success
                this.currentIndex++;
                
                // Swap buffers for seamless transition
                const temp = this.audioPlayer;
                this.audioPlayer = this.nextAudioPlayer;
                this.nextAudioPlayer = temp;
                
                this.speakSentenceQueue();
            };

            this.audioPlayer.onerror = (e) => {
                if (this.playToken !== currentPlayToken) return;
                console.error('Online audio proxy error', e);
                this.errorCount++;
                if (this.errorCount > 5) {
                    this.stop();
                    this.updateStatusText('Lỗi kết nối âm thanh liên tục, đã dừng đọc');
                    return;
                }
                
                // Fallback to local TTS
                if (this.synth) {
                    console.log('Falling back to local TTS engine');
                    this.selectedVoiceUri = ''; // clear to trigger local fallback
                    this.speakSentenceQueue();
                    return;
                }
                
                if (this.status === 'PLAYING') {
                    this.currentIndex++;
                    setTimeout(() => { this.speakSentenceQueue(); }, 500);
                }
            };

            const playPromise = this.audioPlayer.play();
            if (playPromise !== undefined) {
                playPromise.then(() => {
                    if (this.playToken !== currentPlayToken) return;
                    // PREFETCH N+1 while N is playing
                    if (this.currentIndex + 1 < this.sentences.length) {
                        const nextSentence = this.sentences[this.currentIndex + 1].clean;
                        if (nextSentence && nextSentence.trim() !== '') {
                            this.nextAudioPlayer.src = getAudioUrl(nextSentence);
                            this.nextAudioPlayer.load(); // Load in background
                        }
                    }
                }).catch(err => {
                    if (this.playToken !== currentPlayToken) return;
                    if (err.name === 'AbortError') return; // Ignore intentional aborts

                    console.error('Play promise error', err);
                    if (this.synth) {
                        console.log('Falling back to local TTS engine');
                        this.selectedVoiceUri = ''; 
                        this.speakSentenceQueue();
                        return;
                    }
                    if (this.status === 'PLAYING') {
                        this.currentIndex++;
                        setTimeout(() => { this.speakSentenceQueue(); }, 500);
                    }
                });
            }

        } else {
            // 💻 Engine 2: Web Speech API Local Voice
            if (!this.synth) return;
            this.synth.cancel();

            const utterance = new SpeechSynthesisUtterance(cleanedText);
            utterance.lang = 'vi-VN';
            utterance.rate = rate;
            utterance.pitch = pitch;

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
                this.errorCount = 0; // Reset on success
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
        const raw = cleanStr.split(/(?<=[.!?;\n])\s+/);
        const result = [];
        for (let s of raw) {
            let trimmed = s.trim();
            if (trimmed.length > 0) {
                if (trimmed.length > 150) {
                    const subWords = trimmed.split(/\s+/);
                    let subChunk = '';
                    for (let w of subWords) {
                        if ((subChunk + ' ' + w).length > 150) {
                            if (subChunk.trim().length > 0) result.push(subChunk.trim());
                            subChunk = w;
                        } else {
                            subChunk = (subChunk + ' ' + w).trim();
                        }
                    }
                    if (subChunk.trim().length > 0) result.push(subChunk.trim());
                } else {
                    result.push(trimmed);
                }
            }
        }
        return result;
    },

    sanitizeText(text) {
        if (!text) return '';
        let cleaned = text;
        cleaned = cleaned.replace(/<[^>]*>?/gm, '');
        cleaned = cleaned.replace(/\.{2,}/g, '.');
        cleaned = cleaned.replace(/[\*\_\#\~\`\^]/g, '');
        
        // Vietnamese Text Normalization
        // Normalize dates (e.g. 20/11/2024 -> 20 tháng 11 năm 2024)
        cleaned = cleaned.replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g, '$1 tháng $2 năm $3');
        cleaned = cleaned.replace(/\b(\d{1,2})\/(\d{1,2})\b/g, '$1 tháng $2');
        
        // Normalize abbreviations
        cleaned = cleaned.replace(/\bTS\.\s/g, 'Tiến sĩ ');
        cleaned = cleaned.replace(/\bThS\.\s/g, 'Thạc sĩ ');
        cleaned = cleaned.replace(/\bGS\.\s/g, 'Giáo sư ');
        cleaned = cleaned.replace(/\bPGS\.\s/g, 'Phó giáo sư ');
        cleaned = cleaned.replace(/\bBS\.\s/g, 'Bác sĩ ');
        cleaned = cleaned.replace(/\bTP\.\s/g, 'Thành phố ');
        cleaned = cleaned.replace(/\bQ\.\s/g, 'Quận ');
        
        // Currency
        cleaned = cleaned.replace(/\b(\d+[\d\.\,]*)\s*đ\b/gi, '$1 đồng');
        cleaned = cleaned.replace(/\b(\d+[\d\.\,]*)\s*vnđ\b/gi, '$1 Việt Nam đồng');

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
                    span.style.backgroundColor = 'var(--tts-highlight-bg, #fef08a)';
                    span.style.color = 'var(--tts-highlight-text, #0f172a)';
                    span.style.borderRadius = '3px';
                    span.style.padding = '2px 4px';

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
                parent.normalize(); // Merge adjacent text nodes back together
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

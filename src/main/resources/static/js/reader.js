/**
 * D_Reader — Reader Module v3.0
 * Features: Zen mode, 2-tab sidebar, full keyboard shortcuts,
 *           scrolled-doc / paginated modes, iframe CSS injection,
 *           MediaSession API, keepalive progress save.
 */
const Reader = {
    bookId: null,
    book: null,
    rendition: null,
    bookData: null,
    currentCfi: '',
    currentHref: '',
    currentChapterTitle: '',
    progressPercentage: 0,
    saveProgressTimeout: null,
    sessionStartTime: null,
    isTtsNavigating: false,
    clickReadTimeout: null,
    bookmarks: [],
    readMode: 'scrolled-doc',
    zenMode: false,
    settings: {
        theme: 'dark',
        fontSize: 22,
        fontFamily: 'sans-serif',
        lineHeight: 1.8,
        ttsRate: 1.0,
        ttsPitch: 1.0,
        ttsVolume: 1.0,
        voiceUri: 'google-translate-vi',
        autoScroll: true,
        autoContinue: true,
        highlightEnabled: true,
        contentWidth: 'wide',
    },

    init() {
        this.bindEvents();
        this.loadSettings();
    },

    bindEvents() {
        // Back to library
        document.getElementById('btnBackToLibrary')?.addEventListener('click', () => {
            this.flushSaveProgress();
            TTS.stop();
            this.exitZenMode();
            const topBar = document.getElementById('topReadingProgress');
            if (topBar) topBar.style.width = '0%';
            App.switchView('libraryView');
            Library.loadBooks();
        });

        // Flush progress on hide/unload
        window.addEventListener('pagehide', () => this.flushSaveProgress());
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') this.flushSaveProgress();
        });

        // TOC sidebar toggle
        document.getElementById('btnToggleToc')?.addEventListener('click', (e) => {
            e.stopPropagation();
            document.getElementById('tocSidebar')?.classList.toggle('active');
        });

        document.getElementById('btnCloseToc')?.addEventListener('click', (e) => {
            e.stopPropagation();
            document.getElementById('tocSidebar')?.classList.remove('active');
        });

        // Close sidebar on outside click
        document.addEventListener('click', (e) => {
            const sidebar = document.getElementById('tocSidebar');
            const btnToc = document.getElementById('btnToggleToc');
            if (sidebar?.classList.contains('active')) {
                if (!sidebar.contains(e.target) && !btnToc?.contains(e.target)) {
                    sidebar.classList.remove('active');
                }
            }
        });

        // 2-Tab switching
        document.querySelectorAll('.toc-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.toc-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.toc-panel').forEach(p => p.classList.remove('active'));
                tab.classList.add('active');
                const panelId = tab.dataset.panel;
                document.getElementById(panelId)?.classList.add('active');
            });
        });

        // TOC search filter
        document.getElementById('inputTocSearch')?.addEventListener('input', (e) => {
            const q = e.target.value.toLowerCase().trim();
            document.querySelectorAll('#tocList .toc-item').forEach(li => {
                li.style.display = li.textContent.toLowerCase().includes(q) ? '' : 'none';
            });
        });

        // Theme
        document.getElementById('selectTheme')?.addEventListener('change', (e) => {
            this.setTheme(e.target.value);
            this.saveSettings();
        });

        // Font family
        document.getElementById('selectFont')?.addEventListener('change', (e) => {
            this.updateFontFamily(e.target.value);
        });

        // Font size
        document.getElementById('btnFontLess')?.addEventListener('click', () => {
            this.setFontSize((this.settings.fontSize || 22) - 2);
        });
        document.getElementById('btnFontMore')?.addEventListener('click', () => {
            this.setFontSize((this.settings.fontSize || 22) + 2);
        });

        // Read mode (scrolled-doc / paginated)
        document.getElementById('selectReadMode')?.addEventListener('change', (e) => {
            this.readMode = e.target.value;
            this.saveSettings();
            if (this.bookId) this.rebuildRendition();
        });

        // Content width (standard / wide / full)
        document.getElementById('selectContentWidth')?.addEventListener('change', (e) => {
            this.setContentWidth(e.target.value);
            this.saveSettings();
        });

        // Navigation buttons
        document.getElementById('prevPageBtn')?.addEventListener('click', () => this.prevPage());
        document.getElementById('nextPageBtn')?.addEventListener('click', () => this.nextPage());

        // Bookmark
        document.getElementById('btnAddBookmark')?.addEventListener('click', () => this.addBookmark());

        // Fullscreen
        document.getElementById('btnFullscreen')?.addEventListener('click', () => this.toggleFullscreen());

        // Minimize / Expand Floating Audio Bar
        document.getElementById('btnToggleMiniAudio')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleAudioBarMinimize();
        });
        document.getElementById('ttsBar')?.addEventListener('click', (e) => {
            const bar = document.getElementById('ttsBar');
            if (bar?.classList.contains('minimized')) {
                this.toggleAudioBarMinimize(false);
            }
        });

        // Auto-hide top bars on scroll (and restore on scroll up or mouse near top edge)
        let lastScrollY = window.scrollY;
        window.addEventListener('scroll', () => {
            if (App.currentView !== 'readerView') return;
            const currentScrollY = window.scrollY;
            const isScrollingDown = currentScrollY > lastScrollY && currentScrollY > 60;
            this.handleTopBarsVisibility(isScrollingDown);
            lastScrollY = currentScrollY;
        }, { passive: true });

        document.addEventListener('mousemove', (e) => {
            if (App.currentView !== 'readerView') return;
            if (e.clientY < 60) {
                this.handleTopBarsVisibility(false);
            }
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => this.handleKeyNavigation(e));
    },

    async loadSettings() {
        try {
            const res = await fetch('/api/settings');
            if (res.ok) {
                const data = await res.json();
                this.settings = { ...this.settings, ...data };
                this.applySettingsToUi();
            }
        } catch (e) {
            console.error('Failed to load settings', e);
        }
    },

    applySettingsToUi() {
        const theme = this.settings.theme || 'dark';
        document.documentElement.setAttribute('data-theme', theme);

        const themeSelect = document.getElementById('selectTheme');
        if (themeSelect) themeSelect.value = theme;

        const fontType = localStorage.getItem('dreader_font') || this.settings.fontFamily || 'sans-serif';
        this.settings.fontFamily = fontType;
        const fontSelect = document.getElementById('selectFont');
        if (fontSelect) fontSelect.value = fontType;

        const savedSize = parseInt(localStorage.getItem('dreader_size'), 10) || this.settings.fontSize || 22;
        this.settings.fontSize = savedSize;
        const fontDisplay = document.getElementById('fontSizeDisplay');
        if (fontDisplay) fontDisplay.textContent = `${this.settings.fontSize}px`;

        const viewport = document.getElementById('viewer') || document.getElementById('reader-viewport');
        if (viewport) {
            viewport.style.setProperty('--reader-font-family', this.getFontFamilyCss(this.settings.fontFamily));
            viewport.style.setProperty('--reader-font-size', `${this.settings.fontSize}px`);
        }

        if (this.settings.flowMode) {
            this.readMode = this.settings.flowMode;
            const modeSelect = document.getElementById('selectReadMode');
            if (modeSelect) modeSelect.value = this.settings.flowMode;
        }

        if (typeof TTSEngine !== 'undefined' && TTSEngine.syncControlsFromSettings) {
            TTSEngine.syncControlsFromSettings();
        }

        const savedWidth = localStorage.getItem('dreader_content_width') || this.settings.contentWidth || 'wide';
        this.setContentWidth(savedWidth);

        const savedAudioMin = localStorage.getItem('dreader_audio_minimized') === 'true';
        if (savedAudioMin) {
            this.toggleAudioBarMinimize(true);
        }
    },

    getFontFamilyCss(fontType) {
        const fontMap = {
            'sans-serif': "'Be Vietnam Pro', system-ui, -apple-system, sans-serif",
            'serif': "'Literata', 'Merriweather', Georgia, serif",
            'lora': "'Lora', Georgia, serif"
        };
        return fontMap[fontType] || fontMap['serif'];
    },

    updateFontFamily(fontType) {
        this.settings.fontFamily = fontType || 'sans-serif';
        const fontCss = this.getFontFamilyCss(this.settings.fontFamily);
        const viewport = document.getElementById('viewer') || document.getElementById('reader-viewport');
        if (viewport) {
            viewport.style.setProperty('--reader-font-family', fontCss);
        }
        localStorage.setItem('dreader_font', this.settings.fontFamily);
        this.applyRenditionTheme();
        if (this.rendition) {
            try {
                const contents = this.rendition.getContents();
                contents.forEach(c => this.injectIframeStyles(c));
            } catch (e) {}
        }
        this.saveSettings();
    },

    getContentWidthConfig() {
        const widthConfig = {
            standard: { viewerMax: '1000px', bodyMax: '1000px', padding: '36px 20px 140px 20px', columns: 1 },
            wide:     { viewerMax: '1350px', bodyMax: '1350px', padding: '36px 24px 140px 24px', columns: 1 },
            extra:    { viewerMax: '1600px', bodyMax: '1600px', padding: '36px 28px 140px 28px', columns: 1 },
            full:     { viewerMax: '96vw',   bodyMax: '95vw',   padding: '36px 24px 140px 24px', columns: 1 },
            columns:  { viewerMax: '1500px', bodyMax: '1450px', padding: '36px 36px 140px 36px', columns: 2 }
        };
        return widthConfig[this.settings.contentWidth || 'wide'] || widthConfig.wide;
    },

    setContentWidth(widthMode) {
        this.settings.contentWidth = widthMode || 'wide';
        localStorage.setItem('dreader_content_width', this.settings.contentWidth);
        const cfg = this.getContentWidthConfig();
        document.documentElement.style.setProperty('--reader-max-width', cfg.viewerMax);
        const viewport = document.getElementById('viewer') || document.getElementById('reader-viewport');
        if (viewport) {
            viewport.style.setProperty('--reader-max-width', cfg.viewerMax);
        }

        const select = document.getElementById('selectContentWidth');
        if (select) select.value = this.settings.contentWidth;

        this.applyRenditionTheme();
        if (this.rendition) {
            try {
                const contents = this.rendition.getContents();
                contents.forEach(c => this.injectIframeStyles(c));
                this.rendition.resize();
            } catch (e) {}
        }
    },

    async saveSettings() {
        try {
            await fetch('/api/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    theme: this.settings.theme,
                    fontSize: this.settings.fontSize,
                    fontFamily: this.settings.fontFamily,
                    lineHeight: this.settings.lineHeight,
                    ttsRate: this.settings.ttsRate,
                    ttsPitch: this.settings.ttsPitch,
                    ttsVolume: this.settings.ttsVolume,
                    voiceUri: this.settings.voiceUri,
                    autoScroll: this.settings.autoScroll,
                    autoContinue: this.settings.autoContinue,
                    highlightEnabled: this.settings.highlightEnabled,
                    flowMode: this.readMode,
                    contentWidth: this.settings.contentWidth,
                })
            });
        } catch (e) {
            console.error('Save settings error', e);
        }
    },

    async loadBook(bookId, autoPlayTts = false) {
        this.bookId = bookId;
        this.sessionStartTime = Date.now();
        this.currentCfi = '';
        this.currentHref = '';

        const viewer = document.getElementById('viewer');
        if (!viewer) return;
        viewer.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-secondary);gap:0.75rem;font-size:0.95rem;"><i class="ri-loader-4-line ri-spin" style="font-size:1.75rem;color:var(--accent);"></i>Đang nạp nội dung sách...</div>';

        // Show TTS bar
        const ttsBar = document.getElementById('ttsBar');
        if (ttsBar) ttsBar.classList.remove('tts-hidden');

        try {
            const res = await fetch(`/api/books/${bookId}`);
            if (!res.ok) throw new Error('Không thể tải thông tin sách');
            this.book = await res.json();

            const titleElem = document.getElementById('currentBookTitle');
            if (titleElem) titleElem.textContent = this.book.title;

            const topBar = document.getElementById('topReadingProgress');
            if (topBar && this.book?.progressPercentage) {
                topBar.style.width = `${Number(this.book.progressPercentage).toFixed(1)}%`;
            }

            const ttsLabel = document.getElementById('ttsBookLabel');
            if (ttsLabel) ttsLabel.textContent = this.book.title;

            // Load EPUB as ArrayBuffer
            const resFile = await fetch(`/api/books/${bookId}/file`);
            if (!resFile.ok) throw new Error('Không thể tải tệp EPUB từ server');
            const arrayBuffer = await resFile.arrayBuffer();

            const ePubFactory = (typeof ePub === 'function') ? ePub : (window.ePub?.default ?? window.ePub);
            this.bookData = ePubFactory(arrayBuffer);

            viewer.innerHTML = '';

            await this.buildRendition(viewer);

            // Navigate to saved CFI or start
            const targetCfi = this.book.currentCfi?.trim() || undefined;
            await this.rendition.display(targetCfi);

            // Load TOC
            this.bookData.loaded.navigation.then(toc => this.renderToc(toc));

            // Load bookmarks
            this.loadBookmarks();

            // Generate locations for progress %
            this.bookData.ready
                .then(() => this.bookData.locations.generate(1000))
                .then(() => this.updateProgressFromLocation());

            // Relocation event
            this.rendition.on('relocated', (location) => {
                this.currentCfi = location.start.cfi;
                this.updateProgressFromLocation();
                this.debouncedSaveProgress();

                if (this.currentHref !== location.start.href) {
                    this.currentHref = location.start.href;
                    this.syncTocActiveState();
                    if (TTSEngine.status === 'PLAYING' && !this.isTtsNavigating) {
                        TTSEngine.onPageNavigated();
                    }
                }
            });

            // Click-to-read
            this.rendition.on('click', (e) => this.handleReaderClick(e));

            // Setup MediaSession
            this.setupMediaSession();

            if (autoPlayTts) {
                setTimeout(() => {
                    TTSEngine.initAudioContext();
                    TTSEngine.start();
                }, 800);
            }

        } catch (err) {
            console.error(err);
            viewer.innerHTML = `<div style="color:var(--danger);padding:2rem;text-align:center;"><i class="ri-error-warning-line" style="font-size:2rem;display:block;margin-bottom:1rem;"></i>Lỗi nạp sách: ${err.message}</div>`;
        }
    },

    /**
     * Làm sạch và đồng bộ cấu trúc HTML từ bất kỳ nguồn EPUB nào
     * @param {string} rawHtml - Chuỗi HTML thô trích xuất từ file EPUB
     * @returns {string} - Chuỗi HTML sạch, chuẩn hóa cho việc đọc chữ
     */
    normalizeEpubContent(rawHtml) {
        if (!rawHtml || typeof rawHtml !== 'string') return rawHtml || '';

        // 1. Chuyển đổi các thẻ <br><br> liên tiếp (thường gặp ở EPUB truyện chữ) thành thẻ đóng/mở <p>
        let preProcessed = rawHtml.replace(/(<br\s*\/?>\s*){2,}/gi, '</p><p>');

        const parser = new DOMParser();
        const doc = parser.parseFromString(preProcessed, 'text/html');

        // 2. Xóa toàn bộ thẻ gây nhiễu giao diện từ file EPUB gốc
        const forbiddenTags = doc.querySelectorAll('style, link, meta, script, font, center');
        forbiddenTags.forEach(tag => {
            if (tag.tagName.toLowerCase() === 'font' || tag.tagName.toLowerCase() === 'center') {
                // Giữ lại chữ bên trong thẻ <font> hoặc <center>, chỉ xóa vỏ thẻ
                tag.replaceWith(...tag.childNodes);
            } else {
                tag.remove();
            }
        });

        // 3. Xóa sạch inline style, class, id, face, size trên TẤT CẢ các phần tử
        const allElements = doc.body.querySelectorAll('*');
        const attrsToRemove = ['style', 'class', 'id', 'face', 'size', 'color', 'align', 'bgcolor', 'width'];
        
        allElements.forEach(el => {
            attrsToRemove.forEach(attr => el.removeAttribute(attr));

            // Chuyển các thẻ <div> chứa text đơn thuần thành thẻ <p> để đồng bộ khoảng cách đoạn
            if (el.tagName.toLowerCase() === 'div' && !el.querySelector('p, div, h1, h2, h3, table')) {
                const p = doc.createElement('p');
                p.innerHTML = el.innerHTML;
                el.replaceWith(p);
            }
        });

        // 4. Loại bỏ các đoạn văn rỗng và khoảng trắng thừa (&nbsp; đầu dòng không đồng nhất)
        doc.body.querySelectorAll('p, span').forEach(el => {
            // Xóa khoảng trắng cứng (\u00A0) và dấu cách thừa ở đầu/cuối đoạn
            const cleanText = el.textContent.replace(/^[\s\u00A0\u3000]+|[\s\u00A0\u3000]+$/g, '');
            if (!cleanText && !el.querySelector('img, svg')) {
                el.remove(); // Xóa các thẻ <p>&nbsp;</p> gây giãn dòng bất thường
            } else if (el.children.length === 0) {
                el.textContent = cleanText;
            }
        });

        // 5. Nhận diện tự động tiêu đề chương nếu file EPUB không dùng thẻ <h1>/<h2>
        const firstParagraph = doc.body.querySelector('p');
        if (firstParagraph && /^(Chương|Hồi|Quyển|Chapter)\s+\d+/i.test(firstParagraph.textContent.trim())) {
            const h2 = doc.createElement('h2');
            h2.className = 'chapter-title';
            h2.textContent = firstParagraph.textContent.trim();
            firstParagraph.replaceWith(h2);
        } else {
            const existingHeading = doc.body.querySelector('h1, h2, h3');
            if (existingHeading) {
                existingHeading.classList.add('chapter-title');
            }
        }

        return doc.body.innerHTML;
    },

    async buildRendition(viewer) {
        const flow = this.readMode || 'scrolled-doc';
        this.rendition = this.bookData.renderTo('viewer', {
            manager: 'default',
            flow: flow,
            width: '100%',
            height: '100%',
            ...(flow === 'paginated' ? { spread: 'auto' } : {})
        });

        // Hook xử lý nội dung chương trước và khi render lên màn hình
        this.rendition.hooks.content.register((contents) => {
            // 1. Xóa toàn bộ thẻ style/link trong head của iframe EPUB gốc
            try {
                contents.document.head.querySelectorAll('link[rel="stylesheet"], style').forEach(el => el.remove());
            } catch (e) {}

            // 2. Làm sạch và chuẩn hóa toàn bộ HTML từ EPUB (lột style, font rác, br br, &nbsp;)
            try {
                if (contents.document.body) {
                    contents.document.body.innerHTML = this.normalizeEpubContent(contents.document.body.innerHTML);
                }
            } catch (e) {
                console.error('Lỗi chuẩn hóa nội dung EPUB:', e);
            }

            // 3. Bơm hệ thống CSS Variables & phông chữ chuẩn vào iframe
            this.injectIframeStyles(contents);

            // 4. Gắn các sự kiện cuộn, chuột và bàn phím tương tác
            this.attachIframeInteractions(contents);
        });

        this.applyRenditionTheme();
    },

    /** Gắn tương tác cuộn, phím tắt và chỉ báo tiến độ vào iframe */
    attachIframeInteractions(contents) {
        if (!contents || !contents.window || !contents.document) return;

        let lastIframeScrollY = 0;
        contents.window.addEventListener('scroll', () => {
            if (App.currentView !== 'readerView') return;
            const currentY = contents.window.scrollY;
            const isScrollingDown = currentY > lastIframeScrollY && currentY > 60;
            this.handleTopBarsVisibility(isScrollingDown);

            // Cập nhật Reading Progress Bar mỏng trên đầu màn hình theo độ cuộn chương
            const scrollHeight = contents.document.body.scrollHeight - contents.window.innerHeight;
            if (scrollHeight > 0) {
                const scrollPct = Math.min(100, Math.max(0, (currentY / scrollHeight) * 100));
                const topBar = document.getElementById('topReadingProgress');
                if (topBar) {
                    topBar.style.width = `${scrollPct.toFixed(1)}%`;
                }
            }

            lastIframeScrollY = currentY;
        }, { passive: true });

        contents.document.addEventListener('mousemove', (e) => {
            if (App.currentView !== 'readerView') return;
            if (e.clientY < 60) {
                this.handleTopBarsVisibility(false);
            }
        });

        contents.document.addEventListener('keydown', (e) => this.handleKeyNavigation(e));
    },

    /** Điều khiển ẩn/hiện thanh Header và Toolbar khi cuộn đọc */
    handleTopBarsVisibility(hide) {
        if (this.zenMode && !hide) return;
        const topBars = document.querySelectorAll('.app-header, .reader-toolbar');
        topBars.forEach(bar => {
            bar.classList.toggle('top-bars-hidden', !!hide);
        });
    },

    /** Cuộn trang mượt mà theo tỷ lệ chiều cao (mặc định 85%) */
    scrollPage(direction = 1) {
        try {
            const contents = this.rendition?.getContents();
            if (contents && contents.length > 0) {
                const win = contents[0].window;
                const amount = win.innerHeight * 0.85 * direction;
                win.scrollBy({ top: amount, behavior: 'smooth' });
                return;
            }
        } catch (e) {}
        window.scrollBy({ top: window.innerHeight * 0.85 * direction, behavior: 'smooth' });
    },

    /** Xử lý phím tắt chuyên dụng cho việc đọc sách */
    handleKeyNavigation(e) {
        if (App.currentView !== 'readerView') return;
        const tag = (document.activeElement?.tagName || '').toUpperCase();
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

        switch (e.key) {
            case 'ArrowLeft':
                e.preventDefault();
                this.prevPage();
                break;
            case 'ArrowRight':
                e.preventDefault();
                this.nextPage();
                break;
            case ' ':
                e.preventDefault();
                if (typeof TTSEngine !== 'undefined' && (TTSEngine.status === 'PLAYING' || TTSEngine.status === 'PAUSED')) {
                    TTSEngine.initAudioContext();
                    TTSEngine.togglePlayPause();
                } else {
                    this.scrollPage(e.shiftKey ? -1 : 1);
                }
                break;
            case 'b':
            case 'B':
                e.preventDefault();
                this.addBookmark();
                break;
            case 'm':
            case 'M':
                e.preventDefault();
                document.getElementById('tocSidebar')?.classList.toggle('active');
                break;
            case 'f':
            case 'F':
                e.preventDefault();
                this.toggleFullscreen();
                break;
            case 'z':
            case 'Z':
                e.preventDefault();
                this.toggleZenMode();
                break;
            case 'Escape':
                document.getElementById('tocSidebar')?.classList.remove('active');
                if (this.zenMode) this.exitZenMode();
                break;
        }
    },

    /** Thu gọn / Mở rộng thanh Audio khi người dùng muốn đọc chữ tĩnh */
    toggleAudioBarMinimize(forceState) {
        const ttsBar = document.getElementById('ttsBar');
        if (!ttsBar) return;
        const isMin = typeof forceState === 'boolean' ? forceState : !ttsBar.classList.contains('minimized');
        ttsBar.classList.toggle('minimized', isMin);
        localStorage.setItem('dreader_audio_minimized', isMin ? 'true' : 'false');

        const miniBtn = document.getElementById('btnToggleMiniAudio');
        if (miniBtn) {
            miniBtn.innerHTML = isMin
                ? '<i class="ri-headphone-line"></i>'
                : '<i class="ri-arrow-down-s-line"></i>';
            miniBtn.title = isMin ? 'Mở rộng thanh Audio (🎧)' : 'Thu gọn thanh Audio';
        }
    },

    /** Rebuild rendition when read mode changes (preserves CFI position) */
    async rebuildRendition() {
        const saveCfi = this.currentCfi;
        const viewer = document.getElementById('viewer');
        if (!viewer || !this.bookData) return;

        if (this.rendition) {
            try { this.rendition.destroy(); } catch (e) {}
        }
        viewer.innerHTML = '';

        await this.buildRendition(viewer);
        await this.rendition.display(saveCfi || undefined);

        this.bookData.loaded.navigation.then(toc => this.renderToc(toc));
        this.rendition.on('relocated', (location) => {
            this.currentCfi = location.start.cfi;
            this.updateProgressFromLocation();
            this.debouncedSaveProgress();
            if (this.currentHref !== location.start.href) {
                this.currentHref = location.start.href;
                this.syncTocActiveState();
                if (TTSEngine.status === 'PLAYING' && !this.isTtsNavigating) {
                    TTSEngine.onPageNavigated();
                }
            }
        });
        this.rendition.on('click', (e) => this.handleReaderClick(e));
    },

    /** Inject font / theme styles into the EPUB iframe */
    injectIframeStyles(contents) {
        const theme = this.settings.theme || 'dark';
        const themeMap = {
            dark:  { bg: '#16161a', text: '#d4d4d8', heading: '#a5b4fc', highlight: 'rgba(129,140,248,0.28)', border: 'rgba(255,255,255,0.08)' },
            light: { bg: '#f8f9fa', text: '#27272a', heading: '#1e293b', highlight: 'rgba(250,204,21,0.38)', border: 'rgba(0,0,0,0.08)' },
            sepia: { bg: '#f4ecd8', text: '#433422', heading: '#2c1e10', highlight: 'rgba(217,119,6,0.28)', border: 'rgba(59,46,30,0.12)' },
            mint:  { bg: '#cce8cf', text: '#1b2e1e', heading: '#0f1f12', highlight: 'rgba(132,169,83,0.35)', border: 'rgba(40,54,24,0.12)' },
            green: { bg: '#cce8cf', text: '#1b2e1e', heading: '#0f1f12', highlight: 'rgba(132,169,83,0.35)', border: 'rgba(40,54,24,0.12)' },
        };
        const t = themeMap[theme] || themeMap.dark;
        const fontFamily = this.getFontFamilyCss(this.settings.fontFamily);
        const cfg = this.getContentWidthConfig();

        // Nhúng phông chữ Google Fonts trực tiếp vào head của iframe
        const fontLinkId = 'dreader-google-fonts';
        if (!contents.document.getElementById(fontLinkId)) {
            const fontLink = contents.document.createElement('link');
            fontLink.id = fontLinkId;
            fontLink.rel = 'stylesheet';
            fontLink.href = 'https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:ital,wght@0,400;0,500;0,600;1,400&family=Literata:ital,opsz,wght@0,7..72,400;0,7..72,600;1,7..72,400&family=Lora:ital,wght@0,400;0,600;1,400&family=Merriweather:ital,wght@0,400;0,700;1,400&display=swap';
            contents.document.head.appendChild(fontLink);
        }

        contents.document.body.classList.add('reader-content');
        if (cfg.columns === 2) {
            contents.document.body.classList.add('two-column');
        } else {
            contents.document.body.classList.remove('two-column');
        }

        // Bơm stylesheet hoàn chỉnh với CSS Variables & ÉP ĐỒNG BỘ 100%
        const styleId = 'dreader-injected-styles';
        let styleEl = contents.document.getElementById(styleId);
        if (!styleEl) {
            styleEl = contents.document.createElement('style');
            styleEl.id = styleId;
            contents.document.head.appendChild(styleEl);
        }

        styleEl.textContent = `
            :root, html, body {
                --reader-font-family: ${fontFamily};
                --reader-font-size: ${this.settings.fontSize || 22}px;
                --reader-line-height: ${this.settings.lineHeight || 1.8};
                --reader-para-spacing: 0.9em;
                --reader-max-width: ${cfg.bodyMax};
                --reader-text-indent: 1.5em;
                --reader-bg: ${t.bg};
                --reader-text: ${t.text};
                --reader-heading: ${t.heading};
                --tts-highlight-bg: ${t.highlight};
            }
            html, body {
                box-sizing: border-box !important;
                background-color: var(--reader-bg) !important;
                color: var(--reader-text) !important;
                font-family: var(--reader-font-family) !important;
                font-size: var(--reader-font-size) !important;
                line-height: var(--reader-line-height) !important;
                width: 100% !important;
                max-width: var(--reader-max-width) !important;
                margin: 0 auto !important;
                padding: ${cfg.padding} !important;
                overflow-x: hidden !important;
                word-wrap: break-word !important;
                overflow-wrap: break-word !important;
            }
            body.two-column {
                column-count: 2 !important;
                column-gap: 60px !important;
                column-rule: 1px solid ${t.border} !important;
            }
            body *:not(h1):not(h2):not(h3):not(.tts-karaoke-highlight) {
                font-family: inherit !important;
                font-size: inherit !important;
                line-height: inherit !important;
                color: inherit !important;
                background-color: transparent !important;
            }
            p {
                margin-top: 0 !important;
                margin-bottom: var(--reader-para-spacing) !important;
                text-align: justify !important;
                text-indent: var(--reader-text-indent) !important;
                letter-spacing: 0.01em !important;
            }
            h1, h2, h3, .chapter-title {
                font-family: var(--reader-font-family) !important;
                font-size: calc(var(--reader-font-size) * 1.35) !important;
                line-height: 1.4 !important;
                color: var(--reader-heading) !important;
                font-weight: 700 !important;
                text-align: center !important;
                text-indent: 0 !important;
                margin: 0.5em 0 1.8em 0 !important;
                column-span: all !important;
            }
            img, svg {
                max-width: 100% !important;
                height: auto !important;
                display: block !important;
                margin: 1.5em auto !important;
            }
            a {
                color: var(--reader-heading) !important;
                text-decoration: underline !important;
            }
            .tts-karaoke-highlight {
                background-color: #facc15 !important;
                color: #0f172a !important;
                font-weight: inherit !important; /* Không đổi sang bold để tránh làm giãn chữ rớt dòng */
                border-radius: 4px !important;
                box-shadow: 0 0 0 2px #facc15 !important; /* Dùng box-shadow thay cho padding để không chiếm diện tích DOM */
                transition: background-color 0.2s ease !important;
            }
            ::-webkit-scrollbar {
                width: 7px !important;
                height: 7px !important;
            }
            ::-webkit-scrollbar-track {
                background: transparent !important;
            }
            ::-webkit-scrollbar-thumb {
                background: rgba(255, 255, 255, 0.2) !important;
                border-radius: 4px !important;
            }
            ::-webkit-scrollbar-thumb:hover {
                background: rgba(255, 255, 255, 0.38) !important;
            }
        `;

        contents.addStylesheetRules({
            'html, body': {
                'box-sizing': 'border-box !important',
                'background-color': `${t.bg} !important`,
                'color': `${t.text} !important`,
                'font-family': `${fontFamily} !important`,
                'font-size': `${this.settings.fontSize || 22}px !important`,
                'line-height': `${this.settings.lineHeight || 1.8} !important`,
                'width': '100% !important',
                'max-width': `${cfg.bodyMax} !important`,
                'margin': '0 auto !important',
                'padding': `${cfg.padding} !important`,
            },
            'body *:not(h1):not(h2):not(h3):not(.tts-karaoke-highlight)': {
                'font-family': 'inherit !important',
                'font-size': 'inherit !important',
                'line-height': 'inherit !important',
                'color': `${t.text} !important`,
                'background': 'transparent !important',
            },
            'p': {
                'margin-top': '0 !important',
                'margin-bottom': '0.9em !important',
                'text-align': 'justify !important',
                'text-indent': '1.5em !important',
                'letter-spacing': '0.01em !important',
            },
            'h1, h2, h3, .chapter-title': {
                'font-family': `${fontFamily} !important`,
                'font-size': `${Math.round((this.settings.fontSize || 22) * 1.35)}px !important`,
                'line-height': '1.4 !important',
                'color': `${t.heading} !important`,
                'font-weight': '700 !important',
                'text-align': 'center !important',
                'text-indent': '0 !important',
                'margin': '0.5em 0 1.8em 0 !important',
            },
            '.tts-karaoke-highlight': {
                'background-color': '#facc15 !important',
                'color': '#0f172a !important',
                'font-weight': 'inherit !important',
                'border-radius': '4px !important',
                'box-shadow': '0 0 0 2px #facc15 !important',
            }
        });
    },

    applyRenditionTheme() {
        if (!this.rendition) return;
        const theme = this.settings.theme || 'dark';
        const themeMap = {
            dark:  { bg: '#16161a', text: '#d4d4d8', heading: '#a5b4fc' },
            light: { bg: '#f8f9fa', text: '#27272a', heading: '#1e293b' },
            sepia: { bg: '#f4ecd8', text: '#433422', heading: '#2c1e10' },
            mint:  { bg: '#cce8cf', text: '#1b2e1e', heading: '#0f1f12' },
            green: { bg: '#cce8cf', text: '#1b2e1e', heading: '#0f1f12' },
        };
        const t = themeMap[theme] || themeMap.dark;
        const fontFamily = this.getFontFamilyCss(this.settings.fontFamily);
        const cfg = this.getContentWidthConfig();

        this.rendition.themes.register('custom', {
            'html, body': {
                'box-sizing': 'border-box !important',
                'background-color': `${t.bg} !important`,
                'color': `${t.text} !important`,
                'font-family': `${fontFamily} !important`,
                'font-size': `${this.settings.fontSize || 22}px !important`,
                'line-height': `${this.settings.lineHeight || 1.8} !important`,
                'width': '100% !important',
                'max-width': `${cfg.bodyMax} !important`,
                'margin': '0 auto !important',
                'padding': `${cfg.padding} !important`,
                'overflow-x': 'hidden !important',
                'word-wrap': 'break-word !important',
                'overflow-wrap': 'break-word !important',
            },
            'body *:not(h1):not(h2):not(h3):not(.tts-karaoke-highlight)': {
                'color': `${t.text} !important`,
                'background': 'transparent !important',
                'max-width': '100% !important',
                'box-sizing': 'border-box !important',
                'word-wrap': 'break-word !important',
                'overflow-wrap': 'break-word !important',
            },
        });
        this.rendition.themes.select('custom');
    },

    setTheme(theme) {
        this.settings.theme = theme;
        document.documentElement.setAttribute('data-theme', theme);
        const viewport = document.getElementById('viewer') || document.getElementById('reader-viewport');
        if (viewport) {
            viewport.setAttribute('data-theme', theme);
        }
        this.applyRenditionTheme();
        // Re-inject iframe styles for current content
        if (this.rendition) {
            try {
                const contents = this.rendition.getContents();
                contents.forEach(c => this.injectIframeStyles(c));
            } catch (e) {}
        }
    },

    setFontSize(size) {
        this.settings.fontSize = Math.min(40, Math.max(14, size));
        const display = document.getElementById('fontSizeDisplay');
        if (display) display.textContent = `${this.settings.fontSize}px`;
        const viewport = document.getElementById('viewer') || document.getElementById('reader-viewport');
        if (viewport) {
            viewport.style.setProperty('--reader-font-size', `${this.settings.fontSize}px`);
        }
        localStorage.setItem('dreader_size', this.settings.fontSize);
        this.applyRenditionTheme();
        if (this.rendition) {
            try {
                const contents = this.rendition.getContents();
                contents.forEach(c => this.injectIframeStyles(c));
            } catch (e) {}
        }
        this.saveSettings();
    },

    /** Render Table of Contents */
    renderToc(toc) {
        const container = document.getElementById('tocList');
        if (!container) return;
        container.innerHTML = '';

        if (!toc?.toc?.length) {
            container.innerHTML = '<li class="toc-item" style="color:var(--text-muted);">Không có mục lục</li>';
            return;
        }

        toc.toc.forEach(item => {
            const li = document.createElement('li');
            li.className = 'toc-item';
            li.textContent = item.label.trim();
            li.dataset.href = item.href;
            li.addEventListener('click', (e) => {
                e.stopPropagation();
                this.rendition.display(item.href);
                document.querySelectorAll('.toc-item').forEach(el => el.classList.remove('active'));
                li.classList.add('active');
                document.getElementById('tocSidebar')?.classList.remove('active');
            });
            container.appendChild(li);
        });
    },

    syncTocActiveState() {
        if (!this.currentHref) return;
        let activeTitle = '';
        document.querySelectorAll('#tocList .toc-item').forEach(li => {
            const match = li.dataset.href && (
                li.dataset.href === this.currentHref ||
                this.currentHref.includes(li.dataset.href) ||
                li.dataset.href.includes(this.currentHref.split('#')[0])
            );
            li.classList.toggle('active', !!match);
            if (match && !activeTitle) {
                activeTitle = li.textContent.trim();
            }
        });
        if (activeTitle) {
            this.currentChapterTitle = activeTitle;
        }
    },

    /** Load bookmarks from API */
    async loadBookmarks() {
        try {
            const res = await fetch(`/api/bookmarks/book/${this.bookId}`);
            if (res.ok) {
                this.bookmarks = await res.json();
                this.renderBookmarks();
            }
        } catch (e) {
            console.error('Failed to load bookmarks', e);
        }
    },

    renderBookmarks() {
        const container = document.getElementById('bookmarkList');
        if (!container) return;
        container.innerHTML = '';

        if (this.bookmarks.length === 0) {
            container.innerHTML = '<li class="toc-item" style="color:var(--text-muted);"><i class="ri-bookmark-line" style="margin-right:0.4rem;"></i>Chưa có dấu trang</li>';
            return;
        }

        this.bookmarks.forEach(bm => {
            const li = document.createElement('li');
            li.className = 'toc-item';
            li.style.display = 'flex';
            li.style.alignItems = 'flex-start';
            li.style.gap = '0.5rem';

            const colorMap = { yellow: '#FBBF24', green: '#34D399', pink: '#F472B6', default: 'var(--accent)' };
            const dotColor = colorMap[bm.color] || colorMap.default;

            li.innerHTML = `
                <span style="width:8px;height:8px;border-radius:50%;background:${dotColor};flex-shrink:0;margin-top:0.4rem;"></span>
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:600;font-size:0.85rem;">${App.escapeHtml(bm.name)}</div>
                    ${bm.chapterTitle ? `<div style="font-size:0.72rem;color:var(--text-muted);">${App.escapeHtml(bm.chapterTitle)}</div>` : ''}
                    ${bm.selectedText ? `<div style="font-size:0.72rem;color:var(--text-secondary);font-style:italic;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">"${App.escapeHtml(bm.selectedText.substring(0, 60))}…"</div>` : ''}
                </div>
                <button class="btn-close-toc" style="flex-shrink:0;" title="Xóa dấu trang">
                    <i class="ri-delete-bin-line" style="color:var(--danger);"></i>
                </button>
            `;

            li.addEventListener('click', () => this.rendition?.display(bm.cfi));

            li.querySelector('button')?.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (confirm('Xóa dấu trang này?')) {
                    await fetch(`/api/bookmarks/${bm.id}`, { method: 'DELETE' });
                    this.loadBookmarks();
                }
            });

            container.appendChild(li);
        });
    },

    async addBookmark() {
        if (!this.currentCfi || !this.bookId) return;

        const name = prompt('Nhập tên cho dấu trang:', 'Dấu trang mới');
        if (!name) return;

        const chapterTitle = document.querySelector('#tocList .toc-item.active')?.textContent?.trim() || '';

        // Grab the first visible sentence as selectedText
        let selectedText = '';
        try {
            const contents = this.rendition?.getContents();
            if (contents?.length) {
                const body = contents[0].document.body;
                selectedText = (body?.innerText || '').trim().substring(0, 150);
            }
        } catch (e) {}

        try {
            await fetch('/api/bookmarks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    bookId: this.bookId,
                    name,
                    cfi: this.currentCfi,
                    chapterTitle,
                    selectedText,
                    color: 'yellow',
                })
            });
            App.showToast('Đã thêm dấu trang!', 'success');
            this.loadBookmarks();
            // Switch to bookmark tab
            document.getElementById('tabBookmark')?.click();
            document.getElementById('tocSidebar')?.classList.add('active');
        } catch (e) {
            App.showToast('Lỗi thêm dấu trang', 'error');
        }
    },

    getCurrentIframeDoc() {
        try {
            const contents = this.rendition?.getContents();
            if (contents && contents.length > 0 && contents[0].document) {
                return contents[0].document;
            }
        } catch (e) {}
        return null;
    },

    /** Click-to-read functionality with 220ms debounce, selection cleaning and DOM normalization */
    handleReaderClick(e) {
        try {
            const doc = this.getCurrentIframeDoc();
            if (!doc) return;

            // Bỏ qua nếu người dùng đang bôi đen một đoạn văn dài để tạo Bookmark
            const selection = (doc.defaultView || window).getSelection();
            if (selection && selection.toString().trim().length > 25) return;

            // Chặn việc ấn đúp chuột bắn 2 lệnh start() liên tiếp cách nhau vài chục ms
            if (this.clickReadTimeout) {
                clearTimeout(this.clickReadTimeout);
                this.clickReadTimeout = null;
            }

            const clientX = e.clientX;
            const clientY = e.clientY;
            const targetEl = e.target;

            this.clickReadTimeout = setTimeout(() => {
                this.clickReadTimeout = null;

                // 1. Xóa vệt bôi đen từ do thao tác double-click tạo ra
                try {
                    const sel = (doc.defaultView || window).getSelection();
                    if (sel) sel.removeAllRanges();
                    if (window.getSelection) window.getSelection().removeAllRanges();
                } catch (err) {}

                // 2. Gỡ highlight cũ và normalize() toàn bộ đoạn văn TRƯỚC KHI tính offset click
                if (window.TTSEngine && typeof TTSEngine.clearHighlight === 'function') {
                    TTSEngine.clearHighlight(doc);
                } else if (window.TTSEngine && typeof TTSEngine.removeHighlight === 'function') {
                    TTSEngine.removeHighlight(doc);
                }

                // 3. Lúc này TextNode đã nguyên vẹn 100%, mới lấy tọa độ ký tự nơi click
                this.handleParagraphClickToSpeak(doc, targetEl, clientX, clientY);
            }, 220); // Đợi 220ms để gom cú click đúp thành 1 lần kích hoạt duy nhất
        } catch (err) {
            console.error('Click-to-read error', err);
        }
    },

    handleParagraphClickToSpeak(doc, targetEl, clientX, clientY) {
        try {
            let node = null, offset = 0;
            if (doc.caretPositionFromPoint) {
                const pos = doc.caretPositionFromPoint(clientX, clientY);
                if (pos) { node = pos.offsetNode; offset = pos.offset; }
            } else if (doc.caretRangeFromPoint) {
                const range = doc.caretRangeFromPoint(clientX, clientY);
                if (range) { node = range.startContainer; offset = range.startOffset; }
            }

            if (node?.nodeType === 3) {
                let snippet = node.nodeValue.slice(offset);
                let sibling = node.nextSibling;
                while (snippet.trim().length < 30 && sibling) {
                    snippet += sibling.textContent || '';
                    sibling = sibling.nextSibling;
                }
                snippet = snippet.trim();
                if (snippet.length > 2) TTSEngine.start(snippet);
            } else if (targetEl) {
                const text = (targetEl.innerText || targetEl.textContent || '').trim();
                if (text.length > 2) TTSEngine.start(text.substring(0, 50));
            }
        } catch (err) {
            console.error('Click-to-speak error', err);
        }
    },

    prevPage() {
        this.rendition?.prev();
    },

    nextPage(fromTts = false) {
        if (!this.rendition) return Promise.resolve();
        if (fromTts) this.isTtsNavigating = true;
        return Promise.resolve(this.rendition.next()).finally(() => {
            if (fromTts) this.isTtsNavigating = false;
        });
    },

    nextChapter(fromTts = false) {
        if (!this.rendition || !this.bookData) return Promise.resolve(false);
        if (fromTts) this.isTtsNavigating = true;

        const loc = this.rendition.currentLocation();
        if (loc?.start && typeof loc.start.index !== 'undefined') {
            const nextIndex = loc.start.index + 1;
            const spineItem = this.bookData.spine.get(nextIndex);
            if (spineItem) {
                return Promise.resolve(this.rendition.display(spineItem.href))
                    .then(() => true)
                    .finally(() => { if (fromTts) this.isTtsNavigating = false; });
            }
        }

        if (fromTts) this.isTtsNavigating = false;
        return Promise.resolve(false);
    },

    updateProgressFromLocation() {
        if (!this.rendition || !this.bookData?.locations) return;
        const loc = this.rendition.currentLocation();
        if (loc?.start) {
            this.currentCfi = loc.start.cfi;
            const pct = this.bookData.locations.percentageFromCfi(this.currentCfi);
            if (!isNaN(pct)) {
                this.progressPercentage = Math.min(100, Math.max(0, pct * 100));
            }
            const topBar = document.getElementById('topReadingProgress');
            if (topBar) {
                topBar.style.width = `${this.progressPercentage.toFixed(1)}%`;
            }
        }
    },

    debouncedSaveProgress() {
        if (this.saveProgressTimeout) clearTimeout(this.saveProgressTimeout);
        this.saveProgressTimeout = setTimeout(() => this.saveProgress(), 2000);
    },

    flushSaveProgress() {
        if (this.saveProgressTimeout) {
            clearTimeout(this.saveProgressTimeout);
            this.saveProgressTimeout = null;
        }
        this.saveProgress(true);
    },

    async saveProgress(isKeepalive = false) {
        if (!this.bookId || !this.currentCfi) return;

        let readingTimeSeconds = 0;
        if (this.sessionStartTime) {
            readingTimeSeconds = Math.floor((Date.now() - this.sessionStartTime) / 1000);
            this.sessionStartTime = Date.now();
        }

        const activeToc = document.querySelector('#tocList .toc-item.active');
        const chapterTitle = this.currentChapterTitle || activeToc?.textContent?.trim() || '';
        const loc = this.rendition?.currentLocation();
        const chapterIndex = (loc?.start && typeof loc.start.index !== 'undefined') ? loc.start.index : null;

        try {
            await fetch(`/api/progress/${this.bookId}`, {
                method: 'PUT',
                keepalive: isKeepalive === true,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    cfi: this.currentCfi,
                    percentage: this.progressPercentage,
                    readingTimeSeconds,
                    chapterTitle,
                    chapterIndex
                })
            });

            const indicator = document.getElementById('saveIndicator');
            if (indicator) {
                indicator.style.opacity = '1';
                setTimeout(() => { indicator.style.opacity = '0'; }, 2000);
            }
        } catch (e) {
            console.error('Save progress failed', e);
        }
    },

    /** Media Session API for lock screen / Bluetooth control */
    setupMediaSession() {
        if (!('mediaSession' in navigator)) return;
        navigator.mediaSession.metadata = new MediaMetadata({
            title: this.book?.title || 'D_Reader',
            artist: this.book?.author || 'D_Reader',
            album: 'D_Reader',
            artwork: [{ src: this.book?.coverPath ? `/api/books/${this.bookId}/cover` : '/favicon.ico', sizes: '512x512', type: 'image/png' }]
        });
        navigator.mediaSession.setActionHandler('play', () => TTSEngine.resume());
        navigator.mediaSession.setActionHandler('pause', () => TTSEngine.pause());
        navigator.mediaSession.setActionHandler('previoustrack', () => TTSEngine.prevParagraph?.());
        navigator.mediaSession.setActionHandler('nexttrack', () => TTSEngine.nextParagraph?.());
    },

    /** Zen Mode — auto-hide toolbar */
    toggleZenMode() {
        this.zenMode ? this.exitZenMode() : this.enterZenMode();
    },

    enterZenMode() {
        this.zenMode = true;
        document.getElementById('readerToolbar')?.classList.add('zen-hidden');
        const btn = document.getElementById('btnToggleZen');
        if (btn) {
            btn.querySelector('i').className = 'ri-fullscreen-exit-line';
            btn.title = 'Thoát Zen Mode (Z)';
        }
    },

    exitZenMode() {
        this.zenMode = false;
        document.getElementById('readerToolbar')?.classList.remove('zen-hidden');
        const btn = document.getElementById('btnToggleZen');
        if (btn) {
            btn.querySelector('i').className = 'ri-fullscreen-line';
            btn.title = 'Zen Mode (Z)';
        }
    },

    /** Fullscreen API */
    toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen?.();
            document.getElementById('btnFullscreen')?.querySelector('i')
                ?.setAttribute('class', 'ri-fullscreen-exit-line');
        } else {
            document.exitFullscreen?.();
            document.getElementById('btnFullscreen')?.querySelector('i')
                ?.setAttribute('class', 'ri-fullscreen-line');
        }
    },
};

const varFontSans = "'Be Vietnam Pro', system-ui, -apple-system, sans-serif";
const varFontSerif = "'Literata', 'Merriweather', Georgia, serif";
const varFontLora = "'Lora', Georgia, serif";

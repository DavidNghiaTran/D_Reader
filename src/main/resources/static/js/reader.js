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
        this.initReplaceRulesModal();
    },

    bindEvents() {
        // Back to library
        document.getElementById('btnBackToLibrary')?.addEventListener('click', () => {
            this.flushSaveProgress();
            TTS.stop();
            this.exitZenMode();
            const topBar = document.getElementById('topReadingProgress');
            if (topBar) topBar.style.width = '0%';
            const badgeEl = document.getElementById('currentChapterBadge');
            if (badgeEl) badgeEl.style.display = 'none';
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
            } catch (e) { }
        }
        this.saveSettings();
    },

    getContentWidthConfig() {
        const widthConfig = {
            standard: { viewerMax: '1000px', bodyMax: '1000px', padding: '36px 28px 140px 28px', columns: 1 },
            wide: { viewerMax: '1350px', bodyMax: '1350px', padding: '36px 32px 140px 32px', columns: 1 },
            extra: { viewerMax: '1600px', bodyMax: '1600px', padding: '36px 36px 140px 36px', columns: 1 },
            full: { viewerMax: '96vw', bodyMax: '95vw', padding: '36px 32px 140px 32px', columns: 1 },
            columns: { viewerMax: '1500px', bodyMax: '1450px', padding: '36px 36px 140px 36px', columns: 2 }
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
            } catch (e) { }
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
            if (titleElem) {
                titleElem.textContent = this.book.title;
                titleElem.title = this.book.title;
            }

            this.currentChapterTitle = this.book.chapterTitle || '';

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
            this.loadAndRenderToc();

            // Load bookmarks
            this.loadBookmarks();

            // Generate locations for progress % & tạo bí danh spineByHref chống lỗi No Section Found
            this.bookData.ready
                .then(() => {
                    if (this.bookData?.spine?.spineItems) {
                        this.bookData.spine.spineItems.forEach((si, idx) => {
                            if (si.href) {
                                const raw = si.href;
                                const base = raw.split('/').pop();
                                const decoded = decodeURI(raw);
                                const decodedBase = decodeURI(base);
                                this.bookData.spine.spineByHref[raw] = idx;
                                this.bookData.spine.spineByHref[base] = idx;
                                this.bookData.spine.spineByHref[decoded] = idx;
                                this.bookData.spine.spineByHref[decodedBase] = idx;
                                this.bookData.spine.spineByHref['OEBPS/' + base] = idx;
                                this.bookData.spine.spineByHref['OPS/' + base] = idx;
                                this.bookData.spine.spineByHref['/' + raw] = idx;
                                this.bookData.spine.spineByHref['./' + raw] = idx;
                            }
                        });
                    }
                    return this.bookData.locations.generate(1000);
                })
                .then(() => this.updateProgressFromLocation())
                .catch(() => { });

            // Relocation event
            this.rendition.on('relocated', (location) => {
                this.currentCfi = location.start.cfi;
                this.updateProgressFromLocation();
                this.debouncedSaveProgress();

                if (this.currentHref !== location.start.href) {
                    this.currentHref = location.start.href;
                    // Cập nhật spine index khi relocated để nextChapter() biết vị trí thật

                    if (typeof location.start.index !== 'undefined' && location.start.index > 0) {

                        this._lastClickedSpineIndex = location.start.index;

                    }
                    this.syncTocActiveState();
                    if (TTSEngine.status === 'PLAYING' && !this.isTtsNavigating) {
                        TTSEngine.onPageNavigated();
                    }
                } else {
                    this.syncTocActiveState();
                }
            });

            // Click-to-read
            this.rendition.on('click', (e) => this.handleReaderClick(e));

            // Setup MediaSession
            this.setupMediaSession();

            if (autoPlayTts) {
                setTimeout(() => {
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
        const attrsToRemove = ['style', 'class', 'face', 'size', 'color', 'align', 'bgcolor', 'width'];

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
            // Giữ lại span/p nếu có ảnh/svg HOẶC có id/name dùng làm anchor chuyển chương
            if (!cleanText && !el.querySelector('img, svg') && !el.id && !el.getAttribute('name')) {
                el.remove();
            } else if (el.children.length === 0 && cleanText) {
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
            } catch (e) { }

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

            // Đồng bộ tên chương đang đọc và vị trí TOC khi cuộn
            clearTimeout(this._scrollTocSyncTimer);
            this._scrollTocSyncTimer = setTimeout(() => {
                this.syncTocActiveState();
            }, 180);

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
        } catch (e) { }
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
            try { this.rendition.destroy(); } catch (e) { }
        }
        viewer.innerHTML = '';

        await this.buildRendition(viewer);
        await this.rendition.display(saveCfi || undefined);

        this.loadAndRenderToc();
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
            } else {
                this.syncTocActiveState();
            }
        });
        this.rendition.on('click', (e) => this.handleReaderClick(e));
    },

    /** Inject font / theme styles into the EPUB iframe */
    injectIframeStyles(contents) {
        const theme = this.settings.theme || 'dark';
        const themeMap = {
            dark: { bg: '#11131a', text: '#e2e8f0', heading: '#c7d2fe', highlight: 'rgba(129,140,248,0.28)', border: 'rgba(148,163,184,0.14)' },
            light: { bg: '#f8f9fa', text: '#27272a', heading: '#1e293b', highlight: 'rgba(250,204,21,0.38)', border: 'rgba(0,0,0,0.08)' },
            sepia: { bg: '#f4ecd8', text: '#433422', heading: '#2c1e10', highlight: 'rgba(217,119,6,0.28)', border: 'rgba(59,46,30,0.12)' },
            mint: { bg: '#cce8cf', text: '#1b2e1e', heading: '#0f1f12', highlight: 'rgba(132,169,83,0.35)', border: 'rgba(40,54,24,0.12)' },
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
                max-width: min(var(--reader-max-width), 100%) !important;
                margin: 0 auto !important;
                padding: ${cfg.padding} !important;
                padding-bottom: 140px !important;
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
                display: block !important;
                font-family: var(--reader-font-family) !important;
                font-size: calc(var(--reader-font-size) * 1.35) !important;
                line-height: 1.4 !important;
                color: var(--reader-heading) !important;
                font-weight: 700 !important;
                text-align: center !important;
                text-indent: 0 !important;
                margin-top: 2.5rem !important;
                margin-bottom: 1.5rem !important;
                scroll-margin-top: 85px !important;
                padding-top: 20px !important;
                page-break-before: always !important;
                clear: both !important;
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
                'margin': '1.5em 0 1.8em 0 !important',
                'scroll-margin-top': '85px !important',
                'padding-top': '20px !important',
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
            dark: { bg: '#11131a', text: '#e2e8f0', heading: '#c7d2fe' },
            light: { bg: '#f8f9fa', text: '#27272a', heading: '#1e293b' },
            sepia: { bg: '#f4ecd8', text: '#433422', heading: '#2c1e10' },
            mint: { bg: '#cce8cf', text: '#1b2e1e', heading: '#0f1f12' },
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
            } catch (e) { }
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
            } catch (e) { }
        }
        this.saveSettings();
    },

    /** Load TOC from backend API with fallback to epub.js navigation */
    async loadAndRenderToc() {
        try {
            if (this.bookId) {
                const res = await fetch(`/api/books/${this.bookId}/toc`);
                if (res.ok) {
                    const apiToc = await res.json();
                    if (Array.isArray(apiToc) && apiToc.length > 2) {
                        const list = apiToc.map(c => ({ label: c.title, href: c.href }));
                        this.renderTocList(list);
                        return;
                    }
                }
            }
        } catch (e) {
            console.warn('Backend TOC fetch failed, falling back to epub.js:', e);
        }

        if (this.bookData?.loaded?.navigation) {
            this.bookData.loaded.navigation
                .then(toc => this.renderToc(toc))
                .catch(() => this.renderToc(null));
        } else {
            this.renderToc(null);
        }
    },

    /** Render Table of Contents with full recursive subitems & fallback */
    async renderToc(toc) {
        // 1. Đệ quy làm phẳng toàn bộ mục lục bao gồm subitems / children lồng nhau
        function flattenItems(items, depth = 0) {
            let list = [];
            if (!items || !items.length) return list;
            items.forEach(it => {
                const label = (it.label || it.title || '').replace(/\s+/g, ' ').trim();
                const href = (it.href || '').trim();
                const sub = it.subitems || it.children || [];
                const hasSub = Array.isArray(sub) && sub.length > 0;

                const isWrapper = hasSub && (/^(mục\s*lục|table\s*of\s*contents|contents|toc|navigation)$/i.test(label) || (depth === 0 && label.length > 50));

                if (!isWrapper && label && href) {
                    list.push({ label, href, id: it.id, depth });
                }

                if (hasSub) {
                    list = list.concat(flattenItems(sub, depth + 1));
                }
            });
            return list;
        }

        let flatList = [];
        if (toc && toc.toc && toc.toc.length > 0) {
            flatList = flattenItems(toc.toc);
        } else if (Array.isArray(toc) && toc.length > 0) {
            flatList = flattenItems(toc);
        }

        // 2. Nếu sau khi làm phẳng vẫn <= 2 mục, tự động quét fallback từ HTML Mục lục hoặc Spine
        if (flatList.length <= 2 && this.bookData) {
            flatList = await this.recoverTocFromSpineOrHtml(flatList);
        }

        this.renderTocList(flatList);
    },

    renderTocList(flatList) {
        const container = document.getElementById('tocList');
        if (!container) return;
        container.innerHTML = '';

        if (!flatList || !flatList.length) {
            container.innerHTML = '<li class="toc-item" style="color:var(--text-muted);">Không có mục lục</li>';
            return;
        }

        // Lọc bỏ các mục bìa/wrapper nếu danh sách có nhiều hơn 2 chương thật
        const realChapters = flatList.filter(it =>
            !/^(mục\s*lục|table\s*of\s*contents|contents|toc|navigation)$/i.test(it.label) &&
            !/(?:titlepage|title-page|cover|biatruoc)/i.test(it.href)
        );
        const listToRender = realChapters.length > 2 ? realChapters : flatList;

        // Lưu lại danh sách chương để dùng cho next/prev chapter
        this.tocChapters = listToRender;

        // Render ra giao diện
        listToRender.forEach((item, idx) => {
            const li = document.createElement('li');
            li.className = 'toc-item';
            li.textContent = item.label;
            li.dataset.href = item.href;
            li.title = item.label;

            li.addEventListener('click', (e) => {
                e.stopPropagation();
                this.navigateToChapter(item, idx);
                document.getElementById('tocSidebar')?.classList.remove('active');
            });
            container.appendChild(li);
        });

        // Đánh dấu active cho chương hiện tại nếu có
        this.syncTocActiveState();

        // 4. Nếu mở sách lần đầu (chưa có CFI lưu) và đang ở trang bìa, tự động nhảy vào Chương 1
        const targetCfi = this.book?.currentCfi?.trim();
        if (!targetCfi && listToRender.length > 0) {
            const firstChap = listToRender.find(it => /(?:chương|hồi|chapter)\s*0*1(?![0-9])/i.test(it.label)) || listToRender[0];
            if (firstChap && firstChap.href) {
                setTimeout(() => {
                    const firstEl = Array.from(container.children).find(el => el.dataset.href === firstChap.href);
                    if (firstEl) {
                        firstEl.click();
                    } else {
                        this.rendition.display(firstChap.href);
                    }
                }, 400);
            }
        }
    },


    async navigateToChapter(item, tocIndex = -1) {
        if (!item || !item.href || !this.rendition) return;

        if (typeof tocIndex === 'number' && tocIndex >= 0) {
            this._currentTocIndex = tocIndex;
        } else if (this.tocChapters) {
            this._currentTocIndex = this.tocChapters.findIndex(c => c.href === item.href);
        }

        this.currentChapterTitle = item.label;

        // Cập nhật active highlight trong sidebar
        const container = document.getElementById('tocList');
        if (container) {
            container.querySelectorAll('.toc-item').forEach(el => el.classList.remove('active'));
            const activeEl = (this._currentTocIndex >= 0 && container.children[this._currentTocIndex])
                ? container.children[this._currentTocIndex]
                : container.querySelector(`[data-href="${CSS.escape(item.href)}"]`);
            if (activeEl) {
                activeEl.classList.add('active');
                activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        }

        const rawHref = item.href;
        const [filePath, hash] = rawHref.split('#');

        // Tìm spine item tương ứng: Ưu tiên so khớp toàn bộ đường dẫn để không nhầm 2/index_split_070 với 1/index_split_070
        const normPath = decodeURIComponent(filePath).replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
        let spineItem = this.bookData?.spine?.spineItems?.find(si => {
            if (!si.href) return false;
            const siNorm = decodeURIComponent(si.href).replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
            return siNorm === normPath || ('/' + siNorm).endsWith('/' + normPath) || ('/' + normPath).endsWith('/' + siNorm);
        });

        if (!spineItem) {
            const fileBase = normPath.split('/').pop();
            spineItem = this.bookData?.spine?.spineItems?.find(si => {
                if (!si.href) return false;
                const siBase = decodeURIComponent(si.href).split('/').pop().toLowerCase();
                return siBase === fileBase;
            });
        }

        const targetHref = spineItem ? spineItem.href : filePath;
        this._lastClickedSpineIndex = spineItem ? spineItem.index : -1;
        this._lastClickedHref = rawHref;

        // Xác định file hiện tại trong viewport theo toàn bộ đường dẫn
        const currentLoc = this.rendition.currentLocation();
        const currentSpineNorm = currentLoc?.start?.href ? decodeURIComponent(currentLoc.start.href).replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase() : '';
        const targetNorm = spineItem ? decodeURIComponent(spineItem.href).replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase() : normPath;

        if (currentSpineNorm !== targetNorm) {
            // Nạp section/file mới
            await this.rendition.display(targetHref);
        }

        // Sau đó cuộn mượt đến đúng vị trí chương (theo hash id hoặc tiêu đề)
        this.scrollToChapterLocation(hash || '', item.label);
    },

    scrollToChapterLocation(hash, chapterTitle) {
        let attempts = 0;
        const tryScroll = () => {
            attempts++;
            const iframes = document.querySelectorAll('#viewer iframe, .epub-container iframe, iframe');
            for (const iframe of iframes) {
                let doc;
                try { doc = iframe.contentDocument || iframe.contentWindow?.document; } catch (e) { continue; }
                if (!doc || !doc.body || doc.body.children.length === 0) continue;

                let targetEl = null;

                // 1. Tìm theo ID (hash id)
                if (hash) {
                    targetEl = doc.getElementById(hash) || doc.querySelector(`[id="${hash}"]`) || doc.querySelector(`[name="${hash}"]`);
                }

                // 2. Nếu không tìm thấy, tìm theo tiêu đề chương (h1, h2, h3, chapter-title)
                if (!targetEl && chapterTitle) {
                    const cleanTitle = chapterTitle.replace(/\s+/g, ' ').trim();
                    const m = cleanTitle.match(/(?:chương|hồi|phần|chapter|tiết)\s*0*(\d+)(?![0-9])/i)
                        || cleanTitle.match(/^0*(\d+)[\s:.\-–—]/);
                    if (m) {
                        const chapNum = m[1];
                        const regex = new RegExp('(?:chương|hồi|phần|chapter|tiết)\\s*0*' + chapNum + '(?![0-9])', 'i');
                        const candidates = doc.querySelectorAll('h1, h2, h3, h4, .chapter-title, p');
                        for (const el of candidates) {
                            if (el.children.length > 5) continue;
                            const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
                            if (text && regex.test(text)) {
                                targetEl = el;
                                break;
                            }
                        }
                    }
                }

                if (targetEl) {
                    targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    const win = iframe.contentWindow || window;
                    setTimeout(() => {
                        try { win.scrollBy({ top: -85, behavior: 'instant' }); } catch (e) { }
                    }, 80);
                    return true;
                }
            }

            if (attempts < 16) {
                setTimeout(tryScroll, 100);
            }
            return false;
        };

        setTimeout(tryScroll, 60);
    },

    async recoverTocFromSpineOrHtml(existingList) {
        const result = [];
        const seenHrefs = new Set();
        const add = (label, href) => {
            const l = (label || '').replace(/\s+/g, ' ').trim();
            const h = (href || '').trim();
            if (!l || !h || seenHrefs.has(h + '_' + l)) return;
            seenHrefs.add(h + '_' + l);
            result.push({ label: l, href: h });
        };

        const spineItems = this.bookData?.spine?.spineItems;
        if (!spineItems || !spineItems.length) return existingList;

        // Quét các file HTML Mục lục trong spine
        const tocCandidates = spineItems.filter((item, idx) =>
            idx < 6 || /toc|mucluc|muc-luc|contents|nav/i.test(item.href || '') || /toc|contents|nav/i.test(item.idref || '')
        );

        for (const sec of tocCandidates) {
            try {
                let doc = null;
                try {
                    doc = await this.bookData.load(sec.href);
                } catch (e) {
                    doc = await sec.load(this.bookData.load.bind(this.bookData));
                }
                const root = doc?.ownerDocument || doc;
                if (!root) continue;
                const links = root.querySelectorAll('a[href]');
                if (links.length > 3) {
                    const secDir = sec.href.includes('/') ? sec.href.substring(0, sec.href.lastIndexOf('/') + 1) : '';
                    links.forEach(a => {
                        const rawHref = a.getAttribute('href');
                        const text = (a.textContent || '').trim();
                        if (!rawHref || rawHref.startsWith('http') || rawHref.startsWith('mailto:') || !text) return;

                        let resolvedHref = rawHref;
                        if (!rawHref.startsWith('/') && !rawHref.startsWith('#') && secDir) {
                            const parts = (secDir + rawHref).split('/');
                            const stack = [];
                            for (const p of parts) {
                                if (p === '.' || p === '') continue;
                                if (p === '..') stack.pop();
                                else stack.push(p);
                            }
                            resolvedHref = stack.join('/');
                        } else if (rawHref.startsWith('#')) {
                            resolvedHref = sec.href + rawHref;
                        }
                        add(text, resolvedHref);
                    });
                    if (result.length > 3) return result;
                }
            } catch (e) { }
        }

        // Quét từng section trong spine theo thứ tự
        if (result.length <= 2 && spineItems.length > 1) {
            for (let i = 0; i < Math.min(spineItems.length, 1000); i++) {
                const sec = spineItems[i];
                let title = '';
                try {
                    let doc = null;
                    try {
                        doc = await this.bookData.load(sec.href);
                    } catch (e) {
                        doc = await sec.load(this.bookData.load.bind(this.bookData));
                    }
                    const root = doc?.ownerDocument || doc;
                    if (root) {
                        const firstHeading = root.querySelector('h1, h2, h3, title, .chapter-title');
                        if (firstHeading && firstHeading.textContent.trim()) {
                            title = firstHeading.textContent.replace(/\s+/g, ' ').trim();
                        }
                    }
                } catch (e) { }
                if (!title || title.toLowerCase() === 'untitled') {
                    title = `Chương ${i + 1}`;
                }
                add(title, sec.href);
            }
        }

        return result.length > existingList.length ? result : existingList;
    },

    syncTocActiveState() {
        const tocItems = Array.from(document.querySelectorAll('#tocList .toc-item'));
        if (!tocItems.length) return;

        // 1. Thử nhận diện chương theo vị trí cuộn thực tế trong iframe
        const iframe = document.querySelector('#viewer iframe, .epub-container iframe, iframe');
        const doc = iframe ? (iframe.contentDocument || iframe.contentWindow?.document) : null;
        const win = iframe ? (iframe.contentWindow || window) : window;

        if (doc && doc.body) {
            const scrollY = win.scrollY || doc.documentElement.scrollTop || doc.body.scrollTop || 0;
            const headings = Array.from(doc.querySelectorAll('h1, h2, h3, .chapter-title, [id^="filepos"]'));
            let currentHeading = null;

            for (const h of headings) {
                const top = h.offsetTop || (h.getBoundingClientRect().top + scrollY);
                if (top <= scrollY + 120) {
                    currentHeading = h;
                } else {
                    break;
                }
            }

            if (currentHeading) {
                const hId = currentHeading.id || currentHeading.getAttribute('name');
                if (hId) {
                    const matchedById = tocItems.find(li => (li.dataset.href || '').includes('#' + hId));
                    if (matchedById) {
                        tocItems.forEach(li => li.classList.toggle('active', li === matchedById));
                        this.currentChapterTitle = matchedById.textContent.trim();
                        this._currentTocIndex = tocItems.indexOf(matchedById);
                        return;
                    }
                }

                const hText = (currentHeading.textContent || '').replace(/\s+/g, ' ').trim();
                const mNum = hText.match(/(?:chương|hồi|phần|chapter|tiết)\s*0*(\d+)(?![0-9])/i);
                if (mNum) {
                    const chapNum = mNum[1];
                    const regex = new RegExp('(?:chương|hồi|phần|chapter|tiết)\\s*0*' + chapNum + '(?![0-9])', 'i');
                    const matchedByNum = tocItems.find(li => regex.test(li.textContent || ''));
                    if (matchedByNum) {
                        tocItems.forEach(li => li.classList.toggle('active', li === matchedByNum));
                        this.currentChapterTitle = matchedByNum.textContent.trim();
                        this._currentTocIndex = tocItems.indexOf(matchedByNum);
                        return;
                    }
                }
            }
        }

        // 2. Giữ nguyên chương đã chọn gần nhất nếu vẫn trong cùng file
        if (typeof this._currentTocIndex === 'number' && this._currentTocIndex >= 0 && tocItems[this._currentTocIndex]) {
            const curItem = tocItems[this._currentTocIndex];
            const itemBase = (curItem.dataset.href || '').split('#')[0].split('/').pop().toLowerCase();
            const curBase = (this.currentHref || '').split('#')[0].split('/').pop().toLowerCase();
            if (itemBase === curBase) {
                tocItems.forEach(li => li.classList.toggle('active', li === curItem));
                this.currentChapterTitle = curItem.textContent.trim();
                return;
            }
        }

        // 3. Fallback: khớp theo file href
        if (this.currentHref) {
            const baseHref = this.currentHref.split('#')[0].split('/').pop().toLowerCase();
            const matched = tocItems.find(li => {
                const liBase = (li.dataset.href || '').split('#')[0].split('/').pop().toLowerCase();
                return liBase === baseHref;
            });
            if (matched) {
                tocItems.forEach(li => li.classList.toggle('active', li === matched));
                this.currentChapterTitle = matched.textContent.trim();
                this._currentTocIndex = tocItems.indexOf(matched);
            }
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
        } catch (e) { }

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
        } catch (e) { }
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
                } catch (err) { }

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

    prevChapter() {
        if (!this.rendition || !this.bookData) return Promise.resolve(false);

        // 1. Chuyển lùi theo danh sách TOC nếu có
        if (this.tocChapters && this.tocChapters.length > 0) {
            let currentTocIdx = -1;
            if (typeof this._currentTocIndex === 'number' && this._currentTocIndex >= 0) {
                currentTocIdx = this._currentTocIndex;
            } else {
                const activeLi = document.querySelector('#tocList .toc-item.active');
                if (activeLi && activeLi.dataset.href) {
                    currentTocIdx = this.tocChapters.findIndex(c => c.href === activeLi.dataset.href);
                }
            }

            if (currentTocIdx > 0) {
                const prevItem = this.tocChapters[currentTocIdx - 1];
                return this.navigateToChapter(prevItem, currentTocIdx - 1).then(() => true);
            }
        }

        // 2. Fallback chuyển theo spine
        const loc = this.rendition.currentLocation();
        if (loc?.start && loc.start.index > 0) {
            const prevItem = this.bookData.spine.get(loc.start.index - 1);
            if (prevItem) {
                return Promise.resolve(this.rendition.display(prevItem.href)).then(() => true);
            }
        }
        return Promise.resolve(false);
    },

    nextChapter(fromTts = false) {
        if (!this.rendition || !this.bookData) return Promise.resolve(false);
        if (fromTts) this.isTtsNavigating = true;

        // 1. Chuyển tiếp theo danh sách TOC (áp dụng chuẩn cho cả file gộp nhiều chương và chương đơn)
        if (this.tocChapters && this.tocChapters.length > 0) {
            let currentTocIdx = -1;
            if (typeof this._currentTocIndex === 'number' && this._currentTocIndex >= 0) {
                currentTocIdx = this._currentTocIndex;
            } else {
                const activeLi = document.querySelector('#tocList .toc-item.active');
                if (activeLi && activeLi.dataset.href) {
                    currentTocIdx = this.tocChapters.findIndex(c => c.href === activeLi.dataset.href);
                }
            }

            if (currentTocIdx >= 0 && currentTocIdx + 1 < this.tocChapters.length) {
                const nextItem = this.tocChapters[currentTocIdx + 1];
                return this.navigateToChapter(nextItem, currentTocIdx + 1)
                    .then(() => true)
                    .finally(() => { if (fromTts) this.isTtsNavigating = false; });
            } else if (currentTocIdx >= this.tocChapters.length - 1) {
                // Đã đọc hết toàn bộ các chương trong mục lục
                if (fromTts) this.isTtsNavigating = false;
                return Promise.resolve(false);
            }
        }

        // 2. Fallback theo spine nếu sách không có TOC
        const spineItems = this.bookData.spine.spineItems;
        const totalSpine = spineItems ? spineItems.length : 0;
        const loc = this.rendition.currentLocation();
        let currentIndex = (loc?.start && typeof loc.start.index !== 'undefined') ? loc.start.index : -1;
        if (currentIndex < 0 && typeof this._lastClickedSpineIndex === 'number') {
            currentIndex = this._lastClickedSpineIndex;
        }

        if (currentIndex >= 0 && currentIndex + 1 < totalSpine) {
            const nextIndex = currentIndex + 1;
            const spineItem = this.bookData.spine.get(nextIndex);
            if (spineItem) {
                this._lastClickedSpineIndex = nextIndex;
                return Promise.resolve(this.rendition.display(spineItem.href))
                    .then(() => true)
                    .finally(() => { if (fromTts) this.isTtsNavigating = false; });
            }
        }

        if (fromTts) this.isTtsNavigating = false;
        return Promise.resolve(false);
    },

    updateProgressFromLocation() {
        if (!this.rendition || !this.bookData) return;
        const loc = this.rendition.currentLocation();
        if (loc?.start) {
            this.currentCfi = loc.start.cfi;

            // Ưu tiên tính tiến độ chính xác theo: (chương hiện tại + 1) / tổng số chương
            let calcPct = null;
            if (this.tocChapters && this.tocChapters.length > 0) {
                let chapIdx = (typeof this._currentTocIndex === 'number' && this._currentTocIndex >= 0)
                    ? this._currentTocIndex
                    : 0;
                const total = this.tocChapters.length;
                calcPct = Math.min(100, Math.max(0, ((chapIdx + 1) / total) * 100));
            }

            if (calcPct != null) {
                this.progressPercentage = Number(calcPct.toFixed(2));
            } else if (this.bookData.locations && this.bookData.locations.length() > 0) {
                const pct = this.bookData.locations.percentageFromCfi(this.currentCfi);
                if (!isNaN(pct)) {
                    this.progressPercentage = Math.min(100, Math.max(0, Number((pct * 100).toFixed(2))));
                }
            }

            const topBar = document.getElementById('topReadingProgress');
            if (topBar) {
                topBar.style.width = `${this.progressPercentage.toFixed(1)}%`;
            }
        }
    },

    debouncedSaveProgress() {
        // 1. Lưu ngay vào localStorage tức thì để không bao giờ bị mất nếu tab/app đóng đột ngột
        if (this.bookId && this.currentCfi) {
            const loc = this.rendition?.currentLocation();
            const chapterIndex = (typeof this._currentTocIndex === 'number' && this._currentTocIndex >= 0)
                ? (this._currentTocIndex + 1)
                : ((loc?.start && typeof loc.start.index !== 'undefined') ? (loc.start.index + 1) : null);
            const activeToc = document.querySelector('#tocList .toc-item.active');
            const chapterTitle = this.currentChapterTitle || activeToc?.textContent?.trim() || '';
            const immediateData = {
                cfi: this.currentCfi,
                percentage: this.progressPercentage,
                chapterTitle,
                chapterIndex,
                updatedAt: Date.now()
            };
            try {
                localStorage.setItem(`dreader_progress_${this.bookId}`, JSON.stringify(immediateData));
            } catch (e) { }
        }

        // 2. Debounce ghi vào MySQL 3500ms để tránh lock DB và spam API
        if (this.saveProgressTimeout) clearTimeout(this.saveProgressTimeout);
        this.saveProgressTimeout = setTimeout(() => this.saveProgress(), 3500);
    },

    flushSaveProgress(isKeepalive = false) {
        if (this.saveProgressTimeout) {
            clearTimeout(this.saveProgressTimeout);
            this.saveProgressTimeout = null;
        }
        this.saveProgress(isKeepalive);
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

        const payload = {
            cfi: this.currentCfi,
            percentage: this.progressPercentage,
            readingTimeSeconds,
            chapterTitle,
            chapterIndex
        };

        // Nếu ứng dụng đang thoát (keepalive), ưu tiên dùng sendBeacon với Blob json
        if (isKeepalive && navigator.sendBeacon) {
            try {
                const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
                navigator.sendBeacon(`/api/progress/${this.bookId}`, blob);
                return;
            } catch (e) { }
        }

        try {
            await fetch(`/api/progress/${this.bookId}`, {
                method: 'PUT',
                keepalive: isKeepalive === true,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
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

    // ==========================================
    // BỘ LỌC TỪ & REGEX THAY THẾ (REPLACE RULES)
    // ==========================================
    initReplaceRulesModal() {
        const modal = document.getElementById('modalReplaceRules');
        const btnOpen = document.getElementById('btnOpenReplaceRules');
        const btnClose = document.getElementById('btnCloseReplaceRulesModal');
        const btnCancel = document.getElementById('btnCancelReplaceRules');
        const btnAdd = document.getElementById('btnAddReplaceRule');
        const btnSave = document.getElementById('btnSaveReplaceRules');

        if (!modal) return;

        const closeModal = () => modal.classList.remove('active');
        const openModal = () => {
            this.renderReplaceRulesList();
            modal.classList.add('active');
        };

        btnOpen?.addEventListener('click', openModal);
        btnClose?.addEventListener('click', closeModal);
        btnCancel?.addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });

        btnAdd?.addEventListener('click', () => {
            const patternInput = document.getElementById('inputReplacePattern');
            const replInput = document.getElementById('inputReplaceReplacement');
            const pattern = patternInput.value.trim();
            const replacement = replInput.value;
            if (!pattern) return;

            const rules = this.getReplaceRules();
            rules.push({ pattern, replacement, flags: 'gi', enabled: true });
            this.setReplaceRules(rules);
            patternInput.value = '';
            replInput.value = '';
            this.renderReplaceRulesList();
        });

        btnSave?.addEventListener('click', async () => {
            const rules = this.getReplaceRules();
            this.settings.replaceRules = JSON.stringify(rules);
            localStorage.setItem('dreader_replace_rules', JSON.stringify(rules));
            await this.saveSettings();
            App.showToast('Đã lưu quy tắc lọc từ thành công!');
            closeModal();
        });
    },

    getReplaceRules() {
        try {
            if (this.settings?.replaceRules) {
                return typeof this.settings.replaceRules === 'string'
                    ? JSON.parse(this.settings.replaceRules)
                    : this.settings.replaceRules;
            }
            const raw = localStorage.getItem('dreader_replace_rules');
            if (raw) return JSON.parse(raw);
        } catch (e) { }
        return [];
    },

    setReplaceRules(rules) {
        if (!this.settings) this.settings = {};
        this.settings.replaceRules = JSON.stringify(rules);
        localStorage.setItem('dreader_replace_rules', JSON.stringify(rules));
    },

    renderReplaceRulesList() {
        const container = document.getElementById('replaceRulesList');
        if (!container) return;
        const rules = this.getReplaceRules();
        if (rules.length === 0) {
            container.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;text-align:center;padding:1rem;">Chưa có quy tắc nào. Nhập từ khóa hoặc Regex phía trên để thêm.</div>';
            return;
        }

        container.innerHTML = rules.map((r, i) => `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:0.4rem 0.5rem;border-bottom:1px solid var(--border-color);font-size:0.85rem;">
                <div style="display:flex;align-items:center;gap:0.5rem;overflow:hidden;">
                    <input type="checkbox" ${r.enabled !== false ? 'checked' : ''} onchange="Reader.toggleReplaceRule(${i}, this.checked)">
                    <code style="background:var(--bg-card);padding:2px 6px;border-radius:4px;color:var(--accent);">${App.escapeHtml(r.pattern)}</code>
                    <i class="ri-arrow-right-line" style="color:var(--text-muted);font-size:0.75rem;"></i>
                    <span style="color:var(--text-secondary);">${r.replacement ? App.escapeHtml(r.replacement) : '<em>(xóa)</em>'}</span>
                </div>
                <button class="btn btn-secondary btn-icon" style="padding:2px 6px;color:var(--danger);" onclick="Reader.removeReplaceRule(${i})">
                    <i class="ri-delete-bin-line"></i>
                </button>
            </div>
        `).join('');
    },

    toggleReplaceRule(index, enabled) {
        const rules = this.getReplaceRules();
        if (rules[index]) {
            rules[index].enabled = enabled;
            this.setReplaceRules(rules);
        }
    },

    removeReplaceRule(index) {
        const rules = this.getReplaceRules();
        rules.splice(index, 1);
        this.setReplaceRules(rules);
        this.renderReplaceRulesList();
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

/* ==========================================================================
   D_READER EPUB MASTER FIX V4 (CHỐNG NHẢY NHẦM CHƯƠNG & CHỐNG LẸM CHỮ MÉP TRÁI)
   ========================================================================== */
(function initDReaderEpubMasterFixV4() {
    // 1. Bơm CSS vào trang chính để sửa dứt điểm lỗi mất chữ mép trái khi chọn "Rộng (1350px)"
    if (!document.getElementById('dreader-outer-layout-fix')) {
        const outerStyle = document.createElement('style');
        outerStyle.id = 'dreader-outer-layout-fix';
        outerStyle.textContent = `
            .epub-container {
                max-width: 100% !important;
                width: 100% !important;
                left: 0 !important;
                margin: 0 auto !important;
                box-sizing: border-box !important;
                overflow-x: hidden !important;
            }
            .epub-view, .epub-view > iframe {
                max-width: 100% !important;
                width: 100% !important;
                left: 0 !important;
                box-sizing: border-box !important;
            }
        `;
        document.head.appendChild(outerStyle);
    }

    // 2. Vá DOMParser khi file .xhtml trong EPUB bị lỗi cú pháp thẻ XML
    const origParseFromString = DOMParser.prototype.parseFromString;
    DOMParser.prototype.parseFromString = function (str, type) {
        let doc = origParseFromString.call(this, str, type);
        if ((type === 'application/xhtml+xml' || type === 'text/xml') && doc && doc.querySelector('parsererror')) {
            return origParseFromString.call(this, str, 'text/html');
        }
        return doc;
    };

    let targetTocEl = null;
    let desiredLabel = '';
    let desiredNextLabel = '';
    let pollTimer = null;
    let isNavigatingToc = false;
    let deepSearchAttemptedFor = '';

    function getReaderObj() {
        try {
            if (typeof Reader !== 'undefined' && Reader) return Reader;
        } catch (e) { }
        return window.Reader || null;
    }

    function extractChapterNumber(text) {
        if (!text) return null;
        const m = text.match(/(?:chương|hồi|phần|chapter|tiết)\s*0*(\d+)(?![0-9])/i)
            || text.trim().match(/^0*(\d+)[\s:.\-–—]/);
        return m ? m[1] : null;
    }

    function normalizePath(p) {
        if (!p || typeof p !== 'string') return '';
        const raw = decodeURIComponent(p.split('#')[0]).replace(/\\/g, '/').trim();
        const parts = raw.split('/');
        const stack = [];
        for (const part of parts) {
            if (!part || part === '.') continue;
            if (part === '..') stack.pop();
            else stack.push(part);
        }
        return stack.join('/').toLowerCase();
    }

    // 3. Vá chuẩn xác hàm book.spine.get() và chặn onResized kéo ngược về chương cũ
    function patchBookAndRendition() {
        const reader = getReaderObj();
        if (!reader || !reader.rendition) return;
        const book = reader.bookData || reader.book;
        const rendition = reader.rendition;

        if (!book || !book.spine || !book.spine.spineItems || book.spine.spineItems.length === 0) return;

        // 3.1. Chặn lỗi onResized của epub.js tự gọi display(oldCfi) làm nhảy lại Chương 67
        if (rendition && !rendition._dreaderResizePatched) {
            rendition._dreaderResizePatched = true;
            const origOnResized = rendition.onResized.bind(rendition);
            rendition.onResized = function (size, epubcfi) {
                if (isNavigatingToc) {
                    this.emit('resized', { width: size.width, height: size.height }, epubcfi);
                    return;
                }
                return origOnResized(size, epubcfi);
            };
        }

        // 3.2. Vá hàm book.spine.get() với so khớp ranh giới '/' nghiêm ngặt (Không bao giờ nhầm 3202 sang 67)
        if (!book.spine._dreaderPatchedV4) {
            book.spine._dreaderPatchedV4 = true;

            book.spine.spineItems.forEach((item, idx) => {
                item.linear = true;
                item.prev = () => (idx > 0 ? book.spine.spineItems[idx - 1] : undefined);
                item.next = () => (idx < book.spine.spineItems.length - 1 ? book.spine.spineItems[idx + 1] : undefined);
            });

            const origSpineGet = book.spine.get.bind(book.spine);
            book.spine.get = function (target) {
                if (target === undefined || target === null) return origSpineGet(target);

                // Thử hàm gốc của epub.js trước
                let res = origSpineGet(target);
                if (res) return res;

                if (typeof target === 'number') {
                    return this.spineItems[target] || null;
                }

                if (typeof target === 'string') {
                    const noHash = target.split('#')[0];
                    if (noHash) {
                        res = origSpineGet(noHash) || origSpineGet(decodeURIComponent(noHash));
                        if (res) return res;
                    }

                    const normTarget = normalizePath(noHash);
                    const targetFile = normTarget.split('/').pop();

                    if (normTarget) {
                        // Ưu tiên 1: Khớp chính xác đường dẫn hoặc khớp theo ranh giới thư mục '/'
                        res = this.spineItems.find(item => {
                            if (!item.href) return false;
                            const normItem = normalizePath(item.href);
                            return normItem === normTarget ||
                                ('/' + normItem).endsWith('/' + normTarget) ||
                                ('/' + normTarget).endsWith('/' + normItem);
                        });
                        if (res) return res;

                        // Ưu tiên 2: Khớp chính xác 100% tên file (VD: "3202.html" === "3202.html")
                        if (targetFile) {
                            res = this.spineItems.find(item => {
                                if (!item.href) return false;
                                const itemFile = normalizePath(item.href).split('/').pop();
                                return itemFile === targetFile;
                            });
                            if (res) return res;
                        }
                    }

                    // Ưu tiên 3: Nếu mục lục EPUB bị hỏng đường dẫn, tìm theo số chương đang bấm (VD: 3202)
                    const wantedNum = extractChapterNumber(desiredLabel);
                    if (wantedNum) {
                        const numRegex = new RegExp('(?:^|[^0-9])0*' + wantedNum + '(?:[^0-9]|$)');
                        res = this.spineItems.find(item => numRegex.test(item.href || '') || numRegex.test(item.idref || ''));
                        if (res) return res;
                    }
                }
                return null;
            };
        }
    }

    // 4. Tìm thẻ tiêu đề chương bên trong <iframe>
    function getHeadingBlock(el, body) {
        if (!el || el === body) return el;
        let curr = el;
        while (curr.parentElement && curr.parentElement !== body) {
            const parentText = (curr.parentElement.textContent || '').trim();
            if (parentText.length > 0 && parentText.length < 160 && curr.parentElement.children.length <= 3) {
                curr = curr.parentElement;
            } else {
                break;
            }
        }
        return curr;
    }

    function findChapterHeadingInDoc(iframeDoc, labelText, afterNode = null) {
        if (!iframeDoc || !iframeDoc.body || !labelText) return null;

        const cleanLabel = labelText.replace(/\s+/g, ' ').trim();
        const chapNum = extractChapterNumber(cleanLabel);
        if (!chapNum) return null;

        // Bắt chính xác số chương (VD: Chương 3202, Hồi 3202, 3202: ...)
        const strictNumRegex = new RegExp(
            '^(?:\\[[^\\]]*\\]\\s*)?(?:quyển\\s*\\d+[^\\n]*?)?(?:đệ\\s*)?(?:chương|hồi|phần|chapter|tiết)?\\s*0*' +
            chapNum + '(?![0-9])(?:\\s*[:.\\-–—]|\\s+|$)', 'i'
        );

        const titlePart = cleanLabel.includes(':')
            ? cleanLabel.split(':').slice(1).join(':').replace(/[.!?]+$/, '').trim().toLowerCase()
            : '';

        const candidates = iframeDoc.body.querySelectorAll('h1, h2, h3, h4, h5, h6, p, div, b, strong, span, center, a');
        let fallbackMatch = null;

        for (const el of candidates) {
            if (el.children.length > 5) continue;
            const rawText = (el.textContent || '').replace(/\s+/g, ' ').trim();
            if (!rawText || rawText.length > 160) continue;

            if (afterNode) {
                if (el === afterNode || afterNode.contains(el) || el.contains(afterNode)) continue;
                const pos = afterNode.compareDocumentPosition(el);
                if (!(pos & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
            }

            if (strictNumRegex.test(rawText)) {
                const block = getHeadingBlock(el, iframeDoc.body);
                if (afterNode && (block === afterNode || afterNode.contains(block) || block.contains(afterNode))) {
                    continue;
                }
                if (!titlePart || rawText.toLowerCase().includes(titlePart)) {
                    return block;
                }
                if (!fallbackMatch) fallbackMatch = block;
            }
        }
        return fallbackMatch;
    }

    // 5. Nếu file EPUB có mục lục trỏ sai file (bấm 3202 nhưng file mở ra lại là Chương 67),
    //    tự động tìm đúng file chứa Chương 3202 trong book.spine.spineItems và mở ngay!
    async function deepSearchAndDisplayCorrectSpine(wantedLabel) {
        if (!wantedLabel || deepSearchAttemptedFor === wantedLabel) return;
        deepSearchAttemptedFor = wantedLabel;

        const reader = getReaderObj();
        if (!reader || !reader.rendition) return;
        const book = reader.bookData || reader.book;
        const spineItems = book?.spine?.spineItems;
        if (!spineItems || spineItems.length <= 1) return;

        const chapNum = extractChapterNumber(wantedLabel);
        if (!chapNum) return;

        // 5.1. Tìm trong danh sách phẳng của book.navigation.toc hoặc reader.tocChapters trước
        if (reader.tocChapters && reader.tocChapters.length > 0) {
            const m = reader.tocChapters.find(it => extractChapterNumber(it.label) === chapNum);
            if (m && m.href) {
                const targetSec = book.spine.get(m.href);
                if (targetSec) {
                    await reader.rendition.display(targetSec.href);
                    return;
                }
            }
        }

        const flatToc = [];
        function flatten(items) {
            if (!Array.isArray(items)) return;
            items.forEach(it => {
                if (it.label && it.href) flatToc.push(it);
                if (it.subitems) flatten(it.subitems);
            });
        }
        if (book.navigation?.toc) flatten(book.navigation.toc);

        const cleanWanted = wantedLabel.replace(/\s+/g, ' ').trim().toLowerCase();
        const tocMatch = flatToc.find(it => it.label.replace(/\s+/g, ' ').trim().toLowerCase() === cleanWanted) ||
            flatToc.find(it => extractChapterNumber(it.label) === chapNum);

        if (tocMatch && tocMatch.href) {
            const targetSec = book.spine.get(tocMatch.href);
            if (targetSec) {
                await reader.rendition.display(targetSec.href);
                return;
            }
        }

        // 5.2. Quét nhanh các file xung quanh vị trí ước lượng trong spineItems
        const num = parseInt(chapNum, 10);
        const candidateIndices = new Set();

        // Vị trí tương ứng trực tiếp (nếu mỗi chương 1 file)
        for (let d = -5; d <= 15; d++) {
            const idx = num - 1 + d;
            if (idx >= 0 && idx < spineItems.length) candidateIndices.add(idx);
        }
        // Vị trí theo tỷ lệ (nếu EPUB gộp nhiều chương vào 1 file)
        if (flatToc.length > 0) {
            const tocIdx = flatToc.findIndex(it => extractChapterNumber(it.label) === chapNum);
            if (tocIdx !== -1) {
                const estSpineIdx = Math.floor((tocIdx / flatToc.length) * spineItems.length);
                for (let d = -3; d <= 3; d++) {
                    const idx = estSpineIdx + d;
                    if (idx >= 0 && idx < spineItems.length) candidateIndices.add(idx);
                }
            }
        }

        const checkRegex = new RegExp('(?:chương|hồi|chapter)\\s*0*' + chapNum + '(?![0-9])', 'i');
        for (const idx of candidateIndices) {
            const sec = spineItems[idx];
            if (!sec) continue;
            try {
                const doc = await sec.load(book.load.bind(book));
                const text = (doc.ownerDocument || doc).body?.textContent || '';
                if (checkRegex.test(text)) {
                    await reader.rendition.display(sec.href);
                    return;
                }
            } catch (e) { }
        }
    }

    function injectAntiClipCss(iframeDoc) {
        if (!iframeDoc || !iframeDoc.head || iframeDoc.getElementById('dreader-anti-clip-css')) return;
        const style = iframeDoc.createElement('style');
        style.id = 'dreader-anti-clip-css';
        style.textContent = `
            html, body {
                max-width: 100% !important;
                width: 100% !important;
                margin: 0 auto !important;
                padding-left: 40px !important;
                padding-right: 40px !important;
                padding-bottom: 140px !important;
                box-sizing: border-box !important;
                overflow-x: hidden !important;
            }
            h1, h2, h3, .chapter-title {
                display: block !important;
                margin-top: 2.5rem !important;
                margin-bottom: 1.5rem !important;
                scroll-margin-top: 85px !important;
                padding-top: 20px !important;
                page-break-before: always !important;
                clear: both !important;
            }
            p {
                text-indent: 1.5em !important;
                line-height: 1.8 !important;
                margin-bottom: 1rem !important;
            }
        `;
        iframeDoc.head.appendChild(style);
    }

    // 6. Kiểm tra nội dung trong <iframe>: Nếu là file gộp thì cắt đúng chương, nếu sai file thì tự nhảy sang file đúng
    function processLoadedIframe(attemptCount) {
        const iframes = document.querySelectorAll('.epub-container iframe, #viewer iframe, iframe');
        for (const iframeEl of iframes) {
            let iframeDoc;
            try {
                iframeDoc = iframeEl.contentDocument || iframeEl.contentWindow?.document;
            } catch (e) {
                continue;
            }
            if (!iframeDoc || !iframeDoc.body || iframeDoc.body.children.length === 0) continue;

            injectAntiClipCss(iframeDoc);

            if (!desiredLabel || !extractChapterNumber(desiredLabel)) return true;

            if (!iframeDoc._fullOriginalHtml) {
                iframeDoc._fullOriginalHtml = iframeDoc.body.innerHTML;
            }

            if (iframeDoc._isolatedForLabel === desiredLabel) return true;

            if (iframeDoc._isolatedForLabel && iframeDoc._isolatedForLabel !== desiredLabel) {
                iframeDoc.body.innerHTML = iframeDoc._fullOriginalHtml;
                iframeDoc._isolatedForLabel = null;
            }

            const startBlock = findChapterHeadingInDoc(iframeDoc, desiredLabel, null);
            if (!startBlock) {
                // Nếu sau 6 lần quét (khoảng 480ms) mà trong iframe vẫn là Chương 67 (không có Chương 3202),
                // kích hoạt tìm kiếm trực tiếp trong Spine để ép chuyển sang đúng file của Chương 3202!
                if (attemptCount === 6) {
                    deepSearchAndDisplayCorrectSpine(desiredLabel);
                }
                return false;
            }

            // Kiểm tra xem trước hoặc sau startBlock có chương khác nằm chung file XHTML không
            const currentChapNum = extractChapterNumber(desiredLabel);
            let endBlock = null;
            if (desiredNextLabel) {
                endBlock = findChapterHeadingInDoc(iframeDoc, desiredNextLabel, startBlock);
            }
            if (!endBlock && currentChapNum) {
                endBlock = findChapterHeadingInDoc(iframeDoc, `Chương ${parseInt(currentChapNum, 10) + 1}`, startBlock);
            }

            // Kiểm tra xem phía trên startBlock có văn bản của chương trước đó không
            const rangeBefore = iframeDoc.createRange();
            rangeBefore.setStart(iframeDoc.body, 0);
            rangeBefore.setEndBefore(startBlock);
            const textBefore = rangeBefore.toString().trim();

            if (endBlock && iframeDoc.body.contains(endBlock)) {
                const rangeAfter = iframeDoc.createRange();
                rangeAfter.setStartBefore(endBlock);
                rangeAfter.setEnd(iframeDoc.body, iframeDoc.body.childNodes.length);
                rangeAfter.deleteContents();
            }

            if (textBefore.length > 80 && iframeDoc.body.contains(startBlock)) {
                rangeBefore.deleteContents();
            }

            iframeDoc._isolatedForLabel = desiredLabel;

            // Đưa thanh cuộn về đầu chương vừa mở
            const scrollers = [
                document.querySelector('.epub-container'),
                document.getElementById('viewer'),
                iframeDoc.scrollingElement,
                iframeDoc.documentElement,
                iframeDoc.body
            ];
            scrollers.forEach(s => { if (s) s.scrollTop = 0; });

            return true;
        }
        return false;
    }

    function lockSingleActiveToc() {
        const allActive = document.querySelectorAll('.toc-item.active, #tocList .active, [data-href].active');
        if (targetTocEl && document.body.contains(targetTocEl)) {
            allActive.forEach(el => {
                if (el !== targetTocEl) el.classList.remove('active');
            });
            if (!targetTocEl.classList.contains('active')) {
                targetTocEl.classList.add('active');
            }
        } else if (allActive.length > 1) {
            allActive.forEach((el, idx) => {
                if (idx > 0) el.classList.remove('active');
            });
        }
    }

    // 7. Bắt sự kiện khi người dùng bấm chọn chương trong Mục lục
    document.addEventListener('click', (e) => {
        const tocItem = e.target.closest('.toc-item, #tocList li, #tocList a, [data-href]');
        if (!tocItem) return;

        const inSidebar = tocItem.closest('#tocSidebar, .toc-sidebar, .sidebar, #tocList, .toc-list, aside');
        if (!inSidebar && !tocItem.classList.contains('toc-item')) return;

        patchBookAndRendition();

        targetTocEl = tocItem;
        desiredLabel = (tocItem.textContent || '').replace(/\s+/g, ' ').trim();
        deepSearchAttemptedFor = '';
        isNavigatingToc = true;

        const allTocItems = Array.from(document.querySelectorAll('.toc-item, #tocList li, #tocList a, [data-href]'));
        const currentIndex = allTocItems.indexOf(tocItem);
        desiredNextLabel = (currentIndex !== -1 && currentIndex + 1 < allTocItems.length)
            ? (allTocItems[currentIndex + 1].textContent || '').replace(/\s+/g, ' ').trim()
            : '';

        lockSingleActiveToc();

        if (pollTimer) clearInterval(pollTimer);
        let attempts = 0;
        pollTimer = setInterval(() => {
            attempts++;
            lockSingleActiveToc();
            const done = processLoadedIframe(attempts);
            if ((done && attempts >= 4) || attempts > 35) {
                clearInterval(pollTimer);
                pollTimer = null;
                setTimeout(() => { isNavigatingToc = false; }, 300);
            }
        }, 80);
    }, true);

    setInterval(() => {
        patchBookAndRendition();
        lockSingleActiveToc();
    }, 300);
})();



/* ==========================================================================
   D_READER: HIỂN THỊ CHƯƠNG HIỆN TẠI TRÊN THANH CÔNG CỤ & TỰ CUỘN MỤC LỤC
   ========================================================================== */
(function initChapterIndicatorAndTocAutoScroll() {
    // 1. Bơm CSS cho nhãn hiển thị chương hiện tại trên thanh công cụ phía trên
    if (!document.getElementById('dreader-chapter-indicator-style')) {
        const style = document.createElement('style');
        style.id = 'dreader-chapter-indicator-style';
        style.textContent = `
            #dreader-current-chapter-badge {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                max-width: 340px;
                padding: 4px 12px;
                margin-left: 8px;
                border-radius: 999px;
                background: rgba(99, 102, 241, 0.16);
                border: 1px solid rgba(129, 140, 248, 0.38);
                color: #a5b4fc;
                font-size: 13px;
                font-weight: 600;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                cursor: pointer;
                transition: all 0.2s ease;
                vertical-align: middle;
                flex-shrink: 1;
            }
            #dreader-current-chapter-badge:hover {
                background: rgba(99, 102, 241, 0.28);
                color: #ffffff;
            }
            #dreader-current-chapter-badge::before {
                content: "📖";
                font-size: 12px;
                flex-shrink: 0;
            }
            @media (max-width: 1100px) {
                #dreader-current-chapter-badge {
                    max-width: 200px;
                }
            }
            /* Hiệu ứng nháy nhẹ giúp mắt nhận ra ngay chương đang đọc khi mở Mục lục */
            .dreader-toc-flash {
                outline: 2px solid #818cf8 !important;
                background-color: rgba(99, 102, 241, 0.35) !important;
                transition: background-color 0.4s ease;
            }
        `;
        document.head.appendChild(style);
    }

    let lastKnownChapterLabel = '';
    let wasSidebarOpen = false;

    function extractChapterNumber(text) {
        if (!text) return null;
        const m = text.match(/(?:chương|hồi|phần|chapter|tiết)\s*0*(\d+)(?![0-9])/i)
            || text.trim().match(/^0*(\d+)[\s:.\-–—]/);
        return m ? m[1] : null;
    }

    // 2. Tạo hoặc cập nhật nhãn tên chương ngay cạnh tên truyện trên thanh công cụ phía trên
    function updateTopChapterBadge(chapterTitle) {
        const cleanTitle = (chapterTitle || '').replace(/\s+/g, ' ').trim();
        if (!cleanTitle) return;
        lastKnownChapterLabel = cleanTitle;

        let badge = document.getElementById('dreader-current-chapter-badge');
        if (!badge) {
            // Tìm nút "Thư viện" trên thanh công cụ để xác định đúng hàng toolbar
            const libBtn = Array.from(document.querySelectorAll('button, a')).find(
                el => (el.textContent || '').includes('Thư viện')
            );
            const toolbar = libBtn ? libBtn.closest('div, nav, header') : null;

            // Tìm phần tử đang hiển thị tên truyện cạnh nút mở Mục lục (≡)
            const titleEl = document.querySelector('#currentBookTitle, #bookTitle, #readerBookTitle, .reader-book-title, .book-title, .current-book-title')
                || (toolbar && Array.from(toolbar.querySelectorAll('span, div, h1, h2, p')).find(el => {
                    const t = (el.textContent || '').trim();
                    return t.length > 2 && !t.includes('Thư viện') && !t.includes('Đã lưu') && el.children.length === 0;
                }));

            badge = document.createElement('span');
            badge.id = 'dreader-current-chapter-badge';
            badge.title = 'Bấm để mở Mục lục và nhảy tới chương đang đọc';

            // Khi bấm vào nhãn chương trên thanh công cụ -> Mở Mục lục và cuộn tới chương này
            badge.addEventListener('click', () => {
                const sidebar = getTocSidebar();
                if (sidebar && !isElementVisible(sidebar)) {
                    const tocToggleBtn = findTocToggleButton();
                    if (tocToggleBtn) tocToggleBtn.click();
                }
                setTimeout(() => scrollTocToCurrentChapter(true), 80);
            });

            if (titleEl && titleEl.parentElement) {
                titleEl.insertAdjacentElement('afterend', badge);
            } else if (toolbar) {
                toolbar.appendChild(badge);
            }
        }

        if (badge && badge.textContent !== cleanTitle) {
            badge.textContent = cleanTitle;
            badge.setAttribute('data-full-title', cleanTitle);
        }
    }

    // 3. Tự động nhận diện chương đang hiển thị thực tế trong khung đọc (kể cả khi TTS tự lật chương)
    function detectCurrentChapterFromView() {
        // Ưu tiên 1: Lấy từ mục đang active trong danh sách Mục lục
        const activeToc = document.querySelector('.toc-item.active, #tocList .active, [data-href].active');
        if (activeToc && activeToc.textContent.trim()) {
            const tocText = activeToc.textContent.replace(/\s+/g, ' ').trim();
            if (tocText !== lastKnownChapterLabel) {
                updateTopChapterBadge(tocText);
            }
        }

        // Ưu tiên 2: Quét tiêu đề chương bên trong <iframe> đang hiển thị
        const iframes = document.querySelectorAll('.epub-container iframe, #viewer iframe, iframe');
        for (const iframeEl of iframes) {
            let iframeDoc;
            try {
                iframeDoc = iframeEl.contentDocument || iframeEl.contentWindow?.document;
            } catch (e) {
                continue;
            }
            if (!iframeDoc || !iframeDoc.body) continue;

            const headings = iframeDoc.querySelectorAll('h1, h2, h3, h4, .chapter-title, .title, p, div');
            for (const h of headings) {
                if (h.children.length > 4) continue;
                const txt = (h.textContent || '').replace(/\s+/g, ' ').trim();
                if (!txt || txt.length > 150) continue;

                if (/^(?:\[[^\]]*\]\s*)?(?:quyển\s*\d+.*?)?(?:đệ\s*)?(?:chương|hồi|phần|chapter|tiết)\s*\d+/i.test(txt)) {
                    if (txt !== lastKnownChapterLabel) {
                        updateTopChapterBadge(txt);
                        syncActiveClassInToc(txt);
                    }
                    return;
                }
            }
        }
    }

    // 4. Đồng bộ class .active trong danh sách Mục lục theo tên/số chương đang đọc
    function syncActiveClassInToc(chapterLabel) {
        const tocItems = Array.from(document.querySelectorAll('.toc-item, #tocList li, #tocList a, [data-href]'));
        if (tocItems.length === 0) return;

        const cleanTarget = chapterLabel.toLowerCase().trim();
        const targetNum = extractChapterNumber(chapterLabel);

        let matchedItem = tocItems.find(el => (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase() === cleanTarget);
        if (!matchedItem && targetNum) {
            matchedItem = tocItems.find(el => extractChapterNumber(el.textContent || '') === targetNum);
        }

        if (matchedItem && !matchedItem.classList.contains('active')) {
            tocItems.forEach(el => el.classList.remove('active'));
            matchedItem.classList.add('active');
        }
    }

    // 5. Tìm khung Sidebar Mục lục và thẻ chứa thanh cuộn của Mục lục
    function getTocSidebar() {
        return document.querySelector('#tocSidebar, .toc-sidebar, #sidebar, .sidebar, aside');
    }

    function findTocToggleButton() {
        return document.querySelector('#btnToggleToc, #btnToc, #tocToggle, #toggleTocBtn, [data-action="toggle-toc"]')
            || Array.from(document.querySelectorAll('button')).find(btn => {
                const title = (btn.getAttribute('title') || btn.getAttribute('aria-label') || '').toLowerCase();
                return title.includes('mục lục') || title.includes('toc');
            });
    }

    function isElementVisible(el) {
        if (!el) return false;
        if (el.classList.contains('active') || el.classList.contains('open')) return true;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 20 && rect.height > 20 && rect.right > 0;
    }

    function findScrollableParent(el) {
        let curr = el.parentElement;
        while (curr && curr !== document.body) {
            const style = window.getComputedStyle(curr);
            if (curr.scrollHeight > curr.clientHeight + 5 && ['auto', 'scroll', 'overlay'].includes(style.overflowY)) {
                return curr;
            }
            curr = curr.parentElement;
        }
        return document.querySelector('#tocList, .toc-list, #tocPanel, .toc-panel') || el.parentElement;
    }

    // 6. Hàm cuộn thanh Mục lục đưa chương đang đọc ra chính giữa danh sách
    function scrollTocToCurrentChapter(highlightFlash = false) {
        if (lastKnownChapterLabel) {
            syncActiveClassInToc(lastKnownChapterLabel);
        }

        const activeItem = document.querySelector('.toc-item.active, #tocList .active, [data-href].active');
        if (!activeItem) return;

        const scrollBox = findScrollableParent(activeItem);
        if (!scrollBox) return;

        const boxRect = scrollBox.getBoundingClientRect();
        const itemRect = activeItem.getBoundingClientRect();

        if (boxRect.height > 0) {
            // Đưa chương đang đọc vào đúng giữa khung Mục lục
            const targetScrollTop = scrollBox.scrollTop + (itemRect.top - boxRect.top) - (boxRect.height / 2) + (itemRect.height / 2);
            scrollBox.scrollTop = Math.max(0, targetScrollTop);
        } else {
            activeItem.scrollIntoView({ block: 'center', behavior: 'auto' });
        }

        if (highlightFlash) {
            activeItem.classList.add('dreader-toc-flash');
            setTimeout(() => activeItem.classList.remove('dreader-toc-flash'), 1200);
        }
    }

    // 7. Lắng nghe sự kiện bấm mở Mục lục (nút ≡ hoặc tab "Mục lục")
    document.addEventListener('click', (e) => {
        const clickedTocBtn = e.target.closest('#btnToggleToc, #btnToc, #tocToggle, #toggleTocBtn, button, [role="tab"]');
        if (!clickedTocBtn) return;

        const btnText = (clickedTocBtn.textContent || '').trim();
        const btnTitle = (clickedTocBtn.getAttribute('title') || '').toLowerCase();
        const isTocButton = clickedTocBtn.id?.toLowerCase().includes('toc')
            || btnTitle.includes('mục lục')
            || btnText === 'Mục lục'
            || (clickedTocBtn.closest('div, nav, header')?.textContent?.includes('Thư viện') && clickedTocBtn.querySelector('svg, i'));

        if (isTocButton) {
            // Chạy ở 2 mốc thời gian (50ms và 220ms) để đón cả trường hợp sidebar trượt ra có animation
            setTimeout(() => scrollTocToCurrentChapter(true), 50);
            setTimeout(() => scrollTocToCurrentChapter(false), 220);
        }
    }, true);

    // 8. Theo dõi trạng thái đóng/mở của Sidebar Mục lục và cập nhật tiêu đề chương định kỳ
    setInterval(() => {
        detectCurrentChapterFromView();

        const sidebar = getTocSidebar();
        const isOpenNow = isElementVisible(sidebar);
        if (isOpenNow && !wasSidebarOpen) {
            setTimeout(() => scrollTocToCurrentChapter(true), 40);
        }
        wasSidebarOpen = isOpenNow;
    }, 350);
})();


/* ==========================================================================
   D_READER: HIỂN THỊ CHƯƠNG HIỆN TẠI TRÊN THANH CÔNG CỤ & TỰ CUỘN MỤC LỤC
   ========================================================================== */
(function initChapterIndicatorAndTocAutoScroll() {
    // 1. Bơm CSS cho nhãn hiển thị chương hiện tại trên thanh công cụ phía trên
    if (!document.getElementById('dreader-chapter-indicator-style')) {
        const style = document.createElement('style');
        style.id = 'dreader-chapter-indicator-style';
        style.textContent = `
            #dreader-current-chapter-badge {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                max-width: 340px;
                padding: 4px 12px;
                margin-left: 8px;
                border-radius: 999px;
                background: rgba(99, 102, 241, 0.16);
                border: 1px solid rgba(129, 140, 248, 0.38);
                color: #a5b4fc;
                font-size: 13px;
                font-weight: 600;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                cursor: pointer;
                transition: all 0.2s ease;
                vertical-align: middle;
                flex-shrink: 1;
            }
            #dreader-current-chapter-badge:hover {
                background: rgba(99, 102, 241, 0.28);
                color: #ffffff;
            }
            #dreader-current-chapter-badge::before {
                content: "📖";
                font-size: 12px;
                flex-shrink: 0;
            }
            @media (max-width: 1100px) {
                #dreader-current-chapter-badge {
                    max-width: 200px;
                }
            }
            /* Hiệu ứng nháy nhẹ giúp mắt nhận ra ngay chương đang đọc khi mở Mục lục */
            .dreader-toc-flash {
                outline: 2px solid #818cf8 !important;
                background-color: rgba(99, 102, 241, 0.35) !important;
                transition: background-color 0.4s ease;
            }
        `;
        document.head.appendChild(style);
    }

    let lastKnownChapterLabel = '';
    let wasSidebarOpen = false;

    function extractChapterNumber(text) {
        if (!text) return null;
        const m = text.match(/(?:chương|hồi|phần|chapter|tiết)\s*0*(\d+)(?![0-9])/i)
            || text.trim().match(/^0*(\d+)[\s:.\-–—]/);
        return m ? m[1] : null;
    }

    // 2. Tạo hoặc cập nhật nhãn tên chương ngay cạnh tên truyện trên thanh công cụ phía trên
    function updateTopChapterBadge(chapterTitle) {
        const cleanTitle = (chapterTitle || '').replace(/\s+/g, ' ').trim();
        if (!cleanTitle) return;
        lastKnownChapterLabel = cleanTitle;

        let badge = document.getElementById('dreader-current-chapter-badge');
        if (!badge) {
            // Tìm nút "Thư viện" trên thanh công cụ để xác định đúng hàng toolbar
            const libBtn = Array.from(document.querySelectorAll('button, a')).find(
                el => (el.textContent || '').includes('Thư viện')
            );
            const toolbar = libBtn ? libBtn.closest('div, nav, header') : null;

            // Tìm phần tử đang hiển thị tên truyện cạnh nút mở Mục lục (≡)
            const titleEl = document.querySelector('#currentBookTitle, #bookTitle, #readerBookTitle, .reader-book-title, .book-title, .current-book-title')
                || (toolbar && Array.from(toolbar.querySelectorAll('span, div, h1, h2, p')).find(el => {
                    const t = (el.textContent || '').trim();
                    return t.length > 2 && !t.includes('Thư viện') && !t.includes('Đã lưu') && el.children.length === 0;
                }));

            badge = document.createElement('span');
            badge.id = 'dreader-current-chapter-badge';
            badge.title = 'Bấm để mở Mục lục và nhảy tới chương đang đọc';

            // Khi bấm vào nhãn chương trên thanh công cụ -> Mở Mục lục và cuộn tới chương này
            badge.addEventListener('click', () => {
                const sidebar = getTocSidebar();
                if (sidebar && !isElementVisible(sidebar)) {
                    const tocToggleBtn = findTocToggleButton();
                    if (tocToggleBtn) tocToggleBtn.click();
                }
                setTimeout(() => scrollTocToCurrentChapter(true), 80);
            });

            if (titleEl && titleEl.parentElement) {
                titleEl.insertAdjacentElement('afterend', badge);
            } else if (toolbar) {
                toolbar.appendChild(badge);
            }
        }

        if (badge && badge.textContent !== cleanTitle) {
            badge.textContent = cleanTitle;
            badge.setAttribute('data-full-title', cleanTitle);
        }
    }

    // 3. Tự động nhận diện chương đang hiển thị thực tế trong khung đọc (kể cả khi TTS tự lật chương)
    function detectCurrentChapterFromView() {
        // Ưu tiên 1: Lấy từ mục đang active trong danh sách Mục lục
        const activeToc = document.querySelector('.toc-item.active, #tocList .active, [data-href].active');
        if (activeToc && activeToc.textContent.trim()) {
            const tocText = activeToc.textContent.replace(/\s+/g, ' ').trim();
            if (tocText !== lastKnownChapterLabel) {
                updateTopChapterBadge(tocText);
            }
        }

        // Ưu tiên 2: Quét tiêu đề chương bên trong <iframe> đang hiển thị
        const iframes = document.querySelectorAll('.epub-container iframe, #viewer iframe, iframe');
        for (const iframeEl of iframes) {
            let iframeDoc;
            try {
                iframeDoc = iframeEl.contentDocument || iframeEl.contentWindow?.document;
            } catch (e) {
                continue;
            }
            if (!iframeDoc || !iframeDoc.body) continue;

            const headings = iframeDoc.querySelectorAll('h1, h2, h3, h4, .chapter-title, .title, p, div');
            for (const h of headings) {
                if (h.children.length > 4) continue;
                const txt = (h.textContent || '').replace(/\s+/g, ' ').trim();
                if (!txt || txt.length > 150) continue;

                if (/^(?:\[[^\]]*\]\s*)?(?:quyển\s*\d+.*?)?(?:đệ\s*)?(?:chương|hồi|phần|chapter|tiết)\s*\d+/i.test(txt)) {
                    if (txt !== lastKnownChapterLabel) {
                        updateTopChapterBadge(txt);
                        syncActiveClassInToc(txt);
                    }
                    return;
                }
            }
        }
    }

    // 4. Đồng bộ class .active trong danh sách Mục lục theo tên/số chương đang đọc
    function syncActiveClassInToc(chapterLabel) {
        const tocItems = Array.from(document.querySelectorAll('.toc-item, #tocList li, #tocList a, [data-href]'));
        if (tocItems.length === 0) return;

        const cleanTarget = chapterLabel.toLowerCase().trim();
        const targetNum = extractChapterNumber(chapterLabel);

        let matchedItem = tocItems.find(el => (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase() === cleanTarget);
        if (!matchedItem && targetNum) {
            matchedItem = tocItems.find(el => extractChapterNumber(el.textContent || '') === targetNum);
        }

        if (matchedItem && !matchedItem.classList.contains('active')) {
            tocItems.forEach(el => el.classList.remove('active'));
            matchedItem.classList.add('active');
        }
    }

    // 5. Tìm khung Sidebar Mục lục và thẻ chứa thanh cuộn của Mục lục
    function getTocSidebar() {
        return document.querySelector('#tocSidebar, .toc-sidebar, #sidebar, .sidebar, aside');
    }

    function findTocToggleButton() {
        return document.querySelector('#btnToggleToc, #btnToc, #tocToggle, #toggleTocBtn, [data-action="toggle-toc"]')
            || Array.from(document.querySelectorAll('button')).find(btn => {
                const title = (btn.getAttribute('title') || btn.getAttribute('aria-label') || '').toLowerCase();
                return title.includes('mục lục') || title.includes('toc');
            });
    }

    function isElementVisible(el) {
        if (!el) return false;
        if (el.classList.contains('active') || el.classList.contains('open')) return true;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 20 && rect.height > 20 && rect.right > 0;
    }

    function findScrollableParent(el) {
        let curr = el.parentElement;
        while (curr && curr !== document.body) {
            const style = window.getComputedStyle(curr);
            if (curr.scrollHeight > curr.clientHeight + 5 && ['auto', 'scroll', 'overlay'].includes(style.overflowY)) {
                return curr;
            }
            curr = curr.parentElement;
        }
        return document.querySelector('#tocList, .toc-list, #tocPanel, .toc-panel') || el.parentElement;
    }

    // 6. Hàm cuộn thanh Mục lục đưa chương đang đọc ra chính giữa danh sách
    function scrollTocToCurrentChapter(highlightFlash = false) {
        if (lastKnownChapterLabel) {
            syncActiveClassInToc(lastKnownChapterLabel);
        }

        const activeItem = document.querySelector('.toc-item.active, #tocList .active, [data-href].active');
        if (!activeItem) return;

        const scrollBox = findScrollableParent(activeItem);
        if (!scrollBox) return;

        const boxRect = scrollBox.getBoundingClientRect();
        const itemRect = activeItem.getBoundingClientRect();

        if (boxRect.height > 0) {
            // Đưa chương đang đọc vào đúng giữa khung Mục lục
            const targetScrollTop = scrollBox.scrollTop + (itemRect.top - boxRect.top) - (boxRect.height / 2) + (itemRect.height / 2);
            scrollBox.scrollTop = Math.max(0, targetScrollTop);
        } else {
            activeItem.scrollIntoView({ block: 'center', behavior: 'auto' });
        }

        if (highlightFlash) {
            activeItem.classList.add('dreader-toc-flash');
            setTimeout(() => activeItem.classList.remove('dreader-toc-flash'), 1200);
        }
    }

    // 7. Lắng nghe sự kiện bấm mở Mục lục (nút ≡ hoặc tab "Mục lục")
    document.addEventListener('click', (e) => {
        const clickedTocBtn = e.target.closest('#btnToggleToc, #btnToc, #tocToggle, #toggleTocBtn, button, [role="tab"]');
        if (!clickedTocBtn) return;

        const btnText = (clickedTocBtn.textContent || '').trim();
        const btnTitle = (clickedTocBtn.getAttribute('title') || '').toLowerCase();
        const isTocButton = clickedTocBtn.id?.toLowerCase().includes('toc')
            || btnTitle.includes('mục lục')
            || btnText === 'Mục lục'
            || (clickedTocBtn.closest('div, nav, header')?.textContent?.includes('Thư viện') && clickedTocBtn.querySelector('svg, i'));

        if (isTocButton) {
            // Chạy ở 2 mốc thời gian (50ms và 220ms) để đón cả trường hợp sidebar trượt ra có animation
            setTimeout(() => scrollTocToCurrentChapter(true), 50);
            setTimeout(() => scrollTocToCurrentChapter(false), 220);
        }
    }, true);

    // 8. Theo dõi trạng thái đóng/mở của Sidebar Mục lục và cập nhật tiêu đề chương định kỳ
    setInterval(() => {
        detectCurrentChapterFromView();

        const sidebar = getTocSidebar();
        const isOpenNow = isElementVisible(sidebar);
        if (isOpenNow && !wasSidebarOpen) {
            setTimeout(() => scrollTocToCurrentChapter(true), 40);
        }
        wasSidebarOpen = isOpenNow;
    }, 350);
})();

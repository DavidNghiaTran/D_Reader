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
    bookmarks: [],
    readMode: 'scrolled-doc',
    zenMode: false,
    settings: {
        theme: 'dark',
        fontSize: 16,
        fontFamily: 'sans-serif',
        lineHeight: 1.6,
        ttsRate: 1.0,
        ttsPitch: 1.0,
        ttsVolume: 1.0,
        voiceUri: 'google-vi-online',
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
            this.settings.fontFamily = e.target.value;
            this.applyRenditionTheme();
            this.saveSettings();
        });

        // Font size
        document.getElementById('btnFontLess')?.addEventListener('click', () => {
            if (this.settings.fontSize > 12) { this.setFontSize(this.settings.fontSize - 2); this.saveSettings(); }
        });
        document.getElementById('btnFontMore')?.addEventListener('click', () => {
            if (this.settings.fontSize < 32) { this.setFontSize(this.settings.fontSize + 2); this.saveSettings(); }
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

        // Zen mode toggle button
        document.getElementById('btnToggleZen')?.addEventListener('click', () => this.toggleZenMode());

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (App.currentView !== 'readerView') return;
            const tag = document.activeElement?.tagName;
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
                    TTSEngine.initAudioContext();
                    TTSEngine.togglePlayPause();
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
        });
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

        const fontSelect = document.getElementById('selectFont');
        if (fontSelect) fontSelect.value = this.settings.fontFamily || 'sans-serif';

        const fontDisplay = document.getElementById('fontSizeDisplay');
        if (fontDisplay) fontDisplay.textContent = `${this.settings.fontSize || 16}px`;

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
    },

    getContentWidthConfig() {
        const widthConfig = {
            standard: { viewerMax: '960px', bodyMax: '860px', padding: '24px 36px' },
            wide:     { viewerMax: '1400px', bodyMax: '1300px', padding: '24px 36px' },
            full:     { viewerMax: '96vw',   bodyMax: '94vw',   padding: '24px 40px' }
        };
        return widthConfig[this.settings.contentWidth || 'wide'] || widthConfig.wide;
    },

    setContentWidth(widthMode) {
        this.settings.contentWidth = widthMode || 'wide';
        localStorage.setItem('dreader_content_width', this.settings.contentWidth);
        const cfg = this.getContentWidthConfig();
        document.documentElement.style.setProperty('--reader-max-width', cfg.viewerMax);

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

        // Show TTS bar + Zen button
        const ttsBar = document.getElementById('ttsBar');
        if (ttsBar) ttsBar.classList.remove('tts-hidden');
        document.getElementById('btnToggleZen')?.style.setProperty('display', 'flex');

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

    async buildRendition(viewer) {
        const flow = this.readMode || 'scrolled-doc';
        this.rendition = this.bookData.renderTo('viewer', {
            manager: 'default',
            flow: flow,
            width: '100%',
            height: '100%',
            ...(flow === 'paginated' ? { spread: 'auto' } : {})
        });

        // Inject CSS into EPUB iframe
        this.rendition.hooks.content.register((contents) => {
            this.injectIframeStyles(contents);
        });

        this.applyRenditionTheme();
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
            dark:  { bg: '#121214', text: '#E4E4E7', highlight: 'rgba(129,140,248,0.28)' },
            light: { bg: '#FAF9F5', text: '#1C1C1E', highlight: 'rgba(250,204,21,0.38)' },
            sepia: { bg: '#F4ECD8', text: '#3B2E1E', highlight: 'rgba(217,119,6,0.28)' },
            mint:  { bg: '#E3EDCD', text: '#283618', highlight: 'rgba(132,169,83,0.35)' },
        };
        const t = themeMap[theme] || themeMap.dark;
        const fontFamily = this.settings.fontFamily === 'serif'
            ? "'Merriweather', 'Georgia', serif"
            : "'Inter', system-ui, sans-serif";

        const cfg = this.getContentWidthConfig();
        contents.addStylesheetRules({
            'html, body': {
                'box-sizing': 'border-box !important',
                'background-color': `${t.bg} !important`,
                'color': `${t.text} !important`,
                'font-family': `${fontFamily} !important`,
                'font-size': `${this.settings.fontSize || 16}px !important`,
                'line-height': `${this.settings.lineHeight || 1.6} !important`,
                'width': '100% !important',
                'max-width': `${cfg.bodyMax} !important`,
                'margin': '0 auto !important',
                'padding': `${cfg.padding} !important`,
                'overflow-x': 'hidden !important',
                'word-wrap': 'break-word !important',
                'overflow-wrap': 'break-word !important',
            },
            'p, div, span, h1, h2, h3, h4, h5, h6, li, td, th': {
                'color': `${t.text} !important`,
                'background': 'transparent !important',
                'max-width': '100% !important',
                'box-sizing': 'border-box !important',
                'word-wrap': 'break-word !important',
                'overflow-wrap': 'break-word !important',
            },
            '::-webkit-scrollbar': {
                'width': '7px !important',
                'height': '7px !important',
            },
            '::-webkit-scrollbar-track': {
                'background': 'transparent !important',
            },
            '::-webkit-scrollbar-thumb': {
                'background': 'rgba(255, 255, 255, 0.2) !important',
                'border-radius': '4px !important',
            },
            '::-webkit-scrollbar-thumb:hover': {
                'background': 'rgba(255, 255, 255, 0.38) !important',
            },
            'a': { 'color': '#818CF8 !important' },
            '*, *::before, *::after': {
                'box-sizing': 'border-box !important',
            },
            '.tts-karaoke-highlight': {
                'background-color': `${t.highlight} !important`,
                'border-radius': '4px !important',
                'padding': '1px 3px !important',
                'transition': 'background-color 0.2s ease !important',
            },
        });
    },

    applyRenditionTheme() {
        if (!this.rendition) return;
        const theme = this.settings.theme || 'dark';
        const themeMap = {
            dark:  { bg: '#121214', text: '#E4E4E7' },
            light: { bg: '#FAF9F5', text: '#1C1C1E' },
            sepia: { bg: '#F4ECD8', text: '#3B2E1E' },
            mint:  { bg: '#E3EDCD', text: '#283618' },
        };
        const t = themeMap[theme] || themeMap.dark;
        const fontFamily = this.settings.fontFamily === 'serif'
            ? "'Merriweather', 'Georgia', serif"
            : "'Inter', system-ui, sans-serif";
        const cfg = this.getContentWidthConfig();

        this.rendition.themes.register('custom', {
            'html, body': {
                'box-sizing': 'border-box !important',
                'background-color': `${t.bg} !important`,
                'color': `${t.text} !important`,
                'font-family': `${fontFamily} !important`,
                'font-size': `${this.settings.fontSize || 16}px !important`,
                'line-height': `${this.settings.lineHeight || 1.6} !important`,
                'width': '100% !important',
                'max-width': `${cfg.bodyMax} !important`,
                'margin': '0 auto !important',
                'padding': `${cfg.padding} !important`,
                'overflow-x': 'hidden !important',
                'word-wrap': 'break-word !important',
                'overflow-wrap': 'break-word !important',
            },
            'p, div, span, h1, h2, h3, h4, h5, h6': {
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
        this.settings.fontSize = size;
        const display = document.getElementById('fontSizeDisplay');
        if (display) display.textContent = `${size}px`;
        this.applyRenditionTheme();
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

    /** Click-to-read functionality */
    handleReaderClick(e) {
        try {
            const contents = this.rendition?.getContents();
            if (!contents?.length) return;
            const doc = contents[0].document;

            let node = null, offset = 0;
            if (doc.caretPositionFromPoint) {
                const pos = doc.caretPositionFromPoint(e.clientX, e.clientY);
                if (pos) { node = pos.offsetNode; offset = pos.offset; }
            } else if (doc.caretRangeFromPoint) {
                const range = doc.caretRangeFromPoint(e.clientX, e.clientY);
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
            }
        } catch (err) {
            console.error('Click-to-read error', err);
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

const varFontSans = "'Inter', system-ui, sans-serif";
const varFontSerif = "'Merriweather', 'Georgia', serif";

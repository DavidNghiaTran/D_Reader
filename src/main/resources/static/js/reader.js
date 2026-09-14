const Reader = {
    bookId: null,
    book: null,
    rendition: null,
    bookData: null,
    currentCfi: '',
    progressPercentage: 0,
    saveProgressTimeout: null,
    sessionStartTime: null,
    isTtsNavigating: false,
    bookmarks: [],
    settings: {
        theme: 'dark',
        fontSize: 16,
        fontFamily: 'sans-serif',
        lineHeight: 1.5,
        ttsRate: 1.0,
        ttsPitch: 1.0,
        voiceUri: 'google-vi-online'
    },

    init() {
        this.bindEvents();
        this.loadSettings();
    },

    bindEvents() {
        const btnBack = document.getElementById('btnBackToLibrary');
        const btnToc = document.getElementById('btnToggleToc');
        const themeSelect = document.getElementById('selectTheme');
        const fontSelect = document.getElementById('selectFont');
        const btnFontLess = document.getElementById('btnFontLess');
        const btnFontMore = document.getElementById('btnFontMore');
        const prevBtn = document.getElementById('prevPageBtn');
        const nextBtn = document.getElementById('nextPageBtn');
        const btnAddBookmark = document.getElementById('btnAddBookmark');
        const btnCloseToc = document.getElementById('btnCloseToc');

        if (btnBack) btnBack.addEventListener('click', () => {
            this.flushSaveProgress();
            TTS.stop();
            App.switchView('libraryView');
            Library.loadBooks();
        });

        window.addEventListener('pagehide', () => this.flushSaveProgress());
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                this.flushSaveProgress();
            }
        });

        if (btnToc) btnToc.addEventListener('click', (e) => {
            e.stopPropagation();
            const sidebar = document.getElementById('tocSidebar');
            if (sidebar) sidebar.classList.toggle('active');
        });

        if (btnCloseToc) btnCloseToc.addEventListener('click', (e) => {
            e.stopPropagation();
            const sidebar = document.getElementById('tocSidebar');
            if (sidebar) sidebar.classList.remove('active');
        });

        document.addEventListener('click', (e) => {
            const sidebar = document.getElementById('tocSidebar');
            const btnToc = document.getElementById('btnToggleToc');
            if (sidebar && sidebar.classList.contains('active')) {
                if (!sidebar.contains(e.target) && btnToc && !btnToc.contains(e.target)) {
                    sidebar.classList.remove('active');
                }
            }
        });

        if (themeSelect) themeSelect.addEventListener('change', (e) => {
            this.setTheme(e.target.value);
            this.saveSettings();
        });

        if (fontSelect) fontSelect.addEventListener('change', (e) => {
            this.setFontFamily(e.target.value);
        });

        if (btnFontLess) btnFontLess.addEventListener('click', () => {
            if (this.settings.fontSize > 12) {
                this.setFontSize(this.settings.fontSize - 2);
                this.saveSettings();
            }
        });

        if (btnFontMore) btnFontMore.addEventListener('click', () => {
            if (this.settings.fontSize < 28) {
                this.setFontSize(this.settings.fontSize + 2);
                this.saveSettings();
            }
        });

        if (prevBtn) prevBtn.addEventListener('click', () => this.prevPage());
        if (nextBtn) nextBtn.addEventListener('click', () => this.nextPage());
        
        if (btnAddBookmark) btnAddBookmark.addEventListener('click', () => this.addBookmark());

        document.addEventListener('keydown', (e) => {
            if (App.currentView !== 'readerView') return;
            if (e.key === 'ArrowLeft') this.prevPage();
            if (e.key === 'ArrowRight') this.nextPage();
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
        document.documentElement.setAttribute('data-theme', this.settings.theme || 'dark');
        const themeSelect = document.getElementById('selectTheme');
        if (themeSelect) themeSelect.value = this.settings.theme || 'dark';

        const fontSelect = document.getElementById('selectFont');
        if (fontSelect) fontSelect.value = this.settings.fontFamily || 'sans-serif';
    },

    async saveSettings() {
        try {
            await fetch('/api/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    theme: this.settings.theme,
                    fontSize: this.settings.fontSize,
                    ttsRate: this.settings.ttsRate,
                    ttsPitch: this.settings.ttsPitch,
                    voiceUri: this.settings.voiceUri
                })
            });
        } catch (e) {
            console.error('Save settings error', e);
        }
    },

    async loadBook(bookId) {
        this.bookId = bookId;
        this.sessionStartTime = Date.now();
        const viewer = document.getElementById('viewer');
        if (!viewer) return;
        viewer.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);"><i class="ri-loader-4-line ri-spin" style="font-size:2rem;margin-right:0.5rem;"></i> Đang nạp nội dung sách EPUB...</div>';

        try {
            // Fetch metadata & progress
            const res = await fetch(`/api/books/${bookId}`);
            if (!res.ok) throw new Error('Không thể tải thông tin sách');
            this.book = await res.json();

            const titleElem = document.getElementById('currentBookTitle');
            if (titleElem) titleElem.textContent = this.book.title;

            // Load EPUB file resource as ArrayBuffer to prevent HTTP META-INF restrictions
            const resFile = await fetch(`/api/books/${bookId}/file`);
            if (!resFile.ok) throw new Error('Không thể tải tệp nội dung EPUB từ server');
            const arrayBuffer = await resFile.arrayBuffer();

            // Instantiate ePub with ArrayBuffer
            const ePubFactory = (typeof ePub === 'function') ? ePub : (window.ePub && window.ePub.default ? window.ePub.default : window.ePub);
            this.bookData = ePubFactory(arrayBuffer);

            // Clear loading spinner overlay before mounting rendition iframe
            viewer.innerHTML = '';

            this.rendition = this.bookData.renderTo("viewer", {
                manager: "default",
                flow: "scrolled-doc",
                width: "100%",
                height: "100%"
            });

            // Apply font and theme styling into iframe
            this.applyRenditionTheme();

            this.rendition.hooks.content.register((contents) => {
                const style = contents.document.createElement('style');
                style.innerHTML = `
                    .tts-karaoke-highlight {
                        background-color: #facc15 !important;
                        color: #1e3a8a !important;
                        border-radius: 4px !important;
                        font-weight: bold !important;
                        padding: 0 2px !important;
                        box-shadow: 0 0 8px rgba(250, 204, 21, 0.6) !important;
                        animation: tts-pulse-glow 2s infinite !important;
                    }
                    @keyframes tts-pulse-glow {
                        0%, 100% { opacity: 1; }
                        50% { opacity: 0.8; box-shadow: 0 0 12px rgba(250, 204, 21, 0.8) !important; }
                    }
                `;
                contents.document.head.appendChild(style);
            });

            // Display page (at saved CFI or start)
            const targetCfi = this.book.currentCfi && this.book.currentCfi.trim() !== '' ? this.book.currentCfi : undefined;
            await this.rendition.display(targetCfi);

            // Load Table of Contents
            this.bookData.loaded.navigation.then(toc => {
                this.renderToc(toc);
            });
            
            this.loadBookmarks();

            // Generate Locations for progress % calculation
            this.bookData.ready.then(() => {
                return this.bookData.locations.generate(1000);
            }).then(() => {
                this.updateProgressFromLocation();
            });

            // Register relocation event
            this.rendition.on("relocated", (location) => {
                this.currentCfi = location.start.cfi;
                this.updateProgressFromLocation();
                this.debouncedSaveProgress();

                // Trigger TTS sentence queue update only if chapter changes
                if (this.currentHref !== location.start.href) {
                    this.currentHref = location.start.href;
                    this.syncTocActiveState();
                    if (TTSEngine.status === 'PLAYING' && !this.isTtsNavigating) {
                        TTSEngine.onPageNavigated();
                    }
                }
            });

            // Click-to-read functionality
            this.rendition.on("click", (e) => {
                try {
                    const contents = this.rendition.getContents();
                    if (!contents || contents.length === 0) return;
                    const doc = contents[0].document;
                    
                    let node = null, offset = 0;
                    if (doc.caretPositionFromPoint) {
                        const pos = doc.caretPositionFromPoint(e.clientX, e.clientY);
                        if (pos) { node = pos.offsetNode; offset = pos.offset; }
                    } else if (doc.caretRangeFromPoint) {
                        const range = doc.caretRangeFromPoint(e.clientX, e.clientY);
                        if (range) { node = range.startContainer; offset = range.startOffset; }
                    }
                    
                    if (node && node.nodeType === 3) { 
                        let snippet = node.nodeValue.slice(offset);
                        let sibling = node.nextSibling;
                        while (snippet.trim().length < 30 && sibling) {
                            snippet += sibling.textContent || '';
                            sibling = sibling.nextSibling;
                        }
                        snippet = snippet.trim();
                        if (snippet.length > 2) {
                            TTSEngine.start(snippet);
                        }
                    }
                } catch(err) {
                    console.error("Click-to-read error", err);
                }
            });

        } catch (err) {
            console.error(err);
            viewer.innerHTML = `<div style="color:var(--danger);padding:2rem;text-align:center;">Lỗi nạp sách: ${err.message}</div>`;
        }
    },

    applyRenditionTheme() {
        if (!this.rendition) return;

        let textColor = '#f8fafc';
        let bgColor = '#0f172a';
        if (this.settings.theme === 'light') {
            textColor = '#0f172a';
            bgColor = '#ffffff';
        } else if (this.settings.theme === 'sepia') {
            textColor = '#432818';
            bgColor = '#fbf0d9';
        }

        const fontFamily = this.settings.fontFamily === 'serif' ? varFontSerif : varFontSans;

        this.rendition.themes.register("custom", {
            "body": {
                "color": `${textColor} !important`,
                "background": `${bgColor} !important`,
                "font-family": `${fontFamily} !important`,
                "font-size": `${this.settings.fontSize}px !important`,
                "line-height": "1.6 !important",
                "padding": "20px 40px !important"
            },
            "p, span, div, h1, h2, h3, h4, h5, h6": {
                "color": `${textColor} !important`,
                "background": "transparent !important"
            }
        });
        this.rendition.themes.select("custom");
    },

    setTheme(theme) {
        this.settings.theme = theme;
        document.documentElement.setAttribute('data-theme', theme);
        this.applyRenditionTheme();
    },

    setFontFamily(family) {
        this.settings.fontFamily = family;
        this.applyRenditionTheme();
    },

    setFontSize(size) {
        this.settings.fontSize = size;
        const fontDisplay = document.getElementById('fontSizeDisplay');
        if (fontDisplay) fontDisplay.textContent = `${size}px`;
        this.applyRenditionTheme();
    },

    renderToc(toc) {
        const tocContainer = document.getElementById('tocList');
        if (!tocContainer) return;
        tocContainer.innerHTML = '';

        if (!toc || !toc.toc || toc.toc.length === 0) {
            tocContainer.innerHTML = '<li style="padding:0.5rem;color:var(--text-muted);">Không có mục lục</li>';
            return;
        }

        toc.toc.forEach(item => {
            const li = document.createElement('li');
            li.className = 'toc-item';
            li.textContent = item.label.trim();
            li.dataset.href = item.href; // Added for active state sync
            li.addEventListener('click', (e) => {
                e.stopPropagation();
                this.rendition.display(item.href);
                document.querySelectorAll('.toc-item').forEach(el => el.classList.remove('active'));
                li.classList.add('active');
                // close sidebar after selection
                const sidebar = document.getElementById('tocSidebar');
                if (sidebar) sidebar.classList.remove('active');
            });
            tocContainer.appendChild(li);
        });
    },
    
    syncTocActiveState() {
        if (!this.currentHref) return;
        const links = document.querySelectorAll('.toc-item');
        links.forEach(li => {
            if (li.dataset.href && li.dataset.href.includes(this.currentHref)) {
                li.classList.add('active');
            } else {
                li.classList.remove('active');
            }
        });
    },

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
            container.innerHTML = '<li style="padding:0.5rem;color:var(--text-muted);">Chưa có dấu trang</li>';
            return;
        }
        
        this.bookmarks.forEach(bm => {
            const li = document.createElement('li');
            li.className = 'toc-item';
            li.innerHTML = `
                <div style="flex:1;">
                    <div style="font-weight: 500;">${App.escapeHtml(bm.name)}</div>
                    <div style="font-size: 0.75rem; color: var(--text-muted);">${App.escapeHtml(bm.chapterTitle)}</div>
                </div>
                <button class="btn-icon" style="color: var(--danger); padding: 0.2rem;" title="Xóa">
                    <i class="ri-delete-bin-line"></i>
                </button>
            `;
            
            li.addEventListener('click', () => {
                this.rendition.display(bm.cfi);
            });
            
            const delBtn = li.querySelector('button');
            delBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (confirm('Xóa dấu trang này?')) {
                    try {
                        await fetch(`/api/bookmarks/${bm.id}`, { method: 'DELETE' });
                        this.loadBookmarks();
                    } catch(err) {
                        console.error('Lỗi xóa bookmark', err);
                    }
                }
            });
            
            container.appendChild(li);
        });
    },
    
    async addBookmark() {
        if (!this.currentCfi || !this.bookId) return;
        let name = prompt('Nhập tên cho dấu trang này:', `Trang hiện tại`);
        if (!name) return;
        
        let chapterTitle = '';
        const activeToc = document.querySelector('.toc-item.active');
        if (activeToc) {
            chapterTitle = activeToc.textContent.trim();
        }
        
        try {
            await fetch('/api/bookmarks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    bookId: this.bookId,
                    name: name,
                    cfi: this.currentCfi,
                    chapterTitle: chapterTitle
                })
            });
            App.showToast('Đã thêm dấu trang!', 'success');
            this.loadBookmarks();
        } catch (e) {
            console.error('Lỗi thêm bookmark', e);
            App.showToast('Lỗi thêm dấu trang', 'error');
        }
    },

    prevPage() {
        if (this.rendition) {
            this.rendition.prev();
        }
    },

    nextPage(fromTts = false) {
        if (!this.rendition) return Promise.resolve();
        if (fromTts === true) {
            this.isTtsNavigating = true;
        }
        return Promise.resolve(this.rendition.next()).finally(() => {
            if (fromTts === true) {
                this.isTtsNavigating = false;
            }
        });
    },

    updateProgressFromLocation() {
        if (!this.rendition || !this.bookData || !this.bookData.locations) return;
        const currentLocation = this.rendition.currentLocation();
        if (currentLocation && currentLocation.start) {
            this.currentCfi = currentLocation.start.cfi;
            const percentage = this.bookData.locations.percentageFromCfi(this.currentCfi);
            if (!isNaN(percentage)) {
                this.progressPercentage = Math.min(100, Math.max(0, percentage * 100));
            }
        }
    },

    debouncedSaveProgress() {
        if (this.saveProgressTimeout) clearTimeout(this.saveProgressTimeout);
        this.saveProgressTimeout = setTimeout(() => {
            this.saveProgress();
        }, 3000);
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
            this.sessionStartTime = Date.now(); // reset
        }
        
        try {
            await fetch(`/api/progress/${this.bookId}`, {
                method: 'PUT',
                keepalive: isKeepalive === true,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    cfi: this.currentCfi,
                    percentage: this.progressPercentage,
                    readingTimeSeconds: readingTimeSeconds
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
    }
};

const varFontSans = "'Inter', system-ui, sans-serif";
const varFontSerif = "'Georgia', 'Merriweather', serif";

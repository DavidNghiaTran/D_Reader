/**
 * D_Reader — Library Module v3.0
 * Features: Continue Reading banner, 3D book covers, filter tabs,
 *           debounce search, XHR upload with real progress bar.
 */
const Library = {
    books: [],
    activeFilter: 'all',
    searchDebounceTimer: null,

    // Gradient palette for typography covers (when no image available)
    COVER_GRADIENTS: [
        ['#6366F1', '#8B5CF6'],
        ['#EC4899', '#F97316'],
        ['#14B8A6', '#0EA5E9'],
        ['#F59E0B', '#EF4444'],
        ['#10B981', '#3B82F6'],
        ['#8B5CF6', '#EC4899'],
        ['#0EA5E9', '#14B8A6'],
        ['#F97316', '#FBBF24'],
        ['#6D28D9', '#2563EB'],
        ['#BE185D', '#7C3AED'],
    ],

    init() {
        this.bindEvents();
        this.loadBooks();
    },

    bindEvents() {
        // Upload modal
        document.getElementById('btnUploadModal')?.addEventListener('click', () => this.openModal());
        document.getElementById('btnCloseModal')?.addEventListener('click', () => this.closeModal());
        document.getElementById('uploadModal')?.addEventListener('click', (e) => {
            if (e.target === document.getElementById('uploadModal')) this.closeModal();
        });

        // Delete modal cancel
        document.getElementById('btnCancelDelete')?.addEventListener('click', () => {
            document.getElementById('deleteModal')?.classList.remove('active');
            this.pendingDeleteId = null;
        });

        // Edit book modal
        document.getElementById('btnCloseEditBookModal')?.addEventListener('click', () => this.closeEditModal());
        document.getElementById('btnCancelEditBook')?.addEventListener('click', () => this.closeEditModal());
        document.getElementById('btnSaveEditBook')?.addEventListener('click', () => this.saveEditBook());
        document.getElementById('editBookModal')?.addEventListener('click', (e) => {
            if (e.target === document.getElementById('editBookModal')) this.closeEditModal();
        });

        // Debounce search
        const searchInput = document.getElementById('inputSearchBook');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                clearTimeout(this.searchDebounceTimer);
                this.searchDebounceTimer = setTimeout(() => {
                    this.filterAndRender();
                }, 250);
            });
        }

        // Sort select
        document.getElementById('selectSortBook')?.addEventListener('change', () => this.filterAndRender());

        // Filter tabs
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.activeFilter = btn.dataset.filter || 'all';
                this.filterAndRender();
            });
        });

        // Dropzone
        const dropzone = document.getElementById('dropzone');
        const fileInput = document.getElementById('fileInput');
        if (dropzone && fileInput) {
            dropzone.addEventListener('click', () => fileInput.click());
            dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
            dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
            dropzone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropzone.classList.remove('dragover');
                if (e.dataTransfer.files?.[0]) this.handleFileUpload(e.dataTransfer.files[0]);
            });
            fileInput.addEventListener('change', (e) => {
                if (e.target.files?.[0]) this.handleFileUpload(e.target.files[0]);
            });
        }

        // Logo click → library
        document.getElementById('logoHome')?.addEventListener('click', () => {
            if (App.currentView === 'readerView') {
                Reader.flushSaveProgress();
                TTS.stop();
                App.switchView('libraryView');
                this.loadBooks();
            }
        });
    },

    openModal() {
        document.getElementById('uploadModal')?.classList.add('active');
    },

    closeModal() {
        document.getElementById('uploadModal')?.classList.remove('active');
        const fileInput = document.getElementById('fileInput');
        if (fileInput) fileInput.value = '';
        document.getElementById('uploadProgress').style.display = 'none';
        document.getElementById('uploadStatus').textContent = '';
        this.resetDropzone();
    },

    resetDropzone() {
        const dropzone = document.getElementById('dropzone');
        if (dropzone) {
            dropzone.innerHTML = `
                <i class="ri-file-upload-line"></i>
                <p>Kéo và thả tệp <strong>.epub</strong> vào đây<br>hoặc <strong>nhấn để chọn tệp</strong></p>
                <p style="font-size:0.75rem;margin-top:0.5rem;opacity:0.6;">Hỗ trợ tối đa 50MB</p>
                <input type="file" id="fileInput" accept=".epub" hidden>
            `;
            const newFileInput = dropzone.querySelector('#fileInput');
            if (newFileInput) {
                newFileInput.addEventListener('change', (e) => {
                    if (e.target.files?.[0]) this.handleFileUpload(e.target.files[0]);
                });
            }
            dropzone.onclick = () => dropzone.querySelector('#fileInput')?.click();
        }
    },

    async loadBooks() {
        const grid = document.getElementById('bookGrid');
        try {
            const res = await fetch('/api/books');
            if (!res.ok) throw new Error('Không thể lấy danh sách sách');
            this.books = await res.json();
            this.renderContinueBanner();
            this.filterAndRender();
        } catch (err) {
            console.error(err);
            App.showToast('Lỗi tải thư viện: ' + err.message, 'error');
            if (grid) grid.innerHTML = `<div class="empty-state"><i class="ri-wifi-off-line"></i><h3>Lỗi kết nối</h3><p>${err.message}</p></div>`;
        }
    },

    /** Render "Continue Reading" hero banner using most-recently-read book */
    renderContinueBanner() {
        const banner = document.getElementById('continueReadingBanner');
        if (!banner) return;

        // Find book with highest progress that isn't 100%
        const reading = this.books
            .filter(b => (b.progressPercentage || 0) > 0 && (b.progressPercentage || 0) < 99.9)
            .sort((a, b) => b.id - a.id); // recent first (higher ID = newer session)

        if (reading.length === 0) {
            banner.style.display = 'none';
            return;
        }

        const book = reading[0];
        const pct = (book.progressPercentage || 0).toFixed(1);
        const coverHtml = book.coverPath
            ? `<img class="continue-banner-cover" src="/api/books/${book.id}/cover" alt="${this.escHtml(book.title)}" onerror="this.style.display='none'">`
            : `<div class="continue-banner-cover-placeholder">📖</div>`;

        banner.innerHTML = `
            <div class="continue-reading-banner" id="continueBannerCard">
                ${coverHtml}
                <div class="continue-banner-info">
                    <div class="continue-banner-label">✦ Tiếp tục đọc</div>
                    <div class="continue-banner-title" title="${this.escHtml(book.title)}">${this.escHtml(book.title)}</div>
                    <div class="continue-banner-chapter">${book.chapterTitle ? `<i class="ri-book-mark-line"></i> Đang đọc: <strong>${this.escHtml(book.chapterTitle)}</strong>` : this.escHtml(book.author || 'Chưa rõ tác giả')}</div>
                    <div class="continue-banner-progress">
                        <div class="continue-progress-track">
                            <div class="continue-progress-fill" style="width:${pct}%"></div>
                        </div>
                        <span class="continue-progress-pct">${pct}%</span>
                    </div>
                    <div class="continue-banner-actions">
                        <button class="btn btn-primary" id="btnContinueRead">
                            <i class="ri-book-read-line"></i> Đọc tiếp
                        </button>
                        <button class="btn btn-secondary" id="btnContinueListen">
                            <i class="ri-headphone-line"></i> Nghe tiếp
                        </button>
                    </div>
                </div>
            </div>
        `;

        banner.style.display = 'block';

        document.getElementById('btnContinueRead')?.addEventListener('click', () => this.openReader(book.id));
        document.getElementById('btnContinueListen')?.addEventListener('click', () => {
            this.openReader(book.id, true);
        });
    },

    filterAndRender() {
        const query = (document.getElementById('inputSearchBook')?.value || '').toLowerCase().trim();
        const sortVal = document.getElementById('selectSortBook')?.value || 'recent';

        let filtered = [...this.books];

        // Search
        if (query) {
            filtered = filtered.filter(b =>
                (b.title || '').toLowerCase().includes(query) ||
                (b.author || '').toLowerCase().includes(query)
            );
        }

        // Status filter
        if (this.activeFilter === 'reading') {
            filtered = filtered.filter(b => (b.progressPercentage || 0) > 0 && (b.progressPercentage || 0) < 99.9);
        } else if (this.activeFilter === 'unread') {
            filtered = filtered.filter(b => (b.progressPercentage || 0) === 0);
        } else if (this.activeFilter === 'done') {
            filtered = filtered.filter(b => (b.progressPercentage || 0) >= 99.9);
        }

        // Sort
        filtered.sort((a, b) => {
            switch (sortVal) {
                case 'title_asc': return (a.title || '').localeCompare(b.title || '', 'vi');
                case 'title_desc': return (b.title || '').localeCompare(a.title || '', 'vi');
                case 'progress': return (b.progressPercentage || 0) - (a.progressPercentage || 0);
                case 'uploaded': return (b.id || 0) - (a.id || 0);
                default: return (b.id || 0) - (a.id || 0); // recent = highest id
            }
        });

        this.render(filtered);
    },

    /** Pick a deterministic gradient for a book based on its title */
    getCoverGradient(book) {
        const hash = (book.title || '').split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
        return this.COVER_GRADIENTS[hash % this.COVER_GRADIENTS.length];
    },

    render(booksToRender) {
        const grid = document.getElementById('bookGrid');
        if (!grid) return;

        grid.innerHTML = '';

        if (!booksToRender || booksToRender.length === 0) {
            grid.innerHTML = `
                <div class="empty-state">
                    <i class="ri-book-2-line"></i>
                    <h3>Chưa có sách nào</h3>
                    <p>Nhấn <strong>Tải sách EPUB</strong> để thêm sách mới vào thư viện</p>
                </div>`;
            return;
        }

        booksToRender.forEach(book => {
            const card = document.createElement('div');
            card.className = 'book-card';
            card.setAttribute('data-book-id', book.id);

            const progressPct = (book.progressPercentage || 0).toFixed(1);
            const [g1, g2] = this.getCoverGradient(book);

            // 3D book cover or typography placeholder
            const coverHtml = book.coverPath
                ? `<img class="cover-img" src="/api/books/${book.id}/cover" alt="${this.escHtml(book.title)}" loading="lazy" onerror="this.parentElement.innerHTML=\`<div class='cover-placeholder-gradient' style='background:linear-gradient(135deg,${g1},${g2});position:absolute;inset:0;'></div><div class='cover-placeholder-content'><i class='ri-book-open-line'></i><div class='cover-placeholder-title'>${this.escHtml(book.title)}</div><div class='cover-placeholder-author'>${this.escHtml(book.author || '')}</div></div>\`">`
                : `<div class="cover-placeholder-gradient" style="background:linear-gradient(135deg,${g1},${g2});position:absolute;inset:0;"></div>
                   <div class="cover-placeholder-content">
                       <i class="ri-book-open-line"></i>
                       <div class="cover-placeholder-title">${this.escHtml(book.title)}</div>
                       <div class="cover-placeholder-author">${this.escHtml(book.author || '')}</div>
                   </div>`;

            card.innerHTML = `
                <div class="cover-wrapper">${coverHtml}</div>
                <div class="book-info">
                    <h3 class="book-title" title="${this.escHtml(book.title)}">${this.escHtml(book.title)}</h3>
                    <p class="book-author">${this.escHtml(book.author || 'Chưa rõ tác giả')}</p>
                    <div class="progress-section">
                        ${book.chapterTitle ? `<div class="book-chapter-badge" title="${this.escHtml(book.chapterTitle)}"><i class="ri-book-mark-line"></i> Đang đọc: ${this.escHtml(book.chapterTitle)}</div>` : ''}
                        <div class="progress-bar-bg">
                            <div class="progress-bar-fill" style="width:${progressPct}%"></div>
                        </div>
                        <div class="progress-text">
                            <span>${progressPct > 0 ? 'Tiến độ' : 'Chưa đọc'}</span>
                            <span>${progressPct}%</span>
                        </div>
                    </div>
                </div>
                <div class="book-actions">
                    <button class="btn btn-primary btn-read" style="flex:1;">
                        <i class="ri-book-read-line"></i> Đọc
                    </button>
                    <button class="btn btn-secondary btn-icon btn-edit" title="Sửa thông tin sách">
                        <i class="ri-edit-line"></i>
                    </button>
                    <button class="btn btn-danger btn-icon btn-delete" title="Xóa sách">
                        <i class="ri-delete-bin-line"></i>
                    </button>
                </div>
            `;

            card.querySelector('.btn-read')?.addEventListener('click', () => this.openReader(book.id));
            card.querySelector('.btn-edit')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.openEditModal(book);
            });
            card.querySelector('.btn-delete')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteBook(book.id, book.title);
            });
            card.querySelector('.cover-wrapper')?.addEventListener('click', () => this.openReader(book.id));

            grid.appendChild(card);
        });
    },

    /** Upload file with real XHR progress bar */
    handleFileUpload(file) {
        if (!file.name.toLowerCase().endsWith('.epub')) {
            App.showToast('Chỉ hỗ trợ tệp định dạng .epub!', 'error');
            return;
        }
        if (file.size > 50 * 1024 * 1024) {
            App.showToast('Dung lượng tệp vượt quá giới hạn 50MB!', 'error');
            return;
        }

        const progressContainer = document.getElementById('uploadProgress');
        const progressBar = document.getElementById('progressBar');
        const statusEl = document.getElementById('uploadStatus');
        const dropzone = document.getElementById('dropzone');

        if (dropzone) dropzone.innerHTML = `<i class="ri-loader-4-line ri-spin" style="font-size:2.5rem;color:var(--accent);"></i><p style="margin-top:0.5rem;">Đang tải lên và phân tích EPUB...</p>`;
        if (progressContainer) progressContainer.style.display = 'block';
        if (progressBar) progressBar.style.width = '0%';
        if (statusEl) statusEl.textContent = 'Đang chuẩn bị...';

        const formData = new FormData();
        formData.append('file', file);

        const xhr = new XMLHttpRequest();

        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                const pct = Math.round((e.loaded / e.total) * 85); // leave 15% for server processing
                if (progressBar) progressBar.style.width = `${pct}%`;
                if (statusEl) statusEl.textContent = `Đang tải lên... ${pct}%`;
            }
        };

        xhr.onload = () => {
            if (progressBar) progressBar.style.width = '100%';
            if (xhr.status >= 200 && xhr.status < 300) {
                if (statusEl) statusEl.textContent = 'Hoàn tất! Đang cập nhật thư viện...';
                setTimeout(() => {
                    this.closeModal();
                    this.loadBooks();
                    App.showToast('Tải sách lên thành công!', 'success');
                }, 500);
            } else {
                if (statusEl) statusEl.textContent = 'Lỗi: ' + xhr.responseText;
                App.showToast('Tải lên thất bại: ' + xhr.responseText, 'error');
                this.resetDropzone();
            }
        };

        xhr.onerror = () => {
            if (statusEl) statusEl.textContent = 'Lỗi kết nối, vui lòng thử lại.';
            App.showToast('Lỗi kết nối', 'error');
            this.resetDropzone();
        };

        xhr.open('POST', '/api/books/upload');
        xhr.send(formData);
    },

    async deleteBook(id, title) {
        const deleteModal = document.getElementById('deleteModal');
        const deleteModalText = document.getElementById('deleteModalText');
        const btnConfirmDelete = document.getElementById('btnConfirmDelete');

        if (deleteModal && deleteModalText && btnConfirmDelete) {
            deleteModalText.textContent = `Bạn có chắc chắn muốn xóa sách "${title}"?`;
            deleteModal.classList.add('active');

            const newBtn = btnConfirmDelete.cloneNode(true);
            btnConfirmDelete.parentNode.replaceChild(newBtn, btnConfirmDelete);

            newBtn.addEventListener('click', async () => {
                deleteModal.classList.remove('active');
                try {
                    const res = await fetch(`/api/books/${id}`, { method: 'DELETE' });
                    if (!res.ok) throw new Error('Không thể xóa sách');
                    this.loadBooks();
                    App.showToast(`Đã xóa sách "${title}"`, 'success');
                } catch (err) {
                    App.showToast('Lỗi xóa sách: ' + err.message, 'error');
                }
            });
        }
    },

    openReader(bookId, autoPlayTts = false) {
        App.switchView('readerView');
        Reader.loadBook(bookId, autoPlayTts);
    },

    openEditModal(book) {
        const modal = document.getElementById('editBookModal');
        const idInput = document.getElementById('editBookId');
        const titleInput = document.getElementById('editBookTitle');
        const authorInput = document.getElementById('editBookAuthor');
        if (modal && idInput && titleInput && authorInput) {
            idInput.value = book.id;
            titleInput.value = book.title || '';
            authorInput.value = book.author || '';
            modal.classList.add('active');
        }
    },

    closeEditModal() {
        document.getElementById('editBookModal')?.classList.remove('active');
    },

    async saveEditBook() {
        const id = document.getElementById('editBookId')?.value;
        const title = document.getElementById('editBookTitle')?.value?.trim();
        const author = document.getElementById('editBookAuthor')?.value?.trim();

        if (!id || !title) {
            App.showToast('Tên truyện không được để trống!', 'error');
            return;
        }

        try {
            const res = await fetch(`/api/books/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, author })
            });

            if (!res.ok) {
                const errText = await res.text();
                throw new Error(errText || 'Lỗi cập nhật sách');
            }

            this.closeEditModal();
            App.showToast('Đã cập nhật thông tin sách thành công!', 'success');
            this.loadBooks();
        } catch (err) {
            App.showToast('Lỗi cập nhật: ' + err.message, 'error');
        }
    },

    escHtml(str) {
        if (!str) return '';
        return str.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]));
    }
};

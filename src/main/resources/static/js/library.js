const Library = {
    books: [],

    init() {
        this.bindEvents();
        this.loadBooks();
    },

    bindEvents() {
        const uploadBtn = document.getElementById('btnUploadModal');
        const closeModalBtn = document.getElementById('btnCloseModal');
        const modalOverlay = document.getElementById('uploadModal');
        const dropzone = document.getElementById('dropzone');
        const fileInput = document.getElementById('fileInput');
        const searchInput = document.getElementById('inputSearchBook');

        if (uploadBtn) uploadBtn.addEventListener('click', () => this.openModal());
        if (closeModalBtn) closeModalBtn.addEventListener('click', () => this.closeModal());
        
        if (modalOverlay) {
            modalOverlay.addEventListener('click', (e) => {
                if (e.target === modalOverlay) this.closeModal();
            });
        }

        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.filterBooks(e.target.value);
            });
        }

        const sortSelect = document.getElementById('selectSortBook');
        if (sortSelect) {
            sortSelect.addEventListener('change', () => {
                this.filterBooks(searchInput ? searchInput.value : '');
            });
        }
        
        const btnCancelDelete = document.getElementById('btnCancelDelete');
        const deleteModal = document.getElementById('deleteModal');
        if (btnCancelDelete) btnCancelDelete.addEventListener('click', () => {
            if (deleteModal) deleteModal.classList.remove('active');
            this.pendingDeleteId = null;
        });

        if (dropzone && fileInput) {
            dropzone.addEventListener('click', () => fileInput.click());

            dropzone.addEventListener('dragover', (e) => {
                e.preventDefault();
                dropzone.classList.add('dragover');
            });

            dropzone.addEventListener('dragleave', () => {
                dropzone.classList.remove('dragover');
            });

            dropzone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropzone.classList.remove('dragover');
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    this.handleFileUpload(e.dataTransfer.files[0]);
                }
            });

            fileInput.addEventListener('change', (e) => {
                if (e.target.files && e.target.files.length > 0) {
                    this.handleFileUpload(e.target.files[0]);
                }
            });
        }
    },

    openModal() {
        const modalOverlay = document.getElementById('uploadModal');
        if (modalOverlay) modalOverlay.classList.add('active');
    },

    closeModal() {
        const modalOverlay = document.getElementById('uploadModal');
        if (modalOverlay) modalOverlay.classList.remove('active');
        const fileInput = document.getElementById('fileInput');
        if (fileInput) fileInput.value = '';
    },

    async loadBooks() {
        const grid = document.getElementById('bookGrid');
        try {
            const res = await fetch('/api/books');
            if (!res.ok) throw new Error('Không thể lấy danh sách sách');
            this.books = await res.json();
            this.render(this.books);
        } catch (err) {
            console.error(err);
            App.showToast('Lỗi tải thư viện sách: ' + err.message, 'error');
            if (grid) {
                grid.innerHTML = `<div style="color:var(--danger);padding:2rem;text-align:center;">Lỗi tải thư viện sách: ${err.message}</div>`;
            }
        }
    },

    filterBooks(query) {
        let filtered = [...this.books];
        
        if (query && query.trim() !== '') {
            const lower = query.toLowerCase().trim();
            filtered = filtered.filter(b => 
                (b.title && b.title.toLowerCase().includes(lower)) ||
                (b.author && b.author.toLowerCase().includes(lower))
            );
        }
        
        const sortSelect = document.getElementById('selectSortBook');
        const sortVal = sortSelect ? sortSelect.value : 'recent';
        
        filtered.sort((a, b) => {
            if (sortVal === 'title_asc') {
                return (a.title || '').localeCompare(b.title || '');
            } else if (sortVal === 'title_desc') {
                return (b.title || '').localeCompare(a.title || '');
            } else if (sortVal === 'progress') {
                return (b.progressPercentage || 0) - (a.progressPercentage || 0);
            } else {
                // recent (default) - assume higher ID = more recent since there's no createdAt
                return b.id - a.id;
            }
        });

        this.render(filtered);
    },

    render(booksToRender = this.books) {
        const grid = document.getElementById('bookGrid');
        if (!grid) return;

        grid.innerHTML = '';

        if (!booksToRender || booksToRender.length === 0) {
            grid.innerHTML = `
                <div style="grid-column: 1 / -1; text-align: center; padding: 4rem 1rem; color: var(--text-muted);">
                    <i class="ri-book-2-line" style="font-size: 3.5rem; display: block; margin-bottom: 1rem; opacity: 0.5;"></i>
                    <p style="font-size: 1.1rem; margin-bottom: 0.5rem;">Chưa có sách nào trong thư viện</p>
                    <p style="font-size: 0.85rem;">Nhấn nút <strong>Tải sách EPUB</strong> để thêm sách mới</p>
                </div>
            `;
            return;
        }

        booksToRender.forEach(book => {
            const card = document.createElement('div');
            card.className = 'book-card';

            const coverSrc = book.coverPath ? `/api/books/${book.id}/cover` : null;
            const progressPct = (book.progressPercentage || 0).toFixed(1);

            card.innerHTML = `
                <div class="cover-wrapper">
                    ${coverSrc ? 
                        `<img src="${coverSrc}" class="cover-img" alt="${this.escapeHtml(book.title)}">` :
                        `<div class="cover-placeholder">
                            <i class="ri-book-open-line"></i>
                            <span>${this.escapeHtml(book.title)}</span>
                        </div>`
                    }
                </div>
                <div class="book-info">
                    <h3 class="book-title" title="${this.escapeHtml(book.title)}">${this.escapeHtml(book.title)}</h3>
                    <p class="book-author">${this.escapeHtml(book.author || 'Chưa rõ tác giả')}</p>
                    <div class="progress-section">
                        <div class="progress-bar-bg">
                            <div class="progress-bar-fill" style="width: ${progressPct}%;"></div>
                        </div>
                        <div class="progress-text">
                            <span>Tiến độ</span>
                            <span>${progressPct}%</span>
                        </div>
                    </div>
                </div>
                <div class="book-actions">
                    <button class="btn btn-primary btn-read" style="flex: 1;">
                        <i class="ri-book-read-line"></i> Đọc sách
                    </button>
                    <button class="btn btn-danger btn-icon btn-delete" title="Xóa sách">
                        <i class="ri-delete-bin-line"></i>
                    </button>
                </div>
            `;

            // Bind button clicks safely
            const btnRead = card.querySelector('.btn-read');
            if (btnRead) {
                btnRead.addEventListener('click', () => this.openReader(book.id));
            }

            const btnDelete = card.querySelector('.btn-delete');
            if (btnDelete) {
                btnDelete.addEventListener('click', () => this.deleteBook(book.id, book.title));
            }

            // Also clicking the cover opens the reader
            const coverWrapper = card.querySelector('.cover-wrapper');
            if (coverWrapper) {
                coverWrapper.style.cursor = 'pointer';
                coverWrapper.addEventListener('click', () => this.openReader(book.id));
            }

            grid.appendChild(card);
        });
    },

    async handleFileUpload(file) {
        if (!file.name.toLowerCase().endsWith('.epub')) {
            App.showToast('Chỉ hỗ trợ tệp định dạng .epub!', 'error');
            return;
        }
        if (file.size > 50 * 1024 * 1024) {
            App.showToast('Dung lượng tệp vượt quá giới hạn 50MB!', 'error');
            return;
        }

        const formData = new FormData();
        formData.append('file', file);

        const dropzone = document.getElementById('dropzone');
        try {
            if (dropzone) dropzone.innerHTML = `<i class="ri-loader-4-line ri-spin" style="font-size:2.5rem;"></i><p>Đang tải lên và phân tích metadata EPUB...</p>`;

            const res = await fetch('/api/books/upload', {
                method: 'POST',
                body: formData
            });

            if (!res.ok) {
                const errMsg = await res.text();
                throw new Error(errMsg);
            }

            this.closeModal();
            this.loadBooks();
            App.showToast('Tải sách lên thành công!', 'success');
        } catch (err) {
            console.error(err);
            App.showToast('Tải file thất bại: ' + err.message, 'error');
        } finally {
            if (dropzone) {
                dropzone.innerHTML = `
                    <i class="ri-upload-cloud-line"></i>
                    <p>Kéo và thả file .epub vào đây, hoặc nhấn để chọn file</p>
                    <span style="font-size: 0.75rem; color: var(--text-muted); font-style: italic;">Hỗ trợ tối đa 50MB</span>
                `;
            }
        }
    },

    async deleteBook(id, title) {
        const deleteModal = document.getElementById('deleteModal');
        const deleteModalText = document.getElementById('deleteModalText');
        const btnConfirmDelete = document.getElementById('btnConfirmDelete');
        
        if (deleteModal && deleteModalText && btnConfirmDelete) {
            deleteModalText.textContent = `Bạn có chắc chắn muốn xóa sách "${title}"?`;
            deleteModal.classList.add('active');
            
            // Remove old listeners by cloning
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

    openReader(bookId) {
        App.switchView('readerView');
        Reader.loadBook(bookId);
    },

    escapeHtml(str) {
        if (!str) return '';
        return str.replace(/[&<>"']/g, function(m) {
            return {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#039;'
            }[m];
        });
    }
};

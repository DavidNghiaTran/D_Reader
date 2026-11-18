/**
 * D_Reader — Main Application Controller v3.0
 */
const App = {
    currentView: 'libraryView',

    init() {
        console.log('D_Reader v3.0 initializing...');

        if (typeof Library !== 'undefined' && Library.init) Library.init();
        if (typeof Reader !== 'undefined' && Reader.init) Reader.init();
        if (typeof TTSEngine !== 'undefined' && TTSEngine.init) TTSEngine.init();

        this.bindGlobalActions();
        this.switchView('libraryView');
    },

    bindGlobalActions() {
        const handleShutdown = async () => {
            if (!confirm('Bạn có muốn tắt máy chủ D_Reader và thoát ứng dụng không?')) return;
            App.showToast('Đang đóng máy chủ D_Reader...', 'info');
            try {
                if (typeof Reader !== 'undefined' && Reader.flushSaveProgress) {
                    Reader.flushSaveProgress(true);
                }
            } catch(e) {}

            try {
                await fetch('/api/health/shutdown', { method: 'POST' });
            } catch (e) {}

            setTimeout(() => {
                window.close();
            }, 600);
        };

        document.getElementById('btnExitApp')?.addEventListener('click', handleShutdown);
        document.getElementById('btnReaderExitApp')?.addEventListener('click', handleShutdown);
    },

    switchView(viewId) {
        this.currentView = viewId;
        document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));

        const targetView = document.getElementById(viewId);
        if (targetView) targetView.classList.add('active');

        const ttsBar = document.getElementById('ttsBar');
        const isReader = viewId === 'readerView';

        // TTS bar: controlled by its own tts-hidden class in reader.js
        if (ttsBar && !isReader) {
            ttsBar.classList.add('tts-hidden');
        }

        document.body.style.overflow = isReader ? 'hidden' : '';
    },

    showToast(message, type = 'success') {
        const container = document.getElementById('toastContainer');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        const icons = { success: 'ri-checkbox-circle-fill', error: 'ri-error-warning-fill', info: 'ri-information-line' };
        const colors = { success: 'var(--success)', error: 'var(--danger)', info: 'var(--accent)' };
        const icon = icons[type] || icons.info;
        const color = colors[type] || colors.info;

        toast.innerHTML = `
            <i class="${icon}" style="color:${color};font-size:1.2rem;flex-shrink:0;"></i>
            <span>${message}</span>
        `;

        container.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('hiding');
            toast.addEventListener('transitionend', () => toast.remove());
        }, 3500);
    },

    escapeHtml(str) {
        if (!str) return '';
        return str.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]));
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());

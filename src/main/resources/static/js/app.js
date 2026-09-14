/**
 * D_Reader - Main Application Controller
 */
const App = {
    currentView: 'libraryView',

    init() {
        console.log('D_Reader initializing...');

        // Initialize App Modules
        if (typeof Library !== 'undefined' && Library.init) {
            Library.init();
        }
        if (typeof Reader !== 'undefined' && Reader.init) {
            Reader.init();
        }
        if (typeof TTSEngine !== 'undefined' && TTSEngine.init) {
            TTSEngine.init();
        }

        // Show default library view
        this.switchView('libraryView');
    },

    switchView(viewId) {
        this.currentView = viewId;
        document.querySelectorAll('.view').forEach(view => {
            view.classList.remove('active');
        });

        const targetView = document.getElementById(viewId);
        if (targetView) {
            targetView.classList.add('active');
        }

        // Show/hide the fixed bottom TTS bar
        const ttsBar = document.getElementById('ttsBar');
        if (ttsBar) {
            ttsBar.style.display = (viewId === 'readerView') ? 'flex' : 'none';
        }
        
        // Prevent body scrolling in reader view
        document.body.style.overflow = (viewId === 'readerView') ? 'hidden' : '';
    },

    showToast(message, type = 'success') {
        const container = document.getElementById('toastContainer');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        let icon = type === 'success' ? 'ri-checkbox-circle-fill' : 'ri-error-warning-fill';
        let color = type === 'success' ? 'var(--success)' : 'var(--danger)';

        toast.innerHTML = `
            <i class="${icon}" style="color: ${color}; font-size: 1.25rem;"></i>
            <span>${message}</span>
        `;

        container.appendChild(toast);

        // Auto remove after 3s
        setTimeout(() => {
            toast.classList.add('hiding');
            toast.addEventListener('transitionend', () => {
                toast.remove();
            });
        }, 3000);
    }
};

// Global DOM Ready Initialization
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});

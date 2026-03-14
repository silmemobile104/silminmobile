// HTML/js/toast.js

// Initialize AppToast as a global object
const AppToast = {
    _show: (message, type, iconName, bgClass, borderClass, textClass) => {
        const toastHTML = `
            <div class="flex items-center gap-3">
                <ion-icon name="${iconName}" class="text-2xl ${textClass} shrink-0"></ion-icon>
                <span class="font-medium text-slate-800 text-sm leading-relaxed">${message}</span>
            </div>
        `;
        
        const toast = Toastify({
            text: toastHTML,
            duration: 3000,
            close: true,
            gravity: "top", // `top` or `bottom`
            position: "right", // `left`, `center` or `right`
            stopOnFocus: true, // Prevents dismissing of toast on hover
            escapeMarkup: false, // Allow HTML
            className: `!bg-white/95 !backdrop-blur-xl !border-l-4 ${borderClass} !rounded-2xl !shadow-2xl hover:!shadow-yellow-500/10 !transition-all duration-300 min-w-[320px] !p-4 !mt-4 !mr-2 cursor-pointer group`,
            style: {
                background: "white", // Overrides default to let Tailwind handle aesthetics
                boxShadow: "0 25px 50px -12px rgb(0 0 0 / 0.15)",
                padding: "16px 20px"
            }
        });
        
        // Close toast when clicking anywhere on it
        toast.options.onClick = function() {
            toast.hideToast();
        };
        
        toast.showToast();
    },

    success: (message) => {
        AppToast._show(message, 'success', 'checkmark-circle', 'bg-emerald-50', '!border-emerald-500', 'text-emerald-500');
    },
    
    error: (message) => {
        AppToast._show(message, 'error', 'alert-circle', 'bg-red-50', '!border-red-500', 'text-red-500');
    },

    warning: (message) => {
        AppToast._show(message, 'warning', 'warning', 'bg-amber-50', '!border-amber-500', 'text-amber-500');
    },

    info: (message) => {
        AppToast._show(message, 'info', 'information-circle', 'bg-blue-50', '!border-blue-500', 'text-blue-500');
    }
};

window.AppToast = AppToast;

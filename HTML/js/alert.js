// HTML/js/alert.js

// AppConfirm - Centralized Confirm Utility using SweetAlert2 & Tailwind CSS
const AppConfirm = {
    /**
     * @param {string} title - Title of the confirm dialog
     * @param {string} text - Description text
     * @param {string} confirmText - Text for the confirm button
     * @param {string} icon - Icon type ('warning', 'question', 'info', etc.)
     * @returns {Promise<SweetAlertResult>}
     */
    ask: function(title, text, confirmText = 'ยืนยัน', icon = 'warning') {
        return Swal.fire({
            title: title,
            text: text,
            icon: icon,
            showCancelButton: true,
            confirmButtonText: confirmText,
            cancelButtonText: 'ยกเลิก',
            reverseButtons: true,
            customClass: {
                popup: '!rounded-3xl !shadow-2xl !border border-slate-100 !p-6 !bg-white/95 !backdrop-blur-xl',
                title: '!text-xl !font-bold !text-slate-800 !mt-2 !font-display',
                htmlContainer: '!text-sm !font-medium !text-slate-500 !mt-2',
                icon: '!border-0 !m-0 !mx-auto !mt-4 !mb-4',
                actions: '!mt-6 !gap-3 !w-full',
                confirmButton: '!bg-blue-600 hover:!bg-blue-700 !text-white !font-bold !rounded-xl !px-6 !py-3 !shadow-lg !shadow-blue-500/30 !transition-all active:!scale-95 !w-full sm:!w-auto',
                cancelButton: '!bg-white hover:!bg-slate-50 !text-slate-600 !font-bold !border !border-slate-200 !rounded-xl !px-6 !py-3 !shadow-sm !transition-all active:!scale-95 !w-full sm:!w-auto',
            },
            buttonsStyling: false,
            showClass: {
                popup: 'animate-fade-in-up'
            },
            hideClass: {
                popup: 'animate-fade-out-down'
            }
        });
    },

    /**
     * For destructive actions like deleting
     */
    danger: function(title, text, confirmText = 'ยืนยันการลบ') {
        return Swal.fire({
            title: title,
            text: text,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: confirmText,
            cancelButtonText: 'ยกเลิก',
            reverseButtons: true,
            customClass: {
                popup: '!rounded-3xl !shadow-2xl !border border-slate-100 !p-6 !bg-white/95 !backdrop-blur-xl',
                title: '!text-xl !font-bold !text-slate-800 !mt-2 !font-display',
                htmlContainer: '!text-sm !font-medium !text-slate-500 !mt-2',
                icon: '!border-0 !m-0 !mx-auto !mt-4 !mb-4 !text-red-500', 
                actions: '!mt-6 !gap-3 !w-full',
                confirmButton: '!bg-red-500 hover:!bg-red-600 !text-white !font-bold !rounded-xl !px-6 !py-3 !shadow-lg !shadow-red-500/30 !transition-all active:!scale-95 !w-full sm:!w-auto',
                cancelButton: '!bg-white hover:!bg-slate-50 !text-slate-600 !font-bold !border !border-slate-200 !rounded-xl !px-6 !py-3 !shadow-sm !transition-all active:!scale-95 !w-full sm:!w-auto',
            },
            buttonsStyling: false,
            showClass: {
                popup: 'animate-fade-in-up'
            },
            hideClass: {
                popup: 'animate-fade-out-down'
            }
        });
    }
};

window.AppConfirm = AppConfirm;

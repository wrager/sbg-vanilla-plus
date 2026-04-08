const TOAST_CLASS = 'svp-toast';
const TOAST_HIDE_CLASS = 'svp-toast-hide';
const DEFAULT_DURATION = 3000;

/**
 * Показать уведомление-тост поверх игры. Автоматически скрывается через duration мс.
 * CSS-стили подключаются из core/toast.css через entry.ts.
 */
export function showToast(message: string, duration = DEFAULT_DURATION): void {
  const toast = document.createElement('div');
  toast.className = TOAST_CLASS;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.classList.add(TOAST_HIDE_CLASS);
    toast.addEventListener('transitionend', () => {
      toast.remove();
    });
  }, duration);
}

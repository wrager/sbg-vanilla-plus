const TOAST_CLASS = 'svp-toast';
const TOAST_HIDE_CLASS = 'svp-toast-hide';
const DEFAULT_DURATION = 3000;

/**
 * Показать уведомление-тост поверх игры. Автоматически скрывается через duration мс
 * или раньше, если пользователь кликнул по нему.
 * CSS-стили подключаются из core/toast.css через entry.ts.
 */
export function showToast(message: string, duration = DEFAULT_DURATION): void {
  const toast = document.createElement('div');
  toast.className = TOAST_CLASS;
  toast.textContent = message;

  // Один путь скрытия для авто-таймера и клика: добавляем hide-класс (плавный
  // fade-out через CSS-transition) и удаляем тост из DOM по завершении
  // анимации. Повторный вызов — no-op, чтобы клик после старта авто-скрытия
  // не приводил к двойной remove'е.
  const dismiss = (): void => {
    if (toast.classList.contains(TOAST_HIDE_CLASS)) return;
    toast.classList.add(TOAST_HIDE_CLASS);
    toast.addEventListener('transitionend', () => {
      toast.remove();
    });
  };

  toast.addEventListener('click', dismiss);

  document.body.appendChild(toast);
  setTimeout(dismiss, duration);
}

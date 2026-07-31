import { GAME_TOAST_CLASS, getToastifyFactory } from './toastify';

const TOAST_CLASS = 'svp-toast';
const TOAST_HIDE_CLASS = 'svp-toast-hide';

/** Длительность показа. Совпадает с игровой (refs/game/script.js:4049). */
const DEFAULT_DURATION = 3000;

/** Место показа по умолчанию. Тоже как у игры (refs/game/script.js:4043). */
const DEFAULT_POSITION: ToastPosition = 'top center';

/**
 * Тип сообщения. Ровно два, как у игры: нейтральное и ошибка
 * (см. GAME_TOAST_CLASS в core/toastify.ts).
 */
export type ToastType = 'neutral' | 'error';

/** Формат тот же, что у игрового createToast: "<вертикаль> <горизонталь>". */
export type ToastPosition =
  | 'top left'
  | 'top center'
  | 'top right'
  | 'bottom left'
  | 'bottom center'
  | 'bottom right';

export interface IToastOptions {
  duration?: number;
  type?: ToastType;
  position?: ToastPosition;
  /** Элемент-якорь; по умолчанию тост уходит в body. */
  container?: HTMLElement | null;
}

/**
 * Показать уведомление поверх игры.
 *
 * Рисуется через Toastify игры: одновременные тосты он разводит сам, и наши
 * уведомления встают в тот же поток, что игровые, вместо собственной точки на
 * экране.
 */
export function showToast(message: string, options: IToastOptions = {}): void {
  const duration = options.duration ?? DEFAULT_DURATION;
  const factory = getToastifyFactory();

  if (factory === null) {
    showFallbackToast(message, duration);
    return;
  }

  const [gravity, alignment] = (options.position ?? DEFAULT_POSITION).split(' ');
  const toast = factory({
    text: message,
    duration,
    gravity,
    position: alignment,
    className: GAME_TOAST_CLASS[options.type ?? 'neutral'],
    selector: options.container ?? null,
    // Все сообщения SVP - обычный текст, и в них попадают имена точек с
    // сервера: разметку в них рендерить нельзя.
    escapeMarkup: true,
  });

  // Клик закрывает тост - то же поведение, что игра ставит своим
  // (refs/game/script.js:4056).
  toast.options.onClick = () => {
    toast.hideToast();
  };

  toast.showToast();
}

/**
 * Запасной путь на случай, когда Toastify недоступен: собственный узел в
 * фиксированной точке экрана.
 *
 * Тип и позиция здесь не учитываются намеренно. Игра без Toastify не стартует
 * вовсе (refs/game/script.js:16-27 рисует фатальную ошибку и чистит страницу),
 * так что этот путь остаётся для тестов и нештатной загрузки SVP на чужой
 * странице - повторять в нём раскладку и цвета Toastify незачем.
 */
function showFallbackToast(message: string, duration: number): void {
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

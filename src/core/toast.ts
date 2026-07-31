import { GAME_TOAST_CLASS, getToastifyFactory } from './toastify';

const TOAST_CLASS = 'svp-toast';

/** Длительность показа. Совпадает с игровой (refs/game/script.js:4049). */
const DEFAULT_DURATION = 3000;

/**
 * Тип сообщения. Ровно два, как у игры: нейтральное и ошибка
 * (см. GAME_TOAST_CLASS в core/toastify.ts).
 */
export type ToastType = 'neutral' | 'error';

export interface IToastOptions {
  duration?: number;
  type?: ToastType;
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

  const toast = factory({
    text: message,
    duration,
    // Место показа то же, что у игровых сообщений (refs/game/script.js:4043).
    // Задаётся явно: без позиции Toastify прижимает тост вправо (`position: ""`
    // в defaults, refs/toastify/toastify.js:40).
    gravity: 'top',
    position: 'center',
    className: GAME_TOAST_CLASS[options.type ?? 'neutral'],
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
 * Тип здесь не учитывается намеренно. Игра без Toastify не стартует
 * вовсе (refs/game/script.js:16-27 рисует фатальную ошибку и чистит страницу),
 * так что этот путь остаётся для тестов и нештатной загрузки SVP на чужой
 * странице - повторять в нём раскладку и цвета Toastify незачем.
 */
function showFallbackToast(message: string, duration: number): void {
  const toast = document.createElement('div');
  toast.className = TOAST_CLASS;
  toast.textContent = message;

  // Снятие без анимации: узел просто уходит из DOM. Повторное удаление
  // безопасно, поэтому клик и таймер не согласуются между собой.
  const dismiss = (): void => {
    toast.remove();
  };

  toast.addEventListener('click', dismiss);

  document.body.appendChild(toast);
  setTimeout(dismiss, duration);
}

import { GAME_TOAST_CLASS, isErrorToast } from '../../core/toastify';
import type { IToastElement, IToastifyInstance, IToastifyPrototype } from '../../core/toastify';
import { shortenRegionsText } from './regionsLine';

/**
 * Сборка одновременных уведомлений в один блок.
 *
 * Игра показывает каждое сообщение отдельным тостом, и серия действий (обычно
 * рисование линий: отказы сервера вперемешку с сообщениями о новых регионах)
 * засыпает экран стопкой. Живущие одновременно уведомления собираются в один
 * узел строками, повтор увеличивает счётчик.
 *
 * Граница проходит по контейнеру тоста. Тосты, привязанные к элементу
 * (попап точки, инвентарь, профиль, уведомления), не трогаем: тост с добычей
 * игра создаёт пустым и дописывает содержимое уже после показа
 * (refs/game/script.js:830-845), поэтому подмена узла стёрла бы игроку список
 * добычи. Такие тосты и так стоят у своего места и в общую стопку не идут.
 */

/** Больше пяти строк в углу экрана не читаются; вытесняется самая старая. */
const MAX_LINES = 5;

/** Блок уходит влево вверх: там его не перекрывают попапы игры. */
const BLOCK_ALIGNMENT = 'left';

interface IBlockLine {
  text: string;
  count: number;
  isError: boolean;
}

interface IBlockState {
  instance: IToastifyInstance | null;
  lines: IBlockLine[];
}

function removeToastElementImmediately(instance: IToastifyInstance): void {
  const element = instance.toastElement as IToastElement | null;
  if (!element) return;

  if (element.timeOutValue) {
    clearTimeout(element.timeOutValue);
  }
  element.remove();
}

/**
 * Блок жив, пока его узел в DOM. Инстанс сам по себе критерием не является:
 * тост мог истечь по таймеру, и продолжать в него дописывать нельзя.
 */
function isBlockAlive(state: IBlockState): boolean {
  return state.instance?.toastElement?.parentNode != null;
}

function resetBlock(state: IBlockState): void {
  state.instance = null;
  state.lines = [];
}

function renderLines(lines: IBlockLine[]): string {
  return lines
    .map((line) => (line.count > 1 ? `${line.text} (×${line.count})` : line.text))
    .join('<br>');
}

/**
 * Оборачивает callback тоста, чтобы по его завершении блок начинался заново.
 * Игра вешает на callback свою уборку (`popup_toasts`, refs/game/script.js:4058),
 * поэтому прежний вызывается следом.
 */
function wrapCallback(state: IBlockState, toast: IToastifyInstance): void {
  const previousCallback = toast.options.callback;
  toast.options.callback = () => {
    if (state.instance === toast) resetBlock(state);
    previousCallback?.();
  };
}

function addLine(lines: IBlockLine[], incoming: IBlockLine): IBlockLine[] {
  const existing = lines.find((line) => line.text === incoming.text);
  if (existing) {
    existing.count++;
    return lines;
  }

  const next = [...lines, incoming];
  return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
}

export function installToastBlock(proto: IToastifyPrototype): () => void {
  const state: IBlockState = { instance: null, lines: [] };
  // eslint-disable-next-line @typescript-eslint/unbound-method -- вызывается через .call(this)
  const original = proto.showToast;

  proto.showToast = function (this: IToastifyInstance) {
    if (this.options.selector != null) {
      original.call(this);
      return;
    }

    const alive = isBlockAlive(state);
    const previous = alive ? state.instance : null;
    const lines = addLine(alive ? state.lines : [], {
      text: shortenRegionsText(this.options.text),
      count: 1,
      isError: isErrorToast(this.options.className),
    });

    this.options.text = renderLines(lines);
    // Строки разделены <br>, поэтому текст уходит как разметка. Игра и так
    // создаёт свои тосты с escapeMarkup: false (refs/game/script.js:4047).
    this.options.escapeMarkup = false;
    this.options.position = BLOCK_ALIGNMENT;
    // Ошибка перевешивает: блок с отказом должен читаться как отказ, в каком бы
    // порядке ни пришли сообщения.
    this.options.className = lines.some((line) => line.isError)
      ? GAME_TOAST_CLASS.error
      : GAME_TOAST_CLASS.neutral;

    state.instance = this;
    state.lines = lines;
    wrapCallback(state, this);

    if (previous) {
      // Снимаем прежний узел мгновенно, без hideToast: его анимация ухода
      // длится 400 мс (refs/toastify/toastify.js:112), и всё это время на
      // экране висели бы два блока.
      removeToastElementImmediately(previous);
      previous.options.callback?.();
    }

    // Новый показ ставит свежий таймер - пока сообщения идут, блок живёт.
    original.call(this);
  };

  return () => {
    proto.showToast = original;
    resetBlock(state);
  };
}

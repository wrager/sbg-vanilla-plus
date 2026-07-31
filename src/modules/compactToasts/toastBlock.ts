import { isErrorToast } from '../../core/toastify';
import type { IToastElement, IToastifyInstance, IToastifyPrototype } from '../../core/toastify';
import { shortenRegionsText } from './regionsLine';

/**
 * Сборка одновременных ошибок в один блок.
 *
 * Игра показывает каждый отказ отдельным тостом, и серия действий (рисование
 * линий, повторные попытки вне радиуса) засыпает экран стопкой. Ошибки,
 * живущие одновременно, собираются в один узел строками; повтор увеличивает
 * счётчик.
 *
 * Собираются только ошибки. Нейтральные сообщения игрок читает по одному, и
 * склеивать их незачем; кроме того, тост с добычей игра создаёт пустым и
 * дописывает содержимое уже после показа (refs/game/script.js:830-845) -
 * подмена такого узла стёрла бы игроку список добычи.
 *
 * У каждой строки свой срок жизни, а не общий на блок: иначе строка из начала
 * серии доживала бы до её конца, и блок только рос бы.
 *
 * Блок собирается отдельно для каждого контейнера. Ошибки действий игра вешает
 * внутрь попапа точки (refs/game/script.js:807), и смешивать их с сообщениями
 * уровня экрана нельзя - это разные места на экране. Позиция при этом остаётся
 * та, которую задала игра.
 */

/** Больше пяти строк подряд не читаются; вытесняется самая старая. */
const MAX_LINES = 5;

interface IBlockLine {
  text: string;
  count: number;
  expiresAt: number;
}

interface IBlockState {
  instance: IToastifyInstance | null;
  lines: IBlockLine[];
  sweepTimer: ReturnType<typeof setTimeout> | null;
}

function createState(): IBlockState {
  return { instance: null, lines: [], sweepTimer: null };
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

/**
 * Строки соединяются разметкой, поэтому текст каждой экранируется. Сообщения
 * приходят от сервера, и разметку в них рендерить нельзя.
 */
function escapeHtml(text: string): string {
  const holder = document.createElement('div');
  holder.textContent = text;
  return holder.innerHTML;
}

function renderLines(lines: IBlockLine[]): string {
  return lines
    .map((line) => escapeHtml(line.count > 1 ? `${line.text} (×${line.count})` : line.text))
    .join('<br>');
}

function dropExpiredLines(state: IBlockState, now: number): void {
  state.lines = state.lines.filter((line) => line.expiresAt > now);
}

function addLine(lines: IBlockLine[], text: string, expiresAt: number): IBlockLine[] {
  const existing = lines.find((line) => line.text === text);
  if (existing) {
    existing.count++;
    existing.expiresAt = expiresAt;
    return lines;
  }

  const next = [...lines, { text, count: 1, expiresAt }];
  return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
}

/**
 * Снимает истёкшие строки с живого узла, не пересоздавая его. Узел живёт до
 * срока последней строки, поэтому пустым он здесь не остаётся - последнюю
 * строку и сам узел снимает таймер Toastify.
 */
function scheduleSweep(state: IBlockState): void {
  if (state.sweepTimer !== null) {
    clearTimeout(state.sweepTimer);
    state.sweepTimer = null;
  }
  if (state.lines.length === 0) return;

  const nextExpiry = Math.min(...state.lines.map((line) => line.expiresAt));
  state.sweepTimer = setTimeout(
    () => {
      state.sweepTimer = null;
      dropExpiredLines(state, Date.now());
      const element = state.instance?.toastElement;
      if (element && state.lines.length > 0) {
        element.innerHTML = renderLines(state.lines);
      }
      scheduleSweep(state);
    },
    Math.max(0, nextExpiry - Date.now()),
  );
}

function resetState(state: IBlockState): void {
  if (state.sweepTimer !== null) {
    clearTimeout(state.sweepTimer);
    state.sweepTimer = null;
  }
  state.instance = null;
  state.lines = [];
}

/**
 * Оборачивает callback тоста, чтобы по его завершении блок начинался заново.
 * Игра вешает на callback свою уборку (`popup_toasts`, refs/game/script.js:4058),
 * поэтому прежний вызывается следом.
 */
function wrapCallback(state: IBlockState, toast: IToastifyInstance): void {
  const previousCallback = toast.options.callback;
  toast.options.callback = () => {
    if (state.instance === toast) resetState(state);
    previousCallback?.();
  };
}

export function installToastBlock(proto: IToastifyPrototype): () => void {
  const states = new Map<Element | null, IBlockState>();
  // eslint-disable-next-line @typescript-eslint/unbound-method -- вызывается через .call(this)
  const original = proto.showToast;

  proto.showToast = function (this: IToastifyInstance) {
    if (!isErrorToast(this.options.className)) {
      // Единственная правка нейтрального сообщения - длинный тост про новые
      // регионы сворачивается в строку. Остальные проходят как есть.
      this.options.text = shortenRegionsText(this.options.text);
      original.call(this);
      return;
    }

    const container = this.options.selector ?? null;
    const state = states.get(container) ?? createState();
    states.set(container, state);

    const now = Date.now();
    const alive = isBlockAlive(state);
    if (!alive) resetState(state);
    dropExpiredLines(state, now);

    const previous = alive ? state.instance : null;
    state.lines = addLine(state.lines, this.options.text, now + this.options.duration);
    state.instance = this;

    this.options.text = renderLines(state.lines);
    // Строки соединены <br>, поэтому текст уходит разметкой; сам текст строк
    // при сборке экранирован.
    this.options.escapeMarkup = false;
    // Узел должен дожить до самой поздней строки: она могла прийти с большей
    // длительностью, чем текущее сообщение.
    this.options.duration = Math.max(...state.lines.map((line) => line.expiresAt)) - now;

    wrapCallback(state, this);

    if (previous) {
      // Снимаем прежний узел мгновенно, без hideToast: его анимация ухода
      // длится 400 мс (refs/toastify/toastify.js:112), и всё это время на
      // экране висели бы два блока.
      removeToastElementImmediately(previous);
      previous.options.callback?.();
    }

    original.call(this);
    scheduleSweep(state);
  };

  return () => {
    proto.showToast = original;
    states.forEach(resetState);
    states.clear();
  };
}

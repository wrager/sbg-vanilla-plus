import { injectStyles, removeStyles } from '../../core/dom';
import type { IGameLabel } from '../../core/gameI18n';
import {
  captureGameLabel,
  restoreGameLabel,
  setGameLabel,
  translateGameKey,
} from '../../core/gameI18n';
import { t } from '../../core/l10n';
import type { IFeatureModule } from '../../core/moduleRegistry';
import styles from './styles.css?inline';

const MODULE_ID = 'removeAttackCloseButton';

const ATTACK_BUTTON_SELECTOR = '#attack-menu';
const ATTACK_SLIDER_SELECTOR = '.attack-slider-wrp';
const CLOSE_BUTTON_SELECTOR = '#attack-slider-close';
const HIDDEN_CLASS = 'hidden';

// Ключ игрового перевода кнопки «Закрыть» рядом с «Огонь!»
// (refs/game/index.html:124). Перевод берём у игры, чтобы подпись совпадала
// с остальным интерфейсом; свой текст - фолбэк на случай недоступного i18next.
const CLOSE_LABEL_KEY = 'buttons.close';
const CLOSE_LABEL_FALLBACK = { en: 'Close', ru: 'Закрыть' };

let attackSlider: Element | null = null;
let attackButton: HTMLElement | null = null;
let attackLabel: IGameLabel | null = null;
let sliderObserver: MutationObserver | null = null;

function isAttackModeOpen(): boolean {
  return attackSlider !== null && !attackSlider.classList.contains(HIDDEN_CLASS);
}

function showCloseLabel(): void {
  if (!attackButton || attackLabel) return;
  attackLabel = captureGameLabel(attackButton);
  setGameLabel(attackButton, translateGameKey(CLOSE_LABEL_KEY) ?? t(CLOSE_LABEL_FALLBACK));
}

function showAttackLabel(): void {
  if (!attackButton || !attackLabel) return;
  restoreGameLabel(attackButton, attackLabel);
  attackLabel = null;
}

/*
 * Режим атаки открывается и закрывается не только нашей кнопкой: игра прячет
 * слайдер при входе в режим рисования (refs/game/script.js:1029) и по нативной
 * кнопке «Закрыть». Поэтому подпись ведём от класса `hidden` на слайдере, а не
 * от собственных кликов.
 */
function syncAttackButtonLabel(): void {
  if (isAttackModeOpen()) {
    showCloseLabel();
  } else {
    showAttackLabel();
  }
}

/*
 * Клик по кнопке в режиме атаки уводим на нативную «Закрыть»: её обработчик
 * (refs/game/script.js:1803) делает полный выход из режима - возвращает офсет
 * вида, снимает подсветку радиуса атаки, пересчитывает позицию игрока.
 *
 * Нативный обработчик #attack-menu (refs/game/script.js:1550) закрывает режим
 * повторным кликом, но перед этим читает инвентарь и уходит в тост
 * «нет оружия», если израсходован последний катализатор - режим остаётся
 * открытым, а кнопка «Закрыть» рядом с «Огонь!» скрыта нашим стилем, и выйти
 * из режима становится нечем.
 */
function onDocumentClickCapture(event: Event): void {
  if (!attackButton || !isAttackModeOpen()) return;
  const target = event.target;
  if (!(target instanceof Node) || !attackButton.contains(target)) return;

  const closeButton = document.querySelector(CLOSE_BUTTON_SELECTOR);
  // Нативной кнопки нет (игра обновилась) - отдаём клик игре: её собственный
  // toggle остаётся рабочим выходом из режима.
  if (!(closeButton instanceof HTMLElement)) return;

  // Только stopPropagation: обработчик игры висит на самой кнопке, а другие
  // capture-слушатели документа (наши модули, хост) должны клик получить.
  event.stopPropagation();
  closeButton.click();
}

export const removeAttackCloseButton: IFeatureModule = {
  id: MODULE_ID,
  name: {
    en: 'Attack button closes attack mode',
    ru: 'Кнопка атаки закрывает режим атаки',
  },
  description: {
    en: 'In attack mode the Attack button turns into Close, and the Close button next to Fire is removed so it is never hit by mistake',
    ru: 'В режиме атаки кнопка «Атака» превращается в «Закрыть», а кнопка «Закрыть» рядом с «Огонь!» убрана, чтобы не нажать её случайно',
  },
  defaultEnabled: true,
  category: 'ui',
  init() {},
  enable() {
    injectStyles(styles, MODULE_ID);

    // Кнопка и слайдер лежат в статической разметке игры
    // (refs/game/index.html:90,113), к моменту bootstrap (DOMContentLoaded)
    // оба уже в DOM - ожидание появления не нужно.
    attackSlider = document.querySelector(ATTACK_SLIDER_SELECTOR);
    const button = document.querySelector(ATTACK_BUTTON_SELECTOR);
    attackButton = button instanceof HTMLElement ? button : null;
    if (!attackSlider || !attackButton) return;

    sliderObserver = new MutationObserver(syncAttackButtonLabel);
    sliderObserver.observe(attackSlider, { attributes: true, attributeFilter: ['class'] });
    document.addEventListener('click', onDocumentClickCapture, true);

    // Модуль могли включить в настройках при уже открытом режиме атаки.
    syncAttackButtonLabel();
  },
  disable() {
    removeStyles(MODULE_ID);
    sliderObserver?.disconnect();
    sliderObserver = null;
    document.removeEventListener('click', onDocumentClickCapture, true);
    showAttackLabel();
    attackSlider = null;
    attackButton = null;
  },
};

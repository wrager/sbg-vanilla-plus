import type { IFeatureModule } from '../../core/moduleRegistry';
import { $, $$, injectStyles, observeText, removeStyles, waitForElement } from '../../core/dom';
import { captureGameLabel, restoreGameLabel, setGameLabel } from '../../core/gameI18n';
import css from './styles.css?inline';

const MODULE_ID = 'enhancedMainScreen';

let cleanup: (() => void) | null = null;

function isHTMLElement(element: unknown): element is HTMLElement {
  return element instanceof HTMLElement;
}

/** Заменяет текст кнопки OPS на статус инвентаря "inv/lim" с реактивным обновлением */
function setupOpsInventory(container: Element, opsButton: HTMLElement): { destroy: () => void } {
  const invSpan = $('#self-info__inv', container);
  const limSpan = $('#self-info__inv-lim', container);
  const invEntry = invSpan?.closest('.self-info__entry');

  // Сохраняем оригинальные текст и data-i18n ДО мутации, чтобы на disable
  // откатиться без зависимостей от внешних библиотек.
  const opsLabel = captureGameLabel(opsButton);

  const update = () => {
    const inv = invSpan?.textContent ?? '?';
    const lim = limSpan?.textContent ?? '?';
    setGameLabel(opsButton, `${inv}/${lim}`);

    // Цвет переполнения инвентаря (игра ставит color на .self-info__entry)
    if (isHTMLElement(invEntry)) {
      opsButton.style.color = invEntry.style.color;
    }
  };

  update();

  const textTargets = [invSpan, limSpan].filter((n): n is Element => n !== null);
  const textObserver = observeText(textTargets, update);

  const attrObserver = new MutationObserver(update);
  if (isHTMLElement(invEntry)) {
    attrObserver.observe(invEntry, { attributes: true, attributeFilter: ['style'] });
  }

  return {
    destroy: () => {
      textObserver.disconnect();
      attrObserver.disconnect();
      opsButton.style.color = '';
      restoreGameLabel(opsButton, opsLabel);
    },
  };
}

async function setup(): Promise<() => void> {
  const container = await waitForElement('.topleft-container');
  if (!isHTMLElement(container)) return () => {};
  const selfInfo = $('.self-info', container);
  if (!isHTMLElement(selfInfo)) return () => {};
  const opsButton = $('#ops', container);
  if (!isHTMLElement(opsButton)) return () => {};

  // Reparent оригинального span ника в self-info (сохраняет .profile-link и обработчики)
  const nameSpan = $('#self-info__name', container);
  const nameSpanParent = nameSpan?.parentElement;
  const nameSpanNextSibling = nameSpan?.nextSibling ?? null;

  // Скрываем все записи self-info (ник, опыт, инвентарь, координаты), effects остаётся.
  // Сохраняем исходный inline display каждой записи, чтобы при disable восстановить
  // ровно то значение, что было до нашей правки (а не сбросить в пустую строку,
  // потеряв возможные игровые inline-стили).
  const hiddenElements = $$('.self-info__entry', container).filter(isHTMLElement);
  const originalDisplays = new Map<HTMLElement, string>();
  for (const element of hiddenElements) {
    originalDisplays.set(element, element.style.display);
    element.style.display = 'none';
  }

  // Ник - reparent оригинального span прямо в self-info
  if (nameSpan) {
    selfInfo.appendChild(nameSpan);
  }

  // Уровень и опыт рядом с ником (тем же шрифтом - наследуется от .self-info).
  // Игра обновляет оба span по id через jQuery .text() (refs/game/script.js:2303-2306),
  // поэтому reparent не ломает реактивность.
  const explvSpan = $('#self-info__explv', container);
  const explvSpanParent = explvSpan?.parentElement ?? null;
  const explvSpanNextSibling = explvSpan?.nextSibling ?? null;
  const originalExplvText = explvSpan?.textContent ?? null;
  const expSpan = $('#self-info__exp', container);
  const expSpanParent = expSpan?.parentElement ?? null;
  const expSpanNextSibling = expSpan?.nextSibling ?? null;
  const addedSpacers: Text[] = [];

  const appendSpacer = (): void => {
    const spacer = document.createTextNode(' ');
    selfInfo.appendChild(spacer);
    addedSpacers.push(spacer);
  };

  // Уровень сразу справа от ника, опыт после уровня. Игра ставит текст
  // уровня вида "(Lv-10)" или "(Ур-10)" через i18next, пользователь хочет
  // видеть просто число "10" - вырезаем всё нецифровое (работает для
  // en/ru и любой другой локали). Guard на равенство нужен, чтобы наша
  // же запись не зациклила observer (в Chromium characterData mutation
  // срабатывает на присваивание textContent даже при том же значении).
  // Gap между уровнем и опытом задан в CSS через margin-right на уровне.
  let explvObserver: MutationObserver | null = null;
  if (explvSpan) {
    appendSpacer();
    selfInfo.appendChild(explvSpan);

    const stripToDigits = (): void => {
      const current = explvSpan.textContent;
      const stripped = current.replace(/\D/g, '');
      if (current !== stripped) {
        explvSpan.textContent = stripped;
      }
    };
    stripToDigits();
    explvObserver = observeText(explvSpan, stripToDigits);
  }

  if (expSpan) {
    selfInfo.appendChild(expSpan);
  }

  // Статус инвентаря → текст кнопки OPS
  const opsInventory = setupOpsInventory(container, opsButton);

  // Переместить game-menu над self-info (меню сверху, ник снизу)
  const gameMenu = $('.game-menu', container);
  if (isHTMLElement(gameMenu)) {
    container.insertBefore(gameMenu, selfInfo);
  }

  // Заменить текст кнопки Settings на символ шестерёнки (text presentation)
  const settingsButton = $('#settings', container);
  const settingsLabel = isHTMLElement(settingsButton) ? captureGameLabel(settingsButton) : null;
  if (isHTMLElement(settingsButton)) {
    setGameLabel(settingsButton, '\u2699\uFE0E');
  }

  container.classList.add('svp-compact');

  const restoreSpan = (
    span: Element | null,
    parent: Node | null,
    nextSibling: Node | null,
  ): void => {
    if (!span || !parent) return;
    if (nextSibling) {
      parent.insertBefore(span, nextSibling);
    } else {
      parent.appendChild(span);
    }
  };

  return () => {
    explvObserver?.disconnect();
    // Текст уровня stripToDigits заменил на "10", оригинал был "(Ур-10)" /
    // "(Lv-10)". Игра перерисует текст только при изменении уровня, поэтому
    // без явного restore он останется обрезанным после disable.
    if (explvSpan && originalExplvText !== null) {
      explvSpan.textContent = originalExplvText;
    }
    opsInventory.destroy();
    if (isHTMLElement(settingsButton) && settingsLabel) {
      restoreGameLabel(settingsButton, settingsLabel);
    }
    // Вернуть перенесённые span'ы на прежние места в оригинальных записях.
    restoreSpan(nameSpan, nameSpanParent ?? null, nameSpanNextSibling);
    restoreSpan(explvSpan, explvSpanParent, explvSpanNextSibling);
    restoreSpan(expSpan, expSpanParent, expSpanNextSibling);
    for (const spacer of addedSpacers) {
      spacer.remove();
    }
    // Вернуть game-menu после self-info
    if (isHTMLElement(gameMenu)) {
      selfInfo.after(gameMenu);
    }
    for (const element of hiddenElements) {
      element.style.display = originalDisplays.get(element) ?? '';
    }
    container.classList.remove('svp-compact');
  };
}

export const enhancedMainScreen: IFeatureModule = {
  id: MODULE_ID,
  name: { en: 'Enhanced main screen', ru: 'Улучшенный главный экран' },
  description: {
    en: 'Compact top panel, attack button centered',
    ru: 'Компактная верхняя панель, кнопка атаки по центру',
  },
  defaultEnabled: true,
  category: 'ui',
  init() {},
  async enable() {
    injectStyles(css, MODULE_ID);
    cleanup = await setup();
  },
  disable() {
    removeStyles(MODULE_ID);
    cleanup?.();
    cleanup = null;
  },
};

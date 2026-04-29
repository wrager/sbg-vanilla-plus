import type { IFeatureModule } from '../../core/moduleRegistry';

const MODULE_ID = 'repairButtonFix';
const REPAIR_BUTTON_ID = 'repair';
const LOCKED_CLASS = 'locked';

// Игровой обработчик #repair (refs/game/script.js:946-953) при клике добавляет
// класс `locked` и `disabled`, await apiSend, потом снимает обратно. catch
// деструктурирует `{ toast }` из rejection: если apiSend отвалился ошибкой без
// поля `toast` (network abort при быстрой смене точки, TypeError из чужого
// скрипта), деструктуризация бросает - ветка снятия `locked`/`disabled` не
// выполняется, кнопка зависает до перезагрузки страницы.
//
// Стандартный repair-запрос отрабатывает <1c. Висящий `locked` >10c -
// фактически признак залипания. Снимаем класс и атрибут, чтобы пользователь
// мог продолжить чинить точку. Длинная сетевая задержка >10c - редкость; даже
// если попадём - повторный клик пошлёт новый запрос, серверная сторона его
// дросселирует если предыдущий ещё в полёте.
const STUCK_LOCKED_TIMEOUT_MS = 10000;

let observer: MutationObserver | null = null;
let stuckTimer: ReturnType<typeof setTimeout> | null = null;

function clearStuckTimer(): void {
  if (stuckTimer !== null) {
    clearTimeout(stuckTimer);
    stuckTimer = null;
  }
}

function unstickRepairButton(button: HTMLElement): void {
  button.classList.remove(LOCKED_CLASS);
  button.removeAttribute('disabled');
  console.warn(
    `[SVP ${MODULE_ID}] кнопка #${REPAIR_BUTTON_ID} была залочена > ${String(STUCK_LOCKED_TIMEOUT_MS)}мс - снимаем lock`,
  );
}

function scheduleStuckCheck(button: HTMLElement): void {
  if (stuckTimer !== null) return;
  stuckTimer = setTimeout(() => {
    stuckTimer = null;
    if (button.classList.contains(LOCKED_CLASS)) {
      unstickRepairButton(button);
    }
  }, STUCK_LOCKED_TIMEOUT_MS);
}

function onMutation(mutations: MutationRecord[]): void {
  for (const m of mutations) {
    if (m.type !== 'attributes') continue;
    if (!(m.target instanceof HTMLElement)) continue;
    if (m.target.id !== REPAIR_BUTTON_ID) continue;

    const isLocked = m.target.classList.contains(LOCKED_CLASS);
    if (isLocked) {
      scheduleStuckCheck(m.target);
    } else {
      // Игра штатно сняла `locked` - таймер больше не нужен, гонка между
      // нашим unstick и игровым cleanup закрыта.
      clearStuckTimer();
    }
  }
}

export const repairButtonFix: IFeatureModule = {
  id: MODULE_ID,
  name: { en: 'Repair button stuck-state fix', ru: 'Фикс залипания кнопки починки' },
  description: {
    en: 'Recovers the "Repair" button when the game leaves it stuck in disabled state. Symptom: after rapid attack-defend cycles the button stays gray and unclickable until page reload. Defensive timeout: if the locked class persists for over 10 seconds, the class and the disabled attribute are removed automatically.',
    ru: 'Возвращает кнопку «Починить» из залипшего disabled-состояния. Симптом: после быстрого заряда точек под атакой кнопка остаётся серой и не нажимается до перезагрузки страницы. Защита по таймауту: если класс locked висит больше 10 секунд, класс и атрибут disabled автоматически снимаются.',
  },
  defaultEnabled: true,
  category: 'fix',
  init() {},
  enable() {
    observer = new MutationObserver(onMutation);
    observer.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });
  },
  disable() {
    observer?.disconnect();
    observer = null;
    clearStuckTimer();
  },
};

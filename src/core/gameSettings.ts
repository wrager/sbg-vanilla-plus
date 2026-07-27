/**
 * Чтение игровых настроек из `localStorage['settings']`.
 *
 * Отсутствие ключа - штатное состояние, а не "настроек нет". SBG 0.7.0 убрал
 * материализацию ключа при первом запуске (`initSettings` в игровом скрипте):
 * игра читает значения через `getLocalStorageDefault`, а пишет ключ только при
 * первом изменении настройки (`changeSettings`). У игрока, ни разу не
 * заходившего в настройки, ключа нет, а игра работает по дефолтам из
 * `getLocalStorageDefault` - их же отдаём и мы.
 *
 * До появления этого модуля ключ разбирался в каждом потребителе отдельно и с
 * разными фолбэками, из-за чего отсутствие ключа в одном месте означало
 * "английский язык", а в другом - "светлая тема".
 */

import { isRecord } from './isRecord';

const SETTINGS_KEY = 'settings';

/** Тема игры: 'auto' - по системной теме браузера. */
export type GameTheme = 'auto' | 'light' | 'dark';

/**
 * Читаемые SVP настройки игры с типами их значений.
 *
 * Дублируется только читаемое SVP подмножество: полный объект настроек игры
 * (ветка `'settings'` в `getLocalStorageDefault`) пришлось бы сверять с игрой
 * при каждом её обновлении, а поле сюда дешевле добавить по факту появления
 * потребителя.
 * Тип значения не обязан быть строкой: у игры больше половины настроек -
 * boolean и number (`imghid`, `selfpos`, `opacity`, `useadu`), для них
 * добавляется свой guard в GAME_SETTING_GUARDS.
 */
interface IGameSettings {
  /** Язык интерфейса: 'sys' - по системной локали, иначе код языка i18next. */
  lang: string;
  theme: GameTheme;
}

export type GameSettingKey = keyof IGameSettings;

const GAME_SETTINGS_DEFAULTS: IGameSettings = {
  lang: 'sys',
  theme: 'auto',
};

const GAME_THEMES: readonly GameTheme[] = ['auto', 'light', 'dark'];

/**
 * Проверка значения из storage на соответствие типу настройки. Значение,
 * не прошедшее проверку, заменяется дефолтом игры: игрок правил ключ руками
 * или игра сменила набор допустимых значений.
 */
const GAME_SETTING_GUARDS: {
  [K in GameSettingKey]: (value: unknown) => value is IGameSettings[K];
} = {
  lang: (value): value is string => typeof value === 'string',
  theme: (value): value is GameTheme => GAME_THEMES.some((theme) => theme === value),
};

/**
 * Значение игровой настройки. Возвращает дефолт игры, если ключа нет, его
 * содержимое не разбирается как объект, поле отсутствует или его значение не
 * подходит типу настройки.
 *
 * Дефолт по отдельному полю - наш выбор, а не поведение игры: игровой
 * `getSettings` подставляет дефолт на весь объект, а по отсутствующему полю
 * отдаёт undefined (для `lang` это уводит i18next в `fallbackLng`). Штатным
 * путём такого объекта не бывает - `changeSettings` пишет его целиком, - но он
 * появится, когда игра добавит новое поле в дефолты: у существующих игроков
 * этого поля в ключе не окажется. Дефолт по полю даст потребителю то же
 * значение, что игрок видит в игре, вместо отсутствующего; сама игра местами
 * делает так же (`data.efmode ?? 'full'`, `data.opacity || 2`).
 */
export function readGameSetting<K extends GameSettingKey>(key: K): IGameSettings[K] {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      if (isRecord(parsed)) {
        const value = parsed[key];
        if (GAME_SETTING_GUARDS[key](value)) return value;
      }
    }
  } catch {
    // Невалидный JSON или недоступный localStorage (private mode) - дефолт.
  }
  return GAME_SETTINGS_DEFAULTS[key];
}

/**
 * Тёмная ли тема у игрока на самом деле. Повторяет формулу игры: `'auto'`
 * (дефолт) разворачивается через `prefers-color-scheme`, остальные значения
 * сравниваются с `'dark'` напрямую (`is_dark` при инициализации и в
 * обработчике смены темы игрового скрипта).
 *
 * Сравнение настройки с `'dark'` без этого шага светлит интерфейс игроку с
 * дефолтной темой и тёмной системной.
 */
export function isGameDarkTheme(): boolean {
  const theme = readGameSetting('theme');
  if (theme === 'auto') return matchMedia('(prefers-color-scheme: dark)').matches;
  return theme === 'dark';
}

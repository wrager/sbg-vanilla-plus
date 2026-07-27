/**
 * Чтение игровых настроек из `localStorage['settings']`.
 *
 * Отсутствие ключа - штатное состояние, а не "настроек нет". SBG 0.7.0 убрал
 * материализацию ключа при первом запуске (refs/game/script.js:3641,
 * initSettings): игра читает значения через `getLocalStorageDefault`
 * (refs/game/script.js:3674) и пишет ключ только при первом изменении
 * настройки. У игрока, ни разу не заходившего в настройки, ключа нет, а игра
 * работает по дефолтам из `getLocalStorageDefault` - их же отдаём и мы.
 *
 * До появления этого модуля ключ разбирался в каждом потребителе отдельно и с
 * разными фолбэками, из-за чего отсутствие ключа в одном месте означало
 * "английский язык", а в другом - "светлая тема".
 */

const SETTINGS_KEY = 'settings';

/**
 * Дефолты игры для настроек, которые читает SVP.
 *
 * Дублируется только читаемое SVP подмножество: полный объект настроек игры
 * (refs/game/script.js:3699) пришлось бы сверять с игрой при каждом её
 * обновлении, а поле сюда дешевле добавить по факту появления потребителя.
 */
const GAME_SETTINGS_DEFAULTS = {
  /** Язык интерфейса: 'sys' - по системной локали, иначе код языка. */
  lang: 'sys',
  /** Тема: 'auto' - по системной, иначе 'light' / 'dark'. */
  theme: 'auto',
} as const;

export type GameSettingKey = keyof typeof GAME_SETTINGS_DEFAULTS;

function isStringKeyedObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Значение игровой настройки. Возвращает дефолт игры, если ключа нет, его
 * содержимое не разбирается как объект, поле отсутствует или лежит не строкой.
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
export function readGameSetting(key: GameSettingKey): string {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      if (isStringKeyedObject(parsed)) {
        const value = parsed[key];
        if (typeof value === 'string') return value;
      }
    }
  } catch {
    // Невалидный JSON или недоступный localStorage (private mode) - дефолт.
  }
  return GAME_SETTINGS_DEFAULTS[key];
}

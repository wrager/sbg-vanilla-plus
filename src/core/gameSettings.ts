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

/** Значение `settings.theme`, при котором игра берёт тему из системной. */
const AUTO_THEME = 'auto';

/** Значение `settings.theme`, с которым игра сравнивает все остальные темы. */
const DARK_THEME = 'dark';

/** Значение `settings.base`, при котором игра грузит тайлы CartoDB. */
const CARTO_DB_BASE = 'cdb';

/**
 * Читаемые SVP настройки игры с типами их значений.
 *
 * Дублируется только читаемое SVP подмножество: полный объект настроек игры
 * (ветка `'settings'` в `getLocalStorageDefault`) пришлось бы сверять с игрой
 * при каждом её обновлении, а поле сюда дешевле добавить по факту появления
 * потребителя.
 * Тип значения не обязан быть строкой: у игры есть настройки-числа и
 * настройки-флаги (`imghid`, `selfpos`, `opacity`, `useadu`), для них
 * добавляется свой guard в GAME_SETTING_GUARDS.
 * Тема объявлена строкой, а не набором известных значений: игра сравнивает
 * её с `'auto'` и `'dark'`, но посторонним значением не давится, и сузить
 * тип - значит трактовать неизвестную тему иначе, чем сама игра.
 */
interface IGameSettings {
  /** Язык интерфейса: 'sys' - по системной локали, иначе код языка i18next. */
  lang: string;
  /** Тема: 'auto' - по системной, остальные сравниваются с 'dark'. */
  theme: string;
  /** Базовая карта: 'cdb' - тайлы CartoDB, 'osm', 'goo', остальные - пустая. */
  base: string;
}

export type GameSettingKey = keyof IGameSettings;

/**
 * Дефолты игры, которыми она пользуется при отсутствующем ключе
 * (`getLocalStorageDefault`).
 */
const GAME_SETTINGS_DEFAULTS: IGameSettings = {
  lang: 'sys',
  theme: AUTO_THEME,
  base: CARTO_DB_BASE,
};

/**
 * Проверка значения из storage на соответствие типу настройки. Не прошедшее
 * проверку значение неотличимо для нас от отсутствующего: вернуть его как
 * есть мешает тип, а подставлять вместо него дефолт игра бы не стала.
 */
const GAME_SETTING_GUARDS: {
  [K in GameSettingKey]: (value: unknown) => value is IGameSettings[K];
} = {
  lang: (value): value is string => typeof value === 'string',
  theme: (value): value is string => typeof value === 'string',
  base: (value): value is string => typeof value === 'string',
};

/**
 * Значение игровой настройки, повторяющее то, что по этому полю видит сама
 * игра.
 *
 * Дефолт подставляется на весь объект и только когда его неоткуда взять:
 * ключа нет или содержимое разобралось в `null`. Так делает игровой `getJson`,
 * на котором стоит `getSettings`.
 *
 * На битом JSON и на недоступном `localStorage` игровой `getJson` бросает, а
 * мы и там отдаём дефолт: функцию зовут из рендера интерфейса SVP и из
 * обработчика апгрейда базы избранного, где исключение стоило бы дороже
 * дефолтного значения.
 *
 * Разобранный объект отдаётся как есть, без подстановки по отдельному полю:
 * игровой `getSettings` читает его напрямую и по отсутствующему полю отдаёт
 * undefined. Подстановка дефолта здесь означала бы для `lang` системную
 * локаль там, где игра уходит в `fallbackLng` своего i18next, а для `theme` -
 * системную тему там, где игра рисует светлую.
 */
export function readGameSetting<K extends GameSettingKey>(key: K): IGameSettings[K] | undefined {
  let parsed: unknown;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw === null) return GAME_SETTINGS_DEFAULTS[key];
    parsed = JSON.parse(raw);
  } catch {
    // Невалидный JSON или недоступный localStorage (private mode) - дефолт.
    return GAME_SETTINGS_DEFAULTS[key];
  }
  // Игровой getJson подставляет дефолт ровно на null: разобранное значение
  // любого другого вида идёт в чтение поля как есть, и у не-объекта поле
  // просто не находится.
  if (parsed === null) return GAME_SETTINGS_DEFAULTS[key];
  if (!isRecord(parsed)) return undefined;

  const value = parsed[key];
  return GAME_SETTING_GUARDS[key](value) ? value : undefined;
}

/**
 * Тёмная ли тема у игрока на самом деле. Повторяет формулу игры: `'auto'`
 * (дефолт) разворачивается через `prefers-color-scheme`, а любое другое
 * значение, включая отсутствующее и постороннее, сравнивается с `'dark'`
 * напрямую (`is_dark` при инициализации и в обработчике смены темы игрового
 * скрипта).
 *
 * Сравнение настройки с `'dark'` без разворота `'auto'` светлит интерфейс
 * игроку с дефолтной темой и тёмной системной.
 */
export function isGameDarkTheme(): boolean {
  const theme = readGameSetting('theme');
  if (theme === AUTO_THEME) return prefersDarkColorScheme();
  return theme === DARK_THEME;
}

/**
 * Подложка карты у игрока - тайлы CartoDB. Только у них игра при тёмной теме
 * берёт тёмный вариант (`dark_all` в `setBaselayer`), остальные базы остаются
 * светлыми при любой теме.
 *
 * Отсутствующее в ключе поле не заменяется дефолтом: игра в этом случае берёт
 * `'osm'` (`getSettings('base') || 'osm'`), а не свой дефолт `'cdb'`.
 */
export function isGameCartoDbBaselayer(): boolean {
  return readGameSetting('base') === CARTO_DB_BASE;
}

/**
 * Системная тема тёмная. Отказ `matchMedia` считается светлой темой: функцию
 * зовут из обработчика апгрейда базы избранного, где исключение убило бы
 * транзакцию вместе с загрузкой избранного, а чтение настроек до появления
 * этой ветки бросить не могло.
 */
function prefersDarkColorScheme(): boolean {
  try {
    return matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

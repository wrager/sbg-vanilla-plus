# Архитектура SBG Vanilla+

## Один скрипт

Один userscript `sbg-vanilla-plus.user.js` — все модули в одном бандле.

## Интерфейс модуля

```typescript
interface IFeatureModule {
  id: string; // ключ в настройках
  name: ILocalizedString; // { en, ru }
  description: ILocalizedString; // { en, ru }
  defaultEnabled: boolean;
  category: 'ui' | 'map' | 'feature' | 'utility' | 'fix';
  requiresReload?: boolean; // при переключении — перезагрузка страницы
  status?: 'ready' | 'failed'; // runtime-статус после init/enable
  init(): void | Promise<void>; // один раз при загрузке
  enable(): void | Promise<void>;
  disable(): void | Promise<void>;
}
```

## Ключевые механизмы

**Killswitch** — `src/core/killswitch.ts`: проверка `#svp-disabled=1` в hash/sessionStorage.

**Отказоустойчивость** — каждый модуль в `try/catch` при init/enable. Сломанный помечается `failed`, не блокирует остальные. Поддерживаются как синхронные, так и async-фазы: если init/enable возвращает `Promise`, bootstrap ожидает его завершения.

**CSS-инъекция** — `import styles from './styles.css?inline'` → `injectStyles(css, id)` → `<style id="svp-{id}">`.

**Настройки** — `localStorage['svp_settings']`: `{ version: number, modules: Record<string, boolean>, errors: Record<string, string> }`. Миграции через массив `migrations[]` с автоматическим бэкапом.

**Панель настроек** — кнопка ⚙ открывает полноэкранную панель. Модули сгруппированы по категориям: Интерфейс, Карта, Фичи, Утилиты, Багфиксы.

**OL Map capture** — `src/core/olMap.ts`: перехват `ol.Map.prototype.getView()` через Proxy для захвата экземпляра карты (игра хранит `map` в локальной переменной). Если `window.ol` ещё не загружен — перехват через `Object.defineProperty`. Предоставляет `getOlMap(): Promise<IOlMap>`, утилиты `findDragPanInteractions()`, `findLayerByName()`, `createDragPanControl()`.

**Локализация** — `src/core/l10n.ts`: `ILocalizedString = { en, ru }`, функция `t()` выбирает текст по языку игры.

**Игровые константы** — `src/core/gameConstants.ts`: типы предметов инвентаря (`ITEM_TYPE_CORE`, `ITEM_TYPE_CATALYSER`, `ITEM_TYPE_REFERENCE`, `ITEM_TYPE_BROOM`).

**Типы инвентаря** — `src/core/inventoryTypes.ts`: интерфейсы и type guard'ы для всех типов предметов.

**Кэш инвентаря** — `src/core/inventoryCache.ts`: чтение и парсинг `inventory-cache` из localStorage.

**Цвета темы** — `src/core/themeColors.ts`: чтение CSS custom properties (`--text`, `--background`).

**Лог ошибок** — `src/core/errorLog.ts`: перехват `console.error`/`console.warn` и глобальных ошибок, хранение последних 50 записей.

**Баг-репорты** — `src/core/bugReport.ts`: формирование отчёта с версиями, настройками и логом ошибок.

**Версия SBG** — `src/core/gameVersion.ts`: `SBG_COMPATIBLE_VERSIONS` (поддерживается v0.6.0 и v0.6.1). Проверяет заголовок `x-sbg-version` из любого `/api/*` ответа через perf-патч `window.fetch` в document-start. Сеты `DEPRECATED_MODULES_NATIVE` и `DEPRECATED_MODULES_CONFLICTED` сейчас пусты — модули, чей use case был перекрыт нативно в 0.6.1, либо адаптированы (lock-aware deletion в `inventoryCleanup` с блокировкой при pending миграции, runtime-детекция `FixedPointRotate` плюс state-machine подавления `singleFingerRotation` во время нативного `ngrsZoom`-жеста, переименование `keyCountOnPoints` → `keyCountFix` с подавлением нативного канала только при включённом References-слое, переосмысление `favoritedPoints` → `favoritesMigration`), либо удалены физически (`repairAtFullCharge`, `ngrsZoom`, `swipeToClosePopup`). Инфраструктура подавления оставлена для будущих версий игры.

**Замена нативного канала References (keyCountFix)** — модуль рисует количество ключей на собственном OL Vector layer с адаптивным размером шрифта (`clamp(10, zoom-3, 16)`) и без `rotateWithView`, чтобы числа оставались читаемыми на любом масштабе и не вращались с картой. Активируется ТОЛЬКО если игрок выбрал References в layers-config (textChannel = 7 в байте 2 поля `map-config.h`); при любом другом канале нативный 32px-текст не рисуется, и модуль уходит в no-op без хука и слоя. Когда модуль активирован, на enable он хукает `Storage.prototype.getItem` для ключа `map-config` и маскирует байт 2 c 7 (References) на 0 (None) — нативный LIGHT-renderer не рисует свой текст параллельно с нашим слоем. Хук скоупится строго на `localStorage` и ключ `map-config`, на disable снимается полностью.

**Lock-флаги в inventoryCleanup** — поле `f` стопки в `inventory-cache` (бит 0b10 = locked) защищает все ключи точки от автоочистки. Агрегация per-point: `buildLockedPointGuids(items)` возвращает Set GUID'ов точек, у которых хотя бы одна стопка имеет lock-бит. Защитный слой — единственный (legacy SVP/CUI в логике удаления больше не участвует, он остаётся только источником миграции). `calculateDeletions` запускает удаление рефов, если в кэше доступна `lockSupportAvailable` (наличие поля `f` хотя бы у одной стопки — сигнал, что сервер 0.6.1+ отдаёт lock-семантику). Дополнительная блокировка: пока legacy SVP/CUI-список непуст и активен модуль `favoritesMigration`, `runCleanup` принудительно ставит `referencesMode = 'off'` для текущего запуска — миграция ещё не сделана, и автоочистка ключей удалила бы то, что пользователь защищал в SVP/CUI. Финальный guard в `deleteInventoryItems` перечитывает свежий кэш перед каждым DELETE — пользователь мог поставить замок прямо во время cleanup'а.

**Подавление singleFingerRotation во время ngrsZoom** — модуль одним пальцем вращает карту в режиме Follow, но в SBG 0.6.1 на canvas работает нативный `ol.interaction.DblClickDragZoom` (двойной тап + удержание + вертикальный drag). Чтобы не конфликтовать, модуль ведёт state-machine double-tap-detection: на каждом touchend запоминает timestamp/координаты, на следующем touchstart в окне 300мс/30px ставит `pendingNgrsDecision`. Первый touchmove определяет жест по доминирующей оси: `|Δy| > |Δx|` и `|Δy| ≥ 5px` → нативный ngrsZoom, наш rotation НЕ активируется; иначе late-старт rotation с координат начала второго тапа. Логика повторяет константы и поведение прошлой реализации модуля `ngrsZoom`, который удалён в коммите a086ca6.

**SBG Flavor** — `src/core/sbgFlavor.ts`: перехватывает глобальный `fetch` и добавляет заголовок `x-sbg-flavor: VanillaPlus/{version}` ко всем запросам. Если другие скрипты уже установили этот заголовок, значение дополняется через пробел. Формат как у User-Agent. Запрошено разработчиком игры для статистики.

**Game Script Patcher** — `src/core/gameScriptPatcher.ts`: перехватывает загрузку основного скрипта игры (ES module) и применяет патчи перед инъекцией. Механизм: override `Element.prototype.append` → перехват `<script type="module" src="script@...">` → fetch → text patch → inline module inject. Override одноразовый — снимается сразу после перехвата. При ошибке загружается оригинальный скрипт без патчей. Текущие патчи: экспозиция `window.showInfo` для прямого открытия попапа точки.

## Скрипты игры SBG

Исходные скрипты игры:

- **OpenLayers**: `https://sbg-game.ru/packages/js/ol@10.6.0.js` (UMD-бандл, глобал `window.ol`)
- **Основной скрипт игры**: URL формируется динамически. Чтобы получить актуальный URL, запросить `https://sbg-game.ru/app/` и найти конструкцию `s.src = (m()?'script':'intel')+'@'+v+'.'+...+'.js'`. Пример: `script@0.6.0.7eda6a0935.1.js`

**Доступ к OL Map**: карта создаётся как `const map = new ol.Map({target:'map', ...})` в локальной переменной внутри `main()`, не экспонируется глобально. Для доступа — перехват `ol.Map.prototype` (см. `src/core/olMap.ts`).

**Доступ к внутренним функциям**: скрипт игры загружается как ES module (`type="module"`), все функции (`showInfo`, `requestEntities` и др.) недоступны через `window`. Для доступа — патчинг скрипта при загрузке (см. `src/core/gameScriptPatcher.ts`). Скрипт запускается с `@run-at document-start`, чтобы перехватить создание `<script>` элемента до его добавления в DOM.

## Сторонние скрипты (референс)

Полезны как референс для реализации фич и хаков с DOM/OL API игры:

- **SBG Enhanced UI (eui)** — темы, компактный режим, анимации, импорт/экспорт
  - Исходники: [`github.com/egorantonov/sbg-enhanced`](https://github.com/egorantonov/sbg-enhanced) (TypeScript + Webpack, `src/`)
  - Релиз: `https://github.com/egorantonov/sbg-enhanced/releases/latest/download/eui.user.js`
- **SBG Custom UI (cui)** — автоинвентарь, фавориты, подсветка точек, сортировка рефов
  - Исходники: [`github.com/nicko-v/sbg-cui`](https://github.com/nicko-v/sbg-cui) (JS + CSS, всё в корне: `index.js`, `styles.css`)
  - Релиз: `https://github.com/egorantonov/sbg-enhanced/releases/latest/download/cui.user.js`

## Локальные референсы (`refs/`)

Папка `refs/` (gitignored) содержит локальные копии внешних скриптов и ресурсов для исследования при разработке. Создаётся командой `npm run refs:fetch`.

**Автоматическое содержимое** (скачивается скриптом):

| Что           | Расположение                | Описание                            |
| ------------- | --------------------------- | ----------------------------------- |
| EUI исходники | `refs/eui/src/`             | TypeScript-исходники из GitHub      |
| CUI исходники | `refs/cui/`                 | `index.js` + `styles.css` из GitHub |
| EUI релиз     | `refs/releases/eui.user.js` | Собранный бандл (beautified)        |
| CUI релиз     | `refs/releases/cui.user.js` | Собранный бандл (beautified)        |
| OpenLayers    | `refs/ol/ol.js`             | UMD-бандл v10.6.0 (beautified)      |
| HTML игры     | `refs/game/index.html`      | Статический HTML страницы           |
| Скрипт игры   | `refs/game/script.js`       | Основной скрипт (beautified)        |

**Ручное содержимое** (добавляет пользователь):

| Что               | Расположение        | Описание                                        |
| ----------------- | ------------------- | ----------------------------------------------- |
| DOM после рендера | `refs/game/dom/`    | Дампы из DevTools (Copy outerHTML)              |
| CSS-переменные    | `refs/game/css/`    | `:root` custom properties (экспорт из DevTools) |
| Скриншоты UI      | `refs/screenshots/` | Визуальный контекст интерфейса                  |

При повторном запуске `refs:fetch` ручное содержимое сохраняется.

## Стек

| Инструмент         | Назначение                        |
| ------------------ | --------------------------------- |
| TypeScript         | Типизация (strict: true)          |
| Vite               | Бандлер (один entry, CSS inline)  |
| vite-plugin-monkey | Tampermonkey-заголовки + .meta.js |
| ESLint             | Линтинг (flat config)             |
| Prettier           | Форматирование (endOfLine: lf)    |
| Jest + ts-jest     | Тестирование (jsdom)              |

## Конвенции именования

→ [docs/codestyle.md](codestyle.md)

## Структура проекта

```
src/
├── core/
│   ├── bootstrap.ts        # Оркестрация модулей
│   ├── killswitch.ts        # Отключение скрипта
│   ├── moduleRegistry.ts    # Интерфейс и lifecycle модулей
│   ├── dom.ts               # DOM-утилиты ($, $$, waitForElement, injectStyles)
│   ├── olMap.ts             # OL Map capture + утилиты (findLayerByName, DragPan)
│   ├── gameConstants.ts     # Константы игры (типы предметов)
│   ├── inventoryTypes.ts    # Типы предметов инвентаря + type guards
│   ├── inventoryCache.ts    # Чтение inventory-cache из localStorage
│   ├── themeColors.ts       # Чтение CSS custom properties темы
│   ├── gameEvents.ts        # Наблюдение за DOM-событиями игры
│   ├── gameVersion.ts       # Проверка совместимости версий
│   ├── sbgFlavor.ts         # Заголовок x-sbg-flavor
│   ├── errorLog.ts          # Перехват и хранение ошибок
│   ├── bugReport.ts         # Формирование баг-репортов
│   ├── l10n.ts              # Локализация (en/ru)
│   └── settings/
│       ├── types.ts         # ISvpSettings
│       ├── defaults.ts      # Дефолтные настройки
│       ├── storage.ts       # localStorage + миграции
│       └── ui.ts            # Панель настроек
├── modules/
│   └── <moduleName>/
│       ├── <moduleName>.ts       # Реализация модуля
│       ├── <moduleName>.test.ts  # Тесты модуля
│       ├── styles.css            # Стили (опционально)
│       └── <helper>.ts           # Вспомогательные файлы (опционально)
├── types/
│   ├── tampermonkey.d.ts    # Типы Tampermonkey API
│   └── vite.d.ts            # Типы Vite-ассетов
└── entry.ts                 # Точка входа
```

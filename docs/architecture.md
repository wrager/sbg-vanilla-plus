# Архитектура SBG Vanilla+

## Один скрипт

Один userscript `sbg-vanilla-plus.user.js` — все модули в одном бандле. Модули организованы по категориям: `style`, `feature`, `bugfix`.

## Интерфейс модуля

```typescript
interface IFeatureModule {
  id: string; // ключ в настройках
  name: ILocalizedString; // { en, ru }
  description: ILocalizedString; // { en, ru }
  defaultEnabled: boolean;
  category: 'style' | 'feature' | 'bugfix';
  init(): void; // один раз при загрузке
  enable(): void;
  disable(): void;
}
```

## Ключевые механизмы

**Killswitch** — `src/core/killswitch.ts`: проверка `#svp-disabled=1` в hash/sessionStorage.

**Отказоустойчивость** — каждый модуль в `try/catch` при init/enable. Сломанный помечается `failed`, не блокирует остальные.

**CSS-инъекция** — `import styles from './styles.css?inline'` → `injectStyles(css, id)` → `<style id="svp-{id}">`.

**Настройки** — `localStorage['svp_settings']`: `{ version: number, modules: Record<string, boolean> }`. Миграции через массив `migrations[]`.

**Панель настроек** — кнопка ⚙ открывает полноэкранную панель. Модули сгруппированы по категориям: Стилизация, Фичи, Багфиксы.

**Версия SBG** — `SBG_COMPATIBLE_VERSION` в `gameVersion.ts`. Проверяет заголовок `x-sbg-version` из `/api/self`.

**SBG Flavor** — `src/core/sbgFlavor.ts`: перехватывает глобальный `fetch` и добавляет заголовок `x-sbg-flavor: VanillaPlus/{version}` ко всем запросам. Если другие скрипты уже установили этот заголовок, значение дополняется через пробел. Формат как у User-Agent. Запрошено разработчиком игры для статистики.

## Скрипты игры SBG

Исходные скрипты игры:

- **OpenLayers**: `https://sbg-game.ru/packages/js/ol@10.6.0.js` (UMD-бандл, глобал `window.ol`)
- **Основной скрипт игры**: URL формируется динамически. Чтобы получить актуальный URL, запросить `https://sbg-game.ru/app/` и найти конструкцию `s.src = (m()?'script':'intel')+'@'+v+'.'+...+'.js'`. Пример: `script@0.6.0.7eda6a0935.1.js`

**Доступ к OL Map**: карта создаётся как `const map = new ol.Map({target:'map', ...})` в локальной переменной внутри `main()`, не экспонируется глобально. Для доступа — перехват `ol.Map.prototype` (см. `src/core/olMap.ts`).

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

| Что            | Расположение                 | Описание                              |
| -------------- | ---------------------------- | ------------------------------------- |
| EUI исходники  | `refs/eui/src/`              | TypeScript-исходники из GitHub        |
| CUI исходники  | `refs/cui/`                  | `index.js` + `styles.css` из GitHub   |
| EUI релиз      | `refs/releases/eui.user.js`  | Собранный бандл (beautified)          |
| CUI релиз      | `refs/releases/cui.user.js`  | Собранный бандл (beautified)          |
| OpenLayers     | `refs/ol/ol.js`              | UMD-бандл v10.6.0 (beautified)        |
| HTML игры      | `refs/game/index.html`       | Статический HTML страницы             |
| Скрипт игры    | `refs/game/script.js`        | Основной скрипт (beautified)          |
| CSS-переменные | `refs/game/cssVariables.css` | Извлечённые `:root` custom properties |

**Ручное содержимое** (добавляет пользователь):

| Что               | Расположение        | Описание                           |
| ----------------- | ------------------- | ---------------------------------- |
| DOM после рендера | `refs/game/dom/`    | Дампы из DevTools (Copy outerHTML) |
| Скриншоты UI      | `refs/screenshots/` | Визуальный контекст интерфейса     |

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
│   ├── bootstrap.ts
│   ├── killswitch.ts
│   ├── moduleRegistry.ts
│   ├── dom.ts
│   ├── gameEvents.ts
│   ├── gameVersion.ts
│   ├── sbgFlavor.ts
│   └── settings/
│       ├── types.ts
│       ├── defaults.ts
│       ├── storage.ts
│       └── ui.ts
├── modules/
│   ├── style/
│   │   └── <moduleName>/
│   │       ├── <moduleName>.ts
│   │       ├── <moduleName>.test.ts
│   │       └── styles.css
│   ├── feature/
│   │   └── <moduleName>/
│   │       ├── <moduleName>.ts
│   │       └── <moduleName>.test.ts
│   └── bugfix/
│       └── <moduleName>/
│           ├── <moduleName>.ts
│           └── <moduleName>.test.ts
├── types/
└── entry.ts
```

# Архитектура SBG Vanilla+

## Два скрипта

1. **`sbg-vanilla-plus-style.user.js`** — неинвазивный: CSS-инъекции и простые DOM-модификации. Не трогает OpenLayers, не перехватывает fetch.
2. **`sbg-vanilla-plus-features.user.js`** — основной: fetch-перехват (только чтение), работа с OpenLayers, настройки.

Правило разграничения: `<style>` теги + простые DOM-операции → стилевой скрипт. OL API, fetch-перехват, сложная JS-логика → основной скрипт.

## Интерфейс модуля

```typescript
interface FeatureModule {
  id: string; // ключ в настройках
  name: string;
  description: string;
  defaultEnabled: boolean;
  script: 'style' | 'features';
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

**Панель настроек** — единая кнопка ⚙ для обоих скриптов. Первый скрипт создаёт панель с pre-allocated слотами по `data-svp-section`, второй заполняет свой слот.

**Версия SBG** — `SBG_COMPATIBLE_VERSION` в `gameVersion.ts`. Проверяет заголовок `x-sbg-version` из `/api/self`.

## Стек

| Инструмент         | Назначение                        |
| ------------------ | --------------------------------- |
| TypeScript         | Типизация (strict: true)          |
| Vite               | Бандлер (два entry, CSS inline)   |
| vite-plugin-monkey | Tampermonkey-заголовки + .meta.js |
| ESLint             | Линтинг (flat config)             |
| Prettier           | Форматирование (endOfLine: auto)  |
| Jest + ts-jest     | Тестирование (jsdom)              |

## Конвенции именования

| Что                | Формат           | Пример               |
| ------------------ | ---------------- | -------------------- |
| Файлы/папки        | camelCase        | `settingsStorage.ts` |
| Интерфейсы         | PascalCase       | `FeatureModule`      |
| Функции/переменные | camelCase        | `getModuleEnabled`   |
| Константы          | UPPER_SNAKE_CASE | `MODULE_ID`          |
| CSS-классы скрипта | `svp-` префикс   | `svp-settings-panel` |
| localStorage ключи | `svp_` префикс   | `svp_settings`       |

Избегать слов "util" и "manager" — использовать описательные имена.

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
│   └── settings/
│       ├── types.ts
│       ├── defaults.ts
│       ├── storage.ts
│       └── ui.ts
├── modules/
│   └── <moduleName>/
│       ├── index.ts
│       └── styles.css
├── types/
├── entryStyle.ts
└── entryFeatures.ts
```

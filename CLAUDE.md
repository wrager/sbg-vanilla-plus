# SBG Vanilla+ — Правила AI-разработки

## Критические запреты (нарушение = перманентный бан в игре)

1. **Запрещена подмена GPS** — никогда не генерировать код, подделывающий геолокацию
2. **Запрещена автоматизация** — никогда не автоматизировать игровые действия (авто-хак, авто-деплой, авто-атака, авто-рисование)
3. **Запрещён мультиаккаунт** — скрипт не должен облегчать использование нескольких аккаунтов
4. **Запрещена модификация запросов** — никогда не изменять тела исходящих API-запросов (координаты, количества, ID предметов)

Скрипт может ТОЛЬКО:

- Модифицировать UI/UX (CSS, DOM-структура)
- ЧИТАТЬ ответы API через перехват fetch — никогда не модифицировать запросы или ответы, отправляемые серверу

## Архитектура

### Два скрипта

1. **`sbg-vanilla-plus-style.user.js`** ("SBG Vanilla+ Style") — неинвазивный: CSS-инъекции и простые DOM-модификации (classList, setAttribute). Не трогает OpenLayers, не перехватывает fetch.
2. **`sbg-vanilla-plus.user.js`** ("SBG Vanilla+ Features") — основной: перехват fetch (только чтение), работа с OpenLayers, настройки, управление инвентарём.

Разграничение: `<style>` теги + простые DOM-операции → стилевой скрипт. OpenLayers API, fetch-перехват, сложная JS-логика → основной скрипт.

### Модульная система

Каждый модуль реализует интерфейс `FeatureModule`:

```typescript
interface FeatureModule {
  id: string; // Ключ в настройках (например 'enlargedButtons')
  name: string; // Человекочитаемое имя
  description: string; // Описание для панели настроек
  defaultEnabled: boolean;
  script: 'style' | 'features';
  init(): void; // Один раз при загрузке (DOM готов)
  enable(): void; // При включении фичи
  disable(): void; // При выключении фичи
}
```

Добавление новой фичи: создать `src/modules/<name>/index.ts`, экспортирующий объект `FeatureModule` → добавить в массив `bootstrap([...])` в соответствующем entry point (`entryStyle.ts` или `entryFeatures.ts`). Модули не должны иметь side effects — никаких вызовов при импорте, только экспорт.

### Отказоустойчивость

Каждый модуль оборачивается в `try/catch` при init/enable. Сломавшийся модуль логирует `console.warn` и помечается `failed`, но не блокирует остальные. В панели настроек failed-модули отображаются с пометкой (ошибка).

### CSS-инъекция

- CSS импортируется как строка: `import styles from './styles.css?inline'`
- `injectStyles(css, id)` создаёт `<style id="svp-{id}">` в `<head>`
- `removeStyles(id)` удаляет тег при отключении модуля

### Настройки

- `localStorage` под ключом `svp_settings` (JSON с полем `version` для миграций)
- Кнопка-шестерёнка в `.bottom-container`, по клику — полноэкранная панель
- Каждый модуль = строка с toggle-переключателем
- При изменении формата: `version` увеличивается, `migrate()` последовательно применяет миграции

### Версия SBG

- Константа `SBG_COMPATIBLE_VERSION` в `src/core/gameVersion.ts`
- Проверка заголовка `x-sbg-version` из `/api/self`
- При несовпадении — предупреждение пользователю
- Версия попадает в Tampermonkey `@description` и release notes

## Стек

| Инструмент         | Назначение                        |
| ------------------ | --------------------------------- |
| TypeScript         | Типизация (strict: true)          |
| Vite               | Бандлер (два entry, CSS inline)   |
| vite-plugin-monkey | Tampermonkey-заголовки + .meta.js |
| ESLint             | Линтинг (flat config)             |
| Prettier           | Форматирование                    |
| Jest + ts-jest     | Тестирование (jsdom)              |

## Конвенции именования

| Что                | Формат           | Пример                   |
| ------------------ | ---------------- | ------------------------ |
| Файлы/папки        | camelCase        | `settingsStorage.ts`     |
| Интерфейсы         | PascalCase       | `FeatureModule`          |
| Функции/переменные | camelCase        | `getModuleEnabled`       |
| Константы          | UPPER_SNAKE_CASE | `MODULE_ID`              |
| CSS-классы скрипта | `svp-` префикс   | `svp-settings-panel`     |
| Кастомные события  | `svp:` префикс   | `svp:point-popup-opened` |
| localStorage ключи | `svp_` префикс   | `svp_settings`           |

## Правила коммитов

- Коммиты на **русском языке**
- Минимальный текст — кратко и по делу
- Каждый коммит самодостаточен и не ломает сборку
- Перед коммитом: `npm run typecheck && npm run lint && npm run format:check && npm run test && npm run build`

## Структура проекта

```
src/
├── core/
│   ├── bootstrap.ts         # Инициализация: DOM → настройки → модули → UI
│   ├── moduleRegistry.ts    # Регистрация и lifecycle модулей
│   ├── dom.ts               # waitForElement, $, $$, injectStyles, removeStyles
│   ├── gameEvents.ts        # MutationObserver обёртки
│   ├── gameVersion.ts       # SBG_COMPATIBLE_VERSION
│   └── settings/
│       ├── types.ts         # Интерфейсы настроек
│       ├── defaults.ts      # Дефолтные значения
│       ├── storage.ts       # CRUD localStorage + миграции
│       └── ui.ts            # Панель настроек
├── modules/
│   └── <moduleName>/
│       ├── index.ts         # Реализация FeatureModule
│       └── styles.css       # CSS (если есть)
├── types/
│   ├── gameDom.d.ts         # Типы DOM-элементов игры
│   └── tampermonkey.d.ts    # GM_* API типы
├── entryStyle.ts            # Entry стилевого скрипта
└── entryFeatures.ts         # Entry основного скрипта
```

# AGENTS.md

## Scope & Safety (обязательно)

- Проект — userscript для SBG; запрещено реализовывать: подмену GPS, автоматизацию игровых действий, мультиаккаунт, модификацию серверных запросов (см. `CLAUDE.md`).
- Любые решения должны быть «UI/UX only»: изменяем клиентский интерфейс, не игровую механику сервера.

## С чего начинать задачу

- Сначала проверь канонические правила: `CLAUDE.md`, затем `docs/architecture.md`, `docs/dev-principles.md`, `docs/codestyle.md`, `docs/glossary.md`.
- Перед новой фичей/сложным фиксом сначала исследуй `refs/`; если папки нет или данных не хватает — `npm run refs:fetch`.
- Не угадывай DOM/API игры: используй `refs/game/*`, `refs/eui/*`, `refs/cui/*` как первичный источник.

## Архитектурная карта (big picture)

- Точка входа: `src/entry.ts` — ранние перехваты (`installGameScriptPatcher`, `initOlMapCapture`), затем `bootstrap([...modules])`.
- Оркестрация модулей: `src/core/bootstrap.ts` + `src/core/moduleRegistry.ts`.
- Контракт модуля: `IFeatureModule` (`init/enable/disable`, `defaultEnabled`, `category`, `requiresReload`).
- Отказоустойчивость: падение одного модуля помечает его `status='failed'`, но не останавливает остальные.
- Настройки и миграции: `src/core/settings/storage.ts` (`svp_settings`, backup + migrations).
- UI настроек: `src/core/settings/ui.ts` (категории, toggle-all, рендер ошибок, host-specific блокировки).

## Важные паттерны проекта

- Межмодульная связь только через реестр (`getModuleById`, `isModuleActive`); прямые импорты `src/modules/X -> src/modules/Y` запрещены.
- Порядок модулей значим: внутри категории ориентируйся на порядок в `bootstrap()` (`src/entry.ts`), категории в UI: `ui -> feature -> map -> utility -> fix`.
- Для инвентаря используй централизованные сущности: `src/core/inventoryTypes.ts`, `src/core/inventoryCache.ts`, `src/core/gameConstants.ts`.
- Для OL Map используй `src/core/olMap.ts` (`getOlMap`, `findLayerByName`, `createDragPanControl`) вместо локальных хаков.
- Для цветов темы используй `src/core/themeColors.ts` и CSS custom properties (не хардкодь цвета).
- В UI-компоновке переноси (reparent) оригинальные интерактивные DOM-узлы, не заменяй их текстовыми копиями.

## Тесты и качество

- Bugfix = минимум 2 проверки: (1) воспроизведение бага, (2) корректное поведение после фикса (см. правило в `CLAUDE.md`).
- При изменениях lifecycle проверяй все фазы: `init`, `enable`, `disable`.
- Локальный pre-commit прогон должен совпадать с CI (`.github/workflows/ci.yml`):
  `npm run typecheck && npm run lint && npm run format:check && npm run test && npm run build`
- Если упал `format:check`: `npx prettier --write .`, затем повторить полный прогон.

## Практика изменений

- Новые модули по умолчанию `defaultEnabled: true` (если явно не сказано иное).
- При изменении поведения синхронизируй документацию в том же коммите: минимум `README.md`; для нетривиального модуля — его `src/modules/<module>/README.md`.
- Термины в пользовательских текстах держи по словарю `docs/glossary.md` (например: «СЛ», «ОРПЦ», «точка», «ключ»).
- Для release notes агрегируй изменения по модулям/фичам, а не пересказом заголовков коммитов (см. `CLAUDE.md`).

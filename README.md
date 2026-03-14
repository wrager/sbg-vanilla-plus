# SBG Vanilla+

UI/UX улучшения для [SBG](https://sbg-game.ru) — location-based браузерной игры.

Tampermonkey-скрипт, который модифицирует только интерфейс. Не автоматизирует действия, не подменяет GPS, не модифицирует запросы к серверу.

## Установка

1. Установить [Tampermonkey](https://www.tampermonkey.net/)
2. Установить скрипты из [последнего релиза](https://github.com/wrager/sbg-vanilla-plus/releases/latest):
   - **SBG Vanilla+ Style** — CSS-улучшения (можно использовать отдельно)
   - **SBG Vanilla+ Features** — основные фичи

## Фичи v0.1.0

| Фича                             | Скрипт   | Описание                                                        |
| -------------------------------- | -------- | --------------------------------------------------------------- |
| Увеличенные кнопки               | Style    | Увеличенные кнопки Discover, Deploy, Draw, Repair для мобильных |
| Отключение зума по двойному тапу | Features | Предотвращает случайный зум при двойном тапе                    |

## Настройки

Кнопка ⚙ в нижней панели → полноэкранная панель с toggle для каждой фичи. Переключение в реальном времени.

## Разработка

```bash
npm install
npm run dev:style     # Dev server для стилевого скрипта
npm run dev:features  # Dev server для основного скрипта
npm run build         # Сборка обоих скриптов в dist/
npm run typecheck     # Проверка типов
npm run lint          # ESLint
npm run test          # Jest
```

### Dev-сервер + Tampermonkey

1. Запустить `npm run dev:style` или `npm run dev:features`
2. vite-plugin-monkey откроет страницу с прокси-скриптом — установить его в Tampermonkey
3. Открыть `sbg-game.ru/app/` — скрипт загружается с localhost
4. При изменении кода dev-сервер пересобирает — обновить страницу игры для применения

Dev-скрипт имеет пометку `[DEV]` в названии. Продакшн `downloadURL`/`updateURL` не включаются в dev-режиме.

## Добавление фичи

1. Создать `src/modules/<name>/index.ts`, реализующий `FeatureModule`
2. Если нужен CSS — создать `src/modules/<name>/styles.css`
3. Импортировать модуль в `src/entryStyle.ts` или `src/entryFeatures.ts`
4. Добавить дефолт в `src/core/settings/defaults.ts`

## Совместимость

Скрипты совместимы с SBG v0.6.0. При обновлении игры сломавшиеся модули не блокируют остальные — каждый модуль изолирован через try/catch.

## Лицензия

MIT

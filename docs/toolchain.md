# Инструменты разработки

Проверено 18 октября 2026 года на Node.js 24.20.0. Установка — `npm ci`, без
`--force`, `--legacy-peer-deps`, overrides и подавления предупреждений компилятора.
Node.js должен соответствовать `^24.15.0`: это требование актуального jsdom
в выбранной ветке LTS. CI выбирает Node 24 через `.node-version`.

## Компилятор и compiler API

Нативный TypeScript 7.0.2 проверяет весь `tsconfig.json`, включая тесты и
`vite.config.ts`. Настройки strict, unused locals/parameters, fallthrough и
isolated modules сохранены; `noUncheckedSideEffectImports` явно включён и для
API совместимости. Автоимпорт глобальных типов ограничен `jest` и `node`.

TS 7.0 не предоставляет совместимый JavaScript compiler API. Его экспериментальные
`unstable/*` exports не заменяют контракт TS 6. Поэтому используется
[официальная схема Microsoft](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/):

| Имя зависимости      | npm package                      | Использование                                   |
| -------------------- | -------------------------------- | ----------------------------------------------- |
| `@typescript/native` | `typescript@^7.0.2`              | Нативный `tsc`, основная проверка типов         |
| `typescript`         | `@typescript/typescript6@~6.0.2` | JavaScript API для ESLint и ts-jest; CLI `tsc6` |

Пакет совместимости 6.0.2 делегирует API зависимости `@typescript/old`
(`typescript@6.0.3` в lockfile). У неё тоже есть executable `tsc`, поэтому npm
может перекрыть нативный `node_modules/.bin/tsc` при hoisting. Скрипт `typecheck`
вызывает `node node_modules/@typescript/native/bin/tsc --noEmit` явно. Регрессионный
тест запускает именно команду из `package.json` и проверяет версию и диагностику;
для проверки проекта используйте `npm run typecheck`, а не `npx tsc`.

[typescript-eslint поддерживает TS >=4.8.4 <6.1.0](https://typescript-eslint.io/users/dependency-versions/),
поэтому его parser/project service получает TS 6 API. `strictTypeChecked` и
`projectService: true` сохранены. `onUnsupportedTypeScriptVersion: 'error'` делает
неподдерживаемый API ошибкой линтинга. Полное удаление TS 6 сейчас заблокировано
отсутствием совместимого стабильного API TS 7; переход CLI на TS 7 поддерживается.

[ts-jest описывает такую же совместную установку](https://kulshekhar.github.io/ts-jest/docs/next/guides/typescript-7).
Руководство находится в разделе Next; используемый стабильный ts-jest 29.4.15
уже принимает TS `>=4.3 <7` и Jest 29/30 через peerDependencies. Установленный
пакет использует `transpileModule` для isolated modules, `createLanguageService`
и `Program` для полной компиляции, а также TypeScript AST для mock hoisting и
пользовательских transformers. Настройка `compiler: 'typescript'` явно выбирает
alias совместимости. Замена на Babel/SWC не требуется: сохранён существующий
контракт трансформаций, диагностики, hoisting, coverage и source maps.
Диагностика Jest относится к TS 6 и при существующем `isolatedModules: true`
проверяет синтаксис; семантические ошибки во всём проекте проверяет TS 7 через
`npm run typecheck` в обязательном CI. Не направляйте ts-jest на нативный пакет.

## Согласованные версии

| Инструмент                                | Стабильная версия в lockfile |
| ----------------------------------------- | ---------------------------- |
| ESLint / `@eslint/js`                     | 10.13.0 / 10.0.1             |
| typescript-eslint / parser / plugin       | 8.71.2                       |
| Jest / `@jest/environment-jsdom-abstract` | 30.5.2                       |
| ts-jest                                   | 29.4.15                      |
| jsdom / `@types/jsdom`                    | 30.1.3 / 30.0.0              |
| `@types/jest` / `@types/node`             | 30.0.0 / 24.19.2             |
| Vite / vite-plugin-monkey                 | 8.3.4 / 8.1.1                |
| magic-string                              | 1.4.3                        |
| Prettier / eslint-config-prettier         | 3.9.10 / 10.1.8              |
| fake-indexeddb                            | 6.2.6                        |

Обычный `jest-environment-jsdom@30.5.2` зависит от jsdom 26. Вместо overrides
используется [официальный базовый класс Jest](https://github.com/jestjs/jest/blob/v30.5.2/packages/jest-environment-jsdom/src/index.ts)
с явно установленным jsdom 30. Обёртка в `scripts/jestEnvironment.mjs` только
передаёт модуль jsdom конструктору; таймеры, sandbox, setup/teardown и обработка
ошибок остаются реализацией Jest. `@types/jsdom` удовлетворяет peer dependency
базового окружения. Типы Node 24 соответствуют поддерживаемому runtime.
jsdom 30 выявил ошибку в `refsOnMap`: отвергнутый CSS-цвет нельзя читать через
computed style, иначе возвращается унаследованный цвет. Перед чтением добавлена
проверка принятого `style.color`; исходный regression test сохранён, добавлены
проверки наследования и допустимого именованного цвета.

[Vite 8 использует Rolldown/Oxc](https://vite.dev/guide/migration), а
vite-plugin-monkey 8.1.1 поддерживает Vite `^8.0.0`. Сохранены настройки PR #59:
`keepNames`, минификация release, отдельный debug IIFE, добавление metadata через
magic-string с композициями source maps, dev без автоматического открытия игры
и debug watch. Внутренняя зависимость плагина от magic-string 0.30 остаётся
в его поддерживаемом диапазоне; наш код использует актуальную ветку 1.x.
JSON import в Vite-конфигурации использует `with { type: 'json' }`, относительный
TS import — явное расширение `.ts`. `rewriteRelativeImportExtensions` сохраняет
совместимость с нативной загрузкой конфигурации в Node 24 без подавления
предупреждений Vite.

Renovate различает aliases по `matchDepNames`: ограничение `<6.1` применяется
к `typescript` (API), а нативный компилятор обновляется в ветке 7 независимо.
Типы Node ограничены major 24. При появлении стабильной поддержки нового
compiler API нужно повторно исследовать оба инструмента и снять ограничения
вместе с изменением aliases и проверок.

## Проверки

`npm audit` сообщает 20 moderate записей в цепочке инструментов Jest/Istanbul
из-за транзитивного `sprintf-js` (через `load-nyc-config → js-yaml → argparse`).
Для [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)
исправленная версия пока не опубликована. Доступного совместимого обновления
нет; предложенный npm принудительный downgrade ts-jest не применяется.
Эта зависимость относится к инструментам разработки и не входит в userscript.

Полный CI выполняется последовательно, с остановкой на первой ошибке:

```text
npm ci
npm run release:check
npm run skills:check
npm run typecheck
npm run lint
npm run format:check
npm run test
npm run build
npm run test:build
npm run build:debug
```

`test:build` дополнительно проверяет нативный TS 7 на неверном присваивании и
нарушении strict null checks, успешную компиляцию исправленного файла,
типозависимые ESLint-ошибки unsafe assignment и floating promise, корректный
типобезопасный код, а также ts-jest hoisting, синтаксическую диагностику и
соответствие строк inline source map. Тесты сборки сохраняют проверки metadata,
имён функций/классов, release/debug, dev-порта и watch-пересборки TS/CSS с
восстановлением после ошибки. Все игровые сценарии проверяются на локальных моках.

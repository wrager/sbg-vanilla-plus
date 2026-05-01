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

**Панель настроек** — кнопка ⚙ открывает полноэкранную панель. Модули сгруппированы по категориям: Интерфейс, Карта, Фичи, Багфиксы. Категория `'utility'` остаётся в типе `IFeatureModule.category` на будущее, но в текущем релизе модулей этой категории нет.

**OL Map capture** — `src/core/olMap.ts`: перехват `ol.Map.prototype.getView()` через Proxy для захвата экземпляра карты (игра хранит `map` в локальной переменной). Если `window.ol` ещё не загружен — перехват через `Object.defineProperty`. Предоставляет `getOlMap(): Promise<IOlMap>`, утилиты `findDragPanInteractions()`, `findLayerByName()`, `createDragPanControl()`.

**Локализация** — `src/core/l10n.ts`: `ILocalizedString = { en, ru }`, функция `t()` выбирает текст по языку игры.

**Игровые константы** — `src/core/gameConstants.ts`: типы предметов инвентаря (`ITEM_TYPE_CORE`, `ITEM_TYPE_CATALYSER`, `ITEM_TYPE_REFERENCE`, `ITEM_TYPE_BROOM`).

**Типы инвентаря** — `src/core/inventoryTypes.ts`: интерфейсы и type guard'ы для всех типов предметов.

**Кэш инвентаря** — `src/core/inventoryCache.ts`: чтение и парсинг `inventory-cache` из localStorage.

**Синхронизация счётчика ключей** — `src/core/refsHighlightSync.ts`: единая утилита `syncRefsCountForPoints(pointGuids)`, читает свежий `inventory-cache` и для каждой точки приводит `feature.get('highlight')['7']` в `points`-layer к актуальному amount через `Reflect.set` + `feature.changed()`. SBG 0.6.1+ хранит highlight как sparse object `{"4":false,"7":N}` (раньше был массив `[v0..v9]`); доступ через числовой ключ работает одинаково для обоих контейнеров. Lazy init `pointsSource` через `getOlMap()` при первом вызове, кеш на жизнь страницы. Используется из `refsCounterSync` (после discover), `inventoryCleanup.runCleanupImpl` (после fast-cleanup DELETE), `slowRefsDelete.runSlowDelete` (после slow-cleanup DELETE), `refsOnMap.handleDeleteClick` (после viewer-DELETE) - один источник истины для всех путей изменения количества ключей точки в инвентаре. `refsCounterSync` — owner всех путей синхронизации: при отключении модуля sync silent-no-op для каждого источника.

**Цвета темы** — `src/core/themeColors.ts`: чтение CSS custom properties (`--text`, `--background`).

**Свайп-жесты на попапе точки** — `src/core/popupSwipe.ts`: общая инфраструктура свайп-жестов на `.info`. Модули регистрируют направление (`up`/`down`/`left`/`right`) и handler (`canStart` + sync `decide` + `finalize`) через `registerDirection`; touch-listener'ы, state machine `idle -> tracking -> swiping -> animating`, `applySwipeStyles` (translate + opacity по доминирующей оси), `animateDismiss` (попап улетает к `±innerWidth`/`±innerHeight` по направлению с opacity 0) и `animateReturn` (translate в 0, opacity в 1) живут в core, не дублируются в модулях. Установка/снятие listener'ов через ref-counter `installRefs`: реальный attach на первом `installPopupSwipe` (refs 0->1), реальный detach на последнем `uninstallPopupSwipe` (refs 1->0). `decide` сознательно sync (не Promise) - чтобы анимация началась без задержки и пользователь получал моментальную обратную связь; async-работа handler-а делается в `finalize()` после `transitionend`. `touch-action: none` ставится на `.info` для блокировки нативного browser-pan. Нативный Hammer-свайп игры (refs/game/script.js:722-752) подавляется отдельно через runtime-override `Hammer.Manager.prototype.emit` в модуле `betterNextPointSwipe` (не text-патчем) - см. ниже про gameScriptPatcher. Popup observer на `class` и `data-guid` чистит stale-стили при переходе `hidden -> visible` и при смене точки во время animating. Сейчас регистрируются три направления: `up` модулем `swipeToClosePopup` (canStart исключает cores-slider, decide=dismiss, finalize=клик popup-close), `left` и `right` модулем `nextPointSwipeAnimation` (один handler на оба направления, canStart исключает cores-slider, decide gating на `isModuleActive('betterNextPointSwipe')`: при активном betterNext использует pickNextInRange и сохраняет guid в pendingNextGuid для finalize, при выключенном - предсказывает `near_points.length > 1` через findFeaturesInRange и dismiss без pendingNextGuid (native сам сделает showInfo в touchend), finalize вызывает `window.showInfo` только когда pendingNextGuid установлен). Ref-counter защищает от срыва listener-ов одного модуля при disable другого.

**Click-синтез (clickSynthesis)** — `src/core/clickSynthesis.ts`: polyfill для кнопок попапа точки, когда WebView не синтезирует `click` из touch-последовательности. Симптом: `pointerdown`/`pointerup` fire нормально, но click handler не срабатывает - воспроизводится после `showInfo` (refs/game/script.js:2084), который за один тик делает 300+ DOM-mutation (splide.refresh, обновление текстов попапа, layout shifts). `installClickFallback(element)`: на `pointerup` через 80мс проверяет, fire-нулся ли click; если нет и элемент не `disabled` - dispatches `new MouseEvent('click')`. Защита от двойного срабатывания: временный click-listener в capture phase + повторная `disabled`-проверка перед dispatch. Используется в `nextPointSwipeFix`.

**Лог ошибок** — `src/core/errorLog.ts`: перехват `console.error`/`console.warn` и глобальных ошибок, хранение последних 50 записей.

**Баг-репорты** — `src/core/bugReport.ts`: формирование отчёта с версиями, настройками и логом ошибок.

**Версия SBG** — `src/core/gameVersion.ts`: `SBG_COMPATIBLE_VERSIONS` (поддерживается v0.6.1). Проверяет заголовок `x-sbg-version` из любого `/api/*` ответа через perf-патч `window.fetch` в document-start. Сеты `DEPRECATED_MODULES_NATIVE` и `DEPRECATED_MODULES_CONFLICTED` сейчас пусты — модули, чей use case был перекрыт нативно в 0.6.1, либо адаптированы (lock-aware deletion в `inventoryCleanup` с блокировкой при pending миграции и принудительным отключением нативного сборщика мусора через `nativeGarbageGuard`, state-machine подавления `singleFingerRotation` во время нативного `DblClickDragZoom`-жеста, переосмысление `favoritedPoints` → `favoritesMigration`, переезд `swipeToClosePopup` на общий `core/popupSwipe`, замена нативного горизонтального свайпа на нашу версию через runtime-override `Hammer.Manager.prototype.emit` в модуле `betterNextPointSwipe` с приоритетной навигацией в радиусе взаимодействия), либо удалены физически (`repairAtFullCharge`, `ngrsZoom`, `keyCountOnPoints`). Инфраструктура подавления оставлена для будущих версий игры.

**Обновление счётчика ключей после discover (refsCounterSync)** — fix-модуль, перехватывающий конкретный путь изменения количества ключей. Игра в `doDiscovery` (refs/game/script.js:792-844) обновляет `inventory-cache` и текст `#i-ref` в попапе, но не трогает `prop.highlight['7']` на feature и не вызывает `feature.changed()`. Native `FeatureStyles.LIGHT` renderer закрыт closure над контейнером `prop.highlight`, поэтому подпись на карте остаётся stale до следующего `requestEntities` (movement >30м или 5-минутный таймер). Модуль ставит monkey-patch на `window.fetch` при первом enable (lazy install). На `/api/discover` извлекает `guid` из request body и через `setTimeout(DETECTION_DELAY_MS = 100мс)` (игра успевает обновить `inventory-cache` в continuation) вызывает `syncRefsCountForPoints([guid])` из `core/refsHighlightSync`. Сама логика обновления highlight - в общей утилите, симметричной для discover и для всех путей удаления ключей. Forward-compat: когда разработчик игры исправит баг и сам обновит `highlight['7']`, к моменту тика sync увидит, что значение в feature уже совпадает с amount в кэше, и пропустит мутацию.

**Lock-флаги для удаления ключей** — поле `f` стопки в `inventory-cache` (бит 0b10 = locked) защищает все ключи точки от удаления. Агрегация per-point: `buildLockedPointGuids(items)` возвращает Set GUID'ов точек, у которых хотя бы одна стопка имеет lock-бит. Семантика общая для всех модулей с массовым удалением ключей: `inventoryCleanup` (cleanupCalculator + slowRefsDelete), `refsOnMap`, финальный guard в `inventoryApi.deleteInventoryItems`. Legacy SVP/CUI в логике удаления больше не участвует, он остаётся только источником миграции. Удаление ключей разрешено, только если у ВСЕХ реф-стопок есть поле `f` (`every` проверка): на mix-кэше (часть стопок с `f`, часть без) стопки без `f` не попадают в `lockedPointGuids` и точка по факту locked может быть удалена вслепую - `every` исключает класс ошибки целиком. На 0.6.0 (нет `f` целиком) удаление ключей не работает - lock-семантики там нет, защищать нечего, но и снимать нечего без подтверждения от сервера. Дополнительная блокировка автоочистки: `runCleanup` принудительно ставит `referencesMode = 'off'` пока выполнены ВСЕ три условия - не выставлен флаг `svp_lock_migration_done`, активен модуль `favoritesMigration` и (snapshot легаси-списка ещё не загружен ИЛИ список SVP/CUI непуст). Свежий пользователь без легаси-списка получит `blockReferences = false` сразу после загрузки snapshot. Иначе автоочистка ключей удалила бы то, что пользователь защищал в SVP/CUI, до того как успел перенести защиту в нативные замочки. Финальный guard в `deleteInventoryItems` перечитывает свежий кэш перед каждым DELETE - пользователь мог поставить замок прямо во время cleanup'а.

**Подавление singleFingerRotation во время DblClickDragZoom** — модуль одним пальцем вращает карту в режиме Follow, но в SBG 0.6.1 на canvas работает нативный `ol.interaction.DblClickDragZoom` (двойной тап + удержание + вертикальный drag). Чтобы не конфликтовать, модуль ведёт state-machine double-tap-detection: на каждом `touchend` запоминает timestamp и координаты, на следующем `touchstart` в окне 300мс/30px ставит `suppressedAfterDoubleTap = true` — вся последующая серия touch до `touchend` игнорируется: ни rotation, ни DragPan-disable. Анализ направления первого move (вертикаль/горизонталь) ненадёжен: drag для зума часто начинается с лёгкого горизонтального дрейфа пальца, и late-активация rotation тогда срабатывает ошибочно. Подавление целой серии повторяет поведение прошлой пары `ngrsZoom + singleFingerRotation` (где `ngrsZoom` отдельным модулем перехватывал touch на capture-фазе), где после двойного тапа карту нельзя было поворачивать в принципе. После окончания серии `lastTapEndTime` сбрасывается в 0, чтобы следующий `touchstart` НЕ попал в double-tap-окно как третий тап. Константы окна (300мс/30px) перенесены из удалённого модуля `ngrsZoom`.

**nativeGarbageGuard** — нативный «Сборщик мусора» SBG 0.6.1 (чекбокс `usegrb` + лимиты по уровню) дублирует функцию `inventoryCleanup`. Пока модуль активен, нативный сборщик принудительно отключается двумя слоями: серверным однократным `POST /api/settings { usegrb: false }` на enable (через прямой fetch с auth-токеном, потому что игровая `apiSend` IIFE-внутренняя и недоступна), плюс DOM-disable на чекбоксе `usegrb`, всех `.garbage-value` инпутах и кнопке `#garbage-save`. Установленный нами `disabled` помечается атрибутом `data-svp-disabled-by-cleanup`, чтобы на uninstall снимать только своё, не трогая `disabled`, поставленный самой игрой. MutationObserver на `document.body` догоняет ререндер settings-секции в будущих версиях; `installGeneration` counter защищает от race условий при быстром uninstall/install. На disable атрибуты снимаются (контроль возвращается игре), но `usegrb=true` обратно не выставляется - пользователь может оставить нативный сборщик off, если хочет.

**SBG Flavor** — `src/core/sbgFlavor.ts`: перехватывает глобальный `fetch` и добавляет заголовок `x-sbg-flavor: VanillaPlus/{version}` ко всем запросам. Если другие скрипты уже установили этот заголовок, значение дополняется через пробел. Формат как у User-Agent. Запрошено разработчиком игры для статистики.

**Game Script Patcher** — `src/core/gameScriptPatcher.ts`: перехватывает загрузку основного скрипта игры (ES module) и применяет патчи перед инъекцией. Механизм: override `Element.prototype.append` → перехват `<script type="module" src="script@...">` → fetch → text patch → inline module inject. Override одноразовый — снимается сразу после перехвата. При ошибке загружается оригинальный скрипт без патчей. Текущие патчи: экспозиция `window.showInfo` для прямого открытия попапа точки. Подавление нативного горизонтального свайпа на `.info` (раньше было text-патчем) перенесено в модуль `betterNextPointSwipe` через runtime-override `Hammer.Manager.prototype.emit` - менее инвазивно, не требует обновления поисковой строки при минорных правках script.js игры.

## Глобальные runtime-override и их жизненный цикл

Часть модулей при включении ставит monkey-patch на глобальный API (`window.fetch`, `Hammer.Manager.prototype.emit`) или отправляет неотменимый запрос на сервер. Снятие override на `disable` либо технически невозможно (один поток pending fetch может ссылаться на ту же ссылку), либо стоит дороже, чем оставленный override, который просто проверяет флаг и идёт по fast path.

| Модуль                                           | Что устанавливается                                                               | Поведение после `disable`                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `refsCounterSync`                                | Monkey-patch `window.fetch` (lazy install на enable)                              | Сбрасывается флаг `discoverHookEnabled`. Сам patch остаётся до перезагрузки страницы — fast path в patched fetch проверяет флаг и пропускает обработку discover                                                                                                                                                                       |
| `betterNextPointSwipe`                           | Override `Hammer.Manager.prototype.emit`                                          | Полностью снимается на disable: `proto.emit` восстанавливается из сохранённого оригинала, нативный Hammer-handler игры снова получает swipeleft/swiperight events                                                                                                                                                                     |
| `nativeGarbageGuard` (внутри `inventoryCleanup`) | Серверный POST `/api/settings { usegrb: false }` один раз за активную фазу модуля | Серверная сторона не откатывается обратно: пользователь сам решает, нужно ли ему включить нативный сборщик после отключения нашей автоочистки. Флаг `usegrbPostedThisSession` сбрасывается на `disable`, чтобы повторный `enable` отправил `usegrb=false` заново — пользователь во время disable мог сам поставить true через UI игры |
| `nativeGarbageGuard` (DOM)                       | `disabled` атрибуты на инпутах сборщика, обёртка fieldset с подписью              | Полностью снимается на disable: `data-svp-disabled-by-cleanup` маркер позволяет различить наш disabled и игровой                                                                                                                                                                                                                      |

Полное снятие — только перезагрузкой страницы. Это сознательное архитектурное решение в пользу простоты install-логики (`installGeneration` race protection остаётся, но fully-clean uninstall не требуется).

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
│   ├── clickSynthesis.ts    # Click-polyfill для touch-кнопок после DOM-burst
│   ├── olMap.ts             # OL Map capture + утилиты (findLayerByName, DragPan)
│   ├── gameConstants.ts     # Константы игры (типы предметов)
│   ├── inventoryTypes.ts    # Типы предметов инвентаря + type guards
│   ├── inventoryCache.ts    # Чтение inventory-cache из localStorage
│   ├── refsHighlightSync.ts # Синхронизация highlight['7'] на feature-точке
│   ├── favoritesStore.ts    # IDB CUI/favorites (read-only) + lock-migration-done flag
│   ├── popupSwipe.ts        # Общая инфраструктура свайп-жестов на .info
│   ├── nextPointPicker.ts   # Выбор следующей точки для свайп-навигации
│   ├── themeColors.ts       # Чтение CSS custom properties темы
│   ├── gameEvents.ts        # Наблюдение за DOM-событиями игры
│   ├── gameVersion.ts       # Проверка совместимости версий
│   ├── gameVersionPrompt.ts # Confirm-диалог при несовместимой версии игры
│   ├── gameScriptPatcher.ts # Перехват и патчинг загрузки скрипта игры
│   ├── sbgFlavor.ts         # Заголовок x-sbg-flavor
│   ├── host.ts              # Определение хоста (SBG Scout)
│   ├── errorLog.ts          # Перехват и хранение ошибок
│   ├── toast.ts             # Тост-уведомления поверх игры
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

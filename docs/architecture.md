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

**OL Map capture** — `src/core/olMap.ts`: перехват `ol.Map.prototype.getView()` через Proxy для захвата экземпляра карты (игра хранит `map` в локальной переменной). Если `window.ol` ещё не загружен — перехват через `Object.defineProperty`. Предоставляет `getOlMap(): Promise<IOlMap>`, утилиты `findDragPanInteractions()`, `findLayerByName()`, `createDragPanControl()` и реестр `registerForEachFeatureAtPixelInterceptor()` (единая обёртка `forEachFeatureAtPixel` с перехватчиками, чтобы `largerPointTapArea` и `drawTools` не конфликтовали независимыми патчами одного метода).

**Захват жеста на карте** — `src/core/mapGestureLock.ts`: `lockMapGesture()` / `isMapGestureLocked()`. Модуль, который сам обрабатывает перетаскивание по карте, берёт захват на время жеста; модуль, который превращает перетаскивание в собственное действие, при активном захвате не вмешивается. Сейчас `drawTools` захватывает жест между `modifystart` и `modifyend` интеракции Modify, а `singleFingerRotation` в это время не поворачивает карту. Реестр в core вместо прямой связи модулей: ни один не знает про другой, порядок включения в настройках роли не играет, а счётчик владельцев (вместо булева флага) переживает несколько одновременных захватов.

**Локализация** — `src/core/l10n.ts`: `ILocalizedString = { en, ru }`, функция `t()` выбирает текст по языку игры. Язык берётся из настройки `lang`; её дефолтное значение `'sys'` означает системную локаль, поэтому русский игрок на чистом профиле видит SVP по-русски, а не по-английски. Отказ `navigator.language` даёт `'en'`: `t()` зовётся при рендере имён модулей, тостов и панели настроек, и исключение положило бы весь интерфейс SVP. Отказ чтения настроек сюда не ведёт — `readGameSetting` сама перехватывает и недоступный `localStorage`, и битый JSON, и отдаёт дефолт `'sys'`, с которым русский браузер даёт `'ru'`.

**Подписи игровых элементов** — `src/core/gameI18n.ts`: `translateGameKey(key)` переводит игровым i18next, `captureGameLabel` / `setGameLabel` / `restoreGameLabel` подменяют и возвращают подпись игровой кнопки. В отличие от `l10n.ts` (наши тексты) речь про текст, который игра нарисовала сама: i18next и плагин jqueryI18next подключены обычными `<script>` и лежат в `window`, а разметку игра переводит один раз при старте через `$('body').localize()` по атрибуту `data-i18n`. Поэтому `setGameLabel` снимает атрибут (иначе повторный `localize()` вернул бы игровую подпись), а `restoreGameLabel` возвращает атрибут и берёт свежий перевод по ключу: язык мог смениться, пока подпись была подменена, и снимок текста устарел. Снимок используется фолбэком, когда i18next недоступен. Потребители: `enhancedMainScreen` (кнопки OPS и Settings), `removeAttackCloseButton` (подпись `#attack-menu` в режиме атаки, только снимок и подмена: текст берётся с нативной кнопки «Закрыть», перевод по ключу там не нужен).

**Игровые настройки** — `src/core/gameSettings.ts`: `readGameSetting(key)` читает `localStorage['settings']` и отдаёт по полю то же, что видит сама игра. Дефолт подставляется на весь объект и только когда его неоткуда взять: ключа нет или значение разобралось в `null` — так делает игровой `getJson`. На битом JSON и на недоступном `localStorage` игровой `getJson` бросает, а мы и в этих случаях отдаём дефолт: чтение зовётся из рендера интерфейса SVP и из обработчика апгрейда базы избранного, где исключение стоило бы дороже дефолтного значения. Разобранный объект отдаётся как есть, поэтому отсутствующее в нём поле даёт `undefined`, а не дефолт: игра в этом случае уходит в `fallbackLng` своего i18next для языка и рисует светлый интерфейс для темы, и подстановка дефолта увела бы нас в системную локаль и системную тему. Дефолты дублируются только для полей, которые реально читает SVP (`lang`, `theme`, `base`): полный объект настроек игры пришлось бы сверять с ней при каждом её обновлении. Отсутствие ключа — штатное состояние: SBG 0.7.0 убрал материализацию `settings` при первом запуске (`initSettings` в `refs/game/script.js`), игра читает значения через `getLocalStorageDefault` и пишет ключ только при первом изменении настройки (`changeSettings`). До появления модуля ключ разбирался в каждом потребителе отдельно и с разными фолбэками, из-за чего его отсутствие означало «английский язык» в `l10n` и «светлая тема» в `favoritesStore`. `isGameDarkTheme()` повторяет формулу темы из игры: дефолтное `'auto'` разворачивается через `prefers-color-scheme`, а любое другое значение, включая отсутствующее и постороннее, сравнивается с `'dark'` — иначе игрок с дефолтной темой и тёмной системной считался бы «светлым», а игрок с незнакомой темой получил бы системную вместо светлой. `isGameCartoDbBaselayer()` отвечает, стоит ли у игрока подложка CartoDB: только у неё игра при тёмной теме берёт тёмный вариант тайлов (`dark_all` в `setBaselayer`), а отсутствующее поле означает `'osm'`, потому что игра берёт базу как `getSettings('base') || 'osm'`. Потребители: `l10n.getGameLocale` (поле `lang`), `favoritesStore` (`isGameDarkTheme()` и `isGameCartoDbBaselayer()` для сида фильтров подложки в CUI-конфиге).

**Тосты** — `src/core/toast.ts` и `src/core/toastify.ts`: `showToast(message, { duration, type })` рисует уведомление SVP через Toastify-JS 1.12.0, который игра подключает обычным `<script>` (`refs/game/index.html:35`) и через который показывает все свои сообщения. Своей раскладки у SVP больше нет: одновременные тосты Toastify разводит сам (`reposition`, `refs/toastify/toastify.js:117`), а до переезда все наши сообщения рисовались в одной фиксированной точке и накладывались друг на друга. Типов сообщения ровно два — те же классы, что у игры: `interaction-toast` и `error-toast`; свой цвет выбивался бы из игрового интерфейса. Если Toastify недоступен или отказал (фабрика бросила, показ бросил), `showToast` уходит на прежнюю собственную реализацию (`.svp-toast` из `core/toast.css`): сама игра без Toastify не стартует (`refs/game/script.js:16-27`), поэтому в норме этот путь не виден, но уведомление о действии не должно ронять обработчик действия. `core/toastify.ts` держит типы API библиотеки, `getToastifyFactory()` (фабрика или `null`) и `isErrorToast()` — проверку класса по токену, потому что `className` допускает несколько классов через пробел. Потребители типов: `core/toast.ts` и `compactToasts`.

**Сборка тостов (compactToasts)** — ui-модуль, патчащий `Toastify.prototype.showToast` (единственная точка, через которую проходят все уведомления игры) и собирающий одновременные ошибки в один блок: строки в порядке первого появления, повтор увеличивает счётчик, не больше пяти строк. Собираются только тосты с классом `error-toast` — и игровые, и наши: нейтральные сообщения игрок читает по одному, а тост с добычей игра вообще создаёт пустым и дописывает содержимое уже после показа (`refs/game/script.js:830-845`), так что подмена узла стёрла бы игроку список добычи. Блок ведётся отдельно для каждого контейнера (ошибки действий игра вешает внутрь попапа точки, `refs/game/script.js:807`, а отказы рисования показывает на уровне экрана), позиция при этом остаётся игровой. Срок жизни общий на блок и задаётся последним сообщением: каждая новая ошибка пересоздаёт узел, поэтому блок держится столько же, сколько держался бы одиночный тост этой ошибки, а ошибка после ухода блока начинает его заново. Прежний узел снимается напрямую (`clearTimeout(timeOutValue)` + `remove()`), потому что штатный `removeElement` откладывает удаление на 400 мс и всё это время на экране висели бы два блока. Инстансы не создаются, меняется входящий — учёт `popup_toasts` внутри игры остаётся согласованным. Через патч идут все уведомления игры, поэтому он снимает сам себя при первой же ошибке внутри сборки, а вызов исходного `showToast` вынесен из-под `try` — ошибку самой библиотеки игра должна получить как есть. Сообщения неожиданной формы (не строка в тексте, пустой текст, нулевая длительность) проходят мимо блока по одному. Нейтральные сообщения не трогаются вовсе: свёртка длинных игровых текстов (например, трёхстрочного тоста про новые регионы) держалась бы на точных формулировках переводов игры. Подробности и отвергнутые подходы — в `src/modules/compactToasts/README.md`.

**Игровые константы** — `src/core/gameConstants.ts`: типы предметов инвентаря (`ITEM_TYPE_CORE`, `ITEM_TYPE_CATALYSER`, `ITEM_TYPE_REFERENCE`, `ITEM_TYPE_BROOM`).

**Типы инвентаря** — `src/core/inventoryTypes.ts`: интерфейсы и type guard'ы для всех типов предметов.

**Кэш инвентаря** — `src/core/inventoryCache.ts`: чтение и парсинг `inventory-cache` из localStorage плюс публичные helper'ы для агрегации точек по флагам поля `f` стопки. `buildLockedPointGuids` собирает точки с lock-битом (используется `favoritesMigration` для определения уже мигрированных точек, а также `drawingRestrictions` для блокировки назначения locked-точки центром звезды). `buildProtectedPointGuids` собирает точки с lock ИЛИ favorite битом (используется во всех 4 каналах массового удаления для защиты ключей). `isProtectionFlagSupportAvailable` отвечает, поддерживает ли кэш `f` целиком (защита от mix-кэша и старых версий игры). Внутренний `buildPointGuidsByFlagMask` параметризует обе агрегации одной маской, публичные обёртки фиксируют доменно-значимые маски. `MARK_FLAG_BITS` и `MarkFlag` (биты `f`-поля стопки) живут в `inventoryTypes.ts` рядом с `IInventoryReference`, чтобы избежать циклической зависимости с `marksApi`.

**Marks API** — `src/core/marksApi.ts`: `postMark(itemGuid, flag)` отправляет один `POST /api/marks` с auth-токеном из `localStorage['auth']` (игровая `apiSend` IIFE-внутренняя, недоступна юзерскрипту) и синхронизирует `inventory-cache` через `applyFlagToCache` под итоговый сервером state. Возвращает `{ networkOk, result, httpStatus? }` — клиенты используют `httpStatus` для отличения 429 (rate-limit) от прочих failures и применения backoff. `MARKS_RATE_LIMIT_MS = 1500` мс — задержка между POST'ами для `favoritesMigration.runMigration`, вынесена в core, чтобы характеристика серверного rate-limit жила рядом с самим эндпоинтом.

**Синхронизация счётчика ключей** — `src/core/refsHighlightSync.ts`: единая утилита `syncRefsCountForPoints(pointGuids)`, читает свежий `inventory-cache` и для каждой точки приводит `feature.get('highlight')['7']` в `points`-layer к актуальному amount через `Reflect.set` + `feature.changed()`. SBG 0.6.1+ хранит highlight как sparse object `{"4":false,"7":N}` (раньше был массив `[v0..v9]`); доступ через числовой ключ работает одинаково для обоих контейнеров. Lazy init `pointsSource` через `getOlMap()` при первом вызове, кеш на жизнь страницы. Используется из `refsLayerSync` (после discover), `inventoryCleanup.runCleanupImpl` (после fast-cleanup DELETE), `slowRefsDelete.runSlowDelete` (после slow-cleanup DELETE), `refsOnMap.handleDeleteClick` (после viewer-DELETE) - один источник истины для всех путей изменения количества ключей точки в инвентаре. `refsLayerSync` — owner всех путей синхронизации: при отключении модуля sync silent-no-op для каждого источника.

**Цвета темы** — `src/core/themeColors.ts`: чтение CSS custom properties (`--text`, `--background`).

**Свайп-жесты на попапе точки** — `src/core/popupSwipe.ts`: общая инфраструктура свайп-жестов на `.info`. Модули регистрируют направление (`up`/`down`/`left`/`right`) и handler (`canStart` + sync `decide` + `finalize`) через `registerDirection`; touch-listener'ы, state machine `idle -> tracking -> swiping -> animating`, `applySwipeStyles` (translate + opacity по доминирующей оси), `animateDismiss` (попап улетает к `±innerWidth`/`±innerHeight` по направлению с opacity 0) и `animateReturn` (translate в 0, opacity в 1) живут в core, не дублируются в модулях. Установка/снятие listener'ов через ref-counter `installRefs`: реальный attach на первом `installPopupSwipe` (refs 0->1), реальный detach на последнем `uninstallPopupSwipe` (refs 1->0). `decide` сознательно sync (не Promise) - чтобы анимация началась без задержки и пользователь получал моментальную обратную связь; async-работа handler-а делается в `finalize()` после `transitionend`. `touch-action: none` ставится на `.info` для блокировки нативного browser-pan. Нативный Hammer-свайп игры (refs/game/script.js:722-752) подавляется отдельно через runtime-override `Hammer.Manager.prototype.emit` в модуле `improvedNextPointSwipe` (не text-патчем) - см. ниже про gameScriptPatcher. Popup observer на `class` и `data-guid` чистит stale-стили при переходе `hidden -> visible` и при смене точки во время animating. Сейчас регистрируются три направления: `up` модулем `swipeToClosePopup` (canStart исключает cores-slider, decide=dismiss, finalize=клик popup-close), `left` и `right` модулем `nextPointSwipeAnimation` (один handler на оба направления, canStart исключает cores-slider, decide gating на `isModuleActive('improvedNextPointSwipe')`: при активном improvedNextPointSwipe использует pickNextInRange и сохраняет guid в pendingNextGuid для finalize, при выключенном - предсказывает `near_points.length > 1` через findFeaturesInRange и dismiss без pendingNextGuid (native сам сделает showInfo в touchend), finalize вызывает `window.showInfo` только когда pendingNextGuid установлен). Ref-counter защищает от срыва listener-ов одного модуля при disable другого.

**Click-синтез (clickSynthesis)** — `src/core/clickSynthesis.ts`: polyfill для кнопок попапа точки, когда WebView не синтезирует `click` из touch-последовательности. Симптом: `pointerdown`/`pointerup` fire нормально, но click handler не срабатывает - воспроизводится после `showInfo` (refs/game/script.js:2084), который за один тик делает 300+ DOM-mutation (splide.refresh, обновление текстов попапа, layout shifts). `installClickFallback(element)`: на `pointerup` через 80мс проверяет, fire-нулся ли click; если нет и элемент не `disabled` - dispatches `new MouseEvent('click')`. Защита от двойного срабатывания: временный click-listener в capture phase + повторная `disabled`-проверка перед dispatch. Используется в `nextPointSwipeButtonsFix`.

**Лог ошибок** — `src/core/errorLog.ts`: перехват `console.error`/`console.warn` и глобальных ошибок, хранение последних 50 записей.

**Баг-репорты** — `src/core/bugReport.ts`: формирование отчёта с версиями, настройками и логом ошибок.

**Версия SBG** — `src/core/gameVersion.ts`: `SBG_COMPATIBLE_VERSIONS` (поддерживаются v0.7.0 и v0.6.2: заголовок описывает версию сервера, а не загруженного клиента, и на случай их расхождения — незавершённая раскатка, кеширование клиента браузером — прошлая версия остаётся совместимой; иначе игрок получал бы блокирующий `confirm` на каждой загрузке). Проверяет заголовок `x-sbg-version` из любого `/api/*` ответа через perf-патч `window.fetch` в document-start. Сеты `DEPRECATED_MODULES_NATIVE` и `DEPRECATED_MODULES_CONFLICTED` сейчас пусты — модули, чей use case был перекрыт нативно в 0.6.1, либо адаптированы (lock/favorite-aware deletion в `inventoryCleanup` с блокировкой при pending миграции и принудительным отключением нативного сборщика мусора через `nativeGarbageGuard`; `favoritesMigration` переносит legacy SVP/CUI-список в нативные звёздочки/замочки через POST `/api/marks`; переезд `swipeToClosePopup` на общий `core/popupSwipe`; замена нативного горизонтального свайпа через runtime-override `Hammer.Manager.prototype.emit` в `improvedNextPointSwipe` с приоритетной навигацией в радиусе взаимодействия; state-machine подавления `singleFingerRotation` во время нативного `DblClickDragZoom`-жеста), либо удалены физически (`repairAtFullCharge`, `ngrsZoom`, `keyCountOnPoints`, `favoritedPoints`). Инфраструктура подавления оставлена для будущих версий игры.

**Обновление счётчика ключей после discover (refsLayerSync)** — fix-модуль, перехватывающий конкретный путь изменения количества ключей. Игра в `doDiscovery` (refs/game/script.js:792-844) обновляет `inventory-cache` и текст `#i-ref` в попапе, но не трогает `prop.highlight['7']` на feature и не вызывает `feature.changed()`. Native `FeatureStyles.LIGHT` renderer закрыт closure над контейнером `prop.highlight`, поэтому подпись на карте остаётся stale до следующего `requestEntities` (movement >30м или 5-минутный таймер). Модуль ставит monkey-patch на `window.fetch` при первом enable (lazy install). На `/api/discover` извлекает `guid` из request body и через `setTimeout(DETECTION_DELAY_MS = 100мс)` (игра успевает обновить `inventory-cache` в continuation) вызывает `syncRefsCountForPoints([guid])` из `core/refsHighlightSync`. Сама логика обновления highlight - в общей утилите, симметричной для discover и для всех путей удаления ключей. Forward-compat: когда разработчик игры исправит баг и сам обновит `highlight['7']`, к моменту тика sync увидит, что значение в feature уже совпадает с amount в кэше, и пропустит мутацию.

**Всплывающий опыт (xpPopups)** — ui-модуль, показывающий прирост опыта крупным значением по центру верхней части экрана. Опыт приходит только в ответах на действия и сходится в игре в `handleExpChange` (refs/game/script.js:2776) в формате `{ xp: { cur, diff } }`; модуль перехватывает `window.fetch` и читает `xp.diff` из клона ответа на `POST /api/{discover,deploy,attack2,draw,repair}`. `GET /api/draw` отсекается по методу: это список целей рисования, опыта в нём нет; метод нормализуется перед сравнением, потому что игра шлёт его строчными (`apiSend`, `apiQuery`). Правило приоритета из `docs/agent/rules.md` ставит text-patch выше runtime-обёртки, здесь выбрана обёртка: контракт `POST /api/*` с полем `xp` переживает обновления игры, а поисковый литерал text-патча ломается на любой правке `script.js`. Нативная подпись `.xp-diff` в панели игрока на время работы модуля скрывается стилем - у большинства игроков она и так не видна, потому что `enhancedMainScreen` прячет всю строку `.self-info__entry`. Рендер: слой `position: fixed` нулевой высоты с абсолютными детьми (вставка значения не трогает раскладку игры), длительность анимации объявлена один раз в коде и уходит в CSS через custom property, узел снимается по `animationend` со страховочным таймером на случай скрытой вкладки, одновременно живущих значений не больше пяти. Отличия от реализации CUI, взятой за образец, перечислены в `src/modules/xpPopups/README.md`.

**Lock/favorite-флаги для удаления ключей** — поле `f` стопки в `inventory-cache` (бит 0b10 = locked, бит 0b01 = favorite) удерживает все ключи точки от удаления. Семантика для пользователя единая: и явный замочек, и звёздочка означают «не трогать ключи этой точки». Агрегация per-point: `buildProtectedPointGuids(items)` возвращает Set GUID'ов точек, у которых хотя бы одна стопка имеет lock или favorite бит. Семантика общая для всех модулей с массовым удалением ключей: `inventoryCleanup` (cleanupCalculator + slowRefsDelete), `refsOnMap`, финальный guard в `inventoryApi.deleteInventoryItems`. Отдельная функция `buildLockedPointGuids` (lock-only) остаётся для логики миграции в `favoritesMigration` - там нужен именно lock-бит (определить, какие точки уже мигрированы), а не «удерживается от удаления». Та же функция используется в `drawingRestrictions` для блокировки назначения locked-точки центром звезды и для legacy-очистки центра при старте. Legacy SVP/CUI в логике удаления больше не участвует, он остаётся только источником миграции. Удаление ключей разрешено, только если `isProtectionFlagSupportAvailable(items)` возвращает true: у ВСЕХ реф-стопок есть поле `f` (`every` проверка). На mix-кэше (часть стопок с `f`, часть без) стопки без `f` не попадают в `protectedPointGuids` и точка с замочком или звёздочкой может быть удалена вслепую - `every` исключает класс ошибки целиком. На 0.6.0 (нет `f` целиком) удаление ключей не работает - lock/favorite-семантики там нет, удерживать нечего, но и снимать нечего без подтверждения от сервера. Дополнительная блокировка автоочистки: `runCleanup` принудительно ставит `referencesMode = 'off'` пока выполнены ВСЕ три условия - не выставлен флаг `svp_lock_migration_done`, активен модуль `favoritesMigration` и (snapshot легаси-списка ещё не загружен ИЛИ список SVP/CUI непуст). Свежий пользователь без легаси-списка получит `blockReferences = false` сразу после загрузки snapshot. Иначе автоочистка ключей удалила бы то, что пользователь отметил в SVP/CUI, до того как успел перенести пометку в нативные замочки. Финальный guard в `deleteInventoryItems` перечитывает свежий кэш перед каждым DELETE - пользователь мог поставить замок или звёздочку прямо во время cleanup'а.

**Подавление singleFingerRotation во время DblClickDragZoom** — модуль одним пальцем вращает карту в режиме Follow, но в SBG 0.6.1 на canvas работает нативный `ol.interaction.DblClickDragZoom` (двойной тап + удержание + вертикальный drag). Чтобы не конфликтовать, модуль ведёт state-machine double-tap-detection: на каждом `touchend` запоминает timestamp и координаты, на следующем `touchstart` в окне 300мс/30px ставит `suppressedAfterDoubleTap = true` — вся последующая серия touch до `touchend` игнорируется: ни rotation, ни DragPan-disable. Анализ направления первого move (вертикаль/горизонталь) ненадёжен: drag для зума часто начинается с лёгкого горизонтального дрейфа пальца, и late-активация rotation тогда срабатывает ошибочно. Подавление целой серии повторяет поведение прошлой пары `ngrsZoom + singleFingerRotation` (где `ngrsZoom` отдельным модулем перехватывал touch на capture-фазе), где после двойного тапа карту нельзя было поворачивать в принципе. После окончания серии `lastTapEndTime` сбрасывается в 0, чтобы следующий `touchstart` НЕ попал в double-tap-окно как третий тап. Константы окна (300мс/30px) перенесены из удалённого модуля `ngrsZoom`.

**nativeGarbageGuard** — нативный «Сборщик мусора» SBG 0.6.1 (чекбокс `usegrb` + лимиты по уровню) дублирует функцию `inventoryCleanup`. Пока модуль активен, нативный сборщик принудительно отключается двумя слоями: серверным однократным `POST /api/settings { usegrb: false }` на enable (через прямой fetch с auth-токеном, потому что игровая `apiSend` IIFE-внутренняя и недоступна), плюс DOM-disable на чекбоксе `usegrb`, всех `.garbage-value` инпутах и кнопке `#garbage-save`. Установленный нами `disabled` помечается атрибутом `data-svp-disabled-by-cleanup`, чтобы на uninstall снимать только своё, не трогая `disabled`, поставленный самой игрой. MutationObserver на `document.body` догоняет ререндер settings-секции в будущих версиях; `installGeneration` counter защищает от race условий при быстром uninstall/install. На disable атрибуты снимаются (контроль возвращается игре), но `usegrb=true` обратно не выставляется - пользователь может оставить нативный сборщик off, если хочет.

**SBG Flavor** — `src/core/sbgFlavor.ts`: перехватывает глобальный `fetch` и добавляет заголовок `x-sbg-flavor: VanillaPlus/{version}` ко всем запросам. Если другие скрипты уже установили этот заголовок, значение дополняется через пробел. Формат как у User-Agent. Запрошено разработчиком игры для статистики. Единственный перехват `fetch`, где наша логика идёт до вызова оригинала, поэтому сборка заголовков обёрнута `try`: `Headers` бросает синхронно, а нативный `fetch` на тех же данных отклоняет промис, и обработчик игры на промисе такой ошибки не увидел бы. При отказе запрос уходит с исходным `init` игры, без нашего заголовка.

**Flavor на загрузочном экране** — `src/core/loadingScreenFlavor.ts`: дописывает `VanillaPlus/{version}` к версии игры в `.loading-screen__version`, получается `Stock/0.7.0, VanillaPlus/{version}`. Стиль инжектится в document-start, вместе с остальными ранними перехватами: игра пишет свой flavor (refs/game/script.js:139) сразу после загрузки i18n и до первого запроса `/api/*`, поэтому ожидание детекта версии (он завершается только на ответе этого запроса) оставляло бы на экране одну версию игры на всё время round-trip. Метка добавляется псевдоэлементом `::after`, а не записью в `textContent`: игра перезаписывает содержимое элемента целиком и позже нашего старта, текстовая запись была бы затёрта. До записи игры элемент пустой (refs/game/index.html:68), поэтому правило ограничено `:not(:empty)` - иначе между нашим стартом и записью игры на экране висела бы одна наша версия с ведущей запятой. Если игрок отказался работать на неподдерживаемой версии игры (`ensureSbgVersionSupported`), стиль снимается. Значение flavor общее с заголовком `x-sbg-flavor` (`SVP_FLAVOR` в `sbgFlavor.ts`).

**Game Script Patcher** — `src/core/gameScriptPatcher.ts`: перехватывает загрузку основного скрипта игры (ES module) и применяет патчи перед инъекцией. Механизм: override `Element.prototype.append` → перехват `<script type="module" src="script@...">` → fetch → text patch → inline module inject. Override одноразовый — снимается сразу после перехвата. При ошибке загружается оригинальный скрипт без патчей. Текущие патчи: экспозиция `window.showInfo` для прямого открытия попапа точки. Подавление нативного горизонтального свайпа на `.info` (раньше было text-патчем) перенесено в модуль `improvedNextPointSwipe` через runtime-override `Hammer.Manager.prototype.emit` - менее инвазивно, не требует обновления поисковой строки при минорных правках script.js игры.

## Глобальные runtime-override и их жизненный цикл

Часть модулей при включении ставит monkey-patch на глобальный API (`window.fetch`, `Hammer.Manager.prototype.emit`) или отправляет неотменимый запрос на сервер. Снятие override на `disable` либо технически невозможно (один поток pending fetch может ссылаться на ту же ссылку), либо стоит дороже, чем оставленный override, который просто проверяет флаг и идёт по fast path.

| Модуль                                           | Что устанавливается                                                               | Поведение после `disable`                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `refsLayerSync`                                  | Monkey-patch `window.fetch` (lazy install на enable)                              | Сбрасывается флаг `discoverHookEnabled`. Сам patch остаётся до перезагрузки страницы — fast path в patched fetch проверяет флаг и пропускает обработку discover                                                                                                                                                                                                                             |
| `xpPopups`                                       | Monkey-patch `window.fetch` (lazy install на enable)                              | Сбрасывается флаг `xpHookEnabled`. Сам patch остаётся до перезагрузки страницы - fast path проверяет флаг и пропускает обработку ответа. Полное снятие здесь не просто дороже, а опасно: модуль включается в блоке `ui`, то есть раньше `refsLayerSync`, `refsOnMap` и `drawingRestrictions`, и восстановление сохранённого `originalFetch` выкинуло бы из цепочки их обёртки               |
| `drawingRestrictions.drawFilter`                 | Wrap `window.fetch` для `GET /api/draw` (install на enable)                       | Сбрасывается флаг `drawFilterEnabled`. Сам wrapper остаётся до перезагрузки страницы по той же причине, что и у `xpPopups`: модуль включается раньше других обёрток `window.fetch`, и восстановление сохранённого `originalFetch` выкинуло бы из цепочки чужие. Pending-fetch'ы, ушедшие до disable, всё равно проходят через wrapper - это не утечка, а ожидаемая semantics monkey-patch'а |
| `improvedNextPointSwipe`                         | Override `Hammer.Manager.prototype.emit`                                          | Полностью снимается на disable: `proto.emit` восстанавливается из сохранённого оригинала, нативный Hammer-handler игры снова получает swipeleft/swiperight events                                                                                                                                                                                                                           |
| `nativeGarbageGuard` (внутри `inventoryCleanup`) | Серверный POST `/api/settings { usegrb: false }` один раз за активную фазу модуля | Серверная сторона не откатывается обратно: пользователь сам решает, нужно ли ему включить нативный сборщик после отключения нашей автоочистки. Флаг `usegrbPostedThisSession` сбрасывается на `disable`, чтобы повторный `enable` отправил `usegrb=false` заново — пользователь во время disable мог сам поставить true через UI игры                                                       |
| `nativeGarbageGuard` (DOM)                       | `disabled` атрибуты на инпутах сборщика, обёртка fieldset с подписью              | Полностью снимается на disable: `data-svp-disabled-by-cleanup` маркер позволяет различить наш disabled и игровой                                                                                                                                                                                                                                                                            |

Полное снятие — только перезагрузкой страницы для `refsLayerSync`, `xpPopups`, `drawingRestrictions.drawFilter` и серверной части `nativeGarbageGuard`. Остальные override (`improvedNextPointSwipe`, DOM-часть `nativeGarbageGuard`) снимаются полностью на disable. Это сознательное архитектурное решение в пользу простоты install-логики (`installGeneration` race protection остаётся, fully-clean uninstall обязателен только там, где модуль предполагает многократный re-enable за сессию).

### Ошибка нашей логики внутри override

Через override проходит весь поток жестов и сети игры, поэтому исключение из нашего кода не должно выходить в игровой. Правило одинаковое для всех перехватов: собственная логика идёт в `try`, вызов оригинала — вне него, в `catch` пишется `console.error` с префиксом `[SVP <moduleId>]` и разбор пропускается. Перехват при этом не снимается: он остаётся в цепочке и продолжает работать на следующих вызовах, потому что ошибка обычно относится к конкретным данным, а не к совместимости навсегда.

Запись делается один раз за включение модуля (флаг в модуле, сбрасывается в `enable`): точки перехвата вызываются на каждом жесте и каждом запросе, и повтор вытеснил бы полезные строки из `core/errorLog`. `try` ставится там, где действительно есть источник — обращение к игровым объектам (OL-фичи, DOM игры, данные ответа сервера), а не вокруг собственного разбора аргументов, который состоит из проверок типов.

Исключение — момент, когда наш код уже принял решение обработать событие сам: тогда после ошибки оригинал не вызывается (`improvedNextPointSwipe`), иначе игра отработает тот же жест повторно.

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

| Что           | Расположение                | Описание                                                                  |
| ------------- | --------------------------- | ------------------------------------------------------------------------- |
| EUI исходники | `refs/eui/src/`             | TypeScript-исходники из GitHub                                            |
| CUI исходники | `refs/cui/`                 | `index.js` + `styles.css` из GitHub                                       |
| EUI релиз     | `refs/releases/eui.user.js` | Собранный бандл (beautified)                                              |
| CUI релиз     | `refs/releases/cui.user.js` | Собранный бандл (beautified)                                              |
| OpenLayers    | `refs/ol/ol.js`             | UMD-бандл v10.6.0 (beautified)                                            |
| Toastify      | `refs/toastify/`            | `toastify.js` (beautified) + `toastify.css` — библиотека уведомлений игры |
| i18next       | `refs/i18next/i18next.js`   | Бандл i18n игры (beautified)                                              |
| HTML игры     | `refs/game/index.html`      | Статический HTML страницы                                                 |
| Скрипт игры   | `refs/game/script.js`       | Основной скрипт (beautified)                                              |
| Стили игры    | `refs/game/style.css`       | Бандл `style@<версия>.<hash>.css`                                         |
| Переводы игры | `refs/game/i18n/`           | `<lng>.json` по списку из `/i18n/meta.json`                               |

**Ручное содержимое** (добавляет пользователь):

| Что                   | Расположение          | Описание                                        |
| --------------------- | --------------------- | ----------------------------------------------- |
| DOM после рендера     | `refs/game/dom/`      | Дампы из DevTools (Copy outerHTML)              |
| CSS-переменные        | `refs/game/css/`      | `:root` custom properties (экспорт из DevTools) |
| Снимок прошлой версии | `refs/game_<версия>/` | Сервер отдаёт только текущую версию игры        |
| Скриншоты UI          | `refs/screenshots/`   | Визуальный контекст интерфейса                  |

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
│   ├── isRecord.ts          # Guard объекта со строковыми ключами для разбора JSON
│   ├── clickSynthesis.ts    # Click-polyfill для touch-кнопок после DOM-burst
│   ├── olMap.ts             # OL Map capture + утилиты (findLayerByName, DragPan)
│   ├── mapGestureLock.ts    # Захват жеста на карте (перетаскивание вершины против поворота)
│   ├── gameConstants.ts     # Константы игры (типы предметов)
│   ├── inventoryTypes.ts    # Типы предметов инвентаря + type guards
│   ├── inventoryCache.ts    # Чтение inventory-cache + helper'ы агрегации заблокированных и избранных точек по lock/favorite
│   ├── marksApi.ts          # POST /api/marks (favorite/locked флаги стопки)
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
│   ├── loadingScreenFlavor.ts # Flavor скрипта на загрузочном экране игры
│   ├── host.ts              # Определение хоста (SBG Scout)
│   ├── errorLog.ts          # Перехват и хранение ошибок
│   ├── toast.ts             # Тост-уведомления поверх игры (через Toastify игры)
│   ├── toastify.ts          # Доступ к Toastify игры и типы его API
│   ├── bugReport.ts         # Формирование баг-репортов
│   ├── l10n.ts              # Локализация (en/ru)
│   ├── gameI18n.ts          # Подписи игровых элементов через i18next игры
│   ├── gameSettings.ts      # Чтение игровых настроек (lang, theme, base)
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

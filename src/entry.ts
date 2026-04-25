import { isDisabled } from './core/killswitch';
import { installGameScriptPatcher } from './core/gameScriptPatcher';
import { bootstrap } from './core/bootstrap';
import { initErrorLog } from './core/errorLog';
import { initGameVersionDetection, installGameVersionCapture } from './core/gameVersion';
import { ensureSbgVersionSupported } from './core/gameVersionPrompt';
import { initOlMapCapture } from './core/olMap';
import { installSbgFlavor } from './core/sbgFlavor';
import { enhancedMainScreen } from './modules/enhancedMainScreen/enhancedMainScreen';
import { enhancedPointPopupUi } from './modules/enhancedPointPopupUi/enhancedPointPopupUi';
import { swipeToClosePopup } from './modules/swipeToClosePopup/swipeToClosePopup';
import { shiftMapCenterDown } from './modules/shiftMapCenterDown/shiftMapCenterDown';
import { ngrsZoom } from './modules/ngrsZoom/ngrsZoom';
import { drawButtonFix } from './modules/drawButtonFix/drawButtonFix';
import { groupErrorToasts } from './modules/groupErrorToasts/groupErrorToasts';
import { removeAttackCloseButton } from './modules/removeAttackCloseButton/removeAttackCloseButton';
import { keepScreenOn } from './modules/keepScreenOn/keepScreenOn';
import { keyCountOnPoints } from './modules/keyCountOnPoints/keyCountOnPoints';
import { largerPointTapArea } from './modules/largerPointTapArea/largerPointTapArea';
import { nextPointNavigation } from './modules/nextPointNavigation/nextPointNavigation';
import { refsOnMap } from './modules/refsOnMap/refsOnMap';
import { repairAtFullCharge } from './modules/repairAtFullCharge/repairAtFullCharge';
import { singleFingerRotation } from './modules/singleFingerRotation/singleFingerRotation';
import { mapTileLayers } from './modules/mapTileLayers/mapTileLayers';
import { inventoryCleanup } from './modules/inventoryCleanup/inventoryCleanup';
import { favoritedPoints } from './modules/favoritedPoints/favoritedPoints';

if (!isDisabled()) {
  // Перехваты, которые должны быть установлены ДО парсинга DOM и
  // загрузки игрового скрипта:
  // - gameScriptPatcher: override Element.prototype.append до того как mobile-check
  //   скрипт создаст <script type="module" src="script@...">
  // - olMapCapture: defineProperty на window.ol до загрузки OL-скрипта
  // - gameVersionCapture: monkey-patch window.fetch до первого /api/*
  //   запроса игры, чтобы поймать заголовок x-sbg-version в ответе
  installGameScriptPatcher();
  initOlMapCapture();
  installGameVersionCapture();

  // bootstrap() создаёт DOM-элементы (settings panel), для чего нужен document.head.
  // При document-start head ещё не существует — откладываем до DOMContentLoaded.
  async function init(): Promise<void> {
    initErrorLog();
    // Детект версии игры через заголовок x-sbg-version (сервер ставит его
    // на любой /api/* ответ, включая 404). Ждём ДО bootstrap, чтобы гейтинг
    // модулей в bootstrap видел кэшированную версию синхронно.
    await initGameVersionDetection();
    // Если версия не поддерживается этой сборкой — confirm. При отмене
    // bootstrap не запускаем И flavor-заголовок не выставляем: мы не
    // должны модифицировать запросы к серверу, если пользователь отказался
    // от работы скрипта на этой версии.
    if (!ensureSbgVersionSupported()) return;
    installSbgFlavor();
    bootstrap([
      // ui
      enhancedMainScreen,
      enhancedPointPopupUi,
      swipeToClosePopup,
      groupErrorToasts,
      removeAttackCloseButton,
      // feature (favoritedPoints ПЕРЕД inventoryCleanup — зависимость init)
      favoritedPoints,
      inventoryCleanup,
      keepScreenOn,
      repairAtFullCharge,
      // map
      shiftMapCenterDown,
      largerPointTapArea,
      ngrsZoom,
      keyCountOnPoints,
      singleFingerRotation,
      mapTileLayers,
      // feature (map-зависимые)
      nextPointNavigation,
      refsOnMap,
      // fix
      drawButtonFix,
    ]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => void init());
  } else {
    void init();
  }
}

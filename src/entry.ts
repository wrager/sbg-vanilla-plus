import { isDisabled } from './core/killswitch';
import { installGameScriptPatcher } from './core/gameScriptPatcher';
import { bootstrap } from './core/bootstrap';
import { initErrorLog } from './core/errorLog';
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
  // Перехваты, которые должны быть установлены ДО парсинга DOM:
  // - gameScriptPatcher: override Element.prototype.append до того как mobile-check
  //   скрипт создаст <script type="module" src="script@...">
  // - olMapCapture: defineProperty на window.ol до загрузки OL-скрипта
  installGameScriptPatcher();
  initOlMapCapture();

  // bootstrap() создаёт DOM-элементы (settings panel), для чего нужен document.head.
  // При document-start head ещё не существует — откладываем до DOMContentLoaded.
  function init(): void {
    initErrorLog();
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
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}

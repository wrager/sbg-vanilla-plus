import { isDisabled } from './core/killswitch';
import { installGameScriptPatcher } from './core/gameScriptPatcher';
import { bootstrap } from './core/bootstrap';
import { initErrorLog } from './core/errorLog';
import { initGameVersionDetection, installGameVersionCapture } from './core/gameVersion';
import { ensureSbgVersionSupported } from './core/gameVersionPrompt';
import { initOlMapCapture } from './core/olMap';
import { hideLoadingScreenFlavor, showLoadingScreenFlavor } from './core/loadingScreenFlavor';
import { installSbgFlavor } from './core/sbgFlavor';
import { betterRefPopoverClosing } from './modules/betterRefPopoverClosing/betterRefPopoverClosing';
import { enhancedMainScreen } from './modules/enhancedMainScreen/enhancedMainScreen';
import { enhancedPointPopupUi } from './modules/enhancedPointPopupUi/enhancedPointPopupUi';
import { shiftMapCenterDown } from './modules/shiftMapCenterDown/shiftMapCenterDown';
import { drawButtonFix } from './modules/drawButtonFix/drawButtonFix';
import { repairButtonFix } from './modules/repairButtonFix/repairButtonFix';
import { compactToasts } from './modules/compactToasts/compactToasts';
import { removeAttackCloseButton } from './modules/removeAttackCloseButton/removeAttackCloseButton';
import { keepScreenOn } from './modules/keepScreenOn/keepScreenOn';
import { largerPointTapArea } from './modules/largerPointTapArea/largerPointTapArea';
import { refsOnMap } from './modules/refsOnMap/refsOnMap';
import { singleFingerRotation } from './modules/singleFingerRotation/singleFingerRotation';
import { mapTileLayers } from './modules/mapTileLayers/mapTileLayers';
import { drawTools } from './modules/drawTools/drawTools';
import { smoothPlayerMarker } from './modules/smoothPlayerMarker/smoothPlayerMarker';
import { inventoryCleanup } from './modules/inventoryCleanup/inventoryCleanup';
import { drawingRestrictions } from './modules/drawingRestrictions/drawingRestrictions';
import { favoritesMigration } from './modules/favoritesMigration/favoritesMigration';
import { improvedNextPointSwipe } from './modules/improvedNextPointSwipe/improvedNextPointSwipe';
import { nextPointSwipeAnimation } from './modules/nextPointSwipeAnimation/nextPointSwipeAnimation';
import { nextPointSwipeButtonsFix } from './modules/nextPointSwipeButtonsFix/nextPointSwipeButtonsFix';
import { refsLayerSync } from './modules/refsLayerSync/refsLayerSync';
import { swipeToClosePopup } from './modules/swipeToClosePopup/swipeToClosePopup';
import { xpPopups } from './modules/xpPopups/xpPopups';

if (!isDisabled()) {
  // Перехваты, которые должны быть установлены ДО парсинга DOM и
  // загрузки игрового скрипта:
  // - gameScriptPatcher: override Element.prototype.append до того как mobile-check
  //   скрипт создаст <script type="module" src="script@...">
  // - olMapCapture: defineProperty на window.ol до загрузки OL-скрипта
  // - gameVersionCapture: monkey-patch window.fetch до первого /api/*
  //   запроса игры, чтобы поймать заголовок x-sbg-version в ответе
  // - loadingScreenFlavor: стиль с нашей версией до того как игра запишет
  //   свою в .loading-screen__version (это происходит раньше первого /api/*
  //   ответа, то есть раньше, чем завершится детект версии)
  installGameScriptPatcher();
  initOlMapCapture();
  installGameVersionCapture();
  showLoadingScreenFlavor();

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
    // от работы скрипта на этой версии. Метку на загрузочном экране, уже
    // показанную к этому моменту, по той же причине убираем.
    if (!ensureSbgVersionSupported()) {
      hideLoadingScreenFlavor();
      return;
    }
    installSbgFlavor();
    bootstrap([
      // ui
      enhancedMainScreen,
      enhancedPointPopupUi,
      compactToasts,
      removeAttackCloseButton,
      nextPointSwipeAnimation,
      xpPopups,
      // feature (favoritesMigration ПЕРЕД inventoryCleanup — зависимость init:
      // loadFavorites() в init модуля favoritesMigration грузит legacy IDB-снимок,
      // от которого зависит блок-логика inventoryCleanup)
      favoritesMigration,
      drawingRestrictions,
      inventoryCleanup,
      keepScreenOn,
      // map
      shiftMapCenterDown,
      largerPointTapArea,
      singleFingerRotation,
      mapTileLayers,
      drawTools,
      smoothPlayerMarker,
      // feature (map-зависимые)
      refsOnMap,
      improvedNextPointSwipe,
      swipeToClosePopup,
      // fix
      betterRefPopoverClosing,
      drawButtonFix,
      repairButtonFix,
      nextPointSwipeButtonsFix,
      refsLayerSync,
    ]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => void init());
  } else {
    void init();
  }
}

import { isDisabled } from './core/killswitch';
import { bootstrap } from './core/bootstrap';
import { initErrorLog } from './core/errorLog';
import { initOlMapCapture } from './core/olMap';
import { installSbgFlavor } from './core/sbgFlavor';
import { collapsibleTopPanel } from './modules/collapsibleTopPanel/collapsibleTopPanel';
import { enhancedPointPopupUi } from './modules/enhancedPointPopupUi/enhancedPointPopupUi';
import { shiftMapCenterDown } from './modules/shiftMapCenterDown/shiftMapCenterDown';
import { disableDoubleTapZoom } from './modules/disableDoubleTapZoom/disableDoubleTapZoom';
import { doubleTapDragZoom } from './modules/doubleTapDragZoom/doubleTapDragZoom';
import { drawButtonFix } from './modules/drawButtonFix/drawButtonFix';
import { keepScreenOn } from './modules/keepScreenOn/keepScreenOn';
import { keyCountOnPoints } from './modules/keyCountOnPoints/keyCountOnPoints';
import { largerPointTapArea } from './modules/largerPointTapArea/largerPointTapArea';
import { nextPointNavigation } from './modules/nextPointNavigation/nextPointNavigation';
import { singleFingerRotation } from './modules/singleFingerRotation/singleFingerRotation';
import { mapTileLayers } from './modules/mapTileLayers/mapTileLayers';

if (!isDisabled()) {
  initErrorLog();
  installSbgFlavor();
  initOlMapCapture();
  bootstrap([
    collapsibleTopPanel,
    enhancedPointPopupUi,
    shiftMapCenterDown,
    largerPointTapArea,
    disableDoubleTapZoom,
    doubleTapDragZoom,
    drawButtonFix,
    keepScreenOn,
    keyCountOnPoints,
    nextPointNavigation,
    singleFingerRotation,
    mapTileLayers,
  ]);
}

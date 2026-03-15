import { isDisabled } from './core/killswitch';
import { bootstrap } from './core/bootstrap';
import { initOlMapCapture } from './core/olMap';
import { installSbgFlavor } from './core/sbgFlavor';
import { collapsibleTopPanel } from './modules/collapsibleTopPanel/collapsibleTopPanel';
import { enhancedPointPopupUi } from './modules/enhancedPointPopupUi/enhancedPointPopupUi';
import { shiftMapCenterDown } from './modules/shiftMapCenterDown/shiftMapCenterDown';
import { disableDoubleTapZoom } from './modules/disableDoubleTapZoom/disableDoubleTapZoom';
import { drawButtonFix } from './modules/drawButtonFix/drawButtonFix';
import { keepScreenOn } from './modules/keepScreenOn/keepScreenOn';
import { keyCountOnPoints } from './modules/keyCountOnPoints/keyCountOnPoints';
import { largerPointTapArea } from './modules/largerPointTapArea/largerPointTapArea';

if (!isDisabled()) {
  installSbgFlavor();
  initOlMapCapture();
  bootstrap([
    collapsibleTopPanel,
    enhancedPointPopupUi,
    shiftMapCenterDown,
    largerPointTapArea,
    disableDoubleTapZoom,
    drawButtonFix,
    keepScreenOn,
    keyCountOnPoints,
  ]);
}

import { isDisabled } from './core/killswitch';
import { bootstrap } from './core/bootstrap';
import { initOlMapCapture } from './core/olMap';
import { installSbgFlavor } from './core/sbgFlavor';
import { collapsibleTopPanel } from './modules/style/collapsibleTopPanel/collapsibleTopPanel';
import { enhancedPointPopupUi } from './modules/style/enhancedPointPopupUi/enhancedPointPopupUi';
import { shiftMapCenterDown } from './modules/style/shiftMapCenterDown/shiftMapCenterDown';
import { disableDoubleTapZoom } from './modules/feature/disableDoubleTapZoom/disableDoubleTapZoom';
import { drawButtonFix } from './modules/bugfix/drawButtonFix/drawButtonFix';
import { keepScreenOn } from './modules/feature/keepScreenOn/keepScreenOn';
import { keyCountOnPoints } from './modules/style/keyCountOnPoints/keyCountOnPoints';
import { largerPointTapArea } from './modules/style/largerPointTapArea/largerPointTapArea';

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

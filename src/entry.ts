import { isDisabled } from './core/killswitch';
import { bootstrap } from './core/bootstrap';
import { initOlMapCapture } from './core/olMap';
import { collapsibleTopPanel } from './modules/style/collapsibleTopPanel/collapsibleTopPanel';
import { enhancedPointPopupUi } from './modules/style/enhancedPointPopupUi/enhancedPointPopupUi';
import { shiftMapCenterDown } from './modules/style/shiftMapCenterDown/shiftMapCenterDown';
import { disableDoubleTapZoom } from './modules/feature/disableDoubleTapZoom/disableDoubleTapZoom';
import { drawButtonFix } from './modules/bugfix/drawButtonFix/drawButtonFix';
import { keepScreenOn } from './modules/feature/keepScreenOn/keepScreenOn';
import { keyCountOnPoints } from './modules/style/keyCountOnPoints/keyCountOnPoints';

if (!isDisabled()) {
  initOlMapCapture();
  bootstrap([
    collapsibleTopPanel,
    enhancedPointPopupUi,
    shiftMapCenterDown,
    disableDoubleTapZoom,
    drawButtonFix,
    keepScreenOn,
    keyCountOnPoints,
  ]);
}

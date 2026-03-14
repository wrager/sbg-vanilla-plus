import { isDisabled } from './core/killswitch';
import { bootstrap } from './core/bootstrap';
import { disableDoubleTapZoom } from './modules/disableDoubleTapZoom/disableDoubleTapZoom';
import { drawAlwaysAvailable } from './modules/drawAlwaysAvailable/drawAlwaysAvailable';
import { keepScreenOn } from './modules/keepScreenOn/keepScreenOn';
import { shiftMapCenterDown } from './modules/shiftMapCenterDown/shiftMapCenterDown';

if (!isDisabled()) {
  bootstrap([disableDoubleTapZoom, drawAlwaysAvailable, keepScreenOn, shiftMapCenterDown]);
}

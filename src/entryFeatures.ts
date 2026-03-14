import { isDisabled } from './core/killswitch';
import { bootstrap } from './core/bootstrap';
import { disableDoubleTapZoom } from './modules/disableDoubleTapZoom';
import { drawAlwaysAvailable } from './modules/drawAlwaysAvailable';
import { keepScreenOn } from './modules/keepScreenOn';
import { shiftMapCenterDown } from './modules/shiftMapCenterDown';

if (!isDisabled()) {
  bootstrap([disableDoubleTapZoom, drawAlwaysAvailable, keepScreenOn, shiftMapCenterDown]);
}

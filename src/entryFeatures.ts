import { isDisabled } from './core/killswitch';
import { bootstrap } from './core/bootstrap';
import { disableDoubleTapZoom } from './modules/disableDoubleTapZoom/disableDoubleTapZoom';
import { drawButtonFix } from './modules/drawButtonFix/drawButtonFix';
import { keepScreenOn } from './modules/keepScreenOn/keepScreenOn';
if (!isDisabled()) {
  bootstrap([disableDoubleTapZoom, drawButtonFix, keepScreenOn]);
}

import { isDisabled } from './core/killswitch';
import { bootstrap } from './core/bootstrap';
import { disableDoubleTapZoom } from './modules/disableDoubleTapZoom/disableDoubleTapZoom';
import { drawAlwaysAvailable } from './modules/drawAlwaysAvailable/drawAlwaysAvailable';
import { keepScreenOn } from './modules/keepScreenOn/keepScreenOn';
if (!isDisabled()) {
  bootstrap([disableDoubleTapZoom, drawAlwaysAvailable, keepScreenOn]);
}

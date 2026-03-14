import { isDisabled } from './core/killswitch';
import { bootstrap } from './core/bootstrap';
import { disableDoubleTapZoom } from './modules/disableDoubleTapZoom';
import { drawAlwaysAvailable } from './modules/drawAlwaysAvailable';
import { keepScreenOn } from './modules/keepScreenOn';

if (!isDisabled()) {
  bootstrap([disableDoubleTapZoom, drawAlwaysAvailable, keepScreenOn]);
}

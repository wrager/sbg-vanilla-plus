import { isDisabled } from './core/killswitch';
import { bootstrap } from './core/bootstrap';
import { disableDoubleTapZoom } from './modules/disableDoubleTapZoom';

if (!isDisabled()) {
  bootstrap([disableDoubleTapZoom]);
}

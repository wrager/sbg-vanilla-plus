import { isDisabled } from './core/killswitch';
import { bootstrap } from './core/bootstrap';
import { disableDoubleTapZoom } from './modules/disableDoubleTapZoom';
import { alwaysDrawEnabled } from './modules/alwaysDrawEnabled';
import { keepScreenOn } from './modules/keepScreenOn';

if (!isDisabled()) {
  bootstrap([disableDoubleTapZoom, alwaysDrawEnabled, keepScreenOn]);
}

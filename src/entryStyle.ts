import { isDisabled } from './core/killswitch';
import { bootstrap } from './core/bootstrap';
import { enhancedPointPopupUi } from './modules/enhancedPointPopupUi/enhancedPointPopupUi';
import { shiftMapCenterDown } from './modules/shiftMapCenterDown/shiftMapCenterDown';

if (!isDisabled()) {
  bootstrap([enhancedPointPopupUi, shiftMapCenterDown]);
}

import { isDisabled } from './core/killswitch';
import { bootstrap } from './core/bootstrap';
import { enhancedPointPopupUi } from './modules/enhancedPointPopupUi/enhancedPointPopupUi';

if (!isDisabled()) {
  bootstrap([enhancedPointPopupUi]);
}

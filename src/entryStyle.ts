import { isDisabled } from './core/killswitch';
import { bootstrap } from './core/bootstrap';
import { collapsibleTopPanel } from './modules/collapsibleTopPanel/collapsibleTopPanel';
import { enhancedPointPopupUi } from './modules/enhancedPointPopupUi/enhancedPointPopupUi';
import { shiftMapCenterDown } from './modules/shiftMapCenterDown/shiftMapCenterDown';

if (!isDisabled()) {
  bootstrap([collapsibleTopPanel, enhancedPointPopupUi, shiftMapCenterDown]);
}

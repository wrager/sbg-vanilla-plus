import { isDisabled } from './core/killswitch';
import { bootstrap } from './core/bootstrap';
import { enlargedButtons } from './modules/enlargedButtons';

if (!isDisabled()) {
  bootstrap([enlargedButtons]);
}

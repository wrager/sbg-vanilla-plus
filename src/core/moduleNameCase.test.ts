import type { IFeatureModule } from './moduleRegistry';
import { betterRefPopoverClosing } from '../modules/betterRefPopoverClosing/betterRefPopoverClosing';
import { drawButtonFix } from '../modules/drawButtonFix/drawButtonFix';
import { drawTools } from '../modules/drawTools/drawTools';
import { drawingRestrictions } from '../modules/drawingRestrictions/drawingRestrictions';
import { enhancedMainScreen } from '../modules/enhancedMainScreen/enhancedMainScreen';
import { enhancedPointPopupUi } from '../modules/enhancedPointPopupUi/enhancedPointPopupUi';
import { favoritesMigration } from '../modules/favoritesMigration/favoritesMigration';
import { groupErrorToasts } from '../modules/groupErrorToasts/groupErrorToasts';
import { improvedNextPointSwipe } from '../modules/improvedNextPointSwipe/improvedNextPointSwipe';
import { inventoryCleanup } from '../modules/inventoryCleanup/inventoryCleanup';
import { keepScreenOn } from '../modules/keepScreenOn/keepScreenOn';
import { largerPointTapArea } from '../modules/largerPointTapArea/largerPointTapArea';
import { mapTileLayers } from '../modules/mapTileLayers/mapTileLayers';
import { nextPointSwipeAnimation } from '../modules/nextPointSwipeAnimation/nextPointSwipeAnimation';
import { nextPointSwipeButtonsFix } from '../modules/nextPointSwipeButtonsFix/nextPointSwipeButtonsFix';
import { refsLayerSync } from '../modules/refsLayerSync/refsLayerSync';
import { refsOnMap } from '../modules/refsOnMap/refsOnMap';
import { removeAttackCloseButton } from '../modules/removeAttackCloseButton/removeAttackCloseButton';
import { repairButtonFix } from '../modules/repairButtonFix/repairButtonFix';
import { shiftMapCenterDown } from '../modules/shiftMapCenterDown/shiftMapCenterDown';
import { singleFingerRotation } from '../modules/singleFingerRotation/singleFingerRotation';
import { swipeToClosePopup } from '../modules/swipeToClosePopup/swipeToClosePopup';

/*
 * Список повторяет набор модулей из entry.ts: собственного реестра «всех
 * модулей» в проекте нет, регистрация происходит в bootstrap() по списку
 * аргументов. Новый модуль добавляется сюда вручную.
 */
const MODULES: readonly IFeatureModule[] = [
  betterRefPopoverClosing,
  drawButtonFix,
  drawTools,
  drawingRestrictions,
  enhancedMainScreen,
  enhancedPointPopupUi,
  favoritesMigration,
  groupErrorToasts,
  improvedNextPointSwipe,
  inventoryCleanup,
  keepScreenOn,
  largerPointTapArea,
  mapTileLayers,
  nextPointSwipeAnimation,
  nextPointSwipeButtonsFix,
  refsLayerSync,
  refsOnMap,
  removeAttackCloseButton,
  repairButtonFix,
  shiftMapCenterDown,
  singleFingerRotation,
  swipeToClosePopup,
];

// Аббревиатуры остаются заглавными в любой позиции названия.
const ABBREVIATIONS = new Set(['UI', 'API', 'GPS']);

function isAbbreviation(word: string): boolean {
  return ABBREVIATIONS.has(word);
}

describe('английские названия модулей в едином регистре', () => {
  test.each(MODULES.map((mod) => [mod.id, mod.name.en] as const))(
    '%s: "%s" в sentence case',
    (_id, name) => {
      const [firstWord = '', ...restWords] = name.split(' ');
      expect(firstWord.charAt(0)).toBe(firstWord.charAt(0).toUpperCase());

      for (const word of restWords) {
        if (isAbbreviation(word)) continue;
        expect(word.charAt(0)).toBe(word.charAt(0).toLowerCase());
      }
    },
  );
});

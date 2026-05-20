import { t } from '../../core/l10n';
import { showToast } from '../../core/toast';

/**
 * Toast при назначении точки центром звезды. Формулировка повторяет CUI
 * (`onPointPopupOpened` в refs/cui/index.js) — узнаваемость для игроков, пришедших из CUI.
 */
export function showCenterAssignedToast(): void {
  showToast(
    t({
      en: 'Point selected as star center for drawing.',
      ru: 'Точка выбрана центром для рисования звезды.',
    }),
    3000,
  );
}

/** Toast при снятии центра звезды (из попапа или через clear-control на карте). */
export function showCenterClearedToast(): void {
  showToast(t({ en: 'Star center cleared', ru: 'Центр звезды снят' }), 3000);
}

/**
 * Toast при попытке назначить locked-точку центром звезды. Назначение блокируется:
 * нативный замочек защищает ключи от расходования на линии, поэтому из такого
 * центра невозможно было бы нарисовать ни одной линии звезды.
 */
export function showCannotSetLockedCenterToast(): void {
  showToast(
    t({
      en: "Locked point can't be a star center.",
      ru: 'Защищённая точка не может быть центром звезды.',
    }),
    4000,
  );
}

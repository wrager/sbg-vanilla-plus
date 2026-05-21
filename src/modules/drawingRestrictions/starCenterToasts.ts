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

/** Toast при включении режима через toggle (попап-кнопка или map-toggle). */
export function showStarModeEnabledToast(): void {
  showToast(
    t({ en: 'Star mode enabled', ru: 'Режим звезды включён' }),
    3000,
  );
}

/** Toast при выключении режима через toggle (попап-кнопка или map-toggle). */
export function showStarModeDisabledToast(): void {
  showToast(
    t({ en: 'Star mode disabled', ru: 'Режим звезды выключен' }),
    3000,
  );
}

/**
 * Toast при попытке назначить locked-точку центром звезды. Назначение блокируется:
 * нативный замочек блокирует расходование ключей на линии, поэтому из такого
 * центра невозможно было бы нарисовать ни одной линии звезды.
 */
export function showCannotSetLockedCenterToast(): void {
  showToast(
    t({
      en: "Locked point can't be a star center.",
      ru: 'Точка с замочком не может быть центром звезды.',
    }),
    4000,
  );
}

/**
 * Toast при install-time auto-clear: центр звезды был назначен в прошлой сессии,
 * между сессиями точка получила замочек, на старте мы сняли центр. Юзер не
 * совершал клика, поэтому сообщение объясняет именно факт снятия и причину,
 * а не запрет действия.
 */
export function showCenterClearedBecauseLockedToast(): void {
  showToast(
    t({
      en: 'Star center cleared: the point is now locked.',
      ru: 'Центр звезды снят: точка стала с замочком.',
    }),
    4000,
  );
}

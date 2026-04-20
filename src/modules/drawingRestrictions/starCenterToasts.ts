import { t } from '../../core/l10n';
import { showToast } from '../../core/toast';

/**
 * Toast при назначении точки центром звезды. Формулировка повторяет CUI
 * (`onPointPopupOpened` в refs/cui/index.js) — узнаваемость для игроков, пришедших из CUI.
 */
export function showCenterAssignedToast(name: string): void {
  if (name.length === 0) {
    showToast(
      t({
        en: 'Point selected as star center for drawing.',
        ru: 'Точка выбрана центром для рисования звезды.',
      }),
      3000,
    );
    return;
  }
  showToast(
    t({
      en: `Point "${name}" selected as star center for drawing.`,
      ru: `Точка "${name}" выбрана центром для рисования звезды.`,
    }),
    3000,
  );
}

/** Toast при снятии центра звезды (из попапа или через clear-control на карте). */
export function showCenterClearedToast(name: string): void {
  if (name.length === 0) {
    showToast(t({ en: 'Star center cleared', ru: 'Центр звезды снят' }), 3000);
    return;
  }
  showToast(
    t({
      en: `Star center cleared: ${name}`,
      ru: `Центр звезды снят: ${name}`,
    }),
    3000,
  );
}

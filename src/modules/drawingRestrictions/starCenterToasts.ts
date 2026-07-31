import { t } from '../../core/l10n';
import { showToast } from '../../core/toast';

/**
 * Toast при назначении точки центром звезды. Формулировка с интерполяцией
 * имени повторяет CUI (`onPointPopupOpened` в refs/cui/index.js) - игроки,
 * пришедшие из CUI, узнают шаблон. Если имя точки получить не удалось
 * (карта ещё не захвачена, feature не загружен) - fallback на общий текст
 * без имени, чтобы не блокировать визуальное подтверждение действия.
 */
export function showCenterAssignedToast(pointTitle: string | null = null): void {
  const message =
    pointTitle !== null
      ? t({
          en: `Point "${pointTitle}" selected as star center for drawing.`,
          ru: `Точка "${pointTitle}" выбрана центром для рисования звезды.`,
        })
      : t({
          en: 'Point selected as star center for drawing.',
          ru: 'Точка выбрана центром для рисования звезды.',
        });
  showToast(message);
}

/** Toast при включении режима через toggle (попап-кнопка или map-toggle). */
export function showStarModeEnabledToast(pointTitle: string | null = null): void {
  const message =
    pointTitle !== null
      ? t({
          en: `Star mode enabled: ${pointTitle}`,
          ru: `Режим звезды включён: ${pointTitle}`,
        })
      : t({ en: 'Star mode enabled', ru: 'Режим звезды включён' });
  showToast(message);
}

/** Toast при выключении режима через toggle (попап-кнопка или map-toggle). */
export function showStarModeDisabledToast(pointTitle: string | null = null): void {
  const message =
    pointTitle !== null
      ? t({
          en: `Star mode disabled: ${pointTitle}`,
          ru: `Режим звезды выключен: ${pointTitle}`,
        })
      : t({ en: 'Star mode disabled', ru: 'Режим звезды выключен' });
  showToast(message);
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
    { type: 'error', duration: 4000 },
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
    { duration: 4000 },
  );
}

import { getDetectedVersion, SBG_COMPATIBLE_VERSIONS } from './gameVersion';

/**
 * Проверяет, что детектированная версия игры входит в список поддерживаемых.
 * Если нет — показывает confirm: OK — запустить SBG Vanilla+ на свой риск,
 * Отмена — продолжить без скрипта (пропустить bootstrap).
 *
 * Выбор намеренно не запоминаем: при каждой загрузке пользователь снова
 * увидит вопрос, пока версия не попадёт в SBG_COMPATIBLE_VERSIONS. Иначе
 * «отмена» похоронила бы скрипт до очистки storage — а отказ чаще всего
 * про «не сегодня», а не «никогда».
 *
 * Если версия не определилась (null), считаем совместимой — safe default.
 * Предупреждение про ненадёжный детект уже пишет getDetectedVersion.
 */
export function ensureSbgVersionSupported(): boolean {
  const detected = getDetectedVersion();
  if (detected === null) return true;
  if (SBG_COMPATIBLE_VERSIONS.includes(detected)) return true;

  const supported = SBG_COMPATIBLE_VERSIONS.join(', ');
  const message =
    `SBG Vanilla+ не тестировался на версии игры ${detected} (поддерживаются: ${supported}).\n\n` +
    `ОК — включить скрипт, Отмена — продолжить без скрипта.`;

  return confirm(message);
}

/**
 * Id слайса вынесен отдельно от drawingRestrictions.ts: его использует и
 * регистрация модуля, и префикс логов в drawFilter, а импорт самого модуля в
 * drawFilter замкнул бы цикл (drawingRestrictions -> drawFilter).
 */
export const MODULE_ID = 'drawingRestrictions';

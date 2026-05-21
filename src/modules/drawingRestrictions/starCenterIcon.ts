/**
 * Общая иконка для режима звезды - 8 лучей, исходящих из центральной точки.
 * Используется и в toggle-кнопке попапа, и в map-toggle (clear-control) на
 * карте. Один визуальный язык фичи: игрок видит одну и ту же иконку везде,
 * где речь про центр звезды. Активное/неактивное состояние выражается
 * исключительно цветом через CSS-класс `.is-active` на кнопке.
 */
export const STAR_ICON_SVG_INNER = `
  <circle cx="12" cy="12" r="2.5" fill="currentColor"/>
  <g stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none">
    <line x1="12" y1="2.5" x2="12" y2="7"/>
    <line x1="12" y1="17" x2="12" y2="21.5"/>
    <line x1="2.5" y1="12" x2="7" y2="12"/>
    <line x1="17" y1="12" x2="21.5" y2="12"/>
    <line x1="5.2" y1="5.2" x2="8.4" y2="8.4"/>
    <line x1="15.6" y1="15.6" x2="18.8" y2="18.8"/>
    <line x1="18.8" y1="5.2" x2="15.6" y2="8.4"/>
    <line x1="8.4" y1="15.6" x2="5.2" y2="18.8"/>
  </g>
`;

export const STAR_ICON_SVG = `
<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
  ${STAR_ICON_SVG_INNER}
</svg>
`;

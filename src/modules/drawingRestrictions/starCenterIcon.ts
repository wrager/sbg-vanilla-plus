/**
 * Общая иконка для режима звезды — 8 лучей, исходящих из центральной точки.
 * Используется и в toggle-кнопке попапа (назначить/снять центром), и в
 * clear-control на карте (с добавленным slash-перечёркиванием). Один визуальный
 * язык фичи: игрок видит одну и ту же иконку везде, где речь про центр звезды.
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

/**
 * Та же иконка, но с диагональным перечёркиванием — индикатор «сбросить центр».
 * Звезда окрашена в #ffcc33 (тот же жёлтый, что использует is-active toggle),
 * чтобы визуально напоминать: это центр звезды, который сейчас активен. Slash
 * рисуется поверх в currentColor (цвет кнопки — красноватый для сигнала отмены)
 * с тёмным outline для читаемости поверх лучей. Линия выходит за границы иконки
 * (от -2 до 26) и толще лучей (~5px для внутренней линии при 24-unit viewBox),
 * чтобы не путалась с лучом asterisk и читалась как отдельный элемент.
 *
 * Цвет звезды зашит через wrapper <g style="color: #ffcc33">: currentColor
 * внутри STAR_ICON_SVG_INNER разрешается в жёлтый, при этом слой slash снаружи
 * wrapper'а наследует color от кнопки (не жёлтый). Это позволяет общую
 * STAR_ICON_SVG_INNER константу оставить универсальной — разные раскраски
 * делаются через контекстный <g style>.
 */
export const STAR_ICON_SLASH_SVG = `
<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
  <g style="color: #ffcc33">
    ${STAR_ICON_SVG_INNER}
  </g>
  <line x1="-2" y1="26" x2="26" y2="-2" stroke="#000" stroke-width="7" stroke-linecap="round"/>
  <line x1="-2" y1="26" x2="26" y2="-2" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>
</svg>
`;

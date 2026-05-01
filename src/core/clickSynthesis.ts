/**
 * Polyfill для случаев, когда WebView/Chrome не синтезирует click event из
 * touch sequence на кнопке. Симптом: pointerdown/pointerup на кнопке fire
 * нормально (cancelable=true, defaultPrevented=false, button.disabled=false),
 * но синтетических mouseover/mousedown/mouseup/click событий browser не
 * генерирует, и click handler не срабатывает.
 *
 * Воспроизводится на кнопках попапа точки игры (#draw, #discover) после
 * вызова showInfo (refs/game/script.js:2084), который делает massive DOM
 * mutation burst (300+ событий: splide.refresh деплой-карусели, обновление
 * всех текстов попапа, layout shifts). В течение ~1.5-2 секунд после burst
 * браузер probabilistically пропускает синтез click. Pattern не
 * deterministic - зависит от sub-state, который из JS не наблюдаем.
 *
 * Симптом одинаковый и для нативного свайпа игры, и для тапа нашей кнопки -
 * оба триггерят showInfo и одинаковый mutation burst. Багфикс не привязан
 * к источнику тапа.
 *
 * Fix: на pointerup проверяем через ~80мс, fired ли click. Не fired -
 * dispatchEvent('click') вручную с теми же координатами. Игровой
 * $('#draw').on('click') обработает идентично - browser-synthesized и
 * manually-dispatched MouseEvent('click') неотличимы для handler.
 *
 * Защита от двойного срабатывания: per-pointerup флаг + временный
 * click-listener в capture phase. Click пришёл нативно - флаг true,
 * polyfill не диспатчит. Не пришёл - polyfill диспатчит. Listener
 * снимается после задержки, не накапливается.
 */

const TAP_MAX_DURATION_MS = 500;
const TAP_MAX_DISTANCE_PX = 10;
const SYNTHESIS_DELAY_MS = 80;

/**
 * Браузер не синтезирует `click` для tap по disabled-кнопке: dispatch event
 * блокируется на стадии активации формы. Наш polyfill через
 * `dispatchEvent('click')` этот блок обходит - игровой обработчик срабатывает
 * на залоченной кнопке (двойной deploy/discover, и т. п.). Здесь повторяем
 * native-поведение: на disabled-элементе синтетический click не диспатчим.
 *
 * `HTMLButtonElement.disabled` reflect-ит content attribute. Игра ставит
 * `prop('disabled', true)` (jQuery, синхронизирует attribute и property) и
 * `setAttribute('disabled', '')` на саму кнопку - оба пути ловятся через
 * property. Form-control-наследованный disabled (родительский
 * `<fieldset disabled>`) не покрывается - игра в попапе точки
 * (`refs/game/script.js`) не использует fieldset, поэтому защита не нужна.
 */
function isElementDisabled(element: HTMLElement): boolean {
  return (element as { disabled?: unknown }).disabled === true;
}

/**
 * Устанавливает click-fallback на элемент. Возвращает функцию для снятия.
 *
 * Listeners в capture-phase, чтобы наш click-detector видел click ДО других
 * handler-ов (включая случаи, когда кто-то stopPropagation в bubble phase).
 */
export function installClickFallback(element: HTMLElement): () => void {
  let downAt = 0;
  let downX = 0;
  let downY = 0;
  let downId: number | null = null;

  const onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch') return;
    downAt = event.timeStamp;
    downX = event.clientX;
    downY = event.clientY;
    downId = event.pointerId;
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch') return;
    if (event.pointerId !== downId) return;
    const duration = event.timeStamp - downAt;
    const distance = Math.hypot(event.clientX - downX, event.clientY - downY);
    if (duration > TAP_MAX_DURATION_MS || distance > TAP_MAX_DISTANCE_PX) return;
    // Pre-check: tap по уже-disabled кнопке - native бы не выпустил click,
    // и мы тоже не должны.
    if (isElementDisabled(element)) return;

    const x = event.clientX;
    const y = event.clientY;
    let clickFired = false;
    const onClick = (): void => {
      clickFired = true;
    };
    element.addEventListener('click', onClick, true);
    setTimeout(() => {
      element.removeEventListener('click', onClick, true);
      if (clickFired) return;
      // Между pointerup и тиком таймера state мог поменяться: нативный click
      // игры сработал синхронно и поставил `prop('disabled', true)` (см.
      // refs/game/script.js:882, 947, 987 для #deploy/#repair/#draw), или
      // игра асинхронно залочила кнопку через apiSend.then(). Повторно
      // проверяем перед диспатчем - иначе диспатчим click на залоченную и
      // вызываем дубль.
      if (isElementDisabled(element)) return;
      element.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: window,
          button: 0,
          clientX: x,
          clientY: y,
        }),
      );
    }, SYNTHESIS_DELAY_MS);
  };

  element.addEventListener('pointerdown', onPointerDown, true);
  element.addEventListener('pointerup', onPointerUp, true);

  return () => {
    element.removeEventListener('pointerdown', onPointerDown, true);
    element.removeEventListener('pointerup', onPointerUp, true);
  };
}

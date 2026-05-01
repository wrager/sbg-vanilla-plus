// Временный helper для диагностических alert'ов в бета-сборках. Используется
// модулями refsCounterSync, betterRefPopoverClosing и improvedPointText
// для вывода компактной диагностики на мобильных устройствах, где DevTools
// недоступен и нельзя посмотреть console.log.
//
// jsdom 20 + jest-environment-jsdom 29 не реализует window.alert и кидает
// `Error: Not implemented`. try/catch гарантирует, что прогон тестов модулей
// с диагностикой не падает.
//
// Когда диагностика выполнила свою задачу, удалить и helper, и его вызовы.
export function diagAlert(message: string): void {
  try {
    window.alert(message);
  } catch {
    // jsdom не реализует alert - игнорируем.
  }
}

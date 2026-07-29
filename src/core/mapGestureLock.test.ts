// Реестр захватов - состояние уровня модуля, общее для всех тестов файла.
// Без сброса тест, упавший с невыпущенным захватом, ронял бы следующие, и
// причина пряталась бы за чужим падением. Тот же приём - в olMap.test.ts.
beforeEach(() => {
  jest.resetModules();
});

describe('mapGestureLock', () => {
  test('no lock by default', async () => {
    const { isMapGestureLocked } = await import('./mapGestureLock');

    expect(isMapGestureLocked()).toBe(false);
  });

  test('lock holds until released', async () => {
    const { isMapGestureLocked, lockMapGesture } = await import('./mapGestureLock');
    const release = lockMapGesture();

    expect(isMapGestureLocked()).toBe(true);

    release();

    expect(isMapGestureLocked()).toBe(false);
  });

  test('releasing one lock keeps the gesture locked while another holds it', async () => {
    const { isMapGestureLocked, lockMapGesture } = await import('./mapGestureLock');
    const releaseFirst = lockMapGesture();
    const releaseSecond = lockMapGesture();

    releaseFirst();

    expect(isMapGestureLocked()).toBe(true);

    releaseSecond();

    expect(isMapGestureLocked()).toBe(false);
  });

  test('releasing twice does not drop a foreign lock', async () => {
    const { isMapGestureLocked, lockMapGesture } = await import('./mapGestureLock');
    const releaseFirst = lockMapGesture();
    const releaseSecond = lockMapGesture();

    releaseFirst();
    releaseFirst();

    expect(isMapGestureLocked()).toBe(true);

    releaseSecond();

    expect(isMapGestureLocked()).toBe(false);
  });

  test('leaves a lock behind, as a failing test would', async () => {
    const { isMapGestureLocked, lockMapGesture } = await import('./mapGestureLock');
    lockMapGesture();

    expect(isMapGestureLocked()).toBe(true);
  });

  test('the lock left by the previous test does not leak into this one', async () => {
    const { isMapGestureLocked } = await import('./mapGestureLock');

    expect(isMapGestureLocked()).toBe(false);
  });
});

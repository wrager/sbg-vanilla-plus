import { isMapGestureLocked, lockMapGesture } from './mapGestureLock';

describe('mapGestureLock', () => {
  test('no lock by default', () => {
    expect(isMapGestureLocked()).toBe(false);
  });

  test('lock holds until released', () => {
    const release = lockMapGesture();

    expect(isMapGestureLocked()).toBe(true);

    release();

    expect(isMapGestureLocked()).toBe(false);
  });

  test('releasing one lock keeps the gesture locked while another holds it', () => {
    const releaseFirst = lockMapGesture();
    const releaseSecond = lockMapGesture();

    releaseFirst();

    expect(isMapGestureLocked()).toBe(true);

    releaseSecond();

    expect(isMapGestureLocked()).toBe(false);
  });

  test('releasing twice does not drop a foreign lock', () => {
    const releaseFirst = lockMapGesture();
    const releaseSecond = lockMapGesture();

    releaseFirst();
    releaseFirst();

    expect(isMapGestureLocked()).toBe(true);

    releaseSecond();

    expect(isMapGestureLocked()).toBe(false);
  });
});

import {
  showCannotSetLockedCenterToast,
  showCenterAssignedToast,
  showCenterClearedBecauseLockedToast,
  showStarModeDisabledToast,
  showStarModeEnabledToast,
} from './starCenterToasts';

const showToastMock = jest.fn();
jest.mock('../../core/toast', () => ({
  showToast: (...args: unknown[]) => {
    showToastMock(...args);
  },
}));

function lastMessage(): string {
  const calls = showToastMock.mock.calls as unknown[][];
  const last = calls[calls.length - 1];
  const [first] = last;
  return typeof first === 'string' ? first : '';
}

beforeEach(() => {
  showToastMock.mockClear();
});

// l10n в тестах отдаёт en-вариант (jsdom navigator.language = 'en-US'),
// поэтому проверяем английские формулировки.

describe('showCenterAssignedToast', () => {
  test('без имени - общий текст', () => {
    showCenterAssignedToast();
    expect(lastMessage()).toBe('Point selected as star center for drawing.');
  });

  test('с именем - имя интерполируется в кавычках (стиль CUI)', () => {
    showCenterAssignedToast('Alpha');
    expect(lastMessage()).toBe('Point "Alpha" selected as star center for drawing.');
  });

  test('явный null - общий текст (fallback)', () => {
    showCenterAssignedToast(null);
    expect(lastMessage()).toBe('Point selected as star center for drawing.');
  });
});

describe('showStarModeEnabledToast', () => {
  test('без имени - общий текст', () => {
    showStarModeEnabledToast();
    expect(lastMessage()).toBe('Star mode enabled');
  });

  test('с именем - имя через двоеточие', () => {
    showStarModeEnabledToast('Alpha');
    expect(lastMessage()).toBe('Star mode enabled: Alpha');
  });
});

describe('showStarModeDisabledToast', () => {
  test('без имени - общий текст', () => {
    showStarModeDisabledToast();
    expect(lastMessage()).toBe('Star mode disabled');
  });

  test('с именем - имя через двоеточие', () => {
    showStarModeDisabledToast('Alpha');
    expect(lastMessage()).toBe('Star mode disabled: Alpha');
  });
});

describe('showCannotSetLockedCenterToast', () => {
  test('короткое сообщение про блокировку locked-точки как центра звезды', () => {
    showCannotSetLockedCenterToast();
    expect(lastMessage()).toBe("Locked point can't be a star center.");
  });
});

describe('showCenterClearedBecauseLockedToast', () => {
  test('сообщает о снятии центра с указанием причины', () => {
    showCenterClearedBecauseLockedToast();
    expect(lastMessage()).toBe('Star center cleared: the point is now locked.');
  });
});

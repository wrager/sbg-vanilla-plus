import {
  showCannotSetLockedCenterToast,
  showCenterAssignedToast,
  showCenterClearedToast,
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
  test('общий текст без имени точки', () => {
    showCenterAssignedToast();
    expect(showToastMock).toHaveBeenCalledTimes(1);
    expect(lastMessage()).toBe('Point selected as star center for drawing.');
  });
});

describe('showCenterClearedToast', () => {
  test('общий текст без имени точки', () => {
    showCenterClearedToast();
    expect(showToastMock).toHaveBeenCalledTimes(1);
    expect(lastMessage()).toBe('Star center cleared');
  });
});

describe('showCannotSetLockedCenterToast', () => {
  test('короткое сообщение про блокировку locked-точки как центра звезды', () => {
    showCannotSetLockedCenterToast();
    expect(showToastMock).toHaveBeenCalledTimes(1);
    expect(lastMessage()).toBe("Locked point can't be a star center.");
  });
});

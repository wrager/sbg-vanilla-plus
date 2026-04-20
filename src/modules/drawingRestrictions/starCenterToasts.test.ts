import { showCenterAssignedToast, showCenterClearedToast } from './starCenterToasts';

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
  test('пустое имя — общий текст без имени', () => {
    showCenterAssignedToast('');
    expect(showToastMock).toHaveBeenCalledTimes(1);
    const message = lastMessage();
    expect(message).toBe('Point selected as star center for drawing.');
  });

  test('заданное имя — текст с именем в кавычках', () => {
    showCenterAssignedToast('Alpha');
    expect(showToastMock).toHaveBeenCalledTimes(1);
    const message = lastMessage();
    expect(message).toBe('Point "Alpha" selected as star center for drawing.');
  });
});

describe('showCenterClearedToast', () => {
  test('пустое имя — общий текст без имени', () => {
    showCenterClearedToast('');
    expect(showToastMock).toHaveBeenCalledTimes(1);
    const message = lastMessage();
    expect(message).toBe('Star center cleared');
  });

  test('заданное имя — текст с двоеточием и именем', () => {
    showCenterClearedToast('Alpha');
    expect(showToastMock).toHaveBeenCalledTimes(1);
    const message = lastMessage();
    expect(message).toBe('Star center cleared: Alpha');
  });
});

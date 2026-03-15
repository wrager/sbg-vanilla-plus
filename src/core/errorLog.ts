const MAX_ENTRIES = 50;

export interface IErrorLogEntry {
  timestamp: number;
  level: 'error' | 'warn' | 'uncaught';
  message: string;
}

const entries: IErrorLogEntry[] = [];

function addEntry(level: IErrorLogEntry['level'], message: string): void {
  entries.push({ timestamp: Date.now(), level, message });
  if (entries.length > MAX_ENTRIES) {
    entries.shift();
  }
}

function formatArgs(args: unknown[]): string {
  return args
    .map((argument) => {
      if (argument instanceof Error) {
        return argument.stack ?? argument.message;
      }
      return String(argument);
    })
    .join(' ');
}

export function initErrorLog(): void {
  const originalError = console.error;
  const originalWarn = console.warn;

  console.error = (...args: unknown[]): void => {
    addEntry('error', formatArgs(args));
    originalError.apply(console, args);
  };

  console.warn = (...args: unknown[]): void => {
    addEntry('warn', formatArgs(args));
    originalWarn.apply(console, args);
  };

  window.addEventListener('error', (event: ErrorEvent) => {
    const message =
      event.error instanceof Error ? (event.error.stack ?? event.error.message) : event.message;
    addEntry('uncaught', message);
  });

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const reason: unknown = event.reason;
    const message = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
    addEntry('uncaught', message);
  });
}

export function getErrorLog(): readonly IErrorLogEntry[] {
  return entries;
}

export function clearErrorLog(): void {
  entries.length = 0;
}

export function formatErrorLog(): string {
  if (entries.length === 0) return '';

  return entries
    .map((entry) => {
      const time = new Date(entry.timestamp).toISOString();
      return `[${time}] [${entry.level}] ${entry.message}`;
    })
    .join('\n');
}

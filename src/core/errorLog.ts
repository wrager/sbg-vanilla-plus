const MAX_ENTRIES = 50;
const SVP_PREFIX = '[SVP]';

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

function isFromScript(args: unknown[]): boolean {
  const text = args.map(String).join(' ');
  if (text.includes(SVP_PREFIX)) return true;

  for (const argument of args) {
    if (argument instanceof Error && argument.stack) {
      if (argument.stack.includes('sbg-vanilla-plus')) return true;
    }
  }

  return false;
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
    if (isFromScript(args)) {
      addEntry('error', formatArgs(args));
    }
    originalError.apply(console, args);
  };

  console.warn = (...args: unknown[]): void => {
    if (isFromScript(args)) {
      addEntry('warn', formatArgs(args));
    }
    originalWarn.apply(console, args);
  };

  window.addEventListener('error', (event: ErrorEvent) => {
    const message =
      event.error instanceof Error ? (event.error.stack ?? event.error.message) : event.message;
    if (message.includes(SVP_PREFIX) || message.includes('sbg-vanilla-plus')) {
      addEntry('uncaught', message);
    }
  });

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const reason: unknown = event.reason;
    let message: string;
    if (reason instanceof Error) {
      message = reason.stack ?? reason.message;
    } else {
      message = String(reason);
    }
    if (message.includes(SVP_PREFIX) || message.includes('sbg-vanilla-plus')) {
      addEntry('uncaught', message);
    }
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

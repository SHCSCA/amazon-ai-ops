import { runtimeLogger, type RuntimeLogPort } from './runtime-logger';

export function createRuntimeLogAdapter(logger: RuntimeLogPort, source: string) {
  const write = (level: 'info' | 'warn' | 'error', values: unknown[]): void => {
    const [message, ...details] = values;
    logger[level](`${source}.message`, { message, ...(details.length ? { details } : {}) });
  };
  return Object.freeze({
    log: (...values: unknown[]) => write('info', values),
    info: (...values: unknown[]) => write('info', values),
    warn: (...values: unknown[]) => write('warn', values),
    error: (...values: unknown[]) => write('error', values),
  });
}

export const runtimeLog = createRuntimeLogAdapter(runtimeLogger, 'main');

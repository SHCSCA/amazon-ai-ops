import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { App, BrowserWindow } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installGlobalRuntimeErrorHandlers, installRendererProcessErrorHandler } from './runtime-error-handlers';
import { RuntimeLogger, runtimeLogger } from './runtime-logger';

const ownedDirectories: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of ownedDirectories.splice(0)) {
    const resolved = path.resolve(directory);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir())
      || !path.basename(resolved).startsWith('amazon-ai-ops-preload-log-')) throw new Error('拒绝清理非本测试目录。');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});

function rendererWindow(preload = 'G:\\private-user\\app\\dist\\preload\\index.js') {
  const contents = new EventEmitter();
  return { window: { id: 27, webContents: contents } as unknown as BrowserWindow, contents, preload };
}

describe('global runtime diagnostics', () => {
  it('observes uncaught exceptions and requests strict shutdown once for unhandled rejection', () => {
    const beforeMonitor = process.listeners('uncaughtExceptionMonitor');
    const beforeRejection = process.listeners('unhandledRejection');
    const previousExitCode = process.exitCode;
    const app = Object.assign(new EventEmitter(), { quit: vi.fn() });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    installGlobalRuntimeErrorHandlers(app as unknown as App, logger);
    const monitor = process.listeners('uncaughtExceptionMonitor').find((listener) => !beforeMonitor.includes(listener))!;
    const rejection = process.listeners('unhandledRejection').find((listener) => !beforeRejection.includes(listener))!;
    try {
      const failure = new Error('uncaught');
      monitor(failure, 'uncaughtException');
      expect(logger.error).toHaveBeenCalledWith('runtime.uncaught_exception', { error: failure, origin: 'uncaughtException' });
      expect(app.quit).not.toHaveBeenCalled();
      rejection(failure, Promise.resolve());
      rejection(failure, Promise.resolve());
      expect(app.quit).toHaveBeenCalledTimes(1);
      expect(process.exitCode).toBe(1);
      app.emit('child-process-gone', {}, { type: 'Utility', reason: 'crashed' });
      expect(logger.error).toHaveBeenCalledWith('electron.child_process_gone', { details: { type: 'Utility', reason: 'crashed' } });
    } finally {
      process.removeListener('uncaughtExceptionMonitor', monitor);
      process.removeListener('unhandledRejection', rejection);
      process.exitCode = previousExitCode;
    }
  });

  it('wires the actual Electron preload-error event and preserves renderer-process diagnostics', () => {
    const test = rendererWindow(); const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    installRendererProcessErrorHandler(test.window, logger, test.preload);
    test.contents.emit('preload-error', {}, test.preload, new Error('Cannot find module: node:crypto'));
    expect(logger.error).toHaveBeenCalledWith('electron.preload_error', expect.objectContaining({
      windowId: 27, configuredPreloadPath: expect.stringMatching(/^\[path:[a-f0-9]{20}\]$/),
      reportedPreloadMatchesConfigured: true, error: expect.objectContaining({ message: 'Cannot find module: node:crypto' }),
    }));
    const details = { reason: 'crashed', exitCode: 7 };
    test.contents.emit('render-process-gone', {}, details);
    expect(logger.error).toHaveBeenCalledWith('electron.renderer_process_gone', { windowId: 27, details });
  });

  it('persists redacted preload errors through the production RuntimeLogger without recording arbitrary event paths', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-preload-log-'));
    ownedDirectories.push(directory);
    const logger = new RuntimeLogger({ write: () => {} }); logger.setOutputDirectory(directory);
    const test = rendererWindow(); installRendererProcessErrorHandler(test.window, logger, test.preload);
    const error = Object.assign(new Error('Cannot find module: node:crypto password=credential-secret'), {
      cause: { apiKey: 'sk-private-material-12345' },
    });
    test.contents.emit('preload-error', {}, 'G:\\untrusted-event-path\\private.js', error);
    const file = fs.readdirSync(directory).find(name => name.endsWith('.jsonl'))!;
    const text = fs.readFileSync(path.join(directory, file), 'utf8');
    const record = JSON.parse(text.trim());
    expect(record.event).toBe('electron.preload_error'); expect(record.level).toBe('error');
    expect(record.context.windowId).toBe(27); expect(record.context.reportedPreloadMatchesConfigured).toBe(false);
    expect(record.context.error.message).toContain('node:crypto');
    for (const value of ['credential-secret', 'sk-private-material-12345', 'private-user', 'untrusted-event-path']) {
      expect(text).not.toContain(value);
    }
  });

  it('does not propagate a diagnostic port failure or replace the original preload error', () => {
    const test = rendererWindow(); const reportingError = new Error('password=logger-secret');
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(() => { throw reportingError; }) };
    const fallback = vi.spyOn(runtimeLogger, 'error').mockImplementation(() => {});
    installRendererProcessErrorHandler(test.window, logger, test.preload);
    expect(() => test.contents.emit('preload-error', {}, test.preload, new Error('original preload module failed'))).not.toThrow();
    expect(fallback).toHaveBeenCalledWith('electron.preload_diagnostic_delivery_failed', expect.objectContaining({
      error: expect.objectContaining({ message: 'original preload module failed' }),
      reportingError: expect.objectContaining({ message: 'password=[REDACTED]' }),
    }));
    expect(JSON.stringify(fallback.mock.calls)).not.toContain('logger-secret');
  });

  it('retains the preload error without accepting an unbound event path as configured authority', () => {
    const test = rendererWindow(); const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    installRendererProcessErrorHandler(test.window, logger);
    expect(() => test.contents.emit('preload-error', {}, test.preload, new Error('preload module failed'))).not.toThrow();
    expect(logger.error).toHaveBeenCalledWith('electron.preload_error', expect.objectContaining({
      configuredPreloadPath: 'UNAVAILABLE', error: expect.objectContaining({ message: 'preload module failed' }),
      reportedPreloadMatchesConfigured: false,
    }));
  });

  it('removes the preload listener with the owning webContents lifecycle', () => {
    const test = rendererWindow(); const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    installRendererProcessErrorHandler(test.window, logger, test.preload);
    expect(test.contents.listenerCount('preload-error')).toBe(1);
    test.contents.emit('destroyed'); expect(test.contents.listenerCount('preload-error')).toBe(0);
    test.contents.emit('preload-error', {}, test.preload, new Error('late event'));
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('injects the Main configured preload path before renderer loading begins', () => {
    const source = fs.readFileSync(path.join(__dirname, 'desktop-window.ts'), 'utf8');
    const wiring = 'installRendererProcessErrorHandler(createdWindow, runtimeLogger, runtime.preloadPath);';
    expect(source).toContain(wiring);
    expect(source.indexOf(wiring)).toBeLessThan(source.indexOf('createdWindow.loadURL('));
    expect(source.indexOf(wiring)).toBeLessThan(source.indexOf('createdWindow.loadFile('));
  });
});

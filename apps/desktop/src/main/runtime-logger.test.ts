import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { RuntimeLogger } from './runtime-logger';
import { createRuntimeLogAdapter } from './runtime-log-adapter';

describe('RuntimeLogger', () => {
  it('writes redacted UTC JSON lines to disk and preserves the launch marker protocol', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'amazon-runtime-log-'));
    const write = vi.fn();
    try {
      const logger = new RuntimeLogger({ now: () => new Date('2026-10-15T01:02:03Z'), write });
      logger.setOutputDirectory(directory);
      const adapter = createRuntimeLogAdapter(logger, 'main');
      adapter.info('[App] window-created', {
        apiKey: 'test-secret-key', nested: { password: 'test-password' },
        header: 'Authorization: Bearer test-bearer-secret',
        serialized: '{"ai_api_key":"test-json-secret"}',
      });
      const disk = readFileSync(path.join(directory, 'runtime-2026-10-15.jsonl'), 'utf8');
      expect(disk).toBe(write.mock.calls[0][1]);
      expect(disk).toContain('[App] window-created');
      for (const secret of ['test-secret-key', 'test-password', 'test-bearer-secret', 'test-json-secret']) {
        expect(disk).not.toContain(secret);
      }
      const record = JSON.parse(disk);
      expect(record).toMatchObject({ timestamp: '2026-10-15T01:02:03.000Z', level: 'info', event: 'main.message' });
      expect(record.context.details[0].apiKey).toBe('[REDACTED]');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('preserves the original exception in the stream when the file sink fails', () => {
    const write = vi.fn();
    const logger = new RuntimeLogger({ write, append: () => { throw new Error('disk full'); } });
    logger.setOutputDirectory('unused');
    logger.error('execution.failed', { error: new Error('original execution error') });
    const records = write.mock.calls.map((call) => JSON.parse(call[1]));
    expect(records[0]).toMatchObject({ event: 'execution.failed', context: { error: { message: 'original execution error' } } });
    expect(records[1]).toMatchObject({ event: 'runtime.logger_write_failed', context: { fileError: { message: 'disk full' } } });
  });

  it('retains the original record and a diagnostic in the file if the stream fails', () => {
    const append = vi.fn();
    const fallback = vi.fn();
    const logger = new RuntimeLogger({ append, fallback, write: () => { throw new Error('pipe closed'); } });
    logger.setOutputDirectory('unused');
    logger.warn('collection.interrupted', { reason: 'network' });
    expect(JSON.parse(append.mock.calls[0][2]).event).toBe('collection.interrupted');
    expect(JSON.parse(append.mock.calls[1][2]).event).toBe('runtime.logger_write_failed');
    expect(JSON.parse(fallback.mock.calls[0][0]).event).toBe('collection.interrupted');
  });

  it('contains all sink failures without replacing the business error or exit code', () => {
    const previousExitCode = process.exitCode;
    const fail = () => { throw new Error('sink unavailable'); };
    const logger = new RuntimeLogger({ append: fail, write: fail, fallback: fail });
    logger.setOutputDirectory('unused');
    expect(() => logger.error('business.failed', { error: new Error('business') })).not.toThrow();
    expect(process.exitCode).toBe(previousExitCode);
  });

  it('contains cyclic, deep and unreadable values while preserving error codes', () => {
    const write = vi.fn();
    const logger = new RuntimeLogger({ write });
    const context: Record<string, unknown> = { count: 42n };
    context.self = context;
    Object.defineProperty(context, 'bad', { enumerable: true, get: () => { throw new Error('getter'); } });
    let nested = context;
    for (let index = 0; index < 20; index++) {
      nested.child = {};
      nested = nested.child as Record<string, unknown>;
    }
    context.error = Object.assign(new Error('request failed'), { code: 'RETRY_REQUIRED' });
    expect(() => logger.error('payload.failed', context)).not.toThrow();
    const record = JSON.parse(write.mock.calls[0][1]);
    expect(record.context).toMatchObject({ count: '42', self: '[Circular]', bad: '[Unreadable]', error: { code: 'RETRY_REQUIRED' } });
    expect(write.mock.calls[0][1]).toContain('[DepthLimit]');
  });

  it('contains record encoding and clock failures without exposing the rejected input', () => {
    const write = vi.fn();
    const logger = new RuntimeLogger({ write, now: () => { throw new Error('clock failed'); } });
    expect(() => logger.info('invalid event', { password: 'private-value' })).not.toThrow();
    expect(JSON.parse(write.mock.calls[0][1])).toMatchObject({
      level: 'error', event: 'runtime.log_encoding_failed', context: { error: { message: 'clock failed' } },
    });
    expect(write.mock.calls[0][1]).not.toContain('private-value');
  });
});

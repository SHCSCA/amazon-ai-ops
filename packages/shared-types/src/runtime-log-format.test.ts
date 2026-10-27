import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createRuntimeLogRecord, sanitizeRuntimeLogValue } from './runtime-log-format.cjs';

describe('shared runtime log format', () => {
  it('keeps one UTC envelope across Main, Renderer and scripts', () => {
    expect(createRuntimeLogRecord('warn', 'runtime.example', { count: 2 }, new Date('2026-10-16T10:00:00Z')))
      .toEqual({ timestamp: '2026-10-16T10:00:00.000Z', level: 'warn', event: 'runtime.example', context: { count: 2 } });
  });

  it('redacts credentials and nested error causes before serialization', () => {
    const error = Object.assign(new Error('api_key=test-secret'), { cause: new Error('password=test-password'), code: 'FAILED' });
    const value = createRuntimeLogRecord('error', 'runtime.failed', { error, token: 'test-token', nested: { cookie: 'test-cookie' } });
    const encoded = JSON.stringify(value);
    for (const secret of ['test-secret', 'test-password', 'test-token', 'test-cookie']) expect(encoded).not.toContain(secret);
    expect(value.context?.token).toBe('[REDACTED]');
    expect(value.context?.error).toMatchObject({ code: 'FAILED' });
  });

  it('contains cyclic and unreadable values without losing the remaining facts', () => {
    const value: Record<string, unknown> = { amount: 42n };
    value.self = value;
    Object.defineProperty(value, 'unreadable', { enumerable: true, get: () => { throw new Error('unavailable'); } });
    expect(sanitizeRuntimeLogValue(value)).toMatchObject({ amount: '42', self: '[Circular]', unreadable: '[Unreadable]' });
  });

  it('retains every bounded aggregate failure while redacting nested credentials', () => {
    const error = new AggregateError([
      Object.assign(new Error('readiness output unavailable'), { code: 'EISDIR' }),
      new Error('password=aggregate-secret'),
    ], 'publication invalidation failed');
    const safe = sanitizeRuntimeLogValue(error);
    expect(safe).toMatchObject({ errors: [{ code: 'EISDIR' }, { message: 'password=[REDACTED]' }] });
    expect(JSON.stringify(safe)).not.toContain('aggregate-secret');
    expect((sanitizeRuntimeLogValue(new AggregateError(Array(150).fill(new Error('failed')))) as { errors: unknown[] }).errors).toHaveLength(100);
  });

  it('bounds wide nested context as well as individual arrays', () => {
    const values = Array.from({ length: 100 }, () => Array.from({ length: 100 }, () => 'value'));
    expect(JSON.stringify(sanitizeRuntimeLogValue(values))).toContain('[EntryLimit]');
    expect((sanitizeRuntimeLogValue(Array(150).fill(1)) as unknown[]).length).toBe(100);
  });

  it('rejects invalid event and level contracts', () => {
    expect(() => createRuntimeLogRecord('error', 'unsafe\nevent')).toThrow('事件无效');
    expect(() => createRuntimeLogRecord('debug' as 'info', 'runtime.example')).toThrow('级别无效');
  });

  it('uses stable cryptographic aliases for store profile job and import identifiers', () => {
    const hash = (category: string, value: string) => `[${category}:${createHash('sha256').update(`runtime-log/${category}/${value}`).digest('hex').slice(0, 20)}]`;
    const context = { storeId: 'real-store-a', store_id: 'real-store-a', browserProfileId: 'real-profile-a',
      jobIds: ['real-job-a', 'real-job-b'], importRunId: 'real-import-a', importId: 'real-import-a', requestId: 12345, nonce: 'private-nonce' };
    const safe = sanitizeRuntimeLogValue(context);
    expect(safe).toEqual({ storeId: hash('store', context.storeId), store_id: hash('store', context.storeId),
      browserProfileId: hash('profile', context.browserProfileId), jobIds: context.jobIds.map(value => hash('job', value)),
      importRunId: hash('import', context.importRunId), importId: hash('import', context.importId),
      requestId: hash('request', '12345'), nonce: hash('nonce', context.nonce) });
    expect(sanitizeRuntimeLogValue(safe)).toEqual(safe);
    expect(sanitizeRuntimeLogValue(context)).toEqual(safe);
    for (const raw of [context.storeId, context.browserProfileId, ...context.jobIds, context.importId, context.nonce]) {
      expect(JSON.stringify(safe)).not.toContain(raw);
    }
  });

  it('redacts free text identities credentials and absolute diagnostic paths', () => {
    const error = Object.assign(new Error('storeId=real-store-a, job real-job-a; importRunId="real-import-a"'), { code: 'EIO',
      cause: new Error('unable to read C:\\Users\\Operator Name\\store-data\\authority.db'),
      stack: 'Error: failed\n at run (G:\\AI\\amazon-ai-ops\\apps\\desktop\\main.js:1:2)\n at /home/operator/private/app.js:8:3\n at \\\\server\\private-share\\profile.db',
    });
    const safe = sanitizeRuntimeLogValue({ error, sessionId: 'session-secret', private_key: 'private-key',
      bearer: 'Bearer private-access-token', api: 'sk-realprivatekey12345', jwt: 'abcdefghijklm.nopqrstuvwxyz.abcdefghijklm',
      endpoint: 'https://username:real-password@example.test/path' });
    const encoded = JSON.stringify(safe);
    for (const raw of ['real-store-a', 'real-job-a', 'real-import-a', 'Operator Name', 'amazon-ai-ops', '/home/operator', 'private-share',
      'session-secret', 'private-key', 'private-access-token', 'sk-realprivatekey12345', 'abcdefghijklm.nopqrstuvwxyz', 'real-password']) {
      expect(encoded).not.toContain(raw);
    }
    expect(encoded).toContain('[path:');
    expect(safe).toMatchObject({ error: { name: 'Error', code: 'EIO', cause: { name: 'Error' } } });
    expect(sanitizeRuntimeLogValue(safe)).toEqual(safe);
  });

  it('bounds the complete serialized context for the fixed IPC envelope', () => {
    const context = Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`key-${index}-${'x'.repeat(9000)}`, 'y'.repeat(9000)]));
    const encoded = JSON.stringify(createRuntimeLogRecord('error', 'runtime.large', context));
    expect(encoded.length).toBeLessThan(64_000);
    expect(encoded).toContain('[TextLimit]');
    expect(JSON.stringify(sanitizeRuntimeLogValue({ children: Array(100).fill(context) })).length).toBeLessThan(64_000);
    for (const text of ['中'.repeat(9000), '\u0001'.repeat(9000), '😀'.repeat(9000), '\ud800'.repeat(9000)]) {
      const wide = Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`field${index}`, text]));
      expect(Buffer.byteLength(JSON.stringify(createRuntimeLogRecord('error', 'runtime.large', wide)))).toBeLessThan(64_000);
    }
  });
});

import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { appendRetainedRuntimeLog } from './runtime-log-files';
import { captureRuntimeLogRetention } from './runtime-log-policy';
import { RuntimeLogger } from './runtime-logger';

function withDirectory(work: (directory: string) => void): void {
  const directory = fs.mkdtempSync(path.join(tmpdir(), 'amazon-runtime-retention-'));
  try { work(directory); } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

const smallPolicy = Object.freeze({ maxFileBytes: 8, maxTotalBytes: 24, maxFiles: 3, retainDays: 2 });

describe('runtime log retention', () => {
  it('captures and validates a frozen retention configuration', () => {
    const input = { ...smallPolicy, maxFiles: Number(smallPolicy.maxFiles) };
    const policy = captureRuntimeLogRetention(input);
    input.maxFiles = 100;
    expect(policy.maxFiles).toBe(3);
    expect(Object.isFrozen(policy)).toBe(true);
    for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => captureRuntimeLogRetention({ ...smallPolicy, maxFiles: value })).toThrow();
    }
    expect(() => captureRuntimeLogRetention({ ...smallPolicy, maxTotalBytes: 7 })).toThrow();
  });

  it('rotates by UTF-8 byte size without rewriting existing segments', () => withDirectory(directory => {
    appendRetainedRuntimeLog(directory, '2026-10-16', '中文\n', smallPolicy);
    appendRetainedRuntimeLog(directory, '2026-10-16', 'ab\n', smallPolicy);
    appendRetainedRuntimeLog(directory, '2026-10-16', 'cd\n', smallPolicy);
    expect(fs.readFileSync(path.join(directory, 'runtime-2026-10-16.jsonl'), 'utf8')).toBe('中文\n');
    expect(fs.readFileSync(path.join(directory, 'runtime-2026-10-16.000001.jsonl'), 'utf8')).toBe('ab\ncd\n');
  }));

  it('removes expired owned logs and preserves unknown files and recent segments', () => withDirectory(directory => {
    for (const [date, content] of [['2026-10-14', 'old'], ['2026-10-15', 'recent']]) {
      fs.writeFileSync(path.join(directory, `runtime-${date}.jsonl`), content);
    }
    fs.writeFileSync(path.join(directory, 'report-evidence.json'), 'preserve');
    fs.writeFileSync(path.join(directory, 'runtime-2026-10-14.backup.jsonl'), 'preserve');
    appendRetainedRuntimeLog(directory, '2026-10-16', 'new\n', smallPolicy);
    expect(fs.existsSync(path.join(directory, 'runtime-2026-10-14.jsonl'))).toBe(false);
    expect(fs.readFileSync(path.join(directory, 'runtime-2026-10-15.jsonl'), 'utf8')).toBe('recent');
    expect(fs.readFileSync(path.join(directory, 'report-evidence.json'), 'utf8')).toBe('preserve');
    expect(fs.readFileSync(path.join(directory, 'runtime-2026-10-14.backup.jsonl'), 'utf8')).toBe('preserve');
  }));

  it('enforces total byte and file budgets oldest first, including the next write', () => withDirectory(directory => {
    const policy = { ...smallPolicy, retainDays: 20, maxFiles: 2, maxTotalBytes: 14 };
    appendRetainedRuntimeLog(directory, '2026-10-14', '1234567\n', policy);
    appendRetainedRuntimeLog(directory, '2026-10-15', '12345\n', policy);
    appendRetainedRuntimeLog(directory, '2026-10-16', '12345\n', policy);
    expect(fs.readdirSync(directory)).toEqual(['runtime-2026-10-15.jsonl', 'runtime-2026-10-16.jsonl']);
    expect(fs.readdirSync(directory).reduce((total, file) => total + fs.statSync(path.join(directory, file)).size, 0)).toBe(12);
  }));

  it('resumes the latest same-day segment across restart', () => withDirectory(directory => {
    fs.writeFileSync(path.join(directory, 'runtime-2026-10-16.jsonl'), '12345678');
    fs.writeFileSync(path.join(directory, 'runtime-2026-10-16.000003.jsonl'), 'abc');
    appendRetainedRuntimeLog(directory, '2026-10-16', 'def', smallPolicy);
    expect(fs.readFileSync(path.join(directory, 'runtime-2026-10-16.000003.jsonl'), 'utf8')).toBe('abcdef');
    expect(fs.readdirSync(directory)).toHaveLength(2);
  }));

  it('rejects oversized records and invalid dates before modifying a directory', () => withDirectory(directory => {
    expect(() => appendRetainedRuntimeLog(directory, '2026-10-16', '123456789', smallPolicy)).toThrow(/上限/);
    expect(() => appendRetainedRuntimeLog(directory, '2026-02-30', 'ok', smallPolicy)).toThrow(/日期/);
    expect(fs.readdirSync(directory)).toEqual([]);
  }));

  it('refuses linked directories and owned linked entries without touching the target', () => withDirectory(directory => {
    const external = path.join(directory, 'external');
    fs.mkdirSync(external);
    fs.writeFileSync(path.join(external, 'keep.txt'), 'safe');
    const linkedDirectory = path.join(directory, 'linked');
    fs.symlinkSync(external, linkedDirectory, process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => appendRetainedRuntimeLog(linkedDirectory, '2026-10-16', 'ok', smallPolicy)).toThrow(/目录/);
    const owned = path.join(directory, 'runtime-2026-10-14.jsonl');
    fs.symlinkSync(external, owned, process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => appendRetainedRuntimeLog(directory, '2026-10-16', 'ok', smallPolicy)).toThrow(/普通文件/);
    expect(fs.readFileSync(path.join(external, 'keep.txt'), 'utf8')).toBe('safe');
    expect(fs.existsSync(owned)).toBe(true);
  }));

  it('reports file maintenance failures through the remaining structured logger sink', () => withDirectory(directory => {
    fs.mkdirSync(path.join(directory, 'runtime-2026-10-14.jsonl'));
    const records: Array<{ event: string }> = [];
    const logger = new RuntimeLogger({ now: () => new Date('2026-10-16'), write: (_level, line) => { records.push(JSON.parse(line)); } });
    logger.setOutputDirectory(directory);
    expect(() => logger.error('business.failed', { reason: 'original' })).not.toThrow();
    expect(records.map(record => record.event)).toEqual(['business.failed', 'runtime.logger_write_failed']);
  }));
});

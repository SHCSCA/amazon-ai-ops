import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureReportSource, assertReportSourceCurrent } from './report-parser-source';

const directories: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  for (const directory of directories.splice(0)) {
    if (path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir())) throw new Error('TEST_DIRECTORY_NOT_OWNED');
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'report-source-')); directories.push(directory);
  const file = path.join(directory, 'source.csv'); fs.writeFileSync(file, 'same-size');
  return { directory, file };
}
describe('bounded Main report source snapshot', () => {
  it('提交前真实文件回读只使用固定流式缓冲，并核验完整字节哈希', () => {
    const { file } = fixture(); fs.writeFileSync(file, Buffer.alloc(200_000, 65));
    const source = captureReportSource(file, 300_000), read = fs.readSync, buffers: number[] = [];
    vi.spyOn(fs, 'readSync').mockImplementation(((...args: any[]) => {
      buffers.push(args[1].byteLength); return Reflect.apply(read, fs, args);
    }) as typeof fs.readSync);
    syncBuiltinESMExports();
    assertReportSourceCurrent(source, 300_000);
    expect(buffers.length).toBeGreaterThan(3); expect(Math.max(...buffers)).toBeLessThanOrEqual(64 * 1024);
    expect(source.bytes.byteLength).toBe(200_000);
  });
  it('holds original requested path, exact opened identity and SHA across a stable read', () => {
    const { file } = fixture(), source = captureReportSource(file, 1024);
    expect(source.requestedPath).toBe(path.resolve(file));
    expect(source.sizeBytes).toBe(9); expect(source.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(() => assertReportSourceCurrent(source, 1024)).not.toThrow();
  });
  it('rejects equal-size content replacement and renamed replacement before commit', () => {
    const { directory, file } = fixture(), source = captureReportSource(file, 1024);
    fs.writeFileSync(file, 'new-bytes');
    expect(() => assertReportSourceCurrent(source, 1024)).toThrow('REPORT_SOURCE_CHANGED_BEFORE_COMMIT');
    fs.renameSync(file, path.join(directory, 'prior.csv')); fs.writeFileSync(file, 'same-size');
    expect(() => assertReportSourceCurrent(source, 1024)).toThrow('REPORT_SOURCE_CHANGED_BEFORE_COMMIT');
  });
  it('rejects an alias parent retargeted while the old canonical file remains unchanged', () => {
    const { directory } = fixture();
    const first = path.join(directory, 'first'), second = path.join(directory, 'second');
    fs.mkdirSync(first); fs.mkdirSync(second);
    fs.writeFileSync(path.join(first, 'report.csv'), 'same'); fs.writeFileSync(path.join(second, 'report.csv'), 'same');
    const alias = path.join(directory, 'alias'); fs.symlinkSync(first, alias, 'junction');
    const source = captureReportSource(path.join(alias, 'report.csv'), 1024);
    fs.renameSync(alias, path.join(directory, 'old-alias')); fs.symlinkSync(second, alias, 'junction');
    expect(fs.readFileSync(source.path, 'utf8')).toBe('same');
    expect(() => assertReportSourceCurrent(source, 1024)).toThrow('REPORT_SOURCE_CHANGED_BEFORE_COMMIT');
  });
  it('rejects oversize sources before allocation and multiple-link source identities', () => {
    const { directory, file } = fixture();
    expect(() => captureReportSource(file, 8)).toThrow('REPORT_SOURCE_SIZE_OR_TYPE_INVALID');
    fs.linkSync(file, path.join(directory, 'hardlink.csv'));
    expect(() => captureReportSource(file, 1024)).toThrow('REPORT_SOURCE_SIZE_OR_TYPE_INVALID');
  });
});

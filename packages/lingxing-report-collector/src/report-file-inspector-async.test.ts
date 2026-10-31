import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inspectReportRowsContent } from './report-file-inspector';
import { verifyDownloadedFileAsync } from './file-verifier';
import type { DownloadedFileVerificationOptions } from './file-verifier';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    if (path.dirname(directory) !== path.resolve(os.tmpdir())) throw new Error('拒绝清理非隔离测试目录。');
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
function fixture(): string {
  const directory = fs.mkdtempSync(path.join(path.resolve(os.tmpdir()), 'isolated-collector-preflight-')); directories.push(directory);
  const file = path.join(directory, 'keyword.csv'); fs.writeFileSync(file, 'date,campaign,keyword,cost\n2026-10-01,isolated,isolated,1\n');
  return file;
}
const inspection = () => inspectReportRowsContent([['日期', '广告活动', '广告组', '关键词', '花费'], ['2026-10-01', 'isolated', 'isolated', 'isolated', 1]], 'keyword');
describe('采集预检必须等待显式异步端口', () => {
  it('异步期间调用方改写 options 不能改变校验条件', async () => {
    const file = fixture();
    const options: DownloadedFileVerificationOptions = { minBytes: 1, expectedReportType: 'keyword', expectedDownloadDir: path.dirname(file) };
    const result = await verifyDownloadedFileAsync(file, options, async (_file, type) => {
      options.expectedReportType = 'campaign'; options.expectedDownloadDir = path.join(path.dirname(file), 'missing');
      expect(type).toBe('keyword'); return inspection();
    });
    expect(result.valid).toBe(true);
  });
  it('保留不序列化的预检首错，日志失败也不能覆盖它', async () => {
    const file = fixture(), primary = new Error('isolated preflight failure'), logging = new Error('isolated logging failure');
    const result = await verifyDownloadedFileAsync(file, { minBytes: 1, expectedReportType: 'keyword' }, async () => { throw primary; });
    expect(result.valid).toBe(false); expect(result.failure).toBe(primary); expect(JSON.stringify(result)).not.toContain('isolated preflight failure');
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { throw logging; });
    try {
      let failure: any;
      try { await verifyDownloadedFileAsync(file, { minBytes: 1, expectedReportType: 'keyword' }, async () => { throw primary; }); }
      catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(AggregateError); expect(failure.cause).toBe(primary); expect(failure.errors).toEqual([primary, logging]);
    } finally { consoleSpy.mockRestore(); }
  });
  it('没有端口时拒绝，不能回退同步解析', async () => {
    expect(await verifyDownloadedFileAsync(fixture(), { minBytes: 1, expectedReportType: 'keyword' }, undefined as never)).toMatchObject({ valid: false });
  });
  it('异步解析期间变化的文件不能成为下载完成证据', async () => {
    const file = fixture(), inspect = vi.fn(async () => { await Promise.resolve(); fs.appendFileSync(file, 'changed'); return inspection(); });
    expect(await verifyDownloadedFileAsync(file, { minBytes: 1, expectedReportType: 'keyword' }, inspect)).toMatchObject({ valid: false });
    expect(inspect).toHaveBeenCalledTimes(1);
  });
  it('实际大小不匹配时在异步解析前拒绝', async () => {
    const file = fixture(), inspect = vi.fn(async () => inspection());
    expect(await verifyDownloadedFileAsync(file, { minBytes: 1, expectedReportType: 'keyword', expectedFileSizeBytes: 1 }, inspect)).toMatchObject({ valid: false });
    expect(inspect).not.toHaveBeenCalled();
  });
  it('真正等待异步结果并完整核验原路径元数据', async () => {
    const file = fixture(); let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; }); let completed = false;
    const operation = verifyDownloadedFileAsync(file, { minBytes: 1, expectedReportType: 'keyword' }, async () => { await pending; return inspection(); })
      .then(result => { completed = true; return result; });
    await Promise.resolve(); expect(completed).toBe(false); finish();
    expect(await operation).toMatchObject({ valid: true, fileSizeBytes: fs.statSync(file).size });
  });
});

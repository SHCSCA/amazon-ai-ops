import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type { ReportParserFile } from './report-parser-worker-contracts';
import { logReportParserFailure } from './report-parser-errors';

export interface ReportSourceSnapshot extends ReportParserFile { path: string; requestedPath: string; version: string; sizeBytes: number }
function version(stat: fs.BigIntStats): string {
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(String).join(':');
}
const HASH_CHUNK_BYTES = 64 * 1024;
function readSource(filePath: string, maxInputBytes: number, retainBytes: boolean): ReportSourceSnapshot {
  let handle: number | undefined;
  let failure: unknown;
  try {
    const requestedPath = path.resolve(filePath);
    const absolute = fs.realpathSync.native(requestedPath);
    const stat = fs.lstatSync(absolute, { bigint: true });
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || stat.size < 1 || stat.size > maxInputBytes) throw new Error('REPORT_SOURCE_SIZE_OR_TYPE_INVALID');
    handle = fs.openSync(absolute, 'r');
    const opened = fs.fstatSync(handle, { bigint: true });
    if (opened.nlink !== 1n || version(opened) !== version(stat)) throw new Error('REPORT_SOURCE_OPEN_CHANGED');
    // 按预检大小读取，增长的文件不能使 readFileSync 分配无界内存。
    const sizeBytes = Number(stat.size), hash = createHash('sha256');
    const bytes = new Uint8Array(retainBytes ? sizeBytes : Math.min(sizeBytes, HASH_CHUNK_BYTES));
    let offset = 0;
    while (offset < sizeBytes) {
      const start = retainBytes ? offset : 0;
      const read = fs.readSync(handle, bytes, start, Math.min(sizeBytes - offset, bytes.length - start), null);
      if (!read) throw new Error('REPORT_SOURCE_TRUNCATED');
      hash.update(bytes.subarray(start, start + read));
      offset += read;
    }
    const extra = new Uint8Array(1);
    const grew = fs.readSync(handle, extra, 0, 1, null) !== 0;
    const after = fs.fstatSync(handle, { bigint: true }), current = fs.statSync(absolute, { bigint: true });
    if (grew || after.nlink !== 1n || current.nlink !== 1n || version(after) !== version(stat)
      || version(current) !== version(stat)
      || fs.realpathSync.native(requestedPath) !== absolute) throw new Error('REPORT_SOURCE_READ_CHANGED');
    return { path: absolute, requestedPath, sourceName: absolute, bytes: retainBytes ? bytes : new Uint8Array(),
      sha256: hash.digest('hex'), version: version(stat), sizeBytes };
  } catch (error) {
    failure = logReportParserFailure('report_parser.source_capture_failed', error); throw failure;
  } finally {
    if (handle !== undefined) {
      try { fs.closeSync(handle); }
      catch (error) {
        const closeFailure = logReportParserFailure('report_parser.source_close_failed', error);
        if (failure) throw new AggregateError([failure, closeFailure], 'REPORT_SOURCE_READ_AND_CLOSE_FAILED');
        throw closeFailure;
      }
    }
  }
}
export function captureReportSource(filePath: string, maxInputBytes: number): ReportSourceSnapshot {
  return readSource(filePath, maxInputBytes, true);
}
export function captureReportSourceIdentity(filePath: string, maxInputBytes: number): ReportSourceSnapshot {
  return readSource(filePath, maxInputBytes, false);
}
export function assertReportSourceCurrent(snapshot: ReportSourceSnapshot, maxInputBytes: number): void {
  try {
    // 提交前只保留固定大小的流式哈希缓冲，不再复制整个来源文件。
    const current = readSource(snapshot.requestedPath, maxInputBytes, false);
    if (current.path !== snapshot.path || current.requestedPath !== snapshot.requestedPath
      || current.version !== snapshot.version || current.sha256 !== snapshot.sha256) throw new Error('REPORT_SOURCE_CHANGED_BEFORE_COMMIT');
  } catch (error) { throw logReportParserFailure('report_parser.source_currentness_failed', error); }
}

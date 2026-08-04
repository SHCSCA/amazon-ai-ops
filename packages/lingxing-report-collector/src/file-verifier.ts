import * as fs from 'fs';
import * as path from 'path';
import type { LingxingReportType } from '@amazon-ai-ops/shared-types';
import { analyzeFilenameDateRange, filenameDateRangeAnalysisSummary } from './filename-date-range';
import { inspectReportFileContent } from './report-file-inspector';

export interface FileVerificationResult {
  valid: boolean;
  fileSizeBytes: number;
  errorMessage?: string;
}

export interface DownloadedFileVerificationOptions {
  minBytes?: number;
  expectedFilenameKeyword?: string;
  expectedDateRange?: { start: string; end: string };
  expectedDownloadDir?: string;
  expectedReportType?: LingxingReportType;
}

const EVIDENCE_FILE_NAME_PATTERN = /(manifest|audit|diagnostic|screenshot|dom|trace|evidence|acceptance|batch-result|downloaded-report-files|failure)/i;

function isPathInsideDirectory(candidatePath: string, parentDir: string): boolean {
  try {
    const realCandidate = fs.realpathSync(candidatePath);
    const realParent = fs.realpathSync(parentDir);
    const relative = path.relative(path.resolve(realParent), realCandidate);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  } catch {
    return false;
  }
}

export function verifyDownloadedFile(
  filePath: string,
  minBytesOrOptions: number | DownloadedFileVerificationOptions = 128,
  expectedFilenameKeyword?: string,
): FileVerificationResult {
  const options: DownloadedFileVerificationOptions = typeof minBytesOrOptions === 'number'
    ? { minBytes: minBytesOrOptions, expectedFilenameKeyword }
    : minBytesOrOptions;
  const minBytes = options.minBytes ?? 128;

  if (!fs.existsSync(filePath)) {
    return { valid: false, fileSizeBytes: 0, errorMessage: '文件不存在' };
  }

  const stat = fs.statSync(filePath);
  const extension = path.extname(filePath).toLowerCase();
  if (!['.csv', '.xls', '.xlsx'].includes(extension)) {
    return { valid: false, fileSizeBytes: stat.size, errorMessage: '文件类型不是 CSV/XLS/XLSX 报表' };
  }

  const basename = path.basename(filePath);
  if (EVIDENCE_FILE_NAME_PATTERN.test(basename)) {
    return { valid: false, fileSizeBytes: stat.size, errorMessage: '文件名像审计/诊断证据，不是领星广告数据表格' };
  }

  if (options.expectedDownloadDir && !isPathInsideDirectory(filePath, options.expectedDownloadDir)) {
    return { valid: false, fileSizeBytes: stat.size, errorMessage: '下载文件不在当前批次下载目录内' };
  }

  if (options.expectedDateRange) {
    const analysis = analyzeFilenameDateRange(basename, options.expectedDateRange.start, options.expectedDateRange.end);
    if (!analysis.validInputDates) {
      return {
        valid: false,
        fileSizeBytes: stat.size,
        errorMessage: `采集日期格式无效：${options.expectedDateRange.start} 至 ${options.expectedDateRange.end}`,
      };
    }
    if (!analysis.hasStartToken || !analysis.hasEndToken) {
      return {
        valid: false,
        fileSizeBytes: stat.size,
        errorMessage: `文件名未包含采集日期范围：${options.expectedDateRange.start} 至 ${options.expectedDateRange.end}（${filenameDateRangeAnalysisSummary(analysis)}）`,
      };
    }
  }

  if (stat.size < minBytes) {
    return { valid: false, fileSizeBytes: stat.size, errorMessage: '文件过小，可能下载失败' };
  }

  if (options.expectedReportType) {
    const inspection = inspectReportFileContent(filePath, options.expectedReportType);
    if (!inspection.matched) {
      const reason = inspection.readable
        ? '文件内容表头也无法识别为对应报表（声明类型必须由列语义唯一确认）'
        : `文件内容不可读取：${inspection.errorMessage || 'unknown error'}`;
      return {
        valid: false,
        fileSizeBytes: stat.size,
        errorMessage: reason,
      };
    }
  } else if (
    options.expectedFilenameKeyword
    && !basename.toLowerCase().includes(options.expectedFilenameKeyword.toLowerCase())
  ) {
    return { valid: false, fileSizeBytes: stat.size, errorMessage: `文件名未包含预期关键词：${options.expectedFilenameKeyword}` };
  }

  return { valid: true, fileSizeBytes: stat.size };
}

import * as fs from 'fs';
import * as path from 'path';
import { analyzeFilenameDateRange, filenameDateRangeAnalysisSummary } from './filename-date-range';

export interface FileVerificationResult {
  valid: boolean;
  fileSizeBytes: number;
  errorMessage?: string;
}

export interface DownloadedFileVerificationOptions {
  minBytes?: number;
  expectedFilenameKeyword?: string;
  expectedDateRange?: { start: string; end: string };
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
  if (options.expectedFilenameKeyword && !basename.toLowerCase().includes(options.expectedFilenameKeyword.toLowerCase())) {
    return { valid: false, fileSizeBytes: stat.size, errorMessage: `文件名未包含预期关键词：${options.expectedFilenameKeyword}` };
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

  return { valid: true, fileSizeBytes: stat.size };
}

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyDownloadedFile } from './file-verifier';
import {
  inferLingxingReportTypeFromHeaders,
  inspectReportFileContent,
} from './report-file-inspector';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

function writeCsv(name: string, lines: readonly string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingxing-report-inspector-'));
  tempDirs.push(dir);
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
  return filePath;
}

describe('Lingxing report content type authority', () => {
  it('infers the most granular report type from column semantics', () => {
    expect(inferLingxingReportTypeFromHeaders([
      '日期', '广告活动', '广告组', '用户搜索词', '展现量', '花费',
    ])).toBe('user_search_term');
    expect(inferLingxingReportTypeFromHeaders([
      '日期', '广告活动', '广告组', '关键词', '展现量', '花费',
    ])).toBe('keyword');
    expect(inferLingxingReportTypeFromHeaders([
      '日期', '广告活动', '广告组', '展现量', '花费',
    ])).toBe('ad_group');
  });

  it('accepts a localized filename only when its headers bind the declared type', () => {
    const filePath = writeCsv('领星广告数据_2026-05-01_2026-05-25.csv', [
      '日期,广告活动,广告组,关键词,匹配方式,展现量,点击量,花费,订单,销售额',
    ]);

    expect(inspectReportFileContent(filePath, 'keyword')).toMatchObject({
      readable: true,
      matched: true,
      inferredReportType: 'keyword',
    });
    expect(verifyDownloadedFile(filePath, {
      minBytes: 1,
      expectedFilenameKeyword: 'keyword',
      expectedReportType: 'keyword',
    }).valid).toBe(true);
  });

  it.each([false, true])(
    'rejects a matching keyword filename when %s-row content is a search-term report',
    (withDataRow) => {
      const lines = [
        '日期,广告活动,广告组,用户搜索词,展现量,点击量,花费,订单,销售额',
      ];
      if (withDataRow) {
        lines.push('2026-05-25,Campaign A,Ad Group A,smart lock,20,2,3.12,1,49.99');
      }
      const filePath = writeCsv('keyword_2026-05-01_2026-05-25.csv', lines);

      const inspection = inspectReportFileContent(filePath, 'keyword');
      expect(inspection).toMatchObject({
        readable: true,
        matched: false,
        inferredReportType: 'user_search_term',
      });
      expect(verifyDownloadedFile(filePath, {
        minBytes: 1,
        expectedFilenameKeyword: 'keyword',
        expectedReportType: 'keyword',
      })).toMatchObject({
        valid: false,
        errorMessage: expect.stringContaining('声明类型必须由列语义唯一确认'),
      });
    },
  );
});

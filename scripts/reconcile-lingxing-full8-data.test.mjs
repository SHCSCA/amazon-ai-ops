import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const XLSX = createRequire(path.join(root, 'packages', 'report-parser', 'package.json'))('xlsx');
const { reconcile } = require('./reconcile-lingxing-full8-data.js');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeWorkbook(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
  XLSX.writeFile(workbook, filePath);
}

describe('reconcile Lingxing full8 data', () => {
  it('adds blockers when a real canonical report file is missing required metric columns', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingxing-reconcile-columns-'));
    const reportPath = path.join(dir, 'user-search-term.xlsx');
    const manifestPath = path.join(dir, 'manifest.json');
    const evidencePath = path.join(dir, 'desktop-live-full-8-e2e.json');

    writeWorkbook(reportPath, [
      ['日期', '广告活动', '搜索词'],
      ['2026-06-01', 'Campaign A', 'door lock'],
    ]);
    writeJson(manifestPath, {
      batch: {
        id: 'batch_2026060100000000_test',
        dateStart: '2026-06-01',
        dateEnd: '2026-06-12',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
      },
      files: [
        {
          reportType: 'user_search_term',
          filePath: reportPath,
          fileSizeBytes: fs.statSync(reportPath).size,
        },
      ],
    });
    writeJson(evidencePath, {
      manifestPath,
      batch: {
        id: 'batch_2026060100000000_test',
      },
    });

    const result = reconcile(evidencePath);

    expect(result.realReportFileCount).toBe(1);
    expect(result.blockers).toContain('user_search_term report is missing required metric columns: spend, orders, sales.');
  });
});

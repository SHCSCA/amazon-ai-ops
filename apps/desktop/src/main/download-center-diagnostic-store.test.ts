import { describe, expect, it } from 'vitest';
import type { DownloadCenterPageModel } from '@amazon-ai-ops/shared-types';
import { getLatestDownloadCenterDiagnosticRowForModel, type DiagnosticRowDatabase } from './download-center-diagnostic-store';

function model(): DownloadCenterPageModel {
  return {
    name: 'lingxing-download-center',
    description: 'verified model',
    candidateUrls: ['https://erp.lingxing.com/download-center'],
    entryHints: ['下载中心'],
    reportNames: ['关键词报告'],
    verifySelectors: [{ name: 'table', selector: '.ant-table', required: false }],
    actionSelectors: {
      dateStartInput: '[data-testid="start"]',
      dateEndInput: '[data-testid="end"]',
      createReportButton: '[data-testid="create"]',
      readyReportSelector: 'tr[data-report="{reportName}"][data-date="{dateRange}"]',
      downloadButton: 'tr[data-report="{reportName}"][data-date="{dateRange}"] button.download',
    },
    requiresManualVerification: false,
  };
}

describe('getLatestDownloadCenterDiagnosticRowForModel', () => {
  it('queries by page model name, exact snapshot json, and date range', () => {
    const activeModel = model();
    const captured: { sql?: string; params?: unknown[] } = {};
    const db: DiagnosticRowDatabase = {
      prepare(sql: string) {
        captured.sql = sql;
        return {
          get(...params: unknown[]) {
            captured.params = params;
            return { id: 7 };
          },
        };
      },
    };

    const row = getLatestDownloadCenterDiagnosticRowForModel(db, activeModel, '2026-05-01', '2026-05-31');

    expect(row).toEqual({ id: 7 });
    expect(captured.sql).toContain('page_model = ?');
    expect(captured.sql).toContain('page_model_snapshot_json = ?');
    expect(captured.sql).toContain('date_start = ?');
    expect(captured.sql).toContain('date_end = ?');
    expect(captured.params).toEqual([
      'lingxing-download-center',
      JSON.stringify(activeModel),
      '2026-05-01',
      '2026-05-31',
    ]);
  });
});

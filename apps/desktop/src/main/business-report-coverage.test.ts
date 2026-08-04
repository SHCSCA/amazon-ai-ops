import { describe, expect, it } from 'vitest';
import { summarizeBusinessReportCoverage } from './business-report-coverage';

describe('summarizeBusinessReportCoverage', () => {
  const expectedTypes = ['campaign', 'ad_group', 'placement', 'keyword'];

  it('counts unique report types instead of duplicate files', () => {
    const summary = summarizeBusinessReportCoverage({
      expectedTypes,
      realReportFiles: [
        { reportType: 'campaign', importedRows: 10 },
        { reportType: 'campaign', importedRows: 10 },
        { reportType: 'ad_group', importedRows: 20 },
        { reportType: 'ad_group', importedRows: 20 },
        { reportType: 'placement', importedRows: 30 },
        { reportType: 'placement', importedRows: 30 },
        { reportType: 'keyword', importedRows: 40 },
        { reportType: 'keyword', importedRows: 40 },
      ],
    });

    expect(summary.realReportTypeCount).toBe(4);
    expect(summary.realReportFileCount).toBe(4);
    expect(summary.importedReportTypeCount).toBe(4);
    expect(summary.missingReportTypes).toEqual([]);
    expect(summary.statusWithImportedRows(100)).toBe('ready');
  });

  it('treats a successful zero-row import receipt as complete coverage', () => {
    const summary = summarizeBusinessReportCoverage({
      expectedTypes,
      realReportFiles: expectedTypes.map((reportType) => ({
        reportType,
        importedRows: 0,
        status: 'imported',
      })),
    });

    expect(summary.importedReportTypeCount).toBe(4);
    expect(summary.statusWithImportedRows(0)).toBe('ready');
  });

  it('does not trust a zero-row downloaded file without an import receipt', () => {
    const summary = summarizeBusinessReportCoverage({
      expectedTypes,
      realReportFiles: expectedTypes.map((reportType) => ({ reportType, importedRows: 0, status: 'downloaded' })),
    });

    expect(summary.importedReportTypeCount).toBe(0);
    expect(summary.statusWithImportedRows(0)).toBe('partial');
  });

  it('does not mark duplicate files as full coverage when expected types are missing', () => {
    const summary = summarizeBusinessReportCoverage({
      expectedTypes: [...expectedTypes, 'user_search_term', 'product_targeting', 'auto_targeting', 'advertised_product'],
      realReportFiles: [
        { reportType: 'campaign', importedRows: 10 },
        { reportType: 'campaign', importedRows: 10 },
        { reportType: 'ad_group', importedRows: 20 },
        { reportType: 'ad_group', importedRows: 20 },
        { reportType: 'placement', importedRows: 30 },
        { reportType: 'placement', importedRows: 30 },
        { reportType: 'keyword', importedRows: 40 },
        { reportType: 'keyword', importedRows: 40 },
      ],
    });

    expect(summary.realReportTypeCount).toBe(4);
    expect(summary.realReportFileCount).toBe(4);
    expect(summary.missingReportTypes).toEqual(['user_search_term', 'product_targeting', 'auto_targeting', 'advertised_product']);
    expect(summary.statusWithImportedRows(100)).toBe('partial');
  });
});

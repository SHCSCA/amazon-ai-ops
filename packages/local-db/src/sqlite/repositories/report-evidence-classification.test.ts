import { describe, expect, it } from 'vitest';
import { ReportFileRepository } from './report-file-repo';
import { createHarness } from './mission-domain-repo.test-harness';

describe('raw report and diagnostic evidence separation', () => {
  it.each(['screenshot.png', 'page.html', 'dom.json', 'trace.zip', 'audit.xlsx', 'acceptance-audit.csv', 'page-archive.mhtml'])(
    'never counts %s as a raw report even under an asserted spreadsheet filename', filePath => {
      const h = createHarness();
      const repository = new ReportFileRepository(h.database);
      repository.upsertForStore(h.contextOne.storeId, { batchId: 'classification-batch', reportType: 'keyword',
        filePath: `logical-reports/${filePath}`, fileName: 'keyword.xlsx', fileSize: 1024, status: 'downloaded', importedRows: 0 });
      expect(repository.findForStore(h.contextOne.storeId, { batchId: 'classification-batch' })).toHaveLength(1);
      expect(repository.findBusinessReportFilesForStore(h.contextOne.storeId, { batchId: 'classification-batch' })).toEqual([]);
    },
  );
  it('retains a real spreadsheet and rejects a diagnostic display filename over its path', () => {
    const h = createHarness();
    const repository = new ReportFileRepository(h.database);
    for (const [name, fileName] of [['keyword', 'keyword.xlsx'], ['diagnostic', 'audit.xlsx']]) {
      repository.upsertForStore(h.contextOne.storeId, { batchId: 'classification-batch', reportType: 'keyword',
        filePath: `logical-reports/${name}.xlsx`, fileName, fileSize: 1024, status: 'downloaded', importedRows: 0 });
    }
    expect(repository.findBusinessReportFilesForStore(h.contextOne.storeId, { batchId: 'classification-batch' }).map(file => file.fileName)).toEqual(['keyword.xlsx']);
  });
});

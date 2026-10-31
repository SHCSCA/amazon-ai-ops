import { describe, expect, it, type CommitReportImportInput } from './lingxing-import-test-environment';
import { createHarness, fullAuthorityTerminal, fullAuthorityImportInput } from './lingxing-import-test-fixture';
import { loadAdObservedSnapshot } from './ad-observed-snapshot';

function fixture(change?: (input: CommitReportImportInput) => void) {
  const h = createHarness();
  const terminal = fullAuthorityTerminal(h.storeA, 'profile-a', 'observed-batch');
  h.repository.commitCollectionTerminalForStore(h.storeA, terminal);
  const input = fullAuthorityImportInput(terminal, '2026-07-22T00:06:00.000Z', '2026-07-22T00:07:00.000Z');
  change?.(input);
  h.repository.commitImportForStore(h.storeA, input);
  const scope = { storeId: h.storeA, marketplaceCode: 'US', dateFrom: '2026-07-21', dateTo: '2026-07-21',
    batchIds: [terminal.batch.id], sourceFiles: input.files.map(file => file.filePath) };
  return { ...h, scope, input };
}

describe('immutable advertised-product observation snapshot', () => {
  it('binds one exact file while excluding other report families without claiming coverage', () => {
    const h = fixture();
    const result = loadAdObservedSnapshot(h.database, h.scope);
    expect(result.status).toBe('verified');
    expect(result.reason).toBe('immutable_snapshot_match_not_coverage');
    expect(result.metrics).toHaveLength(1);
    expect(result.metrics[0].reportType).toBe('advertised_product');
    expect(result.source).toMatchObject({ storeId: h.storeA, batchId: h.scope.batchIds[0],
      runId: h.input.runId, fileHash: 'a'.repeat(64), dateFrom: '2026-07-21', dateTo: '2026-07-21' });
  });
  it.each([
    ['store', { storeId: 'store-b' }], ['marketplace', { marketplaceCode: 'CA' }],
    ['earlier', { dateFrom: '2026-07-20' }], ['later', { dateTo: '2026-07-22' }],
    ['invalid calendar', { dateFrom: '2026-02-30' }], ['inverted', { dateFrom: '2026-07-22' }],
    ['mixed batches', { batchIds: ['observed-batch', 'other'] }], ['no batch', { batchIds: [] }],
    ['unbound file', { sourceFiles: ['advertised_product.xlsx'] }],
  ])('rejects %s scope', (_label, override) => {
    const h = fixture();
    expect(loadAdObservedSnapshot(h.database, { ...h.scope, ...override }).status).toBe('unavailable');
  });
  it('checks whole-batch evidence, including mutation of an excluded report family', () => {
    const h = fixture();
    h.database.prepare("UPDATE ad_daily_metrics SET cost = cost + 1 WHERE report_type = 'keyword'").run();
    expect(loadAdObservedSnapshot(h.database, h.scope)).toMatchObject({ status: 'unavailable', reason: 'metric_evidence_mismatch', metrics: [] });
  });
  it('bounds the full batch before reading and hashing, not only selected rows', () => {
    const h = fixture();
    expect(loadAdObservedSnapshot(h.database, h.scope, 7).reason).toBe('row_limit_exceeded');
    expect(loadAdObservedSnapshot(h.database, h.scope, 8).status).toBe('verified');
    expect(() => loadAdObservedSnapshot(h.database, h.scope, 5001)).toThrow();
  });
  it('rejects a file path mismatch even if committed payload hash matches', () => {
    const h = fixture(input => { input.metrics.find(row => row.reportType === 'advertised_product')!.sourceFile = 'C:/different/advertised_product.xlsx'; });
    expect(loadAdObservedSnapshot(h.database, h.scope).reason).toBe('source_rows_unverified');
  });
  it('rejects missing physical source-row identity even in a completed import', () => {
    const h = fixture(input => { input.metrics.find(row => row.reportType === 'advertised_product')!.sourceRow = undefined; });
    expect(loadAdObservedSnapshot(h.database, h.scope).reason).toBe('source_rows_unverified');
  });
  it('rejects duplicate physical source rows despite different metric dimensions', () => {
    const h = fixture(input => {
      const row = input.metrics.find(row => row.reportType === 'advertised_product')!;
      input.metrics = [...input.metrics, { ...row, campaignName: 'Other campaign' }];
      input.files.find(file => file.reportType === 'advertised_product')!.importedRows = 2;
      const rec = input.reconciliations.find(rec => rec.reportType === 'advertised_product')!;
      rec.expectedRows = 2; rec.expectedCost *= 2;
    });
    expect(loadAdObservedSnapshot(h.database, h.scope).reason).toBe('source_rows_unverified');
  });
  it('binds the original immutable window even if mutable batch dates are widened', () => {
    const h = fixture();
    h.database.prepare("UPDATE lingxing_report_batches SET date_start='2026-07-20', date_end='2026-07-22' WHERE id=?").run(h.scope.batchIds[0]);
    expect(loadAdObservedSnapshot(h.database, { ...h.scope, dateFrom: '2026-07-20', dateTo: '2026-07-22' })).toMatchObject({ status: 'unavailable', reason: 'import_fingerprint_mismatch' });
  });
  it('refuses lossily reconstructed control precision rather than guessing an input fingerprint', () => {
    const h = fixture(input => { input.reconciliations[0].tolerance = 0.010001; });
    expect(loadAdObservedSnapshot(h.database, h.scope).reason).toBe('import_fingerprint_mismatch');
  });
  it('does not silently swallow missing schemas', () => {
    const h = fixture();
    h.database.exec('ALTER TABLE report_import_metric_evidence RENAME TO isolated_missing_evidence');
    expect(() => loadAdObservedSnapshot(h.database, h.scope)).toThrow();
  });
});

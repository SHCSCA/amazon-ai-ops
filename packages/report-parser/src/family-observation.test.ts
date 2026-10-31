import { createHash } from 'node:crypto';
import * as XLSX from 'xlsx';
import { describe, expect, it, vi } from 'vitest';
import { ReportParser } from './parser';
import { LINGXING_TEMPLATE_MANIFEST } from './lingxing-template-manifest';
import { observeOwnerConfirmedFamily, type FamilyReportBytes, type FamilyReportLevel, type OwnerConfirmedFamilyScope } from './family-observation';

function report(reportType: FamilyReportLevel, overrides: Record<string, unknown>[] = [{}]): FamilyReportBytes {
  const headers = LINGXING_TEMPLATE_MANIFEST.find(item => item.reportType === reportType)!.headers;
  const rows = overrides.map(override => ({ '店铺名称': 'Synthetic store', '国家': 'US', '类型': 'SP',
    '广告活动': 'Synthetic campaign', '广告组': 'Synthetic group', '关键词': 'synthetic term', '匹配方式': '精准匹配',
    '日期': '2026-01-02', '曝光量': 100, '点击': 4, '花费-本币': 2, '广告订单': 1, '广告销售额-本币': 10, ...override }));
  const sheet = XLSX.utils.aoa_to_sheet([[...headers], ...rows.map(row => headers.map(header => row[header as keyof typeof row] ?? ''))]);
  const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, sheet, 'Synthetic');
  return { reportType, bytes: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) };
}
function scope(reports: FamilyReportBytes[]): OwnerConfirmedFamilyScope {
  return { schemaVersion: 1, provenanceLabel: 'user_confirmed_scope', familyLabel: 'Synthetic family',
    confirmationReference: 'synthetic-owner-statement', storeName: 'Synthetic store', marketplaceCode: 'US',
    dateFrom: '2026-01-01', dateTo: '2026-01-03', files: reports.map(item => ({
      sha256: createHash('sha256').update(item.bytes).digest('hex'), reportType: item.reportType,
      dateFrom: '2026-01-01', dateTo: '2026-01-03' })) };
}
describe('bounded owner-confirmed family observation', () => {
  it('uses exact bytes with campaign authority, crosschecks and unknown missing days', () => {
    const reports = [report('campaign'), report('ad_group'), report('keyword')];
    const confirmation = scope(reports), before = JSON.stringify(confirmation);
    const result = observeOwnerConfirmedFamily(confirmation, reports);
    expect(result).toMatchObject({ provenanceLabel: 'user_confirmed_scope', authority: 'campaign-only',
      nativeAsinAuthority: false, formalEligibility: false, currency: 'unknown', attributionWindow: 'unknown', keywordCoverage: 'subset-unknown' });
    expect(result.days).toHaveLength(3);
    expect(result.days[0]).toMatchObject({ campaign: null, adGroupCrosscheck: null, reconciliation: 'unknown' });
    expect(result.days[1]).toMatchObject({ campaign: { metrics: { cost: 2 } }, keywordSubset: { metrics: { cost: 2 } }, reconciliation: 'match' });
    expect(result.days[1].campaign?.sourceRows).toEqual([{ sha256: confirmation.files[0].sha256, sourceRow: 2 }]);
    expect(JSON.stringify(confirmation)).toBe(before);
    expect(JSON.stringify(result)).not.toMatch(/sourceFile|asinAllocation|profit|organicSales/);
  });
  it('retains discrepancies without explanations or adding overlapping levels', () => {
    const reports = [report('campaign', [{ '花费-本币': 3.25, '点击': 5 }]), report('ad_group')];
    const observed = observeOwnerConfirmedFamily(scope(reports), reports).days[1];
    expect(observed).toMatchObject({ reconciliation: 'discrepancy', campaignMinusAdGroup: { cost: 1.25, clicks: 1 }, campaign: { metrics: { cost: 3.25 } } });
  });
  it('rejects changed bytes, type relabeling and overlapping level files', () => {
    const original = report('campaign'), changed = report('campaign', [{ '花费-本币': 9 }]);
    expect(() => observeOwnerConfirmedFamily(scope([original]), [changed])).toThrow(/unconfirmed/);
    expect(() => observeOwnerConfirmedFamily(scope([original]), [{ ...original, reportType: 'ad_group' }])).toThrow(/unconfirmed/);
    expect(() => observeOwnerConfirmedFamily(scope([original, changed]), [original, changed])).toThrow(/overlapping/);
  });
  it('rejects scope extension, mismatched row store, provenance and version', () => {
    const reports = [report('campaign')], bound = scope(reports);
    expect(() => observeOwnerConfirmedFamily({ ...bound, dateTo: '2026-01-01' }, reports)).toThrow();
    expect(() => observeOwnerConfirmedFamily({ ...bound, storeName: 'Other store' }, reports)).toThrow(/scope mismatch/);
    expect(() => observeOwnerConfirmedFamily({ ...bound, schemaVersion: 2 } as unknown as OwnerConfirmedFamilyScope, reports)).toThrow(/provenance/);
    expect(() => observeOwnerConfirmedFamily({ ...bound, confirmationReference: '' }, reports)).toThrow(/provenance/);
    expect(() => observeOwnerConfirmedFamily({ ...bound, dateFrom: '2025-01-01' }, reports)).toThrow(/excessive/);
    expect(() => observeOwnerConfirmedFamily({ ...bound, dateTo: '2026-02-30' }, reports)).toThrow(/date/);
  });
  it('does not certify parser default zeros as sourced metric values', () => {
    const reports = [report('campaign', [{ '花费-本币': '' }]), report('ad_group')];
    const result = observeOwnerConfirmedFamily(scope(reports), reports).days[1];
    expect(result.campaign?.metrics.cost).toBeNull();
    expect(result.campaignMinusAdGroup.cost).toBeNull();
    expect(result.reconciliation).toBe('unknown');
  });
  it('keeps explicit source zeros, and never upgrades subset-only coverage', () => {
    const reports = [report('campaign', [{ '花费-本币': 0 }])];
    expect(observeOwnerConfirmedFamily(scope(reports), reports).days[1]).toMatchObject({ campaign: { metrics: { cost: 0 } }, reconciliation: 'unknown' });
    const keyword = [report('keyword')];
    expect(() => observeOwnerConfirmedFamily(scope(keyword), keyword)).toThrow(/campaign authority/);
  });
  it('does not sum indistinguishable repeated labels or silently remove their physical rows', () => {
    const reports = [report('campaign', [{}, {}])];
    const day = observeOwnerConfirmedFamily(scope(reports), reports).days[1];
    expect(day.campaign).toMatchObject({ identityStatus: 'ambiguous-repeated-dimensions', metrics: { cost: null } });
    expect(day.campaign?.sourceRows).toHaveLength(2);
    expect(day.reconciliation).toBe('unknown');
  });
  it('adds distinct observed campaigns only within their level', () => {
    const reports = [report('campaign', [{}, { '广告活动': 'Other synthetic campaign' }])];
    expect(observeOwnerConfirmedFamily(scope(reports), reports).days[1].campaign?.metrics.cost).toBe(4);
  });

  it('caps parsed row processing before aggregation', () => {
    const reports = [report('campaign')];
    const parse = vi.spyOn(ReportParser.prototype, 'parseExcelBytes').mockReturnValue({ data: new Array(100_001) } as any);
    try { expect(() => observeOwnerConfirmedFamily(scope(reports), reports)).toThrow(/row limit/); }
    finally { parse.mockRestore(); }
  });

});

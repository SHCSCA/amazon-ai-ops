import { AD_SOURCE_METRIC_BITS, type AdDailyMetrics } from '@amazon-ai-ops/shared-types';
import { createHash } from 'node:crypto';
import { ReportParser } from './parser';

export type FamilyReportLevel = 'campaign' | 'ad_group' | 'keyword';
export interface FamilyReportBinding {
  sha256: string;
  reportType: FamilyReportLevel | 'auxiliary';
  dateFrom: string;
  dateTo: string;
}
export interface OwnerConfirmedFamilyScope {
  schemaVersion: 1;
  provenanceLabel: 'user_confirmed_scope';
  familyLabel: string;
  confirmationReference: string;
  storeName: string;
  marketplaceCode: string;
  dateFrom: string;
  dateTo: string;
  files: readonly FamilyReportBinding[];
}
export interface FamilyReportBytes {
  bytes: Uint8Array;
  reportType: FamilyReportLevel;
}
type Metric = keyof typeof AD_SOURCE_METRIC_BITS;
export type FamilyObservedMetrics = Record<Metric, number | null>;
export interface FamilyLevelObservation {
  metrics: FamilyObservedMetrics;
  identityStatus: 'labels-only' | 'ambiguous-repeated-dimensions';
  sourceRows: { sha256: string; sourceRow: number }[];
}
export interface FamilyDailyObservation {
  date: string;
  campaign: FamilyLevelObservation | null;
  adGroupCrosscheck: FamilyLevelObservation | null;
  keywordSubset: FamilyLevelObservation | null;
  campaignMinusAdGroup: FamilyObservedMetrics;
  reconciliation: 'match' | 'discrepancy' | 'unknown';
}
export interface FamilyObservation {
  schemaVersion: 1;
  provenanceLabel: 'user_confirmed_scope';
  familyLabel: string;
  confirmationReference: string;
  bindings: FamilyReportBinding[];
  consumedHashes: string[];
  completeness: 'partial-observation';
  authority: 'campaign-only';
  nativeAsinAuthority: false;
  formalEligibility: false;
  currency: 'unknown';
  attributionWindow: 'unknown';
  keywordCoverage: 'subset-unknown';
  days: FamilyDailyObservation[];
}
const metrics = Object.keys(AD_SOURCE_METRIC_BITS) as Metric[];
const levels: FamilyReportLevel[] = ['campaign', 'ad_group', 'keyword'];
const dayMs = 86_400_000;
function fail(message: string): never { throw new Error(`Family observation: ${message}`); }
function day(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('invalid date');
  const time = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) fail('invalid date');
  return time;
}
function windowCheck(from: string, to: string): void {
  const span = day(to) - day(from);
  if (span < 0 || span / dayMs > 365) fail('invalid or excessive observation window');
}
function blankMetrics(): FamilyObservedMetrics {
  return { impressions: null, clicks: null, cost: null, orders: null, sales: null };
}
function summarize(rows: AdDailyMetrics[], sha256: string): FamilyLevelObservation {
  const values = blankMetrics();
  const keys = rows.map(row => JSON.stringify([row.portfolioName ?? '', row.campaignName,
    row.reportType === 'campaign' ? '' : row.adGroupName,
    row.reportType === 'keyword' ? row.targeting : '', row.reportType === 'keyword' ? row.matchType : '']));
  const ambiguous = new Set(keys).size !== keys.length;
  for (const metric of metrics) {
    const bit = AD_SOURCE_METRIC_BITS[metric];
    if (!ambiguous && rows.every(row => Number.isInteger(row.sourceMetricMask) && ((row.sourceMetricMask ?? 0) & bit)
      && Number.isFinite(row[metric]) && row[metric] >= 0
      && (!['impressions', 'clicks', 'orders'].includes(metric) || Number.isSafeInteger(row[metric])))) {
      const sum = rows.reduce((total, row) => total + row[metric], 0);
      if (Number.isFinite(sum) && sum <= Number.MAX_SAFE_INTEGER && (['cost', 'sales'].includes(metric) || Number.isSafeInteger(sum))) values[metric] = sum;
    }
  }
  return { metrics: values, identityStatus: ambiguous ? 'ambiguous-repeated-dimensions' : 'labels-only', sourceRows: rows.map(row => ({ sha256, sourceRow: row.sourceRow! })) };
}

// 仅观察指定字节与日期范围；不写库，不补 ASIN，不替代正式诊断的证据门。
export function observeOwnerConfirmedFamily(
  scope: OwnerConfirmedFamilyScope, reports: readonly FamilyReportBytes[],
): FamilyObservation {
  if (scope.schemaVersion !== 1 || scope.provenanceLabel !== 'user_confirmed_scope' || !scope.familyLabel?.trim()
    || !scope.confirmationReference?.trim() || !scope.storeName?.trim() || !scope.marketplaceCode?.trim()) fail('missing explicit scope provenance');
  if (!Array.isArray(scope.files) || !Array.isArray(reports) || scope.files.length > 32 || reports.length > 3) fail('invalid report bundle');
  windowCheck(scope.dateFrom, scope.dateTo);
  const bindings = new Map<string, FamilyReportBinding>();
  for (const binding of scope.files) {
    if (!/^[a-f0-9]{64}$/.test(binding.sha256) || bindings.has(binding.sha256)) fail('invalid or duplicate file binding');
    if (![...levels, 'auxiliary'].includes(binding.reportType)) fail('unsupported bound report type');
    windowCheck(binding.dateFrom, binding.dateTo);
    if (binding.dateFrom < scope.dateFrom || binding.dateTo > scope.dateTo) fail('file window exceeds confirmation');
    bindings.set(binding.sha256, binding);
  }
  const byLevel = new Map<FamilyReportLevel, { hash: string; days: Map<string, AdDailyMetrics[]> }>();
  const consumedHashes: string[] = [];
  for (const input of reports) {
    if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength === 0 || input.bytes.byteLength > 32 * 1024 * 1024) fail('report bytes required');
    const bytes = Uint8Array.from(input.bytes);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const binding = bindings.get(sha256);
    const report = { sha256, reportType: input.reportType };
    if (!binding || binding.reportType !== report.reportType || !levels.includes(report.reportType)) fail('unconfirmed file or report type');
    if (byLevel.has(report.reportType)) fail('overlapping report level requires explicit resolution');
    const parsed = new ReportParser().parseExcelBytes(bytes, `sha256:${sha256}`,
      { reportType: report.reportType, requireRegisteredTemplate: true });
    if (parsed.data.length > 100_000) fail('parsed row limit exceeded');
    consumedHashes.push(sha256);
    if (!parsed.success || !parsed.schemaValid || !parsed.validation.valid
      || parsed.validation.invalidCount !== 0) fail('invalid parsed report');
    const days = new Map<string, AdDailyMetrics[]>();
    const sourceRows = new Set<number>();
    for (const row of parsed.data) {
      day(row.date);
      if (row.date < binding.dateFrom || row.date > binding.dateTo) fail('row outside bound window');
      if (row.storeName !== scope.storeName || row.marketplaceCode !== scope.marketplaceCode
        || row.reportType !== report.reportType) fail('row scope mismatch');
      if (!Number.isSafeInteger(row.sourceRow) || row.sourceRow! < 1 || sourceRows.has(row.sourceRow!)) fail('invalid or duplicate source row');
      sourceRows.add(row.sourceRow!);
      const dailyRows = days.get(row.date) ?? [];
      dailyRows.push(row);
      days.set(row.date, dailyRows);
    }
    byLevel.set(report.reportType, { hash: report.sha256, days });
  }
  if (!byLevel.has('campaign')) fail('campaign authority report required');
  const days: FamilyDailyObservation[] = [];
  for (let time = day(scope.dateFrom); time <= day(scope.dateTo); time += dayMs) {
    const date = new Date(time).toISOString().slice(0, 10);
    const at = (level: FamilyReportLevel): FamilyLevelObservation | null => {
      const report = byLevel.get(level);
      const rows = report?.days.get(date);
      return rows?.length ? summarize(rows, report!.hash) : null;
    };
    const campaign = at('campaign'), adGroupCrosscheck = at('ad_group');
    const delta = blankMetrics();
    for (const metric of metrics) {
      const a = campaign?.metrics[metric], b = adGroupCrosscheck?.metrics[metric];
      if (a != null && b != null) delta[metric] = a - b;
    }
    // 只吸收浮点运算尾差，不抹平货币分或真实计数差异。
    const differs = metrics.some(metric => delta[metric] !== null && Math.abs(delta[metric]!) > 1e-8);
    const complete = metrics.every(metric => delta[metric] !== null);
    days.push({ date, campaign, adGroupCrosscheck, keywordSubset: at('keyword'), campaignMinusAdGroup: delta,
      reconciliation: differs ? 'discrepancy' : complete ? 'match' : 'unknown' });
  }
  return { schemaVersion: 1, provenanceLabel: scope.provenanceLabel, familyLabel: scope.familyLabel, confirmationReference: scope.confirmationReference,
    bindings: scope.files.map(binding => ({ ...binding })), consumedHashes,
    completeness: 'partial-observation', authority: 'campaign-only', nativeAsinAuthority: false, formalEligibility: false,
    currency: 'unknown', attributionWindow: 'unknown', keywordCoverage: 'subset-unknown', days };
}

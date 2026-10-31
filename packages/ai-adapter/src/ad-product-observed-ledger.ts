import type { AdStrategyDiagnosisInput } from './ad-strategy-diagnosis';

export type AdProductObservedMetricField = 'impressions' | 'clicks' | 'cost' | 'orders' | 'sales';
export interface AdProductObservedLedger {
  status: 'partial' | 'unavailable';
  coverage: 'unverified';
  reason: string;
  source?: {
    storeId: string; batchId: string; runId: string; snapshotId: string;
    sourceFile: string; fileHash: string; dateFrom: string; dateTo: string;
  };
  days: Array<{
    asin: string; date: string; status: 'partial' | 'missing' | 'ambiguous';
    observedRowCount: number;
    sourceRows: number[];
    metrics: Record<AdProductObservedMetricField, number | null>;
    observedFieldRowCounts: Record<AdProductObservedMetricField, number>;
    explicitZeroFields: AdProductObservedMetricField[];
    unknownFields: AdProductObservedMetricField[];
  }>;
  excludedRowCount: number;
}

const fields: AdProductObservedMetricField[] = ['impressions', 'clicks', 'cost', 'orders', 'sales'];
const reason = '仅为单一来源的部分观察；缺失指标和日期未知，不是完整产品总量，不能用于正式 AI 动作。';
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const date = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

export function sanitizeObservedProductLedger(
  value: AdProductObservedLedger | undefined,
  scope: AdStrategyDiagnosisInput['scope'],
): AdProductObservedLedger | undefined {
  if (!value) return undefined;
  const unavailable: AdProductObservedLedger = { status: 'unavailable', coverage: 'unverified', reason, days: [], excludedRowCount: 0 };
  const source = value.source;
  // 只投影封闭合同，外来 complete、totals 或阶段字段不得穿透供应商输入。
  if (value.status !== 'partial' || value.coverage !== 'unverified' || !source
    || !['storeId', 'batchId', 'runId', 'snapshotId', 'sourceFile'].every((key) => typeof source[key as keyof typeof source] === 'string' && source[key as keyof typeof source].trim())
    || !/^[a-f0-9]{64}$/i.test(source.fileHash) || !date(source.dateFrom) || !date(source.dateTo)
    || source.dateFrom > scope.dateFrom || source.dateTo < scope.dateTo
    || (scope.batchId && source.batchId !== scope.batchId) || (scope.storeId && source.storeId !== scope.storeId)
    || !Array.isArray(value.days) || value.days.length > 120 || !count(value.excludedRowCount)) return unavailable;
  const identities = new Set<string>();
  const days: AdProductObservedLedger['days'] = [];
  for (const day of value.days) {
    if (!day || typeof day.asin !== 'string' || !/^[A-Z0-9]{10}$/.test(day.asin) || !date(day.date)
      || day.date < scope.dateFrom || day.date > scope.dateTo || (scope.asin && day.asin !== scope.asin.toUpperCase())
      || !['partial', 'missing', 'ambiguous'].includes(day.status) || !count(day.observedRowCount)
      || (day.status === 'partial' && day.observedRowCount === 0)
      || !Array.isArray(day.unknownFields) || !Array.isArray(day.explicitZeroFields)) return unavailable;
    if (!Array.isArray(day.sourceRows) || day.sourceRows.length > 5000
      || (day.status === 'partial' && (day.sourceRows.length !== day.observedRowCount || !day.sourceRows.every((row, index) => Number.isSafeInteger(row) && row > 0 && (index === 0 || row > day.sourceRows[index - 1]))))
      || (day.status === 'missing' && day.sourceRows.length !== 0)) return unavailable;
    const identity = `${day.asin}:${day.date}`;
    if (identities.has(identity)) return unavailable;
    identities.add(identity);
    if (!fields.every((field) => count(day.observedFieldRowCounts?.[field]) && day.observedFieldRowCounts[field] <= day.observedRowCount)) return unavailable;
    const observedFieldRowCounts = Object.fromEntries(fields.map((field) => [field, day.status === 'partial' ? day.observedFieldRowCounts[field] : 0])) as Record<AdProductObservedMetricField, number>;
    const metrics = Object.fromEntries(fields.map((field) => {
      const metric = day.metrics?.[field];
      return [field, day.status === 'partial' && observedFieldRowCounts[field] > 0 && observedFieldRowCounts[field] === day.observedRowCount && !day.unknownFields.includes(field) && typeof metric === 'number'
        && Number.isFinite(metric) && metric >= 0 && (!['impressions', 'clicks', 'orders'].includes(field) || Number.isSafeInteger(metric))
        ? metric : null];
    })) as AdProductObservedLedger['days'][number]['metrics'];
    days.push({ asin: day.asin, date: day.date, status: day.status, observedRowCount: day.observedRowCount, sourceRows: day.status === 'partial' ? [...day.sourceRows] : [], metrics, observedFieldRowCounts,
      explicitZeroFields: fields.filter((field) => metrics[field] === 0 && day.explicitZeroFields.includes(field)),
      unknownFields: fields.filter((field) => metrics[field] === null || observedFieldRowCounts[field] < day.observedRowCount) });
  }
  return { status: 'partial', coverage: 'unverified', reason,
    source: { storeId: source.storeId, batchId: source.batchId, runId: source.runId, snapshotId: source.snapshotId,
      sourceFile: source.sourceFile, fileHash: source.fileHash, dateFrom: source.dateFrom, dateTo: source.dateTo },
    days, excludedRowCount: value.excludedRowCount };
}

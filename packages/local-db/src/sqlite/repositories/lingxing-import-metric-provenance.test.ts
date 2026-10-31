import { describe, expect, it } from './lingxing-import-test-environment';
import { collectionSnapshot, createHarness, importInput } from './lingxing-import-test-fixture';
import { normalizeMetricForImport, importFingerprint } from './lingxing-import-metrics';
import { hashCanonicalMetrics, readCanonicalMetrics } from '../migrations/0010-collection-resume-authority';

describe('前向指标位图不可变导入证据', () => {
  it.each([undefined, 0, 31])('保留来源 %s 并支持相同 payload 重放去重', (mask) => {
    const { repository, database, storeA } = createHarness();
    repository.saveCollectionSnapshotForStore(storeA, collectionSnapshot(storeA, 'Shop Alpha', 'batch-a'));
    const input = importInput('Shop Alpha', 'batch-a');
    input.metrics = input.metrics.map(metric => ({ ...metric, sourceAsin: metric.asin, sourceMetricMask: mask }));
    const committed = repository.commitImportForStore(storeA, input);
    expect(committed.deduplicated).toBe(false);
    expect(repository.commitImportForStore(storeA, input).deduplicated).toBe(true);
    expect(repository.listAdMetricsForStore(storeA, 'batch-a')[0]?.sourceMetricMask).toBe(mask);
    const canonical = readCanonicalMetrics(database, storeA, 'batch-a');
    expect(hashCanonicalMetrics(canonical)).toBe(hashCanonicalMetrics(input.metrics.map(normalizeMetricForImport)));
    expect(database.prepare('SELECT source_metric_mask AS mask FROM ad_daily_metrics').get()).toEqual({ mask: mask ?? null });
  });
  it('旧 fingerprint 不变，新证据改变 fingerprint 且不能覆写旧完成批次', () => {
    const { repository, storeA } = createHarness();
    repository.saveCollectionSnapshotForStore(storeA, collectionSnapshot(storeA, 'Shop Alpha', 'batch-a'));
    const input = importInput('Shop Alpha', 'batch-a');
    const original = input.metrics[0]!;
    expect(hashCanonicalMetrics([original])).toBe(hashCanonicalMetrics([{ ...original, sourceMetricMask: undefined }]));
    expect(importFingerprint(input)).toBe(importFingerprint({ ...input, metrics: [{ ...original, sourceMetricMask: undefined }] }));
    expect(importFingerprint(input)).not.toBe(importFingerprint({ ...input, metrics: [{ ...original, sourceMetricMask: 31 }] }));
    repository.commitImportForStore(storeA, input);
    expect(() => repository.commitImportForStore(storeA, { ...input, metrics: [{ ...original, sourceMetricMask: 31 }] })).toThrow();
  });
  it.each([-1, 32, 1.5, NaN, Infinity, null, '31'])('拒绝非法位图 %s', (sourceMetricMask) => {
    expect(() => normalizeMetricForImport({ ...importInput('Shop Alpha', 'batch-a').metrics[0]!, sourceMetricMask } as any)).toThrow('IMPORT_SOURCE_METRIC_MASK_INVALID');
  });
  it.each([{ cost: NaN }, { cost: Infinity }, { sales: -1 }, { clicks: 0.5 }, { orders: Number.MAX_SAFE_INTEGER + 1 }])('拒绝被认证的非法指标 %j', patch => {
    expect(() => normalizeMetricForImport({ ...importInput('Shop Alpha', 'batch-a').metrics[0]!, sourceMetricMask: 31, ...patch })).toThrow('IMPORT_SOURCE_METRIC_VALUE_INVALID');
  });
});

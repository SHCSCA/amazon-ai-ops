import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { LINGXING_TEMPLATE_MANIFEST } from '@amazon-ai-ops/report-parser';
import { normalizeStoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { FamilyObservationService, type FamilyObservationSource } from './family-observation-service';

function setup() {
  let context = normalizeStoreContextEnvelope({ storeId: 'synthetic-store', browserProfileId: 'synthetic-profile', marketplace: 'US', currency: 'USD', businessTimezone: 'America/Los_Angeles', businessDate: '2026-01-02', sessionGeneration: 1 });
  let now = 0;
  const contents = new Map<number, Uint8Array>();
  const files: FamilyObservationSource[] = ['campaign', 'ad_group', 'keyword', 'placement', 'advertised_product'].map((reportType, i) => {
    const headers = LINGXING_TEMPLATE_MANIFEST.find(item => item.reportType === reportType)!.headers;
    const values: Record<string, string | number> = { '店铺名称': 'Synthetic store', '国家': 'US', '类型': 'SP', '广告活动': 'Synthetic campaign', '广告组': 'Synthetic group', '关键词': 'synthetic term', '匹配方式': '精准匹配', '日期': '2026-01-02', '曝光量': 100, '点击': 4, '花费-本币': reportType === 'campaign' ? 3 : 2, '广告订单': 1, '广告销售额-本币': 10 };
    const bytes = Buffer.from('\uFEFF' + headers.join(',') + '\n' + headers.map(header => values[header] ?? '').join(','));
    contents.set(i + 1, bytes);
    return { id: i + 1, fileName: `${reportType}.csv`, batchId: 'synthetic-batch', reportType, sha256: createHash('sha256').update(bytes).digest('hex'), dateFrom: '2026-01-01', dateTo: '2026-01-03', storeId: context.storeId, status: 'imported', filePath: `/synthetic/${reportType}.csv`, fileSize: bytes.byteLength, version: '1' };
  });
  const service = new FamilyObservationService({ authority(submitted) {
    if (JSON.stringify(submitted) !== JSON.stringify(context)) throw new Error('stale context');
    return { context, storeName: 'Synthetic store' };
  }, files: () => files.map(file => ({ ...file })), read: source => contents.get(source.id)!, now: () => now });
  const input = { storeContext: { ...context }, dateFrom: '2026-01-01', dateTo: '2026-01-03', fileIds: files.map(file => file.id), familyLabel: 'Synthetic family' };
  return { service, input, files, contents, advance: () => { context = { ...context, sessionGeneration: context.sessionGeneration + 2 }; }, expire: () => { now = 600000; } };
}
describe('Main session-only family confirmation boundary', () => {
  it('confirms five exact files and observes only supported campaign/crosscheck/subset levels', () => {
    const { service, input } = setup();
    const preview = service.prepare(11, input);
    expect(preview.files).toHaveLength(5);
    expect(JSON.stringify(preview)).not.toContain('/synthetic/');
    const result = service.confirm(11, { storeContext: input.storeContext, token: preview.token });
    expect(result).toMatchObject({ nativeAsinAuthority: false, formalEligibility: false, currency: 'unknown', attributionWindow: 'unknown', completeness: 'partial-observation' });
    expect(result.bindings).toHaveLength(5);
    expect(result.consumedHashes).toHaveLength(3);
    expect(result.days[1]).toMatchObject({ campaign: { metrics: { cost: 3 } }, campaignMinusAdGroup: { cost: 1 }, reconciliation: 'discrepancy' });
    expect(() => service.confirm(11, { storeContext: input.storeContext, token: preview.token })).toThrow();
  });
  it.each(['cancel', 'list', 'prepare'] as const)('%s invalidates old confirmation even after A-B-A selection', action => {
    const { service, input } = setup();
    const first = service.prepare(11, input);
    if (action === 'cancel') service.cancel(11);
    if (action === 'list') service.list(11, input);
    if (action === 'prepare') service.prepare(11, { ...input, familyLabel: 'Other family' });
    const current = service.prepare(11, input);
    expect(current.token).not.toBe(first.token);
    expect(() => service.confirm(11, { storeContext: input.storeContext, token: first.token })).toThrow();
    expect(() => service.confirm(11, { storeContext: input.storeContext, token: current.token })).toThrow();
  });
  it('binds tokens to IPC sender without consuming another sender token', () => {
    const { service, input } = setup(); const preview = service.prepare(11, input);
    expect(() => service.confirm(12, { storeContext: input.storeContext, token: preview.token })).toThrow();
    expect(service.confirm(11, { storeContext: input.storeContext, token: preview.token }).familyLabel).toBe(input.familyLabel);
  });
  it('rejects active-store A-B-A through durable session generation', () => {
    const { service, input, advance } = setup(); const preview = service.prepare(11, input); advance();
    expect(() => service.confirm(11, { storeContext: input.storeContext, token: preview.token })).toThrow(/stale/);
  });
  it('expires previews and never lets caller mutate held scope', () => {
    const { service, input, expire } = setup(); const preview = service.prepare(11, input);
    preview.familyLabel = 'forged'; preview.files[0].sha256 = 'forged';
    expect(service.confirm(11, { storeContext: input.storeContext, token: preview.token }).familyLabel).toBe('Synthetic family');
    const next = service.prepare(11, input); expire();
    expect(() => service.confirm(11, { storeContext: input.storeContext, token: next.token })).toThrow();
  });
  it.each(['storeId', 'status', 'sha256', 'version', 'filePath', 'dateTo'] as const)('rejects changed receipt %s', key => {
    const { service, input, files } = setup(); const preview = service.prepare(11, input);
    files[0][key] = 'changed';
    expect(() => service.confirm(11, { storeContext: input.storeContext, token: preview.token })).toThrow();
  });
  it('rehashes auxiliary bytes as well as consumed levels', () => {
    const { service, input, contents } = setup(); const preview = service.prepare(11, input);
    contents.set(5, Buffer.from('tampered'));
    expect(() => service.confirm(11, { storeContext: input.storeContext, token: preview.token })).toThrow();
  });
  it.each([[1, 1], [999], [], [2, 3]])('rejects invalid/foreign/incomplete file selection %j', (...ids) => {
    const { service, input } = setup();
    expect(() => service.prepare(11, { ...input, fileIds: ids as number[] })).toThrow();
  });
  it('ignores renderer paths and bytes while using IDs owned by Main', () => {
    const { service, input } = setup();
    const preview = service.prepare(11, { ...input, filePath: '/etc/passwd', bytes: 'forged' } as typeof input);
    expect(service.confirm(11, { storeContext: input.storeContext, token: preview.token }).days[1].campaign?.metrics.cost).toBe(3);
  });
  it('requires explicit context, honest dates, imported receipts and registered report levels', () => {
    const { service, input, files } = setup();
    expect(() => service.prepare(11, { ...input, dateFrom: '2026-02-30' })).toThrow();
    expect(() => service.prepare(11, { ...input, familyLabel: '' })).toThrow();
    files[0].status = 'downloaded';
    expect(service.list(11, input)).toHaveLength(4);
    expect(() => service.prepare(11, input)).toThrow();
  });
});

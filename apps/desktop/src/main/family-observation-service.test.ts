import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { LINGXING_TEMPLATE_MANIFEST, observeOwnerConfirmedFamily } from '@amazon-ai-ops/report-parser';
import { normalizeStoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { FamilyObservationService, type FamilyObservationSource, type FamilyObservationDependencies } from './family-observation-service';

function setup(observe: FamilyObservationDependencies['observe'] = async (scope, reports) => observeOwnerConfirmedFamily(scope, reports)) {
  let context = normalizeStoreContextEnvelope({ storeId: 'synthetic-store', browserProfileId: 'synthetic-profile', marketplace: 'US', currency: 'USD', businessTimezone: 'America/Los_Angeles', businessDate: '2026-01-02', sessionGeneration: 1 });
  let now = 0;
  let storeName = 'Synthetic store';
  const contents = new Map<number, Uint8Array>();
  const files: FamilyObservationSource[] = ['campaign', 'ad_group', 'keyword', 'placement', 'advertised_product'].map((reportType, i) => {
    const headers = LINGXING_TEMPLATE_MANIFEST.find(item => item.reportType === reportType)!.headers;
    const values: Record<string, string | number> = { '店铺名称': 'Synthetic store', '国家': 'US', '类型': 'SP', '广告活动': 'Synthetic campaign', '广告组': 'Synthetic group', '关键词': 'synthetic term', '匹配方式': '精准匹配', '日期': '2026-01-02', '曝光量': 100, '点击': 4, '花费-本币': reportType === 'campaign' ? 3 : 2, '广告订单': 1, '广告销售额-本币': 10 };
    const bytes = Buffer.from('\uFEFF' + headers.join(',') + '\n' + headers.map(header => values[header] ?? '').join(','));
    contents.set(i + 1, bytes);
    return { id: i + 1, fileName: `${reportType}.csv`, batchId: 'synthetic-batch', reportType, sha256: createHash('sha256').update(bytes).digest('hex'), dateFrom: '2026-01-01', dateTo: '2026-01-03', storeId: context.storeId, status: 'imported', filePath: `/synthetic/${reportType}.csv`, fileSize: bytes.byteLength, version: '1' };
  });
  const reservations: Array<{ bytes: number; release: () => void }> = [];
  const reserveInputBytes = vi.fn((bytes: number, _fileSizes: readonly number[]) => {
    const release = vi.fn(); reservations.push({ bytes, release }); return release;
  });
  const read = vi.fn((source: FamilyObservationSource) => contents.get(source.id)!);
  const service = new FamilyObservationService({ authority(submitted) {
    if (JSON.stringify(submitted) !== JSON.stringify(context)) throw new Error('stale context');
    return { context, storeName };
  }, files: () => files.map(file => ({ ...file })), read, observe, reserveInputBytes, now: () => now });
  const input = { storeContext: { ...context }, dateFrom: '2026-01-01', dateTo: '2026-01-03', fileIds: files.map(file => file.id), familyLabel: 'Synthetic family' };
  return { service, input, files, contents, read, reserveInputBytes, reservations,
    advance: () => { context = { ...context, sessionGeneration: context.sessionGeneration + 2 }; },
    expire: () => { now = 600000; }, rename: () => { storeName = 'Changed store'; } };
}
function deferredSetup() {
  const calls: Array<{ signal: AbortSignal; reports: Parameters<FamilyObservationDependencies['observe']>[1]; complete: () => void; fail: (error: Error) => void }> = [];
  const implementation: FamilyObservationDependencies['observe'] = (scope, reports, signal) => {
    const result = observeOwnerConfirmedFamily(scope, reports);
    return new Promise((resolve, reject) => calls.push({ signal, reports, complete: () => resolve(result), fail: reject }));
  };
  const observe = vi.fn(implementation);
  return { ...setup(observe), calls, observe };
}

describe('Main session-only family confirmation boundary', () => {
  it('confirms five exact files and observes only supported campaign/crosscheck/subset levels', async () => {
    const { service, input } = setup();
    const preview = service.prepare(11, input);
    expect(preview.files).toHaveLength(5);
    expect(JSON.stringify(preview)).not.toContain('/synthetic/');
    const result = await service.confirm(11, { storeContext: input.storeContext, token: preview.token });
    expect(result).toMatchObject({ nativeAsinAuthority: false, formalEligibility: false, currency: 'unknown', attributionWindow: 'unknown', completeness: 'partial-observation' });
    expect(result.bindings).toHaveLength(5);
    expect(result.consumedHashes).toHaveLength(3);
    expect(result.days[1]).toMatchObject({ campaign: { metrics: { cost: 3 } }, campaignMinusAdGroup: { cost: 1 }, reconciliation: 'discrepancy' });
    await expect(service.confirm(11, { storeContext: input.storeContext, token: preview.token })).rejects.toThrow();
  });
  it.each(['cancel', 'list', 'prepare'] as const)('%s invalidates old confirmation even after A-B-A selection', async action => {
    const { service, input } = setup();
    const first = service.prepare(11, input);
    if (action === 'cancel') service.cancel(11);
    if (action === 'list') service.list(11, input);
    if (action === 'prepare') service.prepare(11, { ...input, familyLabel: 'Other family' });
    const current = service.prepare(11, input);
    expect(current.token).not.toBe(first.token);
    await expect(service.confirm(11, { storeContext: input.storeContext, token: first.token })).rejects.toThrow();
    await expect(service.confirm(11, { storeContext: input.storeContext, token: current.token })).rejects.toThrow();
  });
  it('binds tokens to IPC sender without consuming another sender token', async () => {
    const { service, input } = setup(); const preview = service.prepare(11, input);
    await expect(service.confirm(12, { storeContext: input.storeContext, token: preview.token })).rejects.toThrow();
    expect((await service.confirm(11, { storeContext: input.storeContext, token: preview.token })).familyLabel).toBe(input.familyLabel);
  });
  it('rejects active-store A-B-A through durable session generation', async () => {
    const { service, input, advance } = setup(); const preview = service.prepare(11, input); advance();
    await expect(service.confirm(11, { storeContext: input.storeContext, token: preview.token })).rejects.toThrow(/stale/);
  });
  it('expires previews and never lets caller mutate held scope', async () => {
    const { service, input, expire } = setup(); const preview = service.prepare(11, input);
    preview.familyLabel = 'forged'; preview.files[0].sha256 = 'forged';
    expect((await service.confirm(11, { storeContext: input.storeContext, token: preview.token })).familyLabel).toBe('Synthetic family');
    const next = service.prepare(11, input); expire();
    await expect(service.confirm(11, { storeContext: input.storeContext, token: next.token })).rejects.toThrow();
  });
  it.each(['storeId', 'status', 'sha256', 'version', 'filePath', 'dateTo'] as const)('rejects changed receipt %s', async key => {
    const { service, input, files } = setup(); const preview = service.prepare(11, input);
    files[0][key] = 'changed';
    await expect(service.confirm(11, { storeContext: input.storeContext, token: preview.token })).rejects.toThrow();
  });
  it('rehashes auxiliary bytes as well as consumed levels', async () => {
    const { service, input, contents } = setup(); const preview = service.prepare(11, input);
    contents.set(5, Buffer.from('tampered'));
    await expect(service.confirm(11, { storeContext: input.storeContext, token: preview.token })).rejects.toThrow();
  });
  it.each([[1, 1], [999], [], [2, 3]])('rejects invalid/foreign/incomplete file selection %j', (...ids) => {
    const { service, input } = setup();
    expect(() => service.prepare(11, { ...input, fileIds: ids as number[] })).toThrow();
  });
  it('ignores renderer paths and bytes while using IDs owned by Main', async () => {
    const { service, input } = setup();
    const preview = service.prepare(11, { ...input, filePath: '/etc/passwd', bytes: 'forged' } as typeof input);
    expect((await service.confirm(11, { storeContext: input.storeContext, token: preview.token })).days[1].campaign?.metrics.cost).toBe(3);
  });
  it('requires explicit context, honest dates, imported receipts and registered report levels', async () => {
    const { service, input, files } = setup();
    expect(() => service.prepare(11, { ...input, dateFrom: '2026-02-30' })).toThrow();
    expect(() => service.prepare(11, { ...input, familyLabel: '' })).toThrow();
    files[0].status = 'downloaded';
    expect(service.list(11, input)).toHaveLength(4);
    expect(() => service.prepare(11, input)).toThrow();
  });
});

describe('产品族异步观察完成后的重新准入', () => {
  it('有效结果等待解析完成后才返回且令牌只能消费一次', async () => {
    const { service, input, calls, observe } = deferredSetup();
    const preview = service.prepare(11, input);
    const pending = service.confirm(11, { storeContext: input.storeContext, token: preview.token });
    expect(observe).toHaveBeenCalledTimes(1);
    expect(calls[0].signal.aborted).toBe(false);
    calls[0].complete();
    await expect(pending).resolves.toMatchObject({ familyLabel: input.familyLabel, formalEligibility: false, nativeAsinAuthority: false });
    await expect(service.confirm(11, { storeContext: input.storeContext, token: preview.token })).rejects.toThrow();
    expect(observe).toHaveBeenCalledTimes(1);
  });

  it.each(['cancel', 'list', 'prepare', 'duplicate-confirm'] as const)('等待期间 %s 使旧结果失效', async action => {
    const { service, input, calls, observe } = deferredSetup();
    const preview = service.prepare(11, input);
    const pending = service.confirm(11, { storeContext: input.storeContext, token: preview.token });
    const rejected = expect(pending).rejects.toThrow();
    expect(calls).toHaveLength(1);
    if (action === 'cancel') service.cancel(11);
    if (action === 'list') service.list(11, input);
    if (action === 'prepare') service.prepare(11, { ...input, familyLabel: 'New scope' });
    if (action === 'duplicate-confirm') await expect(service.confirm(11, { storeContext: input.storeContext, token: preview.token })).rejects.toThrow();
    expect(calls[0].signal.aborted).toBe(true);
    calls[0].complete();
    await rejected;
    expect(observe).toHaveBeenCalledTimes(1);
  });

  it.each(['session', 'store-name', 'expiry'] as const)('等待期间 %s 变化拒绝已完成的解析结果', async change => {
    const { service, input, calls, advance, rename, expire } = deferredSetup();
    const preview = service.prepare(11, input);
    const pending = service.confirm(11, { storeContext: input.storeContext, token: preview.token });
    const rejected = expect(pending).rejects.toThrow();
    if (change === 'session') advance();
    if (change === 'store-name') rename();
    if (change === 'expiry') expire();
    calls[0].complete();
    await rejected;
  });

  it.each(['storeId', 'status', 'sha256', 'version', 'filePath', 'dateTo'] as const)('等待期间回执 %s 变化拒绝旧结果', async key => {
    const { service, input, calls, files } = deferredSetup();
    const preview = service.prepare(11, input);
    const pending = service.confirm(11, { storeContext: input.storeContext, token: preview.token });
    const rejected = expect(pending).rejects.toThrow();
    files[0][key] = 'changed-during-parse';
    calls[0].complete();
    await rejected;
  });

  it.each([1, 5])('等待期间文件 %i 的同尺寸字节变化也必须重新验摘要', async id => {
    const { service, input, calls, contents } = deferredSetup();
    const preview = service.prepare(11, input);
    const pending = service.confirm(11, { storeContext: input.storeContext, token: preview.token });
    const rejected = expect(pending).rejects.toThrow();
    const replacement = Uint8Array.from(contents.get(id)!);
    replacement[0] ^= 1;
    contents.set(id, replacement);
    calls[0].complete();
    await rejected;
  });

  it('另一 IPC sender 的取消和预览不会撤销当前观察', async () => {
    const { service, input, calls } = deferredSetup();
    const preview = service.prepare(11, input);
    const pending = service.confirm(11, { storeContext: input.storeContext, token: preview.token });
    service.cancel(12);
    service.prepare(12, input);
    expect(calls[0].signal.aborted).toBe(false);
    calls[0].complete();
    await expect(pending).resolves.toMatchObject({ familyLabel: input.familyLabel });
  });

  it('旧请求的 finally 不清除同 sender 后建立的新观察', async () => {
    const { service, input, calls } = deferredSetup();
    const first = service.prepare(11, input);
    const old = service.confirm(11, { storeContext: input.storeContext, token: first.token });
    const oldRejected = expect(old).rejects.toThrow();
    const next = service.prepare(11, { ...input, familyLabel: 'New family' });
    const current = service.confirm(11, { storeContext: input.storeContext, token: next.token });
    expect(calls).toHaveLength(2);
    expect(calls[0].signal.aborted).toBe(true);
    calls[0].complete();
    await oldRejected;
    expect(calls[1].signal.aborted).toBe(false);
    calls[1].complete();
    await expect(current).resolves.toMatchObject({ familyLabel: 'New family', formalEligibility: false });
  });

  it('解析失败保留真实错误并允许新预览重新开始', async () => {
    const { service, input, calls, observe } = deferredSetup();
    const first = service.prepare(11, input);
    const pending = service.confirm(11, { storeContext: input.storeContext, token: first.token });
    const failure = new Error('isolated parser failed');
    const rejected = expect(pending).rejects.toBe(failure);
    calls[0].fail(failure);
    await rejected;
    await expect(service.confirm(11, { storeContext: input.storeContext, token: first.token })).rejects.toThrow();
    const next = service.prepare(11, input);
    const resumed = service.confirm(11, { storeContext: input.storeContext, token: next.token });
    calls[1].complete();
    await expect(resumed).resolves.toMatchObject({ familyLabel: input.familyLabel });
    expect(observe).toHaveBeenCalledTimes(2);
  });
});

describe('产品族输入预算的分配前准入与归还', () => {
  it('预览只保留临时额度，确认覆盖主输入和最后重读，完成后清除自有引用', async () => {
    const f = deferredSetup();
    const maximum = Math.max(...f.files.map(file => file.fileSize));
    const retained = f.files.filter(file => ['campaign', 'ad_group', 'keyword'].includes(file.reportType))
      .reduce((total, file) => total + file.fileSize, 0);
    const preview = f.service.prepare(11, f.input);
    expect(f.reserveInputBytes).toHaveBeenNthCalledWith(1, maximum, f.files.map(file => file.fileSize));
    expect(f.reservations[0].bytes).toBe(maximum);
    expect(f.reservations[0].release).toHaveBeenCalledTimes(1);
    const pending = f.service.confirm(11, { storeContext: f.input.storeContext, token: preview.token });
    expect(f.reserveInputBytes).toHaveBeenNthCalledWith(2, retained + maximum, f.files.map(file => file.fileSize));
    expect(f.reservations[1].bytes).toBe(retained + maximum);
    expect(f.reservations[1].release).not.toHaveBeenCalled();
    expect(f.calls[0].reports.every(report => report.bytes.byteLength > 0)).toBe(true);
    f.calls[0].complete(); await pending;
    expect(f.reservations[1].release).toHaveBeenCalledTimes(1);
    expect(f.calls[0].reports.every(report => report.bytes.byteLength === 0)).toBe(true);
    expect([...f.contents.values()].every(bytes => bytes.byteLength > 0)).toBe(true);
  });

  it.each(['prepare', 'confirm'] as const)('%s 预算不足时不读文件也不启动解析', async stage => {
    const f = deferredSetup();
    const preview = stage === 'confirm' ? f.service.prepare(11, f.input) : undefined;
    f.read.mockClear();
    const first = new Error('isolated input capacity exhausted');
    f.reserveInputBytes.mockImplementationOnce(() => { throw first; });
    if (stage === 'prepare') expect(() => f.service.prepare(11, f.input)).toThrow(first);
    else await expect(f.service.confirm(11, { storeContext: f.input.storeContext, token: preview!.token })).rejects.toBe(first);
    expect(f.read).not.toHaveBeenCalled();
    expect(f.observe).not.toHaveBeenCalled();
  });

  it.each(['prepare', 'confirm'] as const)('%s 读取失败归还已预留额度且保留原错误', async stage => {
    const f = deferredSetup();
    const preview = stage === 'confirm' ? f.service.prepare(11, f.input) : undefined;
    const first = new Error('isolated input read failed');
    f.read.mockImplementationOnce(() => { throw first; });
    if (stage === 'prepare') expect(() => f.service.prepare(11, f.input)).toThrow(first);
    else await expect(f.service.confirm(11, { storeContext: f.input.storeContext, token: preview!.token })).rejects.toBe(first);
    expect(f.reservations[f.reservations.length - 1].release).toHaveBeenCalledTimes(1);
    expect(f.observe).not.toHaveBeenCalled();
  });

  it.each(['cancel', 'observe-error', 'source-change'] as const)('%s 终态归还确认额度而不提前释放', async finish => {
    const f = deferredSetup();
    const preview = f.service.prepare(11, f.input);
    const pending = f.service.confirm(11, { storeContext: f.input.storeContext, token: preview.token });
    const rejected = expect(pending).rejects.toThrow();
    if (finish === 'cancel') f.service.cancel(11);
    if (finish === 'source-change') f.files[0].version = 'changed';
    expect(f.reservations[1].release).not.toHaveBeenCalled();
    if (finish === 'observe-error') f.calls[0].fail(new Error('isolated parser failure'));
    else f.calls[0].complete();
    await rejected;
    expect(f.reservations[1].release).toHaveBeenCalledTimes(1);
    expect(f.calls[0].reports.every(report => report.bytes.byteLength === 0)).toBe(true);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, 32 * 1024 * 1024 + 1])(
    '非法源尺寸 %s 在预留和读取之前拒绝', size => {
      const f = deferredSetup(); f.files[0].fileSize = size;
      expect(() => f.service.prepare(11, f.input)).toThrow();
      expect(f.reserveInputBytes).not.toHaveBeenCalled();
      expect(f.read).not.toHaveBeenCalled();
      expect(f.observe).not.toHaveBeenCalled();
    });
});

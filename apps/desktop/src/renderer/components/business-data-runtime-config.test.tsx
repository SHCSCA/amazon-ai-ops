import { describe, expect, it, vi } from 'vitest';
import { normalizedConfigurationWarningContext, withBusinessPipelineFixture } from './business-data-runtime-config.test-support';

describe('共享业务管线的隔离店铺配置前置（无真实授权）', () => {
  it('合法空投影保留 UNKNOWN，不调用分析并明确配置待创建', async () => {
    await withBusinessPipelineFixture({}, async page => {
      await vi.waitFor(async () => { expect(await page.evaluate(() => (window as any).businessPipelineFixture.latest?.loading)).toBe(false); });
      const result = await page.evaluate(() => { const f = (window as any).businessPipelineFixture; return { value: f.latest, counts: f.counts(), logs: f.logs, contexts: f.configReads.map((row: any) => row.context), context: f.context(), scope: f.scope }; });
      expect(result.value).toEqual({ data: null, error: null, loading: false, configurationRequired: true });
      expect(result.counts.pipeline).toBe(0); expect(result.counts.events).toBe(0);
      expect(result.contexts).toEqual([result.context]);
      expect(result.logs.filter((row: any) => row.level === 'error')).toEqual([]);
      expect(result.logs.filter((row: any) => row.event === 'business_data_unavailable')).toEqual([
        expect.objectContaining({ level: 'warn', context: normalizedConfigurationWarningContext({ reason: 'STORE_RUNTIME_CONFIG_MISSING', storeContext: result.context, mode: 'scope', scope: result.scope }) }),
      ]);
      expect(await page.locator('#pipeline-data').count()).toBe(0);
      await page.getByText('当前店铺运行配置待创建', { exact: true }).waitFor();
      await page.getByRole('button', { name: '打开店铺配置', exact: true }).click();
      expect(await page.evaluate(() => (window as any).businessPipelineFixture.navigations)).toEqual(['settings']);
    });
  }, 30_000);

  it('当前生效配置按同一权威范围读取真实管线并合并事件', async () => {
    await withBusinessPipelineFixture({ configMode: 'active' }, async page => {
      await vi.waitFor(async () => { expect(await page.evaluate(() => (window as any).businessPipelineFixture.latest?.data?.quant?.importedRows)).toBe(7); });
      const result = await page.evaluate(() => { const f = (window as any).businessPipelineFixture; return { value: f.latest, scope: f.pipelineReads[0].scope, expected: { ...f.scope, storeContext: f.context() }, counts: f.counts() }; });
      expect(result.scope).toEqual(result.expected); expect(result.counts).toMatchObject({ config: 1, pipeline: 1, events: 1 });
      expect(result.value).toMatchObject({ error: null, loading: false, configurationRequired: false, data: { quant: { importedRows: 7 }, operations: { eventCount: 1 } } });
      expect(await page.locator('#pipeline-data').textContent()).toBe('业务已读');
      expect(await page.locator('#pipeline-data').evaluate(element => element.parentElement?.id)).toBe('root');
    });
  }, 30_000);

  it('产品总览仍只清除 ASIN，配置读取携带完整当前权威', async () => {
    await withBusinessPipelineFixture({ configMode: 'active', mode: 'portfolio', asin: 'B000000001' }, async page => {
      await vi.waitFor(async () => { expect(await page.evaluate(() => (window as any).businessPipelineFixture.pipelineReads.length)).toBe(1); });
      const result = await page.evaluate(() => { const f = (window as any).businessPipelineFixture; return { scope: f.pipelineReads[0].scope, global: f.scope, config: f.configReads[0].context, context: f.context() }; });
      expect(result.scope.asin).toBeUndefined(); expect(result.global.asin).toBe('B000000001'); expect(result.config).toEqual(result.context);
    });
  }, 30_000);

  it('配置广播后重新授权读取配置，不按店铺缓存旧空投影', async () => {
    await withBusinessPipelineFixture({}, async page => {
      await vi.waitFor(async () => { expect(await page.evaluate(() => (window as any).businessPipelineFixture.latest?.configurationRequired)).toBe(true); });
      await page.evaluate(() => { const f = (window as any).businessPipelineFixture; f.setConfigMode('active'); f.broadcast(); });
      await vi.waitFor(async () => { expect(await page.evaluate(() => (window as any).businessPipelineFixture.latest?.data?.quant?.importedRows)).toBe(7); });
      expect(await page.evaluate(() => (window as any).businessPipelineFixture.counts())).toMatchObject({ config: 2, pipeline: 1 });
      expect(await page.evaluate(() => (window as any).businessPipelineFixture.latest.configurationRequired)).toBe(false);
    });
  }, 30_000);

  it('产品范围保留 ASIN 与批次，不混入范围外独立事件', async () => {
    await withBusinessPipelineFixture({ configMode: 'active', asin: 'B000000001' }, async page => {
      await vi.waitFor(async () => { expect(await page.evaluate(() => (window as any).businessPipelineFixture.latest?.data?.quant?.importedRows)).toBe(7); });
      const result = await page.evaluate(() => { const f = (window as any).businessPipelineFixture; return { value: f.latest, scope: f.pipelineReads[0].scope, expected: { ...f.scope, storeContext: f.context() }, counts: f.counts() }; });
      expect(result.scope).toEqual(result.expected);
      expect(result.counts).toMatchObject({ config: 1, pipeline: 1, events: 0 });
      expect(result.value.data.operations.eventCount).toBe(0);
    });
  }, 30_000);

  it('显式刷新也重新预检，合法配置移除后恢复 UNKNOWN', async () => {
    await withBusinessPipelineFixture({ configMode: 'active' }, async page => {
      await vi.waitFor(async () => { expect(await page.evaluate(() => (window as any).businessPipelineFixture.latest?.data?.quant?.importedRows)).toBe(7); });
      await page.evaluate(() => (window as any).businessPipelineFixture.setConfigMode('empty'));
      await page.getByRole('button', { name: '刷新业务范围', exact: true }).click();
      await vi.waitFor(async () => { expect(await page.evaluate(() => (window as any).businessPipelineFixture.latest?.configurationRequired)).toBe(true); });
      expect(await page.evaluate(() => (window as any).businessPipelineFixture.latest)).toEqual({ data: null, error: null, loading: false, configurationRequired: true });
      expect(await page.evaluate(() => (window as any).businessPipelineFixture.counts())).toMatchObject({ config: 2, pipeline: 1 });
    });
  }, 30_000);

  it.each(['reject', 'malformed', 'cross-store', 'archived', 'empty-history'])('配置 %s 继续失败并记录，不能变成合法待创建', async configMode => {
    await withBusinessPipelineFixture({ configMode }, async page => {
      await vi.waitFor(async () => { expect(await page.evaluate(() => (window as any).businessPipelineFixture.latest?.loading)).toBe(false); });
      const result = await page.evaluate(() => { const f = (window as any).businessPipelineFixture; return { value: f.latest, counts: f.counts(), logs: f.logs }; });
      expect(result.value.error).toBeTruthy(); expect(result.value.configurationRequired).toBe(false);
      expect(result.counts.pipeline).toBe(0);
      expect(result.logs.some((row: any) => row.level === 'error' && row.event === 'business.pipeline_read_failed')).toBe(true);
    });
  }, 30_000);

  it('配置有效后的管线 MISSING 仍为异常，不按错误文本降级', async () => {
    await withBusinessPipelineFixture({ configMode: 'active', pipelineMode: 'reject' }, async page => {
      await vi.waitFor(async () => { expect(await page.evaluate(() => (window as any).businessPipelineFixture.latest?.loading)).toBe(false); });
      const result = await page.evaluate(() => { const f = (window as any).businessPipelineFixture; return { value: f.latest, counts: f.counts(), logs: f.logs }; });
      expect(result.value.error).toBeTruthy(); expect(result.value.configurationRequired).toBe(false); expect(result.counts.pipeline).toBe(1);
      expect(result.logs.some((row: any) => row.level === 'error' && row.event === 'business.pipeline_read_failed')).toBe(true);
    });
  }, 30_000);

  it('配置端口缺失继续失败，不调用管线猜默认配置', async () => {
    await withBusinessPipelineFixture({ missingGetter: true }, async page => {
      await vi.waitFor(async () => { expect(await page.evaluate(() => (window as any).businessPipelineFixture.latest?.loading)).toBe(false); });
      const result = await page.evaluate(() => { const f = (window as any).businessPipelineFixture; return { value: f.latest, counts: f.counts(), logs: f.logs }; });
      expect(result.value.error).toBeTruthy(); expect(result.value.configurationRequired).toBe(false); expect(result.counts.pipeline).toBe(0);
      expect(result.logs.some((row: any) => row.event === 'business.pipeline_read_failed')).toBe(true);
    });
  }, 30_000);

  it('A→B→A 旧配置完成不能继续分析或覆盖当前空配置状态', async () => {
    await withBusinessPipelineFixture({ configMode: 'deferred' }, async page => {
      await vi.waitFor(async () => { expect(await page.evaluate(() => (window as any).businessPipelineFixture.configReads.length)).toBe(1); });
      await page.evaluate(() => (window as any).businessPipelineFixture.select('software-only-B', 1));
      await vi.waitFor(async () => { expect(await page.evaluate(() => (window as any).businessPipelineFixture.configReads.length)).toBe(2); });
      await page.evaluate(() => (window as any).businessPipelineFixture.select('software-only-A', 2));
      await vi.waitFor(async () => { expect(await page.evaluate(() => (window as any).businessPipelineFixture.configReads.length)).toBe(3); });
      await page.evaluate(() => (window as any).businessPipelineFixture.completeConfig(2, 'empty'));
      await vi.waitFor(async () => { expect(await page.evaluate(() => (window as any).businessPipelineFixture.latest?.configurationRequired)).toBe(true); });
      await page.evaluate(() => { const f = (window as any).businessPipelineFixture; f.completeConfig(0, 'active'); f.completeConfig(1, 'active'); });
      expect(await page.evaluate(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); const f = (window as any).businessPipelineFixture; return { value: f.latest, reads: f.pipelineReads.length }; })).toEqual({ value: { data: null, error: null, loading: false, configurationRequired: true }, reads: 0 });
    });
  }, 30_000);

  it('失效管线响应不能覆盖新世代配置待创建状态', async () => {
    await withBusinessPipelineFixture({ configMode: 'active', pipelineMode: 'deferred' }, async page => {
      await vi.waitFor(async () => { expect(await page.evaluate(() => (window as any).businessPipelineFixture.pipelineReads.length)).toBe(1); });
      await page.evaluate(() => { const f = (window as any).businessPipelineFixture; f.setConfigMode('empty'); f.select('software-only-B', 1); });
      await vi.waitFor(async () => { expect(await page.evaluate(() => (window as any).businessPipelineFixture.latest?.configurationRequired)).toBe(true); });
      await page.evaluate(() => (window as any).businessPipelineFixture.completePipeline(0));
      expect(await page.evaluate(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); return (window as any).businessPipelineFixture.latest; })).toEqual({ data: null, error: null, loading: false, configurationRequired: true });
    });
  }, 30_000);

  it('无权威店铺时不请求配置或分析', async () => {
    await withBusinessPipelineFixture({ noAuthority: true }, async page => {
      await vi.waitFor(async () => { expect(await page.evaluate(() => (window as any).businessPipelineFixture.latest?.loading)).toBe(false); });
      expect(await page.evaluate(() => (window as any).businessPipelineFixture.counts())).toMatchObject({ config: 0, pipeline: 0 });
    });
  }, 30_000);
});

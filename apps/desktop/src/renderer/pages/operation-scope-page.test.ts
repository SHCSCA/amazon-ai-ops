import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildOperationScopeSelectOptions,
  buildOperationScopeTaskState,
  normalizeOperationScopeDraft,
  operationScopeSignature,
  operationScopeSaveFeedbackLabel,
  resolveOperationScopeSaveStatus,
} from './operation-scope-page';

describe('operation scope task state', () => {
  it('uses scope confirmation as the first-screen primary task', () => {
    const state = buildOperationScopeTaskState({
      realReportCount: 8,
      importedReportTypeCount: 8,
      importedRows: 2416,
      activeBatch: 'batch_20260624_ready',
      saveStatus: 'idle',
      readiness: { status: 'ready', canEnterDiagnosis: true, nextStep: 'diagnose' },
    });

    expect(state.title).toBe('确认当前工作范围后查看广告表现');
    expect(state.detail).toContain('8/8 类真实报表');
    expect(state.primaryActionLabel).toBe('确认并保存范围');
    expect(state.nextActionLabel).toBe('查看广告表现');
    expect(state.nextRoute).toBe('ad-quant');
    expect(state.tone).toBe('ready');
  });

  it('routes downloaded-but-unimported scopes to import validation', () => {
    const state = buildOperationScopeTaskState({
      realReportCount: 8,
      importedReportTypeCount: 0,
      importedRows: 0,
      activeBatch: 'batch_waiting_import',
      saveStatus: 'idle',
      readiness: { status: 'blocked', canEnterDiagnosis: false, nextStep: 'import' },
    });

    expect(state.title).toBe('先导入当前范围的真实报表');
    expect(state.nextActionLabel).toBe('去导入校验');
    expect(state.nextRoute).toBe('data-import-validation');
    expect(state.tone).toBe('warning');
  });

  it('describes partial per-type imports without claiming that no metrics exist', () => {
    const state = buildOperationScopeTaskState({
      realReportCount: 8,
      importedReportTypeCount: 5,
      importedRows: 1879,
      activeBatch: 'batch_partial_import',
      saveStatus: 'idle',
      readiness: { status: 'blocked', canEnterDiagnosis: false, nextStep: 'import' },
    });

    expect(state.title).toBe('补齐当前范围的逐类入库');
    expect(state.detail).toBe('5/8 类已形成 1879 行日级广告指标，仍有 3 类待入库；保存范围后进入导入校验。');
    expect(state.detail).not.toContain('还没有日级广告指标入库');
  });

  it('routes empty scopes to data collection', () => {
    const state = buildOperationScopeTaskState({
      realReportCount: 0,
      importedReportTypeCount: 0,
      importedRows: 0,
      activeBatch: '',
      saveStatus: 'idle',
      readiness: { status: 'blocked', canEnterDiagnosis: false, nextStep: 'collect' },
    });

    expect(state.title).toBe('先获取当前范围的真实报表');
    expect(state.nextActionLabel).toBe('去数据采集');
    expect(state.nextRoute).toBe('data-collection');
    expect(state.tone).toBe('blocked');
  });

  it('does not route partial imported coverage into diagnosis', () => {
    const state = buildOperationScopeTaskState({
      realReportCount: 1,
      importedReportTypeCount: 1,
      importedRows: 30,
      activeBatch: 'batch_partial',
      saveStatus: 'idle',
      readiness: { status: 'partial', canEnterDiagnosis: false, nextStep: 'collect' },
    });

    expect(state.title).toBe('先补齐当前范围的真实报表');
    expect(state.nextActionLabel).toBe('去数据采集');
    expect(state.nextRoute).toBe('data-collection');
    expect(state.tone).toBe('warning');
  });

  it('formats save feedback for fixed aria-live space', () => {
    expect(operationScopeSaveFeedbackLabel('idle')).toBe('范围尚未手动确认');
    expect(operationScopeSaveFeedbackLabel('saving')).toBe('正在保存范围...');
    expect(operationScopeSaveFeedbackLabel('saved')).toBe('范围已保存，后续页面会按此读取');
    expect(operationScopeSaveFeedbackLabel('error')).toBe('范围保存失败，请展开处理');
  });

  it('keeps a successfully confirmed scope visibly saved across page remounts', () => {
    const scope = {
      dateFrom: '2026-08-10',
      dateTo: '2026-08-23',
      storeName: 'JF-US',
      marketplaceCode: 'US',
      currency: 'USD' as const,
      batchId: 'batch_20260825055104954_vk66s3',
    };
    const confirmedSignature = operationScopeSignature(scope);

    expect(resolveOperationScopeSaveStatus('idle', scope, confirmedSignature)).toBe('saved');
    expect(resolveOperationScopeSaveStatus('saving', scope, confirmedSignature)).toBe('saving');
    expect(resolveOperationScopeSaveStatus('error', scope, confirmedSignature)).toBe('error');
    expect(resolveOperationScopeSaveStatus('idle', { ...scope, dateTo: '2026-08-24' }, confirmedSignature)).toBe('idle');
  });

  it('normalizes draft scope before saving it to the shared operation scope', () => {
    expect(normalizeOperationScopeDraft({
      dateFrom: ' 2026-05-21 ',
      dateTo: ' 2026-06-23 ',
      storeName: ' FT-US-US ',
      marketplaceCode: ' US ',
      asin: ' B0GTTJFQTM ',
      batchId: ' ',
      currency: 'USD',
    })).toEqual({
      dateFrom: '2026-05-21',
      dateTo: '2026-06-23',
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      asin: 'B0GTTJFQTM',
      batchId: undefined,
      currency: 'USD',
    });
  });

  it('builds unique select options while keeping the active value first', () => {
    expect(buildOperationScopeSelectOptions('FT-US-US', ['FT-US-US', 'US-DEMO', '', null, 'US-DEMO'])).toEqual([
      'FT-US-US',
      'US-DEMO',
    ]);
  });

  it('renders a store-authorized inline editor so the page CRUD action is reachable', () => {
    const source = readFileSync(new URL('./operation-scope-page.tsx', import.meta.url), 'utf8');

    expect(source).toContain('buildDataReadinessLedger({');
    expect(source).toContain('dataLedger.canEnterDiagnosis');
    expect(source).toContain('lineageReadiness.canEnterDiagnosis');
    expect(source).toContain('listLingxingCollectionJobs({');
    expect(source).toContain('buildProductionCollectionLineageReadiness({');
    expect(source).toContain('其他批次不参与放行');
    expect(source).toContain("label: editing ? '收起编辑' : '编辑范围'");
    expect(source).toContain('className="operation-scope-editor-panel"');
    expect(source).toContain('title="编辑当前店铺范围"');
    expect(source).toContain('<FormTable>');
    expect(source).toContain('aria-label="运营范围开始日期"');
    expect(source).toContain('aria-label="运营范围结束日期"');
    expect(source).toContain('aria-label="运营范围 ASIN"');
    expect(source).toContain('aria-label="当前锁定店铺站点币种"');
    expect(source).toContain('店铺、站点和币种已按当前店铺锁定，不能跨店修改。');
    expect(source).not.toContain('Main StoreContext');
    expect(source).toContain('void confirmScope(draft)');
    expect(source).toContain('title="范围字段确认"');
    expect(source).toContain('className="operation-scope-field-card"');
    expect(source).toContain('后续读取与影响页面');
    expect(source).not.toContain('operation-scope-prototype-status-grid');
    expect(source).not.toContain('KpiCard');
    expect(source).not.toContain('className="action-row operation-scope-prototype-actions"');
    expect(source).toContain('className="scope-impact-tags"');
    expect(source).not.toContain('className="workflow-step"');
    expect(source).not.toContain('Panel title="这个范围会影响哪些页面"');
    expect(source).not.toContain('Panel title="推荐下一步"');
    expect(source).not.toContain('Panel title="范围确认与下一步"');
    expect(source).not.toContain('Panel title="当前范围摘要"');
    expect(source).not.toContain('Panel title="范围设置"');
    expect(source).toContain('api.saveOperationScope(storeContext, normalizedDraft)');
    expect(source).not.toContain("amazon-ai-ops:open-scope-editor");
  });

  it('uses one shared task banner while keeping the editor save action local to its form', () => {
    const source = readFileSync(new URL('./operation-scope-page.tsx', import.meta.url), 'utf8');
    const header = source.slice(source.indexOf('<PageHeader'), source.indexOf('/>', source.indexOf('<PageHeader')) + 2);

    expect(source.match(/<TaskBanner/g)).toHaveLength(1);
    expect(header).not.toContain('primaryAction=');
    expect(source.match(/className="primary-button"/g)).toHaveLength(1);
    expect(source).toContain('aria-label="范围编辑动作"');
  });
});

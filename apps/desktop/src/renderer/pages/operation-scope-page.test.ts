import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildOperationScopeSelectOptions,
  buildOperationScopeTaskState,
  normalizeOperationScopeDraft,
  operationScopeSaveFeedbackLabel,
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

  it('keeps range editing in the global scope editor instead of rendering a duplicate page form', () => {
    const source = readFileSync(new URL('./operation-scope-page.tsx', import.meta.url), 'utf8');

    expect(source).toContain('buildDataReadinessLedger({');
    expect(source).toContain('const canQuantify = dataLedger.canEnterDiagnosis;');
    expect(source).toContain("window.dispatchEvent(new CustomEvent('amazon-ai-ops:open-scope-editor'))");
    expect(source).toContain("{ label: '编辑范围', onClick: openScopeEditor");
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
    expect(source).not.toContain('<FormTable>');
    expect(source).toContain('api.saveOperationScope(normalizedDraft)');
  });

  it('uses one shared task banner instead of a second PageHeader primary action', () => {
    const source = readFileSync(new URL('./operation-scope-page.tsx', import.meta.url), 'utf8');
    const header = source.slice(source.indexOf('<PageHeader'), source.indexOf('/>', source.indexOf('<PageHeader')) + 2);

    expect(source.match(/<TaskBanner/g)).toHaveLength(1);
    expect(header).not.toContain('primaryAction=');
    expect(source).not.toContain('className="primary-button"');
  });
});

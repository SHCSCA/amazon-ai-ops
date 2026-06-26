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
      importedRows: 2416,
      activeBatch: 'batch_20260624_ready',
      saveStatus: 'idle',
    });

    expect(state.title).toBe('确认当前范围后进入广告量化');
    expect(state.detail).toContain('8/8 类真实报表');
    expect(state.primaryActionLabel).toBe('确认并保存范围');
    expect(state.nextActionLabel).toBe('进入广告量化');
    expect(state.nextRoute).toBe('ad-quant');
    expect(state.tone).toBe('ready');
  });

  it('routes downloaded-but-unimported scopes to import validation', () => {
    const state = buildOperationScopeTaskState({
      realReportCount: 8,
      importedRows: 0,
      activeBatch: 'batch_waiting_import',
      saveStatus: 'idle',
    });

    expect(state.title).toBe('先导入当前范围的真实报表');
    expect(state.nextActionLabel).toBe('去导入校验');
    expect(state.nextRoute).toBe('data-import-validation');
    expect(state.tone).toBe('warning');
  });

  it('routes empty scopes to data collection', () => {
    const state = buildOperationScopeTaskState({
      realReportCount: 0,
      importedRows: 0,
      activeBatch: '',
      saveStatus: 'idle',
    });

    expect(state.title).toBe('先获取当前范围的真实报表');
    expect(state.nextActionLabel).toBe('去数据采集');
    expect(state.nextRoute).toBe('data-collection');
    expect(state.tone).toBe('blocked');
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

  it('renders the page-level range form with field confirmation hooks', () => {
    const source = readFileSync(new URL('./operation-scope-page.tsx', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

    expect(source).toContain('Panel title="范围表单"');
    expect(source).toContain("scopeFieldFeedbackClass('storeName'");
    expect(source).toContain("scopeFieldFeedbackClass('marketplaceCode'");
    expect(source).toContain("scopeFieldFeedbackClass('dateFrom'");
    expect(source).toContain("scopeFieldFeedbackClass('dateTo'");
    expect(source).toContain("scopeFieldFeedbackClass('asin'");
    expect(source).toContain("scopeFieldFeedbackClass('batchId'");
    expect(source).toContain('api.saveOperationScope(normalizedDraft)');
    expect(css).toContain('.operation-scope-field');
    expect(css).toContain('.operation-scope-date-range');
    expect(css).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
  });
});

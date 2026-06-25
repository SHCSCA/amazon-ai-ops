import { describe, expect, it } from 'vitest';
import {
  buildOperationScopeTaskState,
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
});

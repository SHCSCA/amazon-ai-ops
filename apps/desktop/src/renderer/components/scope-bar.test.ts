import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildScopeCompactContextLabel,
  buildScopeCompactRangeLabel,
  buildScopeSummaryFacts,
  buildScopeWarningSummary,
  formatBatchOption,
  scopeEditorSaveButtonView,
  scopeFieldFeedbackClass,
  scopeFieldFeedbackLabel,
} from './scope-bar';

function cssRuleBody(css: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`));
  return match?.[1] ?? '';
}

describe('formatBatchOption', () => {
  it('describes batch coverage by report type and imported metric rows', () => {
    expect(formatBatchOption({
      id: 'batch_20260612',
      status: 'completed',
      dateStart: '2026-06-01',
      dateEnd: '2026-06-12',
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      totalFileRecords: 8,
      realReportFileCount: 8,
      importedReportTypeCount: 8,
      importedRowCount: 96,
      missingReportLabels: [],
    })).toBe('batch_20260612 · 报表文件 8/8 类 · 逐类入库 8/8 类 · 96 行');
  });

  it('does not leak undefined when batch counters are missing', () => {
    const label = formatBatchOption({
      id: 'batch_incomplete',
      status: 'completed',
      dateStart: '2026-06-01',
      dateEnd: '2026-06-12',
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      totalFileRecords: undefined,
      realReportFileCount: undefined,
      importedRowCount: undefined,
      missingReportLabels: [],
    } as any);

    expect(label).toBe('batch_incomplete · 报表文件待校验 · 逐类入库待校验');
    expect(label).not.toContain('undefined');
  });

  it('separates report type coverage from duplicate file count', () => {
    expect(formatBatchOption({
      id: 'batch_duplicate_files',
      status: 'completed',
      dateStart: '2026-06-01',
      dateEnd: '2026-06-12',
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      totalFileRecords: 16,
      realReportFileCount: 16,
      importedReportTypeCount: 5,
      importedRowCount: 120,
      missingReportLabels: [],
    } as any)).toBe('batch_duplicate_files · 报表文件 8/8 类 · 16 个文件 · 逐类入库 5/8 类 · 120 行');
  });
});

describe('buildScopeSummaryFacts', () => {
  it('always exposes exactly the four compact fact labels', () => {
    const facts = buildScopeSummaryFacts({
      batchId: 'batch_20260612',
      batchModeLabel: '自动使用当前范围最新完整批次',
      reportCoverage: '8/8 类真实报表',
      importedRows: '96 行',
      asin: 'B0TESTASIN',
    });

    expect(facts).toHaveLength(4);
    expect(facts.map((fact) => fact.label)).toEqual(['产品', '报表文件', '逐类入库', '追溯批次']);
  });

  it('keeps the always-visible scope bar to four compact facts', () => {
    expect(buildScopeSummaryFacts({
      batchId: 'batch_20260612',
      batchModeLabel: '自动使用当前范围最新完整批次',
      reportCoverage: '8/8 类真实报表',
      importedRows: '96 行',
      asin: 'B0TESTASIN',
    })).toEqual([
      { label: '产品', value: 'B0TESTASIN' },
      { label: '报表文件', value: '8/8 类真实报表' },
      { label: '逐类入库', value: '96 行' },
      { label: '追溯批次', value: 'batch_20260612', title: '自动使用当前范围最新完整批次' },
    ]);
  });

  it('uses short placeholders instead of long guidance when no batch or ASIN is selected', () => {
    expect(buildScopeSummaryFacts({
      batchModeLabel: '自动匹配当前范围',
      reportCoverage: '暂无匹配批次',
      importedRows: '0 行',
    }).map((fact) => fact.value)).toEqual(['全部产品', '暂无匹配批次', '0 行', '自动匹配']);
  });

  it('keeps long manual batch IDs as data, not explanatory helper copy', () => {
    const longBatchId = 'batch_20260612020905629_gkchz1_manual_operator_selected_for_readback';
    const facts = buildScopeSummaryFacts({
      batchId: longBatchId,
      batchModeLabel: '手动批次待校验',
      reportCoverage: '手动批次待校验',
      importedRows: '待校验',
    });

    expect(facts[3]).toMatchObject({ label: '追溯批次', value: longBatchId, title: '手动批次待校验' });
    expect(facts[3].value).not.toContain('当前使用手动批次');
    expect(facts[3].value).not.toContain('后续页面会按这个 ID 尝试读取');
  });
});

describe('compact scope labels', () => {
  it('keeps the always-visible topbar range label short', () => {
    expect(buildScopeCompactRangeLabel({
      dateFrom: '2026-05-21',
      dateTo: '2026-06-23',
    })).toBe('2026-05-21 ~ 2026-06-23');

    expect(buildScopeCompactRangeLabel({})).toBe('日期待设置');
  });

  it('reserves enough topbar width to keep imported row facts visible', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
    const factRule = cssRuleBody(css, '.topbar .scope-topbar-fact');

    expect(factRule).toMatch(/max-width\s*:\s*184px\s*;/);
  });

  it('keeps store, marketplace, and product context separate from the date range', () => {
    expect(buildScopeCompactContextLabel({
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      asin: 'B0GTTJFQTM',
    })).toBe('FT-US-US / US / B0GTTJFQTM');

    expect(buildScopeCompactContextLabel({})).toBe('未选店铺 / 未选站点 / 全部产品');
  });
});

describe('scope field feedback micro-response', () => {
  it('labels changed fields as recorded without claiming unsaved draft fields are committed', () => {
    expect(scopeFieldFeedbackLabel('storeName')).toBe('店铺已记录为待保存范围');
    expect(scopeFieldFeedbackLabel('dateFrom')).toBe('开始日期已记录为待保存范围');
    expect(scopeFieldFeedbackLabel('batchId')).toBe('批次已记录为当前范围');
  });

  it('adds the confirmed class only to the active scope field', () => {
    expect(scopeFieldFeedbackClass('storeName', 'storeName')).toBe('scope-field-feedback-shell scope-field-confirmed');
    expect(scopeFieldFeedbackClass('dateTo', 'storeName')).toBe('scope-field-feedback-shell');
    expect(scopeFieldFeedbackClass('batchId', 'batchId', 'scope-title-action-field')).toBe('scope-title-action-field scope-field-confirmed');
  });

  it('keeps the field confirmation status space stable and animated in CSS', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

    expect(css).toContain('.scope-field-confirmation');
    expect(css).toContain('min-height: 14px');
    expect(css).toContain('.scope-field-confirmed input');
    expect(css).toContain('.scope-field-confirmed select');
    expect(css).toContain('@keyframes scope-field-confirm-pulse');
  });

  it('renders scope details and the range editor as popovers so opening them does not push the workspace', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
    const topbarRule = cssRuleBody(css, '.topbar');
    const compactTriggerRule = cssRuleBody(css, '.topbar .scope-compact-trigger');
    const topbarDetailsRule = cssRuleBody(css, '.topbar .scope-details-panel');
    const editorRule = cssRuleBody(css, '.scope-editor');

    expect(topbarRule).toMatch(/min-height\s*:\s*40px\s*;/);
    expect(compactTriggerRule).toMatch(/display\s*:\s*grid\s*;/);
    expect(compactTriggerRule).toMatch(/grid-template-columns\s*:\s*auto minmax\(138px,\s*auto\) minmax\(120px,\s*1fr\) auto\s*;/);
    expect(topbarDetailsRule).toMatch(/display\s*:\s*block\s*;/);
    expect(topbarDetailsRule).toMatch(/position\s*:\s*absolute\s*;/);
    expect(topbarDetailsRule).toMatch(/top\s*:\s*calc\(100%\s*\+\s*6px\)\s*;/);
    expect(topbarDetailsRule).toMatch(/z-index\s*:\s*260\s*;/);
    expect(editorRule).toMatch(/position\s*:\s*absolute\s*;/);
    expect(editorRule).toMatch(/top\s*:\s*calc\(100%\s*\+\s*8px\)\s*;/);
    expect(editorRule).toMatch(/left\s*:\s*10px\s*;/);
    expect(editorRule).toMatch(/right\s*:\s*10px\s*;/);
    expect(editorRule).toMatch(/z-index\s*:\s*40\s*;/);
    expect(css).not.toMatch(/\.scope-editor\s*\{[^}]*position\s*:\s*static\s*;/);
  });

  it('gives the editor save action an explicit busy contract', () => {
    const idle = scopeEditorSaveButtonView(false);
    const saving = scopeEditorSaveButtonView(true);

    expect(idle.label).toBe('保存范围');
    expect(idle.disabled).toBe(false);
    expect(idle.ariaBusy).toBe(false);
    expect(idle.showSpinner).toBe(false);
    expect(idle.className).toBe('primary-button');

    expect(saving.label).toBe('正在保存...');
    expect(saving.disabled).toBe(true);
    expect(saving.ariaBusy).toBe(true);
    expect(saving.showSpinner).toBe(true);
    expect(saving.className).toContain('primary-button');
    expect(saving.className).toContain('button-loading');
  });
});

describe('buildScopeWarningSummary', () => {
  it('collapses raw scope and batch failures into one short visible warning', () => {
    const visibleWarning = buildScopeWarningSummary({
      batchOptionsError: '读取当前范围批次失败：Error: database busy while loading all historical report files and imported metric rows',
      scopePersistError: '保存运营范围失败：Error: permission denied for local profile storage path',
    });

    expect(visibleWarning).toBe('范围或批次需要处理，展开查看详情。');
    expect(visibleWarning).not.toContain('database busy');
    expect(visibleWarning).not.toContain('permission denied');
  });

  it('stays hidden when there are no scope or batch failures', () => {
    expect(buildScopeWarningSummary({ batchOptionsError: null, scopePersistError: '' })).toBeNull();
  });
});

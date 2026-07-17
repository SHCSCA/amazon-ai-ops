import { describe, expect, it } from 'vitest';
import { assertFormalBusinessWorkflowReady } from './formal-business-data-gate';

const REQUIRED_REPORT_TYPES = [
  'campaign',
  'ad_group',
  'placement',
  'advertised_product',
  'auto_targeting',
  'keyword',
  'product_targeting',
  'user_search_term',
] as const;

function completeReportFiles() {
  return REQUIRED_REPORT_TYPES.map((reportType) => ({
    reportType,
    importedRows: 10,
  }));
}

describe('formal business data gate', () => {
  it('blocks formal recommendation generation when only 7 of 8 report types have real files', () => {
    expect(() => assertFormalBusinessWorkflowReady({
      workflow: 'recommendation',
      requiredReportTypes: REQUIRED_REPORT_TYPES,
      realReportFiles: completeReportFiles().slice(0, 7),
    })).toThrow('生成优化建议被阻断：当前范围仅有 7/8 类真实广告报表');
  });

  it('blocks formal diagnosis when one real report type has zero imported rows', () => {
    const realReportFiles = completeReportFiles();
    realReportFiles[7] = { ...realReportFiles[7], importedRows: 0 };

    expect(() => assertFormalBusinessWorkflowReady({
      workflow: 'diagnosis',
      requiredReportTypes: REQUIRED_REPORT_TYPES,
      realReportFiles,
    })).toThrow('AI 阶段诊断被阻断：仅有 7/8 类真实报表形成 DB 日级指标');
  });

  it('blocks keyword opportunities when duplicate files do not cover 8 distinct report types', () => {
    const realReportFiles = completeReportFiles().slice(0, 7);
    realReportFiles.push({ ...realReportFiles[0], importedRows: 30 });

    expect(() => assertFormalBusinessWorkflowReady({
      workflow: 'keyword-opportunities',
      requiredReportTypes: REQUIRED_REPORT_TYPES,
      realReportFiles,
    })).toThrow('读取关键词机会被阻断：当前范围仅有 7/8 类真实广告报表');
  });

  it('allows formal workflows only when every required report type has imported rows', () => {
    expect(assertFormalBusinessWorkflowReady({
      workflow: 'recommendation',
      requiredReportTypes: REQUIRED_REPORT_TYPES,
      realReportFiles: completeReportFiles(),
    })).toEqual({
      requiredReportCount: 8,
      realReportTypeCount: 8,
      importedReportTypeCount: 8,
    });
  });

  it('fails closed when the required report configuration does not define 8 distinct types', () => {
    expect(() => assertFormalBusinessWorkflowReady({
      workflow: 'recommendation',
      requiredReportTypes: REQUIRED_REPORT_TYPES.slice(0, 7),
      realReportFiles: completeReportFiles().slice(0, 7),
    })).toThrow('正式数据门配置无效：必须定义 8 个 distinct 报表类型');
  });
});

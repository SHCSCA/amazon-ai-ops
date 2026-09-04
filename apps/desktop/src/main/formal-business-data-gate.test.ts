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

function completeReportFiles(): Array<{
  reportType: (typeof REQUIRED_REPORT_TYPES)[number];
  importedRows: number;
  status?: string;
}> {
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

  it('accepts a receipt-backed zero-row report as imported business truth', () => {
    const realReportFiles = completeReportFiles();
    realReportFiles[7] = { ...realReportFiles[7], importedRows: 0, status: 'imported' };

    expect(assertFormalBusinessWorkflowReady({
      workflow: 'diagnosis',
      requiredReportTypes: REQUIRED_REPORT_TYPES,
      realReportFiles,
    })).toMatchObject({ importedReportTypeCount: 8 });
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

  it('blocks formal analysis when eight report types are assembled from different collection batches', () => {
    const realReportFiles = completeReportFiles().map((file, index) => ({
      ...file,
      batchId: index === 7 ? 'batch-older-partial' : 'batch-current-full8',
    }));

    expect(() => assertFormalBusinessWorkflowReady({
      workflow: 'recommendation',
      requiredReportTypes: REQUIRED_REPORT_TYPES,
      realReportFiles,
    })).toThrow('生成优化建议被阻断：8 类真实报表不属于同一个完整采集批次');
  });

  it('blocks an eight-file local batch that has no durable production collection root', () => {
    const realReportFiles = completeReportFiles().map((file) => ({
      ...file,
      batchId: 'batch_local_202608280001',
    }));

    expect(() => assertFormalBusinessWorkflowReady({
      workflow: 'recommendation',
      requiredReportTypes: REQUIRED_REPORT_TYPES,
      realReportFiles,
    })).toThrow(
      '生成优化建议被阻断：当前 8 类批次缺少已成功入库的正式完整采集任务或 production_full 根血缘；'
      + '本地导入不能替代正式采集。请启动“重新获取完整 8 类报表”，等待采集与导入完成后重试。',
    );
  });

  it('blocks formal analysis while a valid production root import is still pending', () => {
    const batchId = 'batch-production-full8';
    const realReportFiles = completeReportFiles().map((file) => ({ ...file, batchId }));

    expect(() => assertFormalBusinessWorkflowReady({
      workflow: 'recommendation',
      requiredReportTypes: REQUIRED_REPORT_TYPES,
      realReportFiles,
      collectionJob: {
        jobId: batchId,
        state: 'completed',
        importState: 'pending',
        request: { requestId: 'lx:production-full8-pending', reportTypes: REQUIRED_REPORT_TYPES },
        lineage: {
          lineageId: batchId,
          rootJobId: batchId,
          expectedReportTypes: REQUIRED_REPORT_TYPES,
          purpose: 'production_full',
        },
      },
    })).toThrow(
      '生成优化建议被阻断：当前完整 8 类采集尚未完成生产入库；'
      + '请等待当前任务显示“采集完成、入库成功”，或重新获取完整 8 类后重试。',
    );
  });

  it('allows formal analysis after the exact production root has completed and imported successfully', () => {
    const batchId = 'batch-production-full8-ready';
    const realReportFiles = completeReportFiles().map((file) => ({ ...file, batchId }));

    expect(assertFormalBusinessWorkflowReady({
      workflow: 'recommendation',
      requiredReportTypes: REQUIRED_REPORT_TYPES,
      realReportFiles,
      collectionJob: {
        jobId: batchId,
        state: 'completed',
        importState: 'succeeded',
        request: { requestId: 'lx:production-full8-ready', reportTypes: REQUIRED_REPORT_TYPES },
        lineage: {
          lineageId: batchId,
          rootJobId: batchId,
          expectedReportTypes: REQUIRED_REPORT_TYPES,
          purpose: 'production_full',
        },
      },
    })).toEqual({
      requiredReportCount: 8,
      realReportTypeCount: 8,
      importedReportTypeCount: 8,
    });
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

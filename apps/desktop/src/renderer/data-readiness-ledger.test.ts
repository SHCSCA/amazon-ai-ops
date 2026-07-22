import { describe, expect, it } from 'vitest';
import { buildDataReadinessLedger } from './data-readiness-ledger';

describe('buildDataReadinessLedger', () => {
  it('summarizes the four-step data pipeline when reports are created, downloaded, imported and usable', () => {
    const ledger = buildDataReadinessLedger({
      requiredReportCount: 8,
      reportOptions: Array.from({ length: 8 }, (_, index) => ({
        type: `report_${index}`,
        label: `报表 ${index + 1}`,
        status: 'downloaded',
        realFileAvailable: true,
        importedRows: index + 1,
      })),
      realReportFileCount: 8,
      importedRowCount: 2416,
      rejectedEvidenceFileCount: 3,
    });

    expect(ledger.stages).toEqual([
      expect.objectContaining({
        key: 'created',
        status: 'complete',
        title: '领星任务已创建',
        value: '8/8',
      }),
      expect.objectContaining({
        key: 'downloaded',
        status: 'complete',
        title: '真实报表已下载',
        value: '8/8',
      }),
      expect.objectContaining({
        key: 'imported',
        status: 'complete',
        title: '日级指标已入库',
        value: '8/8 类 · 2416 行',
      }),
      expect.objectContaining({
        key: 'usable',
        status: 'complete',
        title: '可用于 AI+规则建议',
        value: '已放行',
      }),
    ]);

    expect(ledger.nextAction).toBe('查看广告表现');
    expect(ledger.detail).toContain('可用于广告表现');
    expect(ledger.stages[3].detail).toContain('可以查看广告表现');
  });

  it('separates created reports from downloaded real files and imported DB rows', () => {
    const ledger = buildDataReadinessLedger({
      requiredReportCount: 8,
      reportOptions: [
        { type: 'campaign', label: '广告活动报告', status: 'created', realFileAvailable: false, importedRows: 0 },
        { type: 'ad_group', label: '广告组报告', status: 'downloaded', realFileAvailable: true, importedRows: 30 },
        { type: 'search_term', label: '用户搜索词报告', status: 'missing', realFileAvailable: false, importedRows: 0 },
      ],
      realReportFileCount: 1,
      importedRowCount: 30,
      rejectedEvidenceFileCount: 0,
    });

    expect(ledger.stages.map((stage) => [stage.key, stage.status, stage.value])).toEqual([
      ['created', 'partial', '2/8'],
      ['downloaded', 'partial', '1/8'],
      ['imported', 'partial', '1/8 类 · 30 行'],
      ['usable', 'blocked', '未放行'],
    ]);
    expect(ledger.stages[3].detail).toContain('补齐真实报表和导入缺口后才会放行');
  });

  it('keeps one imported report out of eight partial and blocks diagnosis', () => {
    const ledger = buildDataReadinessLedger({
      requiredReportCount: 8,
      reportOptions: [
        { type: 'campaign', label: '广告活动报告', status: 'imported', realFileAvailable: true, importedRows: 30 },
        ...Array.from({ length: 7 }, (_, index) => ({
          type: `missing_${index}`,
          label: `缺失报表 ${index + 1}`,
          status: 'missing',
          realFileAvailable: false,
          importedRows: 0,
        })),
      ],
      realReportFileCount: 1,
      importedRowCount: 30,
      rejectedEvidenceFileCount: 0,
    });

    expect(ledger.status).toBe('partial');
    expect(ledger.canEnterDiagnosis).toBe(false);
    expect(ledger.nextStep).toBe('collect');
    expect(ledger.headline).not.toContain('已闭合');
    expect(ledger.stages.find((stage) => stage.key === 'imported')).toMatchObject({
      status: 'partial',
      value: '1/8 类 · 30 行',
    });
  });

  it('blocks diagnosis when all eight files exist but one report type has zero imported rows', () => {
    const ledger = buildDataReadinessLedger({
      requiredReportCount: 8,
      reportOptions: Array.from({ length: 8 }, (_, index) => ({
        type: `report_${index}`,
        label: `报表 ${index + 1}`,
        status: index === 7 ? 'downloaded' : 'imported',
        realFileAvailable: true,
        importedRows: index === 7 ? 0 : index + 1,
      })),
      realReportFileCount: 8,
      importedRowCount: 28,
      rejectedEvidenceFileCount: 0,
    });

    expect(ledger.status).toBe('blocked');
    expect(ledger.canEnterDiagnosis).toBe(false);
    expect(ledger.nextStep).toBe('import');
    expect(ledger.nextAction).toBe('导入已下载表格');
    expect(ledger.gaps).toContain('已有 1 类真实报表未形成 DB 日级指标');
    expect(ledger.stages.find((stage) => stage.key === 'usable')).toMatchObject({
      status: 'blocked',
      value: '未放行',
    });
  });

  it('allows diagnosis only when every required report type has imported rows', () => {
    const ledger = buildDataReadinessLedger({
      requiredReportCount: 8,
      reportOptions: Array.from({ length: 8 }, (_, index) => ({
        type: `report_${index}`,
        label: `报表 ${index + 1}`,
        status: 'imported',
        realFileAvailable: true,
        importedRows: index + 1,
      })),
      realReportFileCount: 8,
      importedRowCount: 36,
      rejectedEvidenceFileCount: 0,
    });

    expect(ledger.status).toBe('ready');
    expect(ledger.canEnterDiagnosis).toBe(true);
    expect(ledger.nextStep).toBe('diagnose');
  });

  it('treats a receipt-backed zero-row report as imported instead of looping back to import', () => {
    const ledger = buildDataReadinessLedger({
      requiredReportCount: 8,
      reportOptions: Array.from({ length: 8 }, (_, index) => ({
        type: `report_${index}`,
        label: `报表 ${index + 1}`,
        status: 'imported',
        realFileAvailable: true,
        importedRows: index === 7 ? 0 : index + 1,
      })),
      realReportFileCount: 8,
      importedRowCount: 28,
      rejectedEvidenceFileCount: 0,
    });

    expect(ledger.status).toBe('ready');
    expect(ledger.canEnterDiagnosis).toBe(true);
    expect(ledger.nextStep).toBe('diagnose');
    expect(ledger.stages.find((stage) => stage.key === 'imported')).toMatchObject({
      status: 'complete',
      value: '8/8 类 · 28 行',
    });
  });

  it('accepts a fully receipt-backed zero-row date range as a verified business zero state', () => {
    const ledger = buildDataReadinessLedger({
      requiredReportCount: 8,
      reportOptions: Array.from({ length: 8 }, (_, index) => ({
        type: `report_${index}`,
        label: `报表 ${index + 1}`,
        status: 'imported',
        realFileAvailable: true,
        importedRows: 0,
      })),
      realReportFileCount: 8,
      importedRowCount: 0,
      rejectedEvidenceFileCount: 0,
    });

    expect(ledger.status).toBe('ready');
    expect(ledger.nextStep).toBe('diagnose');
    expect(ledger.stages.find((stage) => stage.key === 'imported')?.detail).toContain('0 行业务零状态');
  });

  it('tells the operator to import when real files exist but DB rows are missing', () => {
    const ledger = buildDataReadinessLedger({
      requiredReportCount: 8,
      reportOptions: [
        { type: 'search_term', label: '用户搜索词报告', status: 'downloaded', realFileAvailable: true, importedRows: 0 },
        { type: 'keyword', label: '关键词报告', status: 'missing', realFileAvailable: false, importedRows: 0 },
      ],
      realReportFileCount: 1,
      importedRowCount: 0,
      rejectedEvidenceFileCount: 0,
    });

    expect(ledger.status).toBe('blocked');
    expect(ledger.headline).toContain('已有真实报表，等待导入');
    expect(ledger.nextAction).toBe('导入已下载表格');
    expect(ledger.gaps).toContain('缺少 7 类真实广告报表');
    expect(ledger.gaps).toContain('已有 1 类真实报表未形成 DB 日级指标');
  });

  it('explains that audit files are not ad data when only diagnostic evidence exists', () => {
    const ledger = buildDataReadinessLedger({
      requiredReportCount: 8,
      reportOptions: [
        { type: 'search_term', label: '用户搜索词报告', status: 'missing', realFileAvailable: false, importedRows: 0 },
      ],
      realReportFileCount: 0,
      importedRowCount: 0,
      rejectedEvidenceFileCount: 6,
    });

    expect(ledger.status).toBe('blocked');
    expect(ledger.headline).toContain('没有真实广告报表');
    expect(ledger.nextAction).toBe('下载或导入真实报表');
    expect(ledger.gaps).toContain('当前文件夹只有诊断/审计文件，它们不能作为广告数据');
  });
});

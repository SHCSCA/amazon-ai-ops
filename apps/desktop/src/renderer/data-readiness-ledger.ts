import type { BusinessReportOptionStatus } from './types';

export interface DataReadinessLedgerInput {
  requiredReportCount: number;
  reportOptions: BusinessReportOptionStatus[];
  realReportFileCount: number;
  importedRowCount: number;
  rejectedEvidenceFileCount: number;
}

export interface DataReadinessLedger {
  status: 'ready' | 'partial' | 'blocked';
  canEnterDiagnosis: boolean;
  nextStep: 'collect' | 'import' | 'diagnose';
  headline: string;
  detail: string;
  nextAction: string;
  gaps: string[];
  stages: DataReadinessStage[];
}

export interface DataReadinessStage {
  key: 'created' | 'downloaded' | 'imported' | 'usable';
  title: string;
  status: 'complete' | 'partial' | 'blocked';
  value: string;
  detail: string;
}

export function buildDataReadinessLedger(input: DataReadinessLedgerInput): DataReadinessLedger {
  const requiredReportCount = Math.max(1, input.requiredReportCount);
  const reportedRealFileCount = Math.max(0, input.realReportFileCount);
  const importedRowCount = Math.max(0, input.importedRowCount);
  const realReportTypeCount = new Set(input.reportOptions
    .filter((item) => item.realFileAvailable)
    .map((item) => item.type)).size;
  const importedReportTypeCount = new Set(input.reportOptions
    .filter((item) => item.realFileAvailable && (
      isImportedOrBeyond(item.status) || Number(item.importedRows || 0) > 0
    ))
    .map((item) => item.type)).size;
  // The per-report option ledger is the authority for coverage. A global row total
  // cannot prove that every required report type has been imported.
  const realReportFileCount = Math.min(requiredReportCount, reportedRealFileCount, realReportTypeCount);
  const importedReportCount = Math.min(realReportFileCount, importedReportTypeCount);
  const missingReportCount = Math.max(0, requiredReportCount - realReportFileCount);
  const realFilesWithoutRows = Math.max(0, realReportFileCount - importedReportCount);
  const gaps: string[] = [];

  if (missingReportCount > 0) {
    gaps.push(`缺少 ${missingReportCount} 类真实广告报表`);
  }
  if (realFilesWithoutRows > 0) {
    gaps.push(`已有 ${realFilesWithoutRows} 类真实报表未形成 DB 日级指标`);
  }
  if (input.rejectedEvidenceFileCount > 0 && realReportFileCount === 0) {
    gaps.push('当前文件夹只有诊断/审计文件，它们不能作为广告数据');
  }

  const stages = buildReadinessStages({
    ...input,
    requiredReportCount,
    realReportFileCount,
    importedRowCount,
    importedReportCount,
    realFilesWithoutRows,
  });

  if (realReportFileCount >= requiredReportCount
    && importedReportCount >= requiredReportCount
    && realFilesWithoutRows === 0) {
    return {
      status: 'ready',
      canEnterDiagnosis: true,
      nextStep: 'diagnose',
      headline: '真实报表和 DB 日级指标已闭合',
      detail: `${realReportFileCount}/${requiredReportCount} 类报表已落盘，${importedRowCount} 行日级广告指标可用于广告表现、AI 证据包和优化建议。`,
      nextAction: '查看广告表现',
      gaps: [],
      stages,
    };
  }

  if (realReportFileCount >= requiredReportCount) {
    return {
      status: 'blocked',
      canEnterDiagnosis: false,
      nextStep: 'import',
      headline: '完整报表仍有入库缺口',
      detail: `${realReportFileCount}/${requiredReportCount} 类真实报表已落盘，但仅 ${importedReportCount}/${requiredReportCount} 类形成 DB 日级指标，不能进入正式诊断。`,
      nextAction: '导入已下载表格',
      gaps,
      stages,
    };
  }

  if (realReportFileCount > 0 && importedRowCount <= 0) {
    return {
      status: 'blocked',
      canEnterDiagnosis: false,
      nextStep: 'import',
      headline: '已有真实报表，等待导入',
      detail: `${realReportFileCount}/${requiredReportCount} 类报表已落盘，但 DB 还没有可分析的日级广告指标。`,
      nextAction: '导入已下载表格',
      gaps,
      stages,
    };
  }

  if (realReportFileCount > 0) {
    const nextStep = realFilesWithoutRows > 0 ? 'import' : 'collect';
    return {
      status: 'partial',
      canEnterDiagnosis: false,
      nextStep,
      headline: '部分数据可用，仍有缺口',
      detail: `${realReportFileCount}/${requiredReportCount} 类报表已落盘，${importedRowCount} 行日级广告指标已入库；缺口补齐前仅用于核对已有事实，不生成正式诊断或建议。`,
      nextAction: nextStep === 'import' ? '导入已下载表格' : '补齐缺失报表',
      gaps,
      stages,
    };
  }

  return {
    status: 'blocked',
    canEnterDiagnosis: false,
    nextStep: 'collect',
    headline: '没有真实广告报表',
    detail: '当前范围没有可分析的 Lingxing xlsx/xls/csv，系统不能生成广告表现、AI 结论或优化建议。',
    nextAction: '下载或导入真实报表',
    gaps,
    stages,
  };
}

function buildReadinessStages(input: DataReadinessLedgerInput & {
  requiredReportCount: number;
  realReportFileCount: number;
  importedRowCount: number;
  importedReportCount: number;
  realFilesWithoutRows: number;
}): DataReadinessStage[] {
  const createdReportCount = Math.min(
    input.requiredReportCount,
    input.reportOptions.filter((item) => isCreatedOrBeyond(item.status) || item.realFileAvailable || item.importedRows > 0).length,
  );
  const usable = input.realReportFileCount >= input.requiredReportCount
    && input.importedReportCount >= input.requiredReportCount
    && input.realFilesWithoutRows === 0;

  return [
    {
      key: 'created',
      title: '领星任务已创建',
      status: countStatus(createdReportCount, input.requiredReportCount),
      value: `${createdReportCount}/${input.requiredReportCount}`,
      detail: createdReportCount >= input.requiredReportCount
        ? '当前范围 8 类报表任务已有记录。'
        : '先验证页面并创建缺失报表任务。',
    },
    {
      key: 'downloaded',
      title: '真实报表已下载',
      status: countStatus(input.realReportFileCount, input.requiredReportCount),
      value: `${input.realReportFileCount}/${input.requiredReportCount}`,
      detail: input.realReportFileCount > 0
        ? '本地已存在 Lingxing xlsx/xls/csv，审计 JSON 不计入。'
        : '需要从领星下载真实广告表格，或导入本地原始表格。',
    },
    {
      key: 'imported',
      title: '日级指标已入库',
      status: countStatus(input.importedReportCount, input.requiredReportCount),
      value: `${input.importedReportCount}/${input.requiredReportCount} 类 · ${input.importedRowCount} 行`,
      detail: input.importedReportCount >= input.requiredReportCount
        ? input.importedRowCount > 0
          ? '每类真实报表都已形成每日广告事实，后续分析只读取入库指标。'
          : '每类真实报表都已验证入库；当前日期范围是可追溯的 0 行业务零状态。'
        : input.importedRowCount > 0
          ? '已有部分日级广告事实，但尚未覆盖全部必需报表类型。'
          : '真实报表尚未形成可分析的日级指标。',
    },
    {
      key: 'usable',
      title: '可用于 AI+规则建议',
      status: usable ? 'complete' : 'blocked',
      value: usable ? '已放行' : '未放行',
      detail: usable
        ? '当前范围可以查看广告表现、AI 证据包和优化建议。'
        : '补齐真实报表和导入缺口后才会放行正式建议。',
    },
  ];
}

function countStatus(count: number, total: number): DataReadinessStage['status'] {
  if (count >= total) return 'complete';
  if (count > 0) return 'partial';
  return 'blocked';
}

function isCreatedOrBeyond(status: string): boolean {
  return /created|ready|downloaded|imported|completed|complete/i.test(status);
}

function isImportedOrBeyond(status: string): boolean {
  return /imported|completed|complete|succeeded/i.test(status);
}

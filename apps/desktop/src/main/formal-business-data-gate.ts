export type FormalBusinessWorkflow =
  | 'recommendation'
  | 'keyword-opportunities'
  | 'diagnosis'
  | 'recommendation-list'
  | 'approval'
  | 'readback';

export interface FormalBusinessReportFile {
  reportType: string;
  importedRows: number;
  status?: string;
}

export interface FormalBusinessWorkflowReadinessInput {
  workflow: FormalBusinessWorkflow;
  requiredReportTypes: readonly string[];
  realReportFiles: readonly FormalBusinessReportFile[];
}

export interface FormalBusinessWorkflowReadiness {
  requiredReportCount: number;
  realReportTypeCount: number;
  importedReportTypeCount: number;
}

const WORKFLOW_LABELS: Record<FormalBusinessWorkflow, string> = {
  recommendation: '生成优化建议',
  'keyword-opportunities': '读取关键词机会',
  diagnosis: 'AI 阶段诊断',
  'recommendation-list': '读取优化建议',
  approval: '审批建议',
  readback: '结果核对',
};

const REQUIRED_FORMAL_REPORT_TYPE_COUNT = 8;

export function assertFormalBusinessWorkflowReady(
  input: FormalBusinessWorkflowReadinessInput,
): FormalBusinessWorkflowReadiness {
  const requiredReportTypes = Array.from(new Set(
    input.requiredReportTypes.map((reportType) => reportType.trim()).filter(Boolean),
  ));
  if (requiredReportTypes.length !== REQUIRED_FORMAL_REPORT_TYPE_COUNT) {
    throw new Error(
      `正式数据门配置无效：必须定义 ${REQUIRED_FORMAL_REPORT_TYPE_COUNT} 个 distinct 报表类型，当前为 ${requiredReportTypes.length} 个。`,
    );
  }
  const requiredReportTypeSet = new Set(requiredReportTypes);
  const realReportTypes = new Set(
    input.realReportFiles
      .map((file) => String(file.reportType || '').trim())
      .filter((reportType) => requiredReportTypeSet.has(reportType)),
  );
  const importedReportTypes = new Set(
    input.realReportFiles
      .filter((file) => file.status === 'imported'
        || (Number.isFinite(Number(file.importedRows)) && Number(file.importedRows) > 0))
      .map((file) => String(file.reportType || '').trim())
      .filter((reportType) => requiredReportTypeSet.has(reportType)),
  );

  if (realReportTypes.size < requiredReportTypes.length) {
    const missingReportTypes = requiredReportTypes.filter((reportType) => !realReportTypes.has(reportType));
    throw new Error(
      `${WORKFLOW_LABELS[input.workflow]}被阻断：当前范围仅有 ${realReportTypes.size}/${requiredReportTypes.length} 类真实广告报表；缺少 ${missingReportTypes.join('、')}。`,
    );
  }

  if (importedReportTypes.size < requiredReportTypes.length) {
    const missingImportedReportTypes = requiredReportTypes.filter(
      (reportType) => !importedReportTypes.has(reportType),
    );
    throw new Error(
      `${WORKFLOW_LABELS[input.workflow]}被阻断：仅有 ${importedReportTypes.size}/${requiredReportTypes.length} 类真实报表形成 DB 日级指标；未入库 ${missingImportedReportTypes.join('、')}。`,
    );
  }

  return {
    requiredReportCount: requiredReportTypes.length,
    realReportTypeCount: realReportTypes.size,
    importedReportTypeCount: importedReportTypes.size,
  };
}

export type FormalBusinessWorkflow =
  | 'recommendation'
  | 'keyword-opportunities'
  | 'diagnosis'
  | 'recommendation-list'
  | 'approval'
  | 'readback';

export interface FormalBusinessReportFile {
  batchId?: string;
  reportType: string;
  importedRows: number;
  status?: string;
}

export interface FormalBusinessCollectionJobProof {
  jobId: string;
  state: string;
  importState?: string;
  request: {
    requestId: string;
    reportTypes: readonly string[];
  };
  lineage?: {
    lineageId: string;
    rootJobId: string;
    parentJobId?: string;
    expectedReportTypes: readonly string[];
    purpose: string;
  };
}

export interface FormalBusinessWorkflowReadinessInput {
  workflow: FormalBusinessWorkflow;
  requiredReportTypes: readonly string[];
  realReportFiles: readonly FormalBusinessReportFile[];
  collectionJob?: FormalBusinessCollectionJobProof;
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
  const relevantReportFiles = input.realReportFiles.filter((file) => (
    requiredReportTypeSet.has(String(file.reportType || '').trim())
  ));
  const hasBatchLineage = relevantReportFiles.some((file) => String(file.batchId || '').trim().length > 0);
  if (hasBatchLineage) {
    const batchIds = new Set(relevantReportFiles
      .map((file) => String(file.batchId || '').trim())
      .filter(Boolean));
    const missingBatchLineage = relevantReportFiles.some((file) => !String(file.batchId || '').trim());
    if (missingBatchLineage || batchIds.size !== 1) {
      throw new Error(
        `${WORKFLOW_LABELS[input.workflow]}被阻断：8 类真实报表不属于同一个完整采集批次；请继续原完整任务或重新获取完整 8 类。`,
      );
    }
    const batchId = [...batchIds][0]!;
    if (!hasExactProductionRootIdentity(input.collectionJob, batchId, requiredReportTypes)) {
      throw new Error(
        `${WORKFLOW_LABELS[input.workflow]}被阻断：当前 8 类批次缺少已成功入库的正式完整采集任务或 production_full 根血缘；`
        + '本地导入不能替代正式采集。请启动“重新获取完整 8 类报表”，等待采集与导入完成后重试。',
      );
    }
    if (input.collectionJob.state !== 'completed' || input.collectionJob.importState !== 'succeeded') {
      throw new Error(
        `${WORKFLOW_LABELS[input.workflow]}被阻断：当前完整 8 类采集尚未完成生产入库；`
        + '请等待当前任务显示“采集完成、入库成功”，或重新获取完整 8 类后重试。',
      );
    }
  }
  const realReportTypes = new Set(
    relevantReportFiles
      .map((file) => String(file.reportType || '').trim())
      .filter((reportType) => requiredReportTypeSet.has(reportType)),
  );
  const importedReportTypes = new Set(
    relevantReportFiles
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

function hasExactProductionRootIdentity(
  job: FormalBusinessCollectionJobProof | undefined,
  batchId: string,
  requiredReportTypes: readonly string[],
): job is FormalBusinessCollectionJobProof {
  if (!job || !job.lineage) return false;
  const exactReportSet = (values: readonly string[]) => {
    const normalized = values.map((value) => String(value || '').trim()).filter(Boolean);
    const set = new Set(normalized);
    return normalized.length === requiredReportTypes.length
      && set.size === requiredReportTypes.length
      && requiredReportTypes.every((reportType) => set.has(reportType));
  };
  return job.jobId === batchId
    && Boolean(job.request.requestId.trim())
    && !job.request.requestId.startsWith('local-import:')
    && !job.request.requestId.startsWith('canary:')
    && job.lineage.purpose === 'production_full'
    && job.lineage.lineageId === batchId
    && job.lineage.rootJobId === batchId
    && job.lineage.parentJobId === undefined
    && exactReportSet(job.request.reportTypes)
    && exactReportSet(job.lineage.expectedReportTypes);
}

export type DiagnosisWorkspaceActionTarget = 'data-collection' | 'data-import-validation' | 'recommendations';

export interface DiagnosisQueueObjectIdentity {
  portfolioName?: string;
  campaignName?: string;
  adGroupName?: string;
  asin?: string;
  objectKey?: string;
  objectType?: string;
  objectName?: string;
}

export interface DiagnosisQueueRow<T extends DiagnosisQueueObjectIdentity> {
  key: string;
  diagnostic: T;
  priority: number;
}

function normalizeDiagnosisIdentityPart(value: unknown): string {
  return String(value ?? '').trim().toLocaleLowerCase('en-US');
}

export function diagnosisQueueObjectKey<T extends DiagnosisQueueObjectIdentity>(row: T): string {
  const authoritativeObjectKey = normalizeDiagnosisIdentityPart(row.objectKey);
  if (authoritativeObjectKey) return JSON.stringify(['object-key', authoritativeObjectKey]);

  return JSON.stringify([
    normalizeDiagnosisIdentityPart(row.portfolioName),
    normalizeDiagnosisIdentityPart(row.campaignName),
    normalizeDiagnosisIdentityPart(row.adGroupName),
    normalizeDiagnosisIdentityPart(row.asin),
    normalizeDiagnosisIdentityPart(row.objectType),
    normalizeDiagnosisIdentityPart(row.objectName),
  ]);
}

export function buildDiagnosisQueueRows<T extends DiagnosisQueueObjectIdentity>(
  diagnostics: T[],
  priorityForRow: (row: T) => number,
): Array<DiagnosisQueueRow<T>> {
  return diagnostics
    .map((diagnostic) => ({
      key: diagnosisQueueObjectKey(diagnostic),
      diagnostic,
      priority: Number(priorityForRow(diagnostic)) || 0,
    }))
    .sort((left, right) => right.priority - left.priority || left.key.localeCompare(right.key));
}

export interface DiagnosisWorkspaceAction {
  label: string;
  target: DiagnosisWorkspaceActionTarget;
  disabled: boolean;
}

export function buildDiagnosisDataRemediationAction(input: {
  realReportCount: number;
  requiredReportCount?: number;
}): DiagnosisWorkspaceAction {
  const requiredReportCount = Math.max(1, Number(input.requiredReportCount || 8));
  const realReportCount = Math.max(0, Number(input.realReportCount || 0));
  return realReportCount >= requiredReportCount
    ? { label: '补齐逐类入库', target: 'data-import-validation', disabled: false }
    : { label: '去数据采集', target: 'data-collection', disabled: false };
}

export interface DiagnosisWorkspaceModelInput {
  realReportCount: number;
  requiredReportCount?: number;
  importedReportTypeCount: number;
  importedRowCount: number;
  hasImportedMetrics: boolean;
  recommendationGateIssues: string[];
  diagnosticCount: number;
  visibleDiagnosticCount?: number;
  selectedObject?: {
    name?: string;
    diagnosis?: string;
  } | null;
  scopeAiSummary?: string | null;
}

export interface DiagnosisWorkspaceModel {
  canDiagnose: boolean;
  formalRecommendationsLocked: boolean;
  readinessDetail: string;
  primaryAction: DiagnosisWorkspaceAction;
  selectedObjectExplanation: {
    label: '当前对象诊断';
    objectName: string;
    text: string;
  };
  scopeAiSummary: {
    label: '范围级 AI 总结';
    text: string;
    caveat: '描述整个当前范围，不作为当前对象的诊断解释。';
  } | null;
  queue: {
    totalCount: number;
    visibleCount: number;
    hasVisibleRows: boolean;
  };
  defaultSurfaces: {
    objectTableVisible: boolean;
    reviewQueueOpen: false;
    technicalDetailsOpen: false;
  };
}

export function buildDiagnosisWorkspaceModel(input: DiagnosisWorkspaceModelInput): DiagnosisWorkspaceModel {
  const requiredReportCount = Math.max(1, Number(input.requiredReportCount || 8));
  const realReportCount = Math.max(0, Number(input.realReportCount || 0));
  const importedReportTypeCount = Math.max(0, Number(input.importedReportTypeCount || 0));
  const importedRowCount = Math.max(0, Number(input.importedRowCount || 0));
  const diagnosticCount = Math.max(0, Number(input.diagnosticCount || 0));
  const visibleDiagnosticCount = Math.max(0, Number(input.visibleDiagnosticCount ?? diagnosticCount));
  const canDiagnose = realReportCount >= requiredReportCount
    && importedReportTypeCount >= requiredReportCount
    && importedRowCount > 0
    && input.hasImportedMetrics;
  const formalRecommendationsLocked = !canDiagnose || input.recommendationGateIssues.length > 0 || diagnosticCount <= 0;

  let primaryAction: DiagnosisWorkspaceAction;
  if (!canDiagnose) {
    primaryAction = buildDiagnosisDataRemediationAction({ realReportCount, requiredReportCount });
  } else if (input.recommendationGateIssues.length > 0) {
    primaryAction = { label: '补齐数据以解锁正式建议', target: 'data-collection', disabled: false };
  } else if (diagnosticCount <= 0) {
    primaryAction = { label: '暂无可建议对象', target: 'recommendations', disabled: true };
  } else {
    primaryAction = { label: '进入优化建议', target: 'recommendations', disabled: false };
  }

  const objectName = input.selectedObject?.name?.trim() || '尚未选定对象';
  const objectDiagnosis = input.selectedObject?.diagnosis?.trim()
    || (diagnosticCount > 0 ? '选择或聚焦一个广告对象后查看其规则诊断。' : '当前范围还没有可复核的广告对象。');
  const scopeAiSummary = input.scopeAiSummary?.trim();

  return {
    canDiagnose,
    formalRecommendationsLocked,
    readinessDetail: canDiagnose
      ? `${realReportCount}/${requiredReportCount} 类真实报表、${importedReportTypeCount}/${requiredReportCount} 类逐类入库；当前诊断可复核${formalRecommendationsLocked ? '，正式建议保持锁定。' : '，正式建议入口已解锁。'}`
      : `${realReportCount}/${requiredReportCount} 类真实报表、${importedReportTypeCount}/${requiredReportCount} 类已逐类入库；8 类未全部闭合，正式诊断保持阻断。`,
    primaryAction,
    selectedObjectExplanation: {
      label: '当前对象诊断',
      objectName,
      text: objectDiagnosis,
    },
    scopeAiSummary: scopeAiSummary
      ? {
          label: '范围级 AI 总结',
          text: scopeAiSummary,
          caveat: '描述整个当前范围，不作为当前对象的诊断解释。',
        }
      : null,
    queue: {
      totalCount: diagnosticCount,
      visibleCount: visibleDiagnosticCount,
      hasVisibleRows: visibleDiagnosticCount > 0,
    },
    defaultSurfaces: {
      objectTableVisible: canDiagnose,
      reviewQueueOpen: false,
      technicalDetailsOpen: false,
    },
  };
}

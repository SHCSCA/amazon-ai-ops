import type { NavigationIntent } from './navigation';

export type WorkflowStage =
  | 'product-selection'
  | 'scope-setup'
  | 'report-collection'
  | 'import-validation'
  | 'diagnosis'
  | 'recommendations'
  | 'approval'
  | 'readback'
  | 'delivery'
  | 'complete';

export interface VerifiedReadbackEvidence {
  verifiedCount: number;
  verificationStatus: 'missing' | 'verified' | 'failed';
}

export interface DeliveryProvenance {
  appReady: boolean;
  manifestDriven: boolean;
  previewOnly: boolean;
  packageSmoke: 'missing' | 'stale' | 'current';
  packageHash: 'missing' | 'mismatch' | 'match';
}

export interface WorkflowEvidence {
  productSelected: boolean;
  scopeReady: boolean;
  reportsReady: boolean;
  importState: 'not-started' | 'pending' | 'ready';
  diagnosisReady: boolean;
  recommendationState: 'absent' | 'mixed' | 'ready';
  approvalComplete: boolean;
  readback: VerifiedReadbackEvidence;
  delivery: DeliveryProvenance;
}

export interface WorkflowEvidenceSnapshot {
  scope?: {
    dateFrom?: string;
    dateTo?: string;
    storeName?: string;
    marketplaceCode?: string;
    asin?: string;
  } | null;
  pipeline?: {
    collection?: {
      status?: string;
      fileAudit?: { missingReportLabels?: readonly string[]; realReportFileCount?: number };
    };
    quant?: { hasImportedMetrics?: boolean; diagnostics?: readonly unknown[] };
  } | null;
  recommendations?: { pending?: number; needsReview?: number; approved?: number } | null;
  readback?: { verifiedCount?: number; latestStatus?: string } | null;
  readiness?: {
    appReady?: boolean;
    manifestDriven?: boolean;
    previewOnly?: boolean;
    gates?: ReadonlyArray<{ id?: string; name?: string; ok?: boolean; status?: string }>;
    failures?: ReadonlyArray<{ gateId?: string; code?: string }>;
  } | null;
}

export interface NextSafeAction {
  stage: WorkflowStage;
  blocked: boolean;
  reason: string;
  label: string;
  intent: NavigationIntent;
}

function blockedAction(
  stage: Exclude<WorkflowStage, 'complete'>,
  reason: string,
  label: string,
  intent: NavigationIntent,
): NextSafeAction {
  return { stage, blocked: true, reason, label, intent };
}

function readbackVerified(readback: VerifiedReadbackEvidence): boolean {
  return readback.verificationStatus === 'verified' && readback.verifiedCount > 0;
}

function deliveryVerified(delivery: DeliveryProvenance): boolean {
  return delivery.appReady
    && delivery.manifestDriven
    && !delivery.previewOnly
    && delivery.packageSmoke === 'current'
    && delivery.packageHash === 'match';
}

export function selectNextSafeAction(evidence: WorkflowEvidence): NextSafeAction {
  if (!evidence.productSelected) {
    return blockedAction('product-selection', '先锁定要运营的产品，再开始配置范围和读取数据。', '选择运营产品', { workspace: 'product', subview: 'products' });
  }
  if (!evidence.scopeReady) {
    return blockedAction('scope-setup', '当前产品还没有完整的店铺、站点和日期范围。', '配置工作范围', { workspace: 'data-preparation', subview: 'scope' });
  }
  if (!evidence.reportsReady) {
    return blockedAction('report-collection', '当前范围缺少真实领星广告报表，不能继续量化。', '采集真实报表', { workspace: 'data-preparation', subview: 'reports' });
  }
  if (evidence.importState !== 'ready') {
    const reason = evidence.importState === 'pending'
      ? '真实报表正在导入或等待校验，完成前不生成诊断。'
      : '真实报表尚未完成导入校验，不能把文件存在当成数据可用。';
    return blockedAction('import-validation', reason, '检查导入结果', { workspace: 'data-preparation', subview: 'import-check' });
  }
  if (!evidence.diagnosisReady) {
    return blockedAction('diagnosis', '导入数据已就绪，但广告诊断还没有产出可复核结果。', '运行广告诊断', { workspace: 'diagnosis', subview: 'analysis' });
  }
  if (evidence.recommendationState === 'absent') {
    return blockedAction('recommendations', '诊断已就绪，但还没有基于证据生成优化建议。', '生成优化建议', { workspace: 'decisions', subview: 'recommendations' });
  }
  if (evidence.recommendationState === 'mixed') {
    return blockedAction('recommendations', '建议中仍有高风险或需人工复核项，不能直接进入执行。', '复核优化建议', { workspace: 'decisions', subview: 'recommendations' });
  }
  if (!evidence.approvalComplete) {
    return blockedAction('approval', '可审批建议仍需逐项人工决定；审批只代表决策，不代表已经执行。', '进入人工审批', { workspace: 'decisions', subview: 'approval' });
  }
  if (!readbackVerified(evidence.readback)) {
    return blockedAction('readback', '人工审批已完成，但仍缺少已通过校验的 Ads 界面执行与结果回读证据。', '补齐执行回读', { workspace: 'readback', subview: 'evidence' });
  }
  if (!deliveryVerified(evidence.delivery)) {
    return blockedAction('delivery', '业务证据已补齐，但正式交付仍缺少 manifest、当前包启动冒烟或匹配的包哈希。开发预览不能替代正式验收。', '检查交付验收', { workspace: 'system', subview: 'delivery' });
  }
  return {
    stage: 'complete',
    blocked: false,
    reason: '运营链路已走通；最终可交付状态仍以正式验收证据为准。',
    label: '返回今日工作',
    intent: { workspace: 'today', subview: 'overview' },
  };
}

function nonEmpty(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function gateByIdOrName(snapshot: WorkflowEvidenceSnapshot['readiness'], id: string, name: string) {
  return snapshot?.gates?.find((gate) => gate.id === id || gate.name === name);
}

export function deriveWorkflowEvidence(snapshot: WorkflowEvidenceSnapshot): WorkflowEvidence {
  const scope = snapshot.scope;
  const collection = snapshot.pipeline?.collection;
  const quant = snapshot.pipeline?.quant;
  const missingReports = collection?.fileAudit?.missingReportLabels || [];
  const reportsReady = collection?.status === 'ready'
    && Number(collection.fileAudit?.realReportFileCount || 0) > 0
    && missingReports.length === 0;
  const importedMetricsReady = quant?.hasImportedMetrics === true;
  const importState: WorkflowEvidence['importState'] = importedMetricsReady
    ? 'ready'
    : reportsReady
      ? 'pending'
      : 'not-started';

  const pending = Math.max(0, Number(snapshot.recommendations?.pending || 0));
  const needsReview = Math.max(0, Number(snapshot.recommendations?.needsReview || 0));
  const approved = Math.max(0, Number(snapshot.recommendations?.approved || 0));
  const nonEmptyRecommendationBuckets = [pending, needsReview, approved].filter((count) => count > 0).length;
  const recommendationState: WorkflowEvidence['recommendationState'] = pending + needsReview + approved === 0
    ? 'absent'
    : needsReview > 0 || nonEmptyRecommendationBuckets > 1
      ? 'mixed'
      : 'ready';

  const verifiedCount = Math.max(0, Number(snapshot.readback?.verifiedCount || 0));
  const latestReadbackStatus = String(snapshot.readback?.latestStatus || '').toLowerCase();
  const previewVerifiedReadback = snapshot.readiness?.previewOnly === true && latestReadbackStatus === 'preview-only-verified';
  const explicitReadbackFailure = Boolean(
    latestReadbackStatus
    && !previewVerifiedReadback
    && !['pass', 'passed', 'verified', 'ready'].includes(latestReadbackStatus),
  );

  const readiness = snapshot.readiness;
  const smokeGate = gateByIdOrName(readiness, 'package-launch-smoke', 'Package launch smoke');
  const hashGate = gateByIdOrName(readiness, 'release-package-hash', 'Release package hash');
  const failureCodes = new Set((readiness?.failures || []).map((failure) => String(failure.code || '')));
  const smokeMismatch = failureCodes.has('PACKAGE_SMOKE_PORTABLE_HASH_MISMATCH');
  const smokeStale = smokeMismatch || failureCodes.has('PACKAGE_SMOKE_STALE');

  return {
    productSelected: nonEmpty(scope?.asin),
    scopeReady: nonEmpty(scope?.dateFrom) && nonEmpty(scope?.dateTo) && nonEmpty(scope?.storeName) && nonEmpty(scope?.marketplaceCode),
    reportsReady,
    importState,
    diagnosisReady: importedMetricsReady && Boolean(quant?.diagnostics?.length),
    recommendationState,
    approvalComplete: approved > 0 && pending === 0 && needsReview === 0,
    readback: {
      verifiedCount,
      verificationStatus: explicitReadbackFailure ? 'failed' : verifiedCount > 0 ? 'verified' : 'missing',
    },
    delivery: {
      appReady: readiness?.appReady === true,
      manifestDriven: readiness?.manifestDriven === true,
      previewOnly: readiness?.previewOnly === true,
      packageSmoke: smokeGate?.ok === true && !smokeStale ? 'current' : smokeStale ? 'stale' : 'missing',
      packageHash: smokeMismatch ? 'mismatch' : hashGate?.ok === true ? 'match' : 'missing',
    },
  };
}

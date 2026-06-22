import type { AiDiagnosisRunView, AppRoute, BusinessDataPipeline, DeliveryEvidenceStatusView, DeliveryReadinessView, RecommendationView } from './types';

export type DeliveryMatrixStatus = 'ready' | 'needs_work' | 'blocked';
export type DeliveryMatrixTone = 'ready' | 'warning' | 'blocked' | 'pending';

export interface DeliveryReadinessMatrixInput {
  realReportCount: number;
  importedRows: number;
  actionableRows: number;
  aiAvailable: boolean;
  aiSuccessCount: number;
  aiInsightOnlyCount?: number;
  operationEventCount: number;
  productContextCount: number;
  listingReadReady: boolean;
  listingDraftReady: boolean;
  pendingRecommendationCount: number;
  reviewRecommendationCount?: number;
  recommendationReviewReasons?: string[];
  approvedRecommendationCount: number;
  readbackVerifiedCount: number;
  installerAvailable?: boolean;
  deliveryManifestReady?: boolean;
}

export interface DeliveryMatrixItem {
  key: 'data' | 'aiEvidence' | 'businessContext' | 'listing' | 'recommendations' | 'readback' | 'package';
  label: string;
  statusLabel: string;
  tone: DeliveryMatrixTone;
  detail: string;
  nextAction: string;
  route: AppRoute;
}

export interface DeliveryReadinessMatrix {
  status: DeliveryMatrixStatus;
  headline: string;
  primaryNextAction: string;
  readyCount: number;
  totalCount: number;
  items: DeliveryMatrixItem[];
}

export interface BuildDeliveryReadinessMatrixInputSource {
  data: Partial<BusinessDataPipeline> | null | undefined;
  readiness: Partial<DeliveryReadinessView> | null | undefined;
  evidenceStatus?: Partial<DeliveryEvidenceStatusView> | null;
  aiAvailable: boolean;
  aiDiagnosisRuns?: Array<Partial<AiDiagnosisRunView>>;
  pendingRecommendations?: Array<Partial<RecommendationView>>;
  needsReviewRecommendations?: Array<Partial<RecommendationView>>;
  approvedRecommendations?: Array<Partial<RecommendationView>>;
}

export function buildDeliveryReadinessMatrixInput(source: BuildDeliveryReadinessMatrixInputSource): DeliveryReadinessMatrixInput {
  const data = source.data;
  const collection = data?.collection;
  const quant = data?.quant;
  const readiness = source.readiness;
  const aiDiagnosisRuns = source.aiDiagnosisRuns || [];
  const reviewRecommendations = [
    ...(source.needsReviewRecommendations || []),
    ...(source.pendingRecommendations || []).filter(isReviewOnlyRecommendation),
  ];

  return {
    realReportCount: cleanCount(collection?.fileAudit?.realReportFileCount ?? collection?.realReportFiles?.length),
    importedRows: cleanCount(collection?.fileAudit?.importedRowCount ?? quant?.importedRows),
    actionableRows: cleanCount(quant?.actionableRows),
    aiAvailable: source.aiAvailable,
    aiSuccessCount: aiDiagnosisRuns.filter(hasDisplayableAiDiagnosisEvidence).length,
    aiInsightOnlyCount: aiDiagnosisRuns.reduce((total, run) => total + countDeliveredAiInsights(run), 0),
    operationEventCount: cleanCount(data?.operations?.eventCount ?? data?.operations?.events?.length),
    productContextCount: cleanCount(data?.productContext?.productCount ?? data?.productContext?.products?.length),
    listingReadReady: Boolean(source.evidenceStatus?.listing?.readReady)
      || readinessGatePassed(readiness, [/listing.*read/i, /listing.*读取/i, /详情读取/]),
    listingDraftReady: Boolean(source.evidenceStatus?.listing?.draftReady)
      || readinessGatePassed(readiness, [/listing.*draft/i, /listing.*草案/i, /ai.*草案/i]),
    pendingRecommendationCount: cleanCount(source.pendingRecommendations?.filter(isFormalPendingRecommendation).length),
    reviewRecommendationCount: cleanCount(reviewRecommendations.length),
    recommendationReviewReasons: collectRecommendationReviewReasons(reviewRecommendations),
    approvedRecommendationCount: cleanCount(source.approvedRecommendations?.length),
    readbackVerifiedCount: Math.max(
      cleanCount(source.evidenceStatus?.readback?.verifiedCount),
      readinessGatePassed(readiness, [/readback/i, /回读/, /广告执行/]) ? 1 : 0,
    ),
    installerAvailable: Boolean(source.evidenceStatus?.package?.installerAvailable),
    deliveryManifestReady: Boolean(readiness?.appReady && readiness?.manifestDriven),
  };
}

export function buildDeliveryReadinessMatrix(input: DeliveryReadinessMatrixInput): DeliveryReadinessMatrix {
  const realReportCount = cleanCount(input.realReportCount);
  const importedRows = cleanCount(input.importedRows);
  const actionableRows = cleanCount(input.actionableRows);
  const aiSuccessCount = cleanCount(input.aiSuccessCount);
  const aiInsightOnlyCount = cleanCount(input.aiInsightOnlyCount);
  const operationEventCount = cleanCount(input.operationEventCount);
  const productContextCount = cleanCount(input.productContextCount);
  const pendingRecommendationCount = cleanCount(input.pendingRecommendationCount);
  const reviewRecommendationCount = cleanCount(input.reviewRecommendationCount);
  const recommendationReviewReasons = Array.from(new Set((input.recommendationReviewReasons || [])
    .map((item) => String(item || '').trim())
    .filter(Boolean))).slice(0, 4);
  const approvedRecommendationCount = cleanCount(input.approvedRecommendationCount);
  const readbackVerifiedCount = cleanCount(input.readbackVerifiedCount);

  const dataReady = realReportCount >= 8 && importedRows > 0 && actionableRows > 0;
  const aiReady = input.aiAvailable && aiSuccessCount > 0;
  const contextReady = operationEventCount > 0 && productContextCount > 0;
  const listingReady = input.listingReadReady && input.listingDraftReady;
  const recommendationsReady = pendingRecommendationCount > 0 || approvedRecommendationCount > 0;
  const recommendationsReviewOnly = !recommendationsReady && reviewRecommendationCount > 0;
  const readbackReady = readbackVerifiedCount > 0;
  const packageReady = Boolean(input.installerAvailable && input.deliveryManifestReady);

  const items: DeliveryMatrixItem[] = [
    {
      key: 'data',
      label: '真实数据闭环',
      statusLabel: dataReady ? '通过' : '阻断',
      tone: dataReady ? 'ready' : 'blocked',
      detail: dataReady
        ? `${realReportCount}/8 类真实广告报表，${importedRows} 行 DB 日级指标，${actionableRows} 行可生成建议。`
        : `${realReportCount}/8 类真实广告报表，${importedRows} 行 DB 日级指标，${actionableRows} 行可生成建议；正式建议必须先补齐真实数据。`,
      nextAction: dataReady ? '进入广告量化' : '去数据采集',
      route: dataReady ? 'ad-quant' : realReportCount > 0 ? 'data-import-validation' : 'data-collection',
    },
    {
      key: 'aiEvidence',
      label: 'AI 证据链',
      statusLabel: aiReady ? '通过' : input.aiAvailable ? '待验证' : '阻断',
      tone: aiReady ? 'ready' : input.aiAvailable ? 'warning' : 'blocked',
      detail: aiReady
        ? `AI 成功 ${aiSuccessCount} 次；${aiInsightOnlyCount} 条仅作洞察，不进入优化建议池。`
        : input.aiAvailable
          ? 'AI 已配置但缺少成功诊断记录，不能证明 AI 已参与当前业务判断。'
          : 'AI 未配置或不可用，当前只能使用规则兜底。',
      nextAction: aiReady ? '查看 AI 诊断证据' : '去设置测试 AI',
      route: aiReady ? 'ad-quant' : 'settings',
    },
    {
      key: 'businessContext',
      label: '运营上下文',
      statusLabel: contextReady ? '通过' : '需补充',
      tone: contextReady ? 'ready' : dataReady ? 'warning' : 'blocked',
      detail: contextReady
        ? `${operationEventCount} 条运营事件，${productContextCount} 个产品配置已进入 AI+规则上下文。`
        : `${operationEventCount} 条运营事件，${productContextCount} 个产品配置；缺少背景时 AI 阈值判断容易误判。`,
      nextAction: contextReady ? '复核产品阶段' : '维护运营事件和产品配置',
      route: contextReady ? 'ad-quant' : operationEventCount <= 0 ? 'operation-events' : 'product-config',
    },
    {
      key: 'listing',
      label: 'Listing 草案',
      statusLabel: listingReady ? '通过' : input.listingReadReady ? '待草案' : '需读取',
      tone: listingReady ? 'ready' : input.listingReadReady ? 'warning' : dataReady ? 'warning' : 'blocked',
      detail: listingReady
        ? 'Listing 已读取且 AI 草案已生成，可作为关键词和转化诊断旁证。'
        : input.listingReadReady
          ? 'Listing 已读取，但还没有形成可审阅的 AI 草案。'
          : '还没有可回查的 Lingxing Listing 读取结果。',
      nextAction: listingReady ? '查看 Listing 草案' : '去 Listing 优化',
      route: 'listing-optimization',
    },
    {
      key: 'recommendations',
      label: '建议与审批',
      statusLabel: recommendationsReady ? '可审批' : recommendationsReviewOnly ? '需复核' : dataReady ? '待生成' : '阻断',
      tone: recommendationsReady ? 'ready' : recommendationsReviewOnly || dataReady ? 'warning' : 'blocked',
      detail: recommendationsReady
        ? `${pendingRecommendationCount} 条待审批，${approvedRecommendationCount} 条已批准，${reviewRecommendationCount} 条复核中；后续必须进入执行回读。`
        : recommendationsReviewOnly
          ? [
              `${reviewRecommendationCount} 条建议需复核，尚不能普通审批。`,
              recommendationReviewReasons.length ? `主要原因：${recommendationReviewReasons.join('；')}` : '',
            ].filter(Boolean).join(' ')
        : dataReady
          ? '真实数据已具备，但还没有可审批的优化建议。'
          : '缺少真实数据时不能生成正式优化建议。',
      nextAction: recommendationsReady ? '进入审批中心' : recommendationsReviewOnly ? '进入审批中心复核' : '生成优化建议',
      route: recommendationsReady || recommendationsReviewOnly ? 'approval' : dataReady ? 'recommendations' : 'data-collection',
    },
    {
      key: 'readback',
      label: '执行回读',
      statusLabel: readbackReady ? '通过' : '阻断',
      tone: readbackReady ? 'ready' : 'blocked',
      detail: readbackReady
        ? `${readbackVerifiedCount} 条真实广告动作已完成执行前/执行后/回读验证。`
        : '还没有真实广告动作的执行前、执行后和回读闭环证据。',
      nextAction: readbackReady ? '查看执行回读' : '完成审批和回读',
      route: readbackReady ? 'readback' : recommendationsReady ? 'approval' : 'recommendations',
    },
    {
      key: 'package',
      label: '最终交付包',
      statusLabel: packageReady ? '通过' : '阻断',
      tone: packageReady ? 'ready' : 'blocked',
      detail: packageReady
        ? '最终验收汇总和安装包证据均已具备。'
        : '最终验收汇总或免安装包/校验码证据还没有闭合。',
      nextAction: packageReady ? '查看交付证据' : '进入交付验收',
      route: 'delivery',
    },
  ];

  const readyCount = items.filter((item) => item.tone === 'ready').length;
  const totalCount = items.length;

  if (readyCount === totalCount) {
    return {
      status: 'ready',
      headline: '可交付证据闭环已完成',
      primaryNextAction: '导出交付包并记录安装包校验码',
      readyCount,
      totalCount,
      items,
    };
  }

  if (!dataReady) {
    return {
      status: 'blocked',
      headline: '真实数据闭环未完成，不能进入正式交付',
      primaryNextAction: '先完成真实报表下载和 DB 日级指标导入',
      readyCount,
      totalCount,
      items,
    };
  }

  return {
    status: 'needs_work',
    headline: '还差执行回读和最终交付证据',
    primaryNextAction: '先完成审批、真实执行回读和最终交付包',
    readyCount,
    totalCount,
    items,
  };
}

function hasDisplayableAiDiagnosisEvidence(run: Partial<AiDiagnosisRunView>): boolean {
  if (run.success === false || run.diagnosis?.source !== 'ai') return false;
  if (run.diagnosis?.lifecycleStageRequiresReview) return false;
  const refs = (run.diagnosis?.lifecycleStageEvidenceRefs || []).map((ref) => String(ref || '').trim()).filter(Boolean);
  if (!refs.length) return false;
  const previewIds = new Set((run.evidencePackPreview || []).map((item) => String(item.evidenceId || '').trim()).filter(Boolean));
  return refs.every((ref) => previewIds.has(ref));
}

function countDeliveredAiInsights(run: Partial<AiDiagnosisRunView>): number {
  if (run.success === false || run.diagnosis?.source !== 'ai') return 0;
  return Array.isArray(run.insights) ? run.insights.length : 0;
}

function isFormalPendingRecommendation(recommendation: Partial<RecommendationView>): boolean {
  return !isReviewOnlyRecommendation(recommendation);
}

function isReviewOnlyRecommendation(recommendation: Partial<RecommendationView>): boolean {
  const evidence = recommendation.evidence;
  const aiActionParticipated = hasConcreteAiActionParticipation(evidence);
  if (recommendation.status === 'needs_review') return true;
  if (evidence?.aiInsightOnly || evidence?.aiInsightInvalidReasons?.length) return true;
  if (evidence?.decisionAgreement === 'conflict' || evidence?.decisionAgreement === 'ai_only') return true;
  if (evidence?.decisionRequiresReview || evidence?.quantReviewRequired) return true;
  if (aiActionParticipated && evidence?.aiLifecycleStageRequiresReview) return true;
  if (evidence?.aiEvidenceSufficiency?.canUseForFormalActions === false) return true;
  if (aiActionParticipated && evidence?.aiStrategySource === 'ai') {
    const refs = (evidence.aiEvidenceRefs || []).map((ref) => String(ref || '').trim()).filter(Boolean);
    if (!refs.length) return true;
    const detailIds = new Set((evidence.aiEvidenceDetails || []).map((item) => String(item.evidenceId || '').trim()).filter(Boolean));
    if (refs.some((ref) => !detailIds.has(ref))) return true;
  }
  return false;
}

function collectRecommendationReviewReasons(recommendations: Array<Partial<RecommendationView>>): string[] {
  const reasons = recommendations.flatMap((recommendation) => {
    const evidence = recommendation.evidence;
    return [
      ...(recommendation.status === 'needs_review' ? ['建议已进入复核队列。'] : []),
      ...(evidence?.aiInsightInvalidReasons || []),
      ...(evidence?.aiLifecycleStageInvalidReasons || []),
      ...(evidence?.aiEvidenceSufficiency?.blockers || []),
      ...(evidence?.decisionReasons || []),
      ...(evidence?.decisionRiskWarnings || []),
      ...(evidence?.quantReviewRequired ? ['规则量化要求人工复核。'] : []),
      ...(evidence?.quantReasons || []),
      ...(evidence?.decisionAgreement === 'conflict' ? ['AI 与规则冲突。'] : []),
      ...(evidence?.decisionAgreement === 'ai_only' ? ['AI 独立洞察不能直接审批。'] : []),
    ];
  });

  return Array.from(new Set(reasons.map((reason) => String(reason || '').trim()).filter(Boolean)));
}

function hasConcreteAiActionParticipation(evidence: Partial<RecommendationView>['evidence']): boolean {
  return evidence?.decisionAgreement === 'aligned' || evidence?.decisionAgreement === 'ai_only';
}

function cleanCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function readinessGatePassed(readiness: Partial<DeliveryReadinessView> | null | undefined, patterns: RegExp[]): boolean {
  return Boolean(readiness?.gates?.some((gate) => gate.ok && patterns.some((pattern) => pattern.test(gate.name))));
}

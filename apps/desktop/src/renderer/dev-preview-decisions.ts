// 历史开发预览职责模块；启用边界由原引导入口统一控制。
import type { WritableAdTargetEvidence } from '@amazon-ai-ops/shared-types';
import { applyRecommendationDecision, type RecommendationDecisionInput, type RecommendationDecisionStatus } from '@amazon-ai-ops/rules-engine';
import { normalizedPreviewText, normalizedPreviewPath } from './dev-preview-values';
import { type PreviewRecommendation, type PreviewScenarioContract } from './dev-preview-contracts';
import { previewScope, previewReportOptions, previewReportFileName } from './dev-preview-fixtures';

export function samePreviewWritableTarget(left: WritableAdTargetEvidence | undefined, right: WritableAdTargetEvidence | undefined): boolean {
    if (!left || !right)
        return false;
    return left.entityType === right.entityType
        && normalizedPreviewText(left.entityId).toLowerCase() === normalizedPreviewText(right.entityId).toLowerCase()
        && normalizedPreviewText(left.entityName).toLowerCase() === normalizedPreviewText(right.entityName).toLowerCase()
        && normalizedPreviewText(left.campaignName).toLowerCase() === normalizedPreviewText(right.campaignName).toLowerCase()
        && normalizedPreviewText(left.adGroupName).toLowerCase() === normalizedPreviewText(right.adGroupName).toLowerCase()
        && normalizedPreviewText(left.metricDate) === normalizedPreviewText(right.metricDate)
        && normalizedPreviewPath(left.sourceFile) === normalizedPreviewPath(right.sourceFile)
        && Number(left.sourceRow) === Number(right.sourceRow)
        && left.identitySource === right.identitySource
        && normalizedPreviewText(left.verifiedBy) === normalizedPreviewText(right.verifiedBy)
        && normalizedPreviewText(left.verifiedAt) === normalizedPreviewText(right.verifiedAt)
        && normalizedPreviewText(left.verificationNote) === normalizedPreviewText(right.verificationNote)
        && normalizedPreviewPath(left.identityProofPath) === normalizedPreviewPath(right.identityProofPath);
}

export function previewWritableTargetOwnershipBlockers(recommendation: PreviewRecommendation): string[] {
    const writableTarget = recommendation.evidence?.writableTarget;
    if (!writableTarget)
        return [];
    const blockers: string[] = [];
    const reportType = normalizedPreviewText(recommendation.evidence?.reportType).toLowerCase();
    if (!['keyword', 'auto_targeting', 'product_targeting'].includes(reportType)) {
        blockers.push(`当前建议来源报表类型 ${reportType || 'unknown'} 不能唯一映射到 Ads 可写对象`);
    }
    else if (writableTarget.entityType !== reportType) {
        blockers.push('核验到的 Ads 对象类型与当前建议来源不一致');
    }
    const expectedName = normalizedPreviewText(recommendation.evidence?.searchTerm
        || recommendation.evidence?.targeting
        || recommendation.entityName).toLowerCase();
    if (normalizedPreviewText(writableTarget.entityName).toLowerCase() !== expectedName) {
        blockers.push('核验到的 Ads 对象名称与当前建议对象不一致');
    }
    if (normalizedPreviewText(writableTarget.campaignName).toLowerCase()
        !== normalizedPreviewText(recommendation.evidence?.campaignName).toLowerCase()
        || normalizedPreviewText(writableTarget.adGroupName).toLowerCase()
            !== normalizedPreviewText(recommendation.evidence?.adGroupName).toLowerCase()) {
        blockers.push('核验到的 Ads 对象不属于当前建议的 campaign / ad group');
    }
    if (!recommendation.evidence?.sourceFiles?.some((sourceFile) => normalizedPreviewPath(sourceFile) === normalizedPreviewPath(writableTarget.sourceFile))
        || Number(writableTarget.sourceRow) !== Number(recommendation.evidence?.sourceRow)) {
        blockers.push('核验到的 Ads 对象来源行与当前建议来源权威不一致');
    }
    if (normalizedPreviewText(writableTarget.metricDate) !== normalizedPreviewText(recommendation.evidence?.date)) {
        blockers.push('核验到的 Ads 对象指标日期与当前建议不一致');
    }
    const binding = recommendation.evidence?.writableTargetBinding;
    const resolution = recommendation.evidence?.reviewResolution;
    const currentBinding = Boolean(binding)
        && binding?.schemaVersion === 1
        && binding.fromRevision + 1 === binding.boundRevision
        && binding.boundRevision === recommendation.revision
        && samePreviewWritableTarget(binding.writableTarget, writableTarget);
    const currentResolution = Boolean(resolution)
        && resolution?.schemaVersion === 1
        && resolution.fromRevision + 1 === resolution.resolvedRevision
        && resolution.resolvedRevision === recommendation.revision
        && samePreviewWritableTarget(resolution.writableTarget, writableTarget);
    if (!currentBinding && !currentResolution) {
        blockers.push('缺少当前建议版本对应的 Ads 对象绑定或复核审计');
    }
    return blockers;
}

export function previewDecisionSnapshot(recommendation: PreviewRecommendation, targetStatus: RecommendationDecisionStatus, decision: RecommendationDecisionInput, decidedAt: string): RecommendationDecisionInput {
    return {
        ...decision,
        decision: targetStatus,
        approvedBy: targetStatus === 'approved'
            ? normalizedPreviewText(decision.approvedBy)
            : undefined,
        rejectedBy: targetStatus === 'rejected'
            ? normalizedPreviewText(decision.rejectedBy)
            : undefined,
        decidedAt,
        note: normalizedPreviewText(decision.note),
        batchId: recommendation.evidence?.batchId,
        recommendationId: recommendation.id,
        actionType: recommendation.actionType,
        portfolioName: recommendation.evidence?.portfolioName,
        campaignName: recommendation.evidence?.campaignName,
        adGroupName: recommendation.evidence?.adGroupName,
        asin: recommendation.asin,
        entityType: recommendation.entityType,
        entityName: recommendation.entityName,
        currentValue: recommendation.currentValue,
        recommendedValue: recommendation.recommendedValue,
        sourceBatchId: recommendation.evidence?.batchId,
        metricDate: recommendation.evidence?.date,
        sourceRow: recommendation.evidence?.sourceRow,
        sourceFiles: [...(recommendation.evidence?.sourceFiles || [])],
        explanationSource: recommendation.evidence?.explanationSource,
        aiModel: recommendation.evidence?.aiModel,
        aiStrategySource: recommendation.evidence?.aiStrategySource,
        aiLifecycleStage: recommendation.evidence?.aiLifecycleStage,
        aiStrategySummary: recommendation.evidence?.aiStrategySummary,
        decisionAgreement: recommendation.evidence?.decisionAgreement,
        decisionSource: recommendation.evidence?.decisionSource,
        decisionReasons: [...(recommendation.evidence?.decisionReasons || [])],
        decisionRiskWarnings: [...(recommendation.evidence?.decisionRiskWarnings || [])],
        quantReasons: [...(recommendation.evidence?.quantReasons || [])],
        quantThresholds: recommendation.evidence?.quantThresholds,
        scope: {
            dateFrom: previewScope.dateFrom,
            dateTo: previewScope.dateTo,
            storeName: previewScope.storeName,
            marketplaceCode: previewScope.marketplaceCode,
            asin: recommendation.asin,
        },
    };
}

export function applyPreviewRecommendationDecision(recommendation: PreviewRecommendation, targetStatus: RecommendationDecisionStatus, decision: RecommendationDecisionInput, decidedAt = new Date().toISOString()): void {
    applyRecommendationDecision({
        recommendation,
        targetStatus,
        decision: previewDecisionSnapshot(recommendation, targetStatus, decision, decidedAt),
        approvalOptions: {
            allowedSourceFiles: previewReportOptions.map((report) => previewReportFileName(String(report.type))),
            writableTargetOwnershipBlockers: previewWritableTargetOwnershipBlockers(recommendation),
        },
        persist: (status, evidencePatch) => {
            recommendation.status = status;
            recommendation.revision += 1;
            recommendation.updatedAt = decidedAt;
            recommendation.evidence = {
                ...recommendation.evidence,
                ...evidencePatch,
            } as PreviewRecommendation['evidence'];
        },
    });
}

export function previewReadinessGates(scenario: PreviewScenarioContract) {
    const recommendationsReady = scenario.recommendationState === 'mixed'
        || scenario.recommendationState === 'approved';
    const steps = [
        { id: 'scope', label: '工作范围', ok: scenario.scopeReady },
        { id: 'reports', label: '真实报表布局', ok: scenario.reportsCollected },
        { id: 'import', label: '导入状态', ok: scenario.reportsImported },
        { id: 'diagnosis', label: '广告诊断', ok: scenario.diagnosisReady },
        { id: 'recommendations', label: '建议与审批', ok: recommendationsReady },
        { id: 'readback', label: '结果核对', ok: scenario.readbackEvidenceReady },
        { id: 'workflow', label: '页面流程', ok: scenario.deliveryReady },
    ];
    return steps.map((step) => ({
        id: `preview-${step.id}`,
        name: `开发预览·${step.label}`,
        ok: step.ok,
        status: step.ok ? 'passed' : 'needs_work',
        message: step.ok
            ? `${step.label}预览状态已具备。`
            : `${step.label}预览状态尚未具备。`,
    }));
}

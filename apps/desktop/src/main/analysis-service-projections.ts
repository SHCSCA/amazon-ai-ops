import {
  type ActionRecommendation,
  type AnalysisAuthorizationBlocker,
  type AnalysisAuthorizationBlockerCode,
  type AnalysisEvidencePackageRecord,
  type AnalysisProposalSnapshotRecord,
  type AuthorizeAnalysisProposalBatchRequest,
  type AuthorizeAnalysisProposalBatchResult,
  type MissionGrantRecord,
  type MissionAnalysisRunProjection,
  type MissionAnalysisProjection,
  type PolicyVersionRules,
  type RunMissionAnalysisRequest,
  type RunMissionAnalysisResult,
  type StoreContextEnvelope,
  type VerifiedAdEntityAuthorityRecord,
  type WritableAdTargetEvidence,
} from '@amazon-ai-ops/shared-types';
import type { AnalysisRunRecord } from '@amazon-ai-ops/shared-types';
import {
  analysisBlocker,
  analysisErrorCode,
  uniqueAnalysisBlockers,
} from './analysis-authority-blockers';
import { assertRendererPayloadIsPathFree } from './main-artifact-registry';
import { runtimeLogger } from './runtime-logger';
import {
  analysisRunFailureOperatorReason,
} from './analysis-service-values';

export function projectMissionAnalysisRun(
  run: AnalysisRunRecord,
  missionId: string,
): MissionAnalysisRunProjection {
  if (run.status === 'completed') {
    return {
      status: 'done',
      missionId,
      evidencePackageId: typeof run.metadata?.evidencePackageId === 'string'
        ? run.metadata.evidencePackageId
        : undefined,
    };
  }
  if (run.status === 'analyzing') return { status: 'running', missionId };
  return {
    status: 'retryable',
    missionId,
    blockerCodes: [analysisErrorCode(new Error(run.blockedReason ?? ''))],
  };
}

export function projectAnalysisRunForRenderer(context: StoreContextEnvelope, run: AnalysisRunRecord, activeRuns: ReadonlySet<string>): AnalysisRunRecord {
    const allowed = ['storeContext', 'missionRevision', 'policyRevision', 'fingerprint', 'evidencePackageId', 'evidencePackageHash', 'actionBatchId', 'reusedFromRunId', 'provenance', 'productId', 'dateFrom', 'dateTo', 'ruleRevision', 'modelRevision', 'proposalsGenerated', 'skippedUnsupportedCount', 'aiSummary', 'recommendationSummary'] as const;
    const metadata = Object.fromEntries(allowed.flatMap(key => {
      const value = run.metadata?.[key];
      if (value === undefined) return [];
      try { assertRendererPayloadIsPathFree({ [key]: value }); return [[key, value]]; }
      catch (error) {
        runtimeLogger.warn('analysis.history_metadata_redacted', { field: key, errorName: error instanceof Error ? error.name : 'UnknownError' });
        return [];
      }
    })) as NonNullable<AnalysisRunRecord['metadata']>;
    let blockedReason = run.blockedReason;
    try { assertRendererPayloadIsPathFree(blockedReason); }
    catch (error) {
      runtimeLogger.warn('analysis.history_reason_redacted', { errorName: error instanceof Error ? error.name : 'UnknownError' });
      blockedReason = analysisRunFailureOperatorReason(new Error(blockedReason));
    }
    const interrupted = ['pending', 'analyzing'].includes(run.status) && (!activeRuns.has(run.runId)
      || JSON.stringify(metadata.storeContext) !== JSON.stringify(context));
    return { ...run, status: interrupted ? 'blocked' : run.status,
      blockedReason: interrupted ? '上次分析已中断；刷新当前店铺后重新运行分析。' : blockedReason,
      metadata: { ...metadata, historicalOnly: metadata.provenance !== 'analysis-authority/v16' } };
  }

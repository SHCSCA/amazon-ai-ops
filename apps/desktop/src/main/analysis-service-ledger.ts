import type { MissionDomainRepository } from '@amazon-ai-ops/local-db';
import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { compactId, analysisRunFailureOperatorReason } from './analysis-service-values';
import { runtimeLogger } from './runtime-logger';

export function appendAnalysisFailureReceiptBestEffort(repository: MissionDomainRepository,
  context: StoreContextEnvelope,
  missionId: string,
  analysisRunId: string,
  error: unknown
): void {
    try {
      repository.appendCausalEvent(context, {
        id: compactId('analysis-run-event', [analysisRunId, 'failed']),
        stage: 'ANALYSIS',
        eventType: 'analysis_run_failed',
        entityType: 'analysis_run',
        entityId: analysisRunId,
        missionId,
        title: '分析未完成',
        signal: analysisRunFailureOperatorReason(error),
        status: 'failed',
        source: 'analysis-authority',
        actorId: 'analysis-agent',
      });
    } catch (receiptError) {
      runtimeLogger.error('analysis.failure_receipt_append_failed', { error: receiptError, originalError: error });
    }
  }

export function appendAnalysisCheckpointOnce(repository: MissionDomainRepository,
  context: StoreContextEnvelope,
  missionId: string,
  actionBatchId: string,
  stage: 'FACT' | 'ANALYSIS',
  title: string,
  evidenceCount: number
): void {
    const id = compactId('analysis-checkpoint', [missionId, actionBatchId, stage]);
    const exists = repository.listMissionCheckpoints(context, missionId)
      .some((checkpoint) => checkpoint.id === id);
    if (exists) return;
    repository.appendMissionCheckpoint(context, {
      id,
      missionId,
      stage,
      title,
      status: 'completed',
      evidenceCount,
      actorId: 'analysis-agent',
    });
  }


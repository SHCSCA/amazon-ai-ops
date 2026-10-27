import type {
  StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import {
  missionControlContextKey,
  normalizeStoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import {
  type ResumeAdmissionStage,
  type LingxingCollectionPersistence,
  type RequiredResumePersistence,
} from "./collection-coordinator-contracts";

export function resumeAdmissionError(
  stage: ResumeAdmissionStage,
  operatorStage: string,
  error: unknown,
): Error {
  const detail = error instanceof Error ? error.message : String(error);
  return new Error(
    `LINGXING_COLLECTION_RESUME_${stage}_FAILED: ${operatorStage}：${detail}`,
  );
}

export function requireResumePersistence(
  persistence: LingxingCollectionPersistence,
): RequiredResumePersistence {
  const required: Array<keyof RequiredResumePersistence> = [
    'acquireCollectionResumeClaimForStore',
    'commitCollectionResumeProgressForStore',
    'commitCollectionResumeRunnerResultForStore',
    'advanceCollectionResumeClaimAfterImportForStore',
    'finalizeCollectionResumeAttemptForStore',
    'interruptCollectionResumeClaimForStore',
  ];
  if (required.some((key) => typeof persistence[key] !== 'function')) {
    throw new Error('LINGXING_COLLECTION_RESUME_PERSISTENCE_UNAVAILABLE');
  }
  return persistence as LingxingCollectionPersistence & RequiredResumePersistence;
}

export function assertResumeExecutionContext(
  durableValue: StoreContextEnvelope,
  currentValue: StoreContextEnvelope,
): void {
  const durable = normalizeStoreContextEnvelope(durableValue);
  const current = normalizeStoreContextEnvelope(currentValue);
  const stableDurable = { ...durable, sessionGeneration: 0 };
  const stableCurrent = { ...current, sessionGeneration: 0 };
  if (
    missionControlContextKey(stableDurable) !== missionControlContextKey(stableCurrent)
    || current.sessionGeneration < durable.sessionGeneration
  ) {
    throw new Error('LINGXING_COLLECTION_RESUME_EXECUTION_CONTEXT_MISMATCH');
  }
}

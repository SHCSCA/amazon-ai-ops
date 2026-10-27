import {
  ANALYSIS_REQUIRED_REPORT_TYPES,
  normalizeStoreContextEnvelope,
  type StoreRuntimeConfigRecord,
} from '@amazon-ai-ops/shared-types';
import type {
  StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import {
  type CollectionResumeAttemptReceipt,
  type LingxingCollectionAuthorityProof,
} from '@amazon-ai-ops/local-db';
import type {
  StoreCollectionProtectedSemanticAttemptReadback,
} from './store-collection-orchestrator';
import {
  exactSucceededResumeReceipt,
} from "./collection-schedule-view-resume-proof";

export function assertUsContext(context: StoreContextEnvelope): void {
  if (context.marketplace !== 'US'
    || context.currency !== 'USD'
    || context.businessTimezone !== 'America/Los_Angeles') {
    throw new Error('store collection read model requires US/USD/America/Los_Angeles authority');
  }
}

export function assertConfig(
  context: StoreContextEnvelope,
  config: StoreRuntimeConfigRecord,
): void {
  if (config.storeId !== context.storeId
    || config.marketplace !== 'US'
    || config.currency !== 'USD'
    || config.businessTimezone !== 'America/Los_Angeles'
    || !['active', 'archived'].includes(config.status)
    || !Number.isSafeInteger(config.revision)
    || config.revision < 1
    || !/^([01]\d|2[0-3]):([0-5]\d)$/.test(config.values?.collectionScheduleLocalTime)
    || !Number.isSafeInteger(config.values?.collectionLookbackDays)
    || config.values.collectionLookbackDays < 1
    || config.values.collectionLookbackDays > 90) {
    throw new Error('store collection config does not match the active US Store authority');
  }
}

export function assertDurableIdentity(
  context: StoreContextEnvelope,
  window: { dateStart: string; dateEnd: string },
  proof: LingxingCollectionAuthorityProof,
): StoreContextEnvelope {
  let requestContext: StoreContextEnvelope;
  try {
    requestContext = normalizeStoreContextEnvelope(proof.job.request.storeContext);
  } catch {
    throw new Error('authority DB job identity mismatch');
  }
  const exactReports = proof.job.request.reportTypes;
  if (proof.jobRow.storeId !== context.storeId
    || proof.jobRow.browserProfileId !== context.browserProfileId
    || proof.jobRow.marketplace !== 'US'
    || proof.jobRow.currency !== 'USD'
    || proof.jobRow.businessTimezone !== 'America/Los_Angeles'
    || proof.jobRow.businessDate !== context.businessDate
    || proof.jobRow.dateStart !== window.dateStart
    || proof.jobRow.dateEnd !== window.dateEnd
    || proof.jobRow.mode !== 'create-and-download'
    || proof.jobRow.jobId !== proof.job.jobId
    || proof.jobRow.requestId !== proof.job.request.requestId
    || proof.jobRow.state !== proof.job.state
    || requestContext.storeId !== context.storeId
    || requestContext.browserProfileId !== context.browserProfileId
    || requestContext.marketplace !== 'US'
    || requestContext.currency !== 'USD'
    || requestContext.businessTimezone !== 'America/Los_Angeles'
    || requestContext.businessDate !== context.businessDate
    || requestContext.sessionGeneration !== proof.jobRow.sessionGeneration
    || requestContext.sessionGeneration > context.sessionGeneration
    || proof.job.request.dateStart !== window.dateStart
    || proof.job.request.dateEnd !== window.dateEnd
    || proof.job.request.mode !== 'create-and-download'
    || exactReports.length !== ANALYSIS_REQUIRED_REPORT_TYPES.length
    || new Set(exactReports).size !== ANALYSIS_REQUIRED_REPORT_TYPES.length
    || ANALYSIS_REQUIRED_REPORT_TYPES.some((reportType) => !exactReports.includes(reportType))) {
    throw new Error('authority DB job identity mismatch');
  }
  return requestContext;
}

export function assertProtectedIdentity(
  context: StoreContextEnvelope,
  fingerprint: string,
  protectedReadback: Readonly<StoreCollectionProtectedSemanticAttemptReadback>,
  durable?: LingxingCollectionAuthorityProof,
  durableState?: 'claimed' | 'succeeded' | 'failed',
  succeededResumeReceipt?: CollectionResumeAttemptReceipt,
): void {
  const semantic = protectedReadback.semanticAttempt;
  const terminal = protectedReadback.terminalOutcome;
  const semanticMatches = semantic.storeId === context.storeId
    && semantic.browserProfileId === context.browserProfileId
    && semantic.businessDate === context.businessDate
    && semantic.expectedFingerprint === fingerprint
    && Number.isSafeInteger(semantic.sessionGeneration)
    && semantic.sessionGeneration <= context.sessionGeneration
    && typeof semantic.schedulerRequestId === 'string'
    && semantic.schedulerRequestId.length > 0;
  const terminalMatches = !terminal || (
    terminal.cycleId === semantic.cycleId
    && terminal.transitionId === semantic.transitionId
    && terminal.storeId === semantic.storeId
    && terminal.browserProfileId === semantic.browserProfileId
    && terminal.businessDate === semantic.businessDate
    && terminal.sessionGeneration === semantic.sessionGeneration
    && terminal.fingerprint === semantic.expectedFingerprint
    && terminal.attemptId === semantic.schedulerAttemptId
    && terminal.requestId === semantic.schedulerRequestId
  );
  const durableMatches = !durable
    || (durable.jobRow.requestId === semantic.schedulerRequestId
      && durable.jobRow.sessionGeneration === semantic.sessionGeneration);
  const terminalStateMatches = !durable || durableProtectedTerminalMatches(
    durableState,
    terminal?.state ?? null,
    context,
    durable,
    succeededResumeReceipt,
  );
  if (!semanticMatches || !terminalMatches || !durableMatches || !terminalStateMatches) {
    throw new Error('authority DB/protected semantic attempt identity mismatch');
  }
}

export function durableProtectedTerminalMatches(
  durableState: 'claimed' | 'succeeded' | 'failed' | undefined,
  protectedTerminal: 'succeeded' | 'blocked' | 'failed' | null,
  current: StoreContextEnvelope,
  durable: LingxingCollectionAuthorityProof,
  succeededResumeReceipt?: CollectionResumeAttemptReceipt,
): boolean {
  if (!durableState) return false;
  if (protectedTerminal === null) return durableState === 'claimed';
  if (protectedTerminal === 'succeeded') return durableState === 'succeeded';
  if (durableState === 'succeeded') {
    return exactSucceededResumeReceipt(current, durable, succeededResumeReceipt);
  }
  return durableState === 'failed';
}

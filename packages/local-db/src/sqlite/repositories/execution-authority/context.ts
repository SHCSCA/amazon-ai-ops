import type { BatchRow } from './contracts';
import type Database from 'better-sqlite3';
import  {
  type AdExecutionBatchProjection,
  type AdExecutionReconciliationCase,
  type AdExecutionReconciliationObservation,
  type AdExecutionUnknownReconciliationStatus,
  type AdExecutionBatchRecord,
  type AdExecutionEvidenceInput,
  type AdExecutionEvidenceSlot,
  type AdExecutionEventType,
  type AdExecutionJobTransitionRequest,
  type AdExecutionStartupRecoveryResult,
  type AdExecutionStatus,
  type AdExecutionTransitionResult,
  type AdKeywordAliasResolutionRecord,
  type AdKeywordIdentityVersionRecord,
  type CreateAdExecutionBatchResult,
  type CompleteAdExecutionDomainReconciliationResult,
  type MarkAdExecutionTerminalRequest,
  type RecordAdExecutionEvidenceRequest,
  type RecordAdExecutionPreflightRequest,
  type RecordAdExecutionSubmitIntentRequest,
  type RecordAdKeywordAliasResolutionInput,
  type RegisterAdKeywordIdentityInput,
  type ResolveCanonicalKeywordInput,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import { MissionDomainRepository } from '../mission-domain-repo';
import  {
  AppendPolicyGrantDispatchEventInput,
  PolicyGrantDispatchRecord,
  PolicyGrantDispatchStartupRecoveryResult,
  ReconciliationRow,
  JobRow,
  EvidenceRow,
  GrantRow,
  ProposalDecisionRow,
} from './contracts';
export interface ExecutionAuthorityRepositoryContext {
    ensureVerifiedReadbackMemory(batch: BatchRow, evidence: readonly EvidenceRow[]): void;
    db: Database.Database;
    now: () => Date;
    missionRepository: MissionDomainRepository;
    registerCanonicalKeywordIdentity(contextInput: StoreContextEnvelope, input: RegisterAdKeywordIdentityInput): AdKeywordIdentityVersionRecord;
    resolveCanonicalKeyword(contextInput: StoreContextEnvelope, input: ResolveCanonicalKeywordInput): AdKeywordIdentityVersionRecord;
    listCanonicalKeywordIdentities(contextInput: StoreContextEnvelope): readonly AdKeywordIdentityVersionRecord[];
    recordCanonicalKeywordAliasResolution(contextInput: StoreContextEnvelope, input: RecordAdKeywordAliasResolutionInput): AdKeywordAliasResolutionRecord;
    createExactExecutionBatch(contextInput: StoreContextEnvelope, grantIdInput: string): CreateAdExecutionBatchResult;
    getExecutionBatch(contextInput: StoreContextEnvelope, batchIdInput: string): AdExecutionBatchProjection | undefined;
    listExecutionBatches(contextInput: StoreContextEnvelope): readonly AdExecutionBatchProjection[];
    listExecutionBatchesForStoreReconciliation(contextInput: StoreContextEnvelope): readonly AdExecutionBatchProjection[];
    startJob(contextInput: StoreContextEnvelope, input: Omit<AdExecutionJobTransitionRequest, 'context'>): AdExecutionTransitionResult;
    recordPreflight(contextInput: StoreContextEnvelope, input: Omit<RecordAdExecutionPreflightRequest, 'context'>): AdExecutionTransitionResult;
    recordSubmitIntent(contextInput: StoreContextEnvelope, input: Omit<RecordAdExecutionSubmitIntentRequest, 'context'>): AdExecutionTransitionResult;
    recordSubmitted(contextInput: StoreContextEnvelope, input: Omit<AdExecutionJobTransitionRequest, 'context'>): AdExecutionTransitionResult;
    recordAfterEvidence(contextInput: StoreContextEnvelope, input: Omit<RecordAdExecutionEvidenceRequest, 'context'>): AdExecutionTransitionResult;
    recordReloadVerified(contextInput: StoreContextEnvelope, input: Omit<RecordAdExecutionEvidenceRequest, 'context'>): AdExecutionTransitionResult;
    markBlocked(contextInput: StoreContextEnvelope, input: Omit<MarkAdExecutionTerminalRequest, 'context'>): AdExecutionTransitionResult;
    markNotSubmittedAfterIntent(contextInput: StoreContextEnvelope, input: Omit<MarkAdExecutionTerminalRequest, 'context'>): AdExecutionTransitionResult;
    markUnknown(contextInput: StoreContextEnvelope, input: Omit<MarkAdExecutionTerminalRequest, 'context'>): AdExecutionTransitionResult;
    terminalizePostIntentUnknownAfterAuthorityLoss(contextInput: StoreContextEnvelope, input: Omit<MarkAdExecutionTerminalRequest, 'context'>): AdExecutionBatchProjection;
    cancelJob(contextInput: StoreContextEnvelope, input: Omit<MarkAdExecutionTerminalRequest, 'context'>): AdExecutionTransitionResult;
    appendPolicyGrantDispatchEvent(contextInput: StoreContextEnvelope, input: AppendPolicyGrantDispatchEventInput): PolicyGrantDispatchRecord;
    listPolicyGrantDispatches(contextInput: StoreContextEnvelope): readonly PolicyGrantDispatchRecord[];
    recoverPolicyGrantDispatchesOnStartup(): PolicyGrantDispatchStartupRecoveryResult;
    recoverInterruptedExecutions(): AdExecutionStartupRecoveryResult;
    completeDomainReconciliation(contextInput: StoreContextEnvelope, batchIdInput: string): CompleteAdExecutionDomainReconciliationResult;
    markUnknownInternal(context: StoreContextEnvelope, input: Omit<MarkAdExecutionTerminalRequest, 'context'>): AdExecutionTransitionResult;
    transition(contextInput: StoreContextEnvelope, input: Omit<AdExecutionJobTransitionRequest, 'context'>, allowedFrom: readonly AdExecutionStatus[], toStatus: AdExecutionStatus, eventType: AdExecutionEventType, actorId: string, reasonCode?: string, detail?: string, times?: {
        intentWrittenAt?: string;
        submittedAt?: string;
        terminalAt?: string;
        submitIntentId?: string;
        commandFingerprint?: string;
    }, allowStaleJobSession?: boolean): AdExecutionTransitionResult;
    applyTransition(context: StoreContextEnvelope, job: JobRow, toStatus: AdExecutionStatus, eventType: AdExecutionEventType, actorId: string, reasonCode?: string, detail?: string, times?: {
        intentWrittenAt?: string;
        submittedAt?: string;
        terminalAt?: string;
        submitIntentId?: string;
        commandFingerprint?: string;
    }): AdExecutionTransitionResult;
    recordGrantSlot(job: JobRow, eventType: 'reserved' | 'spent', createdAt: string): void;
    assertExactReadback(job: JobRow, input: Pick<RecordAdExecutionPreflightRequest, 'pageIdentityHash' | 'canonicalKeywordId' | 'objectRevision'>): void;
    assertEvidenceMatchesJob(job: JobRow, evidence: AdExecutionEvidenceInput): void;
    insertEvidence(context: StoreContextEnvelope, job: JobRow, slot: AdExecutionEvidenceSlot, evidence: AdExecutionEvidenceInput): void;
    requireMutableJob(context: StoreContextEnvelope, jobIdInput: string, expectedRevisionInput: number, allowedFrom: readonly AdExecutionStatus[], allowStaleJobSession?: boolean): JobRow;
    requireGrant(context: StoreContextEnvelope, grantId: string): GrantRow;
    assertExecutionGrantAuthority(contextInput: StoreContextEnvelope, grantIdInput: string): void;
    ensureCausalEvidenceRef(storeId: string, eventId: string, evidence: EvidenceRow, createdAt: string, identityScope?: string): void;
    ensureExecutionGrantTerminal(storeId: string, grantId: string, batchId: string, batchStatus: Extract<AdExecutionStatus, 'succeeded' | 'blocked' | 'unknown' | 'cancelled'>, createdAt: string): boolean;
    ensureExecutionGrantCausalEvent(storeId: string, grantId: string, batchId: string, eventType: 'consumed' | 'invalidated', actorId: string, reason: string | null, createdAt: string): void;
    requireProposalDecision(context: StoreContextEnvelope, decisionId: string): ProposalDecisionRow;
    validateProposalDecision(context: StoreContextEnvelope, grant: GrantRow, row: ProposalDecisionRow): void;
    requireLatestIdentityForEntity(context: StoreContextEnvelope, adEntityId: string, entityRevision: number): AdKeywordIdentityVersionRecord;
    listPolicyGrantDispatchesInternal(context: StoreContextEnvelope): PolicyGrantDispatchRecord[];
    appendPolicyGrantDispatchEventInternal(context: StoreContextEnvelope, input: AppendPolicyGrantDispatchEventInput, createdAt: string): void;
    durableStoreSessionGeneration(storeId: string): number;
    assertStoreContext(contextInput: StoreContextEnvelope): StoreContextEnvelope;
    assertContext(contextInput: StoreContextEnvelope, expectedAdsAccountId?: string): StoreContextEnvelope;
    requireIdentityVersion(storeId: string, canonicalKeywordId: string, objectRevision: number): AdKeywordIdentityVersionRecord;
    requireProjection(storeId: string, batchId: string): AdExecutionBatchProjection;
    beginUnknownReconciliation(contextInput: StoreContextEnvelope, jobId: string): {
        created: boolean;
        record: AdExecutionReconciliationCase;
    };
    recordUnknownObservation(contextInput: StoreContextEnvelope, caseId: string, slot: 'first' | 'reload', input: AdExecutionReconciliationObservation): void;
    finishUnknownReconciliation(contextInput: StoreContextEnvelope, caseId: string, interrupted?: boolean): AdExecutionReconciliationCase;
    reconciliationRow(caseId: string): ReconciliationRow;
    finishReconciliationInternal(row: ReconciliationRow, outcome: AdExecutionUnknownReconciliationStatus): AdExecutionReconciliationCase;
    insertEvent(input: {
        storeId: string;
        batchId: string;
        jobId: string;
        sequence: number;
        eventType: AdExecutionEventType;
        fromStatus: AdExecutionStatus;
        toStatus: AdExecutionStatus;
        actorId: string;
        reasonCode?: string;
        detail?: string;
        sessionGeneration: number;
        createdAt: string;
    }): void;
    nextEventSequence(storeId: string, jobId: string): number;
    refreshBatchStatus(storeId: string, batchId: string, updatedAt: string): AdExecutionBatchRecord;
    immediate<T>(work: () => T): T;
    timestamp(): string;
}

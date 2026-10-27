import type Database from 'better-sqlite3';
import  {
  type AdExecutionBatchProjection,
  type AdExecutionReconciliationCase,
  type AdExecutionReconciliationObservation,
  type AdExecutionJobTransitionRequest,
  type AdExecutionStartupRecoveryResult,
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
import { createExecutionAuthorityRepositoryContext } from './execution-authority/composition';
import type { ExecutionAuthorityRepositoryContext } from './execution-authority/context';
import type  {
  ExecutionAuthorityErrorCode,
  ExecutionAuthorityRepositoryOptions,
  PolicyGrantDispatchStatus,
  PolicyGrantDispatchTrigger,
  PolicyGrantDispatchCode,
  AppendPolicyGrantDispatchEventInput,
  PolicyGrantDispatchRecord,
  PolicyGrantDispatchStartupRecoveryResult,
} from './execution-authority/contracts';
export type { ExecutionAuthorityErrorCode, ExecutionAuthorityRepositoryOptions, PolicyGrantDispatchStatus, PolicyGrantDispatchTrigger, PolicyGrantDispatchCode, AppendPolicyGrantDispatchEventInput, PolicyGrantDispatchRecord, PolicyGrantDispatchStartupRecoveryResult } from './execution-authority/contracts';
export { ExecutionAuthorityRepositoryError, ExecutionAuthorityGateError } from './execution-authority/errors';
export { POLICY_GRANT_DISPATCH_ENTITY_TYPE } from './execution-authority/dispatch-values';
export { POLICY_GRANT_DISPATCH_SOURCE } from './execution-authority/dispatch-values';
export { isPolicyExecutionBatchSafelyRestartable } from './execution-authority/values';
export class ExecutionAuthorityRepository {
    private readonly context: ExecutionAuthorityRepositoryContext;
    constructor(db: Database.Database, options: ExecutionAuthorityRepositoryOptions = {}) {
        this.context = createExecutionAuthorityRepositoryContext(db, options);
    }
    registerCanonicalKeywordIdentity(contextInput: StoreContextEnvelope, input: RegisterAdKeywordIdentityInput): AdKeywordIdentityVersionRecord {
        return this.context.registerCanonicalKeywordIdentity(contextInput, input);
    }
    resolveCanonicalKeyword(contextInput: StoreContextEnvelope, input: ResolveCanonicalKeywordInput): AdKeywordIdentityVersionRecord {
        return this.context.resolveCanonicalKeyword(contextInput, input);
    }
    listCanonicalKeywordIdentities(contextInput: StoreContextEnvelope): readonly AdKeywordIdentityVersionRecord[] {
        return this.context.listCanonicalKeywordIdentities(contextInput);
    }
    recordCanonicalKeywordAliasResolution(contextInput: StoreContextEnvelope, input: RecordAdKeywordAliasResolutionInput): AdKeywordAliasResolutionRecord {
        return this.context.recordCanonicalKeywordAliasResolution(contextInput, input);
    }
    createExactExecutionBatch(contextInput: StoreContextEnvelope, grantIdInput: string): CreateAdExecutionBatchResult {
        return this.context.createExactExecutionBatch(contextInput, grantIdInput);
    }
    getExecutionBatch(contextInput: StoreContextEnvelope, batchIdInput: string): AdExecutionBatchProjection | undefined {
        return this.context.getExecutionBatch(contextInput, batchIdInput);
    }
    listExecutionBatches(contextInput: StoreContextEnvelope): readonly AdExecutionBatchProjection[] {
        return this.context.listExecutionBatches(contextInput);
    }
    listExecutionBatchesForStoreReconciliation(contextInput: StoreContextEnvelope): readonly AdExecutionBatchProjection[] {
        return this.context.listExecutionBatchesForStoreReconciliation(contextInput);
    }
    startJob(contextInput: StoreContextEnvelope, input: Omit<AdExecutionJobTransitionRequest, 'context'>): AdExecutionTransitionResult {
        return this.context.startJob(contextInput, input);
    }
    recordPreflight(contextInput: StoreContextEnvelope, input: Omit<RecordAdExecutionPreflightRequest, 'context'>): AdExecutionTransitionResult {
        return this.context.recordPreflight(contextInput, input);
    }
    recordSubmitIntent(contextInput: StoreContextEnvelope, input: Omit<RecordAdExecutionSubmitIntentRequest, 'context'>): AdExecutionTransitionResult {
        return this.context.recordSubmitIntent(contextInput, input);
    }
    recordSubmitted(contextInput: StoreContextEnvelope, input: Omit<AdExecutionJobTransitionRequest, 'context'>): AdExecutionTransitionResult {
        return this.context.recordSubmitted(contextInput, input);
    }
    recordAfterEvidence(contextInput: StoreContextEnvelope, input: Omit<RecordAdExecutionEvidenceRequest, 'context'>): AdExecutionTransitionResult {
        return this.context.recordAfterEvidence(contextInput, input);
    }
    recordReloadVerified(contextInput: StoreContextEnvelope, input: Omit<RecordAdExecutionEvidenceRequest, 'context'>): AdExecutionTransitionResult {
        return this.context.recordReloadVerified(contextInput, input);
    }
    markBlocked(contextInput: StoreContextEnvelope, input: Omit<MarkAdExecutionTerminalRequest, 'context'>): AdExecutionTransitionResult {
        return this.context.markBlocked(contextInput, input);
    }
    markNotSubmittedAfterIntent(contextInput: StoreContextEnvelope, input: Omit<MarkAdExecutionTerminalRequest, 'context'>): AdExecutionTransitionResult {
        return this.context.markNotSubmittedAfterIntent(contextInput, input);
    }
    markUnknown(contextInput: StoreContextEnvelope, input: Omit<MarkAdExecutionTerminalRequest, 'context'>): AdExecutionTransitionResult {
        return this.context.markUnknown(contextInput, input);
    }
    terminalizePostIntentUnknownAfterAuthorityLoss(contextInput: StoreContextEnvelope, input: Omit<MarkAdExecutionTerminalRequest, 'context'>): AdExecutionBatchProjection {
        return this.context.terminalizePostIntentUnknownAfterAuthorityLoss(contextInput, input);
    }
    cancelJob(contextInput: StoreContextEnvelope, input: Omit<MarkAdExecutionTerminalRequest, 'context'>): AdExecutionTransitionResult {
        return this.context.cancelJob(contextInput, input);
    }
    appendPolicyGrantDispatchEvent(contextInput: StoreContextEnvelope, input: AppendPolicyGrantDispatchEventInput): PolicyGrantDispatchRecord {
        return this.context.appendPolicyGrantDispatchEvent(contextInput, input);
    }
    listPolicyGrantDispatches(contextInput: StoreContextEnvelope): readonly PolicyGrantDispatchRecord[] {
        return this.context.listPolicyGrantDispatches(contextInput);
    }
    recoverPolicyGrantDispatchesOnStartup(): PolicyGrantDispatchStartupRecoveryResult {
        return this.context.recoverPolicyGrantDispatchesOnStartup();
    }
    recoverInterruptedExecutions(): AdExecutionStartupRecoveryResult {
        return this.context.recoverInterruptedExecutions();
    }
    completeDomainReconciliation(contextInput: StoreContextEnvelope, batchIdInput: string): CompleteAdExecutionDomainReconciliationResult {
        return this.context.completeDomainReconciliation(contextInput, batchIdInput);
    }
    assertExecutionGrantAuthority(contextInput: StoreContextEnvelope, grantIdInput: string): void {
        return this.context.assertExecutionGrantAuthority(contextInput, grantIdInput);
    }
    beginUnknownReconciliation(contextInput: StoreContextEnvelope, jobId: string): {
        created: boolean;
        record: AdExecutionReconciliationCase;
    } {
        return this.context.beginUnknownReconciliation(contextInput, jobId);
    }
    recordUnknownObservation(contextInput: StoreContextEnvelope, caseId: string, slot: 'first' | 'reload', input: AdExecutionReconciliationObservation): void {
        return this.context.recordUnknownObservation(contextInput, caseId, slot, input);
    }
    finishUnknownReconciliation(contextInput: StoreContextEnvelope, caseId: string, interrupted = false): AdExecutionReconciliationCase {
        return this.context.finishUnknownReconciliation(contextInput, caseId, interrupted);
    }
}

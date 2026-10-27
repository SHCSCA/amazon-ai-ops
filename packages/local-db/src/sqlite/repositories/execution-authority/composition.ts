import { ensureVerifiedReadbackMemory } from './verified-readback-memory';
import type Database from 'better-sqlite3';
import { MissionDomainRepository } from '../mission-domain-repo';
import { ExecutionAuthorityRepositoryOptions } from './contracts';
import type { ExecutionAuthorityRepositoryContext } from './context';
import * as identity from './identity';
import * as batches from './batches';
import * as job_transitions from './job-transitions';
import * as evidence from './evidence';
import * as grant_authority from './grant-authority';
import * as causal_closure from './causal-closure';
import * as policy_dispatch from './policy-dispatch';
import * as recovery from './recovery';
import * as reconciliation from './reconciliation';
import * as core from './core';
export function createExecutionAuthorityRepositoryContext(db: Database.Database, options: ExecutionAuthorityRepositoryOptions = {}): ExecutionAuthorityRepositoryContext {
    const context = { db } as ExecutionAuthorityRepositoryContext;
    context.now = options.now ?? (() => new Date());
    context.missionRepository = new MissionDomainRepository(db, { now: context.now });
    Object.assign(context, {
        ensureVerifiedReadbackMemory: ensureVerifiedReadbackMemory.bind(context),
        registerCanonicalKeywordIdentity: identity.registerCanonicalKeywordIdentity.bind(context),
        resolveCanonicalKeyword: identity.resolveCanonicalKeyword.bind(context),
        listCanonicalKeywordIdentities: identity.listCanonicalKeywordIdentities.bind(context),
        recordCanonicalKeywordAliasResolution: identity.recordCanonicalKeywordAliasResolution.bind(context),
        createExactExecutionBatch: batches.createExactExecutionBatch.bind(context),
        getExecutionBatch: batches.getExecutionBatch.bind(context),
        listExecutionBatches: batches.listExecutionBatches.bind(context),
        listExecutionBatchesForStoreReconciliation: batches.listExecutionBatchesForStoreReconciliation.bind(context),
        startJob: job_transitions.startJob.bind(context),
        recordPreflight: job_transitions.recordPreflight.bind(context),
        recordSubmitIntent: job_transitions.recordSubmitIntent.bind(context),
        recordSubmitted: job_transitions.recordSubmitted.bind(context),
        recordAfterEvidence: job_transitions.recordAfterEvidence.bind(context),
        recordReloadVerified: job_transitions.recordReloadVerified.bind(context),
        markBlocked: job_transitions.markBlocked.bind(context),
        markNotSubmittedAfterIntent: job_transitions.markNotSubmittedAfterIntent.bind(context),
        markUnknown: job_transitions.markUnknown.bind(context),
        terminalizePostIntentUnknownAfterAuthorityLoss: job_transitions.terminalizePostIntentUnknownAfterAuthorityLoss.bind(context),
        cancelJob: job_transitions.cancelJob.bind(context),
        appendPolicyGrantDispatchEvent: policy_dispatch.appendPolicyGrantDispatchEvent.bind(context),
        listPolicyGrantDispatches: policy_dispatch.listPolicyGrantDispatches.bind(context),
        recoverPolicyGrantDispatchesOnStartup: recovery.recoverPolicyGrantDispatchesOnStartup.bind(context),
        recoverInterruptedExecutions: recovery.recoverInterruptedExecutions.bind(context),
        completeDomainReconciliation: causal_closure.completeDomainReconciliation.bind(context),
        markUnknownInternal: job_transitions.markUnknownInternal.bind(context),
        transition: job_transitions.transition.bind(context),
        applyTransition: job_transitions.applyTransition.bind(context),
        recordGrantSlot: evidence.recordGrantSlot.bind(context),
        assertExactReadback: evidence.assertExactReadback.bind(context),
        assertEvidenceMatchesJob: evidence.assertEvidenceMatchesJob.bind(context),
        insertEvidence: evidence.insertEvidence.bind(context),
        requireMutableJob: job_transitions.requireMutableJob.bind(context),
        requireGrant: grant_authority.requireGrant.bind(context),
        assertExecutionGrantAuthority: grant_authority.assertExecutionGrantAuthority.bind(context),
        ensureCausalEvidenceRef: causal_closure.ensureCausalEvidenceRef.bind(context),
        ensureExecutionGrantTerminal: causal_closure.ensureExecutionGrantTerminal.bind(context),
        ensureExecutionGrantCausalEvent: causal_closure.ensureExecutionGrantCausalEvent.bind(context),
        requireProposalDecision: grant_authority.requireProposalDecision.bind(context),
        validateProposalDecision: grant_authority.validateProposalDecision.bind(context),
        requireLatestIdentityForEntity: identity.requireLatestIdentityForEntity.bind(context),
        listPolicyGrantDispatchesInternal: policy_dispatch.listPolicyGrantDispatchesInternal.bind(context),
        appendPolicyGrantDispatchEventInternal: policy_dispatch.appendPolicyGrantDispatchEventInternal.bind(context),
        durableStoreSessionGeneration: core.durableStoreSessionGeneration.bind(context),
        assertStoreContext: core.assertStoreContext.bind(context),
        assertContext: core.assertContext.bind(context),
        requireIdentityVersion: identity.requireIdentityVersion.bind(context),
        requireProjection: batches.requireProjection.bind(context),
        beginUnknownReconciliation: reconciliation.beginUnknownReconciliation.bind(context),
        recordUnknownObservation: reconciliation.recordUnknownObservation.bind(context),
        finishUnknownReconciliation: reconciliation.finishUnknownReconciliation.bind(context),
        reconciliationRow: reconciliation.reconciliationRow.bind(context),
        finishReconciliationInternal: reconciliation.finishReconciliationInternal.bind(context),
        insertEvent: evidence.insertEvent.bind(context),
        nextEventSequence: evidence.nextEventSequence.bind(context),
        refreshBatchStatus: job_transitions.refreshBatchStatus.bind(context),
        immediate: core.immediate.bind(context),
        timestamp: core.timestamp.bind(context),
    });
    return context;
}

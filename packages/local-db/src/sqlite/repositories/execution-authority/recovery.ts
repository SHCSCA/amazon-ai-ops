import  {
  normalizeStoreContextEnvelope,
  type AdExecutionRecoveryItem,
  type AdExecutionStartupRecoveryResult,
  type AdExecutionStatus,
} from '@amazon-ai-ops/shared-types';
import  {
  PolicyGrantDispatchCode,
  PolicyGrantDispatchStartupRecoveryResult,
  ReconciliationRow,
  BatchRow,
  JobRow,
} from './contracts';
import { isPolicyExecutionBatchSafelyRestartable, revisionConflict } from './values';
import type { ExecutionAuthorityRepositoryContext } from './context';
export function recoverPolicyGrantDispatchesOnStartup(this: ExecutionAuthorityRepositoryContext): PolicyGrantDispatchStartupRecoveryResult {
    return this.immediate(() => {
        const recoveredAt = this.timestamp();
        const discoveredPending: string[] = [];
        const interruptedToWaiting: string[] = [];
        const queuedExistingBatch: string[] = [];
        const completedExistingBatch: string[] = [];
        const attentionRequired: string[] = [];
        const candidates = this.db.prepare(`
        SELECT
          grant.id AS grantId,
          grant.mission_id AS missionId,
          grant.mission_revision AS missionRevision,
          grant.policy_version_id AS policyVersionId,
          grant.policy_revision AS policyRevision,
          grant.expires_at AS expiresAt,
          grant.created_session_generation AS grantSessionGeneration,
          mission.business_date AS businessDate,
          mission.status AS missionStatus,
          mission.revision AS currentMissionRevision,
          mission.policy_version_id AS currentMissionPolicyVersionId,
          policy.status AS policyStatus,
          policy.revision AS currentPolicyRevision,
          store.store_id AS storeId,
          store.browser_profile_id AS browserProfileId,
          store.marketplace,
          store.currency,
          store.business_timezone AS businessTimezone,
          store.status AS storeStatus
        FROM mission_grants grant
        JOIN missions mission
          ON mission.store_id = grant.store_id AND mission.id = grant.mission_id
        JOIN stores store ON store.store_id = grant.store_id
        LEFT JOIN policy_versions policy
          ON policy.store_id = grant.store_id AND policy.id = grant.policy_version_id
        WHERE grant.issuer_type = 'policy'
          AND EXISTS (
            SELECT 1 FROM mission_grant_events issued
            WHERE issued.store_id = grant.store_id
              AND issued.grant_id = grant.id
              AND issued.event_type = 'issued'
          )
        ORDER BY grant.store_id, grant.issued_at, grant.id
      `).all() as Array<{
            grantId: string;
            missionId: string;
            missionRevision: number;
            policyVersionId: string;
            policyRevision: number;
            expiresAt: string;
            grantSessionGeneration: number;
            businessDate: string;
            missionStatus: string;
            currentMissionRevision: number;
            currentMissionPolicyVersionId: string;
            policyStatus: string | null;
            currentPolicyRevision: number | null;
            storeId: string;
            browserProfileId: string;
            marketplace: string;
            currency: string;
            businessTimezone: string;
            storeStatus: string;
        }>;
        for (const candidate of candidates) {
            if (candidate.storeStatus !== 'active'
                || candidate.marketplace !== 'US'
                || candidate.currency !== 'USD') {
                continue;
            }
            const durableGeneration = this.durableStoreSessionGeneration(candidate.storeId);
            if (!Number.isSafeInteger(durableGeneration) || durableGeneration < 0)
                continue;
            const context = normalizeStoreContextEnvelope({
                storeId: candidate.storeId,
                browserProfileId: candidate.browserProfileId,
                marketplace: 'US',
                currency: 'USD',
                businessTimezone: candidate.businessTimezone,
                businessDate: candidate.businessDate,
                sessionGeneration: durableGeneration,
            });
            const dispatches = this.listPolicyGrantDispatchesInternal(context);
            const current = dispatches.find((item) => item.grantId === candidate.grantId);
            if (!current)
                continue;
            if (current.status === 'completed' || current.status === 'attention_required')
                continue;
            const authorityFailure: {
                code: Extract<PolicyGrantDispatchCode, 'GRANT_TERMINAL' | 'SESSION_REAUTHORIZATION_REQUIRED' | 'GRANT_EXPIRED' | 'MISSION_REVISION_CHANGED' | 'POLICY_AUTHORITY_CHANGED'>;
                detail: string;
            } | undefined = current.terminalGrantEventType
                ? {
                    code: 'GRANT_TERMINAL',
                    detail: 'The grant reached a terminal state before safe execution.',
                }
                : candidate.grantSessionGeneration !== durableGeneration
                    ? {
                        code: 'SESSION_REAUTHORIZATION_REQUIRED',
                        detail: 'The policy grant belongs to an earlier store session.',
                    }
                    : Date.parse(candidate.expiresAt) <= this.now().getTime()
                        ? {
                            code: 'GRANT_EXPIRED',
                            detail: 'The policy grant expired before safe execution.',
                        }
                        : candidate.missionStatus !== 'active'
                            || candidate.currentMissionRevision !== candidate.missionRevision
                            || candidate.currentMissionPolicyVersionId !== candidate.policyVersionId
                            ? {
                                code: 'MISSION_REVISION_CHANGED',
                                detail: 'The Mission authority changed before safe execution.',
                            }
                            : candidate.policyStatus !== 'enabled'
                                || candidate.currentPolicyRevision !== candidate.policyRevision
                                ? {
                                    code: 'POLICY_AUTHORITY_CHANGED',
                                    detail: 'The enabled policy authority changed before safe execution.',
                                }
                                : undefined;
            if (current.batchId || current.batchJobCount > 0) {
                const existingBatch = current.batchId
                    ? this.requireProjection(context.storeId, current.batchId)
                    : undefined;
                const safelyRestartable = Boolean(existingBatch && isPolicyExecutionBatchSafelyRestartable(existingBatch));
                if (!safelyRestartable) {
                    this.appendPolicyGrantDispatchEventInternal(context, {
                        grantId: candidate.grantId,
                        status: 'completed',
                        trigger: 'startup_recovery',
                        attempt: current.attemptCount,
                        code: 'EXECUTION_STATE_REQUIRES_RECONCILIATION',
                        detail: 'Existing execution state is not safe for automatic restart.',
                        ...(current.batchId ? { batchId: current.batchId } : {}),
                    }, recoveredAt);
                    completedExistingBatch.push(candidate.grantId);
                    continue;
                }
                if (authorityFailure) {
                    this.appendPolicyGrantDispatchEventInternal(context, {
                        grantId: candidate.grantId,
                        status: 'attention_required',
                        trigger: 'startup_recovery',
                        attempt: current.attemptCount,
                        code: authorityFailure.code,
                        detail: authorityFailure.detail,
                        batchId: current.batchId,
                    }, recoveredAt);
                    attentionRequired.push(candidate.grantId);
                    continue;
                }
                if (current.status !== 'queued_for_execution') {
                    this.appendPolicyGrantDispatchEventInternal(context, {
                        grantId: candidate.grantId,
                        status: 'queued_for_execution',
                        trigger: 'startup_recovery',
                        attempt: current.attemptCount,
                        code: 'BATCH_QUEUED_FOR_EXECUTION',
                        detail: 'Startup recovered a pre-intent batch for the store execution lane.',
                        batchId: current.batchId,
                    }, recoveredAt);
                    queuedExistingBatch.push(candidate.grantId);
                }
                continue;
            }
            if (authorityFailure) {
                this.appendPolicyGrantDispatchEventInternal(context, {
                    grantId: candidate.grantId,
                    status: 'attention_required',
                    trigger: 'startup_recovery',
                    attempt: current.attemptCount,
                    code: authorityFailure.code,
                    detail: authorityFailure.detail,
                }, recoveredAt);
                attentionRequired.push(candidate.grantId);
                continue;
            }
            if (!current.eventId) {
                this.appendPolicyGrantDispatchEventInternal(context, {
                    grantId: candidate.grantId,
                    status: 'pending',
                    trigger: 'startup_recovery',
                    attempt: 0,
                    code: 'DISPATCH_PENDING',
                    detail: 'Startup recovered a policy grant issued before its dispatch callback was journaled.',
                }, recoveredAt);
                discoveredPending.push(candidate.grantId);
                continue;
            }
            if (current.status === 'attempting') {
                this.appendPolicyGrantDispatchEventInternal(context, {
                    grantId: candidate.grantId,
                    status: 'waiting_runtime',
                    trigger: 'startup_recovery',
                    attempt: current.attemptCount,
                    code: 'STARTUP_ATTEMPT_INTERRUPTED',
                    detail: 'Startup recovered an interrupted pre-batch dispatch attempt; no external write was submitted.',
                }, recoveredAt);
                interruptedToWaiting.push(candidate.grantId);
                continue;
            }
            if (current.status === 'queued_for_execution') {
                this.appendPolicyGrantDispatchEventInternal(context, {
                    grantId: candidate.grantId,
                    status: 'attention_required',
                    trigger: 'startup_recovery',
                    attempt: current.attemptCount,
                    code: 'UNSAFE_DISPATCH_FAILURE',
                    detail: 'The dispatch journal references a missing execution batch.',
                }, recoveredAt);
                attentionRequired.push(candidate.grantId);
            }
        }
        return {
            recoveredAt,
            discoveredPending,
            interruptedToWaiting,
            queuedExistingBatch,
            completedExistingBatch,
            attentionRequired,
        };
    });
}
export function recoverInterruptedExecutions(this: ExecutionAuthorityRepositoryContext): AdExecutionStartupRecoveryResult {
    return this.immediate(() => {
        const recoveredAt = this.timestamp();
        const interruptedCases = this.db.prepare('SELECT * FROM ad_execution_reconciliation_cases WHERE outcome IS NULL').all() as ReconciliationRow[];
        for (const row of interruptedCases)
            this.finishReconciliationInternal(row, 'inconclusive_permanent');
        const interrupted = this.db.prepare(`
        SELECT * FROM ad_execution_jobs
        WHERE status IN ('intent_written', 'submitted', 'verifying')
        ORDER BY store_id, batch_id, ordinal
      `).all() as JobRow[];
        const markedUnknown: AdExecutionRecoveryItem[] = [];
        const affectedBatchKeys = new Set<string>();
        for (const job of interrupted) {
            const previousStatus = job.status as AdExecutionRecoveryItem['previousStatus'];
            const changed = this.db.prepare(`
          UPDATE ad_execution_jobs SET status = 'unknown', revision = revision + 1,
            updated_at = ?, terminal_at = ?
          WHERE store_id = ? AND id = ? AND revision = ?
            AND status IN ('intent_written', 'submitted', 'verifying')
        `).run(recoveredAt, recoveredAt, job.store_id, job.id, job.revision);
            if (changed.changes !== 1)
                throw revisionConflict('Interrupted execution recovery lost its CAS race.');
            this.recordGrantSlot(job, 'spent', recoveredAt);
            const sequence = this.nextEventSequence(job.store_id, job.id);
            this.insertEvent({
                storeId: job.store_id,
                batchId: job.batch_id,
                jobId: job.id,
                sequence,
                eventType: 'unknown',
                fromStatus: previousStatus,
                toStatus: 'unknown',
                actorId: 'startup-recovery',
                reasonCode: 'interrupted_after_intent',
                detail: 'Process restarted after submit intent; outcome requires human reconciliation.',
                sessionGeneration: job.created_session_generation,
                createdAt: recoveredAt,
            });
            affectedBatchKeys.add(`${job.store_id}\u0000${job.batch_id}`);
            markedUnknown.push({
                storeId: job.store_id as AdExecutionRecoveryItem['storeId'],
                batchId: job.batch_id,
                jobId: job.id,
                missionId: job.mission_id,
                grantId: job.grant_id,
                previousStatus,
                status: 'unknown',
            });
        }
        const partialTerminalBatches = this.db.prepare(`
        SELECT DISTINCT terminal.store_id AS storeId, terminal.batch_id AS batchId
        FROM ad_execution_jobs terminal
        WHERE terminal.status IN ('blocked', 'unknown', 'cancelled')
          AND EXISTS (
            SELECT 1 FROM ad_execution_jobs sibling
            WHERE sibling.store_id = terminal.store_id
              AND sibling.batch_id = terminal.batch_id
              AND sibling.status IN ('queued', 'preflight')
          )
      `).all() as Array<{
            storeId: string;
            batchId: string;
        }>;
        partialTerminalBatches.forEach((item) => {
            affectedBatchKeys.add(`${item.storeId}\u0000${item.batchId}`);
        });
        for (const key of affectedBatchKeys) {
            const [storeId, batchId] = key.split('\u0000');
            if (!storeId || !batchId)
                continue;
            const siblings = this.db.prepare(`
          SELECT * FROM ad_execution_jobs
          WHERE store_id = ? AND batch_id = ? AND status IN ('queued', 'preflight')
          ORDER BY ordinal
        `).all(storeId, batchId) as JobRow[];
            for (const sibling of siblings) {
                const changed = this.db.prepare(`
            UPDATE ad_execution_jobs SET status = 'cancelled', revision = revision + 1,
              updated_at = ?, terminal_at = COALESCE(terminal_at, ?)
            WHERE store_id = ? AND id = ? AND revision = ?
              AND status IN ('queued', 'preflight')
          `).run(recoveredAt, recoveredAt, storeId, sibling.id, sibling.revision);
                if (changed.changes !== 1) {
                    throw revisionConflict('Startup recovery lost a sibling cancellation CAS race.');
                }
                this.insertEvent({
                    storeId,
                    batchId,
                    jobId: sibling.id,
                    sequence: this.nextEventSequence(storeId, sibling.id),
                    eventType: 'cancelled',
                    fromStatus: sibling.status,
                    toStatus: 'cancelled',
                    actorId: 'startup-recovery',
                    reasonCode: 'batch_recovered_terminal',
                    detail: 'A terminal sibling locked this action before submit intent.',
                    sessionGeneration: sibling.created_session_generation,
                    createdAt: recoveredAt,
                });
            }
            this.refreshBatchStatus(storeId, batchId, recoveredAt);
        }
        const terminalBatches = this.db.prepare(`
        SELECT * FROM ad_execution_batches
        WHERE status IN ('succeeded', 'blocked', 'unknown', 'cancelled')
        ORDER BY store_id, created_at, id
      `).all() as BatchRow[];
        const revokedGrantIds: string[] = [];
        for (const batch of terminalBatches) {
            const inserted = this.ensureExecutionGrantTerminal(batch.store_id, batch.grant_id, batch.id, batch.status as Extract<AdExecutionStatus, 'succeeded' | 'blocked' | 'unknown' | 'cancelled'>, recoveredAt);
            if (inserted && batch.status !== 'succeeded')
                revokedGrantIds.push(batch.grant_id);
        }
        const incompleteTerminalBatches = terminalBatches.filter((batch) => !this.db.prepare(`
        SELECT 1 FROM ad_execution_domain_reconciliations
        WHERE store_id = ? AND batch_id = ?
      `).get(batch.store_id, batch.id));
        const domainReconciliations = incompleteTerminalBatches.map((batch) => ({
            storeId: batch.store_id as AdExecutionRecoveryItem['storeId'],
            batchId: batch.id,
            missionId: batch.mission_id,
            grantId: batch.grant_id,
            status: batch.status as Extract<AdExecutionStatus, 'succeeded' | 'blocked' | 'unknown' | 'cancelled'>,
        }));
        const untouchedBeforeIntent = Number((this.db.prepare(`
        SELECT COUNT(*) AS count FROM ad_execution_jobs WHERE status IN ('queued', 'preflight')
      `).get() as {
            count: number;
        }).count);
        return {
            recoveredAt,
            markedUnknown,
            revokedGrantIds,
            missionsRequiringStop: [...new Set(domainReconciliations
                    .filter((item) => item.status !== 'succeeded')
                    .map((item) => item.missionId))],
            domainReconciliations,
            untouchedBeforeIntent,
        };
    });
}

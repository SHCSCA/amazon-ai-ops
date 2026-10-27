import {
  randomUUID,
} from 'node:crypto';
import {
  type StoreId,
  type StoreRecord,
} from '@amazon-ai-ops/shared-types';
import {
  STORE_COLLECTION_MAX_DAILY_SEMANTIC_ATTEMPTS_PER_STORE_PROFILE,
  HISTORY_SCHEMA_VERSION,
  MAX_HISTORY_ENVELOPE_BYTES,
  MAX_HISTORY_PLAINTEXT_BYTES,
} from "./collection-orchestrator-constants";
import {
  type StoreCollectionAuthorityReadback,
  type StoreCollectionOrchestratorTransitionPurpose,
  type StoreCollectionOrchestratorTransition,
  StoreCollectionOrchestratorError,
  type StoreCollectionOrchestratorOutcome,
  type StoreCollectionOrchestratorHistory,
} from "./collection-orchestrator-contracts";
import {
  withTransitionIntegrity,
  withOutcomeIntegrity,
} from "./collection-orchestrator-integrity";
import {
  semanticAttemptFromTransition,
  latestSemanticAttemptBusinessDate,
  isSchedulerNotCreatedSemanticAttempt,
  compactSemanticAttemptsToLatestBusinessDate,
  isUnreconciledSchedulerPending,
  hasDurableSchedulerSuccess,
} from "./collection-orchestrator-semantic-values";
import {
  normalizeStoredHistory,
  assertHistory,
} from "./collection-orchestrator-history-validation";
import {
  cloneAuthorityReadback,
  collectionAttemptSemanticKey,
} from "./collection-orchestrator-authority-values";
import {
  isStoreCollectionTransitionPhaseAllowed,
  corruptHistory,
  isTerminalPhase,
  codepointCompare,
} from "./collection-orchestrator-failure-values";

import type { StoreCollectionOrchestratorRuntime } from './collection-orchestrator-runtime';

export function newTransition(this: StoreCollectionOrchestratorRuntime,
  input: {
    cycleId: string;
    owner: string;
    fromStoreId: StoreId | null;
    store: StoreRecord | null;
    fromAuthority: StoreCollectionAuthorityReadback;
    originAuthority: StoreCollectionAuthorityReadback;
    startedAt: string;
    purpose: StoreCollectionOrchestratorTransitionPurpose;
    expectedFingerprint?: string;
  }): StoreCollectionOrchestratorTransition {
    return withTransitionIntegrity({
      transitionId: randomUUID(),
      capabilityId: randomUUID(),
      cycleId: input.cycleId,
      owner: input.owner,
      fromStoreId: input.fromStoreId,
      toStoreId: input.store?.storeId ?? null,
      browserProfileId: input.store?.browserProfileId ?? null,
      purpose: input.purpose,
      fromAuthority: cloneAuthorityReadback(input.fromAuthority),
      originAuthority: cloneAuthorityReadback(input.originAuthority),
      ...(input.expectedFingerprint ? { expectedFingerprint: input.expectedFingerprint } : {}),
      phase: 'claimed',
      startedAt: input.startedAt,
    });
  }

export function appendTransition(this: StoreCollectionOrchestratorRuntime,
  transition: StoreCollectionOrchestratorTransition): void {
    this.mutateHistory((history) => ({ ...history, transitions: [...history.transitions, transition] }));
  }

export function updateTransition(this: StoreCollectionOrchestratorRuntime,
  transition: StoreCollectionOrchestratorTransition,
  patch: Omit<Partial<StoreCollectionOrchestratorTransition>, 'integrityDigest' | 'transitionId' | 'cycleId'
      | 'capabilityId' | 'owner' | 'fromStoreId' | 'toStoreId' | 'browserProfileId' | 'purpose'
      | 'fromAuthority' | 'originAuthority'
      | 'expectedFingerprint' | 'startedAt'>): StoreCollectionOrchestratorTransition {
    const next = withTransitionIntegrity({ ...transition, ...patch, integrityDigest: undefined });
    if (!isStoreCollectionTransitionPhaseAllowed(transition.purpose, transition.phase, next.phase)) {
      throw new StoreCollectionOrchestratorError(
        'CORRUPT_PERSISTENCE',
        `非法切换阶段：${transition.phase} -> ${next.phase}`,
      );
    }
    this.mutateHistory((history) => {
      const index = history.transitions.findIndex((item) => item.transitionId === transition.transitionId);
      if (index < 0 || history.transitions[index].integrityDigest !== transition.integrityDigest) {
        throw new StoreCollectionOrchestratorError('CORRUPT_PERSISTENCE', '切换记录已被替换。');
      }
      const transitions = [...history.transitions];
      transitions[index] = next;
      if (next.purpose !== 'collection' || next.phase !== 'scheduler_request_bound') {
        return { ...history, transitions };
      }
      const semanticAttempt = semanticAttemptFromTransition(next);
      const semanticKey = collectionAttemptSemanticKey(semanticAttempt);
      const latestProtectedBusinessDate = latestSemanticAttemptBusinessDate(
        history.semanticAttempts,
        semanticAttempt.storeId,
        semanticAttempt.browserProfileId,
      );
      if (latestProtectedBusinessDate !== undefined
        && semanticAttempt.businessDate < latestProtectedBusinessDate) {
        throw new StoreCollectionOrchestratorError(
          'SAFETY_STATE_UNKNOWN',
          '采集业务日早于 protected semantic attempt watermark。',
        );
      }
      const protectedAttemptsForBusinessDate = history.semanticAttempts.filter((attempt) => (
        attempt.storeId === semanticAttempt.storeId
        && attempt.browserProfileId === semanticAttempt.browserProfileId
        && attempt.businessDate === semanticAttempt.businessDate
      )).length;
      if (protectedAttemptsForBusinessDate
        >= STORE_COLLECTION_MAX_DAILY_SEMANTIC_ATTEMPTS_PER_STORE_PROFILE) {
        throw new StoreCollectionOrchestratorError(
          'SAFETY_STATE_UNKNOWN',
          '单店铺单业务日 protected semantic attempts 已达到安全上限。',
        );
      }
      if (history.semanticAttempts.some((attempt) => (
        (collectionAttemptSemanticKey(attempt) === semanticKey
          && !isSchedulerNotCreatedSemanticAttempt(history, attempt))
        || attempt.transitionId === semanticAttempt.transitionId
        || attempt.semanticAttemptId === semanticAttempt.semanticAttemptId
        || attempt.schedulerAttemptId === semanticAttempt.schedulerAttemptId
        || attempt.schedulerRequestId === semanticAttempt.schedulerRequestId
      ))) {
        throw corruptHistory();
      }
      return {
        ...history,
        transitions,
        semanticAttempts: compactSemanticAttemptsToLatestBusinessDate([
          ...history.semanticAttempts,
          semanticAttempt,
        ]),
      };
    });
    return next;
  }

export function completeCollectionTransition(this: StoreCollectionOrchestratorRuntime,
  transition: StoreCollectionOrchestratorTransition,
  patch: Pick<StoreCollectionOrchestratorTransition, 'phase' | 'completedAt'>
      & Partial<Pick<StoreCollectionOrchestratorTransition, 'failureCode'>>,
  outcomeValue: Omit<StoreCollectionOrchestratorOutcome, 'integrityDigest'>): { transition: StoreCollectionOrchestratorTransition; outcome: StoreCollectionOrchestratorOutcome } {
    const next = withTransitionIntegrity({ ...transition, ...patch, integrityDigest: undefined });
    if (!isStoreCollectionTransitionPhaseAllowed(transition.purpose, transition.phase, next.phase)) {
      throw new StoreCollectionOrchestratorError(
        'CORRUPT_PERSISTENCE',
        `非法采集终态：${transition.phase} -> ${next.phase}`,
      );
    }
    const outcome = withOutcomeIntegrity(outcomeValue);
    this.mutateHistory((history) => {
      const index = history.transitions.findIndex((item) => item.transitionId === transition.transitionId);
      if (index < 0 || history.transitions[index].integrityDigest !== transition.integrityDigest
        || history.outcomes.some((item) => item.transitionId === transition.transitionId)) {
        throw new StoreCollectionOrchestratorError('CORRUPT_PERSISTENCE', '采集终态已被替换或重复。');
      }
      const transitions = [...history.transitions];
      transitions[index] = next;
      return { ...history, transitions, outcomes: [...history.outcomes, outcome] };
    });
    return { transition: next, outcome };
  }

export function readPendingTransitions(this: StoreCollectionOrchestratorRuntime): StoreCollectionOrchestratorTransition[] {
    return this.readProtectedHistorySnapshot().transitions
      .filter((transition) => !isTerminalPhase(transition.phase));
  }

export function readProtectedHistorySnapshot(this: StoreCollectionOrchestratorRuntime): StoreCollectionOrchestratorHistory {
    const raw = this.dependencies.history.get();
    return raw
      ? this.readHistoryFromEnvelope(raw)
      : {
        schemaVersion: HISTORY_SCHEMA_VERSION,
        transitions: [],
        outcomes: [],
        semanticAttempts: [],
      };
  }

export function attemptedCollectionSemanticKeys(this: StoreCollectionOrchestratorRuntime,
  history: StoreCollectionOrchestratorHistory): ReadonlySet<string> {
    const attempted = new Set<string>();
    for (const semanticAttempt of history.semanticAttempts) {
      if (isSchedulerNotCreatedSemanticAttempt(history, semanticAttempt)) continue;
      const key = collectionAttemptSemanticKey(semanticAttempt);
      if (attempted.has(key)) throw corruptHistory();
      attempted.add(key);
    }
    return attempted;
  }

export function interruptTransitions(this: StoreCollectionOrchestratorRuntime,
  pending: readonly StoreCollectionOrchestratorTransition[]): void {
    if (pending.length === 0) return;
    if (pending.some((transition) => (
      isUnreconciledSchedulerPending(transition)
      || !isStoreCollectionTransitionPhaseAllowed(
        transition.purpose,
        transition.phase,
        'interrupted',
      )
    ))) {
      throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
        'SAFETY_STATE_UNKNOWN',
        '未 reconcile 的 durable scheduler request 或非法阶段不得被 interrupt 终态化。',
      ));
    }
    const pendingById = new Map(pending.map((transition) => [transition.transitionId, transition]));
    try {
      this.dependencies.history.transaction(() => {
        const raw = this.dependencies.history.get();
        if (!raw) throw new StoreCollectionOrchestratorError('CORRUPT_PERSISTENCE', '待恢复历史消失。');
        const history = this.readHistoryFromEnvelope(raw);
        const now = this.now().toISOString();
        const outcomes = [...history.outcomes];
        const transitions = history.transitions.map((transition) => {
          const expected = pendingById.get(transition.transitionId);
          if (!expected) return transition;
          if (transition.integrityDigest !== expected.integrityDigest || isTerminalPhase(transition.phase)) {
            throw new StoreCollectionOrchestratorError('CORRUPT_PERSISTENCE', '待恢复历史已被替换。');
          }
          const interrupted = withTransitionIntegrity({
            ...transition,
            integrityDigest: undefined,
            phase: 'interrupted',
            completedAt: now,
            failureCode: 'APP_EXIT_INTERRUPTED',
          });
          if (interrupted.purpose === 'collection') {
            const schedulerSucceeded = hasDurableSchedulerSuccess(transition);
            outcomes.push(withOutcomeIntegrity({
              outcomeId: randomUUID(),
              cycleId: interrupted.cycleId,
              transitionId: interrupted.transitionId,
              owner: interrupted.owner,
              storeId: interrupted.toStoreId!,
              browserProfileId: interrupted.browserProfileId!,
              ...(interrupted.businessDate === undefined ? {} : {
                businessDate: interrupted.businessDate,
              }),
              ...(interrupted.sessionGeneration === undefined ? {} : {
                sessionGeneration: interrupted.sessionGeneration,
              }),
              fingerprint: interrupted.expectedFingerprint!,
              ...(schedulerSucceeded ? {
                attemptId: interrupted.schedulerAttemptId,
                requestId: interrupted.schedulerRequestId,
              } : {}),
              schedulerSucceeded,
              cleanupStatus: 'confirmed',
              state: 'failed',
              startedAt: interrupted.startedAt,
              completedAt: now,
              failureCode: 'APP_EXIT_INTERRUPTED',
            }));
          }
          return interrupted;
        });
        if (pendingById.size !== pending.filter((item) => (
          transitions.some((transition) => transition.transitionId === item.transitionId)
        )).length) {
          throw new StoreCollectionOrchestratorError('CORRUPT_PERSISTENCE', '待恢复历史不完整。');
        }
        this.writeHistory(this.compactHistory({ ...history, transitions, outcomes }));
      });
    } catch (error) {
      throw this.markSafetyUnknown(error);
    }
  }

export function mutateHistory(this: StoreCollectionOrchestratorRuntime,
  mutate: (history: StoreCollectionOrchestratorHistory) => StoreCollectionOrchestratorHistory): void {
    try {
      this.dependencies.history.transaction(() => {
        const raw = this.dependencies.history.get();
        const history = raw
          ? this.readHistoryFromEnvelope(raw)
          : {
            schemaVersion: HISTORY_SCHEMA_VERSION,
            transitions: [],
            outcomes: [],
            semanticAttempts: [],
          } as StoreCollectionOrchestratorHistory;
        this.writeHistory(this.compactHistory(mutate(history)));
      });
    } catch (error) {
      if (error instanceof StoreCollectionOrchestratorError) throw error;
      throw new StoreCollectionOrchestratorError(
        'PERSISTENCE_PROTECTION_UNAVAILABLE',
        '切换历史事务或写入失败。',
      );
    }
  }

export function readHistoryFromEnvelope(this: StoreCollectionOrchestratorRuntime,
  raw: string): StoreCollectionOrchestratorHistory {
    if (Buffer.byteLength(raw, 'utf8') > MAX_HISTORY_ENVELOPE_BYTES) {
      throw new StoreCollectionOrchestratorError('CORRUPT_PERSISTENCE', '切换历史 envelope 超过大小上限。');
    }
    this.assertPersistenceProtectionAvailable();
    try {
      const plaintext = this.dependencies.recordCodec.open(raw);
      if (Buffer.byteLength(plaintext, 'utf8') > MAX_HISTORY_PLAINTEXT_BYTES) {
        throw new Error('history plaintext too large');
      }
      return normalizeStoredHistory(JSON.parse(plaintext));
    } catch (error) {
      if (error instanceof StoreCollectionOrchestratorError) throw error;
      throw new StoreCollectionOrchestratorError('CORRUPT_PERSISTENCE', '切换历史损坏。');
    }
  }

export function writeHistory(this: StoreCollectionOrchestratorRuntime,
  history: StoreCollectionOrchestratorHistory): void {
    assertHistory(history);
    this.assertPersistenceProtectionAvailable();
    const plaintext = JSON.stringify(history);
    if (Buffer.byteLength(plaintext, 'utf8') > MAX_HISTORY_PLAINTEXT_BYTES) {
      throw new StoreCollectionOrchestratorError('CORRUPT_PERSISTENCE', '切换历史超过大小上限。');
    }
    let envelope = '';
    try {
      envelope = this.dependencies.recordCodec.seal(plaintext);
    } catch {
      envelope = '';
    }
    if (!envelope || envelope === plaintext
      || Buffer.byteLength(envelope, 'utf8') > MAX_HISTORY_ENVELOPE_BYTES) {
      throw new StoreCollectionOrchestratorError(
        'PERSISTENCE_PROTECTION_UNAVAILABLE',
        '切换历史安全存储不可用。',
      );
    }
    this.dependencies.history.set(envelope);
  }

export function compactHistory(this: StoreCollectionOrchestratorRuntime,
  history: StoreCollectionOrchestratorHistory): StoreCollectionOrchestratorHistory {
    const terminal = history.transitions
      .map((transition, index) => ({ transition, index }))
      .filter(({ transition }) => isTerminalPhase(transition.phase))
      .sort((left, right) => {
        const byTime = codepointCompare(
          right.transition.completedAt ?? right.transition.startedAt,
          left.transition.completedAt ?? left.transition.startedAt,
        );
        return byTime || right.index - left.index;
      });
    const retained = terminal
      .filter(({ transition }) => transition.purpose === 'collection')
      .slice(0, this.historyRetentionLimit);
    if (retained.length < this.historyRetentionLimit) {
      retained.push(...terminal
        .filter(({ transition }) => transition.purpose === 'restore')
        .slice(0, this.historyRetentionLimit - retained.length));
    }
    const retainedTerminalIds = new Set(retained.map(({ transition }) => transition.transitionId));
    const transitions = history.transitions.filter((transition) => (
      !isTerminalPhase(transition.phase) || retainedTerminalIds.has(transition.transitionId)
    ));
    const retainedIds = new Set(transitions.map((transition) => transition.transitionId));
    return {
      ...history,
      transitions,
      outcomes: history.outcomes.filter((outcome) => retainedIds.has(outcome.transitionId)),
    };
  }

export function assertPersistenceProtectionAvailable(this: StoreCollectionOrchestratorRuntime): void {
    let available = false;
    try {
      available = this.dependencies.recordCodec.isAvailable();
    } catch {
      available = false;
    }
    if (!available) {
      throw new StoreCollectionOrchestratorError(
        'PERSISTENCE_PROTECTION_UNAVAILABLE',
        '切换历史安全存储不可用。',
      );
    }
  }

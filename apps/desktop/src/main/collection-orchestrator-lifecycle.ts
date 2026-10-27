import {
  normalizeBrowserProfileId,
  normalizeStoreId,
  normalizeStoreContextEnvelope,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import {
  StoreCollectionOrchestratorError,
  type StoreCollectionProtectedSemanticAttemptQuery,
  type StoreCollectionProtectedSemanticAttemptReadback,
  type StoreCollectionOrchestratorCycleResult,
  type StoreCollectionOrchestratorCycleRequest,
  StopRequestedSignal,
} from "./collection-orchestrator-contracts";
import {
  isSchedulerNotCreatedSemanticAttempt,
} from "./collection-orchestrator-semantic-values";
import {
  manualCollectionCycleKey,
} from "./collection-orchestrator-authority-values";
import {
  validFingerprint,
  corruptHistory,
  isTerminalPhase,
} from "./collection-orchestrator-failure-values";

import type { StoreCollectionOrchestratorRuntime } from './collection-orchestrator-runtime';

export function start(this: StoreCollectionOrchestratorRuntime): void {
    if (this.safetyStateUnknown) throw this.safetyError();
    if (this.timer) return;
    this.assertCanStart();
    this.stopRequested = false;
    this.timer = this.createInterval(() => {
      void this.runCycle().catch((error) => this.reportError(error));
    }, this.pollIntervalMs);
    (this.timer as ReturnType<typeof setInterval> & { unref?: () => void }).unref?.();
    void this.runCycle().catch((error) => this.reportError(error));
  }

export function stop(this: StoreCollectionOrchestratorRuntime): void {
    this.stopRequested = true;
    if (this.timer) {
      this.cancelInterval(this.timer);
      this.timer = null;
    }
  }

export async function stopAndDrain(this: StoreCollectionOrchestratorRuntime,
  timeoutMs = 5_000): Promise<void> {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
      throw new RangeError('store collection orchestrator drain timeout must be non-negative');
    }
    this.drainRequested = true;
    this.stop();
    const active = this.cycle;
    if (!active) {
      if (this.safetyStateUnknown) throw this.safetyError();
      return;
    }
    if (timeoutMs === 0) {
      throw new StoreCollectionOrchestratorError('DRAIN_TIMEOUT', '编排器尚未证明清理、回店和租约释放完成。');
    }
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const settled = await Promise.race([
        active.then(() => true),
        new Promise<boolean>((resolve) => {
          timeout = setTimeout(() => resolve(false), timeoutMs);
        }),
      ]);
      if (!settled) {
        throw new StoreCollectionOrchestratorError('DRAIN_TIMEOUT', '编排器尚未证明清理、回店和租约释放完成。');
      }
      if (this.safetyStateUnknown) throw this.safetyError();
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

export function isTransitionLocked(this: StoreCollectionOrchestratorRuntime): boolean {
    return this.transitionLocked || this.safetyStateUnknown;
  }

export function assertUserOperationAllowed(this: StoreCollectionOrchestratorRuntime): void {
    if (this.isTransitionLocked()) {
      throw new StoreCollectionOrchestratorError(
        this.safetyStateUnknown ? 'SAFETY_STATE_UNKNOWN' : 'USER_OPERATION_BLOCKED',
        '可见采集运行时正在切换或安全状态未知，Main 已拒绝当前用户操作。',
      );
    }
  }

export function readProtectedSemanticAttempt(this: StoreCollectionOrchestratorRuntime,
  input: StoreCollectionProtectedSemanticAttemptQuery): Readonly<StoreCollectionProtectedSemanticAttemptReadback> | null {
    if (this.safetyStateUnknown) throw this.safetyError();
    try {
      const storeIdValue = input?.storeId;
      const browserProfileIdValue = input?.browserProfileId;
      const expectedFingerprintValue = input?.expectedFingerprint;
      const storeId = normalizeStoreId(storeIdValue);
      const browserProfileId = normalizeBrowserProfileId(browserProfileIdValue);
      if (storeIdValue !== storeId
        || browserProfileIdValue !== browserProfileId
        || !validFingerprint(expectedFingerprintValue)) {
        throw corruptHistory();
      }
      const history = this.readProtectedHistorySnapshot();
      const matches = history.semanticAttempts.filter((attempt) => (
        attempt.storeId === storeId
        && attempt.browserProfileId === browserProfileId
        && attempt.expectedFingerprint === expectedFingerprintValue
        && !isSchedulerNotCreatedSemanticAttempt(history, attempt)
      ));
      if (matches.length === 0) return null;
      if (matches.length !== 1) throw corruptHistory();
      const semanticAttempt = matches[0];
      const outcomes = history.outcomes.filter((outcome) => (
        outcome.transitionId === semanticAttempt.transitionId
      ));
      if (outcomes.length > 1) throw corruptHistory();
      const terminalOutcome = outcomes[0] ?? null;
      if (terminalOutcome) {
        const transition = history.transitions.find((candidate) => (
          candidate.transitionId === semanticAttempt.transitionId
        ));
        if (!transition || !isTerminalPhase(transition.phase)) throw corruptHistory();
      }
      return Object.freeze({
        semanticAttempt: Object.freeze({ ...semanticAttempt }),
        terminalOutcome: terminalOutcome
          ? Object.freeze({ ...terminalOutcome })
          : null,
      });
    } catch (error) {
      throw this.markSafetyUnknown(error);
    }
  }

export function runCycle(this: StoreCollectionOrchestratorRuntime): Promise<StoreCollectionOrchestratorCycleResult> {
    return this.startCycle({ mode: 'normal' });
  }

export function recoverExistingTransitionsOnly(this: StoreCollectionOrchestratorRuntime): Promise<StoreCollectionOrchestratorCycleResult> {
    return this.startCycle({ mode: 'recover_existing_only' });
  }

export function runStoreNow(this: StoreCollectionOrchestratorRuntime,
  value: StoreContextEnvelope): Promise<StoreCollectionOrchestratorCycleResult> {
    let context: StoreContextEnvelope;
    try {
      context = Object.freeze(normalizeStoreContextEnvelope(value));
    } catch (error) {
      const rejected = new StoreCollectionOrchestratorError(
        'USER_OPERATION_BLOCKED',
        '手动采集上下文无效；Main 已拒绝执行。',
      );
      (rejected as StoreCollectionOrchestratorError & { cause?: unknown }).cause = error;
      return Promise.reject(rejected);
    }
    return this.startCycle({
      mode: 'manual',
      context,
      manualKey: manualCollectionCycleKey(context),
    });
  }

export function startCycle(this: StoreCollectionOrchestratorRuntime,
  request: StoreCollectionOrchestratorCycleRequest): Promise<StoreCollectionOrchestratorCycleResult> {
    try {
      this.assertCanStart();
    } catch (error) {
      return Promise.reject(error);
    }
    if (this.cycle) {
      if (request.mode === this.cycleMode
        && (request.mode !== 'manual' || request.manualKey === this.cycleManualKey)) {
        return this.cycle;
      }
      return Promise.reject(new StoreCollectionOrchestratorError(
        'USER_OPERATION_BLOCKED',
        '另一条采集或恢复链正在运行；Main 已拒绝复用不相关的 in-flight Promise。',
      ));
    }
    this.transitionLocked = true;
    this.cycleMode = request.mode;
    this.cycleManualKey = request.mode === 'manual' ? request.manualKey : null;
    const cycle = this.executeCycle(request);
    this.cycle = cycle;
    void cycle.finally(() => {
      if (this.cycle === cycle) {
        this.cycle = null;
        this.cycleMode = null;
        this.cycleManualKey = null;
      }
      if (!this.safetyStateUnknown) this.transitionLocked = false;
    }).catch(() => undefined);
    return cycle;
  }

export function assertCanStart(this: StoreCollectionOrchestratorRuntime): void {
    if (this.safetyStateUnknown) throw this.safetyError();
    if (this.drainRequested || this.stopRequested) {
      throw new StoreCollectionOrchestratorError('ORCHESTRATOR_STOPPING', '编排器已进入关闭流程。');
    }
  }

export function throwIfStopping(this: StoreCollectionOrchestratorRuntime): void {
    if (this.stopRequested) throw new StopRequestedSignal();
  }

export function markSafetyUnknown(this: StoreCollectionOrchestratorRuntime,
  error: unknown): StoreCollectionOrchestratorError {
    this.safetyStateUnknown = true;
    const safety = error instanceof StoreCollectionOrchestratorError
      && error.code === 'SAFETY_STATE_UNKNOWN'
      ? error
      : new StoreCollectionOrchestratorError('SAFETY_STATE_UNKNOWN', '编排器无法证明 authority/runtime/persistence 安全状态。');
    if (safety !== error) {
      (safety as StoreCollectionOrchestratorError & { cause?: unknown }).cause ??= error;
    }
    return safety;
  }

export function safetyError(this: StoreCollectionOrchestratorRuntime): StoreCollectionOrchestratorError {
    return new StoreCollectionOrchestratorError(
      'SAFETY_STATE_UNKNOWN',
      '编排器安全状态未知；必须由 Main 完成人工恢复后才能继续。',
    );
  }

export function reportError(this: StoreCollectionOrchestratorRuntime,
  error: unknown): void {
    try {
      this.dependencies.onError?.(error);
    } catch {
      // 隔离观察者异常，避免定时回调产生未处理拒绝。
    }
  }

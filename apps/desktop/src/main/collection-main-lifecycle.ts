import {
  StoreMutationLaneError,
} from './visible-browser-runtime-registry';
import {
  StoreCollectionMainRuntimeError,
  type StoreCollectionMainRuntimeStatus,
} from "./collection-main-contracts";

import type { CollectionMainRuntimeContext } from './collection-main-runtime';

export async function recoverStartupThenConfirm(this: CollectionMainRuntimeContext): Promise<void> {
    this.assertWritableMode('startup recovery');
    this.assertSafetyKnown();
    if (this.startupRecoveryAttempted) {
      this.markStickyUnknown();
      throw new StoreCollectionMainRuntimeError(
        'STARTUP_RECOVERY_REPLAYED',
        'startup recovery and policy confirmation are one-shot',
      );
    }
    this.startupRecoveryAttempted = true;
    this.lifecycle = 'recovering';
    try {
      const result = await this.withMutationLane(
        'automation',
        'startup-recovery',
        () => this.orchestrator.recoverExistingTransitionsOnly(),
      );
      if (!result || result.state !== 'completed') {
        throw new StoreCollectionMainRuntimeError(
          'STARTUP_RECOVERY_FAILED',
          'recovery-only orchestration did not prove a completed result',
        );
      }
      this.assertSafetyKnown();
      const capability = this.policySuppression
        .issueStartupRecoveryConfirmationCapability();
      const receipt = this.policySuppression.confirmStartupRecoverySafe(capability);
      if (receipt.capability !== capability || receipt.startupRecoverySafe !== true) {
        throw new StoreCollectionMainRuntimeError(
          'STARTUP_RECOVERY_FAILED',
          'startup recovery confirmation did not consume the exact capability',
        );
      }
      this.startupRecoveryConfirmed = true;
      this.lifecycle = 'ready';
    } catch (error) {
      this.markStickyUnknown();
      throw error;
    }
  }

export function start(this: CollectionMainRuntimeContext): void {
    this.assertAutomationReady('scheduled collection');
    if (this.automationStarted) return;
    this.automationStarted = true;
    this.lifecycle = 'running';
    try {
      this.timerHandle = this.timer.set(() => {
        this.invokeScheduledCycle();
      }, this.pollIntervalMs);
      this.timerRegistered = true;
    } catch (error) {
      this.markStickyUnknown();
      throw error;
    }
    this.invokeScheduledCycle();
  }

export function isPolicyDispatchSuppressed(this: CollectionMainRuntimeContext): boolean {
    const lane = this.mutationLane.inspect();
    return this.packageUiReadOnly
      || this.lifecycle === 'sticky_unknown'
      || this.lifecycle === 'stopping'
      || this.lifecycle === 'stopped'
      || lane.held
      || lane.stickyUnknown
      || this.policySuppression.isPolicyDispatchSuppressed();
  }

export function readStatus(this: CollectionMainRuntimeContext): StoreCollectionMainRuntimeStatus {
    const runtime = this.registry.read();
    const policySuppression = Object.freeze({
      ...this.policySuppression.inspectPolicyDispatchSuppression(),
    });
    const visibleRuntime = runtime
      ? Object.freeze({
        runtimeId: runtime.runtimeId,
        epoch: runtime.epoch,
        purpose: runtime.purpose,
        context: Object.freeze({ ...runtime.context }),
        providerIdentityStatus: Object.freeze({ ...runtime.providerIdentityStatus }),
      })
      : null;
    return Object.freeze({
      lifecycle: this.lifecycle,
      packageUiReadOnly: this.packageUiReadOnly,
      startupRecoveryConfirmed: this.startupRecoveryConfirmed,
      automationStarted: this.automationStarted,
      drainProven: this.drainProven,
      registryClosed: this.registryClosed,
      orchestratorTransitionLocked: this.safeTransitionLocked(),
      effectivePolicyDispatchSuppressed: this.isPolicyDispatchSuppressed(),
      policySuppression,
      mutationLane: this.mutationLane.inspect(),
      visibleRuntime,
    });
  }

export function invokeScheduledCycle(this: CollectionMainRuntimeContext): void {
    if (!this.automationStarted || this.lifecycle !== 'running') return;
    void this.withMutationLane('automation', 'scheduled-collection', async () => {
      const result = await this.orchestrator.runScheduledCycle();
      return this.requireCycleSettlement(result, 'scheduled collection');
    }).catch((error) => {
      if (!(error instanceof StoreMutationLaneError && error.code === 'LANE_HELD')) {
        this.markStickyUnknown();
      }
      try {
        this.reportError(error);
      } catch {
        this.markStickyUnknown();
      }
    });
  }

export function assertWritableMode(this: CollectionMainRuntimeContext,
  operation: string): void {
    if (this.packageUiReadOnly) {
      throw new StoreCollectionMainRuntimeError(
        'PACKAGE_UI_READ_ONLY',
        `Package UI read-only mode forbids ${operation}`,
      );
    }
  }

export function assertAutomationReady(this: CollectionMainRuntimeContext,
  operation: string): void {
    this.assertWritableMode(operation);
    this.assertSafetyKnown();
    if (!this.startupRecoveryConfirmed) {
      throw new StoreCollectionMainRuntimeError(
        'STARTUP_RECOVERY_REQUIRED',
        `startup recovery must be confirmed before ${operation}`,
      );
    }
    if (this.lifecycle === 'stopping' || this.lifecycle === 'stopped') {
      throw new StoreCollectionMainRuntimeError(
        'RUNTIME_STOPPING',
        `Main collection runtime cannot begin ${operation} while stopping`,
      );
    }
  }

export function assertSafetyKnown(this: CollectionMainRuntimeContext): void {
    if (this.lifecycle === 'sticky_unknown'
      || this.mutationLane.inspect().stickyUnknown) {
      throw new StoreCollectionMainRuntimeError(
        'SAFETY_STATE_UNKNOWN',
        'Main collection runtime safety state is unknown',
      );
    }
  }

export function markStickyUnknown(this: CollectionMainRuntimeContext): void {
    this.lifecycle = 'sticky_unknown';
    this.automationStarted = false;
    this.clearAutomationTimer();
    this.mutationLane.markSafetyStateUnknown();
  }

export function clearAutomationTimer(this: CollectionMainRuntimeContext): void {
    if (!this.timerRegistered) return;
    const handle = this.timerHandle;
    this.timerRegistered = false;
    this.timerHandle = undefined;
    try {
      this.timer.clear(handle);
    } catch {
      this.lifecycle = 'sticky_unknown';
      this.mutationLane.markSafetyStateUnknown();
    }
  }

export function safeTransitionLocked(this: CollectionMainRuntimeContext): boolean {
    try {
      return this.orchestrator.isTransitionLocked();
    } catch {
      this.markStickyUnknown();
      return true;
    }
  }

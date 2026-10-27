import {
  normalizeStoreContextEnvelope,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import {
  type StoreCollectionMainCycleResult,
  StoreCollectionMainRuntimeError,
  type StoreCollectionExistingResumeRequest,
  type StoreCollectionUserMutationScope,
  type StoreCollectionManualCycleAdmission,
  type StoreCollectionManualCycleResult,
  type StoreCollectionManualCyclePreMutationReason,
} from "./collection-main-contracts";
import {
  PACKAGE_UI_SETUP_MUTATIONS,
} from "./collection-main-constants";
import {
  assertUsContext,
  normalizeExistingResumeRequest,
  normalizeUserMutationScope,
  isManualPreMutationReason,
  runtimeObject,
} from "./collection-main-request-values";

import type { CollectionMainRuntimeContext } from './collection-main-runtime';

export async function runNow(this: CollectionMainRuntimeContext,
  contextInput: StoreContextEnvelope): Promise<StoreCollectionMainCycleResult> {
    this.assertAutomationReady('manual collection');
    let context: StoreContextEnvelope;
    try {
      const normalized = normalizeStoreContextEnvelope(contextInput);
      assertUsContext(normalized);
      context = Object.freeze({ ...normalized });
    } catch (error) {
      throw new StoreCollectionMainRuntimeError(
        'INVALID_MANUAL_CONTEXT',
        'manual collection requires one exact US/USD/America/Los_Angeles Store context',
        { cause: error },
      );
    }
    const admission = this.issueManualCycleAdmission(context);
    const outcome = await this.withMutationLane('automation', 'manual-collection', async () => (
      this.validateManualCycleOutcome(
        await this.orchestrator.manualCycle(context, admission),
        admission,
      )
    ));
    if (outcome.kind === 'pre_mutation_rejected') {
      throw new StoreCollectionMainRuntimeError(
        'MANUAL_CYCLE_PREMUTATION_REJECTED',
        `manual collection was safely rejected before mutation: ${outcome.reason}`,
      );
    }
    return outcome.result;
  }

export async function resumeExisting(this: CollectionMainRuntimeContext,
  input: StoreCollectionExistingResumeRequest): Promise<StoreCollectionMainCycleResult> {
    this.assertAutomationReady('existing collection resume');
    const exact = normalizeExistingResumeRequest(input);
    this.assertUserOperationAllowed();
    return this.withMutationLane('automation', 'manual-collection-resume', async () => (
      this.requireCycleSettlement(
        await this.orchestrator.resumeExisting(exact),
        'existing collection resume',
      )
    ), {
      context: exact.context,
      jobId: exact.jobId,
      requestId: exact.requestId,
    });
  }

export function assertUserOperationAllowed(this: CollectionMainRuntimeContext): void {
    this.assertWritableMode('user Store mutation');
    this.assertSafetyKnown();
    if (!this.startupRecoveryConfirmed) {
      throw new StoreCollectionMainRuntimeError(
        'STARTUP_RECOVERY_REQUIRED',
        'startup recovery must be confirmed before Store mutation',
      );
    }
    if (this.lifecycle === 'stopping' || this.lifecycle === 'stopped') {
      throw new StoreCollectionMainRuntimeError(
        'RUNTIME_STOPPING',
        'Main collection runtime is stopping or stopped',
      );
    }
    const lane = this.mutationLane.inspect();
    if (lane.held) {
      throw new StoreCollectionMainRuntimeError(
        'USER_OPERATION_BLOCKED',
        `Store mutation lane is already held by ${lane.current?.kind ?? 'unknown'} operation`,
      );
    }
    try {
      this.orchestrator.assertUserOperationAllowed();
    } catch (error) {
      throw new StoreCollectionMainRuntimeError(
        'USER_OPERATION_BLOCKED',
        'orchestrator transition blocks the current user Store mutation',
        { cause: error },
      );
    }
  }

export async function withUserStoreMutation<Result>(this: CollectionMainRuntimeContext,
  scopeInput: StoreCollectionUserMutationScope,
  work: () => Promise<Result> | Result): Promise<Result> {
    normalizeUserMutationScope(scopeInput);
    if (typeof work !== 'function') {
      throw new StoreCollectionMainRuntimeError(
        'INVALID_USER_MUTATION_SCOPE',
        'user Store mutation callback is required',
      );
    }
    this.assertUserOperationAllowed();
    return this.withMutationLane('user', 'renderer-store-ipc', work);
  }

export async function withPackageUiSetupMutation<Result>(this: CollectionMainRuntimeContext,
  scopeInput: StoreCollectionUserMutationScope,
  work: () => Promise<Result> | Result): Promise<Result> {
    const scope = normalizeUserMutationScope(scopeInput);
    if (!this.packageUiReadOnly || !PACKAGE_UI_SETUP_MUTATIONS.has(scope.operation)) {
      throw new StoreCollectionMainRuntimeError(
        'PACKAGE_UI_READ_ONLY',
        `Package UI read-only mode forbids ${scope.operation}`,
      );
    }
    if (typeof work !== 'function') {
      throw new StoreCollectionMainRuntimeError(
        'INVALID_USER_MUTATION_SCOPE',
        'package UI setup mutation callback is required',
      );
    }
    this.assertSafetyKnown();
    if (this.lifecycle === 'stopping' || this.lifecycle === 'stopped') {
      throw new StoreCollectionMainRuntimeError(
        'RUNTIME_STOPPING',
        'Main collection runtime is stopping or stopped',
      );
    }
    if (this.registry.read() !== null) {
      throw new StoreCollectionMainRuntimeError(
        'USER_OPERATION_BLOCKED',
        'Package UI setup mutations are allowed only before a visible browser session exists',
      );
    }
    return this.withMutationLane('user', 'package-ui-evidence-setup', work);
  }

export function issueManualCycleAdmission(this: CollectionMainRuntimeContext,
  context: StoreContextEnvelope): StoreCollectionManualCycleAdmission {
    try {
      const capability = this.createManualCycleAdmissionCapability();
      this.registerRuntimeCapability(capability);
      const admission = Object.freeze({
        capability,
        context,
      }) as StoreCollectionManualCycleAdmission;
      this.manualCycleAdmissions.set(capability, { admission, consumed: false });
      return admission;
    } catch (error) {
      this.markStickyUnknown();
      throw error;
    }
  }

export function validateManualCycleOutcome(this: CollectionMainRuntimeContext,
  outcome: StoreCollectionManualCycleResult,
  admission: StoreCollectionManualCycleAdmission): Readonly<
    | { kind: 'completed'; result: StoreCollectionMainCycleResult }
    | { kind: 'pre_mutation_rejected'; reason: StoreCollectionManualCyclePreMutationReason }
  > {
    const record = this.manualCycleAdmissions.get(admission.capability);
    if (!record || record.admission !== admission || record.consumed) {
      throw new StoreCollectionMainRuntimeError(
        'SAFETY_STATE_UNKNOWN',
        'manual collection admission is forged, stale, or replayed',
      );
    }
    if (outcome && (
      outcome.state === 'completed'
      || (outcome.state === 'stopped' && this.acceptsGracefulShutdownStop())
    )) {
      record.consumed = true;
      return Object.freeze({ kind: 'completed', result: outcome });
    }
    let mutationStarted: unknown;
    let reason: unknown;
    let returnedAdmission: unknown;
    try {
      if (!outcome || typeof outcome !== 'object' || Array.isArray(outcome)
        || !Object.isFrozen(outcome)
        || Reflect.get(outcome, 'state') !== 'rejected') {
        throw new TypeError('manual rejection receipt must be one frozen object');
      }
      mutationStarted = Reflect.get(outcome, 'mutationStarted');
      reason = Reflect.get(outcome, 'reason');
      returnedAdmission = Reflect.get(outcome, 'admission');
    } catch (error) {
      throw new StoreCollectionMainRuntimeError(
        'SAFETY_STATE_UNKNOWN',
        'manual collection result did not prove a pre-mutation rejection',
        { cause: error },
      );
    }
    if (mutationStarted !== false
      || returnedAdmission !== admission
      || !isManualPreMutationReason(reason)) {
      throw new StoreCollectionMainRuntimeError(
        'SAFETY_STATE_UNKNOWN',
        'manual collection rejection was not bound to the exact one-shot admission',
      );
    }
    record.consumed = true;
    return Object.freeze({
      kind: 'pre_mutation_rejected',
      reason,
    });
  }

export function registerRuntimeCapability(this: CollectionMainRuntimeContext,
  capability: Readonly<object>): void {
    if (!runtimeObject(capability) || this.issuedCapabilities.has(capability)) {
      throw new StoreCollectionMainRuntimeError(
        'SAFETY_STATE_UNKNOWN',
        'Main runtime capability must be a fresh one-shot object identity',
      );
    }
    this.issuedCapabilities.add(capability);
  }

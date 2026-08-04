import type {
  StoreCollectionAutomationAuthority,
  StoreCollectionPolicySuppressionGuard,
  StoreCollectionPolicySuppressionLease,
  StoreCollectionPolicySuppressionReceipt,
  StoreCollectionPolicySuppressionReleaseReceipt,
} from './store-collection-orchestrator';

export type PolicyDispatchSuppressionState =
  | 'startup_unknown'
  | 'active'
  | 'released'
  | 'sticky_unknown';

export interface PolicyDispatchSuppressionSnapshot {
  state: PolicyDispatchSuppressionState;
  suppressed: boolean;
  activeGuardCount: number;
}

/**
 * Read-only boundary consumed by policy dispatch. Callers cannot acquire,
 * release, or reconstruct a suppression guard through this port.
 */
export interface PolicyDispatchSuppressionReadPort {
  isPolicyDispatchSuppressed(): boolean;
}

declare const startupRecoveryCapabilityBrand: unique symbol;
export type PolicyDispatchStartupRecoveryCapability = Readonly<object> & {
  readonly [startupRecoveryCapabilityBrand]: 'PolicyDispatchStartupRecoveryCapability';
};

export interface PolicyDispatchStartupRecoveryConfirmationReceipt {
  capability: PolicyDispatchStartupRecoveryCapability;
  startupRecoverySafe: true;
}

export interface StoreCollectionPolicySuppressionControllerOptions {
  createCycleId?: () => string;
  createGuard?: () => StoreCollectionPolicySuppressionGuard;
  createStartupRecoveryCapability?: () => PolicyDispatchStartupRecoveryCapability;
}

export type StoreCollectionPolicySuppressionErrorCode =
  | 'INVALID_AUTOMATION_AUTHORITY'
  | 'INVALID_GUARD'
  | 'ALIASED_CAPABILITY'
  | 'REPLAYED_CAPABILITY'
  | 'OWNER_MISMATCH'
  | 'GUARD_NOT_ACTIVE'
  | 'INVALID_STARTUP_RECOVERY_CONFIRMATION'
  | 'STARTUP_RECOVERY_NOT_CONFIRMABLE';

export class StoreCollectionPolicySuppressionError extends Error {
  constructor(
    readonly code: StoreCollectionPolicySuppressionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'StoreCollectionPolicySuppressionError';
  }
}

interface GuardRecord {
  owner: string;
  capability: StoreCollectionAutomationAuthority['capability'];
  cycleId: string;
  guard: StoreCollectionPolicySuppressionGuard;
  state: PolicyDispatchSuppressionState;
}

interface AutomationCapabilityRecord {
  owner: string;
  cycleId: string;
  guard: StoreCollectionPolicySuppressionGuard;
}

type CapabilityIdentityDomain = 'automation' | 'guard' | 'startup_recovery';
type CapabilityIdentityLifecycle = 'issued' | 'active' | 'released' | 'confirmed' | 'sticky_unknown';

interface CapabilityIdentityRecord {
  domain: CapabilityIdentityDomain;
  lifecycle: CapabilityIdentityLifecycle;
}

/**
 * Main-only suppression authority used while visible multi-store collection
 * temporarily owns Store/Profile authority. Object identity is the authority:
 * guards cannot be serialized, cloned, aliased to the automation capability,
 * or reissued across cycles.
 *
 * Any invalid identity transition is sticky fail-closed. There is deliberately
 * no "clear unknown" API; recovery requires rebuilding the Main controller
 * under an explicit operator-controlled process.
 */
export class StoreCollectionPolicySuppressionController
implements PolicyDispatchSuppressionReadPort {
  private readonly createCycleId: () => string;
  private readonly createGuard: () => StoreCollectionPolicySuppressionGuard;
  private readonly createStartupRecoveryCapability: () => PolicyDispatchStartupRecoveryCapability;
  private readonly guards = new WeakMap<object, GuardRecord>();
  private readonly automationCapabilities = new WeakMap<object, AutomationCapabilityRecord>();
  private readonly capabilityIdentities = new WeakMap<object, CapabilityIdentityRecord>();
  private readonly issuedCycleIds = new Set<string>();
  private sequence = 0;
  private activeGuardCount = 0;
  private stickyUnknown = false;
  private startupRecoveryConfirmed = false;
  private startupRecoveryCapabilityIssued = false;
  private startupRecoveryCapability?: PolicyDispatchStartupRecoveryCapability;

  constructor(options: StoreCollectionPolicySuppressionControllerOptions = {}) {
    this.createCycleId = options.createCycleId
      ?? (() => `policy-suppression-cycle-${++this.sequence}`);
    this.createGuard = options.createGuard
      ?? (() => Object.freeze({}) as StoreCollectionPolicySuppressionGuard);
    this.createStartupRecoveryCapability = options.createStartupRecoveryCapability
      ?? (() => Object.freeze({}) as PolicyDispatchStartupRecoveryCapability);
  }

  /**
   * Issues the sole Main-process capability that may confirm startup history
   * recovery. Possession is authority; there is no serializable substitute.
   */
  issueStartupRecoveryConfirmationCapability(): PolicyDispatchStartupRecoveryCapability {
    if (this.stickyUnknown) {
      throw new StoreCollectionPolicySuppressionError(
        'STARTUP_RECOVERY_NOT_CONFIRMABLE',
        'sticky unknown policy suppression cannot confirm startup recovery',
      );
    }
    if (this.startupRecoveryCapabilityIssued) {
      this.markStickyUnknown();
      throw new StoreCollectionPolicySuppressionError(
        'REPLAYED_CAPABILITY',
        'startup recovery confirmation capability was already issued',
      );
    }
    let capability: PolicyDispatchStartupRecoveryCapability;
    try {
      capability = this.createStartupRecoveryCapability();
    } catch (error) {
      this.markStickyUnknown();
      throw error;
    }
    if (!runtimeObject(capability)) {
      this.markStickyUnknown();
      throw new StoreCollectionPolicySuppressionError(
        'INVALID_STARTUP_RECOVERY_CONFIRMATION',
        'startup recovery confirmation capability must use object identity',
      );
    }
    const identity = this.capabilityIdentities.get(capability);
    if (identity) {
      this.markStickyUnknown();
      throw new StoreCollectionPolicySuppressionError(
        'ALIASED_CAPABILITY',
        `startup recovery capability aliases historical ${identity.domain} identity`,
      );
    }
    this.startupRecoveryCapabilityIssued = true;
    this.startupRecoveryCapability = capability;
    this.capabilityIdentities.set(capability, {
      domain: 'startup_recovery',
      lifecycle: 'issued',
    });
    return capability;
  }

  /**
   * One-shot acknowledgement from the external Main startup orchestrator.
   * Confirmation removes only startup_unknown; active collection guards remain
   * independently suppressing and release never performs a dispatch pump.
   */
  confirmStartupRecoverySafe(
    capability: PolicyDispatchStartupRecoveryCapability,
  ): PolicyDispatchStartupRecoveryConfirmationReceipt {
    if (this.stickyUnknown) {
      throw new StoreCollectionPolicySuppressionError(
        'STARTUP_RECOVERY_NOT_CONFIRMABLE',
        'sticky unknown policy suppression cannot confirm startup recovery',
      );
    }
    const identity = runtimeObject(capability)
      ? this.capabilityIdentities.get(capability)
      : undefined;
    if (!identity
      || identity.domain !== 'startup_recovery'
      || identity.lifecycle !== 'issued'
      || capability !== this.startupRecoveryCapability
      || !this.startupRecoveryCapabilityIssued
      || this.startupRecoveryConfirmed) {
      this.markStickyUnknown();
      throw new StoreCollectionPolicySuppressionError(
        this.startupRecoveryConfirmed
          ? 'REPLAYED_CAPABILITY'
          : 'INVALID_STARTUP_RECOVERY_CONFIRMATION',
        'startup recovery confirmation capability is forged, aliased, or replayed',
      );
    }
    this.startupRecoveryConfirmed = true;
    this.capabilityIdentities.set(capability, {
      domain: 'startup_recovery',
      lifecycle: 'confirmed',
    });
    return {
      capability,
      startupRecoverySafe: true,
    };
  }

  async acquirePolicyDispatchSuppression(
    authority: StoreCollectionAutomationAuthority,
  ): Promise<StoreCollectionPolicySuppressionLease> {
    const normalized = this.requireAutomationAuthority(authority);
    const capabilityIdentity = this.capabilityIdentities.get(normalized.capability);
    if (capabilityIdentity) {
      this.markStickyUnknown(this.guardRecordForIdentity(normalized.capability));
      throw new StoreCollectionPolicySuppressionError(
        capabilityIdentity.domain === 'automation'
          ? 'REPLAYED_CAPABILITY'
          : 'ALIASED_CAPABILITY',
        capabilityIdentity.domain === 'automation'
          ? 'automation capability already issued a policy suppression guard'
          : `automation capability aliases historical ${capabilityIdentity.domain} identity`,
      );
    }

    let cycleId: string;
    let guard: StoreCollectionPolicySuppressionGuard;
    try {
      cycleId = normalizeIdentity(this.createCycleId(), 'cycleId');
      guard = this.createGuard();
    } catch (error) {
      this.markStickyUnknown();
      throw error;
    }
    if (this.issuedCycleIds.has(cycleId)) {
      this.markStickyUnknown();
      throw new StoreCollectionPolicySuppressionError(
        'REPLAYED_CAPABILITY',
        'policy suppression cycle identity was replayed',
      );
    }
    if (!runtimeObject(guard)) {
      this.markStickyUnknown();
      throw new StoreCollectionPolicySuppressionError(
        'INVALID_GUARD',
        'policy suppression guard must be an object-identity capability',
      );
    }
    const guardIdentity = this.capabilityIdentities.get(guard);
    if (sameObjectIdentity(guard, normalized.capability) || guardIdentity) {
      this.markStickyUnknown(this.guardRecordForIdentity(guard));
      throw new StoreCollectionPolicySuppressionError(
        guardIdentity?.domain === 'guard'
          ? 'REPLAYED_CAPABILITY'
          : 'ALIASED_CAPABILITY',
        guardIdentity?.domain === 'guard'
          ? 'policy suppression guard was already issued'
          : 'policy suppression guard and historical capability domains must be distinct',
      );
    }

    const record: GuardRecord = {
      owner: normalized.owner,
      capability: normalized.capability,
      cycleId,
      guard,
      state: 'active',
    };
    this.guards.set(guard, record);
    this.automationCapabilities.set(normalized.capability, {
      owner: normalized.owner,
      cycleId,
      guard,
    });
    this.capabilityIdentities.set(normalized.capability, {
      domain: 'automation',
      lifecycle: 'active',
    });
    this.capabilityIdentities.set(guard, {
      domain: 'guard',
      lifecycle: 'active',
    });
    this.issuedCycleIds.add(cycleId);
    this.activeGuardCount += 1;

    let releaseCalled = false;
    return {
      owner: normalized.owner,
      capability: normalized.capability,
      guard,
      release: async () => {
        if (releaseCalled) {
          this.markStickyUnknown(record);
          throw new StoreCollectionPolicySuppressionError(
            'REPLAYED_CAPABILITY',
            'policy suppression release was replayed',
          );
        }
        releaseCalled = true;
        return this.releaseExact(record);
      },
    };
  }

  async readPolicyDispatchSuppression(
    input: StoreCollectionAutomationAuthority & {
      guard: StoreCollectionPolicySuppressionGuard;
    },
  ): Promise<StoreCollectionPolicySuppressionReceipt> {
    const normalized = this.requireAutomationAuthority(input);
    let guard: StoreCollectionPolicySuppressionGuard;
    let record: GuardRecord | undefined;
    try {
      const guardSnapshot = Reflect.get(input, 'guard');
      if (!runtimeObject(guardSnapshot)) {
        throw new TypeError('policy suppression guard must use object identity');
      }
      guard = guardSnapshot as StoreCollectionPolicySuppressionGuard;
      record = this.guards.get(guardSnapshot);
    } catch {
      this.markStickyUnknown();
      throw new StoreCollectionPolicySuppressionError(
        'INVALID_GUARD',
        'policy suppression guard could not be read safely',
      );
    }
    if (!record) {
      this.markStickyUnknown();
      throw new StoreCollectionPolicySuppressionError(
        'INVALID_GUARD',
        'policy suppression guard is forged or unknown',
      );
    }
    this.assertExact(record, normalized, guard);
    if (record.state !== 'active') {
      this.markStickyUnknown(record);
      throw new StoreCollectionPolicySuppressionError(
        'GUARD_NOT_ACTIVE',
        'policy suppression guard is not active',
      );
    }
    return {
      owner: record.owner,
      capability: record.capability,
      guard: record.guard,
      suppressed: true,
    };
  }

  isPolicyDispatchSuppressed(): boolean {
    return this.stickyUnknown
      || !this.startupRecoveryConfirmed
      || this.activeGuardCount > 0;
  }

  inspectPolicyDispatchSuppression(): PolicyDispatchSuppressionSnapshot {
    return {
      state: this.stickyUnknown
        ? 'sticky_unknown'
        : !this.startupRecoveryConfirmed
          ? 'startup_unknown'
          : this.activeGuardCount > 0
            ? 'active'
            : 'released',
      suppressed: this.isPolicyDispatchSuppressed(),
      activeGuardCount: this.activeGuardCount,
    };
  }

  private async releaseExact(
    record: GuardRecord,
  ): Promise<StoreCollectionPolicySuppressionReleaseReceipt> {
    const registered = this.guards.get(record.guard);
    if (registered !== record) {
      this.markStickyUnknown(registered);
      throw new StoreCollectionPolicySuppressionError(
        'INVALID_GUARD',
        'policy suppression release guard is forged or unknown',
      );
    }
    if (record.state !== 'active') {
      this.markStickyUnknown(record);
      throw new StoreCollectionPolicySuppressionError(
        'GUARD_NOT_ACTIVE',
        'policy suppression guard cannot be released from its current state',
      );
    }
    if (this.stickyUnknown) {
      this.markStickyUnknown(record);
      throw new StoreCollectionPolicySuppressionError(
        'GUARD_NOT_ACTIVE',
        'sticky unknown policy suppression cannot be released automatically',
      );
    }
    record.state = 'released';
    this.activeGuardCount -= 1;
    this.capabilityIdentities.set(record.guard, {
      domain: 'guard',
      lifecycle: 'released',
    });
    this.capabilityIdentities.set(record.capability, {
      domain: 'automation',
      lifecycle: 'released',
    });
    return {
      owner: record.owner,
      capability: record.capability,
      guard: record.guard,
      released: true,
    };
  }

  private requireAutomationAuthority(
    authority: StoreCollectionAutomationAuthority,
  ): StoreCollectionAutomationAuthority {
    try {
      if (!runtimeObject(authority)
        || typeof authority !== 'object'
        || Array.isArray(authority)) {
        throw new TypeError('Main automation authority must be a non-array object');
      }
      const owner = normalizeIdentity(Reflect.get(authority, 'owner'), 'owner');
      const capability = Reflect.get(authority, 'capability');
      if (!runtimeObject(capability)) {
        throw new TypeError('Main automation capability must use object identity');
      }
      return {
        owner,
        capability: capability as StoreCollectionAutomationAuthority['capability'],
      };
    } catch {
      this.markStickyUnknown();
      throw new StoreCollectionPolicySuppressionError(
        'INVALID_AUTOMATION_AUTHORITY',
        'Main automation authority owner or capability is invalid',
      );
    }
  }

  private assertExact(
    record: GuardRecord,
    authority: StoreCollectionAutomationAuthority,
    guard: StoreCollectionPolicySuppressionGuard,
  ): void {
    if (record.guard !== guard
      || record.capability !== authority.capability
      || record.owner !== authority.owner) {
      this.markStickyUnknown(record);
      throw new StoreCollectionPolicySuppressionError(
        'OWNER_MISMATCH',
        'policy suppression guard owner or automation capability does not match',
      );
    }
  }

  private guardRecordForIdentity(identity: object): GuardRecord | undefined {
    const guardRecord = this.guards.get(identity);
    if (guardRecord) return guardRecord;
    const automationRecord = this.automationCapabilities.get(identity);
    return automationRecord
      ? this.guards.get(automationRecord.guard)
      : undefined;
  }

  private markStickyUnknown(record?: GuardRecord): void {
    this.stickyUnknown = true;
    if (this.startupRecoveryCapability && runtimeObject(this.startupRecoveryCapability)) {
      this.capabilityIdentities.set(this.startupRecoveryCapability, {
        domain: 'startup_recovery',
        lifecycle: 'sticky_unknown',
      });
    }
    if (!record || record.state === 'sticky_unknown') return;
    if (record.state === 'active') {
      this.activeGuardCount = Math.max(0, this.activeGuardCount - 1);
    }
    record.state = 'sticky_unknown';
    this.capabilityIdentities.set(record.guard, {
      domain: 'guard',
      lifecycle: 'sticky_unknown',
    });
    this.capabilityIdentities.set(record.capability, {
      domain: 'automation',
      lifecycle: 'sticky_unknown',
    });
  }
}

function runtimeObject(value: unknown): value is object {
  return (typeof value === 'object' && value !== null)
    || typeof value === 'function';
}

function sameObjectIdentity(left: unknown, right: unknown): boolean {
  return runtimeObject(left) && runtimeObject(right) && left === right;
}

function normalizeIdentity(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new TypeError(`${field} is required`);
  const normalized = value.trim();
  if (!/^[A-Za-z0-9:_-]{1,160}$/.test(normalized)) {
    throw new TypeError(`${field} must use 1-160 safe identity characters`);
  }
  return normalized;
}

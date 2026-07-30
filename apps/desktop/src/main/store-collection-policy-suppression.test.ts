import { describe, expect, it } from 'vitest';
import {
  StoreCollectionPolicySuppressionController,
  type PolicyDispatchSuppressionReadPort,
} from './store-collection-policy-suppression';
import type {
  StoreCollectionAutomationAuthority,
  StoreCollectionAutomationCapability,
  StoreCollectionOrchestratorDependencies,
  StoreCollectionPolicySuppressionGuard,
} from './store-collection-orchestrator';

function capability(label: string): StoreCollectionAutomationCapability {
  return Object.freeze({ label }) as unknown as StoreCollectionAutomationCapability;
}

function authority(
  owner = 'collection-owner',
  value = capability('automation'),
): StoreCollectionAutomationAuthority {
  return { owner, capability: value };
}

function confirmStartupRecovery(
  controller: StoreCollectionPolicySuppressionController,
): void {
  const recoveryCapability = controller.issueStartupRecoveryConfirmationCapability();
  const receipt = controller.confirmStartupRecoverySafe(recoveryCapability);
  expect(receipt).toEqual({
    capability: recoveryCapability,
    startupRecoverySafe: true,
  });
  expect(receipt.capability).toBe(recoveryCapability);
}

describe('StoreCollectionPolicySuppressionController', () => {
  it('starts suppressed as startup_unknown and only an exact one-shot recovery capability makes it safe', async () => {
    const controller = new StoreCollectionPolicySuppressionController();
    expect(controller.inspectPolicyDispatchSuppression()).toEqual({
      state: 'startup_unknown',
      suppressed: true,
      activeGuardCount: 0,
    });

    const lease = await controller.acquirePolicyDispatchSuppression(authority());
    await expect(lease.release()).resolves.toMatchObject({ released: true });
    expect(controller.inspectPolicyDispatchSuppression()).toEqual({
      state: 'startup_unknown',
      suppressed: true,
      activeGuardCount: 0,
    });

    const recoveryCapability = controller.issueStartupRecoveryConfirmationCapability();
    const receipt = controller.confirmStartupRecoverySafe(recoveryCapability);
    expect(receipt).toEqual({
      capability: recoveryCapability,
      startupRecoverySafe: true,
    });
    expect(receipt.capability).toBe(recoveryCapability);
    expect(controller.inspectPolicyDispatchSuppression()).toEqual({
      state: 'released',
      suppressed: false,
      activeGuardCount: 0,
    });

    expect(() => controller.confirmStartupRecoverySafe(recoveryCapability))
      .toThrowError(expect.objectContaining({ code: 'REPLAYED_CAPABILITY' }));
    expect(controller.inspectPolicyDispatchSuppression().state).toBe('sticky_unknown');
  });

  it('adapts exact orchestrator acquire/read/release receipts with an independent one-shot guard', async () => {
    const controller = new StoreCollectionPolicySuppressionController({
      createCycleId: () => 'cycle-1',
    });
    confirmStartupRecovery(controller);
    const auth = authority();
    const ports: Pick<
      StoreCollectionOrchestratorDependencies,
      'acquirePolicyDispatchSuppression' | 'readPolicyDispatchSuppression'
    > = controller;
    const readPort: PolicyDispatchSuppressionReadPort = controller;

    const lease = await ports.acquirePolicyDispatchSuppression(auth);
    expect(lease.guard).not.toBe(auth.capability);
    expect(readPort.isPolicyDispatchSuppressed()).toBe(true);
    expect(controller.inspectPolicyDispatchSuppression()).toEqual({
      state: 'active',
      suppressed: true,
      activeGuardCount: 1,
    });

    const proof = await ports.readPolicyDispatchSuppression({
      ...auth,
      guard: lease.guard,
    });
    expect(proof).toEqual({
      ...auth,
      guard: lease.guard,
      suppressed: true,
    });
    expect(proof.guard).toBe(lease.guard);
    expect(proof.capability).toBe(auth.capability);
    const released = await lease.release();
    expect(released).toEqual({
      ...auth,
      guard: lease.guard,
      released: true,
    });
    expect(released.guard).toBe(lease.guard);
    expect(released.capability).toBe(auth.capability);
    expect(controller.inspectPolicyDispatchSuppression()).toEqual({
      state: 'released',
      suppressed: false,
      activeGuardCount: 0,
    });
  });

  it('snapshots authority owner and capability accessors exactly once', async () => {
    const controller = new StoreCollectionPolicySuppressionController();
    confirmStartupRecovery(controller);
    const stableCapability = capability('single-read-automation');
    let ownerReads = 0;
    let capabilityReads = 0;
    const accessorAuthority = {
      get owner() {
        ownerReads += 1;
        if (ownerReads > 1) throw new Error('owner accessor was read twice');
        return 'single-read-owner';
      },
      get capability(): StoreCollectionAutomationCapability {
        capabilityReads += 1;
        return capabilityReads === 1
          ? stableCapability
          : null as unknown as StoreCollectionAutomationCapability;
      },
    } as StoreCollectionAutomationAuthority;

    const lease = await controller.acquirePolicyDispatchSuppression(accessorAuthority);

    expect(ownerReads).toBe(1);
    expect(capabilityReads).toBe(1);
    expect(lease).toMatchObject({
      owner: 'single-read-owner',
      capability: stableCapability,
    });
    await expect(lease.release()).resolves.toMatchObject({ released: true });
    expect(controller.inspectPolicyDispatchSuppression()).toEqual({
      state: 'released',
      suppressed: false,
      activeGuardCount: 0,
    });
  });

  it('standardizes owner and capability accessor failures as sticky invalid authority', async () => {
    const ownerFailureController = new StoreCollectionPolicySuppressionController();
    confirmStartupRecovery(ownerFailureController);
    let ownerReads = 0;
    let ownerFailureCapabilityReads = 0;
    const ownerFailureAuthority = {
      get owner(): string {
        ownerReads += 1;
        throw new Error('untrusted owner getter failure');
      },
      get capability() {
        ownerFailureCapabilityReads += 1;
        return capability('owner-failure-automation');
      },
    } as StoreCollectionAutomationAuthority;

    await expect(ownerFailureController.acquirePolicyDispatchSuppression(ownerFailureAuthority))
      .rejects.toMatchObject({ code: 'INVALID_AUTOMATION_AUTHORITY' });
    expect(ownerReads).toBe(1);
    expect(ownerFailureCapabilityReads).toBe(0);
    expect(ownerFailureController.inspectPolicyDispatchSuppression()).toEqual({
      state: 'sticky_unknown',
      suppressed: true,
      activeGuardCount: 0,
    });

    const capabilityFailureController = new StoreCollectionPolicySuppressionController();
    confirmStartupRecovery(capabilityFailureController);
    let capabilityFailureOwnerReads = 0;
    let capabilityReads = 0;
    const capabilityFailureAuthority = {
      get owner() {
        capabilityFailureOwnerReads += 1;
        return 'capability-failure-owner';
      },
      get capability(): StoreCollectionAutomationCapability {
        capabilityReads += 1;
        throw new Error('untrusted capability getter failure');
      },
    } as StoreCollectionAutomationAuthority;

    await expect(capabilityFailureController.acquirePolicyDispatchSuppression(
      capabilityFailureAuthority,
    )).rejects.toMatchObject({ code: 'INVALID_AUTOMATION_AUTHORITY' });
    expect(capabilityFailureOwnerReads).toBe(1);
    expect(capabilityReads).toBe(1);
    expect(capabilityFailureController.inspectPolicyDispatchSuppression()).toEqual({
      state: 'sticky_unknown',
      suppressed: true,
      activeGuardCount: 0,
    });
  });

  it('standardizes revoked authority proxies as sticky invalid authority', async () => {
    const controller = new StoreCollectionPolicySuppressionController();
    confirmStartupRecovery(controller);
    const revocable = Proxy.revocable(authority(), {});
    revocable.revoke();

    await expect(controller.acquirePolicyDispatchSuppression(
      revocable.proxy,
    )).rejects.toMatchObject({ code: 'INVALID_AUTOMATION_AUTHORITY' });
    expect(controller.inspectPolicyDispatchSuppression()).toEqual({
      state: 'sticky_unknown',
      suppressed: true,
      activeGuardCount: 0,
    });
  });

  it.each([
    [
      'unsafe owner identity',
      { owner: 'owner with spaces', capability: capability('invalid-owner') },
    ],
    [
      'non-object capability',
      { owner: 'invalid-capability-owner', capability: null },
    ],
  ])('standardizes %s as sticky invalid authority', async (_label, invalidAuthority) => {
    const controller = new StoreCollectionPolicySuppressionController();
    confirmStartupRecovery(controller);

    await expect(controller.acquirePolicyDispatchSuppression(
      invalidAuthority as unknown as StoreCollectionAutomationAuthority,
    )).rejects.toMatchObject({ code: 'INVALID_AUTOMATION_AUTHORITY' });
    expect(controller.inspectPolicyDispatchSuppression()).toEqual({
      state: 'sticky_unknown',
      suppressed: true,
      activeGuardCount: 0,
    });
  });

  it('makes forged owner/capability reads sticky and never permits the valid lease to release', async () => {
    const controller = new StoreCollectionPolicySuppressionController();
    confirmStartupRecovery(controller);
    const auth = authority();
    const lease = await controller.acquirePolicyDispatchSuppression(auth);

    await expect(controller.readPolicyDispatchSuppression({
      owner: 'forged-owner',
      capability: auth.capability,
      guard: lease.guard,
    })).rejects.toMatchObject({ code: 'OWNER_MISMATCH' });
    expect(controller.inspectPolicyDispatchSuppression()).toEqual({
      state: 'sticky_unknown',
      suppressed: true,
      activeGuardCount: 0,
    });
    await expect(lease.release()).rejects.toMatchObject({ code: 'GUARD_NOT_ACTIVE' });
    expect(controller.isPolicyDispatchSuppressed()).toBe(true);
  });

  it('snapshots the read guard accessor exactly once', async () => {
    const controller = new StoreCollectionPolicySuppressionController();
    confirmStartupRecovery(controller);
    const auth = authority();
    const lease = await controller.acquirePolicyDispatchSuppression(auth);
    let guardReads = 0;
    const readInput = {
      owner: auth.owner,
      capability: auth.capability,
      get guard(): StoreCollectionPolicySuppressionGuard {
        guardReads += 1;
        return guardReads === 1
          ? lease.guard
          : null as unknown as StoreCollectionPolicySuppressionGuard;
      },
    } as StoreCollectionAutomationAuthority & {
      guard: StoreCollectionPolicySuppressionGuard;
    };

    await expect(controller.readPolicyDispatchSuppression(readInput)).resolves.toEqual({
      owner: auth.owner,
      capability: auth.capability,
      guard: lease.guard,
      suppressed: true,
    });
    expect(guardReads).toBe(1);
    await expect(lease.release()).resolves.toMatchObject({ released: true });
    expect(controller.inspectPolicyDispatchSuppression()).toEqual({
      state: 'released',
      suppressed: false,
      activeGuardCount: 0,
    });
  });

  it('standardizes a guard accessor failure and makes released suppression sticky unknown', async () => {
    const controller = new StoreCollectionPolicySuppressionController();
    confirmStartupRecovery(controller);
    const auth = authority();
    const lease = await controller.acquirePolicyDispatchSuppression(auth);
    await lease.release();
    expect(controller.inspectPolicyDispatchSuppression().state).toBe('released');
    let guardReads = 0;
    const throwingGuardInput = {
      owner: auth.owner,
      capability: auth.capability,
      get guard(): StoreCollectionPolicySuppressionGuard {
        guardReads += 1;
        throw new Error('untrusted guard getter failure');
      },
    } as StoreCollectionAutomationAuthority & {
      guard: StoreCollectionPolicySuppressionGuard;
    };

    await expect(controller.readPolicyDispatchSuppression(throwingGuardInput))
      .rejects.toMatchObject({ code: 'INVALID_GUARD' });
    expect(guardReads).toBe(1);
    expect(controller.inspectPolicyDispatchSuppression()).toEqual({
      state: 'sticky_unknown',
      suppressed: true,
      activeGuardCount: 0,
    });
  });

  it('makes an unknown guard sticky and never treats the valid guard as releasable afterward', async () => {
    const controller = new StoreCollectionPolicySuppressionController();
    confirmStartupRecovery(controller);
    const auth = authority();
    const lease = await controller.acquirePolicyDispatchSuppression(auth);
    const forged = Object.freeze({ label: 'forged' }) as unknown as StoreCollectionPolicySuppressionGuard;

    await expect(controller.readPolicyDispatchSuppression({
      ...auth,
      guard: forged,
    })).rejects.toMatchObject({ code: 'INVALID_GUARD' });
    expect(controller.inspectPolicyDispatchSuppression().state).toBe('sticky_unknown');
    await expect(lease.release()).rejects.toMatchObject({ code: 'GUARD_NOT_ACTIVE' });
    expect(controller.isPolicyDispatchSuppressed()).toBe(true);
  });

  it('rejects a guard aliased to automation authority and never returns a releasable lease', async () => {
    const auth = authority();
    const controller = new StoreCollectionPolicySuppressionController({
      createGuard: () => auth.capability as unknown as StoreCollectionPolicySuppressionGuard,
    });
    confirmStartupRecovery(controller);

    await expect(controller.acquirePolicyDispatchSuppression(auth))
      .rejects.toMatchObject({ code: 'ALIASED_CAPABILITY' });
    expect(controller.inspectPolicyDispatchSuppression()).toEqual({
      state: 'sticky_unknown',
      suppressed: true,
      activeGuardCount: 0,
    });
  });

  it('rejects guard and automation-capability replay without releasing either cycle', async () => {
    const sharedGuard = Object.freeze({ label: 'shared' }) as unknown as StoreCollectionPolicySuppressionGuard;
    let cycle = 0;
    const controller = new StoreCollectionPolicySuppressionController({
      createCycleId: () => `cycle-${++cycle}`,
      createGuard: () => sharedGuard,
    });
    confirmStartupRecovery(controller);
    const firstAuth = authority('owner-1', capability('automation-1'));
    const first = await controller.acquirePolicyDispatchSuppression(firstAuth);
    await expect(controller.acquirePolicyDispatchSuppression(
      authority('owner-2', capability('automation-2')),
    )).rejects.toMatchObject({ code: 'REPLAYED_CAPABILITY' });
    await expect(first.release()).rejects.toMatchObject({ code: 'GUARD_NOT_ACTIVE' });
    expect(controller.isPolicyDispatchSuppressed()).toBe(true);

    const secondController = new StoreCollectionPolicySuppressionController();
    confirmStartupRecovery(secondController);
    const replayedAuth = authority('owner-3', capability('automation-3'));
    const lease = await secondController.acquirePolicyDispatchSuppression(replayedAuth);
    await expect(secondController.acquirePolicyDispatchSuppression(replayedAuth))
      .rejects.toMatchObject({ code: 'REPLAYED_CAPABILITY' });
    await expect(lease.release()).rejects.toMatchObject({ code: 'GUARD_NOT_ACTIVE' });
    expect(secondController.isPolicyDispatchSuppressed()).toBe(true);
  });

  it('rejects a repeated internal cycle identity after the prior guard was released', async () => {
    const controller = new StoreCollectionPolicySuppressionController({
      createCycleId: () => 'cycle-replayed',
    });
    confirmStartupRecovery(controller);
    const first = await controller.acquirePolicyDispatchSuppression(
      authority('owner-1', capability('automation-1')),
    );
    await first.release();

    await expect(controller.acquirePolicyDispatchSuppression(
      authority('owner-2', capability('automation-2')),
    )).rejects.toMatchObject({ code: 'REPLAYED_CAPABILITY' });
    expect(controller.inspectPolicyDispatchSuppression()).toEqual({
      state: 'sticky_unknown',
      suppressed: true,
      activeGuardCount: 0,
    });
  });

  it('keeps suppression global across operator Store/Profile switches until exact release', async () => {
    const controller = new StoreCollectionPolicySuppressionController();
    confirmStartupRecovery(controller);
    const lease = await controller.acquirePolicyDispatchSuppression(authority());
    let activeStore = 'store-a';

    expect([activeStore, controller.isPolicyDispatchSuppressed()]).toEqual(['store-a', true]);
    activeStore = 'store-b';
    expect([activeStore, controller.isPolicyDispatchSuppressed()]).toEqual(['store-b', true]);
    await lease.release();
    expect([activeStore, controller.isPolicyDispatchSuppressed()]).toEqual(['store-b', false]);
  });

  it('turns replayed release into sticky unknown and never emits a second release receipt', async () => {
    const controller = new StoreCollectionPolicySuppressionController();
    confirmStartupRecovery(controller);
    const lease = await controller.acquirePolicyDispatchSuppression(authority());

    await expect(lease.release()).resolves.toMatchObject({ released: true });
    await expect(lease.release()).rejects.toMatchObject({ code: 'REPLAYED_CAPABILITY' });
    expect(controller.inspectPolicyDispatchSuppression()).toEqual({
      state: 'sticky_unknown',
      suppressed: true,
      activeGuardCount: 0,
    });
  });

  it('makes sticky guard failures permanently ineligible for startup recovery confirmation', async () => {
    const controller = new StoreCollectionPolicySuppressionController();
    const recoveryCapability = controller.issueStartupRecoveryConfirmationCapability();
    const auth = authority();
    const lease = await controller.acquirePolicyDispatchSuppression(auth);
    const forged = Object.freeze({ label: 'forged' }) as unknown as StoreCollectionPolicySuppressionGuard;

    await expect(controller.readPolicyDispatchSuppression({
      ...auth,
      guard: forged,
    })).rejects.toMatchObject({ code: 'INVALID_GUARD' });
    expect(() => controller.confirmStartupRecoverySafe(recoveryCapability))
      .toThrowError(expect.objectContaining({ code: 'STARTUP_RECOVERY_NOT_CONFIRMABLE' }));
    await expect(lease.release()).rejects.toMatchObject({ code: 'GUARD_NOT_ACTIVE' });
    expect(controller.inspectPolicyDispatchSuppression()).toEqual({
      state: 'sticky_unknown',
      suppressed: true,
      activeGuardCount: 0,
    });
  });

  it('rejects automation and guard aliases in both directions across released cycles', async () => {
    const historicalAutomation = capability('historical-automation');
    const firstGuard = Object.freeze({ label: 'first-guard' }) as unknown as StoreCollectionPolicySuppressionGuard;
    let reverseGuardIssue = 0;
    let reverseCycle = 0;
    const reverseController = new StoreCollectionPolicySuppressionController({
      createCycleId: () => `reverse-${++reverseCycle}`,
      createGuard: () => (
        reverseGuardIssue++ === 0
          ? firstGuard
          : historicalAutomation as unknown as StoreCollectionPolicySuppressionGuard
      ),
    });
    confirmStartupRecovery(reverseController);
    const first = await reverseController.acquirePolicyDispatchSuppression(
      authority('owner-1', historicalAutomation),
    );
    await first.release();

    await expect(reverseController.acquirePolicyDispatchSuppression(
      authority('owner-2', capability('fresh-automation')),
    )).rejects.toMatchObject({ code: 'ALIASED_CAPABILITY' });
    expect(reverseController.inspectPolicyDispatchSuppression().state).toBe('sticky_unknown');

    const historicalGuard = Object.freeze({ label: 'historical-guard' }) as unknown as StoreCollectionPolicySuppressionGuard;
    let forwardCycle = 0;
    const forwardController = new StoreCollectionPolicySuppressionController({
      createCycleId: () => `forward-${++forwardCycle}`,
      createGuard: () => historicalGuard,
    });
    confirmStartupRecovery(forwardController);
    const forwardFirst = await forwardController.acquirePolicyDispatchSuppression(
      authority('owner-3', capability('first-automation')),
    );
    await forwardFirst.release();

    await expect(forwardController.acquirePolicyDispatchSuppression(
      authority(
        'owner-4',
        historicalGuard as unknown as StoreCollectionAutomationCapability,
      ),
    )).rejects.toMatchObject({ code: 'ALIASED_CAPABILITY' });
    expect(forwardController.inspectPolicyDispatchSuppression().state).toBe('sticky_unknown');
  });
});

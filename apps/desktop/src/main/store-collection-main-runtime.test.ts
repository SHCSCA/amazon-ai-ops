import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { StoreMutationLane } from './visible-browser-runtime-registry';
import {
  StoreCollectionMainRuntime,
  type StoreCollectionExistingResumeRequest,
} from './store-collection-main-runtime';
import {
  context,
  orchestrator,
  resumeRequest,
  deferred,
} from "./collection-main.test-fixtures";

describe('StoreCollectionMainRuntime', () => {
it('routes exact same-job resume only through the explicit user entry point', async () => {
    const resumeExisting = vi.fn(async (_input: StoreCollectionExistingResumeRequest) => ({
      state: 'completed' as const,
    }));
    const port = orchestrator({ resumeExisting });
    const runtime = new StoreCollectionMainRuntime({ orchestrator: port });
    await runtime.recoverStartupThenConfirm();

    await expect(runtime.resumeExisting(resumeRequest())).resolves.toEqual({ state: 'completed' });

    expect(resumeExisting).toHaveBeenCalledOnce();
    expect(resumeExisting).toHaveBeenCalledWith(expect.objectContaining(resumeRequest()));
    const [captured] = resumeExisting.mock.calls[0]!;
    expect(Object.isFrozen(captured)).toBe(true);
    expect(Object.isFrozen(captured.context)).toBe(true);
    expect(port.manualCycle).not.toHaveBeenCalled();
    expect(port.runScheduledCycle).not.toHaveBeenCalled();
    expect(port.recoverExistingTransitionsOnly).toHaveBeenCalledOnce();
  });

it('admits only one same-job resume callback across a double click', async () => {
    const gate = deferred<{ state: 'completed' }>();
    const resumeExisting = vi.fn(() => gate.promise);
    const runtime = new StoreCollectionMainRuntime({
      orchestrator: orchestrator({ resumeExisting }),
    });
    await runtime.recoverStartupThenConfirm();

    const first = runtime.resumeExisting(resumeRequest());
    await vi.waitFor(() => expect(resumeExisting).toHaveBeenCalledOnce());
    await expect(runtime.resumeExisting(resumeRequest())).rejects.toThrow(/already held|blocked/i);
    expect(resumeExisting).toHaveBeenCalledOnce();

    gate.resolve({ state: 'completed' });
    await expect(first).resolves.toEqual({ state: 'completed' });
    expect(runtime.readStatus().mutationLane).toMatchObject({ held: false, stickyUnknown: false });
  });

it('blocks explicit resume in Package UI, startup-unknown, stopping, and lane-held states', async () => {
    const readOnlyPort = orchestrator();
    const readOnly = new StoreCollectionMainRuntime({
      orchestrator: readOnlyPort,
      packageUiReadOnly: true,
    });
    await expect(readOnly.resumeExisting(resumeRequest())).rejects.toThrow(/read-only/i);
    expect(readOnlyPort.resumeExisting).not.toHaveBeenCalled();

    const startupPort = orchestrator();
    const startupUnknown = new StoreCollectionMainRuntime({ orchestrator: startupPort });
    await expect(startupUnknown.resumeExisting(resumeRequest())).rejects.toThrow(/startup recovery/i);
    expect(startupPort.resumeExisting).not.toHaveBeenCalled();

    const drainGate = deferred<void>();
    const stoppingPort = orchestrator({ stopAndDrain: vi.fn(() => drainGate.promise) });
    const stopping = new StoreCollectionMainRuntime({ orchestrator: stoppingPort });
    await stopping.recoverStartupThenConfirm();
    const drain = stopping.stopAndDrain();
    await expect(stopping.resumeExisting(resumeRequest())).rejects.toThrow(/stopping/i);
    expect(stoppingPort.resumeExisting).not.toHaveBeenCalled();
    drainGate.resolve();
    await drain;

    const lanePort = orchestrator();
    const laneHeld = new StoreCollectionMainRuntime({ orchestrator: lanePort });
    await laneHeld.recoverStartupThenConfirm();
    const userGate = deferred<void>();
    const userMutation = laneHeld.withUserStoreMutation(
      { operation: 'stores:update', targetStoreId: 'store-one' },
      () => userGate.promise,
    );
    await vi.waitFor(() => expect(laneHeld.readStatus().mutationLane.held).toBe(true));
    await expect(laneHeld.resumeExisting(resumeRequest())).rejects.toThrow(/already held|blocked/i);
    expect(lanePort.resumeExisting).not.toHaveBeenCalled();
    userGate.resolve();
    await userMutation;
  });

it('waits for an active explicit resume and its lane release before proving drain', async () => {
    const events: string[] = [];
    const gate = deferred<{ state: 'completed' }>();
    const lane = new StoreMutationLane();
    const port = orchestrator({
      resumeExisting: vi.fn(async () => {
        events.push('resume-start');
        return gate.promise;
      }),
      stopAndDrain: vi.fn(async () => {
        events.push('orchestrator-drain');
      }),
    });
    const runtime = new StoreCollectionMainRuntime({ orchestrator: port, mutationLane: lane });
    await runtime.recoverStartupThenConfirm();
    const originalRelease = lane.release.bind(lane);
    vi.spyOn(lane, 'release').mockImplementation((claim) => {
      events.push('lane-release');
      return originalRelease(claim);
    });

    const resume = runtime.resumeExisting(resumeRequest());
    await vi.waitFor(() => expect(port.resumeExisting).toHaveBeenCalledOnce());
    const drain = runtime.stopAndDrain();
    await Promise.resolve();
    expect(runtime.readStatus()).toMatchObject({ lifecycle: 'stopping', drainProven: false });

    gate.resolve({ state: 'completed' });
    await expect(resume).resolves.toEqual({ state: 'completed' });
    await expect(drain).resolves.toBeUndefined();
    expect(events).toEqual(['resume-start', 'orchestrator-drain', 'lane-release']);
    expect(runtime.readStatus()).toMatchObject({
      lifecycle: 'stopped',
      drainProven: true,
      mutationLane: { held: false, stickyUnknown: false },
    });
  });

it('releases the lane after a durably failed resume attempt so the user may retry explicitly', async () => {
    const resumeExisting = vi.fn()
      .mockResolvedValueOnce({ state: 'completed' as const, outcome: 'failed' as const })
      .mockResolvedValueOnce({ state: 'completed' as const, outcome: 'succeeded' as const });
    const runtime = new StoreCollectionMainRuntime({
      orchestrator: orchestrator({ resumeExisting }),
    });
    await runtime.recoverStartupThenConfirm();

    await expect(runtime.resumeExisting(resumeRequest())).resolves.toMatchObject({
      state: 'completed',
      outcome: 'failed',
    });
    expect(runtime.readStatus().mutationLane).toMatchObject({ held: false, stickyUnknown: false });
    await expect(runtime.resumeExisting(resumeRequest({
      expectedJobUpdatedAt: '2026-07-30T15:06:00.000Z',
      expectedAuthorityProofSha256: 'b'.repeat(64),
    }))).resolves.toMatchObject({ state: 'completed', outcome: 'succeeded' });

    expect(resumeExisting).toHaveBeenCalledTimes(2);
  });
});

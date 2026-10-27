import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  normalizeStoreContextEnvelope,
  type LingxingCollectionJobSnapshot,
  type StoreRuntimeConfigProjection,
} from '@amazon-ai-ops/shared-types';
import {
  REPORT_TYPES,
  config,
  completeJob,
  harness,
} from "./collection-scheduler.test-fixtures";

describe('StoreCollectionOrchestratorSchedulerAdapter', () => {
it('executes one non-canary full-eight create/download request and proves its durable binding', async () => {
    const test = await harness({
      durableJob: (job) => job,
      coordinatorJob: (job) => ({
        ...job,
        reports: job.reports.map((report) => ({ ...report, errorCode: undefined })),
      }),
    });

    const projection = await test.adapter.execute(test.executeInput);

    expect(test.start).toHaveBeenCalledTimes(1);
    expect(test.start).toHaveBeenCalledWith({
      requestId: test.identity.requestId,
      storeContext: test.context,
      dateStart: test.window.dateStart,
      dateEnd: test.window.dateEnd,
      mode: 'create-and-download',
      reportTypes: REPORT_TYPES,
      canary: false,
    });
    expect(test.jobs.inspectUniqueCollectionJobForSemanticScope).toHaveBeenCalledWith({
      storeId: test.context.storeId,
      browserProfileId: test.context.browserProfileId,
      businessDate: test.context.businessDate,
      dateStart: test.window.dateStart,
      dateEnd: test.window.dateEnd,
      mode: 'create-and-download',
      reportTypes: REPORT_TYPES,
    });
    expect(projection).toMatchObject({
      state: 'accepted',
      accepted: true,
      duplicate: false,
      cycleId: 'cycle-1',
      transitionId: 'transition-1',
      fingerprint: test.fingerprint,
      attemptId: test.identity.attemptId,
      requestId: test.identity.requestId,
      authority: test.transitioned.current,
    });
    expect(projection.capability).toBe(test.executeInput.capability);
    expect(projection.transitionCapability).toBe(test.executeInput.transitionCapability);
    expect(projection.transitionScope).toBe(test.executeInput.transitionScope);

    const changed = await harness({
      durableJob: (job) => job,
      coordinatorJob: (job) => ({
        ...job,
        reports: job.reports.map((report) => ({ ...report, errorCode: 'ACTUAL_DIFFERENCE' })),
      }),
    });
    await expect(changed.adapter.execute(changed.executeInput))
      .rejects.toThrow(/coordinator result.*durable authority DB job 不一致/);
  });

it('rejects a pre-existing exact request before coordinator/browser side effects', async () => {
    const test = await harness();
    test.jobs.rows.push(completeJob({
      requestId: test.identity.requestId,
      storeContext: test.context,
      dateStart: test.window.dateStart,
      dateEnd: test.window.dateEnd,
      mode: 'create-and-download',
      reportTypes: REPORT_TYPES,
    }));

    await expect(test.adapter.execute(test.executeInput)).rejects.toThrow(/拒绝复用既有/);
    expect(test.start).not.toHaveBeenCalled();
    expect(test.jobs.inspectUniqueCollectionJobForSemanticScope).not.toHaveBeenCalled();
  });

it('blocks a history-lost exact semantic job even when its request id differs', async () => {
    const test = await harness();
    test.jobs.rows.push(completeJob({
      requestId: 'durable-request-from-an-earlier-cycle',
      storeContext: test.context,
      dateStart: test.window.dateStart,
      dateEnd: test.window.dateEnd,
      mode: 'create-and-download',
      reportTypes: REPORT_TYPES,
    }));

    await expect(test.adapter.execute(test.executeInput))
      .rejects.toThrow(/durable semantic collection scope/);
    expect(test.start).not.toHaveBeenCalled();
  });

it('performs the semantic gate immediately before start and blocks a TOCTOU insertion', async () => {
    const test = await harness();
    test.jobs.beforeSemanticInspection = () => {
      test.jobs.rows.push(completeJob({
        requestId: 'durable-request-inserted-at-second-gate',
        storeContext: test.context,
        dateStart: test.window.dateStart,
        dateEnd: test.window.dateEnd,
        mode: 'create-and-download',
        reportTypes: REPORT_TYPES,
      }));
    };

    await expect(test.adapter.execute(test.executeInput))
      .rejects.toThrow(/durable semantic collection scope/);
    expect(test.jobs.inspectUniqueCollectionJobForSemanticScope).toHaveBeenCalledTimes(1);
    expect(test.start).not.toHaveBeenCalled();
  });

it('does not suppress execution for a durable job on a different Profile axis', async () => {
    const test = await harness();
    test.jobs.rows.push(completeJob({
      requestId: 'durable-request-other-profile',
      storeContext: normalizeStoreContextEnvelope({
        ...test.context,
        browserProfileId: 'profile-other',
      }),
      dateStart: test.window.dateStart,
      dateEnd: test.window.dateEnd,
      mode: 'create-and-download',
      reportTypes: REPORT_TYPES,
    }, { jobId: 'job-other-profile' }));

    await expect(test.adapter.execute(test.executeInput)).resolves.toMatchObject({
      state: 'accepted',
    });
    expect(test.start).toHaveBeenCalledTimes(1);
  });

it('fails closed on duplicate semantic-scope ambiguity without coordinator side effects', async () => {
    const test = await harness();
    for (const [index, requestId] of [
      'durable-semantic-request-a',
      'durable-semantic-request-b',
    ].entries()) {
      test.jobs.rows.push(completeJob({
        requestId,
        storeContext: test.context,
        dateStart: test.window.dateStart,
        dateEnd: test.window.dateEnd,
        mode: 'create-and-download',
        reportTypes: REPORT_TYPES,
      }, { jobId: `durable-semantic-job-${index}` }));
    }

    await expect(test.adapter.execute(test.executeInput)).rejects.toThrow(/semantic ambiguity/);
    expect(test.start).not.toHaveBeenCalled();
  });

it('rejects forged, replayed, and scope-aliased transition capabilities', async () => {
    const replay = await harness();
    await replay.adapter.execute(replay.executeInput);
    await expect(replay.adapter.execute(replay.executeInput)).rejects.toThrow(/replayed/);

    const forged = await harness();
    await expect(forged.adapter.execute({
      ...forged.executeInput,
      transitionCapability: Object.freeze({}) as never,
    })).rejects.toThrow(/forged/);
    expect(forged.start).not.toHaveBeenCalled();

    const wrongOwner = await harness();
    await expect(wrongOwner.adapter.execute({
      ...wrongOwner.executeInput,
      owner: 'different-owner',
    })).rejects.toThrow(/owner-mismatched/);
    expect(wrongOwner.start).not.toHaveBeenCalled();

    const aliased = await harness();
    await expect(aliased.adapter.execute({
      ...aliased.executeInput,
      transitionScope: { ...aliased.executionScope },
    })).rejects.toThrow(/scope-mismatched/);
    expect(aliased.start).not.toHaveBeenCalled();
  });

it('rejects config/fingerprint drift and cross Store/Profile/Generation authority', async () => {
    const configDrift = await harness();
    configDrift.setConfig(config(configDrift.storeB.storeId, 14));
    await expect(configDrift.adapter.execute(configDrift.executeInput))
      .rejects.toThrow(/fingerprint 已漂移/);
    expect(configDrift.start).not.toHaveBeenCalled();

    for (const contextMutation of [
      { storeId: configDrift.storeA.storeId },
      { browserProfileId: configDrift.storeA.browserProfileId },
      { sessionGeneration: configDrift.context.sessionGeneration + 1 },
    ]) {
      const test = await harness();
      const context = normalizeStoreContextEnvelope({ ...test.context, ...contextMutation });
      await expect(test.adapter.execute({
        ...test.executeInput,
        context,
      })).rejects.toThrow();
      expect(test.start).not.toHaveBeenCalled();
    }

    const authorityDrift = await harness();
    authorityDrift.coordinatorAuthority.reconnectStore(authorityDrift.storeB.storeId);
    await expect(authorityDrift.adapter.execute(authorityDrift.executeInput))
      .rejects.toThrow(/stale against current Main authority/);
    expect(authorityDrift.start).not.toHaveBeenCalled();

    for (const unavailable of [
      { current: null, versions: [] } satisfies StoreRuntimeConfigProjection,
      {
        ...config(configDrift.storeB.storeId),
        current: {
          ...config(configDrift.storeB.storeId).current!,
          status: 'archived' as const,
          archivedAt: '2026-07-23T00:00:00.000Z',
        },
      },
    ]) {
      const test = await harness();
      test.setConfig(unavailable);
      await expect(test.adapter.execute(test.executeInput)).rejects.toThrow(/active runtime config/);
      expect(test.start).not.toHaveBeenCalled();
    }
  });

it('rejects canary-shaped or non-derived scheduler request identity', async () => {
    const test = await harness();
    await expect(test.adapter.execute({
      ...test.executeInput,
      requestId: `canary:${test.fingerprint}`,
    })).rejects.toThrow(/安全 cycle.*attempt.*request identity/);
    expect(test.start).not.toHaveBeenCalled();
  });

it.each([
    {
      name: 'wrong dates',
      mutate: (job: LingxingCollectionJobSnapshot) => ({
        ...job,
        request: { ...job.request, dateStart: '2026-07-01' },
      }),
    },
    {
      name: 'wrong mode',
      mutate: (job: LingxingCollectionJobSnapshot) => ({
        ...job,
        request: { ...job.request, mode: 'download-existing' as const },
      }),
    },
    {
      name: 'partial report request',
      mutate: (job: LingxingCollectionJobSnapshot) => ({
        ...job,
        request: { ...job.request, reportTypes: REPORT_TYPES.slice(0, 7) },
      }),
    },
  ])('rejects a durable $name identity', async ({ mutate }) => {
    const test = await harness({ coordinatorJob: mutate });
    await expect(test.adapter.execute(test.executeInput)).rejects.toThrow(/identity mismatch/);
  });

it('rejects coordinator-result versus durable-job disagreement', async () => {
    const test = await harness({
      durableJob: (job) => ({ ...job, importState: 'failed', importError: 'mismatch' }),
    });
    await expect(test.adapter.execute(test.executeInput))
      .rejects.toThrow(/coordinator result.*durable authority DB job 不一致/);
  });

it('fails closed on duplicate request ambiguity without coordinator side effects', async () => {
    const test = await harness();
    const job = completeJob({
      requestId: test.identity.requestId,
      storeContext: test.context,
      dateStart: test.window.dateStart,
      dateEnd: test.window.dateEnd,
      mode: 'create-and-download',
      reportTypes: REPORT_TYPES,
    });
    test.jobs.rows.push(job, { ...job, jobId: 'duplicate-job' });
    await expect(test.adapter.execute(test.executeInput)).rejects.toThrow(/ambiguity/);
    expect(test.start).not.toHaveBeenCalled();
  });
});

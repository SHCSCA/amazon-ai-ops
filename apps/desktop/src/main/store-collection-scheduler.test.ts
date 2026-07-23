import { describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  normalizeStoreContextEnvelope,
  type LingxingCollectionJobSnapshot,
  type StoreContextEnvelope,
  type StoreRuntimeConfigProjection,
} from '@amazon-ai-ops/shared-types';
import {
  StoreCollectionScheduler,
  type StoreCollectionSchedulerDependencies,
  deriveStoreCollectionWindow,
  storeCollectionScheduleSemanticFingerprint,
  storeCollectionScheduleIntegrityDigest,
  storeCollectionScheduleSettingKey,
  type StoreCollectionScheduleRecordCodec,
  type StoreCollectionScheduleSettingsPort,
} from './store-collection-scheduler';

const NOW = new Date('2026-07-23T16:00:00.000Z'); // 09:00 America/Los_Angeles

class MemorySettings implements StoreCollectionScheduleSettingsPort {
  readonly values = new Map<string, string>();
  get(key: string): string | null { return this.values.get(key) ?? null; }
  set(key: string, value: string): void { this.values.set(key, value); }
  transaction<T>(work: () => T): T { return work(); }
}

class AuthenticatedTestCodec implements StoreCollectionScheduleRecordCodec {
  isAvailable(): boolean { return true; }
  seal(plaintext: string): string {
    const payload = Buffer.from(plaintext, 'utf8').toString('base64');
    const mac = createHmac('sha256', 'deterministic-test-only-key').update(payload).digest('hex');
    return `test:v1:${mac}:${payload}`;
  }
  open(envelope: string): string {
    const match = /^test:v1:([a-f0-9]{64}):(.+)$/.exec(envelope);
    if (!match) throw new Error('invalid authenticated test envelope');
    const expected = createHmac('sha256', 'deterministic-test-only-key').update(match[2]).digest('hex');
    if (expected !== match[1]) throw new Error('authenticated test envelope was modified');
    return Buffer.from(match[2], 'base64').toString('utf8');
  }
}

function context(overrides: Partial<StoreContextEnvelope> = {}): StoreContextEnvelope {
  return normalizeStoreContextEnvelope({
    storeId: 'store-one',
    browserProfileId: 'profile-one',
    marketplace: 'US',
    currency: 'USD',
    businessTimezone: 'America/Los_Angeles',
    businessDate: '2026-07-23',
    sessionGeneration: 4,
    ...overrides,
  });
}

function config(
  activeContext: StoreContextEnvelope,
  overrides: Partial<NonNullable<StoreRuntimeConfigProjection['current']>> = {},
): StoreRuntimeConfigProjection {
  return {
    current: {
      configId: `store-config-${activeContext.storeId}`,
      storeId: activeContext.storeId,
      marketplace: 'US',
      currency: 'USD',
      businessTimezone: activeContext.businessTimezone,
      status: 'active',
      revision: 3,
      values: {
        aiRecommendationsEnabled: true,
        collectionScheduleLocalTime: '08:00',
        collectionLookbackDays: 14,
        analysisWindowDays: 30,
        defaultTargetAcosPercent: 30,
        minimumRecommendationConfidencePercent: 70,
        evidenceRetentionDays: 365,
      },
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-22T00:00:00.000Z',
      ...overrides,
    },
    versions: [],
  };
}

function completedJob(
  activeContext: StoreContextEnvelope,
  requestId: string,
  state: LingxingCollectionJobSnapshot['state'] = 'completed',
): LingxingCollectionJobSnapshot {
  return {
    jobId: `job-${requestId.slice(-12)}`,
    request: {
      requestId,
      storeContext: activeContext,
      dateStart: '2026-07-09',
      dateEnd: '2026-07-22',
      mode: 'create-and-download',
      reportTypes: [],
    },
    state,
    reports: [],
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    completedAt: NOW.toISOString(),
  };
}

function harness(options: {
  now?: Date;
  context?: StoreContextEnvelope;
  config?: StoreRuntimeConfigProjection;
  startCollection?: StoreCollectionSchedulerDependencies['startCollection'];
  settings?: MemorySettings;
  recordCodec?: StoreCollectionScheduleRecordCodec;
} = {}) {
  const activeContext = options.context ?? context();
  const currentConfig = { value: options.config ?? config(activeContext) };
  const settings = options.settings ?? new MemorySettings();
  const recordCodec = options.recordCodec ?? new AuthenticatedTestCodec();
  const assertVisibleSession = vi.fn();
  const cancelActiveCollection = vi.fn();
  const startCollection = vi.fn(options.startCollection ?? (async (input) => ({
    result: { job: completedJob(activeContext, input.requestId) },
  })));
  const scheduler = new StoreCollectionScheduler({
    authority: {
      getActiveStoreContext: () => activeContext,
      assertActiveStoreContext(value) {
        expect(value).toEqual(activeContext);
        return activeContext;
      },
    },
    config: { get: () => currentConfig.value },
    settings,
    recordCodec,
    assertVisibleSession,
    cancelActiveCollection,
    startCollection,
    now: () => options.now ?? NOW,
  });
  return {
    activeContext,
    currentConfig,
    settings,
    recordCodec,
    assertVisibleSession,
    cancelActiveCollection,
    startCollection,
    scheduler,
  };
}

function storedHistory(test: ReturnType<typeof harness>) {
  const envelope = test.settings.get(storeCollectionScheduleSettingKey(test.activeContext.storeId))!;
  return JSON.parse(test.recordCodec.open(envelope));
}

function storedAttempt(test: ReturnType<typeof harness>) {
  const history = storedHistory(test);
  return history.attempts[history.attempts.length - 1];
}

function replaceStoredAttempt(
  test: ReturnType<typeof harness>,
  mutate: (record: any) => any,
): void {
  const key = storeCollectionScheduleSettingKey(test.activeContext.storeId);
  const history = storedHistory(test);
  const last = history.attempts.length - 1;
  history.attempts[last] = mutate(history.attempts[last]);
  test.settings.set(key, test.recordCodec.seal(JSON.stringify(history)));
}

describe('StoreCollectionScheduler', () => {
  it('derives the inclusive US business-date lookback and executes with the complete active StoreContext', async () => {
    const test = harness();
    const result = await test.scheduler.reconcile(test.activeContext);

    expect(result).toMatchObject({
      storeId: 'store-one',
      businessDate: '2026-07-23',
      state: 'succeeded',
      dateStart: '2026-07-09',
      dateEnd: '2026-07-22',
      configRevision: 3,
    });
    expect(test.assertVisibleSession).toHaveBeenCalledWith(test.activeContext);
    expect(test.startCollection).toHaveBeenCalledOnce();
    expect(test.startCollection).toHaveBeenCalledWith(expect.objectContaining({
      requestId: expect.stringMatching(/^scheduled:[a-f0-9]{64}$/),
      storeContext: test.activeContext,
      dateStart: '2026-07-09',
      dateEnd: '2026-07-22',
      mode: 'create-and-download',
    }));
  });

  it('waits before the configured local time without claiming or touching the browser', async () => {
    const test = harness({ now: new Date('2026-07-23T14:59:00.000Z') }); // 07:59 PDT
    const result = await test.scheduler.reconcile(test.activeContext);

    expect(result.state).toBe('waiting');
    expect(test.assertVisibleSession).not.toHaveBeenCalled();
    expect(test.startCollection).not.toHaveBeenCalled();
    expect(test.settings.values.size).toBe(0);
  });

  it('persists the exact daily collection-semantic fingerprint before browser execution and never repeats it', async () => {
    const test = harness();
    const first = await test.scheduler.runNow(test.activeContext);
    const second = await test.scheduler.runNow(test.activeContext);

    expect(first).toMatchObject({ accepted: true, duplicate: false });
    expect(second).toMatchObject({ accepted: false, duplicate: true });
    expect(test.startCollection).toHaveBeenCalledOnce();
    const envelope = test.settings.get(storeCollectionScheduleSettingKey(test.activeContext.storeId))!;
    expect(envelope).not.toContain('store-one');
    const stored = storedAttempt(test);
    expect(stored).toMatchObject({
      storeId: 'store-one',
      businessDate: '2026-07-23',
      scheduleLocalTime: '08:00',
      configRevision: 3,
      lookbackDays: 14,
      state: 'succeeded',
    });
    expect(stored.fingerprint).toBe(storeCollectionScheduleSemanticFingerprint({
      storeId: test.activeContext.storeId,
      browserProfileId: test.activeContext.browserProfileId,
      businessDate: test.activeContext.businessDate,
      lookbackDays: 14,
      dateStart: '2026-07-09',
      dateEnd: '2026-07-22',
    }));
    expect(stored.integrityDigest).toBe(storeCollectionScheduleIntegrityDigest(stored));
  });

  it('retains A to B to A semantic history so archive/restore cannot rerun the original same-day window', async () => {
    const test = harness();
    await test.scheduler.reconcile(test.activeContext);
    test.currentConfig.value = config(test.activeContext, {
      revision: 4,
      values: { ...test.currentConfig.value.current!.values, collectionLookbackDays: 7 },
    });
    await test.scheduler.reconcile(test.activeContext);
    expect(test.startCollection).toHaveBeenCalledTimes(2);
    expect(test.startCollection.mock.calls[1][0]).toMatchObject({
      storeContext: test.activeContext,
      dateStart: '2026-07-16',
      dateEnd: '2026-07-22',
    });

    test.currentConfig.value = config(test.activeContext, { revision: 5, status: 'archived' });
    expect((await test.scheduler.reconcile(test.activeContext)).state).toBe('archived');
    expect(test.startCollection).toHaveBeenCalledTimes(2);

    test.currentConfig.value = config(test.activeContext, { revision: 6, status: 'active' });
    await test.scheduler.reconcile(test.activeContext);
    expect(test.startCollection).toHaveBeenCalledTimes(2);
    expect(storedHistory(test).attempts).toHaveLength(2);
  });

  it('does not rerun after an unrelated config patch changes only the audit revision', async () => {
    const test = harness();
    await test.scheduler.reconcile(test.activeContext);
    const original = test.currentConfig.value.current!;
    test.currentConfig.value = config(test.activeContext, {
      revision: 4,
      values: {
        ...original.values,
        evidenceRetentionDays: original.values.evidenceRetentionDays + 30,
        minimumRecommendationConfidencePercent:
          original.values.minimumRecommendationConfidencePercent + 5,
      },
    });

    expect(await test.scheduler.reconcile(test.activeContext)).toMatchObject({
      state: 'succeeded',
      configRevision: 4,
      lastAttempt: { configRevision: 3 },
    });
    expect(test.startCollection).toHaveBeenCalledOnce();
    expect(storedHistory(test).attempts).toHaveLength(1);
  });

  it('does not rerun the same business-effect window when only the trigger time changes', async () => {
    const test = harness();
    await test.scheduler.reconcile(test.activeContext);
    const original = test.currentConfig.value.current!;
    test.currentConfig.value = config(test.activeContext, {
      revision: 4,
      values: {
        ...original.values,
        collectionScheduleLocalTime: '08:01',
      },
    });

    expect(await test.scheduler.reconcile(test.activeContext)).toMatchObject({
      state: 'succeeded',
      configRevision: 4,
      scheduleLocalTime: '08:01',
      lastAttempt: {
        configRevision: 3,
        scheduleLocalTime: '08:00',
      },
    });
    expect(test.startCollection).toHaveBeenCalledOnce();
    expect(storedHistory(test).attempts).toHaveLength(1);
  });

  it('requires the visible generation-matched session before writing the idempotency claim', async () => {
    const test = harness();
    test.assertVisibleSession.mockImplementation(() => {
      throw new Error('VISIBLE_SESSION_REQUIRED');
    });

    await expect(test.scheduler.runNow(test.activeContext)).rejects.toThrow('VISIBLE_SESSION_REQUIRED');
    expect(test.startCollection).not.toHaveBeenCalled();
    expect(test.settings.values.size).toBe(0);
  });

  it('fails closed after a claimed external failure and does not automatically retry the same fingerprint', async () => {
    const startCollection: StoreCollectionSchedulerDependencies['startCollection'] = async () => {
      throw Object.assign(new Error('provider failure'), { code: 'PROVIDER_FAILED' });
    };
    const test = harness({ startCollection });

    await expect(test.scheduler.runNow(test.activeContext)).rejects.toThrow('provider failure');
    const repeated = await test.scheduler.runNow(test.activeContext);
    expect(repeated).toMatchObject({ accepted: false, duplicate: true });
    expect(test.startCollection).toHaveBeenCalledOnce();
    expect(repeated.projection.lastAttempt).toMatchObject({
      state: 'failed',
      failureCode: 'PROVIDER_FAILED',
    });
  });

  it('records completed_with_errors as failed and never presents a partial collection as success', async () => {
    const activeContext = context();
    const startCollection: StoreCollectionSchedulerDependencies['startCollection'] = async (input) => ({
      result: { job: completedJob(activeContext, input.requestId, 'completed_with_errors') },
    });
    const test = harness({ context: activeContext, startCollection });

    const result = await test.scheduler.runNow(activeContext);
    expect(result).toMatchObject({
      accepted: true,
      duplicate: false,
      projection: {
        state: 'failed',
        lastAttempt: {
          state: 'failed',
          failureCode: 'COLLECTION_COMPLETED_WITH_ERRORS',
        },
      },
      job: { state: 'completed_with_errors' },
    });
    expect((await test.scheduler.runNow(activeContext)).duplicate).toBe(true);
    expect(test.startCollection).toHaveBeenCalledOnce();
  });

  it('fails manual execution when the timezone clock no longer matches the captured business date', async () => {
    const staleContext = context({ businessDate: '2026-07-22' as StoreContextEnvelope['businessDate'] });
    const test = harness({ context: staleContext, config: config(staleContext) });

    await expect(test.scheduler.runNow(staleContext)).rejects.toThrow(/业务日不一致/);
    expect(test.assertVisibleSession).not.toHaveBeenCalled();
    expect(test.startCollection).not.toHaveBeenCalled();
    expect(test.settings.values.size).toBe(0);
  });

  it('fails closed for corrupt persisted identity instead of creating another provider request', async () => {
    const test = harness();
    test.settings.set(
      storeCollectionScheduleSettingKey(test.activeContext.storeId),
      test.recordCodec.seal('{"schemaVersion":1}'),
    );

    await expect(test.scheduler.runNow(test.activeContext)).rejects.toThrow(/幂等记录身份无效/);
    expect(test.startCollection).not.toHaveBeenCalled();
  });

  it.each([
    ['recomputed fingerprint', (record: any) => ({ ...record, fingerprint: 'a'.repeat(64), requestId: `scheduled:${'a'.repeat(64)}` })],
    ['browser Profile', (record: any) => ({ ...record, browserProfileId: 'profile-two' })],
    ['trigger', (record: any) => ({ ...record, trigger: 'automatic-magic' })],
    ['claimed timestamp', (record: any) => ({ ...record, claimedAt: 'not-an-iso-time' })],
    ['terminal timestamp order', (record: any) => ({ ...record, completedAt: '2026-07-22T00:00:00.000Z' })],
    ['terminal state fields', (record: any) => ({ ...record, state: 'succeeded', failureCode: 'SHOULD_NOT_EXIST' })],
  ])('rejects a stored attempt with invalid %s authority', async (_label, mutate) => {
    const test = harness();
    await test.scheduler.runNow(test.activeContext);
    replaceStoredAttempt(test, mutate);

    await expect(test.scheduler.runNow(test.activeContext)).rejects.toThrow(/幂等记录身份无效/);
    expect(test.startCollection).toHaveBeenCalledOnce();
  });

  it('atomically closes a previous-process claim as INTERRUPTED and never retries it', async () => {
    let signalStarted!: () => void;
    let finish!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const first = harness({
      startCollection: async (input) => {
        signalStarted();
        await gate;
        return { result: { job: completedJob(context(), input.requestId) } };
      },
    });
    const abandonedRun = first.scheduler.runNow(first.activeContext);
    await started;
    expect(storedAttempt(first).state).toBe('claimed');

    const restarted = harness({
      context: first.activeContext,
      settings: first.settings,
      recordCodec: first.recordCodec,
    });
    const recovered = await restarted.scheduler.reconcile(first.activeContext);
    expect(recovered).toMatchObject({
      state: 'failed',
      lastAttempt: { state: 'failed', failureCode: 'INTERRUPTED' },
    });
    expect(restarted.startCollection).not.toHaveBeenCalled();
    expect(await restarted.scheduler.runNow(first.activeContext)).toMatchObject({
      accepted: false,
      duplicate: true,
      projection: { state: 'failed' },
    });

    finish();
    await expect(abandonedRun).rejects.toThrow(/认领已被替换/);
  });

  it('does not kill or duplicate a live claim owned by the same scheduler process', async () => {
    let signalStarted!: () => void;
    let finish!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const test = harness({
      startCollection: async (input) => {
        signalStarted();
        await gate;
        return { result: { job: completedJob(context(), input.requestId) } };
      },
    });
    const activeRun = test.scheduler.runNow(test.activeContext);
    await started;

    expect(await test.scheduler.reconcile(test.activeContext)).toMatchObject({ state: 'claimed' });
    expect(test.startCollection).toHaveBeenCalledOnce();
    finish();
    await expect(activeRun).resolves.toMatchObject({ projection: { state: 'succeeded' } });
  });

  it('terminalizes active claims before shutdown and drains without allowing a late database write', async () => {
    let signalStarted!: () => void;
    let finish!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const test = harness({
      startCollection: async (input) => {
        signalStarted();
        await gate;
        return { result: { job: completedJob(context(), input.requestId) } };
      },
    });
    const activeRun = test.scheduler.runNow(test.activeContext);
    const activeRunOutcome = activeRun.catch((error) => error);
    await started;

    let drained = false;
    const terminalWrite = vi.spyOn(test.settings, 'set');
    const drain = test.scheduler.stopAndDrain(1_000).then(() => { drained = true; });
    await Promise.resolve();
    expect(drained).toBe(false);
    expect(test.cancelActiveCollection).toHaveBeenCalledWith({
      requestId: expect.stringMatching(/^manual:[a-f0-9]{64}$/),
      storeId: test.activeContext.storeId,
    });
    expect(test.cancelActiveCollection.mock.invocationCallOrder[0])
      .toBeLessThan(terminalWrite.mock.invocationCallOrder[0]);
    expect(storedAttempt(test)).toMatchObject({
      state: 'failed',
      failureCode: 'APP_EXIT_INTERRUPTED',
    });

    finish();
    await drain;
    expect(await activeRunOutcome).toMatchObject({ code: 'SCHEDULER_STOPPING' });
    expect(storedAttempt(test)).toMatchObject({
      state: 'failed',
      failureCode: 'APP_EXIT_INTERRUPTED',
    });
    await expect(test.scheduler.runNow(test.activeContext)).rejects.toMatchObject({
      code: 'SCHEDULER_STOPPING',
    });
  });

  it('does not write another scheduler terminal when a stubborn cancelled runner completes after drain timeout', async () => {
    let signalStarted!: () => void;
    let finish!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const test = harness({
      startCollection: async (input) => {
        signalStarted();
        await gate;
        return { result: { job: completedJob(context(), input.requestId) } };
      },
    });
    const activeRun = test.scheduler.runNow(test.activeContext);
    const activeRunOutcome = activeRun.catch((error) => error);
    await started;
    const terminalWrite = vi.spyOn(test.settings, 'set');

    await test.scheduler.stopAndDrain(0);
    const writesAfterDrain = terminalWrite.mock.calls.length;
    expect(test.cancelActiveCollection).toHaveBeenCalledOnce();
    expect(storedAttempt(test)).toMatchObject({
      state: 'failed',
      failureCode: 'APP_EXIT_INTERRUPTED',
    });

    finish();
    expect(await activeRunOutcome).toMatchObject({ code: 'SCHEDULER_STOPPING' });
    expect(terminalWrite).toHaveBeenCalledTimes(writesAfterDrain);
    expect(storedAttempt(test)).toMatchObject({
      state: 'failed',
      failureCode: 'APP_EXIT_INTERRUPTED',
    });
  });

  it('does not rerun a successful same-day/profile attempt after session generation reconnects', async () => {
    const first = harness();
    await first.scheduler.runNow(first.activeContext);
    const reconnectedContext = context({ sessionGeneration: 5 });
    const reconnected = harness({
      context: reconnectedContext,
      settings: first.settings,
      recordCodec: first.recordCodec,
    });

    expect(await reconnected.scheduler.runNow(reconnectedContext)).toMatchObject({
      accepted: false,
      duplicate: true,
      projection: { state: 'succeeded' },
    });
    expect(reconnected.startCollection).not.toHaveBeenCalled();
  });

  it('rejects a re-sealed record whose derived window no longer matches its bound config', async () => {
    const test = harness();
    await test.scheduler.runNow(test.activeContext);
    const record = storedAttempt(test);
    const forgedFingerprint = storeCollectionScheduleSemanticFingerprint({
      storeId: record.storeId,
      browserProfileId: record.browserProfileId,
      businessDate: record.businessDate,
      lookbackDays: record.lookbackDays,
      dateStart: '2026-07-10',
      dateEnd: record.dateEnd,
    });
    const { integrityDigest: _oldDigest, ...forgedBase } = {
      ...record,
      fingerprint: forgedFingerprint,
      requestId: `${record.trigger}:${forgedFingerprint}`,
      dateStart: '2026-07-10',
    };
    const forged = {
      ...forgedBase,
      integrityDigest: storeCollectionScheduleIntegrityDigest(forgedBase),
    };
    replaceStoredAttempt(test, () => forged);

    await expect(test.scheduler.runNow(test.activeContext)).rejects.toThrow(/幂等记录身份无效/);
    expect(test.startCollection).toHaveBeenCalledOnce();
  });

  it('fails closed when the authenticated Main persistence codec is unavailable or modified', async () => {
    const unavailable = harness({
      recordCodec: {
        isAvailable: () => false,
        seal: () => { throw new Error('unavailable'); },
        open: () => { throw new Error('unavailable'); },
      },
    });
    await expect(unavailable.scheduler.runNow(unavailable.activeContext)).rejects.toThrow(/安全存储不可用/);
    expect(unavailable.startCollection).not.toHaveBeenCalled();

    const test = harness();
    await test.scheduler.runNow(test.activeContext);
    const key = storeCollectionScheduleSettingKey(test.activeContext.storeId);
    const envelope = test.settings.get(key)!;
    test.settings.set(key, `${envelope.slice(0, -1)}${envelope.endsWith('A') ? 'B' : 'A'}`);
    await expect(test.scheduler.runNow(test.activeContext)).rejects.toThrow(/幂等记录损坏/);
  });

  it('validates date arithmetic and fingerprint domain inputs', () => {
    expect(deriveStoreCollectionWindow('2026-03-01', 2)).toEqual({
      dateStart: '2026-02-27',
      dateEnd: '2026-02-28',
    });
    expect(() => deriveStoreCollectionWindow('2026-02-30', 14)).toThrow(/invalid/);
    expect(() => storeCollectionScheduleSemanticFingerprint({
      storeId: context().storeId,
      browserProfileId: context().browserProfileId,
      businessDate: '2026-02-30',
      lookbackDays: 14,
      dateStart: '2026-07-09',
      dateEnd: '2026-07-22',
    })).toThrow(/invalid/);
  });
});

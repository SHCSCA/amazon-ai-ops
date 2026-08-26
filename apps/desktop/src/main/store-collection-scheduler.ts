import { createHash } from 'crypto';
import type {
  LingxingCollectionJobSnapshot,
  StoreCollectionScheduleAttempt,
  StoreCollectionScheduleProjection,
  StoreCollectionScheduleRunResult,
  StoreCollectionScheduleTrigger,
  StoreContextEnvelope,
  StoreId,
  StoreRecord,
  StoreRuntimeConfigProjection,
  StoreRuntimeConfigRecord,
} from '@amazon-ai-ops/shared-types';
import { normalizeStoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import type { StartLingxingCollectionInput } from './lingxing-collection-coordinator';
import { deriveStoreCollectionWindow } from './store-collection-window';

export { deriveStoreCollectionWindow } from './store-collection-window';

const CLOCK_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const FINGERPRINT = /^[a-f0-9]{64}$/;
const DEFAULT_POLL_INTERVAL_MS = 30_000;
const STORE_COLLECTION_CONTRACT_VERSION = 'lingxing-us-ads-full8-v1';

interface StoreCollectionScheduleHistory {
  schemaVersion: 2;
  storeId: StoreId;
  browserProfileId: string;
  attempts: StoreCollectionScheduleAttempt[];
}

export class StoreCollectionSchedulerError extends Error {
  constructor(
    readonly code:
      | 'NO_ACTIVE_STORE'
      | 'CONFIG_UNAVAILABLE'
      | 'UNSUPPORTED_STORE'
      | 'VISIBLE_SESSION_REQUIRED'
      | 'CONFIG_CHANGED'
      | 'COLLECTION_IN_PROGRESS'
      | 'SCHEDULER_STOPPING'
      | 'PERSISTENCE_PROTECTION_UNAVAILABLE'
      | 'CORRUPT_PERSISTENCE',
    message: string,
  ) {
    super(message);
    this.name = 'StoreCollectionSchedulerError';
  }
}

export interface StoreCollectionScheduleSettingsPort {
  get(key: string): string | null | undefined;
  set(key: string, value: string): unknown;
  transaction<T>(work: () => T): T;
}

/** Main-only authenticated persistence boundary (Electron safeStorage in production). */
export interface StoreCollectionScheduleRecordCodec {
  isAvailable(): boolean;
  seal(plaintext: string): string;
  open(envelope: string): string;
}

export interface StoreCollectionScheduleInspection {
  state: 'due' | 'not_due';
  expectedFingerprint?: string;
}

export interface StoreCollectionSchedulerDependencies {
  authority: {
    getActiveStoreContext(): StoreContextEnvelope | null;
    assertActiveStoreContext(value: unknown): StoreContextEnvelope;
  };
  config: {
    get(context: StoreContextEnvelope): StoreRuntimeConfigProjection;
    getForStoreRecord(store: StoreRecord): StoreRuntimeConfigProjection;
  };
  settings: StoreCollectionScheduleSettingsPort;
  recordCodec: StoreCollectionScheduleRecordCodec;
  assertVisibleSession(context: StoreContextEnvelope): void;
  cancelActiveCollection(input: { requestId: string; storeId: StoreId }): void;
  startCollection(input: StartLingxingCollectionInput): Promise<{
    result: { job: LingxingCollectionJobSnapshot };
  }>;
  now?: () => Date;
  pollIntervalMs?: number;
  setInterval?: (callback: () => void, milliseconds: number) => ReturnType<typeof setInterval>;
  clearInterval?: (timer: ReturnType<typeof setInterval>) => void;
  onChanged?: (projection: StoreCollectionScheduleProjection) => void;
  onError?: (error: unknown) => void;
}

/**
 * Main-only schedule authority. It never switches stores or opens a browser;
 * every run is bound to the currently active StoreContext and an already-
 * visible, generation-matched browser session.
 */
export class StoreCollectionScheduler {
  private readonly now: () => Date;
  private readonly pollIntervalMs: number;
  private readonly createInterval: NonNullable<StoreCollectionSchedulerDependencies['setInterval']>;
  private readonly cancelInterval: NonNullable<StoreCollectionSchedulerDependencies['clearInterval']>;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly inFlightFingerprints = new Set<string>();
  private readonly activeRuns = new Set<Promise<StoreCollectionScheduleRunResult>>();
  private readonly activeAttempts = new Map<string, {
    attempt: StoreCollectionScheduleAttempt;
    context: StoreContextEnvelope;
    config: StoreRuntimeConfigRecord;
  }>();
  private stopping = false;

  constructor(private readonly dependencies: StoreCollectionSchedulerDependencies) {
    this.now = dependencies.now ?? (() => new Date());
    this.pollIntervalMs = dependencies.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.createInterval = dependencies.setInterval ?? ((callback, milliseconds) => setInterval(callback, milliseconds));
    this.cancelInterval = dependencies.clearInterval ?? ((timer) => clearInterval(timer));
    if (!Number.isFinite(this.pollIntervalMs) || this.pollIntervalMs < 1_000) {
      throw new RangeError('store collection scheduler poll interval must be at least 1000ms');
    }
  }

  start(): void {
    if (this.stopping) {
      throw new StoreCollectionSchedulerError('SCHEDULER_STOPPING', '店铺采集调度已进入关闭流程。');
    }
    if (this.timer) return;
    this.timer = this.createInterval(() => {
      void this.reconcileCurrent().catch((error) => this.dependencies.onError?.(error));
    }, this.pollIntervalMs);
    (this.timer as ReturnType<typeof setInterval> & { unref?: () => void }).unref?.();
    void this.reconcileCurrent().catch((error) => this.dependencies.onError?.(error));
  }

  stop(): void {
    if (!this.timer) return;
    this.cancelInterval(this.timer);
    this.timer = null;
  }

  async stopAndDrain(timeoutMs = 5_000): Promise<void> {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
      throw new RangeError('store collection scheduler drain timeout must be non-negative');
    }
    this.stop();
    this.stopping = true;

    for (const { attempt, context, config } of [...this.activeAttempts.values()]) {
      if (!this.inFlightFingerprints.has(attempt.fingerprint)) continue;
      this.dependencies.cancelActiveCollection({
        requestId: attempt.requestId,
        storeId: attempt.storeId,
      });
      const interrupted = this.complete(attempt, 'failed', 'APP_EXIT_INTERRUPTED');
      this.inFlightFingerprints.delete(attempt.fingerprint);
      this.publish(this.projectionForAttempt(context, config, interrupted));
    }

    const active = [...this.activeRuns];
    if (active.length === 0 || timeoutMs === 0) return;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.allSettled(active).then(() => undefined),
        new Promise<void>((resolve) => {
          timeout = setTimeout(resolve, timeoutMs);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  get(contextInput: StoreContextEnvelope): StoreCollectionScheduleProjection {
    const context = this.authorize(contextInput);
    return this.inspect(context, this.now());
  }

  /**
   * Pure Main-only inspection for orchestration across every active store. It
   * never binds/switches active UI authority, repairs history, opens a browser,
   * or writes scheduler state.
   */
  inspectForStore(
    storeInput: StoreRecord,
    timing: { businessDate: string; now?: Date },
  ): StoreCollectionScheduleInspection {
    const context = inspectionContextForStore(storeInput, timing?.businessDate);
    const configProjection = this.dependencies.config.getForStoreRecord(storeInput);
    const current = configProjection.current;
    if (!current || current.status === 'archived') return { state: 'not_due' };
    assertConfigIdentity(context, current);
    const window = deriveStoreCollectionWindow(
      context.businessDate,
      current.values.collectionLookbackDays,
    );
    const fingerprint = storeCollectionScheduleSemanticFingerprint({
      storeId: context.storeId,
      browserProfileId: context.browserProfileId,
      businessDate: context.businessDate,
      lookbackDays: current.values.collectionLookbackDays,
      ...window,
    });
    const history = this.readHistory(context, current);
    if (history.attempts.some((attempt) => attempt.fingerprint === fingerprint)) {
      return { state: 'not_due', expectedFingerprint: fingerprint };
    }
    const now = timing.now ?? this.now();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new StoreCollectionSchedulerError('CONFIG_UNAVAILABLE', '采集检查时钟无效。');
    }
    const clock = localBusinessClock(now, context.businessTimezone);
    if (clock.businessDate !== context.businessDate) {
      throw new StoreCollectionSchedulerError(
        'CONFIG_UNAVAILABLE',
        '调度时钟与指定店铺业务日不一致，已失败关闭。',
      );
    }
    return {
      state: clock.localTime >= current.values.collectionScheduleLocalTime ? 'due' : 'not_due',
      expectedFingerprint: fingerprint,
    };
  }

  async reconcileCurrent(): Promise<StoreCollectionScheduleProjection | null> {
    const context = this.dependencies.authority.getActiveStoreContext();
    if (!context) return null;
    return this.reconcile(context);
  }

  async reconcile(contextInput: StoreContextEnvelope): Promise<StoreCollectionScheduleProjection> {
    const context = this.authorize(contextInput);
    const projection = this.inspect(context, this.now());
    if (projection.state !== 'due' || this.stopping) return projection;
    const result = await this.execute(context, 'scheduled');
    return result.projection;
  }

  async runNow(contextInput: StoreContextEnvelope): Promise<StoreCollectionScheduleRunResult> {
    if (this.stopping) {
      throw new StoreCollectionSchedulerError('SCHEDULER_STOPPING', '店铺采集调度已进入关闭流程。');
    }
    const context = this.authorize(contextInput);
    const projection = this.inspect(context, this.now());
    if (projection.lastAttempt?.fingerprint === projection.fingerprint) {
      return { accepted: false, duplicate: true, projection };
    }
    return this.execute(context, 'manual');
  }

  private execute(
    context: StoreContextEnvelope,
    trigger: StoreCollectionScheduleTrigger,
  ): Promise<StoreCollectionScheduleRunResult> {
    if (this.stopping) {
      return Promise.reject(new StoreCollectionSchedulerError(
        'SCHEDULER_STOPPING',
        '店铺采集调度已进入关闭流程。',
      ));
    }
    const run = this.executeTracked(context, trigger);
    this.activeRuns.add(run);
    void run.finally(() => this.activeRuns.delete(run)).catch(() => undefined);
    return run;
  }

  private async executeTracked(
    context: StoreContextEnvelope,
    trigger: StoreCollectionScheduleTrigger,
  ): Promise<StoreCollectionScheduleRunResult> {
    const authorized = this.authorize(context);
    this.assertCurrentBusinessDate(authorized, this.now());
    const config = this.requireActiveConfig(authorized);
    this.dependencies.assertVisibleSession(authorized);
    const window = deriveStoreCollectionWindow(authorized.businessDate, config.values.collectionLookbackDays);
    const fingerprint = storeCollectionScheduleSemanticFingerprint({
      storeId: authorized.storeId,
      browserProfileId: authorized.browserProfileId,
      businessDate: authorized.businessDate,
      lookbackDays: config.values.collectionLookbackDays,
      ...window,
    });
    const claimedAt = this.now().toISOString();
    const requestId = `${trigger}:${fingerprint}`;
    const attempt = withStoreCollectionScheduleIntegrity({
      schemaVersion: 1,
      fingerprint,
      storeId: authorized.storeId,
      browserProfileId: authorized.browserProfileId,
      sessionGeneration: authorized.sessionGeneration,
      businessDate: authorized.businessDate,
      scheduleLocalTime: config.values.collectionScheduleLocalTime,
      configRevision: config.revision,
      lookbackDays: config.values.collectionLookbackDays,
      ...window,
      requestId,
      trigger,
      state: 'claimed',
      claimedAt,
    });
    const claimed = this.claim(attempt);
    if (!claimed) {
      const projection = this.inspect(authorized, this.now());
      return { accepted: false, duplicate: true, projection };
    }
    this.activeAttempts.set(attempt.fingerprint, { attempt, context: authorized, config });
    this.publish(this.projectionForAttempt(authorized, config, attempt));

    try {
      const currentContext = this.authorize(authorized);
      this.dependencies.assertVisibleSession(currentContext);
      const currentConfig = this.requireActiveConfig(currentContext);
      const currentWindow = deriveStoreCollectionWindow(
        currentContext.businessDate,
        currentConfig.values.collectionLookbackDays,
      );
      const currentSemanticFingerprint = storeCollectionScheduleSemanticFingerprint({
        storeId: currentContext.storeId,
        browserProfileId: currentContext.browserProfileId,
        businessDate: currentContext.businessDate,
        lookbackDays: currentConfig.values.collectionLookbackDays,
        ...currentWindow,
      });
      if (currentSemanticFingerprint !== attempt.fingerprint) {
        throw new StoreCollectionSchedulerError(
          'CONFIG_CHANGED',
          '店铺采集配置在调度认领后发生变化；旧任务已失败关闭。',
        );
      }
      const output = await this.dependencies.startCollection({
        requestId,
        storeContext: currentContext,
        dateStart: window.dateStart,
        dateEnd: window.dateEnd,
        mode: 'create-and-download',
      });
      if (this.stopping) {
        throw new StoreCollectionSchedulerError(
          'SCHEDULER_STOPPING',
          '应用关闭期间采集任务已中断，不再写入异步终态。',
        );
      }
      const successful = output.result.job.state === 'completed';
      const terminal = this.complete(attempt, successful ? 'succeeded' : 'failed', successful
        ? undefined
        : `COLLECTION_${output.result.job.state.toUpperCase()}`);
      const projection = this.projectionForAttempt(currentContext, currentConfig, terminal);
      this.publish(projection);
      return {
        accepted: true,
        duplicate: false,
        projection,
        job: output.result.job,
      };
    } catch (error) {
      if (this.stopping || !this.inFlightFingerprints.has(attempt.fingerprint)) {
        throw error;
      }
      const terminal = this.complete(attempt, 'failed', safeFailureCode(error));
      this.publish(this.projectionForAttempt(authorized, config, terminal));
      throw error;
    } finally {
      this.inFlightFingerprints.delete(attempt.fingerprint);
      this.activeAttempts.delete(attempt.fingerprint);
    }
  }

  private authorize(context: StoreContextEnvelope): StoreContextEnvelope {
    const authorized = this.dependencies.authority.assertActiveStoreContext(context);
    if (authorized.marketplace !== 'US' || authorized.currency !== 'USD') {
      throw new StoreCollectionSchedulerError(
        'UNSUPPORTED_STORE',
        '店铺采集调度第一版只支持 Amazon US / USD。',
      );
    }
    return authorized;
  }

  private inspect(context: StoreContextEnvelope, now: Date): StoreCollectionScheduleProjection {
    const configProjection = this.dependencies.config.get(context);
    const current = configProjection.current;
    if (!current) {
      return disabledProjection(context, 'not_configured', '当前店铺尚未创建运行配置。');
    }
    assertConfigIdentity(context, current);
    if (current.status === 'archived') {
      return disabledProjection(context, 'archived', '当前店铺运行配置已归档，采集调度已停止。');
    }
    const window = deriveStoreCollectionWindow(context.businessDate, current.values.collectionLookbackDays);
    const fingerprint = storeCollectionScheduleSemanticFingerprint({
      storeId: context.storeId,
      browserProfileId: context.browserProfileId,
      businessDate: context.businessDate,
      lookbackDays: current.values.collectionLookbackDays,
      ...window,
    });
    const history = this.recoverInterruptedAttempts(context, current);
    const semanticAttempt = history.attempts.find((attempt) => attempt.fingerprint === fingerprint);
    if (semanticAttempt) {
      return this.projectionForAttempt(context, current, semanticAttempt);
    }
    const lastAttempt = history.attempts[history.attempts.length - 1];
    const clock = localBusinessClock(now, context.businessTimezone);
    if (clock.businessDate !== context.businessDate) {
      throw new StoreCollectionSchedulerError(
        'CONFIG_UNAVAILABLE',
        '调度时钟与当前店铺业务日不一致，已失败关闭。',
      );
    }
    const due = clock.localTime >= current.values.collectionScheduleLocalTime;
    return {
      storeId: context.storeId,
      businessDate: context.businessDate,
      enabled: true,
      state: due ? 'due' : 'waiting',
      detail: due ? '已到当前店铺配置的采集时间。' : '等待当前店铺配置的采集时间。',
      scheduleLocalTime: current.values.collectionScheduleLocalTime,
      configRevision: current.revision,
      ...window,
      fingerprint,
      ...(lastAttempt ? { lastAttempt } : {}),
    };
  }

  private requireActiveConfig(context: StoreContextEnvelope): StoreRuntimeConfigRecord {
    const current = this.dependencies.config.get(context).current;
    if (!current || current.status !== 'active') {
      throw new StoreCollectionSchedulerError(
        'CONFIG_UNAVAILABLE',
        '当前店铺没有可执行的活动采集配置。',
      );
    }
    assertConfigIdentity(context, current);
    return current;
  }

  private claim(attempt: StoreCollectionScheduleAttempt): boolean {
    return this.dependencies.settings.transaction(() => {
      const history = this.readHistory(attempt);
      if (history.attempts.some((existing) => existing.fingerprint === attempt.fingerprint)) return false;
      if (history.attempts.some((existing) => existing.state === 'claimed')) {
        throw new StoreCollectionSchedulerError(
          'COLLECTION_IN_PROGRESS',
          '当前店铺已有采集任务执行中；配置变更不会并发启动第二个任务。',
        );
      }
      this.writeHistory({
        ...history,
        attempts: [...history.attempts, attempt],
      });
      this.inFlightFingerprints.add(attempt.fingerprint);
      return true;
    });
  }

  private complete(
    claimed: StoreCollectionScheduleAttempt,
    state: 'succeeded' | 'failed',
    failureCode?: string,
  ): StoreCollectionScheduleAttempt {
    return this.dependencies.settings.transaction(() => {
      const history = this.readHistory(claimed);
      const attemptIndex = history.attempts.findIndex(
        (attempt) => attempt.fingerprint === claimed.fingerprint,
      );
      const current = history.attempts[attemptIndex];
      if (!current
        || attemptIndex < 0
        || current.fingerprint !== claimed.fingerprint
        || current.state !== 'claimed'
        || current.integrityDigest !== claimed.integrityDigest) {
        throw new StoreCollectionSchedulerError(
          'CORRUPT_PERSISTENCE',
          '采集调度幂等认领已被替换，拒绝写入终态。',
        );
      }
      const completed = withStoreCollectionScheduleIntegrity({
        ...current,
        integrityDigest: undefined,
        state,
        completedAt: this.now().toISOString(),
        ...(failureCode ? { failureCode } : {}),
      });
      const attempts = [...history.attempts];
      attempts[attemptIndex] = completed;
      this.writeHistory({ ...history, attempts });
      return completed;
    });
  }

  private readHistory(
    context: { storeId: StoreId; browserProfileId: string },
    currentConfig?: StoreRuntimeConfigRecord,
  ): StoreCollectionScheduleHistory {
    const raw = this.dependencies.settings.get(storeCollectionScheduleSettingKey(context.storeId));
    if (!raw) {
      return {
        schemaVersion: 2,
        storeId: context.storeId,
        browserProfileId: context.browserProfileId,
        attempts: [],
      };
    }
    try {
      this.assertPersistenceProtectionAvailable();
      const plaintext = this.dependencies.recordCodec.open(raw);
      const parsed = JSON.parse(plaintext) as StoreCollectionScheduleHistory;
      assertStoredHistory(parsed, context, currentConfig);
      return parsed;
    } catch (error) {
      if (error instanceof StoreCollectionSchedulerError) throw error;
      throw new StoreCollectionSchedulerError(
        'CORRUPT_PERSISTENCE',
        '店铺采集调度幂等记录损坏，已失败关闭。',
      );
    }
  }

  private writeHistory(history: StoreCollectionScheduleHistory): void {
    this.assertPersistenceProtectionAvailable();
    const plaintext = JSON.stringify(history);
    let envelope = '';
    try {
      envelope = this.dependencies.recordCodec.seal(plaintext);
    } catch {
      envelope = '';
    }
    if (!envelope || envelope === plaintext) {
      throw new StoreCollectionSchedulerError(
        'PERSISTENCE_PROTECTION_UNAVAILABLE',
        '店铺采集调度安全存储不可用，已拒绝持久化认领。',
      );
    }
    this.dependencies.settings.set(
      storeCollectionScheduleSettingKey(history.storeId),
      envelope,
    );
  }

  private recoverInterruptedAttempts(
    context: StoreContextEnvelope,
    currentConfig: StoreRuntimeConfigRecord,
  ): StoreCollectionScheduleHistory {
    return this.dependencies.settings.transaction(() => {
      const history = this.readHistory(context, currentConfig);
      let changed = false;
      const attempts = history.attempts.map((existing) => {
        if (existing.state !== 'claimed' || this.inFlightFingerprints.has(existing.fingerprint)) {
          return existing;
        }
        changed = true;
        return withStoreCollectionScheduleIntegrity({
          ...existing,
          integrityDigest: undefined,
          state: 'failed',
          completedAt: this.now().toISOString(),
          failureCode: 'INTERRUPTED',
        });
      });
      if (!changed) {
        return history;
      }
      const recovered = { ...history, attempts };
      this.writeHistory(recovered);
      return recovered;
    });
  }

  private assertPersistenceProtectionAvailable(): void {
    let available = false;
    try {
      available = this.dependencies.recordCodec.isAvailable();
    } catch {
      available = false;
    }
    if (!available) {
      throw new StoreCollectionSchedulerError(
        'PERSISTENCE_PROTECTION_UNAVAILABLE',
        '店铺采集调度安全存储不可用，已失败关闭。',
      );
    }
  }

  private projectionForAttempt(
    context: StoreContextEnvelope,
    config: StoreRuntimeConfigRecord,
    attempt: StoreCollectionScheduleAttempt,
  ): StoreCollectionScheduleProjection {
    return {
      storeId: context.storeId,
      businessDate: context.businessDate,
      enabled: config.status === 'active',
      state: attempt.state,
      detail: attempt.state === 'claimed'
        ? '当前店铺采集任务已持久认领，正在使用可见浏览器执行。'
        : attempt.state === 'succeeded'
          ? '当前店铺本业务日采集任务已完成。'
          : '当前店铺本业务日采集任务失败关闭，不会自动重试。',
      scheduleLocalTime: config.values.collectionScheduleLocalTime,
      configRevision: config.revision,
      dateStart: attempt.dateStart,
      dateEnd: attempt.dateEnd,
      fingerprint: attempt.fingerprint,
      lastAttempt: attempt,
    };
  }

  private publish(projection: StoreCollectionScheduleProjection): void {
    this.dependencies.onChanged?.(projection);
  }

  private assertCurrentBusinessDate(context: StoreContextEnvelope, now: Date): void {
    const clock = localBusinessClock(now, context.businessTimezone);
    if (clock.businessDate !== context.businessDate) {
      throw new StoreCollectionSchedulerError(
        'CONFIG_UNAVAILABLE',
        '调度时钟与当前店铺业务日不一致，已失败关闭。',
      );
    }
  }
}

export function storeCollectionScheduleSettingKey(storeId: StoreId): string {
  return `store_collection_schedule:v2:${storeId}`;
}

export function storeCollectionScheduleSemanticFingerprint(input: {
  storeId: StoreId;
  browserProfileId: string;
  businessDate: string;
  lookbackDays: number;
  dateStart: string;
  dateEnd: string;
}): string {
  if (!validIsoDate(input.businessDate)
    || !input.browserProfileId.trim()
    || !Number.isInteger(input.lookbackDays)
    || input.lookbackDays < 1
    || input.lookbackDays > 90
    || !validIsoDate(input.dateStart)
    || !validIsoDate(input.dateEnd)
    || input.dateStart > input.dateEnd) {
    throw new TypeError('invalid store collection schedule fingerprint input');
  }
  return createHash('sha256').update(JSON.stringify({
    collectionContractVersion: STORE_COLLECTION_CONTRACT_VERSION,
    storeId: input.storeId,
    browserProfileId: input.browserProfileId,
    businessDate: input.businessDate,
    lookbackDays: input.lookbackDays,
    dateStart: input.dateStart,
    dateEnd: input.dateEnd,
  })).digest('hex');
}

type StoreCollectionScheduleAttemptWithoutIntegrity =
  Omit<StoreCollectionScheduleAttempt, 'integrityDigest'>
  & { integrityDigest?: undefined };

export function storeCollectionScheduleIntegrityDigest(
  value: StoreCollectionScheduleAttemptWithoutIntegrity | StoreCollectionScheduleAttempt,
): string {
  return createHash('sha256').update(JSON.stringify({
    schemaVersion: value.schemaVersion,
    fingerprint: value.fingerprint,
    storeId: value.storeId,
    browserProfileId: value.browserProfileId,
    sessionGeneration: value.sessionGeneration,
    businessDate: value.businessDate,
    scheduleLocalTime: value.scheduleLocalTime,
    configRevision: value.configRevision,
    lookbackDays: value.lookbackDays,
    dateStart: value.dateStart,
    dateEnd: value.dateEnd,
    requestId: value.requestId,
    trigger: value.trigger,
    state: value.state,
    claimedAt: value.claimedAt,
    completedAt: value.completedAt ?? null,
    failureCode: value.failureCode ?? null,
  })).digest('hex');
}

function withStoreCollectionScheduleIntegrity(
  value: StoreCollectionScheduleAttemptWithoutIntegrity,
): StoreCollectionScheduleAttempt {
  const { integrityDigest: _ignored, ...attempt } = value;
  return {
    ...attempt,
    integrityDigest: storeCollectionScheduleIntegrityDigest(attempt),
  };
}

function localBusinessClock(now: Date, timeZone: string): { businessDate: string; localTime: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes): string => (
    parts.find((candidate) => candidate.type === type)?.value ?? ''
  );
  return {
    businessDate: `${part('year')}-${part('month')}-${part('day')}`,
    localTime: `${part('hour')}:${part('minute')}`,
  };
}

function inspectionContextForStore(
  store: StoreRecord,
  businessDate: string,
): StoreContextEnvelope {
  if (!store
    || typeof store !== 'object'
    || store.status !== 'active'
    || store.marketplace !== 'US'
    || store.currency !== 'USD'
    || store.businessTimezone !== 'America/Los_Angeles'
    || typeof store.browserProfileId !== 'string'
    || store.browserProfileId.trim().length < 1
    || !validIsoDate(businessDate)) {
    throw new StoreCollectionSchedulerError(
      'UNSUPPORTED_STORE',
      '只读采集检查要求 active US/USD/America/Los_Angeles Store/Profile 与合法业务日。',
    );
  }
  try {
    return normalizeStoreContextEnvelope({
      storeId: store.storeId,
      browserProfileId: store.browserProfileId,
      marketplace: 'US',
      currency: 'USD',
      businessTimezone: 'America/Los_Angeles',
      businessDate,
      // Fingerprints and history identity intentionally exclude generation;
      // no visible session is authorized or created by this inspection path.
      sessionGeneration: 0,
    });
  } catch {
    throw new StoreCollectionSchedulerError(
      'UNSUPPORTED_STORE',
      '只读采集检查的 Store/Profile authority 无效。',
    );
  }
}

function assertConfigIdentity(context: StoreContextEnvelope, config: StoreRuntimeConfigRecord): void {
  if (config.storeId !== context.storeId
    || config.marketplace !== 'US'
    || config.currency !== 'USD'
    || config.businessTimezone !== context.businessTimezone) {
    throw new StoreCollectionSchedulerError(
      'UNSUPPORTED_STORE',
      '店铺采集配置与当前 US/USD StoreContext 不一致。',
    );
  }
  if (!CLOCK_TIME.test(config.values.collectionScheduleLocalTime)) {
    throw new StoreCollectionSchedulerError('CONFIG_UNAVAILABLE', '店铺采集时间配置无效。');
  }
}

function assertStoredHistory(
  value: StoreCollectionScheduleHistory,
  context: { storeId: StoreId; browserProfileId: string },
  currentConfig?: StoreRuntimeConfigRecord,
): void {
  if (!value
    || value.schemaVersion !== 2
    || value.storeId !== context.storeId
    || value.browserProfileId !== context.browserProfileId
    || !Array.isArray(value.attempts)
    || new Set(value.attempts.map((attempt) => attempt?.fingerprint)).size !== value.attempts.length) {
    throw new StoreCollectionSchedulerError(
      'CORRUPT_PERSISTENCE',
      '店铺采集调度幂等记录身份无效，已失败关闭。',
    );
  }
  for (const attempt of value.attempts) {
    assertStoredAttempt(attempt, context, currentConfig);
  }
}

function assertStoredAttempt(
  value: StoreCollectionScheduleAttempt,
  context: { storeId: StoreId; browserProfileId: string },
  currentConfig?: StoreRuntimeConfigRecord,
): void {
  const validClaimedAt = validIsoTimestamp(value?.claimedAt);
  const validCompletedAt = value?.completedAt === undefined || validIsoTimestamp(value.completedAt);
  const validTimestampOrder = value?.completedAt === undefined
    || Date.parse(value.completedAt) >= Date.parse(value.claimedAt);
  const validFailureCode = value?.failureCode === undefined || /^[A-Z0-9_:-]{1,80}$/.test(value.failureCode);
  const recomputedFingerprint = value && typeof value === 'object'
    ? (() => {
        try {
          return storeCollectionScheduleSemanticFingerprint({
            storeId: value.storeId,
            browserProfileId: value.browserProfileId,
            businessDate: value.businessDate,
            lookbackDays: value.lookbackDays,
            dateStart: value.dateStart,
            dateEnd: value.dateEnd,
          });
        } catch {
          return '';
        }
      })()
    : '';
  const recomputedIntegrity = value && typeof value === 'object'
    ? storeCollectionScheduleIntegrityDigest(value)
    : '';
  const expectedCurrentWindow = currentConfig
    && value?.businessDate
    && value.scheduleLocalTime === currentConfig.values.collectionScheduleLocalTime
    && value.lookbackDays === currentConfig.values.collectionLookbackDays
    ? deriveStoreCollectionWindow(value.businessDate, currentConfig.values.collectionLookbackDays)
    : undefined;
  const expectedStoredWindow = (() => {
    try {
      return deriveStoreCollectionWindow(value.businessDate, value.lookbackDays);
    } catch {
      return undefined;
    }
  })();
  if (!value || value.schemaVersion !== 1
    || value.storeId !== context.storeId
    || value.browserProfileId !== context.browserProfileId
    || typeof value.browserProfileId !== 'string'
    || value.browserProfileId.trim().length < 1
    || !FINGERPRINT.test(value.fingerprint)
    || value.fingerprint !== recomputedFingerprint
    || !FINGERPRINT.test(value.integrityDigest)
    || value.integrityDigest !== recomputedIntegrity
    || !['claimed', 'succeeded', 'failed'].includes(value.state)
    || !['scheduled', 'manual'].includes(value.trigger)
    || !validIsoDate(value.businessDate)
    || !validIsoDate(value.dateStart)
    || !validIsoDate(value.dateEnd)
    || value.dateStart > value.dateEnd
    || !CLOCK_TIME.test(value.scheduleLocalTime)
    || !Number.isInteger(value.configRevision)
    || value.configRevision < 1
    || !Number.isInteger(value.lookbackDays)
    || value.lookbackDays < 1
    || value.lookbackDays > 90
    || !expectedStoredWindow
    || value.dateStart !== expectedStoredWindow.dateStart
    || value.dateEnd !== expectedStoredWindow.dateEnd
    || !Number.isInteger(value.sessionGeneration)
    || value.sessionGeneration < 0
    || value.requestId !== `${value.trigger}:${value.fingerprint}`
    || !validClaimedAt
    || !validCompletedAt
    || !validTimestampOrder
    || !validFailureCode
    || (expectedCurrentWindow !== undefined
      && (value.lookbackDays !== currentConfig!.values.collectionLookbackDays
        || value.dateStart !== expectedCurrentWindow.dateStart
        || value.dateEnd !== expectedCurrentWindow.dateEnd))
    || (value.state === 'claimed' && (value.completedAt !== undefined || value.failureCode !== undefined))
    || (value.state === 'succeeded' && (value.completedAt === undefined || value.failureCode !== undefined))
    || (value.state === 'failed' && (value.completedAt === undefined || value.failureCode === undefined))) {
    throw new StoreCollectionSchedulerError(
      'CORRUPT_PERSISTENCE',
      '店铺采集调度幂等记录身份无效，已失败关闭。',
    );
  }
}

function validIsoTimestamp(value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim()) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function validIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function disabledProjection(
  context: StoreContextEnvelope,
  state: 'not_configured' | 'archived',
  detail: string,
): StoreCollectionScheduleProjection {
  return {
    storeId: context.storeId,
    businessDate: context.businessDate,
    enabled: false,
    state,
    detail,
  };
}

function safeFailureCode(error: unknown): string {
  if (error instanceof StoreCollectionSchedulerError) return error.code;
  const code = error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : '';
  return /^[A-Z0-9_:-]{1,80}$/.test(code) ? code : 'COLLECTION_FAILED';
}

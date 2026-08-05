import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';

export const PACKAGE_UI_SCHEDULER_AUDIT_FILE = 'package-ui-scheduler-audit.json';
export const PACKAGE_UI_DATABASE_CHECKPOINT_CHANNEL = 'package-ui-evidence:database-checkpoint';
export const PACKAGE_UI_DATABASE_CHECKPOINT_PHASES = [
  'post-bootstrap',
  'post-navigation',
  'pre-close-terminal',
] as const;
export type PackageUiDatabaseCheckpointPhase =
  (typeof PACKAGE_UI_DATABASE_CHECKPOINT_PHASES)[number];

type PackageUiDatabaseAuditSource = {
  serialize(): Buffer;
  prepare(sql: string): { get(): unknown };
  pragma(source: string, options?: { simple?: boolean }): unknown;
};

type PackageUiDatabaseMetrics = {
  digestSha256: string;
  serializedBytes: number;
  totalChanges: number;
  dataVersion: number;
  pageCount: number;
  pageSize: number;
  schemaVersion: number;
  userVersion: number;
};

type PackageUiDatabaseCheckpoint = {
  sequence: number;
  phase: PackageUiDatabaseCheckpointPhase;
  capturedAt: string;
  contextDigestSha256: string;
  metrics: PackageUiDatabaseMetrics;
};

type AuditedChannel =
  | 'mission-control:query'
  | 'store-collection-scheduler:get'
  | 'store-collection-scheduler:run-now'
  | 'store-evidence-retention:preview';

type ControlEvent =
  | 'execute'
  | 'localSchedulerStart'
  | 'reconcile'
  | 'storeSchedulerStart';

type SuppressedEvent =
  | 'automaticReconcile'
  | 'localSchedulerStart'
  | 'startupReconcile'
  | 'storeSchedulerStart';

type AuditCounts = {
  workspaceQuery: number;
  schedulerGet: number;
  retentionPreview: number;
  runNow: number;
  runNowRejected: number;
  localSchedulerStart: number;
  storeSchedulerStart: number;
  reconcile: number;
  execute: number;
};

type SuppressedCounts = Record<SuppressedEvent, number>;

type AuditEvent = {
  sequence: number;
  at: string;
  source: AuditedChannel | ControlEvent;
  outcome: 'pending' | 'succeeded' | 'rejected' | 'recorded';
  context: ReturnType<typeof projectContext>;
  request: Record<string, unknown> | null;
  response: Record<string, unknown> | null;
  errorCode: string | null;
};

export interface PackageUiSchedulerAuditRegistrar {
  handle(
    channel: string,
    listener: (event: unknown, input?: unknown) => unknown,
  ): void;
}

const CHANNEL_COUNT: Partial<Record<AuditedChannel, keyof AuditCounts>> = {
  'mission-control:query': 'workspaceQuery',
  'store-collection-scheduler:get': 'schedulerGet',
  'store-collection-scheduler:run-now': 'runNow',
  'store-evidence-retention:preview': 'retentionPreview',
};

const EMPTY_COUNTS: AuditCounts = {
  workspaceQuery: 0,
  schedulerGet: 0,
  retentionPreview: 0,
  runNow: 0,
  runNowRejected: 0,
  localSchedulerStart: 0,
  storeSchedulerStart: 0,
  reconcile: 0,
  execute: 0,
};

const EMPTY_SUPPRESSED: SuppressedCounts = {
  automaticReconcile: 0,
  localSchedulerStart: 0,
  startupReconcile: 0,
  storeSchedulerStart: 0,
};

export class PackageUiSchedulerAudit {
  private readonly counts: AuditCounts = { ...EMPTY_COUNTS };
  private readonly suppressed: SuppressedCounts = { ...EMPTY_SUPPRESSED };
  private readonly events: AuditEvent[] = [];
  private sequence = 0;

  constructor(
    private readonly options: {
      enabled: boolean;
      evidenceMode: string | null;
      userDataDir: string;
      database?: () => PackageUiDatabaseAuditSource | null;
      authorizeDatabaseCheckpoint?: () => StoreContextEnvelope;
      pid?: number;
      now?: () => Date;
    },
  ) {
    if (options.enabled) this.write();
  }

  registerDatabaseCheckpointIpc(registrar: PackageUiSchedulerAuditRegistrar): void {
    registrar.handle(PACKAGE_UI_DATABASE_CHECKPOINT_CHANNEL, (_event, input) =>
      this.databaseCheckpoint(input));
  }

  capturePostBootstrapDatabaseBaseline(): PackageUiDatabaseCheckpoint {
    if (!this.options.enabled) {
      throw new Error('PACKAGE_UI_DATABASE_CHECKPOINT_DISABLED');
    }
    if (this.databaseCheckpoints.length !== 0) {
      throw new Error('PACKAGE_UI_DATABASE_CHECKPOINT_BASELINE_EXISTS');
    }
    const contextDigestSha256 = this.authorizeLiveDatabaseCheckpoint();
    const database = this.options.database?.();
    if (!database) throw new Error('PACKAGE_UI_DATABASE_CHECKPOINT_UNAVAILABLE');
    this.boundContextDigestSha256 = contextDigestSha256;
    this.boundDatabase = database;
    return this.appendDatabaseCheckpoint('post-bootstrap', contextDigestSha256, database);
  }

  capturePreCloseTerminalDatabaseCheckpoint(): PackageUiDatabaseCheckpoint {
    if (!this.options.enabled) {
      throw new Error('PACKAGE_UI_DATABASE_CHECKPOINT_DISABLED');
    }
    if (
      !this.baselineReceiptIssued
      || this.databaseCheckpoints.length !== 2
      || this.databaseCheckpoints[0]?.phase !== 'post-bootstrap'
      || this.databaseCheckpoints[1]?.phase !== 'post-navigation'
    ) {
      throw new Error('PACKAGE_UI_DATABASE_CHECKPOINT_TERMINAL_ORDER_INVALID');
    }
    if (!this.boundContextDigestSha256 || !this.boundDatabase) {
      throw new Error('PACKAGE_UI_DATABASE_CHECKPOINT_TERMINAL_BINDING_MISSING');
    }
    return this.appendDatabaseCheckpoint(
      'pre-close-terminal',
      this.boundContextDigestSha256,
      this.boundDatabase,
    );
  }

  wrapRegistrar<T extends PackageUiSchedulerAuditRegistrar>(registrar: T): T {
    if (!this.options.enabled) return registrar;
    return {
      ...registrar,
      handle: (channel, listener) => {
        registrar.handle(channel, (event, input) => {
          if (!(channel in CHANNEL_COUNT)) return listener(event, input);
          return this.invoke(channel as AuditedChannel, input, () => listener(event, input));
        });
      },
    } as T;
  }

  recordControl(
    source: ControlEvent,
    context?: Partial<StoreContextEnvelope> | null,
  ): void {
    if (!this.options.enabled) return;
    this.counts[source] += 1;
    this.events.push({
      sequence: ++this.sequence,
      at: this.now().toISOString(),
      source,
      outcome: 'recorded',
      context: projectContext(context),
      request: null,
      response: null,
      errorCode: null,
    });
    this.write();
  }

  recordSuppressed(source: SuppressedEvent): void {
    if (!this.options.enabled) return;
    this.suppressed[source] += 1;
    this.write();
  }

  checkpoint(): void {
    if (this.options.enabled) this.write();
  }

  snapshot(): ReturnType<PackageUiSchedulerAudit['buildSnapshot']> {
    return this.buildSnapshot();
  }

  private readonly databaseCheckpoints: PackageUiDatabaseCheckpoint[] = [];
  private baselineReceiptIssued = false;
  private boundContextDigestSha256: string | null = null;
  private boundDatabase: PackageUiDatabaseAuditSource | null = null;

  private databaseCheckpoint(input: unknown): PackageUiDatabaseCheckpoint {
    if (!this.options.enabled) {
      throw new Error('PACKAGE_UI_DATABASE_CHECKPOINT_DISABLED');
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new Error('PACKAGE_UI_DATABASE_CHECKPOINT_INVALID');
    }
    const record = input as Record<string, unknown>;
    if (Object.keys(record).length !== 1 || typeof record.phase !== 'string') {
      throw new Error('PACKAGE_UI_DATABASE_CHECKPOINT_INVALID');
    }
    const expectedPhase = !this.baselineReceiptIssued
      ? 'post-bootstrap'
      : this.databaseCheckpoints.length === 1
        ? 'post-navigation'
        : null;
    if (record.phase !== expectedPhase) {
      throw new Error(`PACKAGE_UI_DATABASE_CHECKPOINT_ORDER_INVALID:${expectedPhase ?? 'complete'}`);
    }
    if (expectedPhase === 'post-bootstrap') {
      // A fresh migrated profile has no implicit operator Store authority. The
      // package evidence runner must select a visible Store first, so capture
      // the baseline on its first Store-authorized Main IPC rather than failing
      // startup before the Store Gate can render.
      if (this.databaseCheckpoints.length === 0) {
        this.capturePostBootstrapDatabaseBaseline();
      }
      if (this.databaseCheckpoints.length !== 1) {
        throw new Error('PACKAGE_UI_DATABASE_CHECKPOINT_BASELINE_MISSING');
      }
      const contextDigestSha256 = this.authorizeLiveDatabaseCheckpoint();
      const baseline = this.databaseCheckpoints[0];
      if (baseline.contextDigestSha256 !== contextDigestSha256) {
        throw new Error('PACKAGE_UI_DATABASE_CHECKPOINT_CONTEXT_CHANGED');
      }
      this.baselineReceiptIssued = true;
      return cloneDatabaseCheckpoint(baseline);
    }
    if (this.databaseCheckpoints.length !== 1) {
      throw new Error('PACKAGE_UI_DATABASE_CHECKPOINT_ORDER_INVALID:complete');
    }
    return this.captureLivePostNavigationCheckpoint();
  }

  private captureLivePostNavigationCheckpoint(): PackageUiDatabaseCheckpoint {
    const contextDigestSha256 = this.authorizeLiveDatabaseCheckpoint();
    if (this.boundContextDigestSha256 !== contextDigestSha256) {
      throw new Error('PACKAGE_UI_DATABASE_CHECKPOINT_CONTEXT_CHANGED');
    }
    const database = this.options.database?.();
    if (!database) throw new Error('PACKAGE_UI_DATABASE_CHECKPOINT_UNAVAILABLE');
    if (database !== this.boundDatabase) {
      throw new Error('PACKAGE_UI_DATABASE_CHECKPOINT_DATABASE_CHANGED');
    }
    return this.appendDatabaseCheckpoint('post-navigation', contextDigestSha256, database);
  }

  private appendDatabaseCheckpoint(
    phase: PackageUiDatabaseCheckpointPhase,
    contextDigestSha256: string,
    database: PackageUiDatabaseAuditSource,
  ): PackageUiDatabaseCheckpoint {
    const checkpoint: PackageUiDatabaseCheckpoint = {
      sequence: this.databaseCheckpoints.length + 1,
      phase,
      capturedAt: this.now().toISOString(),
      contextDigestSha256,
      metrics: readDatabaseMetrics(database),
    };
    this.databaseCheckpoints.push(checkpoint);
    this.write();
    return cloneDatabaseCheckpoint(checkpoint);
  }

  private authorizeLiveDatabaseCheckpoint(): string {
    const context = this.options.authorizeDatabaseCheckpoint?.();
    if (!context) throw new Error('PACKAGE_UI_DATABASE_CHECKPOINT_CONTEXT_UNAVAILABLE');
    return digestStoreContext(context);
  }

  private async invoke(
    channel: AuditedChannel,
    input: unknown,
    invoke: () => unknown,
  ): Promise<unknown> {
    const count = CHANNEL_COUNT[channel];
    if (!count) return invoke();
    this.counts[count] += 1;
    const auditEvent: AuditEvent = {
      sequence: ++this.sequence,
      at: this.now().toISOString(),
      source: channel,
      outcome: 'pending',
      context: projectContext(readSubmittedContext(channel, input)),
      request: summarizeRequest(channel, input),
      response: null,
      errorCode: null,
    };
    this.events.push(auditEvent);
    this.write();
    try {
      const response = await invoke();
      auditEvent.outcome = 'succeeded';
      auditEvent.response = summarizeResponse(channel, response);
      this.write();
      return response;
    } catch (error) {
      auditEvent.outcome = 'rejected';
      auditEvent.errorCode = safeErrorCode(error);
      if (channel === 'store-collection-scheduler:run-now') {
        this.counts.runNowRejected += 1;
      }
      this.write();
      throw error;
    }
  }

  private buildSnapshot() {
    const counts = { ...this.counts };
    const suppressed = { ...this.suppressed };
    return {
      kind: 'package-ui-scheduler-audit',
      schemaVersion: 1,
      generatedAt: this.now().toISOString(),
      pid: this.options.pid ?? process.pid,
      evidenceMode: this.options.evidenceMode,
      userDataDir: this.options.userDataDir,
      policies: {
        runNow: 'reject',
      },
      counts,
      suppressed,
      guards: {
        localSchedulerStarted: counts.localSchedulerStart > 0,
        storeCollectionSchedulerStarted: counts.storeSchedulerStart > 0,
        runNowIpcDisabled: counts.runNow === counts.runNowRejected,
        startupReconcileSuppressed:
          counts.storeSchedulerStart === 0
          && suppressed.startupReconcile > 0,
        automaticReconcileSuppressed:
          counts.reconcile === 0,
        readOnlyInvariantPassed:
          counts.localSchedulerStart === 0
          && counts.storeSchedulerStart === 0
          && counts.reconcile === 0
          && counts.execute === 0
          && counts.runNow === 0,
      },
      databaseMutationAudit: buildDatabaseMutationAudit(this.databaseCheckpoints),
      events: this.events.map((event) => ({
        ...event,
        context: event.context ? { ...event.context } : null,
        request: event.request ? { ...event.request } : null,
        response: event.response ? { ...event.response } : null,
      })),
    };
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private write(): void {
    const target = path.join(this.options.userDataDir, PACKAGE_UI_SCHEDULER_AUDIT_FILE);
    const temporary = `${target}.${this.options.pid ?? process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(this.buildSnapshot(), null, 2)}\n`, 'utf8');
    fs.renameSync(temporary, target);
  }
}

function readDatabaseMetrics(database: PackageUiDatabaseAuditSource): PackageUiDatabaseMetrics {
  const serialized = database.serialize();
  if (!Buffer.isBuffer(serialized)) throw new Error('PACKAGE_UI_DATABASE_SERIALIZE_INVALID');
  const totalChanges = numericDatabaseValue(
    database.prepare('SELECT total_changes() AS value').get(),
    'value',
  );
  return {
    digestSha256: createHash('sha256').update(serialized).digest('hex').toUpperCase(),
    serializedBytes: serialized.byteLength,
    totalChanges,
    dataVersion: numericPragmaValue(database.pragma('data_version', { simple: true })),
    pageCount: numericPragmaValue(database.pragma('page_count', { simple: true })),
    pageSize: numericPragmaValue(database.pragma('page_size', { simple: true })),
    schemaVersion: numericPragmaValue(database.pragma('schema_version', { simple: true })),
    userVersion: numericPragmaValue(database.pragma('user_version', { simple: true })),
  };
}

function cloneDatabaseCheckpoint(
  checkpoint: PackageUiDatabaseCheckpoint,
): PackageUiDatabaseCheckpoint {
  return {
    ...checkpoint,
    metrics: { ...checkpoint.metrics },
  };
}

function digestStoreContext(context: StoreContextEnvelope): string {
  const canonical = JSON.stringify({
    storeId: context.storeId,
    browserProfileId: context.browserProfileId,
    marketplace: context.marketplace,
    currency: context.currency,
    businessTimezone: context.businessTimezone,
    businessDate: context.businessDate,
    sessionGeneration: context.sessionGeneration,
  });
  return createHash('sha256').update(canonical).digest('hex').toUpperCase();
}

function numericDatabaseValue(value: unknown, field: string): number {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  const parsed = Number(record?.[field]);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('PACKAGE_UI_DATABASE_METRIC_INVALID');
  }
  return parsed;
}

function numericPragmaValue(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('PACKAGE_UI_DATABASE_METRIC_INVALID');
  }
  return parsed;
}

function buildDatabaseMutationAudit(checkpoints: readonly PackageUiDatabaseCheckpoint[]) {
  const baseline = checkpoints[0]?.metrics;
  const allCheckpointsMatch = <K extends keyof PackageUiDatabaseMetrics>(key: K): boolean | null =>
    baseline && checkpoints.length === PACKAGE_UI_DATABASE_CHECKPOINT_PHASES.length
      ? checkpoints.every((checkpoint) => checkpoint.metrics[key] === baseline[key])
      : null;
  const comparisons = {
    contextDigestMatched: checkpoints.length === PACKAGE_UI_DATABASE_CHECKPOINT_PHASES.length
      ? checkpoints.every(
          (checkpoint) => checkpoint.contextDigestSha256 === checkpoints[0].contextDigestSha256,
        )
      : null,
    digestMatched: allCheckpointsMatch('digestSha256'),
    serializedBytesMatched: allCheckpointsMatch('serializedBytes'),
    totalChangesMatched: allCheckpointsMatch('totalChanges'),
    dataVersionMatched: allCheckpointsMatch('dataVersion'),
    pageCountMatched: allCheckpointsMatch('pageCount'),
    pageSizeMatched: allCheckpointsMatch('pageSize'),
    schemaVersionMatched: allCheckpointsMatch('schemaVersion'),
    userVersionMatched: allCheckpointsMatch('userVersion'),
  };
  const ordered = checkpoints.length === PACKAGE_UI_DATABASE_CHECKPOINT_PHASES.length
    && checkpoints.every((checkpoint, index) => (
      checkpoint.sequence === index + 1
      && checkpoint.phase === PACKAGE_UI_DATABASE_CHECKPOINT_PHASES[index]
    ));
  return {
    kind: 'package-ui-database-mutation-audit',
    schemaVersion: 1,
    requiredPhases: [...PACKAGE_UI_DATABASE_CHECKPOINT_PHASES],
    checkpoints: checkpoints.map((checkpoint) => ({
      ...checkpoint,
      metrics: { ...checkpoint.metrics },
    })),
    comparisons,
    passed: ordered && Object.values(comparisons).every((value) => value === true),
  };
}

function readSubmittedContext(channel: AuditedChannel, input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  return channel === 'mission-control:query' ? record.context : record.storeContext;
}

function summarizeRequest(
  channel: AuditedChannel,
  value: unknown,
): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const request = value as Record<string, unknown>;
  return channel === 'mission-control:query'
    ? {
        query: stringOrNull(request.query),
        requestId: stringOrNull(request.requestId),
        contextEpoch: integerOrNull(request.contextEpoch),
        context: projectContext(request.context),
      }
    : {
        storeContext: projectContext(request.storeContext),
      };
}

function projectContext(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return {
    storeId: stringOrNull(record.storeId),
    browserProfileId: stringOrNull(record.browserProfileId),
    marketplace: stringOrNull(record.marketplace),
    currency: stringOrNull(record.currency),
    businessTimezone: stringOrNull(record.businessTimezone),
    businessDate: stringOrNull(record.businessDate),
    sessionGeneration: integerOrNull(record.sessionGeneration),
  };
}

function summarizeResponse(
  channel: AuditedChannel,
  value: unknown,
): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const response = value as Record<string, unknown>;
  if (channel === 'mission-control:query') {
    const data = asRecord(response.data);
    const capabilities = Array.isArray(data?.capabilities) ? data.capabilities : [];
    return {
      query: stringOrNull(response.query),
      requestId: stringOrNull(response.requestId),
      contextEpoch: integerOrNull(response.contextEpoch),
      authoritativeContext: projectContext(response.authoritativeContext),
      capabilities: capabilities
        .filter((capability) => asRecord(capability)?.view === 'settings/scheduler')
        .map((capability) => {
          const item = asRecord(capability);
          return {
            capabilityId: stringOrNull(item?.capabilityId),
            workspace: stringOrNull(item?.workspace),
            view: stringOrNull(item?.view),
            action: stringOrNull(item?.action),
            state: stringOrNull(item?.state),
            legacyRoute: stringOrNull(item?.legacyRoute),
          };
        }),
    };
  }
  if (channel === 'store-collection-scheduler:get') {
    return {
      storeId: stringOrNull(response.storeId),
      businessDate: stringOrNull(response.businessDate),
      enabled: typeof response.enabled === 'boolean' ? response.enabled : null,
      state: stringOrNull(response.state),
      detail: stringOrNull(response.detail),
    };
  }
  if (channel === 'store-evidence-retention:preview') {
    const blockers = Array.isArray(response.blockers) ? response.blockers : [];
    return {
      schemaVersion: integerOrNull(response.schemaVersion),
      mode: stringOrNull(response.mode),
      deletionSupported:
        typeof response.deletionSupported === 'boolean' ? response.deletionSupported : null,
      applyable: typeof response.applyable === 'boolean' ? response.applyable : null,
      storeId: stringOrNull(response.storeId),
      profileId: stringOrNull(response.profileId),
      marketplace: stringOrNull(response.marketplace),
      currency: stringOrNull(response.currency),
      candidateCount: integerOrNull(response.candidateCount),
      blockerCount: integerOrNull(response.blockerCount) ?? blockers.length,
    };
  }
  return {
    accepted: typeof response.accepted === 'boolean' ? response.accepted : null,
    duplicate: typeof response.duplicate === 'boolean' ? response.duplicate : null,
  };
}

function safeErrorCode(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error || 'UNKNOWN');
  const match = value.match(/[A-Z][A-Z0-9_:-]{2,80}/);
  return match?.[0] ?? 'REJECTED';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function integerOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PACKAGE_UI_SCHEDULER_AUDIT_FILE,
  PackageUiSchedulerAudit,
} from './package-ui-scheduler-audit';

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), 'package-ui-scheduler-audit-'));
  temporaryDirectories.push(value);
  return value;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

describe('PackageUiSchedulerAudit', () => {
  function contextFixture(overrides: Record<string, unknown> = {}) {
    return {
      storeId: 'store-us-001',
      browserProfileId: 'profile-us-001',
      marketplace: 'US',
      currency: 'USD',
      businessTimezone: 'America/Los_Angeles',
      businessDate: '2026-07-23',
      sessionGeneration: 4,
      ...overrides,
    } as never;
  }

  function databaseFixture() {
    const state = {
      bytes: Buffer.from('stable-package-ui-database'),
      dataVersion: 1,
      pageCount: 12,
      pageSize: 4096,
      schemaVersion: 9,
      totalChanges: 4,
      userVersion: 9,
    };
    return {
      state,
      source: {
        serialize: () => Buffer.from(state.bytes),
        prepare: () => ({ get: () => ({ value: state.totalChanges }) }),
        pragma: (name: string) => ({
          data_version: state.dataVersion,
          page_count: state.pageCount,
          page_size: state.pageSize,
          schema_version: state.schemaVersion,
          user_version: state.userVersion,
        })[name],
      },
    };
  }

  it('records the actual handler-layer workspace, schedule and retention reads', async () => {
    const userDataDir = temporaryDirectory();
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>();
    const registrar = {
      handle: (channel: string, listener: (event: unknown, input?: unknown) => unknown) => {
        handlers.set(channel, listener);
      },
    };
    const audit = new PackageUiSchedulerAudit({
      enabled: true,
      evidenceMode: 'package-ui',
      now: () => new Date('2026-07-23T08:00:00.000Z'),
      pid: 4321,
      userDataDir,
    });
    const wrapped = audit.wrapRegistrar(registrar);
    const context = {
      storeId: 'store-us-001',
      browserProfileId: 'profile-us-001',
      marketplace: 'US',
      currency: 'USD',
      businessTimezone: 'America/Los_Angeles',
      businessDate: '2026-07-23',
      sessionGeneration: 4,
    };
    wrapped.handle('mission-control:query', (_event, input) => ({
      query: 'workspace-bootstrap',
      requestId: (input as { requestId: string }).requestId,
      contextEpoch: 3,
      authoritativeContext: context,
      data: {
        capabilities: [{
          capabilityId: 'settings.scheduler.view',
          workspace: 'settings',
          view: 'settings/scheduler',
          action: 'view',
          state: 'LEGACY_ADAPTER',
          legacyRoute: 'scheduler',
        }],
      },
    }));
    wrapped.handle('store-collection-scheduler:get', () => ({
      storeId: context.storeId,
      businessDate: context.businessDate,
      enabled: true,
      state: 'waiting',
      detail: '等待 09:00 自动采集。',
    }));
    wrapped.handle('store-evidence-retention:preview', () => ({
      schemaVersion: 1,
      mode: 'dry-run',
      deletionSupported: false,
      applyable: false,
      storeId: context.storeId,
      profileId: context.browserProfileId,
      marketplace: 'US',
      currency: 'USD',
      candidateCount: 2,
      blockers: [{ code: 'MISSING_REFERENCE', detail: '缺少引用。' }],
    }));

    await handlers.get('mission-control:query')?.({}, {
      query: 'workspace-bootstrap',
      requestId: 'renderer-request-1',
      contextEpoch: 3,
      context,
    });
    await handlers.get('store-collection-scheduler:get')?.({}, { storeContext: context });
    await handlers.get('store-evidence-retention:preview')?.({}, { storeContext: context });
    audit.recordSuppressed('localSchedulerStart');
    audit.recordSuppressed('storeSchedulerStart');
    audit.recordSuppressed('startupReconcile');

    const snapshot = audit.snapshot();
    expect(snapshot.counts).toEqual(expect.objectContaining({
      workspaceQuery: 1,
      schedulerGet: 1,
      retentionPreview: 1,
      runNow: 0,
      localSchedulerStart: 0,
      storeSchedulerStart: 0,
      reconcile: 0,
      execute: 0,
    }));
    expect(snapshot.guards).toEqual(expect.objectContaining({
      localSchedulerStarted: false,
      storeCollectionSchedulerStarted: false,
      startupReconcileSuppressed: true,
      automaticReconcileSuppressed: true,
      readOnlyInvariantPassed: true,
    }));
    expect(snapshot.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'mission-control:query',
        outcome: 'succeeded',
        response: expect.objectContaining({
          requestId: 'renderer-request-1',
          authoritativeContext: context,
        }),
      }),
      expect.objectContaining({
        source: 'store-collection-scheduler:get',
        response: expect.objectContaining({ state: 'waiting' }),
      }),
      expect.objectContaining({
        source: 'store-evidence-retention:preview',
        response: expect.objectContaining({ blockerCount: 1, candidateCount: 2 }),
      }),
    ]));
    const persisted = JSON.parse(fs.readFileSync(
      path.join(userDataDir, PACKAGE_UI_SCHEDULER_AUDIT_FILE),
      'utf8',
    ));
    expect(persisted).toEqual(snapshot);
  });

  it('records a run-now attempt and its Main rejection without calling scheduler execution', async () => {
    const userDataDir = temporaryDirectory();
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>();
    const audit = new PackageUiSchedulerAudit({
      enabled: true,
      evidenceMode: 'package-ui',
      pid: 4322,
      userDataDir,
    });
    const wrapped = audit.wrapRegistrar({
      handle: (channel: string, listener: (event: unknown, input?: unknown) => unknown) => {
        handlers.set(channel, listener);
      },
    });
    wrapped.handle('store-collection-scheduler:run-now', async () => {
      throw new Error('PACKAGE_UI_EVIDENCE_READ_ONLY');
    });

    await expect(handlers.get('store-collection-scheduler:run-now')?.({}, {
      storeContext: { storeId: 'store-us-001' },
    })).rejects.toThrow('PACKAGE_UI_EVIDENCE_READ_ONLY');

    expect(audit.snapshot()).toEqual(expect.objectContaining({
      counts: expect.objectContaining({
        runNow: 1,
        runNowRejected: 1,
        execute: 0,
      }),
      guards: expect.objectContaining({
        runNowIpcDisabled: true,
        readOnlyInvariantPassed: false,
      }),
    }));
  });

  it('is a no-op outside package UI evidence mode', () => {
    const userDataDir = temporaryDirectory();
    const registrar = { handle: () => undefined };
    const audit = new PackageUiSchedulerAudit({
      enabled: false,
      evidenceMode: null,
      userDataDir,
    });

    expect(audit.wrapRegistrar(registrar)).toBe(registrar);
    audit.recordControl('execute');
    audit.recordSuppressed('startupReconcile');
    expect(fs.existsSync(path.join(userDataDir, PACKAGE_UI_SCHEDULER_AUDIT_FILE))).toBe(false);
  });

  it('derives a passing database mutation audit only from three ordered identical checkpoints', () => {
    const userDataDir = temporaryDirectory();
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>();
    const database = databaseFixture();
    const audit = new PackageUiSchedulerAudit({
      enabled: true,
      evidenceMode: 'package-ui',
      database: () => database.source,
      authorizeDatabaseCheckpoint: () => contextFixture(),
      now: () => new Date('2026-07-23T08:00:00.000Z'),
      userDataDir,
    });
    audit.registerDatabaseCheckpointIpc({
      handle: (channel, listener) => handlers.set(channel, listener),
    });

    audit.capturePostBootstrapDatabaseBaseline();
    handlers.get('package-ui-evidence:database-checkpoint')?.({}, { phase: 'post-bootstrap' });
    expect(audit.snapshot().databaseMutationAudit.passed).toBe(false);
    handlers.get('package-ui-evidence:database-checkpoint')?.({}, { phase: 'post-navigation' });
    expect(audit.snapshot().databaseMutationAudit.passed).toBe(false);
    audit.capturePreCloseTerminalDatabaseCheckpoint();

    const proof = audit.snapshot().databaseMutationAudit;
    expect(proof.passed).toBe(true);
    expect(proof.comparisons).toEqual({
      contextDigestMatched: true,
      dataVersionMatched: true,
      digestMatched: true,
      pageCountMatched: true,
      pageSizeMatched: true,
      schemaVersionMatched: true,
      serializedBytesMatched: true,
      totalChangesMatched: true,
      userVersionMatched: true,
    });
    expect(proof.checkpoints.map((checkpoint) => checkpoint.phase)).toEqual([
      'post-bootstrap',
      'post-navigation',
      'pre-close-terminal',
    ]);
    expect(JSON.stringify(proof)).not.toMatch(/storeId|credential|password|cookie|token|rawPath|userDataDir/i);
  });

  it('fails the derived database audit for a write or external data-version change before close', () => {
    const userDataDir = temporaryDirectory();
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>();
    const database = databaseFixture();
    const audit = new PackageUiSchedulerAudit({
      enabled: true,
      evidenceMode: 'package-ui',
      database: () => database.source,
      authorizeDatabaseCheckpoint: () => contextFixture(),
      userDataDir,
    });
    audit.registerDatabaseCheckpointIpc({
      handle: (channel, listener) => handlers.set(channel, listener),
    });

    audit.capturePostBootstrapDatabaseBaseline();
    handlers.get('package-ui-evidence:database-checkpoint')?.({}, { phase: 'post-bootstrap' });
    database.state.bytes = Buffer.from('mutated-then-reverted-logical-database');
    database.state.totalChanges += 1;
    database.state.dataVersion += 1;
    handlers.get('package-ui-evidence:database-checkpoint')?.({}, { phase: 'post-navigation' });
    audit.capturePreCloseTerminalDatabaseCheckpoint();

    expect(audit.snapshot().databaseMutationAudit).toEqual(expect.objectContaining({
      passed: false,
      comparisons: expect.objectContaining({
        dataVersionMatched: false,
        digestMatched: false,
        totalChangesMatched: false,
      }),
    }));
  });

  it('rejects malformed, reordered, duplicate, and normal-runtime database checkpoints', () => {
    const database = databaseFixture();
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>();
    const audit = new PackageUiSchedulerAudit({
      enabled: true,
      evidenceMode: 'package-ui',
      database: () => database.source,
      authorizeDatabaseCheckpoint: () => contextFixture(),
      userDataDir: temporaryDirectory(),
    });
    audit.registerDatabaseCheckpointIpc({
      handle: (channel, listener) => handlers.set(channel, listener),
    });
    const checkpoint = handlers.get('package-ui-evidence:database-checkpoint')!;

    expect(() => checkpoint({}, { phase: 'post-navigation' })).toThrow(/ORDER_INVALID/);
    expect(() => checkpoint({}, { phase: 'post-bootstrap' })).toThrow(/BASELINE_MISSING/);
    audit.capturePostBootstrapDatabaseBaseline();
    expect(() => checkpoint({}, { phase: 'post-bootstrap', storeId: 'forged' })).toThrow(/INVALID/);
    checkpoint({}, { phase: 'post-bootstrap' });
    expect(() => checkpoint({}, { phase: 'post-bootstrap' })).toThrow(/ORDER_INVALID/);
    checkpoint({}, { phase: 'post-navigation' });
    expect(() => checkpoint({}, { phase: 'post-navigation' })).toThrow(/ORDER_INVALID/);
    audit.capturePreCloseTerminalDatabaseCheckpoint();
    expect(() => audit.capturePreCloseTerminalDatabaseCheckpoint()).toThrow(/TERMINAL_ORDER_INVALID/);

    const normalHandlers = new Map<string, (event: unknown, input?: unknown) => unknown>();
    const normalAudit = new PackageUiSchedulerAudit({
      enabled: false,
      evidenceMode: null,
      database: () => database.source,
      authorizeDatabaseCheckpoint: () => contextFixture(),
      userDataDir: temporaryDirectory(),
    });
    normalAudit.registerDatabaseCheckpointIpc({
      handle: (channel, listener) => normalHandlers.set(channel, listener),
    });
    expect(() => normalHandlers.get('package-ui-evidence:database-checkpoint')?.(
      {},
      { phase: 'post-bootstrap' },
    )).toThrow(/CHECKPOINT_DISABLED/);
  });

  it('binds both checkpoints to one authorized non-secret StoreContext digest', () => {
    const database = databaseFixture();
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>();
    let context = contextFixture();
    const audit = new PackageUiSchedulerAudit({
      enabled: true,
      evidenceMode: 'package-ui',
      database: () => database.source,
      authorizeDatabaseCheckpoint: () => context,
      userDataDir: temporaryDirectory(),
    });
    audit.registerDatabaseCheckpointIpc({
      handle: (channel, listener) => handlers.set(channel, listener),
    });

    audit.capturePostBootstrapDatabaseBaseline();
    handlers.get('package-ui-evidence:database-checkpoint')?.({}, { phase: 'post-bootstrap' });
    context = contextFixture({ sessionGeneration: 5 });

    expect(() => handlers.get('package-ui-evidence:database-checkpoint')?.(
      {},
      { phase: 'post-navigation' },
    )).toThrow(/CONTEXT_CHANGED/);
    const proof = audit.snapshot().databaseMutationAudit;
    expect(proof.checkpoints).toHaveLength(1);
    expect(JSON.stringify(proof)).not.toContain('store-us-001');
    expect(JSON.stringify(proof)).not.toContain('profile-us-001');
  });

  it('uses the baseline database and context binding for the Main-only terminal checkpoint', () => {
    const database = databaseFixture();
    const replacement = databaseFixture();
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>();
    let contextAuthorizationAvailable = true;
    let liveDatabase = database.source;
    const audit = new PackageUiSchedulerAudit({
      enabled: true,
      evidenceMode: 'package-ui',
      database: () => liveDatabase,
      authorizeDatabaseCheckpoint: () => {
        if (!contextAuthorizationAvailable) throw new Error('detached runtime must not be consulted');
        return contextFixture();
      },
      userDataDir: temporaryDirectory(),
    });
    audit.registerDatabaseCheckpointIpc({
      handle: (channel, listener) => handlers.set(channel, listener),
    });

    audit.capturePostBootstrapDatabaseBaseline();
    handlers.get('package-ui-evidence:database-checkpoint')?.({}, { phase: 'post-bootstrap' });
    liveDatabase = replacement.source;
    expect(() => handlers.get('package-ui-evidence:database-checkpoint')?.(
      {},
      { phase: 'post-navigation' },
    )).toThrow(/DATABASE_CHANGED/);

    liveDatabase = database.source;
    handlers.get('package-ui-evidence:database-checkpoint')?.({}, { phase: 'post-navigation' });
    contextAuthorizationAvailable = false;
    audit.capturePreCloseTerminalDatabaseCheckpoint();

    expect(audit.snapshot().databaseMutationAudit).toEqual(expect.objectContaining({
      passed: true,
      checkpoints: [
        expect.objectContaining({ phase: 'post-bootstrap' }),
        expect.objectContaining({ phase: 'post-navigation' }),
        expect.objectContaining({ phase: 'pre-close-terminal' }),
      ],
    }));
  });

  it('detects a database write that occurs after the Renderer post-navigation receipt', () => {
    const database = databaseFixture();
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>();
    const audit = new PackageUiSchedulerAudit({
      enabled: true,
      evidenceMode: 'package-ui',
      database: () => database.source,
      authorizeDatabaseCheckpoint: () => contextFixture(),
      userDataDir: temporaryDirectory(),
    });
    audit.registerDatabaseCheckpointIpc({
      handle: (channel, listener) => handlers.set(channel, listener),
    });

    audit.capturePostBootstrapDatabaseBaseline();
    handlers.get('package-ui-evidence:database-checkpoint')?.({}, { phase: 'post-bootstrap' });
    handlers.get('package-ui-evidence:database-checkpoint')?.({}, { phase: 'post-navigation' });
    database.state.totalChanges += 1;
    database.state.bytes = Buffer.from('late-shutdown-database-write');
    audit.capturePreCloseTerminalDatabaseCheckpoint();

    expect(audit.snapshot().databaseMutationAudit).toEqual(expect.objectContaining({
      passed: false,
      comparisons: expect.objectContaining({
        digestMatched: false,
        totalChangesMatched: false,
      }),
    }));
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeStoreContextEnvelope, type StoreContextEnvelope } from '@amazon-ai-ops/shared-types';

const ports = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  quit: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('electron', () => ({
  app: { quit: ports.quit, isPackaged: true, getAppPath: () => 'F:\\Temp\\amazon-ai-ops-development-tests' },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: (channel: string, listener: (...args: unknown[]) => unknown) => ports.handlers.set(channel, listener) },
  dialog: { showMessageBox: vi.fn(), showErrorBox: vi.fn() },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() },
  shell: {},
}));
vi.mock('./runtime-logger', async (original) => ({
  ...await original<typeof import('./runtime-logger')>(),
  runtimeLogger: ports.logger,
}));
vi.mock('./desktop-bootstrap', () => ({
  initializeDesktopBootstrap: vi.fn((_app, options) => ({
    admission: { admitted: true },
    configuration: {
      paths: Object.fromEntries([
        'userDataDir', 'storageDir', 'storesDir', 'screenshotsDir', 'domSnapshotsDir',
        'tracesDir', 'reportsDir', 'downloadsDir', 'exportsDir', 'deliveryBundlesDir',
        'repositoryRoot', 'codexEvidenceDir', 'pageModelsDir', 'databasePath', 'preloadPath', 'rendererFilePath',
      ].map((name) => [name, `F:\\Temp\\amazon-ai-ops-development-tests\\composition\\${name}`])),
      evidenceIdentity: { mode: null }, packageUiReadOnly: false,
      packageUiFreshTypedProofRequired: false, packageLaunchSmoke: false, development: false,
      mainModulePath: options.mainModulePath,
    },
  })),
}));

async function runtime() {
  const factory = await import('./main-runtime-context');
  const access = await import('./main-runtime-access');
  const context = factory.createMainRuntimeContext('F:\\Temp\\amazon-ai-ops-development-tests\\composition\\index.js');
  access.installMainRuntimeContext(context);
  return { context, access };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  ports.handlers.clear();
});

describe('Main runtime composition', () => {
  it('rejects access before installation and replacement after the single actual factory is installed', async () => {
    const access = await import('./main-runtime-access');
    expect(() => access.getMainRuntimeContext()).toThrow('MAIN_RUNTIME_NOT_INSTALLED');
    const { context } = await runtime();
    expect(access.getMainRuntimeContext()).toBe(context);
    expect(Object.isFrozen(context)).toBe(true);
    expect(() => access.installMainRuntimeContext(context)).toThrow('MAIN_RUNTIME_ALREADY_INSTALLED');
  });

  it('keeps every mutable closure live without allowing replacement of shared resources', async () => {
    const { context, access } = await runtime();
    const mutable = [
      'packageUiFreshTypedProof', 'mainWindow', 'lastPublishedStoreContext',
      'storeBusinessDateAuthorityTimer', 'browserLoginAttempt', 'pendingBrowserLogin',
      'pendingAmazonAdsIdentityConfirmation', 'pendingAmazonAdsIdentityRetry',
    ] as const;
    for (const key of mutable) {
      const descriptor = Object.getOwnPropertyDescriptor(context, key)!;
      expect(descriptor.get).toBeTypeOf('function');
      expect(descriptor.set).toBeTypeOf('function');
      const original = context[key];
      const changed = key === 'browserLoginAttempt' ? 17 : { identity: key };
      descriptor.set!.call(context, changed);
      expect(Reflect.get(access.getMainRuntimeContext(), key)).toBe(changed);
      descriptor.set!.call(context, original);
      expect(Reflect.get(context, key)).toBe(original);
    }
    expect(Reflect.set(context, 'state', {})).toBe(false);
    expect(Reflect.set(context, 'mainIpcOperationTracker', {})).toBe(false);
  });

  it('rereads the active authority and login epoch through A to B to A changes', async () => {
    const { context } = await runtime();
    const browser = await import('./main-browser-session-runtime');
    const stores = await import('./main-store-access-runtime');
    const first = normalizeStoreContextEnvelope({ storeId: 'store-a', browserProfileId: 'profile-a', sessionGeneration: 1, businessDate: '2026-10-15', marketplace: 'US', currency: 'USD', businessTimezone: 'America/Los_Angeles' });
    let active = first;
    const assertActiveStoreContext = vi.fn((candidate: StoreContextEnvelope) => {
      if (JSON.stringify(candidate) !== JSON.stringify(active)) throw new Error('AUTHORITY_CHANGED');
      return active;
    });
    context.state.storeCoordinator = { assertActiveStoreContext } as unknown as NonNullable<typeof context.state.storeCoordinator>;
    context.browserLoginAttempt = 4;
    context.pendingBrowserLogin = { attemptId: 4, context: first, controllers: new Set() };
    expect(() => browser.assertBrowserLoginAttempt(4, first)).not.toThrow();
    active = normalizeStoreContextEnvelope({ ...first, storeId: 'store-b', browserProfileId: 'profile-b' });
    expect(() => browser.assertBrowserLoginAttempt(4, first)).toThrow('AUTHORITY_CHANGED');
    active = { ...first, sessionGeneration: 2 };
    expect(() => browser.assertBrowserLoginAttempt(4, first)).toThrow('AUTHORITY_CHANGED');
    context.packageUiFreshTypedProof = { storeId: 'store-a', username: 'operator-a' };
    expect(stores.hasPackageUiFreshTypedProof('store-a', 'operator-a')).toBe(true);
    context.packageUiFreshTypedProof = { storeId: 'store-b', username: 'operator-b' };
    expect(stores.hasPackageUiFreshTypedProof('store-a', 'operator-a')).toBe(false);
    browser.invalidatePendingBrowserLogin();
    expect(context.browserLoginAttempt).toBe(5);
    expect(context.pendingBrowserLogin).toBeNull();
    expect(() => browser.assertBrowserLoginAttempt(4, active)).toThrow('登录目标店铺已变化');
    expect(assertActiveStoreContext).toHaveBeenCalledTimes(3);
  });

  it('routes direct and registrar IPC through one operation tracker and the shared logger port', async () => {
    const { context } = await runtime();
    const task = deferred();
    context.registerTrackedIpcHandler('composition:direct', () => task.promise);
    context.trackedIpcRegistrar.handle('composition:registrar', () => { throw new Error('PORT_FAILURE'); });
    const operation = ports.handlers.get('composition:direct')!({});
    expect(context.mainIpcOperationTracker.inspect()).toEqual({ stopping: false, activeCount: 1 });
    await expect(ports.handlers.get('composition:registrar')!({})).rejects.toThrow('PORT_FAILURE');
    expect(ports.logger.error).toHaveBeenCalledWith('ipc.handler_failed', expect.objectContaining({ channel: 'composition:registrar' }));
    task.resolve();
    await operation;
    expect(context.mainIpcOperationTracker.inspect().activeCount).toBe(0);
  });

  it('preserves the sealed memory session generation and rejects missing or invalid generations', async () => {
    const { captureTrustedAnalysisCausalMemory } = await import('./main-recommendation-generation-runtime');
    const capture = (sessionGeneration: unknown) => captureTrustedAnalysisCausalMemory({
      memoryDigest: 'a'.repeat(64),
      causalMemory: Object.freeze([Object.freeze({
        eventId: 'event-a', missionId: 'mission-a', stage: 'EFFECT', eventType: 'verified_effect',
        entityType: 'keyword', entityId: 'keyword-a', title: '已验证效果', observedEffect: '当前证据已形成结论',
        status: 'verified', source: 'main', businessDate: '2026-10-15', sessionGeneration,
        proofs: Object.freeze([Object.freeze({ evidenceType: 'readback', evidenceRef: 'evidence-a', sha256: 'b'.repeat(64) })]),
      })]),
    } as unknown as Parameters<typeof captureTrustedAnalysisCausalMemory>[0]);
    expect(capture(3).items[0].sessionGeneration).toBe(3);
    expect(capture(0).items[0].sessionGeneration).toBe(0);
    for (const value of [undefined, null, '3', -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => capture(value)).toThrow('缺少有效会话版本');
    }
  });

  it('starts all four real shutdown barriers synchronously and retains browser and database authority until completion', async () => {
    const { context } = await runtime();
    const ipc = deferred(), scheduler = deferred(), collection = deferred(), execution = deferred();
    const order: string[] = [];
    context.registerTrackedIpcHandler('composition:pending', () => ipc.promise);
    const admitted = ports.handlers.get('composition:pending')!({});
    context.state.scheduler = { stopAndDrain: () => { order.push('scheduler'); return scheduler.promise; } } as unknown as NonNullable<typeof context.state.scheduler>;
    context.state.storeCollectionMainRuntime = {
      stopAndDrain: () => { order.push('collection'); return collection.promise; },
      closeRegistry: async () => { order.push('registry'); },
    } as unknown as NonNullable<typeof context.state.storeCollectionMainRuntime>;
    context.state.executionAuthorityService = { prepareForShutdown: () => { order.push('execution'); return execution.promise; } } as unknown as NonNullable<typeof context.state.executionAuthorityService>;
    context.state.db = { close: () => { order.push('database'); } } as unknown as NonNullable<typeof context.state.db>;
    const quitting = context.handleBeforeQuit({ preventDefault: vi.fn() });
    expect(context.mainIpcOperationTracker.inspect()).toEqual({ stopping: true, activeCount: 1 });
    expect(order).toEqual(['scheduler', 'collection', 'execution']);
    expect(context.state.db).not.toBeNull();
    await expect(ports.handlers.get('composition:pending')!({})).rejects.toMatchObject({ code: 'IPC_ADMISSION_CLOSED' });
    scheduler.resolve(); collection.resolve(); execution.resolve();
    await Promise.resolve();
    expect(order).not.toContain('registry');
    ipc.resolve();
    await admitted;
    await quitting;
    expect(order).toEqual(['scheduler', 'collection', 'execution', 'registry', 'database']);
    expect(context.state.db).toBeNull();
    expect(context.state.storeCollectionMainRuntime).toBeNull();
    expect(ports.quit).toHaveBeenCalledTimes(1);
  });

  it('keeps authority open and reports a failed barrier through the same logger and lifecycle', async () => {
    const { context } = await runtime();
    const closeRegistry = vi.fn(), closeDatabase = vi.fn();
    const failure = new Error('EXECUTION_DRAIN_FAILED');
    const recover = vi.spyOn(context.lifecycleRecovery, 'handleCleanupFailure').mockResolvedValue();
    context.state.storeCollectionMainRuntime = { stopAndDrain: async () => undefined, closeRegistry } as unknown as NonNullable<typeof context.state.storeCollectionMainRuntime>;
    context.state.executionAuthorityService = { prepareForShutdown: async () => { throw failure; } } as unknown as NonNullable<typeof context.state.executionAuthorityService>;
    context.state.db = { close: closeDatabase } as unknown as NonNullable<typeof context.state.db>;
    await context.handleBeforeQuit({ preventDefault: vi.fn() });
    expect(closeRegistry).not.toHaveBeenCalled();
    expect(closeDatabase).not.toHaveBeenCalled();
    expect(context.state.db).not.toBeNull();
    expect(ports.quit).not.toHaveBeenCalled();
    expect(recover).toHaveBeenCalledWith(expect.any(AggregateError));
    expect(ports.logger.error).toHaveBeenCalledWith('main.message', expect.objectContaining({ message: '[App] shutdown execution-authority barrier failed:', details: [failure] }));
  });
});

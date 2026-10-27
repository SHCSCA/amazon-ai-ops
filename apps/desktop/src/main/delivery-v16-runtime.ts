import * as path from 'node:path';
import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import type { ConfigurationBus } from './configuration-bus';
import type { DeliveryRuntimeOptions } from './delivery-runtime';
import type { DeliveryV16WorkerPort, DeliveryV16Operation, DeliveryV16Result } from './delivery-v16-contracts';
import { createDeliveryV16Authority, deliveryAuthoritySha256, DeliveryV16AuthorityError } from './delivery-v16-authority';
import { createDeliveryV16WorkerClient } from './delivery-v16-worker-client';
import { invalidateV16Outputs } from './delivery-v16-output-state';
import { runtimeLogger } from './runtime-logger';
import { missingReadinessView } from './delivery-readiness-view';

export interface DeliveryV16Host {
  readonly mainModulePath: string;
  readonly executablePath: string;
  readonly getStoreContext: () => StoreContextEnvelope | null;
  readonly getConfigurationBus: () => Pick<ConfigurationBus, 'get' | 'subscribe'> | null;
  readonly getMode: (context: StoreContextEnvelope) => { mode: string; revision: number } | null;
  readonly worker?: DeliveryV16WorkerPort;
}

const EMPTY_STATUS = {
  listing: { readReady: false, draftReady: false, contentCount: 0, fullContentCount: 0, draftCount: 0, aiDraftCount: 0, ruleFallbackDraftCount: 0 },
  readback: { verifiedCount: 0 }, package: { installerAvailable: false },
};

export function createV16DeliveryRuntime(options: DeliveryRuntimeOptions, host?: DeliveryV16Host) {
  const logger = {
    info: options.logger.info?.bind(options.logger) ?? runtimeLogger.info.bind(runtimeLogger),
    warn: options.logger.warn?.bind(options.logger) ?? runtimeLogger.warn.bind(runtimeLogger),
    error: options.logger.error.bind(options.logger),
  };
  let configurationRevision = 0;
  let subscribedBus: ReturnType<DeliveryV16Host['getConfigurationBus']>;
  let unsubscribe: (() => void) | undefined;
  let publicationRoot: string | null = null;
  const workRoot = () => {
    const configured = host?.getConfigurationBus()?.get('v16_delivery_work_package_root:v1');
    if (configured && !path.isAbsolute(configured)) throw new Error('V16_WORK_PACKAGE_ROOT_NOT_ABSOLUTE');
    return configured || path.join(options.paths.userDataDir, 'v16-acceptance-work-package');
  };
  const invalidateAuthority = (reason: string) => { publicationRoot = null; authority.invalidate(reason); };
  function subscribeConfiguration() {
    const bus = host?.getConfigurationBus() ?? null;
    if (bus === subscribedBus) return;
    unsubscribe?.();
    subscribedBus = bus;
    configurationRevision += 1;
    invalidateAuthority('configuration-bus-changed');
    unsubscribe = bus?.subscribe(() => { configurationRevision += 1; invalidateAuthority('configuration-revision'); });
  }
  const worker = host?.worker ?? createDeliveryV16WorkerClient({
    shutdownTimeoutMs: () => {
      const value = host?.getConfigurationBus()?.get('v16_delivery_worker_shutdown_timeout_ms:v1');
      const timeout = value ? Number(value) : 5_000;
      if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 60_000) throw new Error('V16_WORKER_SHUTDOWN_TIMEOUT_CONFIGURATION_INVALID');
      return timeout;
    },
    logger, timeoutMs: () => {
      const configured = host?.getConfigurationBus()?.get('v16_delivery_worker_timeout_ms:v1');
      const timeout = configured ? Number(configured) : 300_000;
      if (!Number.isSafeInteger(timeout) || timeout < 1_000 || timeout > 3_600_000) throw new Error('V16_WORKER_TIMEOUT_CONFIGURATION_INVALID');
      return timeout;
    },
  });
  const authority = createDeliveryV16Authority({
    appVersion: options.appVersion, worker, logger, invalidateOutputs: invalidateV16Outputs,
    readAuthority: () => {
      const storeContext = host?.getStoreContext() ?? null;
      const scopeInput = options.getOperationScope();
      const scope = scopeInput ? options.normalizeOperationScope(scopeInput) : null;
      const mode = storeContext ? host?.getMode(storeContext) : null;
      return {
        storeContext, scope, scopeRevision: deliveryAuthoritySha256(scope),
        mode: { value: mode?.mode ?? null, revision: mode?.revision ?? null },
        configurationRevision, workPackageRoot: workRoot(),
      };
    },
    readPaths: () => {
      if (!host) throw new Error('V16_TRUSTED_RUNTIME_HOST_REQUIRED');
      const directory = path.dirname(host.mainModulePath);
      return {
        appRoot: path.resolve(directory, '..', '..'), executablePath: host.executablePath,
        mainBundlePath: host.mainModulePath, workerPath: path.join(directory, 'delivery-v16-worker.cjs'),
        backupHelperPath: path.join(directory, 'delivery-v16-backup-child.cjs'), workPackageRoot: workRoot(),
        cacheRoot: path.join(options.paths.userDataDir, 'v16-verifier-cache'), outputRoot: path.join(options.paths.deliveryBundlesDir, 'v16-current-verification'),
        authorityDbPath: options.paths.databasePath, authoritySnapshotRoot: path.join(workRoot(), 'authority-snapshots'),
        tempRoot: path.join(options.paths.userDataDir, 'v16-verifier-temp'), publicationRoot,
      };
    },
  });
  async function run(operation: DeliveryV16Operation, input?: unknown): Promise<DeliveryV16Result> {
    subscribeConfiguration();
    if (input && Object.keys(input as object).length) {
      const requested = options.normalizeOperationScope(input);
      const current = options.normalizeOperationScope(options.getOperationScope());
      if (deliveryAuthoritySha256(requested) !== deliveryAuthoritySha256(current)) throw new Error('V16_RENDERER_SCOPE_NOT_CURRENT');
    }
    try {
      const result = await authority.run(operation);
      if ((operation !== 'view' && result.refresh?.success) || (operation === 'export' && result.exported?.success)) {
        publicationRoot = path.join(options.paths.deliveryBundlesDir, 'v16-current-verification', result.binding.nonce);
      }
      return result;
    } catch (error) {
      if (error instanceof DeliveryV16AuthorityError || error instanceof AggregateError) throw error;
      logger.error('delivery.v16_runtime_failed', { error, operation });
      const readiness = missingReadinessView('当前验收核验未完成，请检查工作包原件后重新刷新；技术详情已记录到本机日志。', null);
      readiness.actionItems = ['在存储路径中确认当前验收工作包目录。', '补齐 L6 两店真实周期原件、L7 双模式执行回读原件及当前包原件后重新刷新。'];
      return {
        schemaVersion: 'v16.delivery-result/1', binding: { nonce: '', epoch: -1, authoritySha256: '' }, readiness,
        evidenceStatus: EMPTY_STATUS,
        refresh: { success: false, evidenceManifestPath: path.join(workRoot(), 'manifest.json'), finalReadinessPath: '' },
        exported: { success: false, status: 'APP_NEEDS_WORK', message: readiness.message },
      };
    }
  }
  return {
    getReadiness: async () => (await run('view')).readiness,
    getEvidenceStatus: async (input?: unknown) => (await run('view', input)).evidenceStatus ?? EMPTY_STATUS,
    refreshFinalReadiness: async (_input?: { adReadbackPath?: string }) => { const result = await run('refresh'); return { ...result.refresh!, readiness: result.readiness }; },
    exportBundle: async (input?: unknown) => (await run('export', input)).exported!,
    getStoragePaths: () => ({ settingsPath: path.join(options.paths.userDataDir, 'settings.json'), evidenceDir: workRoot(), downloadsDir: options.paths.downloadsDir, exportsDir: options.paths.exportsDir, deliveryDir: options.paths.deliveryBundlesDir, localDbPath: options.paths.databasePath }),
    invalidateAuthority,
    stopAndDrain: (ipcDrain?: () => Promise<void>) => { unsubscribe?.(); return authority.stopAndDrain(ipcDrain); },
  };
}

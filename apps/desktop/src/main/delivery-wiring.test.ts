import { mainRuntimeModuleContract, mainRuntimeFunctionContract, mainRuntimeVariableContract, mainRuntimeSectionContract } from './main-runtime-source.test-support';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = mainRuntimeModuleContract('main-runtime-context.ts');
const ipcSource = mainRuntimeModuleContract('main-ipc-registration-runtime.ts');
const runtimeSource = readFileSync(new URL('./delivery-legacy-runtime.ts', import.meta.url), 'utf8');
const bundleSource = readFileSync(new URL('./delivery-legacy-bundle-export.ts', import.meta.url), 'utf8');

describe('delivery Main assembly', () => {
  it('projects startup configuration paths and injects current state through live callbacks', () => {
    const runtimeOptions = mainRuntimeSectionContract('const deliveryRuntime = createDeliveryRuntime(', 'const exportCurrentDeliveryBundle = createDeliveryBundleExporter(');
    expect(runtimeOptions).toContain('paths: bootstrapConfiguration.paths');
    expect(runtimeOptions).toContain('appVersion: APP_VERSION');
    expect(runtimeOptions).toContain('getDatabase: () => state.db');
    expect(runtimeOptions).toContain('getOperationScope: () => handleGetOperationScope()');
    expect(runtimeOptions).toContain('normalizeOperationScope: normalizePersistedOperationScope');
    expect(runtimeOptions).toContain('getReadbackAccess: () => currentStoreScopedReadbackAccess()');
    expect(runtimeOptions).toContain('logger: runtimeLogger');
    expect(runtimeSource).not.toContain('process.env');
    expect(bundleSource).not.toContain('process.env');
    expect(runtimeSource).toContain("const releaseDir = path.join(paths.repositoryRoot, 'apps', 'desktop', 'release')");
    expect(runtimeSource.match(/currentPackage: getPackageEvidenceStatus\(releaseDir\)/g)).toHaveLength(2);
    expect(runtimeSource).toContain('paths.finalReadinessPath || latestFinalReadinessPath(paths.codexEvidenceDir)');
    const routing = readFileSync(new URL('./delivery-runtime.ts', import.meta.url), 'utf8');
    expect(routing).toContain('return createV16DeliveryRuntime(options, options.v16Host)');
    expect(runtimeOptions).toContain('getStoreContext: () => state.storeCoordinator?.getActiveStoreContext() ?? null');
    expect(runtimeOptions).toContain('getConfigurationBus: () => state.configurationBus');
    expect(runtimeOptions).toContain('getMode: context => state.missionDomainService?.getAutonomyProjection(context) ?? null');
  });

  it('uses the current normalized readiness and Main reconciliation authority for bundle export', () => {
    const bundleOptions = mainRuntimeSectionContract('const exportCurrentDeliveryBundle = createDeliveryBundleExporter(', 'function handleGetDeliveryReadiness(');
    expect(bundleOptions).toContain('paths: bootstrapConfiguration.paths');
    expect(bundleOptions).toContain('getReadiness: () => deliveryRuntime.getReadiness()');
    expect(bundleOptions).toContain('getOperationScope: () => handleGetOperationScope()');
    expect(bundleOptions).toContain('exportDataReconciliation: handleExportDataReconciliation');
    expect(bundleOptions).toContain('logger: runtimeLogger');
    expect(bundleOptions).toContain('exportV16Bundle: deliveryRuntime.exportBundle');
    expect(readFileSync(new URL('./delivery-bundle-export.ts', import.meta.url), 'utf8')).toContain('if (options.exportV16Bundle) return options.exportV16Bundle');
    expect(mainRuntimeFunctionContract('handleExportDeliveryBundle')).toMatch(/function handleExportDeliveryBundle\(input\?: unknown\)\s*\{\s*return exportCurrentDeliveryBundle\(input\);/);
    expect(bundleSource).toContain('if (!readiness.available || !readiness.path)');
    expect(bundleSource).toContain('if (!readiness.manifestDriven)');
    expect(bundleSource).toContain('if (!deliveryReadinessAllowsExport(readiness))');
    expect(bundleSource).toContain('if (!evidenceManifestPath || !fs.existsSync(evidenceManifestPath))');
    expect(bundleSource).toContain("options.logger.error('delivery.data_reconciliation_failed'");
    expect(runtimeSource).toContain("options.logger.error('delivery.readiness_read_failed'");
  });

  it('keeps delivery operations on the shared tracked IPC and runtime logger boundary', () => {
    expect(mainSource).toMatch(/const registerTrackedIpcHandler = createTrackedIpcRegistrar\(\s*ipcMain,\s*mainIpcOperationTracker,\s*runtimeLogger,?\s*\)/);
    for (const [channel, handler] of [
      ['v1_5:delivery:readiness', 'handleGetDeliveryReadiness()'],
      ['v1_5:delivery:refresh-final-readiness', 'handleRefreshFinalReadiness(input)'],
      ['v1_5:delivery:evidence-status', 'handleGetDeliveryEvidenceStatus(scope)'],
      ['v1_5:delivery:export-bundle', 'handleExportDeliveryBundle(scope)'],
      ['v1_5:delivery:export-data-reconciliation', 'handleExportDataReconciliation(scope)'],
      ['v1_5:settings:storage-paths', 'handleGetStoragePaths()'],
    ]) {
      const registration = `registerTrackedIpcHandler('${channel}'`;
      expect(ipcSource.split(registration)).toHaveLength(2);
      const start = ipcSource.indexOf(registration);
      const end = ipcSource.indexOf('\n  );', start);
      expect(ipcSource.slice(start, end)).toContain(handler);
      expect(ipcSource).not.toContain(`ipcMain.handle('${channel}'`);
    }
  });
});

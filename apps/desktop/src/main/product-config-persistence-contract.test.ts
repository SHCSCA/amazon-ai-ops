import { mainRuntimeModuleContracts, mainRuntimeModuleContract, mainRuntimeFunctionContract, mainRuntimeVariableContract, mainRuntimeSectionContract } from './main-runtime-source.test-support';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('desktop product config persistence contract', () => {
  it('retires unversioned product persistence channels', () => {
    const source = mainRuntimeModuleContract('main-ipc-registration-runtime.ts');
    const preload = readFileSync(new URL('../preload/index.ts', import.meta.url), 'utf8');

    for (const module of mainRuntimeModuleContracts()) { expect(module.source).not.toContain("registerTrackedIpcHandler('products:save-config'"); }
    for (const module of mainRuntimeModuleContracts()) { expect(module.source).not.toContain("registerTrackedIpcHandler('products:bulk-update-target-acos'"); }
    expect(preload).not.toContain("ipcRenderer.invoke('products:save-config'");
    expect(preload).not.toContain("ipcRenderer.invoke('products:bulk-update-target-acos'");
  });

  it('keeps price and target writes behind the canonical StoreContext and revision bridge', () => {
    const preload = readFileSync(new URL('../preload/index.ts', import.meta.url), 'utf8');
    const service = readFileSync(new URL('./store-scoped-objects-service.ts', import.meta.url), 'utf8');

    expect(preload).toContain("ipcRenderer.invoke('store-objects:products:update', { storeContext, input })");
    expect(service).toContain("const PRODUCT_UPDATE_KEYS = new Set(['id', 'expectedRevision'");
    expect(service).toContain("'currentPrice'");
    expect(service).toContain("'targetAcos'");
    expect(service).toContain('runImmediateRevisionTransaction(expectedRevision');
  });
});

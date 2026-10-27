import { mainRuntimeModuleContract, mainRuntimeFunctionContract, mainRuntimeVariableContract, mainRuntimeSectionContract } from './main-runtime-source.test-support';
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

describe('Main readback store isolation wiring', () => {
  it('captures current store authority for every readback IPC and avoids global export roots', () => {
    const source = mainRuntimeModuleContract('main-ad-execution-runtime.ts');
    const handlers = source.slice(source.indexOf('export function handleExportAdReadbackEvidence'), source.indexOf('export async function handleExecuteRecommendation'));

    expect(handlers).not.toContain("path.join(EXPORTS_DIR, 'ad-readback");
    expect(handlers.match(/currentStoreScopedReadbackAccess\(/g)).toHaveLength(6);
    expect(handlers).toContain('withReadbackStoreBinding(buildAdReadbackEvidence(evidenceInput), readbackAccess)');
    expect(handlers).toContain('storeAccess: readbackAccess');
    expect(handlers).toMatch(/resolveStoreScopedReadbackReference\(\s*readbackAccess,/);
    expect(handlers).toContain('assertStoreScopedReadbackEvidenceData(evidence, readbackAccess, { requireBinding: true })');
  });

  it('binds the seventh readback entry and delivery status to the current capsule without global fallback', () => {
    const source = mainRuntimeModuleContract('main-ad-execution-runtime.ts');
    const deliverySource = readFileSync(new URL('./delivery-legacy-runtime.ts', import.meta.url), 'utf8');
    const refreshHandler = mainRuntimeSectionContract('function handleRefreshFinalReadiness', 'function recordAdActionReasonAiCallLog');
    const statusHandler = mainRuntimeSectionContract('function handleGetDeliveryEvidenceStatus', 'function normalizePersistedOperationScope');
    const deliveryOptions = mainRuntimeSectionContract('const deliveryRuntime = createDeliveryRuntime(', 'const exportCurrentDeliveryBundle = createDeliveryBundleExporter(');
    const deliveryStatus = deliverySource.slice(
      deliverySource.indexOf('function getEvidenceStatus('),
      deliverySource.indexOf('function refreshReadiness('),
    );
    const refresh = deliverySource.slice(deliverySource.indexOf('function refreshReadiness('));

    expect(refreshHandler).toContain('return deliveryRuntime.refreshFinalReadiness(input);');
    expect(statusHandler).toContain('return deliveryRuntime.getEvidenceStatus(input);');
    expect(deliveryOptions).toContain('getReadbackAccess: () => currentStoreScopedReadbackAccess()');
    expect(deliveryOptions).toContain('getDatabase: () => state.db');
    expect(deliveryOptions).toContain('getOperationScope: () => handleGetOperationScope()');
    expect(refresh).toContain('const readbackAccess = options.getReadbackAccess();');
    expect(refresh).toContain("readStoreScopedReadbackEvidenceFile(readbackAccess, requestedPath, 'root')");
    expect(refresh).toContain('latestStoreScopedReadbackCandidate(readbackAccess)');
    expect(refresh).toContain(
      "?? resolveStoreScopedReadbackReference(readbackAccess, 'real-ad-execution-readback-missing.json', 'candidates')",
    );
    expect(refresh).toContain('adReadbackPath,');
    expect(refresh).not.toContain('adReadbackPath: typeof input?.adReadbackPath');
    expect(deliveryStatus).toContain('const readbackAccess = options.getReadbackAccess();');
    expect(deliveryStatus).toContain('db: options.getDatabase()');
    expect(deliveryStatus).toContain('storeId: readbackAccess.binding.storeId');
    expect(deliveryStatus).toContain('readbackDir: readbackAccess.rootDir');
    expect(deliveryStatus).toContain('readbackAccess,');
    expect(deliveryStatus).not.toContain("path.join(EXPORTS_DIR, 'ad-readback-evidence')");
  });
});

import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

describe('Main readback store isolation wiring', () => {
  it('captures current store authority for every readback IPC and avoids global export roots', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    const handlers = source.slice(
      source.indexOf('function handleExportAdReadbackEvidence'),
      source.indexOf('async function handleExecuteRecommendation'),
    );

    expect(handlers).not.toContain("path.join(EXPORTS_DIR, 'ad-readback");
    expect(handlers.match(/currentStoreScopedReadbackAccess\(/g)).toHaveLength(6);
    expect(handlers).toContain('withReadbackStoreBinding(buildAdReadbackEvidence(evidenceInput), readbackAccess)');
    expect(handlers).toContain('storeAccess: readbackAccess');
    expect(handlers).toContain("resolveStoreScopedReadbackReference(\n    readbackAccess");
    expect(handlers).toContain('assertStoreScopedReadbackEvidenceData(evidence, readbackAccess, { requireBinding: true })');
  });

  it('binds the seventh readback entry and delivery status to the current capsule without global fallback', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    const refresh = source.slice(
      source.indexOf('function handleRefreshFinalReadiness'),
      source.indexOf('function recordAdActionReasonAiCallLog'),
    );
    const deliveryStatus = source.slice(
      source.indexOf('function handleGetDeliveryEvidenceStatus'),
      source.indexOf('function normalizePersistedOperationScope'),
    );

    expect(refresh).toContain('currentStoreScopedReadbackAccess()');
    expect(refresh).toContain("readStoreScopedReadbackEvidenceFile(readbackAccess, requestedPath, 'root')");
    expect(refresh).toContain('latestStoreScopedReadbackCandidate(readbackAccess)');
    expect(refresh).toContain('adReadbackPath,');
    expect(refresh).not.toContain('adReadbackPath: typeof input?.adReadbackPath');
    expect(deliveryStatus).toContain('readbackDir: readbackAccess.rootDir');
    expect(deliveryStatus).toContain('readbackAccess,');
    expect(deliveryStatus).not.toContain("path.join(EXPORTS_DIR, 'ad-readback-evidence')");
  });
});

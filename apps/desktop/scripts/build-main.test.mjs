import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildMain, EXTERNALS } from './build-main.js';

describe('Main and portable verifier build', () => {
  it('bundles three fixed responsibilities and embeds the trusted snapshot only into the verifier', () => {
    const frozen = { identity: { sourceSha256: 'a'.repeat(64) }, requiredManifestDefinition: { testFiles: ['actual.test.ts'] } };
    const buildSync = vi.fn(), collectFrozenBuild = vi.fn(() => frozen), writeBuildState = vi.fn();
    expect(buildMain({ root: path.resolve('F:/Temp/amazon-ai-ops-development-tests/build-contract'), buildSync, collectFrozenBuild, writeBuildState })).toBe(frozen.identity);
    expect(writeBuildState.mock.calls.map(([state]) => state.status)).toEqual(['BUILDING', 'CURRENT']);
    expect(collectFrozenBuild).toHaveBeenCalledTimes(2);
    expect(buildSync).toHaveBeenCalledTimes(3);
    expect(buildSync.mock.calls.map(([options]) => path.basename(options.entryPoints[0]))).toEqual(['index.ts', 'delivery-v16-worker.ts', 'delivery-v16-backup-child.ts']);
    expect(buildSync.mock.calls[0][0].define).toBeUndefined();
    expect(JSON.parse(buildSync.mock.calls[1][0].define.__V16_FROZEN_BUILD_JSON__)).toBe(JSON.stringify(frozen));
    expect(buildSync.mock.calls[2][0].define).toBeUndefined();
    expect(EXTERNALS).toContain('better-sqlite3');
    expect(buildSync.mock.calls.every(([options]) => options.bundle && options.platform === 'node')).toBe(true);
  });
  it('refuses a source or definition change while the three bundles are being built', () => {
    const collectFrozenBuild = vi.fn().mockReturnValueOnce({ identity: { sourceSha256: 'a' } }).mockReturnValueOnce({ identity: { sourceSha256: 'b' } });
    const writeBuildState = vi.fn();
    expect(() => buildMain({ root: path.resolve('F:/Temp/amazon-ai-ops-development-tests/build-contract'), buildSync: vi.fn(), collectFrozenBuild, writeBuildState })).toThrow('V16_BUILD_SOURCE_CHANGED_DURING_BUNDLE');
    expect(writeBuildState.mock.calls.map(([state]) => state.status)).toEqual(['BUILDING', 'STALE']);
  });
});

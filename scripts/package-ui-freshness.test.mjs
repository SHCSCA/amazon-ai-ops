import {
  HASH_A,
  HASH_B,
  buildProductionBuildContentManifest,
  describe,
  expect,
  it,
  latestProductionSourceWatermark,
  mkdirSync,
  mkdtempSync,
  path,
  rmSync,
  tmpdir,
  utimesSync,
  validatePackageFreshness,
  writeFileSync,
} from './package-ui-test-context.mjs';
import {
  withProductionBuildPayload,
} from './package-ui-test-fixtures.mjs';

describe('unpacked package freshness', () => {
  it('accepts a current build that is newer than source and byte-identical to packaged dist', () => {
    const result = validatePackageFreshness({
      buildContent: { oldestMtimeMs: 2_000, sha256: HASH_A },
      packagedDistContent: { sha256: HASH_A },
      sourceWatermark: { mtimeMs: 1_000, path: 'apps/desktop/src/renderer/app.tsx' },
    });
    expect(result).toEqual({ passed: true, violations: [] });
  });

  it('hashes only current main, preload and renderer production outputs, ignoring historical package residue', () => {
    withProductionBuildPayload((root) => {
      const manifest = buildProductionBuildContentManifest(root);
      expect(manifest.files.map((file) => file.path)).toEqual([
        'main/index.cjs',
        'main/index.js',
        'preload/index.cjs',
        'preload/index.js',
        'renderer/assets/index.css',
        'renderer/assets/index.js',
        'renderer/index.html',
      ]);
      expect(manifest.files.some((file) => /win-unpacked|linux-unpacked|\.d\.ts|\.map|main-test/.test(file.path))).toBe(false);
      expect(manifest.oldestMtimeMs).toBeGreaterThan(new Date('2025-01-01T00:00:00.000Z').getTime());
    });
  });

  it('compares current and packaged production payloads independently of different historical residue', () => {
    withProductionBuildPayload((currentRoot) => {
      withProductionBuildPayload((packagedRoot) => {
        writeFileSync(path.join(currentRoot, 'win-unpacked/historical.exe'), 'current-old-package', 'utf8');
        writeFileSync(path.join(packagedRoot, 'win-unpacked/historical.exe'), 'different-old-package', 'utf8');
        writeFileSync(path.join(currentRoot, 'main/index.d.ts'), 'current-old-types', 'utf8');
        writeFileSync(path.join(packagedRoot, 'main/index.d.ts'), 'different-old-types', 'utf8');

        const current = buildProductionBuildContentManifest(currentRoot);
        const packaged = buildProductionBuildContentManifest(packagedRoot);
        expect(packaged.sha256).toBe(current.sha256);
        expect(packaged.files).toEqual(current.files);
      });
    });
  });

  it('fails closed when a required production-build runtime entry is absent', () => {
    withProductionBuildPayload((root) => {
      rmSync(path.join(root, 'main/index.cjs'));
      expect(() => buildProductionBuildContentManifest(root)).toThrow(/required desktop production-build entry is missing.*main\/index\.cjs/i);
    });
  });

  it('ignores test files and historical build directories when finding the latest production source', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'amazon-ai-ops-production-source-'));
    try {
      const productionSource = path.join(root, 'src/app.tsx');
      const productionStyle = path.join(root, 'src/style.css');
      const testSource = path.join(root, 'src/app.test.tsx');
      const nestedTestSource = path.join(root, 'src/__tests__/newer.ts');
      const historicalBuild = path.join(root, 'release/win-unpacked/old.js');
      for (const filePath of [productionSource, productionStyle, testSource, nestedTestSource, historicalBuild]) {
        mkdirSync(path.dirname(filePath), { recursive: true });
        writeFileSync(filePath, filePath, 'utf8');
      }
      utimesSync(productionSource, new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'));
      utimesSync(productionStyle, new Date('2026-01-02T00:00:00Z'), new Date('2026-01-02T00:00:00Z'));
      utimesSync(testSource, new Date('2026-02-01T00:00:00Z'), new Date('2026-02-01T00:00:00Z'));
      utimesSync(nestedTestSource, new Date('2026-03-01T00:00:00Z'), new Date('2026-03-01T00:00:00Z'));
      utimesSync(historicalBuild, new Date('2026-04-01T00:00:00Z'), new Date('2026-04-01T00:00:00Z'));

      const watermark = latestProductionSourceWatermark([root]);
      expect(path.normalize(watermark.path)).toBe(path.normalize(productionStyle));
      expect(watermark.mtimeMs).toBe(new Date('2026-01-02T00:00:00Z').getTime());
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it.each([
    [
      'source newer than the oldest current build artifact',
      {
        buildContent: { oldestMtimeMs: 1_000, sha256: HASH_A },
        packagedDistContent: { sha256: HASH_A },
        sourceWatermark: { mtimeMs: 5_000, path: 'apps/desktop/src/renderer/app.tsx' },
      },
      'CURRENT_BUILD_STALE',
    ],
    [
      'packaged dist differing from the current build',
      {
        buildContent: { oldestMtimeMs: 5_000, sha256: HASH_A },
        packagedDistContent: { sha256: HASH_B },
        sourceWatermark: { mtimeMs: 1_000, path: 'apps/desktop/src/renderer/app.tsx' },
      },
      'PACKAGED_DIST_MISMATCH',
    ],
  ])('rejects %s', (_label, input, code) => {
    const result = validatePackageFreshness(input);
    expect(result.passed).toBe(false);
    expect(result.violations).toEqual(expect.arrayContaining([expect.objectContaining({ code })]));
  });
});

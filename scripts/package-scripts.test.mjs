import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'url';
import vitestConfig from '../vitest.config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

describe('root package smoke scripts', () => {
  it('keeps the release version aligned across package, Main, ZIP smoke, and v1.5 evidence gates', () => {
    const rootPackage = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const desktopPackage = JSON.parse(fs.readFileSync(path.join(root, 'apps', 'desktop', 'package.json'), 'utf8'));
    const mainSource = fs.readFileSync(path.join(root, 'apps', 'desktop', 'src', 'main', 'index.ts'), 'utf8');
    const zipSmoke = fs.readFileSync(path.join(root, 'scripts', 'smoke-folder-zip-launch.ps1'), 'utf8');
    const listingDraftSmoke = fs.readFileSync(path.join(root, 'scripts', 'smoke-listing-draft-renderer.js'), 'utf8');
    const versionHelper = fs.readFileSync(path.join(root, 'scripts', 'current-app-version.js'), 'utf8');
    const evidenceGates = [
      'verify-v15-diagnostic-evidence.js',
      'verify-v15-canary-evidence.js',
      'verify-v15-delivery-evidence.js',
      'verify-v15-enablement-evidence.js',
    ].map((file) => fs.readFileSync(path.join(root, 'scripts', file), 'utf8'));

    expect(rootPackage.version).toBe('1.5.1');
    expect(desktopPackage.version).toBe(rootPackage.version);
    expect(mainSource).toContain(`const APP_VERSION = '${rootPackage.version}'`);
    expect(mainSource).toContain("registerTrackedIpcHandler('app:get-version', () => APP_VERSION)");
    expect(zipSmoke).toContain('$desktopPackageVersion');
    expect(zipSmoke).not.toContain('AmazonAIOpsAgent-1.5.0.zip');
    expect(rootPackage.scripts['smoke:listing-draft-renderer']).toBe('node scripts/smoke-listing-draft-renderer.js');
    expect(listingDraftSmoke).toContain("require('./current-app-version')");
    expect(listingDraftSmoke).toContain('getVersion: async () => version');
    expect(listingDraftSmoke).not.toContain("getVersion: async () => '1.5.0'");
    expect(versionHelper).toContain('Root/desktop version mismatch');
    for (const gate of evidenceGates) {
      expect(gate).toContain("require('./current-app-version')");
      expect(gate).not.toMatch(/app_version\s*===\s*'1\.5\.0'|app_version\s*=\s*'1\.5\.0'/);
    }
  });

  it('prepares the shared SQLite native module for Node before Vitest runs', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

    expect(packageJson.scripts['prepare:native:node'])
      .toBe('node scripts/prepare-native-runtime.js --mode=node');
    expect(packageJson.scripts['prepare:native:node']).not.toMatch(/pnpm|rebuild|duckdb/i);
    expect(packageJson.scripts.pretest).toBe('pnpm run prepare:native:node');
    expect(packageJson.scripts.test).toBe('vitest run');
  });

  it('uses isolated fork workers for direct and package-script Vitest runs', () => {
    expect(vitestConfig).toMatchObject({
      test: {
        pool: 'forks',
        maxWorkers: 4,
        minWorkers: 1,
      },
    });
  });

  it('uses one locked orchestrator with isolated Electron binding injection', () => {
    const desktopPackageJson = JSON.parse(fs.readFileSync(path.join(root, 'apps', 'desktop', 'package.json'), 'utf8'));
    const electronBuilder = fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8');
    const orchestrator = fs.readFileSync(path.join(root, 'scripts', 'build-windows-package.js'), 'utf8');
    const afterPack = fs.readFileSync(path.join(root, 'scripts', 'electron-builder-after-pack.js'), 'utf8');

    expect(desktopPackageJson.scripts['prepare:native:electron']).toBeUndefined();
    expect(desktopPackageJson.scripts.prebuild).toBeUndefined();
    expect(desktopPackageJson.scripts.postbuild).toBeUndefined();
    expect(desktopPackageJson.scripts.build)
      .toBe('node ../../scripts/build-windows-package.js');
    expect(desktopPackageJson.scripts['build:win'])
      .toBe('node ../../scripts/build-windows-package.js');
    expect(orchestrator).toContain('withNativeRuntimeLock');
    expect(orchestrator).toContain('withPreparedIsolatedElectronRuntime');
    expect(orchestrator).toContain("mode: 'package'");
    expect(orchestrator).not.toMatch(/install-app-deps|pnpm rebuild/i);
    expect(electronBuilder).toMatch(/\bnpmRebuild:\s*false\b/);
    expect(electronBuilder).toContain('afterPack: ../../scripts/electron-builder-after-pack.js');
    expect(afterPack).toContain('AAO_STAGED_SQLITE_BINDING');
    expect(afterPack).toContain('fs.unlinkSync(existingTarget)');
  });

  it('routes the legacy v1.5 UI smoke command to the current business UI suite', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

    expect(packageJson.scripts['smoke:business-ui-current']).toBe('node scripts/smoke-current-business-ui.js');
    expect(packageJson.scripts['smoke:package-launch']).toBe('node scripts/smoke-package-launch.js');
    expect(packageJson.scripts['smoke:v15-product-readiness-ui']).toBe('pnpm run smoke:business-ui-current');
    expect(packageJson.scripts['smoke:v15-product-readiness-ui']).not.toContain('smoke-v15-product-readiness-ui.js');
  });

  it('exposes package security evidence and requires its explicit handoff in both safety branches', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const exporter = fs.readFileSync(path.join(root, 'scripts', 'export-v15-delivery-bundle.js'), 'utf8');
    const finalReadiness = fs.readFileSync(path.join(root, 'scripts', 'verify-v15-final-readiness.js'), 'utf8');
    const evidenceManifestWriter = fs.readFileSync(path.join(root, 'scripts', 'write-v15-evidence-manifest.js'), 'utf8');
    const nonReadySafety = fs.readFileSync(path.join(root, 'scripts', 'verify-v15-non-ready-safety.js'), 'utf8');
    const readySafety = fs.readFileSync(path.join(root, 'scripts', 'verify-v15-ready-safety.js'), 'utf8');

    expect(packageJson.scripts['smoke:package-security-boundaries'])
      .toBe('node scripts/smoke-package-security-boundaries.js');
    expect(packageJson.scripts['smoke:package-adversarial-node-env'])
      .toBe('node scripts/smoke-package-adversarial-node-env.js');
    expect(exporter).toContain("explicitFileArg(args, 'package-security-evidence')");
    expect(exporter).toContain("explicitFileArg(args, 'package-adversarial-node-env-evidence')");
    expect(exporter).toContain('scripts/smoke-package-security-boundaries.js');
    expect(exporter).toContain('scripts/smoke-package-adversarial-node-env.js');
    expect(finalReadiness).toContain('evidenceSha256: sha256File(evidencePath)');
    expect(exporter).toContain('selected?.evidenceSha256');
    expect(evidenceManifestWriter).toContain('PACKAGE_ADVERSARIAL_NODE_ENV_CONTRACT_VERSION');
    expect(evidenceManifestWriter).toMatch(/packageAdversarialNodeEnv:\s*\{[\s\S]*?contractVersion:[\s\S]*?true,\s*\),/s);
    expect(exporter).toContain('validateAdversarialNodeEnvSelectionContract');
    expect(nonReadySafety).toContain('validateAdversarialNodeEnvSelectionContract');
    expect(readySafety).toContain('validateAdversarialNodeEnvSelectionContract');
    expect(nonReadySafety).toContain("args['package-security-evidence']");
    expect(nonReadySafety).toContain("args['package-adversarial-node-env-evidence']");
    expect(nonReadySafety).toContain('selected?.evidenceSha256');
    expect(readySafety).toContain("args.get('package-security-evidence')");
    expect(readySafety).toContain("args.get('package-adversarial-node-env-evidence')");
    expect(readySafety).toContain('selected?.evidenceSha256');
  });

  it('keeps delivery bundle extras aligned with the current business UI smoke artifact', () => {
    const exporter = fs.readFileSync(path.join(root, 'scripts', 'export-v15-delivery-bundle.js'), 'utf8');

    expect(exporter).toContain('current-business-ui-smoke-');
    expect(exporter.indexOf('current-business-ui-smoke-')).toBeLessThan(exporter.indexOf('v15-product-readiness-ui-smoke-'));
  });

  it('exposes the ad readback session preparation helper in package scripts and delivery bundle extras', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const exporter = fs.readFileSync(path.join(root, 'scripts', 'export-v15-delivery-bundle.js'), 'utf8');

    expect(packageJson.scripts['prepare:ad-readback-session']).toBe('node scripts/prepare-ad-readback-session.js');
    expect(packageJson.scripts['verify:ad-readback-session']).toBe('node scripts/verify-ad-readback-session.js');
    expect(packageJson.scripts['fill:ad-readback-session']).toBe('node scripts/fill-ad-readback-session.js');
    expect(exporter).toContain('scripts/prepare-ad-readback-session.js');
    expect(exporter).toContain('scripts/verify-ad-readback-session.js');
    expect(exporter).toContain('scripts/fill-ad-readback-session.js');
    expect(exporter.indexOf('scripts/create-ad-readback-candidate-from-recommendation.js'))
      .toBeLessThan(exporter.indexOf('scripts/prepare-ad-readback-session.js'));
    expect(exporter.indexOf('scripts/prepare-ad-readback-session.js'))
      .toBeLessThan(exporter.indexOf('scripts/verify-ad-readback-session.js'));
    expect(exporter.indexOf('scripts/verify-ad-readback-session.js'))
      .toBeLessThan(exporter.indexOf('scripts/fill-ad-readback-session.js'));
    expect(exporter.indexOf('scripts/fill-ad-readback-session.js'))
      .toBeLessThan(exporter.indexOf('scripts/fill-ad-readback-evidence.js'));
  });

  it('exposes the WAL-safe Mission Control authority snapshot exporter', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

    expect(packageJson.scripts['export:s7-authority-snapshot'])
      .toBe('node scripts/export-mission-control-authority-snapshot.js');
  });

  it('exposes the read-only Mission Control execution canary evidence exporter', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

    expect(packageJson.scripts['export:s7-execution-canary'])
      .toBe('node scripts/export-mission-control-execution-canary-evidence.js');
  });

  it('documents the independent readback value and stable target identity inputs', () => {
    const runbook = fs.readFileSync(path.join(root, 'docs', 'REAL_AD_READBACK_RUNBOOK.md'), 'utf8');
    const userGuide = fs.readFileSync(path.join(root, 'docs', 'USER_GUIDE_v1_5.md'), 'utf8');

    expect(runbook).toContain('--readback-actual-value "<independently observed reload value>"');
    expect(userGuide).toContain('--entity-id "<opaque Ads UI/API writable object id>"');
    expect(userGuide).toContain('--identity-proof "C:\\path\\to\\target-identity-proof.json"');
    expect(userGuide).toContain('target.identityProofPath');
  });

  it('documents the current final handoff order with matching READY and NON_READY safety branches', () => {
    const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
    const userGuide = fs.readFileSync(path.join(root, 'docs', 'USER_GUIDE_v1_5.md'), 'utf8');
    const nonReadyMarker = '如果最终验收为 `APP_NEEDS_WORK`，README 顶部 DELIVERY 行必须保持非 READY';
    const readyMarker = '只有最终验收为 `APP_READY` 时，README 顶部 DELIVERY 行才切到 `APP_READY`';

    for (const doc of [readme, userGuide]) {
      expect(doc).toContain('pnpm --filter @amazon-ai-ops/desktop run build:win');
      expect(doc).toContain(nonReadyMarker);
      expect(doc).toContain(readyMarker);
      const handoffStart = Math.max(
        doc.indexOf('生产交付顺序固定为'),
        doc.indexOf('### Release order'),
      );
      expect(handoffStart).toBeGreaterThanOrEqual(0);
      const handoff = doc.slice(handoffStart);
      const buildIndex = handoff.indexOf('pnpm --filter @amazon-ai-ops/desktop run build:win');
      const finalReadinessIndex = handoff.indexOf('pnpm run verify:v15-final-readiness', buildIndex);
      const nonReadyMarkerIndex = handoff.indexOf(nonReadyMarker, finalReadinessIndex);
      const nonReadyExportIndex = handoff.indexOf('pnpm run export:v15-delivery-bundle', nonReadyMarkerIndex);
      const nonReadySafetyIndex = handoff.indexOf('pnpm run verify:v15-non-ready-safety', nonReadyExportIndex);
      const readyMarkerIndex = handoff.indexOf(readyMarker, nonReadySafetyIndex);
      const readyExportIndex = handoff.indexOf('pnpm run export:v15-delivery-bundle', readyMarkerIndex);
      const readySafetyIndex = handoff.indexOf('pnpm run verify:v15-ready-safety', readyExportIndex);

      expect(buildIndex).toBeGreaterThanOrEqual(0);
      expect(finalReadinessIndex).toBeGreaterThan(buildIndex);
      expect(nonReadyMarkerIndex).toBeGreaterThan(finalReadinessIndex);
      expect(nonReadyExportIndex).toBeGreaterThan(nonReadyMarkerIndex);
      expect(nonReadySafetyIndex).toBeGreaterThan(nonReadyExportIndex);
      expect(readyMarkerIndex).toBeGreaterThan(nonReadySafetyIndex);
      expect(readyExportIndex).toBeGreaterThan(readyMarkerIndex);
      expect(readySafetyIndex).toBeGreaterThan(readyExportIndex);
    }

    const nonReadySafetyCommand = userGuide
      .split(/\r?\n/)
      .find((line) => line.includes('pnpm run verify:v15-non-ready-safety'));
    expect(nonReadySafetyCommand).toContain('--package-launch-smoke');
    expect(nonReadySafetyCommand).not.toContain('--ui-smoke');
  });
});

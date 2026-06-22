import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

describe('root package smoke scripts', () => {
  it('routes the legacy v1.5 UI smoke command to the current business UI suite', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

    expect(packageJson.scripts['smoke:business-ui-current']).toBe('node scripts/smoke-current-business-ui.js');
    expect(packageJson.scripts['smoke:package-launch']).toBe('node scripts/smoke-package-launch.js');
    expect(packageJson.scripts['smoke:v15-product-readiness-ui']).toBe('pnpm run smoke:business-ui-current');
    expect(packageJson.scripts['smoke:v15-product-readiness-ui']).not.toContain('smoke-v15-product-readiness-ui.js');
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

  it('documents the current final handoff order: build packages, verify final readiness, update README, export bundle, then run READY safety', () => {
    const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
    const userGuide = fs.readFileSync(path.join(root, 'docs', 'USER_GUIDE_v1_5.md'), 'utf8');
    const readmeReadyMarker = 'README 顶部 DELIVERY 行切到当前证据对应的 `APP_READY`';

    for (const doc of [readme, userGuide]) {
      expect(doc).toContain('pnpm --filter @amazon-ai-ops/desktop run build:win');
      expect(doc).toContain(readmeReadyMarker);
      const buildIndex = doc.indexOf('pnpm --filter @amazon-ai-ops/desktop run build:win');
      const finalReadinessIndex = doc.indexOf('pnpm run verify:v15-final-readiness', buildIndex);
      const readmeMarkerIndex = doc.indexOf(readmeReadyMarker, finalReadinessIndex);
      const exportIndex = doc.indexOf('pnpm run export:v15-delivery-bundle', readmeMarkerIndex);
      const readySafetyIndex = doc.indexOf('pnpm run verify:v15-ready-safety', exportIndex);

      expect(buildIndex).toBeGreaterThanOrEqual(0);
      expect(finalReadinessIndex).toBeGreaterThan(buildIndex);
      expect(readmeMarkerIndex).toBeGreaterThan(finalReadinessIndex);
      expect(exportIndex).toBeGreaterThan(readmeMarkerIndex);
      expect(readySafetyIndex).toBeGreaterThan(exportIndex);
    }
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('package launch smoke isolated userData source contract', () => {
  it('creates disjoint D-drive profiles and passes the explicit main-process override to both launch modes', () => {
    const source = readFileSync('scripts/smoke-package-launch.js', 'utf8');
    expect(source).toContain("path.join('D:\\\\Temp', 'amazon-ai-ops-package-launch-smoke', String(runId))");
    expect(source).toContain("unpacked: prepareIsolatedUserData('win-unpacked')");
    expect(source).toContain("portable: prepareIsolatedUserData('portable')");
    expect(source).toContain('launchUnpacked(unpackedExe, isolatedUserData.unpacked)');
    expect(source).toContain('launchPortable(portableExe, isolatedUserData.portable)');
    expect(source.indexOf('if (!userDataOverrideBundleContract.passed)')).toBeLessThan(source.indexOf('launchUnpacked(unpackedExe'));
    expect(source.match(/buildEvidenceUserDataEnv\(process\.env, PACKAGE_LAUNCH_SMOKE_MODE, userDataDir\)/g)).toHaveLength(2);
    expect(source).toContain("spawnSync('powershell.exe', ['-NoProfile', '-Command', bootstrapScript]");
    expect(source).toContain("'-WindowStyle Hidden'");
    expect(source).toContain('const deadline = Date.now() + 120000');
  });

  it('requires a runtime marker and exact userData identity before either smoke check can pass', () => {
    const source = readFileSync('scripts/smoke-package-launch.js', 'utf8');
    expect(source).toContain('readEvidenceUserDataRuntimeMarker(userDataDir)');
    expect(source).toContain('validateEvidenceUserDataIdentity({');
    expect(source).toContain('ok: Boolean(marker) && userDataEvidence.passed');
    expect(source).toContain('ok: appChildren.length > 0 && userDataEvidence.passed');
    expect(source).toContain('userDataEvidence,');
  });
});

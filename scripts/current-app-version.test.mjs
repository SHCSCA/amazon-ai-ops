import { describe, expect, it } from 'vitest';
import versionHelper from './current-app-version.js';
import fs from 'node:fs';
import buildHelper from './build-windows-package.js';

const { currentAppVersion, isValidAppVersion } = versionHelper;
describe('development app version contract', () => {
  it.each(['1.6.0', '1.6.1-dev.1', '0.0.0', '1.6.1-rc.2+build.7'])('accepts SemVer %s', value => {
    expect(isValidAppVersion(value)).toBe(true);
  });
  it.each(['01.6.1', '1.06.1', '1.6.01', '1.6.1-dev.01', '1.6.1-', '1.6.1+','v1.6.1', '1.6', '1.6.1-dev..1', '', null, 161])('rejects invalid version %s', value => {
    expect(isValidAppVersion(value)).toBe(false);
  });
  it('resolves prerelease Windows artifacts without building', () => {
    const outputs = buildHelper.resolveExpectedPackageOutputs();
    expect(outputs.installerPath).toMatch(/AmazonAIOpsAgent-1\.6\.1-dev\.1\.exe$/);
    expect(outputs.folderZipPath).toMatch(/AmazonAIOpsAgent-1\.6\.1-dev\.1\.zip$/);
  });
  it('keeps PowerShell ZIP version validation compatible with SemVer', () => {
    const script = fs.readFileSync(new URL('./smoke-folder-zip-launch.ps1', import.meta.url), 'utf8');
    const pattern = script.match(/-notmatch '([^']+)'/)[1];
    expect(new RegExp(pattern).test(currentAppVersion())).toBe(true);
    for (const bad of ['01.6.1', '1.6.1-dev.01', '1.6.1/evil']) expect(new RegExp(pattern).test(bad)).toBe(false);
  });
  it('keeps root, desktop and Main product versions aligned', () => {
    const version = currentAppVersion();
    const main = fs.readFileSync(new URL('../apps/desktop/src/main/main-runtime-context.ts', import.meta.url), 'utf8');
    expect(main).toContain(`const APP_VERSION = '${version}';`);
  });
});

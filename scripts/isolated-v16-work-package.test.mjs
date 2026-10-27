import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertDirectRuntimePath, assertRuntimeWorkPackageUnchanged, copyIsolatedWorkPackage, createMinimalIsolatedWorkPackage, snapshotRuntimeWorkPackage } from './isolated-v16-work-package.mjs';

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    const resolved = path.resolve(root);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('amazon-isolated-workpack-')) throw new Error('拒绝清理非本次测试目录。');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-isolated-workpack-')); roots.push(root);
  const source = path.join(root, 'original'), profile = path.join(root, 'profile');
  fs.mkdirSync(source); fs.mkdirSync(profile); fs.mkdirSync(path.join(source, 'originals'));
  fs.writeFileSync(path.join(source, 'manifest.json'), '{"status":"NON_READY"}\n');
  fs.writeFileSync(path.join(source, 'originals', 'readback.json'), '{"passed":false}\n');
  return { root, source, profile };
}

describe('isolated packaged work package originals', () => {
  it('copies unchanged original bytes into only the fresh isolated profile and preserves the source identity', () => {
    const { source, profile } = fixture(); const before = snapshotRuntimeWorkPackage(source);
    const result = copyIsolatedWorkPackage(source, profile);
    expect(result.destination).toBe(path.join(profile, 'v16-acceptance-work-package'));
    expect(result.formalAcceptanceCredit).toBe(false); expect(snapshotRuntimeWorkPackage(source)).toEqual(before);
    expect(fs.readFileSync(path.join(result.destination, 'manifest.json'))).toEqual(fs.readFileSync(path.join(source, 'manifest.json')));
    expect(assertRuntimeWorkPackageUnchanged(result)).toBe(true);
  });
  it('refuses to replace a pre-existing isolated work package', () => {
    const { source, profile } = fixture(); const destination = path.join(profile, 'v16-acceptance-work-package');
    fs.mkdirSync(destination); fs.writeFileSync(path.join(destination, 'existing'), 'preserved');
    expect(() => copyIsolatedWorkPackage(source, profile)).toThrow();
    expect(fs.readFileSync(path.join(destination, 'existing'), 'utf8')).toBe('preserved');
    expect(fs.existsSync(path.join(destination, 'manifest.json'))).toBe(false);
  });
  it.each(['file', 'new-file'])('rejects a changed %s original instead of crediting the earlier input snapshot', kind => {
    const { source, profile } = fixture(); const receipt = copyIsolatedWorkPackage(source, profile);
    fs.writeFileSync(path.join(source, kind === 'file' ? 'manifest.json' : 'new.json'), '{}');
    expect(() => assertRuntimeWorkPackageUnchanged(receipt)).toThrow();
  });
  it('rejects junctioned directories before creating any isolated destination', () => {
    const { source, profile, root } = fixture(); const linked = path.join(root, 'linked');
    fs.symlinkSync(source, linked, process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => copyIsolatedWorkPackage(linked, profile)).toThrow();
    expect(fs.existsSync(path.join(profile, 'v16-acceptance-work-package'))).toBe(false);
  });
  it('rejects a hard-linked original or a nested linked directory before copying', () => {
    const first = fixture(); fs.linkSync(path.join(first.source, 'manifest.json'), path.join(first.source, 'alias.json'));
    expect(() => copyIsolatedWorkPackage(first.source, first.profile)).toThrow();
    const second = fixture(); fs.symlinkSync(first.source, path.join(second.source, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => copyIsolatedWorkPackage(second.source, second.profile)).toThrow();
    expect(fs.existsSync(path.join(second.profile, 'v16-acceptance-work-package'))).toBe(false);
  });
  it('rejects a missing manifest, indirect profile, or overlapping input without altering originals', () => {
    const { root, source, profile } = fixture();
    expect(() => copyIsolatedWorkPackage(source, source)).toThrow('重叠');
    const alias = path.join(root, 'profile-alias'); fs.symlinkSync(profile, alias, process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => copyIsolatedWorkPackage(source, alias)).toThrow();
    fs.unlinkSync(path.join(source, 'manifest.json')); expect(() => copyIsolatedWorkPackage(source, profile)).toThrow();
    expect(() => assertDirectRuntimePath(path.join(root, 'missing'), 'directory')).toThrow();
  });
  it('creates only an honest non-ready manifest from the frozen definition without creating any evidence or store authority', () => {
    const { root } = fixture();
    const frozen = { schemaVersion: 'v16.frozen-build/1', identity: { sourceRevision: 'current-test-revision', sourceSha256: 'a'.repeat(64), packageVersion: '1.6.0' },
      requiredManifestDefinition: { schemaVersion: 'v16.manifest/1', requiredTests: [{ testId: 'CURRENT-DEFINITION', evidencePath: 'unavailable.json' }] } };
    const created = createMinimalIsolatedWorkPackage(path.join(root, 'minimal'), frozen);
    const manifest = JSON.parse(fs.readFileSync(created.manifestPath));
    expect(manifest).toMatchObject({ status: 'APP_NEEDS_WORK', appReady: false, realStoreEvidence: false, identity: frozen.identity });
    expect(manifest.requiredTests).toEqual(frozen.requiredManifestDefinition.requiredTests);
    expect(fs.readdirSync(created.directory).sort()).toEqual(['README.md', 'manifest.json']);
    expect(fs.readFileSync(path.join(created.directory, 'README.md'), 'utf8')).toContain('INTERNAL NON_READY');
    expect(() => createMinimalIsolatedWorkPackage(created.directory, frozen)).toThrow();
    expect(() => createMinimalIsolatedWorkPackage(path.join(root, 'unbound'), { ...frozen, identity: {} })).toThrow();
    expect(fs.existsSync(path.join(root, 'unbound'))).toBe(false);
  });
});

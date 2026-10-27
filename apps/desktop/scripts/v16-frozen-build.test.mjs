import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { collectFrozenBuild } from './v16-frozen-build.js';
import { sourceIdentity } from '../../../scripts/verify-v16-required-test-manifest.js';
import { resolveExpectedPackageOutputs, withFreshPackageOutputs } from '../../../scripts/build-windows-package.js';

const roots = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-frozen-build-'));
  roots.push(root);
  const files = {
    'apps/desktop/package.json': JSON.stringify({ name: '@amazon-ai-ops/desktop', version: '1.6.0', main: 'dist/main/index.js' }),
    'apps/desktop/src/example.test.ts': 'export const contract = true;',
    'apps/desktop/src/index.ts': 'export const production = true;',
    'docs/v16_required_test_manifest.json': JSON.stringify({ requiredTests: [{ testId: 'V16-T-L1-ALL', testFiles: ['apps/desktop/src/example.test.ts'] }] }),
    'docs/v16_requirements_index.json': JSON.stringify({ requirements: [{ id: 'V16-A-001', implementation: ['apps/desktop/src/index.ts'] }] }),
    'docs/amazon_ai_ops_agent_prd_v1_6_0.md': '| V16-A-001 | MUST | 示例真实合同 | AC-A-001 |',
    'docs/v16_companion_verification_traceability.md': '治理原文\r\nPENDING\r\n',
    'packages/local-db/src/sqlite/repositories/settings-repo.ts': 'export const settings = true;',
    'packages/local-db/src/sqlite/db.ts': 'export const database = true;',
  };
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  const ports = {
    listFiles: () => Object.keys(files), sourceRevision: () => 'a'.repeat(40),
    migrationContract: () => [{ version: 1, name: 'migration-one', checksum: 'migration-one-current' }],
    legacyV1Checksum: () => 'migration-one-legacy', runnerContract: () => ({ fixture: true }),
  };
  return { root, files, ports };
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('V16 frozen build inventory', () => {
  it('keeps real Git source and frozen identities stable throughout actual package quarantine', () => {
    const input = fixture();
    fs.copyFileSync(path.resolve('.gitignore'), path.join(input.root, '.gitignore'));
    execFileSync('git', ['init', '--quiet'], { cwd: input.root });
    execFileSync('git', ['add', '--all'], { cwd: input.root });
    execFileSync('git', ['-c', 'user.name=Isolated contract', '-c', 'user.email=isolated-contract@example.invalid', 'commit', '--quiet', '-m', 'isolated source fixture'], { cwd: input.root });
    const { listFiles, sourceRevision, ...ports } = input.ports;
    const outputs = resolveExpectedPackageOutputs(path.join(input.root, 'apps/desktop/release/win-unpacked/AmazonAIOpsAgent.exe'));
    fs.mkdirSync(path.join(outputs.winUnpackedRoot, 'resources/app'), { recursive: true });
    fs.writeFileSync(path.join(outputs.winUnpackedRoot, 'resources/app/old-main.js'), 'old package implementation');
    fs.writeFileSync(path.join(outputs.winUnpackedRoot, 'LICENSES.chromium.html'), '<html>old package license</html>');
    const capture = () => ({ source: sourceIdentity(input.root), frozen: collectFrozenBuild(input.root, ports) });
    const before = capture();
    withFreshPackageOutputs(outputs, () => {
      const quarantines = fs.readdirSync(path.join(input.root, 'apps/desktop')).filter(name => name.startsWith('.amazon-ai-ops-package-rollback-'));
      expect(quarantines).toHaveLength(1);
      expect(capture()).toEqual(before);
    });
    expect(capture()).toEqual(before);
    fs.writeFileSync(path.join(input.root, 'apps/desktop/src/index.ts'), 'export const production = false;');
    const changed = capture();
    expect(changed.source.sourceSha256).not.toBe(before.source.sourceSha256);
    expect(changed.frozen.identity.sourceSha256).not.toBe(before.frozen.identity.sourceSha256);
  });

  it('freezes source bytes, requirement definitions, the complete test inventory and security originals', () => {
    const input = fixture(), frozen = collectFrozenBuild(input.root, input.ports);
    const hash = createHash('sha256');
    for (const file of Object.keys(input.files).sort()) hash.update(file + '\0').update(input.files[file]).update('\0');
    expect(frozen.identity.sourceSha256).toBe(hash.digest('hex'));
    expect(frozen.sourceRoot).toBe(input.root);
    expect(frozen.testInventory).toEqual(['apps/desktop/src/example.test.ts']);
    expect(frozen.prdMust[0].id).toBe('V16-A-001');
    expect(frozen.implementationInventory).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'apps/desktop/src/index.ts' })]));
    expect(Buffer.from(frozen.securitySources.settingsRepository.files[0].contentsBase64, 'base64').toString()).toBe(input.files['packages/local-db/src/sqlite/repositories/settings-repo.ts']);
    expect(frozen.allowedV1Checksums).toEqual(['migration-one-current', 'migration-one-legacy']);
    expect(Buffer.from(frozen.uiGovernanceSource.contentsBase64, 'base64').toString()).toBe('治理原文\r\nPENDING\r\n');
  });

  it('rejects a test omitted from the frozen L1 definition', () => {
    const input = fixture();
    input.ports.listFiles = () => [...Object.keys(input.files), 'apps/desktop/src/unmapped.test.ts'];
    fs.writeFileSync(path.join(input.root, 'apps/desktop/src/unmapped.test.ts'), 'export const omitted = true;');
    expect(() => collectFrozenBuild(input.root, input.ports)).toThrow('FROZEN_TEST_INVENTORY_INCOMPLETE');
  });

  it('changes the source identity when production or requirement bytes change', () => {
    const input = fixture(), before = collectFrozenBuild(input.root, input.ports);
    fs.writeFileSync(path.join(input.root, 'apps/desktop/src/index.ts'), 'export const production = false;');
    const after = collectFrozenBuild(input.root, input.ports);
    expect(after.identity.sourceSha256).not.toBe(before.identity.sourceSha256);
    expect(after.implementationInventory.find(record => record.path === 'apps/desktop/src/index.ts').sha256)
      .not.toBe(before.implementationInventory.find(record => record.path === 'apps/desktop/src/index.ts').sha256);
  });

  it('rejects an implementation link escaping the build root', () => {
    const input = fixture();
    fs.writeFileSync(path.join(input.root, 'docs/v16_requirements_index.json'), JSON.stringify({ requirements: [{ implementation: ['../outside.ts'] }] }));
    expect(() => collectFrozenBuild(input.root, input.ports)).toThrow('FROZEN_SOURCE_OUTSIDE_ROOT');
  });
});

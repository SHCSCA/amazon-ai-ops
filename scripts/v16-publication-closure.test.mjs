import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { sha256 } from './verify-v16-required-test-manifest.js';
import { publishRelease, verifyPublicationClosure } from './v16-publication-closure.js';
import { desiredReadme, readDeliveryStatus, verifyPublicationBundle } from './v16-publication-bundle.js';
import { hashRegularFile } from './v16-publication-files.js';
import { releaseCoreFingerprint } from './v16-release-core.js';

function fixture(work) {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'amazon-v16-publication-'));
  const json = (name, value) => fs.writeFileSync(path.join(root, name), JSON.stringify(value));
  fs.writeFileSync(path.join(root, 'README.md'), '# Release\n\n**DELIVERY: APP_NEEDS_WORK — INTERNAL NON_READY.** fixture\n\nPreserved content.\n');
  fs.writeFileSync(path.join(root, 'source.txt'), 'isolated source fixture');
  fs.writeFileSync(path.join(root, 'authority-snapshot.db'), 'isolated authority fixture');
  json('raw.json', { fixture: true });
  json('evidence.json', { artifact: { path: 'raw.json' } });
  json('manifest.json', { requiredTests: [{ testId: 'fixture', evidencePath: 'evidence.json' }] });
  json('requirements.json', { requirements: [] });
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
  const options = { manifestPath: 'manifest.json', requirementsPath: 'requirements.json', closurePath: 'publication.json', bundleDirectory: 'bundle' };
  // 此端口只隔离发布顺序测试；生产命令固定执行全部原生验收与追踪复验。
  const evaluate = (eligible = true) => ({
    schemaVersion: 'v16.release-core/1', eligible,
    identity: {
      sourceRevision: 'a'.repeat(40), sourceSha256: hashRegularFile(path.join(root, 'source.txt')), packageVersion: '1.6.0',
      packageHashes: Object.fromEntries(['installer', 'portable', 'zip', 'appContent', 'mainBundle'].map(key => [key, sha256(key)])),
    },
    gates: Array.from({ length: 7 }, (_, index) => ({ layer: `L${index + 1}`, passed: eligible, tests: [{
      testId: 'fixture', success: eligible,
      ...(index === 5 ? { inputArtifacts: [{ path: path.join(root, 'authority-snapshot.db'), sha256: hashRegularFile(path.join(root, 'authority-snapshot.db')) }] } : {}),
    }] })), trace: { success: eligible, total: 172, completed: eligible ? 172 : 0 }, issues: eligible ? [] : ['ISOLATED_MISSING_EVIDENCE'],
  });
  const publish = (eligible = true, evaluator = () => evaluate(eligible)) => publishRelease('manifest.json', 'requirements.json', root, options, evaluator);
  const verify = () => verifyPublicationClosure(manifest, evaluate(), root, options);
  try { work({ root, json, options, manifest, evaluate, publish, verify }); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

describe('V16 publication closure', () => {
  it('publishes only after matching bundle safety and freezes the current inputs', () => fixture(({ root, publish, verify }) => {
    const result = publish();
    expect(result.publication.success).toBe(true);
    expect(verify().status).toBe('APP_READY');
    const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
    expect(readDeliveryStatus(readme)).toBe('APP_READY');
    expect(readme).toContain('Preserved content.');
    const closure = JSON.parse(fs.readFileSync(result.closurePath));
    expect(closure.inputs.map(input => path.basename(input.path))).toContain('authority-snapshot.db');
  }));

  it('exports a faithful NON_READY bundle when any core requirement is missing', () => fixture(({ root, publish, evaluate, manifest, options }) => {
    const result = publish(false);
    expect(result.publication.success).toBe(true);
    expect(result.publication.status).toBe('APP_NEEDS_WORK');
    expect(verifyPublicationClosure(manifest, evaluate(false), root, options).success).toBe(true);
    const bundle = JSON.parse(fs.readFileSync(path.join(root, 'bundle/delivery-bundle-manifest.json')));
    expect(bundle.status).toBe('NON_READY');
    const core = JSON.parse(fs.readFileSync(path.join(root, 'bundle/release-core.json')));
    expect(core.issues).toContain('ISOLATED_MISSING_EVIDENCE');
    expect(readDeliveryStatus(fs.readFileSync(path.join(root, 'README.md'), 'utf8'))).toBe('APP_NEEDS_WORK');
  }));

  it('publishes and invalidates an explicit private README without changing the workspace claim', () => fixture(({ root, manifest, evaluate, options }) => {
    const workspaceReadme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
    fs.mkdirSync(path.join(root, 'private-run'));
    fs.writeFileSync(path.join(root, 'private-run/README.md'), workspaceReadme);
    const privateOptions = { ...options, readmePath: 'private-run/README.md',
      closurePath: 'private-run/closure.json', readinessPath: 'private-run/readiness.json', bundleDirectory: 'private-run/bundle' };
    publishRelease('manifest.json', 'requirements.json', root, privateOptions, () => evaluate());
    expect(verifyPublicationClosure(manifest, evaluate(), root, privateOptions).success).toBe(true);
    expect(readDeliveryStatus(fs.readFileSync(path.join(root, 'private-run/README.md'), 'utf8'))).toBe('APP_READY');
    expect(fs.readFileSync(path.join(root, 'README.md'), 'utf8')).toBe(workspaceReadme);
    fs.unlinkSync(path.join(root, 'manifest.json'));
    expect(() => publishRelease('manifest.json', 'requirements.json', root, privateOptions, () => evaluate())).toThrow();
    expect(readDeliveryStatus(fs.readFileSync(path.join(root, 'private-run/README.md'), 'utf8'))).toBe('APP_NEEDS_WORK');
    expect(fs.readFileSync(path.join(root, 'README.md'), 'utf8')).toBe(workspaceReadme);
  }));

  it.each(['source.txt', 'authority-snapshot.db', 'manifest.json', 'requirements.json', 'evidence.json', 'raw.json', 'README.md'])(
    'invalidates READY after %s changes', name => fixture(({ root, publish, verify }) => {
      publish();
      fs.appendFileSync(path.join(root, name), '\nchanged');
      const result = verify();
      expect(result.success).toBe(false);
      expect(result.status).toBe('APP_NEEDS_WORK');
    }),
  );

  it.each(['release-core.json', 'evidence-inputs.json', 'README.snapshot.md', 'delivery-bundle-manifest.json'])(
    'rejects changed bundle payload %s', name => fixture(({ root, publish, verify }) => {
      publish();
      fs.appendFileSync(path.join(root, 'bundle', name), ' ');
      expect(verify().success).toBe(false);
    }),
  );

  it('rejects extra bundle files and missing input files', () => fixture(({ root, publish, verify }) => {
    publish();
    fs.writeFileSync(path.join(root, 'bundle', 'unexpected.txt'), 'extra');
    expect(verify().issues).toContain('BUNDLE_FILE_SET_MISMATCH');
    fs.unlinkSync(path.join(root, 'raw.json'));
    expect(verify().success).toBe(false);
  }));

  it('rejects a valid but different current package hash after publication', () => fixture(({ root, publish, manifest, evaluate, options }) => {
    publish();
    const current = evaluate();
    current.identity.packageHashes.installer = 'b'.repeat(64);
    expect(current.identity.packageHashes.installer).toMatch(/^[a-f0-9]{64}$/);
    const result = verifyPublicationClosure(manifest, current, root, options);
    expect(result).toMatchObject({ success: false, status: 'APP_NEEDS_WORK' });
    expect(result.issues).toContain('PUBLICATION_CURRENT_RESULT_MISMATCH');
  }));

  it('rejects a changed current readiness gate result after publication', () => fixture(({ root, publish, manifest, evaluate, options }) => {
    publish();
    const current = evaluate();
    current.gates[3].passed = false;
    current.gates[3].tests[0].success = false;
    current.gates[3].tests[0].issues = ['CURRENT_NATIVE_EVIDENCE_REJECTED'];
    expect(verifyPublicationClosure(manifest, current, root, options).issues)
      .toContain('PUBLICATION_MISSING_OR_INVALID:PUBLICATION_CORE_NOT_READY');
    current.eligible = false;
    const result = verifyPublicationClosure(manifest, current, root, options);
    expect(result).toMatchObject({ success: false, status: 'APP_NEEDS_WORK' });
    expect(result.issues).toContain('PUBLICATION_CURRENT_RESULT_MISMATCH');
  }));

  it('refuses to overwrite a historical closure or bundle', () => fixture(({ root, publish }) => {
    const first = publish();
    const bytes = fs.readFileSync(first.closurePath);
    expect(() => publish()).toThrow(/ALREADY_EXISTS/);
    expect(fs.readFileSync(first.closurePath)).toEqual(bytes);
    expect(readDeliveryStatus(fs.readFileSync(path.join(root, 'README.md'), 'utf8'))).toBe('APP_NEEDS_WORK');
  }));

  it('does not write READY if source changes during the final precommit check', () => fixture(({ root, evaluate, publish }) => {
    let call = 0;
    expect(() => publish(true, () => {
      if (++call === 2) fs.appendFileSync(path.join(root, 'source.txt'), 'changed');
      return evaluate();
    })).toThrow(/INPUT_CHANGED_DURING_EXPORT/);
    expect(readDeliveryStatus(fs.readFileSync(path.join(root, 'README.md'), 'utf8'))).toBe('APP_NEEDS_WORK');
    expect(fs.existsSync(path.join(root, 'publication.json'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'bundle'))).toBe(false);
    const staging = fs.readdirSync(root).find(name => name.startsWith('.bundle.NON_READY-pending-'));
    const aborted = JSON.parse(fs.readFileSync(path.join(root, staging, 'delivery-bundle-manifest.json')));
    expect(aborted).toMatchObject({ status: 'NON_READY', phase: 'ABORTED' });
    expect(readDeliveryStatus(fs.readFileSync(path.join(root, staging, 'README.snapshot.md'), 'utf8'))).toBe('APP_NEEDS_WORK');
  }));

  it('restores NON_READY if inputs change immediately after writing the closure', () => fixture(({ root, evaluate, publish }) => {
    let call = 0;
    expect(() => publish(true, () => {
      if (++call === 3) fs.appendFileSync(path.join(root, 'source.txt'), 'changed');
      return evaluate();
    })).toThrow(/PUBLICATION_CURRENT_RESULT_MISMATCH/);
    expect(readDeliveryStatus(fs.readFileSync(path.join(root, 'README.md'), 'utf8'))).toBe('APP_NEEDS_WORK');
  }));

  it('refuses mismatched READY claims, missing package identities and legacy bundles', () => fixture(({ root, evaluate, publish }) => {
    const core = evaluate();
    const readme = desiredReadme(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), core);
    expect(readDeliveryStatus(readme)).toBe('APP_READY');
    expect(() => readDeliveryStatus('**DELIVERY: APP_READY — INTERNAL NON_READY.**')).toThrow();
    expect(() => desiredReadme(readme + '\n**DELIVERY: APP_READY — READY.**', core)).toThrow();
    expect(() => publish(true, () => ({ ...core, identity: { ...core.identity, packageHashes: null } }))).toThrow(/PACKAGE_IDENTITY_MISSING/);
    fs.mkdirSync(path.join(root, 'legacy'));
    fs.writeFileSync(path.join(root, 'legacy/delivery-bundle-manifest.json'), JSON.stringify({ schemaVersion: 'v15.bundle/1', status: 'READY' }));
    expect(verifyPublicationBundle(path.join(root, 'legacy'), core, readme, []).success).toBe(false);
  }));

  it('rejects linked bundle payloads without modifying the target', () => fixture(({ root, publish, verify }) => {
    publish();
    const payload = path.join(root, 'bundle', 'release-core.json');
    fs.unlinkSync(payload);
    fs.symlinkSync(root, payload, process.platform === 'win32' ? 'junction' : 'dir');
    expect(verify().success).toBe(false);
    expect(fs.readFileSync(path.join(root, 'source.txt'), 'utf8')).toBe('isolated source fixture');
  }));

  it.each(['missing-manifest', 'invalid-manifest', 'missing-requirements', 'invalid-requirements'])(
    'invalidates old README and readiness before an early %s failure', failure => fixture(({ root, evaluate }) => {
      const readme = path.join(root, 'README.md');
      fs.writeFileSync(readme, desiredReadme(fs.readFileSync(readme, 'utf8'), evaluate()));
      fs.writeFileSync(path.join(root, 'readiness.json'), JSON.stringify({ overallStatus: 'APP_READY' }));
      const file = failure.includes('manifest') ? 'manifest.json' : 'requirements.json';
      if (failure.startsWith('missing')) fs.unlinkSync(path.join(root, file));
      else fs.writeFileSync(path.join(root, file), '{');
      const run = spawnSync(process.execPath, [path.resolve('scripts/publish-v16-release.js'),
        '--repo-root', root, '--manifest', 'manifest.json', '--requirements', 'requirements.json',
        '--publication', 'publication.json', '--out', 'readiness.json',
      ], { encoding: 'utf8' });
      expect(run.status).toBe(1);
      expect(readDeliveryStatus(fs.readFileSync(readme, 'utf8'))).toBe('APP_NEEDS_WORK');
      expect(JSON.parse(fs.readFileSync(path.join(root, 'readiness.json'))).overallStatus).toBe('APP_NEEDS_WORK');
    }),
  );

  it.each([1, 2, 3])('keeps old and pending publications NON_READY when validation process exits at evaluation %s', exitAt => fixture(({ root, json, evaluate }) => {
    const readmePath = path.join(root, 'README.md');
    fs.writeFileSync(readmePath, desiredReadme(fs.readFileSync(readmePath, 'utf8'), evaluate()));
    json('readiness.json', { overallStatus: 'APP_READY' });
    json('core-fixture.json', evaluate());
    const code = `
      const fs = require('node:fs');
      const path = require('node:path');
      const { publishRelease } = require(${JSON.stringify(path.resolve('scripts/v16-publication-closure.js'))});
      const root = process.argv[1];
      const core = JSON.parse(fs.readFileSync(path.join(root, 'core-fixture.json')));
      let calls = 0;
      publishRelease('manifest.json', 'requirements.json', root,
        { closurePath: 'publication.json', bundleDirectory: 'bundle', readinessPath: 'readiness.json' },
        () => { if (++calls === ${exitAt}) process.exit(7); return core; });
    `;
    const run = spawnSync(process.execPath, ['-e', code, root], { encoding: 'utf8' });
    expect(run.status).toBe(7);
    expect(readDeliveryStatus(fs.readFileSync(readmePath, 'utf8'))).toBe('APP_NEEDS_WORK');
    expect(JSON.parse(fs.readFileSync(path.join(root, 'readiness.json'))).overallStatus).toBe('APP_NEEDS_WORK');
    expect(fs.existsSync(path.join(root, 'bundle'))).toBe(false);
    for (const name of fs.readdirSync(root).filter(name => name.startsWith('.bundle.NON_READY-pending-'))) {
      expect(JSON.parse(fs.readFileSync(path.join(root, name, 'delivery-bundle-manifest.json')))).toMatchObject({ status: 'NON_READY', phase: 'PREPARING' });
    }
  }));

  it('keeps NON_READY closure reproducible across diagnostic timestamps while retaining semantic failures', () => fixture(({ root, evaluate, publish, manifest, options }) => {
    let calls = 0;
    const evaluateWithDiagnostics = () => {
      const core = evaluate(false);
      core.gates[3].tests[0].diagnostics = [{ timestamp: new Date(1_700_000_000_000 + calls++).toISOString(), event: 'native.missing', code: 'MISSING_EVIDENCE' }];
      return core;
    };
    const first = evaluateWithDiagnostics();
    const second = evaluateWithDiagnostics();
    expect(releaseCoreFingerprint(first)).toBe(releaseCoreFingerprint(second));
    second.gates[3].tests[0].issues = ['NEW_SEMANTIC_FAILURE'];
    expect(releaseCoreFingerprint(first)).not.toBe(releaseCoreFingerprint(second));
    const result = publish(false, evaluateWithDiagnostics);
    expect(result.publication.success).toBe(true);
    expect(verifyPublicationClosure(manifest, evaluateWithDiagnostics(), root, options).success).toBe(true);
  }));

  it('revokes the old README claim even when the readiness output is a directory', () => fixture(({ root, options, evaluate }) => {
    const readme = path.join(root, 'README.md');
    fs.writeFileSync(readme, desiredReadme(fs.readFileSync(readme, 'utf8'), evaluate()));
    fs.mkdirSync(path.join(root, 'readiness.json'));
    expect(() => publishRelease('manifest.json', 'requirements.json', root,
      { ...options, readinessPath: 'readiness.json' }, evaluate)).toThrow(/INVALIDATION_FAILED/);
    expect(readDeliveryStatus(fs.readFileSync(readme, 'utf8'))).toBe('APP_NEEDS_WORK');
    expect(fs.statSync(path.join(root, 'readiness.json')).isDirectory()).toBe(true);
    expect(fs.existsSync(path.join(root, 'publication.json'))).toBe(false);
  }));

  it('leaves only a closure-dependent candidate if the process exits after promoting the bundle', () => fixture(({ root, json, evaluate, verify }) => {
    const readme = path.join(root, 'README.md');
    fs.writeFileSync(readme, desiredReadme(fs.readFileSync(readme, 'utf8'), evaluate()));
    json('readiness.json', { overallStatus: 'APP_READY' });
    json('core-fixture.json', evaluate());
    const code = `
      const fs = require('node:fs');
      const path = require('node:path');
      const { publishRelease } = require(${JSON.stringify(path.resolve('scripts/v16-publication-closure.js'))});
      const root = process.argv[1];
      const core = JSON.parse(fs.readFileSync(path.join(root, 'core-fixture.json')));
      const rename = fs.renameSync;
      fs.renameSync = function(from, to) {
        const result = rename.call(fs, from, to);
        if (path.basename(String(from)).startsWith('.bundle.NON_READY-pending-') && path.basename(String(to)) === 'bundle') process.exit(7);
        return result;
      };
      publishRelease('manifest.json', 'requirements.json', root,
        { closurePath: 'publication.json', bundleDirectory: 'bundle', readinessPath: 'readiness.json' }, () => core);
    `;
    expect(spawnSync(process.execPath, ['-e', code, root], { encoding: 'utf8' }).status).toBe(7);
    const bundle = JSON.parse(fs.readFileSync(path.join(root, 'bundle/delivery-bundle-manifest.json')));
    expect(bundle).toMatchObject({ status: 'READY_CANDIDATE', requiresCurrentPublicationClosure: true });
    expect(fs.existsSync(path.join(root, 'publication.json'))).toBe(false);
    expect(verify()).toMatchObject({ success: false, status: 'APP_NEEDS_WORK' });
    expect(readDeliveryStatus(fs.readFileSync(readme, 'utf8'))).toBe('APP_NEEDS_WORK');
    expect(JSON.parse(fs.readFileSync(path.join(root, 'readiness.json'))).overallStatus).toBe('APP_NEEDS_WORK');
  }));
});

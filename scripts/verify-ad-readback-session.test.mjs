import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function runNode(script, args = []) {
  return spawnSync(process.execPath, [path.join(root, script), ...args], {
    cwd: root,
    encoding: 'utf8',
  });
}

function makeCandidate(dir) {
  const report = path.join(dir, 'source-report.xlsx');
  const source = path.join(dir, 'candidate.json');
  fs.writeFileSync(report, 'fake report placeholder\n', 'utf8');
  fs.writeFileSync(source, JSON.stringify({
    kind: 'real-ad-execution-readback',
    status: 'NEEDS_WORK',
    target: {
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      campaignName: 'Campaign A',
      adGroupName: 'Ad Group B',
      entityType: 'target',
      entityName: 'door lock',
      actionType: 'lower_bid',
    },
    source: {
      currentValue: '1.63',
      recommendedValue: '1.46',
      sourceFiles: [report],
      sourceRow: 410,
    },
  }, null, 2), 'utf8');
  return source;
}

describe('verify ad readback session packet', () => {
  it('passes a freshly prepared session structure while reporting capture fields still missing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-session-verify-'));
    const source = makeCandidate(dir);
    const session = path.join(dir, 'session');
    const prepare = runNode('scripts/prepare-ad-readback-session.js', ['--source', source, '--out', session]);
    expect(prepare.status).toBe(0);

    const verify = runNode('scripts/verify-ad-readback-session.js', [session]);

    expect(verify.status).toBe(0);
    expect(verify.stdout).toContain('SESSION_STRUCTURE_READY');
    expect(verify.stdout).toContain('CAPTURE_NEEDS_WORK');
    expect(verify.stdout).toContain('审批/审批人');
    expect(verify.stdout).toContain('执行前/执行前 Ads UI live bid');
    expect(verify.stdout).toContain('session input guide exists');
    expect(verify.stdout).toContain('source candidate is NEEDS_WORK');
    expect(verify.stdout).toContain('raw report files are not copied into session');
  });

  it('fails when the session accidentally contains raw spreadsheet reports', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-session-raw-'));
    const source = makeCandidate(dir);
    const session = path.join(dir, 'session');
    const prepare = runNode('scripts/prepare-ad-readback-session.js', ['--source', source, '--out', session]);
    expect(prepare.status).toBe(0);
    fs.writeFileSync(path.join(session, 'copied-report.xlsx'), 'do not include raw reports\n', 'utf8');

    const verify = runNode('scripts/verify-ad-readback-session.js', [session]);

    expect(verify.status).not.toBe(0);
    expect(`${verify.stdout}${verify.stderr}`).toContain('raw report files must not be copied into the session folder');
  });

  it('fails when the pass output would overwrite the source candidate', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-session-overwrite-'));
    const source = makeCandidate(dir);
    const session = path.join(dir, 'session');
    const prepare = runNode('scripts/prepare-ad-readback-session.js', ['--source', source, '--out', session]);
    expect(prepare.status).toBe(0);
    const pathsFile = path.join(session, 'session-paths.json');
    const paths = JSON.parse(fs.readFileSync(pathsFile, 'utf8'));
    paths.passEvidencePath = paths.sourceCandidatePath;
    fs.writeFileSync(pathsFile, `${JSON.stringify(paths, null, 2)}\n`, 'utf8');

    const verify = runNode('scripts/verify-ad-readback-session.js', [session]);

    expect(verify.status).not.toBe(0);
    expect(`${verify.stdout}${verify.stderr}`).toContain('pass output must not overwrite source candidate');
  });
});

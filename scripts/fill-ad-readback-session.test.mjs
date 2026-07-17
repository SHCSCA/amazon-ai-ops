import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'url';
import { writeAdReadbackAuthorityDb } from './ad-readback-authority-db.test-fixture.mjs';

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
  const identityProof = path.join(dir, 'target-identity-proof.json');
  const source = path.join(dir, 'candidate.json');
  fs.writeFileSync(report, 'fake report placeholder\n', 'utf8');
  fs.writeFileSync(identityProof, '{"verified":true}\n', 'utf8');
  fs.writeFileSync(source, JSON.stringify({
    schemaVersion: 2,
    kind: 'real-ad-execution-readback',
    status: 'NEEDS_WORK',
    authority: {
      recommendationId: 4,
      recommendationRevision: 2,
      recommendationStatusAtExport: 'approved',
      dateFrom: '2026-06-17',
      dateTo: '2026-06-17',
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      asin: 'B0GTTJFQTM',
      batchId: 'batch_2026-06-17',
      checkedAt: '2026-06-17T09:59:00.000Z',
    },
    realWriteApproved: false,
    safety: {
      full8Started: false,
      listingAiDraftOnly: false,
      adWriteActionsPerformed: false,
    },
    target: {
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      asin: 'B0GTTJFQTM',
      metricDate: '2026-06-17',
      campaignName: 'Campaign A',
      adGroupName: 'Ad Group B',
      entityType: 'keyword',
      entityId: 'target-id-4',
      entityName: 'door lock',
      identityProofPath: identityProof,
      actionType: 'lower_bid',
    },
    source: {
      recommendationId: '4',
      recommendationRevision: 2,
      batchId: 'batch_2026-06-17',
      metricDate: '2026-06-17',
      currentValue: '1.63',
      recommendedValue: '1.46',
      sourceFiles: [report],
      sourceRow: 410,
      entityType: 'keyword',
    },
    approval: {
      operatorConfirmed: false,
      scope: 'FT-US-US / US / B0GTTJFQTM / 2026-06-17~2026-06-17 / batch_2026-06-17',
    },
    risk: {
      rationale: 'Lowering one target bid is bounded and reversible.',
    },
  }, null, 2), 'utf8');
  return source;
}

describe('fill ad readback evidence from a session input file', () => {
  it('fills a PASS evidence JSON from session-input.json and runs the readback verifier', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-session-fill-'));
    const source = makeCandidate(dir);
    const session = path.join(dir, 'session');
    const prepare = runNode('scripts/prepare-ad-readback-session.js', ['--source', source, '--out', session]);
    expect(prepare.status).toBe(0);

    const paths = JSON.parse(fs.readFileSync(path.join(session, 'session-paths.json'), 'utf8'));
    const approval = path.join(paths.approvalsDir, 'approval.txt');
    const before = path.join(paths.beforeScreenshotsDir, 'before.png');
    const after = path.join(paths.afterScreenshotsDir, 'after.png');
    const readback = path.join(paths.readbackScreenshotsDir, 'readback.png');
    for (const filePath of [approval, before, after, readback]) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, `evidence ${path.basename(filePath)}\n`, 'utf8');
    }

    const input = JSON.parse(fs.readFileSync(path.join(session, 'session-input.json'), 'utf8'));
    Object.assign(input, {
      approverName: 'Ops Owner',
      approvalArtifactPath: approval,
      approvalConfirmedAt: '2026-06-17T10:00:00.000Z',
      beforeValue: '1.63',
      beforeCapturedAt: '2026-06-17T10:01:00.000Z',
      beforeScreenshotPath: before,
      liveBidSourceNote: 'Read from Ads UI editable target bid row before manual change.',
      afterValue: '1.46',
      afterCapturedAt: '2026-06-17T10:03:00.000Z',
      afterScreenshotPath: after,
      executedAt: '2026-06-17T10:02:00.000Z',
      executedBy: 'Manual Operator',
      executionId: 'manual-ads-ui-rec-4',
      readbackReadAt: '2026-06-17T10:04:00.000Z',
      readbackEvidencePath: readback,
      readbackActualValue: '1.46',
      riskRationale: 'Lowering one target bid is bounded, reversible, and does not increase traffic or budget.',
    });
    fs.writeFileSync(path.join(session, 'session-input.json'), `${JSON.stringify(input, null, 2)}\n`, 'utf8');

    const authorityEvidence = JSON.parse(fs.readFileSync(source, 'utf8'));
    authorityEvidence.approval = {
      ...authorityEvidence.approval,
      confirmedAt: input.approvalConfirmedAt,
      approverName: input.approverName,
    };
    authorityEvidence.risk.rationale = input.riskRationale;
    const dbPath = writeAdReadbackAuthorityDb(path.join(dir, 'authority-db'), authorityEvidence);

    const result = runNode('scripts/fill-ad-readback-session.js', ['--session', session, '--db', dbPath]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('AD_READBACK_EVIDENCE verified');
    expect(result.stdout).toContain('Filled ad readback session evidence written');
    expect(fs.existsSync(paths.passEvidencePath)).toBe(true);
    const evidence = JSON.parse(fs.readFileSync(paths.passEvidencePath, 'utf8'));
    expect(evidence.schemaVersion).toBe(2);
    expect(evidence.authority).toMatchObject({
      recommendationId: 4,
      recommendationRevision: 2,
      recommendationStatusAtExport: 'approved',
      batchId: 'batch_2026-06-17',
    });
    expect(evidence.status).toBe('PASS');
    expect(evidence.before.value).toBe('1.63');
    expect(evidence.after.value).toBe('1.46');
    expect(evidence.readback.actualValue).toBe('1.46');
    expect(evidence.source).toMatchObject({
      recommendationId: '4',
      recommendationRevision: 2,
      batchId: 'batch_2026-06-17',
    });

    input.readbackActualValue = '';
    fs.writeFileSync(path.join(session, 'session-input.json'), `${JSON.stringify(input, null, 2)}\n`, 'utf8');
    fs.rmSync(paths.passEvidencePath, { force: true });

    const missingIndependentValue = runNode('scripts/fill-ad-readback-session.js', ['--session', session, '--db', dbPath]);
    expect(missingIndependentValue.status).not.toBe(0);
    expect(`${missingIndependentValue.stdout}${missingIndependentValue.stderr}`)
      .toContain('session-input.json has unresolved fields: readbackActualValue');
    expect(fs.existsSync(paths.passEvidencePath)).toBe(false);
  });

  it('fails before calling the fill helper when session-input placeholders are not replaced', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-session-fill-missing-'));
    const source = makeCandidate(dir);
    const session = path.join(dir, 'session');
    const prepare = runNode('scripts/prepare-ad-readback-session.js', ['--source', source, '--out', session]);
    expect(prepare.status).toBe(0);

    const result = runNode('scripts/fill-ad-readback-session.js', ['--session', session]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('session-input.json has unresolved fields');
    expect(fs.existsSync(path.join(session, 'real-ad-execution-readback-pass.json'))).toBe(false);
  });
});

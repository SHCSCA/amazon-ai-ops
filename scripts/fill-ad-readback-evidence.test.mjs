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

function writePng(filePath) {
  fs.writeFileSync(filePath, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(path.basename(filePath), 'utf8'),
  ]));
  return filePath;
}

function writeReport(filePath) {
  fs.writeFileSync(filePath, 'placeholder report file for readback finalizer\n', 'utf8');
  return filePath;
}

function candidateEvidence(dir) {
  const identityProofPath = writePng(path.join(dir, 'target-identity.png'));
  return {
    schemaVersion: 2,
    kind: 'real-ad-execution-readback',
    status: 'NEEDS_WORK',
    createdAt: '2026-06-17T16:05:43.065Z',
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
      checkedAt: '2026-06-17T16:05:43.000Z',
    },
    realWriteApproved: false,
    safety: {
      full8Started: false,
      listingAiDraftOnly: false,
      adWriteActionsPerformed: false,
    },
    approval: {
      operatorConfirmed: false,
      scope: 'FT-US-US / US / B0GTTJFQTM / 2026-06-17~2026-06-17 / batch_2026-06-17',
      confirmedAt: 'FILL: approval timestamp in ISO format',
      approverName: 'FILL: external approver or responsible owner',
      approvalArtifactPath: 'FILL: approval screenshot path, ticket id, or chat record reference',
    },
    target: {
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      asin: 'B0GTTJFQTM',
      metricDate: '2026-06-17',
      campaignName: 'Campaign A',
      adGroupName: 'Ad Group A',
      entityType: 'keyword',
      entityId: 'keyword-4',
      entityName: 'door lock',
      identityProofPath,
      actionType: 'lower_bid',
    },
    risk: {
      level: 'low',
      allowedByPolicy: false,
      rationale: 'Lowering one target bid is bounded and reversible.',
    },
    before: {
      value: 'FILL: value before write',
      capturedAt: 'FILL: before screenshot timestamp in ISO format',
      screenshotPath: 'FILL: absolute path to before screenshot',
      liveBidSourceNote: 'FILL: where the live Ads UI bid was read before the manual write',
    },
    after: {
      value: 'FILL: value after write',
      capturedAt: 'FILL: after screenshot timestamp in ISO format',
      screenshotPath: 'FILL: absolute path to after screenshot',
    },
    readback: {
      verified: false,
      method: 'FILL: Ads UI reload/API/readback method',
      readAt: 'FILL: readback timestamp in ISO format',
      actualValue: 'FILL: must equal after.value',
      evidencePath: 'FILL: absolute path to readback screenshot/trace evidence',
    },
    execution: {
      success: false,
      verified: false,
      executionId: 'FILL: local action log id or Ads operation id',
      executedAt: 'FILL: manual execution timestamp in ISO format',
      channel: 'manual_ads_ui',
      performedBy: 'FILL: operator who manually performed the approved Ads UI action',
      appExecutorUsed: false,
    },
    source: {
      recommendationId: '4',
      recommendationRevision: 2,
      batchId: 'batch_2026-06-17',
      metricDate: '2026-06-17',
      sourceFiles: [writeReport(path.join(dir, 'keyword.xlsx'))],
      sourceRow: 410,
      evidencePath: 'output/codex-evidence/installed-ad-ai-explanation-packaged-final-20260617.json',
      entityType: 'target',
      currentValue: '1.63',
      recommendedValue: '1.46',
    },
  };
}

describe('fill ad readback evidence', () => {
  it('requires an independently supplied readback value instead of copying the after value', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-fill-independent-value-'));
    const source = path.join(dir, 'candidate.json');
    const out = path.join(dir, 'readback-pass.json');
    fs.writeFileSync(source, JSON.stringify(candidateEvidence(dir), null, 2), 'utf8');

    const result = runNode('scripts/fill-ad-readback-evidence.js', [
      '--source', source,
      '--out', out,
      '--approval-confirmed-at', '2026-06-17T16:10:00.000Z',
      '--before-captured-at', '2026-06-17T16:11:00.000Z',
      '--executed-at', '2026-06-17T16:12:00.000Z',
      '--after-captured-at', '2026-06-17T16:13:00.000Z',
      '--readback-read-at', '2026-06-17T16:14:00.000Z',
      '--before-value', '1.63',
      '--after-value', '1.46',
    ]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('Missing required --readback-actual-value');
    expect(fs.existsSync(out)).toBe(false);
  });

  it('finalizes a current candidate and verifies it without mutating the source candidate', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-fill-'));
    const source = path.join(dir, 'candidate.json');
    const out = path.join(dir, 'readback-pass.json');
    const before = writePng(path.join(dir, 'before.png'));
    const after = writePng(path.join(dir, 'after.png'));
    const readback = writePng(path.join(dir, 'readback.png'));
    const candidate = candidateEvidence(dir);
    fs.writeFileSync(source, JSON.stringify(candidate, null, 2), 'utf8');
    const authorityEvidence = structuredClone(candidate);
    authorityEvidence.approval = {
      ...authorityEvidence.approval,
      confirmedAt: '2026-06-17T16:10:00.000Z',
      approverName: 'Ops Owner',
    };
    const dbPath = writeAdReadbackAuthorityDb(path.join(dir, 'authority-db'), authorityEvidence);

    const result = runNode('scripts/fill-ad-readback-evidence.js', [
      '--source', source,
      '--out', out,
      '--db', dbPath,
      '--approver-name', 'Ops Owner',
      '--approval-artifact', 'approval-ticket-123',
      '--approval-confirmed-at', '2026-06-17T16:10:00.000Z',
      '--before-value', '1.63',
      '--before-captured-at', '2026-06-17T16:11:00.000Z',
      '--before-screenshot', before,
      '--live-bid-source-note', 'Read from Ads UI editable target bid row before manual change.',
      '--after-value', '1.46',
      '--after-captured-at', '2026-06-17T16:13:00.000Z',
      '--after-screenshot', after,
      '--executed-at', '2026-06-17T16:12:00.000Z',
      '--executed-by', 'operator@example.com',
      '--execution-id', 'manual-ads-ui-4',
      '--readback-read-at', '2026-06-17T16:14:00.000Z',
      '--readback-evidence', readback,
      '--readback-actual-value', '1.46',
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('AD_READBACK_EVIDENCE verified');
    const evidence = JSON.parse(fs.readFileSync(out, 'utf8'));
    expect(evidence.schemaVersion).toBe(2);
    expect(evidence.authority).toMatchObject({
      recommendationId: 4,
      recommendationRevision: 2,
      recommendationStatusAtExport: 'approved',
      batchId: 'batch_2026-06-17',
    });
    expect(evidence.status).toBe('PASS');
    expect(evidence.realWriteApproved).toBe(true);
    expect(evidence.safety.adWriteActionsPerformed).toBe(true);
    expect(evidence.approval.operatorConfirmed).toBe(true);
    expect(evidence.target.entityName).toBe('door lock');
    expect(evidence.source.sourceRow).toBe(410);
    expect(evidence.source).toMatchObject({
      recommendationId: '4',
      recommendationRevision: 2,
      batchId: 'batch_2026-06-17',
    });
    expect(evidence.before.value).toBe('1.63');
    expect(evidence.after.value).toBe('1.46');
    expect(evidence.readback.actualValue).toBe('1.46');
    expect(evidence.execution.appExecutorUsed).toBe(false);

    const original = JSON.parse(fs.readFileSync(source, 'utf8'));
    expect(original.status).toBe('NEEDS_WORK');
    expect(original.realWriteApproved).toBe(false);
  });

  it('refuses to overwrite the candidate unless --in-place is explicit', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-fill-same-'));
    const source = path.join(dir, 'candidate.json');
    fs.writeFileSync(source, JSON.stringify(candidateEvidence(dir), null, 2), 'utf8');

    const result = runNode('scripts/fill-ad-readback-evidence.js', [
      '--source', source,
      '--out', source,
      '--approver-name', 'Ops Owner',
    ]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('Refusing to overwrite source candidate');
  });
});

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

function writePng(filePath) {
  fs.writeFileSync(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return filePath;
}

function writeReport(filePath) {
  fs.writeFileSync(filePath, 'placeholder report file for verifier traceability\n', 'utf8');
  return filePath;
}

function validEvidence(dir, overrides = {}) {
  const now = '2026-06-10T00:00:00.000Z';
  return {
    kind: 'real-ad-execution-readback',
    status: 'PASS',
    createdAt: now,
    realWriteApproved: true,
    safety: {
      full8Started: false,
      listingAiDraftOnly: false,
      adWriteActionsPerformed: true,
    },
    approval: {
      operatorConfirmed: true,
      scope: 'FT-US-US / US / Campaign A / Ad Group A / close match / lower_bid',
      confirmedAt: now,
      approverName: 'Ops Owner',
      approvalArtifactPath: 'approval-ticket-123',
    },
    target: {
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      campaignName: 'Campaign A',
      adGroupName: 'Ad Group A',
      entityType: 'target',
      entityName: 'close match',
      actionType: 'lower_bid',
    },
    risk: {
      level: 'low',
      allowedByPolicy: true,
      rationale: 'Small reversible bid decrease on one target.',
    },
    before: {
      value: '2.40',
      capturedAt: now,
      screenshotPath: writePng(path.join(dir, 'before.png')),
      liveBidSourceNote: 'Read from Ads UI editable target bid cell before manual change.',
    },
    after: {
      value: '2.16',
      capturedAt: now,
      screenshotPath: writePng(path.join(dir, 'after.png')),
    },
    readback: {
      verified: true,
      method: 'Ads UI reload target row',
      readAt: now,
      actualValue: '2.16',
      evidencePath: writePng(path.join(dir, 'readback.png')),
    },
    execution: {
      success: true,
      verified: true,
      executionId: 'manual-ads-ui-123',
      executedAt: now,
      channel: 'manual_ads_ui',
      performedBy: 'operator@example.com',
      appExecutorUsed: false,
    },
    source: {
      recommendationId: 'rec-1',
      sourceFiles: [writeReport(path.join(dir, 'user-search-term.xlsx'))],
      sourceRow: 12,
      evidencePath: 'output/codex-evidence/installed-ad-ai-explanation.json',
      entityType: 'search_term',
      currentValue: '2.40',
      recommendedValue: '2.16',
    },
    ...overrides,
  };
}

describe('verify ad readback evidence', () => {
  it('accepts scoped manual Ads UI readback evidence', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-verifier-pass-'));
    const evidencePath = path.join(dir, 'readback.json');
    fs.writeFileSync(evidencePath, JSON.stringify(validEvidence(dir), null, 2), 'utf8');

    const result = runNode('scripts/verify-ad-readback-evidence.js', [evidencePath]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('execution result is successful, verified, and scoped to manual Ads UI operation');
    expect(result.stdout).toContain('AD_READBACK_EVIDENCE verified');
  });

  it('rejects evidence that claims the app executor performed the manual readback action', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-verifier-app-exec-'));
    const evidence = validEvidence(dir);
    evidence.execution.appExecutorUsed = true;
    const evidencePath = path.join(dir, 'readback.json');
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');

    const result = runNode('scripts/verify-ad-readback-evidence.js', [evidencePath]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('execution result is not proven successful, verified, and manually performed outside the app executor');
  });

  it('rejects evidence without a traceable approver artifact', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-verifier-approval-'));
    const evidence = validEvidence(dir);
    evidence.approval.approvalArtifactPath = 'not-traceable';
    const evidencePath = path.join(dir, 'readback.json');
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');

    const result = runNode('scripts/verify-ad-readback-evidence.js', [evidencePath]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('operator approval proof is incomplete');
  });

  it('rejects before values that do not prove a live Ads UI bid source', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-verifier-source-'));
    const evidence = validEvidence(dir);
    delete evidence.before.liveBidSourceNote;
    const evidencePath = path.join(dir, 'readback.json');
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');

    const result = runNode('scripts/verify-ad-readback-evidence.js', [evidencePath]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('before/after values do not prove a live Ads UI change');
  });

  it('rejects lower_bid readback evidence when the after value is higher than the before value', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-verifier-lower-bid-direction-'));
    const evidence = validEvidence(dir);
    evidence.before.value = '2.40';
    evidence.after.value = '2.60';
    evidence.readback.actualValue = '2.60';
    const evidencePath = path.join(dir, 'readback.json');
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');

    const result = runNode('scripts/verify-ad-readback-evidence.js', [evidencePath]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('lower_bid action did not lower the bid value');
  });

  it('accepts readback evidence when the source current value does not match the before value', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-verifier-source-current-'));
    const evidence = validEvidence(dir);
    evidence.source.currentValue = '2.10';
    const evidencePath = path.join(dir, 'readback.json');
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');

    const result = runNode('scripts/verify-ad-readback-evidence.js', [evidencePath]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('source current value is present');
  });

  it('rejects readback evidence when the source current value is missing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-verifier-source-current-missing-'));
    const evidence = validEvidence(dir);
    delete evidence.source.currentValue;
    const evidencePath = path.join(dir, 'readback.json');
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');

    const result = runNode('scripts/verify-ad-readback-evidence.js', [evidencePath]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('source current value is missing');
  });

  it('accepts readback evidence when the source recommended value does not match the after value', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-verifier-source-recommended-'));
    const evidence = validEvidence(dir);
    evidence.source.recommendedValue = '2.00';
    const evidencePath = path.join(dir, 'readback.json');
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');

    const result = runNode('scripts/verify-ad-readback-evidence.js', [evidencePath]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('source recommended value is present');
  });

  it('rejects readback evidence when the source recommended value is missing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-verifier-source-recommended-missing-'));
    const evidence = validEvidence(dir);
    delete evidence.source.recommendedValue;
    const evidencePath = path.join(dir, 'readback.json');
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');

    const result = runNode('scripts/verify-ad-readback-evidence.js', [evidencePath]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('source recommended value is missing');
  });

  it('accepts readback evidence when the readback value numerically matches the after value with USD formatting', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-verifier-readback-formatting-'));
    const evidence = validEvidence(dir);
    evidence.after.value = '2.16 USD';
    evidence.readback.actualValue = '$2.16';
    evidence.source.recommendedValue = '2.16';
    const evidencePath = path.join(dir, 'readback.json');
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');

    const result = runNode('scripts/verify-ad-readback-evidence.js', [evidencePath]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('readback verified the after value');
  });

  it('accepts readback evidence when source recommendation values differ from live Ads bid values', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-verifier-source-live-separation-'));
    const evidence = validEvidence(dir);
    evidence.before.value = '1.20';
    evidence.after.value = '1.08';
    evidence.readback.actualValue = '1.08';
    evidence.source.currentValue = '2.40';
    evidence.source.recommendedValue = '2.16';
    evidence.before.liveBidSourceNote = 'Read from editable Ads UI bid row; source values are recommendation inputs from Lingxing report.';
    const evidencePath = path.join(dir, 'readback.json');
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');

    const result = runNode('scripts/verify-ad-readback-evidence.js', [evidencePath]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('source recommendation values are present');
    expect(result.stdout).toContain('AD_READBACK_EVIDENCE verified');
  });

  it('rejects readback evidence when before and after values are numerically unchanged with different USD formatting', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-verifier-unchanged-formatting-'));
    const evidence = validEvidence(dir);
    evidence.target.actionType = 'pause_target';
    evidence.before.value = '$2.16';
    evidence.after.value = '2.16 USD';
    evidence.source.currentValue = '2.16';
    evidence.source.recommendedValue = '2.16';
    evidence.readback.actualValue = '2.16';
    const evidencePath = path.join(dir, 'readback.json');
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');

    const result = runNode('scripts/verify-ad-readback-evidence.js', [evidencePath]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('before/after values do not prove a live Ads UI change');
  });

  it('rejects readback without independent evidence', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-verifier-readback-proof-'));
    const evidence = validEvidence(dir);
    delete evidence.readback.evidencePath;
    const evidencePath = path.join(dir, 'readback.json');
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');

    const result = runNode('scripts/verify-ad-readback-evidence.js', [evidencePath]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('readback evidence path missing');
  });

  it('rejects evidence when before and after screenshots reuse the same file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-verifier-duplicate-before-after-'));
    const evidence = validEvidence(dir);
    evidence.after.screenshotPath = evidence.before.screenshotPath;
    const evidencePath = path.join(dir, 'readback.json');
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');

    const result = runNode('scripts/verify-ad-readback-evidence.js', [evidencePath]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('before, after, and readback evidence files must be distinct');
  });

  it('rejects evidence when readback proof reuses the after screenshot file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-verifier-duplicate-after-readback-'));
    const evidence = validEvidence(dir);
    evidence.readback.evidencePath = evidence.after.screenshotPath;
    const evidencePath = path.join(dir, 'readback.json');
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');

    const result = runNode('scripts/verify-ad-readback-evidence.js', [evidencePath]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('before, after, and readback evidence files must be distinct');
  });

  it('rejects out-of-order evidence timestamps', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-verifier-time-'));
    const evidence = validEvidence(dir);
    evidence.execution.executedAt = '2026-06-09T23:59:00.000Z';
    const evidencePath = path.join(dir, 'readback.json');
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');

    const result = runNode('scripts/verify-ad-readback-evidence.js', [evidencePath]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('execution.executedAt timestamp is earlier than before.capturedAt');
  });

  it('rejects readback evidence without a traceable source report row', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-verifier-source-row-'));
    const evidence = validEvidence(dir);
    delete evidence.source.sourceRow;
    const evidencePath = path.join(dir, 'readback.json');
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');

    const result = runNode('scripts/verify-ad-readback-evidence.js', [evidencePath]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('source report traceability is incomplete');
  });

  it('rejects readback evidence whose source file is not a real spreadsheet report', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-verifier-source-file-'));
    const auditFile = path.join(dir, 'acceptance-audit.json');
    fs.writeFileSync(auditFile, '{}\n', 'utf8');
    const evidence = validEvidence(dir, {
      source: {
        recommendationId: 'rec-1',
        sourceFiles: [auditFile],
        sourceRow: 12,
        evidencePath: 'output/codex-evidence/installed-ad-ai-explanation.json',
        entityType: 'search_term',
        currentValue: '2.40',
        recommendedValue: '2.16',
      },
    });
    const evidencePath = path.join(dir, 'readback.json');
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');

    const result = runNode('scripts/verify-ad-readback-evidence.js', [evidencePath]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('source report traceability is incomplete');
  });
});

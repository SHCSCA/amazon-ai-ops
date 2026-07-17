import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'url';
import {
  executeAdReadbackAuthorityDb,
  writeAdReadbackAuthorityDb as writeAuthorityDb,
} from './ad-readback-authority-db.test-fixture.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function runNode(script, args = [], options = {}) {
  return spawnSync(process.execPath, [path.join(root, script), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...(options.env || {}) },
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
  fs.writeFileSync(filePath, 'placeholder report file for verifier traceability\n', 'utf8');
  return filePath;
}

function validEvidence(dir, overrides = {}) {
  const now = '2026-06-10T00:00:00.000Z';
  return {
    schemaVersion: 2,
    kind: 'real-ad-execution-readback',
    status: 'PASS',
    createdAt: now,
    authority: {
      recommendationId: 1,
      recommendationRevision: 4,
      recommendationStatusAtExport: 'approved',
      dateFrom: '2026-06-01',
      dateTo: '2026-06-10',
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      asin: 'B0TESTASIN',
      batchId: 'batch_1',
      checkedAt: now,
    },
    realWriteApproved: true,
    safety: {
      full8Started: false,
      listingAiDraftOnly: false,
      adWriteActionsPerformed: true,
    },
    approval: {
      operatorConfirmed: true,
      scope: 'FT-US-US / US / B0TESTASIN / 2026-06-01~2026-06-10 / batch_1',
      confirmedAt: now,
      approverName: 'Ops Owner',
      approvalArtifactPath: 'approval-ticket-123',
    },
    target: {
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      asin: 'B0TESTASIN',
      metricDate: '2026-06-10',
      campaignName: 'Campaign A',
      adGroupName: 'Ad Group A',
      entityType: 'keyword',
      entityId: 'keyword-1',
      entityName: 'close match',
      identityProofPath: writePng(path.join(dir, 'target-identity.png')),
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
      recommendationId: '1',
      recommendationRevision: 4,
      batchId: 'batch_1',
      metricDate: '2026-06-10',
      sourceFiles: [writeReport(path.join(dir, 'user-search-term.xlsx'))],
      sourceRow: 12,
      evidencePath: 'output/codex-evidence/installed-ad-ai-explanation.json',
      entityType: 'target',
      currentValue: '2.40',
      recommendedValue: '2.16',
    },
    ...overrides,
  };
}

function runVerifierWithTempDb(dir, evidencePath, approvedEvidence, rowOverrides = {}) {
  const dbDir = path.join(dir, 'authority-db');
  fs.mkdirSync(dbDir, { recursive: true });
  const dbPath = writeAuthorityDb(dbDir, approvedEvidence, rowOverrides);
  return runNode('scripts/verify-ad-readback-evidence.js', [evidencePath, '--db', dbPath]);
}

describe('verify ad readback evidence', () => {
  it('accepts scoped manual Ads UI readback evidence', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-verifier-pass-'));
    const evidence = validEvidence(dir);
    const evidencePath = path.join(dir, 'readback.json');
    const dbPath = writeAuthorityDb(dir, evidence);
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');

    const result = runNode('scripts/verify-ad-readback-evidence.js', [evidencePath, '--db', dbPath]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('current approved recommendation matches SQLite authority');
    expect(result.stdout).toContain('execution result is successful, verified, and scoped to manual Ads UI operation');
    expect(result.stdout).toContain('AD_READBACK_EVIDENCE verified');
  });

  it('rejects v2 target context without an opaque writable entity id', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-verifier-target-id-'));
    const evidence = validEvidence(dir);
    const dbPath = writeAuthorityDb(dir, evidence);
    evidence.target.entityId = '';
    const evidencePath = path.join(dir, 'readback.json');
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');

    const result = runNode('scripts/verify-ad-readback-evidence.js', [evidencePath, '--db', dbPath]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('target context is incomplete');
  });

  it('rejects v2 target context when the identity proof file is missing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-verifier-target-proof-'));
    const evidence = validEvidence(dir);
    const dbPath = writeAuthorityDb(dir, evidence);
    fs.rmSync(evidence.target.identityProofPath);
    const evidencePath = path.join(dir, 'readback.json');
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');

    const result = runNode('scripts/verify-ad-readback-evidence.js', [evidencePath, '--db', dbPath]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('target context is incomplete');
  });

  it('rejects a target field that no longer matches the approved SQLite recommendation', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-verifier-db-target-'));
    const evidence = validEvidence(dir);
    const dbPath = writeAuthorityDb(dir, evidence);
    evidence.target.campaignName = 'Tampered Campaign';
    const evidencePath = path.join(dir, 'readback.json');
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');

    const result = runNode('scripts/verify-ad-readback-evidence.js', [evidencePath, '--db', dbPath]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('target.campaignName');
  });

  it('rejects a source value that no longer matches the approved SQLite recommendation', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-verifier-db-source-'));
    const evidence = validEvidence(dir);
    const dbPath = writeAuthorityDb(dir, evidence);
    evidence.source.currentValue = '9.99';
    const evidencePath = path.join(dir, 'readback.json');
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');

    const result = runNode('scripts/verify-ad-readback-evidence.js', [evidencePath, '--db', dbPath]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('source.currentValue');
  });

  it('rejects approval identity that no longer matches the SQLite approval decision', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-verifier-db-approval-'));
    const evidence = validEvidence(dir);
    const dbPath = writeAuthorityDb(dir, evidence);
    evidence.approval.approverName = 'Tampered Approver';
    const evidencePath = path.join(dir, 'readback.json');
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');

    const result = runNode('scripts/verify-ad-readback-evidence.js', [evidencePath, '--db', dbPath]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('approval.approverName');
  });

  it('rejects a risk rationale that no longer matches the approved recommendation', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-verifier-db-risk-'));
    const evidence = validEvidence(dir);
    const dbPath = writeAuthorityDb(dir, evidence);
    evidence.risk.rationale = 'Tampered rationale';
    const evidencePath = path.join(dir, 'readback.json');
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');

    const result = runNode('scripts/verify-ad-readback-evidence.js', [evidencePath, '--db', dbPath]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('risk.rationale');
  });

  it('rejects checkedAt when it no longer matches the SQLite recommendation update time', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-verifier-db-checked-at-'));
    const evidence = validEvidence(dir);
    const dbPath = writeAuthorityDb(dir, evidence);
    evidence.authority.checkedAt = '2026-06-10T00:00:01.000Z';
    const evidencePath = path.join(dir, 'readback.json');
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');

    const result = runNode('scripts/verify-ad-readback-evidence.js', [evidencePath, '--db', dbPath]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('authority.checkedAt');
  });

  it('rejects evidence when the SQLite recommendation revision has advanced', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-verifier-db-stale-'));
    const evidence = validEvidence(dir);
    const dbPath = writeAuthorityDb(dir, evidence, { revision: 5 });
    const evidencePath = path.join(dir, 'readback.json');
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');

    const result = runNode('scripts/verify-ad-readback-evidence.js', [evidencePath, '--db', dbPath]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('revision is 5, evidence expects 4');
  });

  it('rejects evidence when the SQLite recommendation is no longer approved', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-verifier-db-status-'));
    const evidence = validEvidence(dir);
    const dbPath = writeAuthorityDb(dir, evidence, { status: 'executed' });
    const evidencePath = path.join(dir, 'readback.json');
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');

    const result = runNode('scripts/verify-ad-readback-evidence.js', [evidencePath, '--db', dbPath]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('is executed, not approved');
  });

  it('rejects evidence when its approved batch is no longer present in SQLite', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-verifier-db-batch-missing-'));
    const evidence = validEvidence(dir);
    const dbPath = writeAuthorityDb(dir, evidence);
    executeAdReadbackAuthorityDb(dbPath, 'DELETE FROM lingxing_report_batches WHERE id = ?', [evidence.authority.batchId]);
    const evidencePath = path.join(dir, 'readback.json');
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');

    const result = runNode('scripts/verify-ad-readback-evidence.js', [evidencePath, '--db', dbPath]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('current report batch does not exist');
  });

  it('rejects evidence when its source file is no longer a current batch report', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-verifier-db-report-missing-'));
    const evidence = validEvidence(dir);
    const dbPath = writeAuthorityDb(dir, evidence);
    executeAdReadbackAuthorityDb(dbPath, 'DELETE FROM lingxing_report_files WHERE batch_id = ?', [evidence.authority.batchId]);
    const evidencePath = path.join(dir, 'readback.json');
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');

    const result = runNode('scripts/verify-ad-readback-evidence.js', [evidencePath, '--db', dbPath]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('current real report files');
  });

  it('rejects evidence when the current batch has no imported actionable metrics', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-verifier-db-metrics-missing-'));
    const evidence = validEvidence(dir);
    const dbPath = writeAuthorityDb(dir, evidence);
    executeAdReadbackAuthorityDb(dbPath, 'DELETE FROM ad_daily_metrics WHERE batch_id = ?', [evidence.authority.batchId]);
    const evidencePath = path.join(dir, 'readback.json');
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');

    const result = runNode('scripts/verify-ad-readback-evidence.js', [evidencePath, '--db', dbPath]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('writable Ads target does not map to exactly one current imported metric row');
  });

  it('rejects an explicit SQLite authority path that does not exist', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-verifier-db-missing-'));
    const evidence = validEvidence(dir);
    const evidencePath = path.join(dir, 'readback.json');
    const missingDbPath = path.join(dir, 'missing-amazon-ai-ops.db');
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');

    const result = runNode('scripts/verify-ad-readback-evidence.js', [evidencePath, '--db', missingDbPath]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('SQLite authority database does not exist');
  });

  it('discovers the production AppData SQLite authority database by default', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-verifier-db-default-'));
    const appData = path.join(dir, 'AppData', 'Roaming');
    const dbDir = path.join(appData, '@amazon-ai-ops', 'desktop');
    fs.mkdirSync(dbDir, { recursive: true });
    const evidence = validEvidence(dir);
    const dbPath = writeAuthorityDb(dbDir, evidence);
    const evidencePath = path.join(dir, 'readback.json');
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');

    const result = runNode('scripts/verify-ad-readback-evidence.js', [evidencePath], {
      env: {
        APPDATA: appData,
        USERPROFILE: path.join(dir, 'profile'),
        AMAZON_AI_OPS_DB_PATH: '',
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(fs.realpathSync.native(dbPath));
  });

  it('fails closed when default SQLite authority discovery finds no database', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-verifier-db-default-missing-'));
    const evidence = validEvidence(dir);
    const evidencePath = path.join(dir, 'readback.json');
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');

    const result = runNode('scripts/verify-ad-readback-evidence.js', [evidencePath], {
      env: {
        APPDATA: path.join(dir, 'empty-appdata'),
        USERPROFILE: path.join(dir, 'empty-profile'),
        AMAZON_AI_OPS_DB_PATH: '',
      },
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('SQLite authority database was not found');
  });

  it('fails closed when default discovery finds multiple authority databases', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-verifier-db-ambiguous-'));
    const appData = path.join(dir, 'AppData', 'Roaming');
    const evidence = validEvidence(dir);
    writeAuthorityDb(path.join(appData, '@amazon-ai-ops', 'desktop'), evidence);
    writeAuthorityDb(path.join(appData, 'AmazonAIOpsAgent'), evidence);
    const evidencePath = path.join(dir, 'readback.json');
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');

    const result = runNode('scripts/verify-ad-readback-evidence.js', [evidencePath], {
      env: {
        APPDATA: appData,
        USERPROFILE: path.join(dir, 'empty-profile'),
        AMAZON_AI_OPS_DB_PATH: '',
      },
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('multiple SQLite authority databases');
    expect(`${result.stdout}${result.stderr}`).toContain('Pass --db');
  });

  it('rejects legacy evidence without the v2 authority record', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-verifier-v1-'));
    const evidence = validEvidence(dir);
    const approvedEvidence = structuredClone(evidence);
    delete evidence.schemaVersion;
    delete evidence.authority;
    const evidencePath = path.join(dir, 'readback.json');
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');

    const result = runVerifierWithTempDb(dir, evidencePath, approvedEvidence);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('v2 authority');
  });

  it('rejects evidence that claims the app executor performed the manual readback action', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-verifier-app-exec-'));
    const evidence = validEvidence(dir);
    evidence.execution.appExecutorUsed = true;
    const evidencePath = path.join(dir, 'readback.json');
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');

    const result = runVerifierWithTempDb(dir, evidencePath, evidence);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('execution result is not proven successful, verified, and manually performed outside the app executor');
  });

  it('rejects evidence without a traceable approver artifact', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-verifier-approval-'));
    const evidence = validEvidence(dir);
    evidence.approval.approvalArtifactPath = 'not-traceable';
    const evidencePath = path.join(dir, 'readback.json');
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');

    const result = runVerifierWithTempDb(dir, evidencePath, evidence);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('operator approval proof is incomplete');
  });

  it('rejects before values that do not prove a live Ads UI bid source', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-verifier-source-'));
    const evidence = validEvidence(dir);
    delete evidence.before.liveBidSourceNote;
    const evidencePath = path.join(dir, 'readback.json');
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');

    const result = runVerifierWithTempDb(dir, evidencePath, evidence);

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

    const result = runVerifierWithTempDb(dir, evidencePath, evidence);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('lower_bid action did not lower the bid value');
  });

  it('accepts readback evidence when the source current value does not match the before value', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-verifier-source-current-'));
    const evidence = validEvidence(dir);
    evidence.source.currentValue = '2.10';
    const evidencePath = path.join(dir, 'readback.json');
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');

    const result = runVerifierWithTempDb(dir, evidencePath, evidence);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('source current value is present');
  });

  it('rejects readback evidence when the source current value is missing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-verifier-source-current-missing-'));
    const evidence = validEvidence(dir);
    const approvedEvidence = structuredClone(evidence);
    delete evidence.source.currentValue;
    const evidencePath = path.join(dir, 'readback.json');
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');

    const result = runVerifierWithTempDb(dir, evidencePath, approvedEvidence);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('source current value is missing');
  });

  it('accepts readback evidence when the source recommended value does not match the after value', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-verifier-source-recommended-'));
    const evidence = validEvidence(dir);
    evidence.source.recommendedValue = '2.00';
    const evidencePath = path.join(dir, 'readback.json');
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');

    const result = runVerifierWithTempDb(dir, evidencePath, evidence);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('source recommended value is present');
  });

  it('rejects readback evidence when the source recommended value is missing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-verifier-source-recommended-missing-'));
    const evidence = validEvidence(dir);
    const approvedEvidence = structuredClone(evidence);
    delete evidence.source.recommendedValue;
    const evidencePath = path.join(dir, 'readback.json');
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');

    const result = runVerifierWithTempDb(dir, evidencePath, approvedEvidence);

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

    const result = runVerifierWithTempDb(dir, evidencePath, evidence);

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

    const result = runVerifierWithTempDb(dir, evidencePath, evidence);

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

    const result = runVerifierWithTempDb(dir, evidencePath, evidence);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('before/after values do not prove a live Ads UI change');
  });

  it('rejects readback without independent evidence', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-verifier-readback-proof-'));
    const evidence = validEvidence(dir);
    delete evidence.readback.evidencePath;
    const evidencePath = path.join(dir, 'readback.json');
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');

    const result = runVerifierWithTempDb(dir, evidencePath, evidence);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('readback evidence path missing');
  });

  it('rejects evidence when before and after screenshots reuse the same file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-verifier-duplicate-before-after-'));
    const evidence = validEvidence(dir);
    evidence.after.screenshotPath = evidence.before.screenshotPath;
    const evidencePath = path.join(dir, 'readback.json');
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');

    const result = runVerifierWithTempDb(dir, evidencePath, evidence);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('before, after, and readback evidence files must be distinct');
  });

  it('rejects evidence when readback proof reuses the after screenshot file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-verifier-duplicate-after-readback-'));
    const evidence = validEvidence(dir);
    evidence.readback.evidencePath = evidence.after.screenshotPath;
    const evidencePath = path.join(dir, 'readback.json');
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');

    const result = runVerifierWithTempDb(dir, evidencePath, evidence);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('before, after, and readback evidence files must be distinct');
  });

  it('rejects distinct screenshot paths whose SHA-256 content is reused', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-verifier-duplicate-content-'));
    const evidence = validEvidence(dir);
    const reusedContent = fs.readFileSync(evidence.before.screenshotPath);
    fs.writeFileSync(evidence.after.screenshotPath, reusedContent);
    fs.writeFileSync(evidence.readback.evidencePath, reusedContent);
    const evidencePath = path.join(dir, 'readback.json');
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');

    const result = runVerifierWithTempDb(dir, evidencePath, evidence);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('SHA-256');
  });

  it('rejects out-of-order evidence timestamps', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-verifier-time-'));
    const evidence = validEvidence(dir);
    evidence.execution.executedAt = '2026-06-09T23:59:00.000Z';
    const evidencePath = path.join(dir, 'readback.json');
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');

    const result = runVerifierWithTempDb(dir, evidencePath, evidence);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('execution.executedAt timestamp is earlier than before.capturedAt');
  });

  it('rejects readback evidence without a traceable source report row', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-verifier-source-row-'));
    const evidence = validEvidence(dir);
    const approvedEvidence = structuredClone(evidence);
    delete evidence.source.sourceRow;
    const evidencePath = path.join(dir, 'readback.json');
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');

    const result = runVerifierWithTempDb(dir, evidencePath, approvedEvidence);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('source report traceability is incomplete');
  });

  it('rejects readback evidence whose source file is not a real spreadsheet report', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-verifier-source-file-'));
    const auditFile = path.join(dir, 'acceptance-audit.json');
    fs.writeFileSync(auditFile, '{}\n', 'utf8');
    const approvedEvidence = validEvidence(dir);
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

    const result = runVerifierWithTempDb(dir, evidencePath, approvedEvidence);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('source report traceability is incomplete');
  });
});

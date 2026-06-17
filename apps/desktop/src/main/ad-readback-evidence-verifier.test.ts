import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { verifyAdReadbackEvidenceFile } from './ad-readback-evidence-verifier';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-ad-readback-verifier-'));
}

function writeFile(filePath: string, content = 'placeholder'): string {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

function validEvidence(dir: string, overrides: Record<string, any> = {}): Record<string, any> {
  const now = '2026-06-18T10:00:00.000Z';
  const evidence = {
    kind: 'real-ad-execution-readback',
    status: 'PASS',
    realWriteApproved: true,
    safety: {
      full8Started: false,
      listingAiDraftOnly: false,
      adWriteActionsPerformed: true,
    },
    approval: {
      operatorConfirmed: true,
      scope: 'FT-US-US / US / Campaign A / Ad Group A / target / lower_bid',
      confirmedAt: now,
      approverName: 'Ops Lead',
      approvalArtifactPath: writeFile(path.join(dir, 'approval.png')),
    },
    target: {
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      campaignName: 'Campaign A',
      adGroupName: 'Ad Group A',
      entityType: 'target',
      entityName: 'door lock',
      actionType: 'lower_bid',
    },
    risk: {
      level: 'low',
      allowedByPolicy: true,
      rationale: 'One reversible bid decrease.',
    },
    before: {
      value: '1.20',
      capturedAt: '2026-06-18T10:01:00.000Z',
      screenshotPath: writeFile(path.join(dir, 'before.png')),
      liveBidSourceNote: 'Read from Ads UI editable bid row.',
    },
    after: {
      value: '1.08',
      capturedAt: '2026-06-18T10:03:00.000Z',
      screenshotPath: writeFile(path.join(dir, 'after.png')),
    },
    readback: {
      verified: true,
      method: 'Ads UI reload target row',
      readAt: '2026-06-18T10:05:00.000Z',
      actualValue: '1.08',
      evidencePath: writeFile(path.join(dir, 'readback.png')),
    },
    execution: {
      success: true,
      verified: true,
      executionId: 'manual-ads-ui-001',
      executedAt: '2026-06-18T10:02:00.000Z',
      channel: 'manual_ads_ui',
      performedBy: 'Operator A',
      appExecutorUsed: false,
    },
    source: {
      recommendationId: 'rec-4',
      sourceFiles: [writeFile(path.join(dir, 'user-search-term.xlsx'))],
      sourceRow: 410,
      currentValue: '1.20',
      recommendedValue: '1.08',
    },
  };
  return { ...evidence, ...overrides };
}

function writeEvidence(dir: string, evidence: Record<string, any>): string {
  const evidencePath = path.join(dir, 'readback.json');
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  return evidencePath;
}

describe('verifyAdReadbackEvidenceFile', () => {
  it('accepts complete manual Ads UI readback evidence', () => {
    const dir = tempDir();
    const evidencePath = writeEvidence(dir, validEvidence(dir));

    const result = verifyAdReadbackEvidenceFile(evidencePath);

    expect(result.ready).toBe(true);
    expect(result.status).toBe('PASS');
    expect(result.issues).toEqual([]);
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'execution result is successful, verified, and scoped to manual Ads UI operation', passed: true }),
      expect.objectContaining({ label: 'source report traceability includes real spreadsheet file(s) and row number', passed: true }),
    ]));
  });

  it('rejects audit JSON masquerading as source report evidence', () => {
    const dir = tempDir();
    const auditPath = writeFile(path.join(dir, 'acceptance-audit.json'), '{}\n');
    const evidence = validEvidence(dir, {
      source: {
        recommendationId: 'rec-4',
        sourceFiles: [auditPath],
        sourceRow: 410,
        currentValue: '1.20',
        recommendedValue: '1.08',
      },
    });
    const evidencePath = writeEvidence(dir, evidence);

    const result = verifyAdReadbackEvidenceFile(evidencePath);

    expect(result.ready).toBe(false);
    expect(result.issues.join('\n')).toContain('source report traceability includes real spreadsheet file(s) and row number');
  });

  it('rejects reused before, after, and readback proof files', () => {
    const dir = tempDir();
    const evidence = validEvidence(dir);
    evidence.after.screenshotPath = evidence.before.screenshotPath;
    const evidencePath = writeEvidence(dir, evidence);

    const result = verifyAdReadbackEvidenceFile(evidencePath);

    expect(result.ready).toBe(false);
    expect(result.issues.join('\n')).toContain('before, after, and readback evidence files are distinct');
  });
});

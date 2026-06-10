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

describe('ad readback evidence template', () => {
  it('creates a non-passing template for real readback completion', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-template-'));
    const out = path.join(dir, 'template.json');
    const mdOut = path.join(dir, 'template.md');
    const result = runNode('scripts/create-ad-readback-evidence-template.js', [
      '--out', out,
      '--md-out', mdOut,
      '--campaign', 'Test Campaign',
      '--ad-group', 'Test Ad Group',
      '--portfolio', 'Test Portfolio',
      '--asin', 'B0TESTASIN',
      '--metric-date', '2026-05-23',
      '--entity', 'test target',
      '--recommendation-id', 'rec-1',
      '--source-evidence', 'output/codex-evidence/source.json',
      '--source-entity-type', 'search_term',
      '--source-current-value', '2.40',
      '--source-recommended-value', '2.16',
      '--approval-scope', 'FT-US-US / US / Test Campaign / Test Ad Group / test target / lower_bid',
      '--risk-rationale', 'Lowering a bid is bounded and reversible after readback.',
    ]);

    expect(result.status).toBe(0);
    const evidence = JSON.parse(fs.readFileSync(out, 'utf8'));
    expect(evidence.kind).toBe('real-ad-execution-readback');
    expect(evidence.status).toBe('NEEDS_WORK');
    expect(evidence.realWriteApproved).toBe(false);
    expect(evidence.safety.adWriteActionsPerformed).toBe(false);
    expect(evidence.target.portfolioName).toBe('Test Portfolio');
    expect(evidence.target.asin).toBe('B0TESTASIN');
    expect(evidence.target.metricDate).toBe('2026-05-23');
    expect(evidence.before.value).toContain('FILL:');
    expect(evidence.after.value).toContain('FILL:');
    expect(evidence.source.recommendationId).toBe('rec-1');
    expect(evidence.source.entityType).toBe('search_term');
    expect(evidence.source.currentValue).toBe('2.40');
    expect(evidence.source.recommendedValue).toBe('2.16');
    expect(evidence.approval.approverName).toContain('FILL:');
    expect(evidence.approval.approvalArtifactPath).toContain('FILL:');
    expect(evidence.approval.confirmedAt).toContain('FILL:');
    expect(evidence.before.liveBidSourceNote).toContain('FILL:');
    expect(evidence.before.capturedAt).toContain('FILL:');
    expect(evidence.after.capturedAt).toContain('FILL:');
    expect(evidence.readback.readAt).toContain('FILL:');
    expect(evidence.readback.evidencePath).toContain('FILL:');
    expect(evidence.execution.executedAt).toContain('FILL:');
    expect(evidence.execution.channel).toBe('manual_ads_ui');
    expect(evidence.execution.performedBy).toContain('FILL:');
    expect(evidence.execution.appExecutorUsed).toBe(false);
    const checklist = fs.readFileSync(mdOut, 'utf8');
    expect(checklist).toContain('Real Ad Execution Readback Approval Packet');
    expect(checklist).toContain('Test Campaign');
    expect(checklist).toContain('B0TESTASIN');
    expect(checklist).toContain('Source recommended value');
    expect(checklist).toContain('Execution channel');
    expect(checklist).toContain('before.liveBidSourceNote');
    expect(checklist).toContain('readback.evidencePath');
    expect(checklist).toContain('execution.appExecutorUsed=false');
    expect(checklist).toContain('pnpm run verify:ad-readback');
    expect(checklist).toContain('must not be used to claim APP_READY');

    const verify = runNode('scripts/verify-ad-readback-evidence.js', [out]);
    expect(verify.status).not.toBe(0);
    expect(`${verify.stdout}${verify.stderr}`).toContain('NEEDS_WORK: Real ad execution readback evidence is incomplete.');
  });
});

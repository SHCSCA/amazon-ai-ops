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

describe('prepare ad readback session packet', () => {
  it('creates an operator folder with screenshot targets and a fill command without copying raw reports', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-session-'));
    const report = path.join(dir, 'source-report.xlsx');
    const identityProof = path.join(dir, 'target-identity-proof.json');
    const source = path.join(dir, 'candidate.json');
    const out = path.join(dir, 'session');
    fs.writeFileSync(report, 'fake report placeholder\n', 'utf8');
    fs.writeFileSync(identityProof, '{"verified":true}\n', 'utf8');
    fs.writeFileSync(source, JSON.stringify({
      kind: 'real-ad-execution-readback',
      status: 'NEEDS_WORK',
      target: {
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        campaignName: 'Campaign A',
        adGroupName: 'Ad Group B',
        portfolioName: 'Portfolio C',
        asin: 'B0TESTASIN',
        entityType: 'target',
        entityId: 'target-id-410',
        entityName: 'door lock',
        identityProofPath: identityProof,
        actionType: 'lower_bid',
      },
      source: {
        currentValue: '1.63',
        recommendedValue: '1.46',
        sourceFiles: [report],
        sourceRow: 410,
      },
      approval: {
        scope: 'FT-US-US / US / Campaign A / Ad Group B / target=door lock / lower_bid',
      },
      risk: {
        rationale: 'Lowering one target bid is bounded and reversible.',
      },
    }, null, 2), 'utf8');

    const result = runNode('scripts/prepare-ad-readback-session.js', [
      '--source', source,
      '--out', out,
    ]);

    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(out, 'operator-checklist.md'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'ads-ui-locator.md'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'session-input-guide.md'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'fill-ad-readback.ps1'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'session-paths.json'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'session-input.json'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'approvals'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'screenshots', 'before'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'screenshots', 'after'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'screenshots', 'readback'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'source-report.xlsx'))).toBe(false);

    const sessionPaths = JSON.parse(fs.readFileSync(path.join(out, 'session-paths.json'), 'utf8'));
    expect(sessionPaths.sourceCandidatePath).toBe(path.resolve(source));
    expect(sessionPaths.passEvidencePath).toBe(path.join(out, 'real-ad-execution-readback-pass.json'));
    expect(sessionPaths.sessionInputGuidePath).toBe(path.join(out, 'session-input-guide.md'));
    expect(sessionPaths.sourceReports).toEqual([report]);
    expect(sessionPaths.sourceReportsCopied).toBe(false);

    const checklist = fs.readFileSync(path.join(out, 'operator-checklist.md'), 'utf8');
    expect(checklist).toContain('Campaign A');
    expect(checklist).toContain('Ad Group B');
    expect(checklist).toContain('door lock');
    expect(checklist).toContain('target-id-410');
    expect(checklist).toContain(identityProof);
    expect(checklist).toContain('来源报表行号 | 410');
    expect(checklist).toContain('建议来源值不是 Ads UI 实时值');
    expect(checklist).toContain('session-input.json');
    expect(checklist).toContain('pnpm run fill:ad-readback-session --');
    expect(checklist).toContain('real-ad-execution-readback-pass.json');
    expect(checklist).not.toContain('defaults to after value if omitted');

    const locatorGuide = fs.readFileSync(path.join(out, 'ads-ui-locator.md'), 'utf8');
    expect(locatorGuide).toContain('Ads UI 定位单');
    expect(locatorGuide).toContain('Campaign A');
    expect(locatorGuide).toContain('Ad Group B');
    expect(locatorGuide).toContain('door lock');
    expect(locatorGuide).toContain('target-id-410');
    expect(locatorGuide).toContain(identityProof);
    expect(locatorGuide).toContain('来源报表行号 | 410');
    expect(locatorGuide).toContain('before 和 after 必须从 Ads UI 现场读取');

    const inputGuide = fs.readFileSync(path.join(out, 'session-input-guide.md'), 'utf8');
    expect(inputGuide).toContain('session-input.json 填写指南');
    expect(inputGuide).toContain('审批/审批人');
    expect(inputGuide).toContain('执行前/执行前 Ads UI live bid');
    expect(inputGuide).toContain('Campaign A');
    expect(inputGuide).toContain('target-id-410');
    expect(inputGuide).toContain(identityProof);
    expect(inputGuide).toContain('必须从刷新后的 Ads UI 独立读取');

    const command = fs.readFileSync(path.join(out, 'fill-ad-readback.ps1'), 'utf8');
    expect(command).toContain('pnpm run fill:ad-readback-session --');
    expect(command).toContain(path.resolve(out));
    const input = JSON.parse(fs.readFileSync(path.join(out, 'session-input.json'), 'utf8'));
    expect(input.beforeScreenshotPath).toContain('screenshots\\before');
    expect(input.afterScreenshotPath).toContain('screenshots\\after');
    expect(input.readbackEvidencePath).toContain('screenshots\\readback');
  });

  it('refuses candidates that already claim PASS evidence', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-session-pass-'));
    const source = path.join(dir, 'candidate.json');
    fs.writeFileSync(source, JSON.stringify({
      kind: 'real-ad-execution-readback',
      status: 'PASS',
      target: {},
      source: {},
    }, null, 2), 'utf8');

    const result = runNode('scripts/prepare-ad-readback-session.js', [
      '--source', source,
      '--out', path.join(dir, 'session'),
    ]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('only prepares NEEDS_WORK candidates');
  });

  it('refuses a NEEDS_WORK candidate without target.entityId before creating folders', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-session-no-target-id-'));
    const source = path.join(dir, 'candidate.json');
    const out = path.join(dir, 'session');
    fs.writeFileSync(source, JSON.stringify({
      kind: 'real-ad-execution-readback',
      status: 'NEEDS_WORK',
      target: { identityProofPath: path.join(dir, 'target-proof.json') },
    }, null, 2), 'utf8');

    const result = runNode('scripts/prepare-ad-readback-session.js', ['--source', source, '--out', out]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('target.entityId');
    expect(fs.existsSync(out)).toBe(false);
  });

  it('refuses a NEEDS_WORK candidate whose target identity proof file does not exist', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-session-no-proof-'));
    const source = path.join(dir, 'candidate.json');
    const out = path.join(dir, 'session');
    fs.writeFileSync(source, JSON.stringify({
      kind: 'real-ad-execution-readback',
      status: 'NEEDS_WORK',
      target: {
        entityId: 'target-id-missing-proof',
        identityProofPath: path.join(dir, 'missing-target-proof.json'),
      },
    }, null, 2), 'utf8');

    const result = runNode('scripts/prepare-ad-readback-session.js', ['--source', source, '--out', out]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('identity proof file does not exist');
    expect(fs.existsSync(out)).toBe(false);
  });
});

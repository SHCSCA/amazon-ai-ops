import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { fillAdReadbackSession, prepareAdReadbackSession, verifyAdReadbackSession } from './ad-readback-session';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ad-readback-session-'));
}

function writeCandidate(dir: string, patch: Record<string, any> = {}): string {
  const reportPath = path.join(dir, 'source-user-search-term.xlsx');
  fs.writeFileSync(reportPath, 'fake spreadsheet bytes');
  const candidate = {
    schemaVersion: 2,
    kind: 'real-ad-execution-readback',
    status: 'NEEDS_WORK',
    authority: {
      recommendationId: 4,
      recommendationRevision: 3,
      recommendationStatusAtExport: 'approved',
      dateFrom: '2026-06-18',
      dateTo: '2026-06-18',
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      asin: 'B0TESTASIN',
      batchId: 'batch_1',
      checkedAt: '2026-06-18T09:59:00.000Z',
    },
    target: {
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      asin: 'B0TESTASIN',
      campaignName: 'D6 campaign',
      adGroupName: 'D6 ad group',
      entityType: 'target',
      entityName: 'door lock',
      actionType: 'lower_bid',
    },
    source: {
      recommendationId: '4',
      recommendationRevision: 3,
      batchId: 'batch_1',
      metricDate: '2026-06-18',
      currentValue: '1.20',
      recommendedValue: '1.08',
      sourceRow: 12,
      sourceFiles: [reportPath],
    },
    risk: {
      rationale: 'Lowering one paused target bid is bounded and reversible.',
    },
    ...patch,
  };
  const candidatePath = path.join(dir, 'candidate.json');
  fs.writeFileSync(candidatePath, `${JSON.stringify(candidate, null, 2)}\n`, 'utf8');
  return candidatePath;
}

describe('prepareAdReadbackSession', () => {
  it('creates a safe per-action session packet next to a NEEDS_WORK candidate', () => {
    const dir = tempDir();
    const candidatePath = writeCandidate(dir);
    const outDir = path.join(dir, 'session');

    const result = prepareAdReadbackSession({ sourcePath: candidatePath, outDir });

    expect(result.sessionDir).toBe(outDir);
    expect(fs.existsSync(result.checklistPath)).toBe(true);
    expect(fs.existsSync(result.locatorGuidePath)).toBe(true);
    expect(fs.existsSync(result.sessionInputPath)).toBe(true);
    expect(fs.existsSync(result.sessionInputGuidePath)).toBe(true);
    expect(fs.existsSync(result.fillScriptPath)).toBe(true);
    expect(fs.existsSync(result.approvalsDir)).toBe(true);
    expect(fs.existsSync(result.beforeScreenshotsDir)).toBe(true);
    expect(fs.existsSync(result.afterScreenshotsDir)).toBe(true);
    expect(fs.existsSync(result.readbackScreenshotsDir)).toBe(true);
    expect(result.passEvidencePath).not.toBe(candidatePath);

    const paths = JSON.parse(fs.readFileSync(path.join(outDir, 'session-paths.json'), 'utf8'));
    expect(paths).toMatchObject({
      sourceCandidatePath: candidatePath,
      sessionDir: outDir,
      passEvidencePath: path.join(outDir, 'real-ad-execution-readback-pass.json'),
      sessionInputGuidePath: path.join(outDir, 'session-input-guide.md'),
      sourceReportsCopied: false,
    });
    expect(paths.sourceReports).toHaveLength(1);

    const sessionInput = JSON.parse(fs.readFileSync(result.sessionInputPath, 'utf8'));
    expect(sessionInput.approvalArtifactPath).toContain(path.join('approvals', '<approval-proof.png-or-ticket.txt>'));
    expect(sessionInput.beforeScreenshotPath).toContain(path.join('screenshots', 'before', '<before.png>'));
    expect(sessionInput.afterScreenshotPath).toContain(path.join('screenshots', 'after', '<after.png>'));
    expect(sessionInput.readbackEvidencePath).toContain(path.join('screenshots', 'readback', '<readback.png>'));
    expect(sessionInput.riskRationale).toBe('Lowering one paused target bid is bounded and reversible.');

    const locatorGuide = fs.readFileSync(result.locatorGuidePath, 'utf8');
    expect(locatorGuide).toContain('Ads UI 定位单');
    expect(locatorGuide).toContain('D6 campaign');
    expect(locatorGuide).toContain('D6 ad group');
    expect(locatorGuide).toContain('door lock');
    expect(locatorGuide).toContain('来源报表行号 | 12');

    const inputGuide = fs.readFileSync(result.sessionInputGuidePath, 'utf8');
    expect(inputGuide).toContain('session-input.json 填写指南');
    expect(inputGuide).toContain('审批/审批人');
    expect(inputGuide).toContain('执行前/执行前 Ads UI live bid');
    expect(inputGuide).toContain('回读/刷新回读截图文件');
    expect(inputGuide).toContain('D6 campaign');

    const fillScript = fs.readFileSync(result.fillScriptPath, 'utf8');
    expect(fillScript).toContain('pnpm run fill:ad-readback-session -- --session');
    expect(fillScript).toContain(outDir);
  });

  it('does not copy raw spreadsheet reports into the session folder', () => {
    const dir = tempDir();
    const candidatePath = writeCandidate(dir);
    const outDir = path.join(dir, 'session');

    prepareAdReadbackSession({ sourcePath: candidatePath, outDir });

    const sessionFiles = fs.readdirSync(outDir, { recursive: true }).map(String);
    expect(sessionFiles.some((file) => file.endsWith('.xlsx') || file.endsWith('.xls') || file.endsWith('.csv'))).toBe(false);
  });

  it('refuses candidates that already claim PASS', () => {
    const dir = tempDir();
    const candidatePath = writeCandidate(dir, { status: 'PASS' });

    expect(() => prepareAdReadbackSession({ sourcePath: candidatePath, outDir: path.join(dir, 'session') }))
      .toThrow('only prepares NEEDS_WORK candidates');
  });
});

describe('verifyAdReadbackSession', () => {
  it('marks a freshly prepared session packet as structurally ready but not capture-complete', () => {
    const dir = tempDir();
    const candidatePath = writeCandidate(dir);
    const outDir = path.join(dir, 'session');
    prepareAdReadbackSession({ sourcePath: candidatePath, outDir });

    const result = verifyAdReadbackSession(outDir);

    expect(result.ready).toBe(true);
    expect(result.captureReady).toBe(false);
    expect(result.issues).toEqual([]);
    expect(result.unresolvedFields).toEqual(expect.arrayContaining([
      'approverName',
      'beforeValue',
      'afterValue',
      'readbackEvidencePath',
    ]));
    expect(result.captureMissingFields).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'approverName', label: '审批人', group: '审批' }),
      expect.objectContaining({ field: 'beforeValue', label: '执行前 Ads UI live bid', group: '执行前' }),
      expect.objectContaining({ field: 'afterValue', label: '执行后 Ads UI live bid', group: '执行后' }),
      expect.objectContaining({ field: 'readbackEvidencePath', label: '刷新回读截图文件', group: '回读' }),
    ]));
    expect(result.captureIssues.join('\n')).toContain('session-input.json 仍有未填写项');
    expect(result.captureIssues.join('\n')).toContain('审批/审批人');
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'source candidate is NEEDS_WORK', passed: true }),
      expect.objectContaining({ label: 'Ads UI locator guide exists', passed: true }),
      expect.objectContaining({ label: 'session input guide exists', passed: true }),
      expect.objectContaining({ label: 'raw report files are not copied into session', passed: true }),
      expect.objectContaining({ label: 'fill command references session folder', passed: true }),
    ]));
  });

  it('reports unsafe session packets without claiming readiness', () => {
    const dir = tempDir();
    const candidatePath = writeCandidate(dir);
    const outDir = path.join(dir, 'session');
    prepareAdReadbackSession({ sourcePath: candidatePath, outDir });
    fs.rmSync(path.join(outDir, 'screenshots', 'readback'), { recursive: true, force: true });
    fs.writeFileSync(path.join(outDir, 'copied-report.xlsx'), 'must not be copied');

    const result = verifyAdReadbackSession(outDir);

    expect(result.ready).toBe(false);
    expect(result.issues.join('\n')).toContain('readback screenshot folder exists');
    expect(result.issues.join('\n')).toContain('raw report files are not copied into session');
  });

  it('marks capture as ready only after session-input has live evidence values', () => {
    const dir = tempDir();
    const candidatePath = writeCandidate(dir);
    const outDir = path.join(dir, 'session');
    const session = prepareAdReadbackSession({ sourcePath: candidatePath, outDir });
    const approvalPath = path.join(session.approvalsDir, 'approval.png');
    const beforePath = path.join(session.beforeScreenshotsDir, 'before.png');
    const afterPath = path.join(session.afterScreenshotsDir, 'after.png');
    const readbackPath = path.join(session.readbackScreenshotsDir, 'readback.png');
    fs.writeFileSync(session.sessionInputPath, `${JSON.stringify({
      approverName: 'Ops Lead',
      approvalArtifactPath: approvalPath,
      approvalConfirmedAt: '2026-06-18T10:00:00.000Z',
      beforeValue: '1.20',
      beforeCapturedAt: '2026-06-18T10:01:00.000Z',
      beforeScreenshotPath: beforePath,
      liveBidSourceNote: 'Read from Ads UI editable target row before manual change.',
      afterValue: '1.08',
      afterCapturedAt: '2026-06-18T10:03:00.000Z',
      afterScreenshotPath: afterPath,
      executedAt: '2026-06-18T10:02:00.000Z',
      executedBy: 'Operator A',
      executionId: 'manual-action-001',
      readbackReadAt: '2026-06-18T10:05:00.000Z',
      readbackEvidencePath: readbackPath,
      readbackActualValue: '1.08',
      riskRationale: 'Lowering one target bid is bounded and reversible.',
    }, null, 2)}\n`, 'utf8');

    const result = verifyAdReadbackSession(outDir);

    expect(result.ready).toBe(true);
    expect(result.captureReady).toBe(true);
    expect(result.unresolvedFields).toEqual([]);
    expect(result.captureMissingFields).toEqual([]);
    expect(result.captureIssues).toEqual([]);
  });
});

describe('fillAdReadbackSession', () => {
  it('writes PASS-intended readback JSON and Markdown from a fully captured session input', () => {
    const dir = tempDir();
    const candidatePath = writeCandidate(dir);
    const outDir = path.join(dir, 'session');
    const session = prepareAdReadbackSession({ sourcePath: candidatePath, outDir });
    const approvalPath = path.join(session.approvalsDir, 'approval.png');
    const beforePath = path.join(session.beforeScreenshotsDir, 'before.png');
    const afterPath = path.join(session.afterScreenshotsDir, 'after.png');
    const readbackPath = path.join(session.readbackScreenshotsDir, 'readback.png');
    for (const filePath of [approvalPath, beforePath, afterPath, readbackPath]) {
      fs.writeFileSync(filePath, 'image placeholder');
    }
    fs.writeFileSync(session.sessionInputPath, `${JSON.stringify({
      approverName: 'Ops Lead',
      approvalArtifactPath: approvalPath,
      approvalConfirmedAt: '2026-06-18T10:00:00.000Z',
      beforeValue: '1.20',
      beforeCapturedAt: '2026-06-18T10:01:00.000Z',
      beforeScreenshotPath: beforePath,
      liveBidSourceNote: 'Read from Ads UI editable target row before manual change.',
      afterValue: '1.08',
      afterCapturedAt: '2026-06-18T10:03:00.000Z',
      afterScreenshotPath: afterPath,
      executedAt: '2026-06-18T10:02:00.000Z',
      executedBy: 'Operator A',
      executionId: 'manual-action-001',
      readbackReadAt: '2026-06-18T10:05:00.000Z',
      readbackEvidencePath: readbackPath,
      readbackActualValue: '1.08',
      riskRationale: 'Lowering one target bid is bounded and reversible.',
    }, null, 2)}\n`, 'utf8');

    const result = fillAdReadbackSession(outDir);

    expect(result.status).toBe('PASS');
    expect(result.readyForVerifier).toBe(true);
    expect(fs.existsSync(result.jsonPath)).toBe(true);
    expect(fs.existsSync(result.markdownPath)).toBe(true);
    const evidence = JSON.parse(fs.readFileSync(result.jsonPath, 'utf8'));
    expect(evidence.schemaVersion).toBe(2);
    expect(evidence.authority).toMatchObject({
      recommendationId: 4,
      recommendationRevision: 3,
      recommendationStatusAtExport: 'approved',
      batchId: 'batch_1',
    });
    expect(evidence.execution.channel).toBe('manual_ads_ui');
    expect(evidence.execution.appExecutorUsed).toBe(false);
    expect(evidence.readback.actualValue).toBe('1.08');
    expect(evidence.source.sourceRow).toBe(12);
    expect(evidence.source).toMatchObject({
      recommendationId: '4',
      recommendationRevision: 3,
      batchId: 'batch_1',
    });
  });

  it('does not produce ready evidence when session-input still has placeholders', () => {
    const dir = tempDir();
    const candidatePath = writeCandidate(dir);
    const outDir = path.join(dir, 'session');
    prepareAdReadbackSession({ sourcePath: candidatePath, outDir });

    const result = fillAdReadbackSession(outDir);

    expect(result.status).toBe('NEEDS_WORK');
    expect(result.readyForVerifier).toBe(false);
    expect(result.issues.join('\n')).toContain('session-input.json has unresolved fields');
  });
});

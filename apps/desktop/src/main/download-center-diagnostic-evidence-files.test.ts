import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  copyDiagnosticEvidenceFileToBundle,
  copyDownloadCenterDiagnosticEvidenceFilesToBundle,
  copyReportFailureEvidenceFilesToBundle,
  evaluateDownloadCenterDiagnosticEvidenceFiles,
} from './download-center-diagnostic-evidence-files';

let rootDir = '';
let screenshotsDir = '';
let domSnapshotsDir = '';
let tracesDir = '';
let outsideDir = '';
const supportsFileSymlink = canCreateFileSymlink();

beforeEach(() => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-evidence-'));
  screenshotsDir = path.join(rootDir, 'screenshots');
  domSnapshotsDir = path.join(rootDir, 'dom-snapshots');
  tracesDir = path.join(rootDir, 'traces');
  outsideDir = path.join(rootDir, 'outside');
  fs.mkdirSync(screenshotsDir, { recursive: true });
  fs.mkdirSync(domSnapshotsDir, { recursive: true });
  fs.mkdirSync(tracesDir, { recursive: true });
  fs.mkdirSync(outsideDir, { recursive: true });
});

afterEach(() => {
  if (rootDir) fs.rmSync(rootDir, { recursive: true, force: true });
});

function directories() {
  return { screenshotsDir, domSnapshotsDir };
}

function canCreateFileSymlink(): boolean {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-evidence-symlink-check-'));
  try {
    const target = path.join(dir, 'target.png');
    const link = path.join(dir, 'link.png');
    fs.writeFileSync(target, 'png');
    fs.symlinkSync(target, link, 'file');
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('evaluateDownloadCenterDiagnosticEvidenceFiles', () => {
  it('passes when screenshot and DOM snapshot evidence files exist inside app evidence directories', () => {
    const screenshotPath = path.join(screenshotsDir, 'diagnostic.png');
    const domSnapshotPath = path.join(domSnapshotsDir, 'diagnostic.html');
    fs.writeFileSync(screenshotPath, 'png');
    fs.writeFileSync(domSnapshotPath, '<html></html>');

    expect(evaluateDownloadCenterDiagnosticEvidenceFiles({
      screenshotPath,
      domSnapshotPath,
    }, directories())).toEqual({
      ready: true,
      missing: [],
      reason: undefined,
    });
  });

  it('blocks when evidence paths are absent or files are missing', () => {
    const result = evaluateDownloadCenterDiagnosticEvidenceFiles({
      screenshotPath: '',
      domSnapshotPath: path.join(domSnapshotsDir, 'missing.html'),
    }, directories());

    expect(result.ready).toBe(false);
    expect(result.missing).toEqual([
      'diagnosticScreenshotEvidence',
      'diagnosticDomSnapshotEvidence:missingFile',
    ]);
  });

  it('blocks evidence files outside the app-owned evidence directories', () => {
    const screenshotPath = path.join(outsideDir, 'diagnostic.png');
    const domSnapshotPath = path.join(domSnapshotsDir, 'diagnostic.html');
    fs.writeFileSync(screenshotPath, 'png');
    fs.writeFileSync(domSnapshotPath, '<html></html>');

    const result = evaluateDownloadCenterDiagnosticEvidenceFiles({
      screenshotPath,
      domSnapshotPath,
    }, directories());

    expect(result.ready).toBe(false);
    expect(result.missing).toEqual(['diagnosticScreenshotEvidence:outsideAppEvidenceDir']);
  });

  it('blocks unexpected evidence file extensions', () => {
    const screenshotPath = path.join(screenshotsDir, 'diagnostic.txt');
    const domSnapshotPath = path.join(domSnapshotsDir, 'diagnostic.json');
    fs.writeFileSync(screenshotPath, 'not an image');
    fs.writeFileSync(domSnapshotPath, '{}');

    const result = evaluateDownloadCenterDiagnosticEvidenceFiles({
      screenshotPath,
      domSnapshotPath,
    }, directories());

    expect(result.ready).toBe(false);
    expect(result.missing).toEqual([
      'diagnosticScreenshotEvidence:extension',
      'diagnosticDomSnapshotEvidence:extension',
    ]);
  });
});

describe('copyDiagnosticEvidenceFileToBundle', () => {
  it('copies allowed evidence files from app-owned directories into an export bundle', () => {
    const screenshotPath = path.join(screenshotsDir, 'diagnostic.png');
    const bundleDir = path.join(rootDir, 'bundle');
    fs.mkdirSync(bundleDir);
    fs.writeFileSync(screenshotPath, 'png');

    const copiedPath = copyDiagnosticEvidenceFileToBundle(
      screenshotPath,
      bundleDir,
      'diagnostic-screenshot',
      screenshotsDir,
      new Set(['.png']),
    );

    expect(copiedPath).toBe(path.join(bundleDir, 'diagnostic-screenshot.png'));
    expect(fs.readFileSync(copiedPath!, 'utf8')).toBe('png');
  });

  it('does not copy missing, disallowed, or outside evidence files', () => {
    const bundleDir = path.join(rootDir, 'bundle');
    const outsidePath = path.join(outsideDir, 'diagnostic.png');
    const badExtensionPath = path.join(screenshotsDir, 'diagnostic.txt');
    fs.mkdirSync(bundleDir);
    fs.writeFileSync(outsidePath, 'png');
    fs.writeFileSync(badExtensionPath, 'txt');

    expect(copyDiagnosticEvidenceFileToBundle(
      path.join(screenshotsDir, 'missing.png'),
      bundleDir,
      'missing',
      screenshotsDir,
      new Set(['.png']),
    )).toBeUndefined();
    expect(copyDiagnosticEvidenceFileToBundle(
      outsidePath,
      bundleDir,
      'outside',
      screenshotsDir,
      new Set(['.png']),
    )).toBeUndefined();
    expect(copyDiagnosticEvidenceFileToBundle(
      badExtensionPath,
      bundleDir,
      'bad-extension',
      screenshotsDir,
      new Set(['.png']),
    )).toBeUndefined();
    expect(fs.readdirSync(bundleDir)).toEqual([]);
  });

  it.skipIf(!supportsFileSymlink)('does not copy a symlink that resolves outside the app evidence directory', () => {
    const bundleDir = path.join(rootDir, 'bundle');
    const outsidePath = path.join(outsideDir, 'diagnostic.png');
    const symlinkPath = path.join(screenshotsDir, 'diagnostic.png');
    fs.mkdirSync(bundleDir);
    fs.writeFileSync(outsidePath, 'png');
    fs.symlinkSync(outsidePath, symlinkPath, 'file');

    expect(copyDiagnosticEvidenceFileToBundle(
      symlinkPath,
      bundleDir,
      'symlink',
      screenshotsDir,
      new Set(['.png']),
    )).toBeUndefined();
    expect(fs.readdirSync(bundleDir)).toEqual([]);
  });
});

describe('copyDownloadCenterDiagnosticEvidenceFilesToBundle', () => {
  it('creates a diagnostic evidence index and copies safe screenshot and DOM files', () => {
    const screenshotPath = path.join(screenshotsDir, 'diagnostic.png');
    const domSnapshotPath = path.join(domSnapshotsDir, 'diagnostic.html');
    const bundleDir = path.join(rootDir, 'bundle');
    fs.mkdirSync(bundleDir);
    fs.writeFileSync(screenshotPath, 'png');
    fs.writeFileSync(domSnapshotPath, '<html></html>');

    const result = copyDownloadCenterDiagnosticEvidenceFilesToBundle({
      screenshotPath,
      domSnapshotPath,
    }, bundleDir, directories(), 'preflight-diagnostic');

    expect(result).toMatchObject({
      sourceScreenshotPath: screenshotPath,
      sourceDomSnapshotPath: domSnapshotPath,
      copiedScreenshotPath: path.join(bundleDir, 'preflight-diagnostic-screenshot.png'),
      copiedDomSnapshotPath: path.join(bundleDir, 'preflight-diagnostic-dom-snapshot.html'),
      readiness: {
        ready: true,
        missing: [],
        reason: undefined,
      },
    });
    expect(fs.existsSync(result.copiedScreenshotPath!)).toBe(true);
    expect(fs.existsSync(result.copiedDomSnapshotPath!)).toBe(true);
  });

  it('keeps unsafe diagnostic evidence uncopied while recording readiness blockers', () => {
    const outsideScreenshotPath = path.join(outsideDir, 'diagnostic.png');
    const missingDomSnapshotPath = path.join(domSnapshotsDir, 'missing.html');
    const bundleDir = path.join(rootDir, 'bundle');
    fs.mkdirSync(bundleDir);
    fs.writeFileSync(outsideScreenshotPath, 'png');

    const result = copyDownloadCenterDiagnosticEvidenceFilesToBundle({
      screenshotPath: outsideScreenshotPath,
      domSnapshotPath: missingDomSnapshotPath,
    }, bundleDir, directories());

    expect(result.copiedScreenshotPath).toBeUndefined();
    expect(result.copiedDomSnapshotPath).toBeUndefined();
    expect(result.readiness.ready).toBe(false);
    expect(result.readiness.missing).toEqual([
      'diagnosticScreenshotEvidence:outsideAppEvidenceDir',
      'diagnosticDomSnapshotEvidence:missingFile',
    ]);
    expect(fs.readdirSync(bundleDir)).toEqual([]);
  });
});

describe('copyReportFailureEvidenceFilesToBundle', () => {
  it('copies failed report screenshot, DOM, and trace evidence into a bundle index', () => {
    const bundleDir = path.join(rootDir, 'bundle');
    const screenshotPath = path.join(screenshotsDir, 'failure.png');
    const domSnapshotPath = path.join(domSnapshotsDir, 'failure.html');
    const tracePath = path.join(tracesDir, 'failure.zip');
    fs.mkdirSync(bundleDir);
    fs.writeFileSync(screenshotPath, 'png');
    fs.writeFileSync(domSnapshotPath, '<html></html>');
    fs.writeFileSync(tracePath, 'zip');

    const result = copyReportFailureEvidenceFilesToBundle([
      {
        id: 'file:1',
        batchId: 'batch_1',
        reportType: 'keyword',
        displayName: '关键词报告',
        status: 'failed',
        failureScreenshotPath: screenshotPath,
        failureDomSnapshotPath: domSnapshotPath,
        failureTracePath: tracePath,
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      },
    ], bundleDir, { screenshotsDir, domSnapshotsDir, tracesDir });

    expect(result).toHaveLength(1);
    expect(result[0].missing).toEqual([]);
    expect(result[0].copiedScreenshotPath).toContain('report-failure-evidence');
    expect(result[0].copiedDomSnapshotPath).toContain('report-failure-evidence');
    expect(result[0].copiedTracePath).toContain('report-failure-evidence');
    expect(fs.existsSync(result[0].copiedScreenshotPath!)).toBe(true);
    expect(fs.existsSync(result[0].copiedDomSnapshotPath!)).toBe(true);
    expect(fs.existsSync(result[0].copiedTracePath!)).toBe(true);
  });

  it('accepts a trace unavailable reason when no trace file exists', () => {
    const bundleDir = path.join(rootDir, 'bundle');
    fs.mkdirSync(bundleDir);

    const result = copyReportFailureEvidenceFilesToBundle([
      {
        id: 'file_2',
        batchId: 'batch_1',
        reportType: 'campaign',
        displayName: '广告活动报告',
        status: 'failed',
        traceUnavailableReason: 'Playwright browser context is not available',
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      },
    ], bundleDir, { screenshotsDir, domSnapshotsDir, tracesDir });

    expect(result[0].missing).toEqual([
      'failureScreenshotEvidence',
      'failureDomSnapshotEvidence',
    ]);
    expect(result[0].traceUnavailableReason).toBe('Playwright browser context is not available');
  });

  it('records missing evidence when source paths cannot be safely copied', () => {
    const bundleDir = path.join(rootDir, 'bundle');
    const outsideScreenshotPath = path.join(outsideDir, 'failure.png');
    const badTracePath = path.join(tracesDir, 'failure.txt');
    fs.mkdirSync(bundleDir);
    fs.writeFileSync(outsideScreenshotPath, 'png');
    fs.writeFileSync(badTracePath, 'trace');

    const result = copyReportFailureEvidenceFilesToBundle([
      {
        id: 'file_3',
        batchId: 'batch_1',
        reportType: 'keyword',
        displayName: '关键词报告',
        status: 'failed',
        failureScreenshotPath: outsideScreenshotPath,
        failureDomSnapshotPath: path.join(domSnapshotsDir, 'missing.html'),
        failureTracePath: badTracePath,
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      },
    ], bundleDir, { screenshotsDir, domSnapshotsDir, tracesDir });

    expect(result[0].missing).toEqual([
      'failureScreenshotEvidence:copyUnavailable',
      'failureDomSnapshotEvidence:copyUnavailable',
      'failureTraceEvidence:copyUnavailable',
    ]);
    expect(fs.readdirSync(path.join(bundleDir, 'report-failure-evidence'))).toEqual([]);
  });
});

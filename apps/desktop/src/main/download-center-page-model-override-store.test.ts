import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DownloadCenterPageModel } from '@amazon-ai-ops/shared-types';
import {
  backupExistingDownloadCenterPageModelOverride,
  getDownloadCenterPageModelOverrideMetadataPath,
  saveDownloadCenterPageModelOverride,
} from './download-center-page-model-override-store';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-page-model-'));
  tempDirs.push(dir);
  return dir;
}

function model(description: string): DownloadCenterPageModel {
  return {
    name: 'lingxing-download-center',
    description,
    candidateUrls: ['https://erp.lingxing.com/download-center'],
    entryHints: ['下载中心'],
    reportNames: ['关键词报告'],
    verifySelectors: [{ name: 'table', selector: '.ant-table', required: false }],
    actionSelectors: {
      dateStartInput: '[data-testid="start"]',
      dateEndInput: '[data-testid="end"]',
      createReportButton: '[data-testid="create"]',
      readyReportSelector: 'tr[data-report="{reportName}"][data-date="{dateRange}"]',
      downloadButton: 'tr[data-report="{reportName}"][data-date="{dateRange}"] button.download',
    },
    requiresManualVerification: false,
  };
}

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('download center page-model override store', () => {
  it('writes override metadata without a backup on first save', () => {
    const overridePath = path.join(makeTempDir(), 'lingxing-download-center.override.json');
    const metadata = saveDownloadCenterPageModelOverride({
      model: model('first'),
      overridePath,
      appVersion: '1.5.0',
      readiness: { ready: true, missing: [] },
      nowMs: Date.parse('2026-06-01T00:00:00.000Z'),
    });

    expect(JSON.parse(fs.readFileSync(overridePath, 'utf8')).description).toBe('first');
    expect(metadata.backupPath).toBeUndefined();
    expect(JSON.parse(fs.readFileSync(getDownloadCenterPageModelOverrideMetadataPath(overridePath), 'utf8'))).toMatchObject({
      appVersion: '1.5.0',
      overridePath,
      requiresManualVerification: false,
      postSaveDiagnosticRequired: true,
      postSaveDiagnosticReason: expect.stringContaining('fresh read-only diagnostic'),
      readiness: { ready: true, missing: [] },
    });
  });

  it('does not require a post-save diagnostic when manual verification remains enabled', () => {
    const overridePath = path.join(makeTempDir(), 'lingxing-download-center.override.json');
    const manualModel = { ...model('manual'), requiresManualVerification: true };
    const metadata = saveDownloadCenterPageModelOverride({
      model: manualModel,
      overridePath,
      appVersion: '1.5.0',
      readiness: { ready: false, missing: [], reason: 'download center page model still requires manual verification' },
      nowMs: Date.parse('2026-06-01T00:00:00.000Z'),
    });

    expect(metadata).toMatchObject({
      requiresManualVerification: true,
      postSaveDiagnosticRequired: false,
    });
    expect(metadata.postSaveDiagnosticReason).toBeUndefined();
  });

  it('backs up the previous override before replacing it', () => {
    const overridePath = path.join(makeTempDir(), 'lingxing-download-center.override.json');
    saveDownloadCenterPageModelOverride({
      model: model('first'),
      overridePath,
      appVersion: '1.5.0',
      readiness: { ready: false, missing: ['diagnosticEvidence'] },
      nowMs: Date.parse('2026-06-01T00:00:00.000Z'),
    });
    const metadata = saveDownloadCenterPageModelOverride({
      model: model('second'),
      overridePath,
      appVersion: '1.5.0',
      readiness: { ready: true, missing: [] },
      nowMs: Date.parse('2026-06-01T00:01:00.000Z'),
    });

    expect(metadata.backupPath).toContain('lingxing-download-center.override.20260601000100.json');
    expect(JSON.parse(fs.readFileSync(metadata.backupPath!, 'utf8')).description).toBe('first');
    expect(JSON.parse(fs.readFileSync(overridePath, 'utf8')).description).toBe('second');
  });

  it('can back up an existing override before reset removes it', () => {
    const overridePath = path.join(makeTempDir(), 'lingxing-download-center.override.json');
    fs.writeFileSync(overridePath, JSON.stringify(model('to-reset')), 'utf8');

    const backupPath = backupExistingDownloadCenterPageModelOverride(overridePath, Date.parse('2026-06-01T00:02:00.000Z'));

    expect(backupPath).toContain('lingxing-download-center.override.20260601000200.json');
    expect(JSON.parse(fs.readFileSync(backupPath!, 'utf8')).description).toBe('to-reset');
  });
});

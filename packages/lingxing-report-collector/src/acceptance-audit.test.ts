import { describe, expect, it } from 'vitest';
import type { DownloadCenterDiagnosticResult, LingxingReportBatch, LingxingReportFile, LingxingReportType } from '@amazon-ai-ops/shared-types';
import { auditLingxingAcceptanceEvidence, lingxingAcceptanceAuditToMarkdown } from './acceptance-audit';

const reportTypes: LingxingReportType[] = [
  'campaign',
  'ad_group',
  'placement',
  'advertised_product',
  'auto_targeting',
  'keyword',
  'product_targeting',
  'user_search_term',
];

function batch(overrides: Partial<LingxingReportBatch> = {}): LingxingReportBatch {
  return {
    id: 'batch_1',
    dateStart: '2026-05-01',
    dateEnd: '2026-05-31',
    status: 'completed',
    appVersion: '1.5.0-test',
    downloadDir: 'C:/tmp/downloads',
    manifestPath: 'C:/tmp/downloads/manifest.json',
    createdAt: '2026-06-01T00:00:00.000Z',
    completedAt: '2026-06-01T00:01:00.000Z',
    ...overrides,
  };
}

function files(overrides: Partial<LingxingReportFile>[] = []): LingxingReportFile[] {
  return reportTypes.map((reportType, index) => ({
    id: `file_${reportType}`,
    batchId: 'batch_1',
    reportType,
    displayName: reportType,
    status: 'downloaded',
    filePath: `C:/tmp/downloads/${reportType}_2026-05-01_2026-05-31.xlsx`,
    fileSizeBytes: 256,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:01:00.000Z',
    ...overrides[index],
  }));
}

function diagnostic(overrides: Partial<DownloadCenterDiagnosticResult> = {}): DownloadCenterDiagnosticResult {
  return {
    id: 7,
    pageModel: 'lingxing-download-center',
    url: 'https://erp.lingxing.com/download-center',
    title: 'download center',
    ready: true,
    requiresManualVerification: false,
    matchedEntryHints: ['下载中心'],
    matchedReportNames: ['关键词报告'],
    selectorChecks: [],
    missingRequiredSelectors: [],
    dateStart: '2026-05-01',
    dateEnd: '2026-05-31',
    checkedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function diagnosticReadiness(overrides: { ready?: boolean; missing?: string[]; reason?: string; diagnosticId?: number; checkedAt?: string } = {}) {
  return {
    ready: true,
    missing: [],
    diagnosticId: 7,
    checkedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function manifest(batchValue = batch(), filesValue = files(), appVersion = batchValue.appVersion, generatedAt?: string) {
  return {
    appVersion,
    batch: batchValue,
    files: filesValue,
    generatedAt: generatedAt ?? batchValue.completedAt ?? batchValue.createdAt,
  };
}

describe('auditLingxingAcceptanceEvidence', () => {
  it('passes only when all reports, files, manifest, and diagnostic evidence are present', () => {
    const result = auditLingxingAcceptanceEvidence({
      batch: batch(),
      files: files(),
      diagnostic: diagnostic(),
      diagnosticEvidenceReadiness: diagnosticReadiness(),
      manifest: manifest(),
      fileExists: () => true,
      getFileSizeBytes: () => 256,
    });

    expect(result.status).toBe('passed');
    expect(result.downloadedCount).toBe(8);
    expect(result.failedCount).toBe(0);
    expect(result.filenameDateRangeAnalyses).toHaveLength(8);
    expect(result.filenameDateRangeAnalyses[0]).toMatchObject({
      reportType: 'campaign',
      basename: 'campaign_2026-05-01_2026-05-31.xlsx',
      analysis: {
        startToken: '20260501',
        endToken: '20260531',
        hasStartToken: true,
        hasEndToken: true,
      },
      summary: 'filename contains start=20260501 and end=20260531',
    });
    expect(result.checks.every((check) => check.status === 'passed')).toBe(true);
    expect(lingxingAcceptanceAuditToMarkdown(result)).toContain('Status: passed');
  });

  it('does not pass when diagnostic readiness is missing persisted diagnostic provenance', () => {
    const result = auditLingxingAcceptanceEvidence({
      batch: batch(),
      files: files(),
      diagnostic: diagnostic(),
      diagnosticEvidenceReadiness: { ready: true, missing: [] },
      manifest: manifest(),
      fileExists: () => true,
      getFileSizeBytes: () => 256,
    });

    expect(result.status).toBe('incomplete');
    expect(result.checks.find((check) => check.name === 'download_center_diagnostic')).toMatchObject({
      status: 'incomplete',
      detail: 'diagnostic evidence readiness is missing persisted diagnostic provenance',
    });
  });

  it('does not pass when file existence evidence callback is missing', () => {
    const result = auditLingxingAcceptanceEvidence({
      batch: batch(),
      files: files(),
      diagnostic: diagnostic(),
      diagnosticEvidenceReadiness: diagnosticReadiness(),
      manifest: manifest(),
      getFileSizeBytes: () => 256,
    });

    expect(result.status).toBe('incomplete');
    expect(result.checks.find((check) => check.name === 'downloaded_files_exist')).toMatchObject({
      status: 'incomplete',
      detail: 'file existence checker is missing',
    });
  });

  it('does not pass when actual file size evidence callback is missing', () => {
    const result = auditLingxingAcceptanceEvidence({
      batch: batch(),
      files: files(),
      diagnostic: diagnostic(),
      diagnosticEvidenceReadiness: diagnosticReadiness(),
      manifest: manifest(),
      fileExists: () => true,
    });

    expect(result.status).toBe('incomplete');
    expect(result.checks.find((check) => check.name === 'downloaded_file_sizes_match_record')).toMatchObject({
      status: 'incomplete',
      detail: 'file size checker is missing',
    });
  });

  it('does not pass when one expected report type is missing even if there are files', () => {
    const result = auditLingxingAcceptanceEvidence({
      batch: batch(),
      files: files().filter((file) => file.reportType !== 'keyword'),
      diagnostic: diagnostic(),
      diagnosticEvidenceReadiness: diagnosticReadiness(),
      manifest: manifest(batch(), files().filter((file) => file.reportType !== 'keyword')),
      fileExists: () => true,
    });

    expect(result.status).toBe('incomplete');
    expect(result.checks.find((check) => check.name === 'all_8_report_types')).toMatchObject({
      status: 'incomplete',
    });
  });

  it('fails when any report file failed or downloaded paths are missing', () => {
    const brokenFiles = files([{ status: 'failed', errorMessage: 'download failed', filePath: undefined }]);
    const result = auditLingxingAcceptanceEvidence({
      batch: batch({ status: 'completed_with_errors' }),
      files: brokenFiles,
      diagnostic: diagnostic(),
      diagnosticEvidenceReadiness: diagnosticReadiness(),
      manifest: manifest(batch({ status: 'completed_with_errors' }), brokenFiles),
      fileExists: (filePath) => !filePath.includes('ad_group'),
    });

    expect(result.status).toBe('failed');
    expect(result.checks.find((check) => check.name === 'batch_completed')).toMatchObject({ status: 'failed' });
    expect(result.checks.find((check) => check.name === 'all_files_downloaded')).toMatchObject({ status: 'failed' });
    expect(result.filenameDateRangeAnalyses[0]).toMatchObject({
      reportType: 'campaign',
      summary: 'file path is missing',
    });
  });

  it('fails when a downloaded file size no longer matches the recorded size', () => {
    const result = auditLingxingAcceptanceEvidence({
      batch: batch(),
      files: files(),
      diagnostic: diagnostic(),
      diagnosticEvidenceReadiness: diagnosticReadiness(),
      manifest: manifest(),
      fileExists: () => true,
      getFileSizeBytes: (filePath) => filePath.includes('campaign') ? 128 : 256,
    });

    expect(result.status).toBe('failed');
    expect(result.checks.find((check) => check.name === 'downloaded_file_sizes_match_record')).toMatchObject({
      status: 'failed',
      detail: expect.stringContaining('campaign size mismatch recorded=256 actual=128'),
    });
  });

  it('stays incomplete when live diagnostic evidence is absent or for another date range', () => {
    expect(auditLingxingAcceptanceEvidence({
      batch: batch(),
      files: files(),
      manifest: manifest(),
      fileExists: () => true,
    }).status).toBe('incomplete');

    const result = auditLingxingAcceptanceEvidence({
      batch: batch(),
      files: files(),
      diagnostic: diagnostic({ dateStart: '2026-04-01', dateEnd: '2026-04-30' }),
      diagnosticEvidenceReadiness: diagnosticReadiness(),
      manifest: manifest(),
      fileExists: () => true,
    });

    expect(result.status).toBe('incomplete');
    expect(result.checks.find((check) => check.name === 'download_center_diagnostic')).toMatchObject({
      status: 'incomplete',
    });
  });

  it('does not pass when diagnostic gate evidence is missing even if diagnostic is ready', () => {
    const result = auditLingxingAcceptanceEvidence({
      batch: batch(),
      files: files(),
      diagnostic: diagnostic(),
      diagnosticEvidenceReadiness: { ready: false, missing: ['diagnosticFreshness'], reason: 'stale' },
      manifest: manifest(),
      fileExists: () => true,
    });

    expect(result.status).toBe('incomplete');
    expect(result.checks.find((check) => check.name === 'download_center_diagnostic')).toMatchObject({
      status: 'incomplete',
    });
  });

  it('stays incomplete when diagnostic evidence is for another store or marketplace even if readiness provenance matches', () => {
    const batchValue = batch({ storeName: 'FT-US-US', marketplaceCode: 'US' });
    const result = auditLingxingAcceptanceEvidence({
      batch: batchValue,
      files: files(),
      diagnostic: diagnostic({ storeName: 'FT-CA-CA', marketplaceCode: 'CA' }),
      diagnosticEvidenceReadiness: diagnosticReadiness(),
      manifest: manifest(batchValue),
      fileExists: () => true,
      getFileSizeBytes: () => 256,
    });

    expect(result.status).toBe('incomplete');
    expect(result.checks.find((check) => check.name === 'download_center_diagnostic')).toMatchObject({
      status: 'incomplete',
      detail: expect.stringContaining('diagnostic store/site scope FT-CA-CA/CA does not match batch FT-US-US/US'),
    });
  });

  it('does not pass when diagnostic screenshot or DOM evidence files are missing', () => {
    const result = auditLingxingAcceptanceEvidence({
      batch: batch(),
      files: files(),
      diagnostic: diagnostic(),
      diagnosticEvidenceReadiness: {
        ready: false,
        missing: ['diagnosticScreenshotEvidence', 'diagnosticDomSnapshotEvidence:missingFile'],
        reason: 'matching diagnostic evidence files are missing or outside the app evidence directories',
      },
      manifest: manifest(),
      fileExists: () => true,
    });

    expect(result.status).toBe('incomplete');
    expect(result.checks.find((check) => check.name === 'download_center_diagnostic')).toMatchObject({
      status: 'incomplete',
      detail: 'matching diagnostic evidence files are missing or outside the app evidence directories',
    });
  });

  it('checks date tokens in the filename rather than the parent directory', () => {
    const batchValue = batch({ downloadDir: 'C:/tmp/downloads/2026-05-01_2026-05-31' });
    const filesValue = files([{ filePath: 'C:/tmp/downloads/2026-05-01_2026-05-31/campaign.xlsx' }]);
    const result = auditLingxingAcceptanceEvidence({
      batch: batchValue,
      files: filesValue,
      diagnostic: diagnostic(),
      diagnosticEvidenceReadiness: diagnosticReadiness(),
      manifest: manifest(batchValue, filesValue),
      fileExists: () => true,
    });

    expect(result.status).toBe('failed');
    expect(result.checks.find((check) => check.name === 'downloaded_filenames_match_date_range')).toMatchObject({
      status: 'failed',
    });
    expect(result.checks.find((check) => check.name === 'downloaded_filenames_match_date_range')?.detail).toContain('campaign: missing dateStart,dateEnd');
    expect(result.filenameDateRangeAnalyses[0]).toMatchObject({
      reportType: 'campaign',
      analysis: {
        missing: ['dateStart', 'dateEnd'],
      },
    });
  });

  it('accepts compact date tokens in downloaded filenames', () => {
    const filesValue = files().map((file) => ({
      ...file,
      filePath: `C:/tmp/downloads/${file.reportType}_20260501_20260531.xlsx`,
    }));
    const result = auditLingxingAcceptanceEvidence({
      batch: batch(),
      files: filesValue,
      diagnostic: diagnostic(),
      diagnosticEvidenceReadiness: diagnosticReadiness(),
      manifest: manifest(batch(), filesValue),
      fileExists: () => true,
      getFileSizeBytes: () => 256,
    });

    expect(result.status).toBe('passed');
    expect(result.checks.find((check) => check.name === 'downloaded_filenames_match_date_range')).toMatchObject({
      status: 'passed',
    });
  });

  it('fails when a downloaded filename does not match the expected report keyword', () => {
    const filesValue = files([{
      filePath: 'C:/tmp/downloads/keyword_2026-05-01_2026-05-31.xlsx',
    }]);
    const result = auditLingxingAcceptanceEvidence({
      batch: batch(),
      files: filesValue,
      diagnostic: diagnostic(),
      diagnosticEvidenceReadiness: diagnosticReadiness(),
      manifest: manifest(batch(), filesValue),
      fileExists: () => true,
    });

    expect(result.status).toBe('failed');
    expect(result.checks.find((check) => check.name === 'downloaded_filenames_match_report_type')).toMatchObject({
      status: 'failed',
      detail: expect.stringContaining('campaign filename missing expected keyword campaign'),
    });
  });

  it('fails when manifest content does not match the batch result', () => {
    const manifestValue = manifest(batch({ id: 'other_batch' }), files());
    const result = auditLingxingAcceptanceEvidence({
      batch: batch(),
      files: files(),
      diagnostic: diagnostic(),
      diagnosticEvidenceReadiness: diagnosticReadiness(),
      manifest: manifestValue,
      fileExists: () => true,
    });

    expect(result.status).toBe('failed');
    expect(result.checks.find((check) => check.name === 'manifest_consistent')).toMatchObject({
      status: 'failed',
    });
  });

  it('fails when manifest app version does not match the batch app version', () => {
    const batchValue = batch({ appVersion: '1.5.0-test' });
    const manifestValue = manifest(batchValue, files(), '1.4.0-old');
    const result = auditLingxingAcceptanceEvidence({
      batch: batchValue,
      files: files(),
      diagnostic: diagnostic(),
      diagnosticEvidenceReadiness: diagnosticReadiness(),
      manifest: manifestValue,
      fileExists: () => true,
    });

    expect(result.status).toBe('failed');
    expect(result.checks.find((check) => check.name === 'manifest_consistent')?.detail).toContain('manifest appVersion does not match');
  });

  it('fails when manifest batch app version does not match the persisted batch version', () => {
    const batchValue = batch({ appVersion: '1.5.0-test' });
    const manifestValue = manifest({ ...batchValue, appVersion: '1.4.0-old' }, files(), batchValue.appVersion);
    const result = auditLingxingAcceptanceEvidence({
      batch: batchValue,
      files: files(),
      diagnostic: diagnostic(),
      diagnosticEvidenceReadiness: diagnosticReadiness(),
      manifest: manifestValue,
      fileExists: () => true,
    });

    expect(result.status).toBe('failed');
    expect(result.checks.find((check) => check.name === 'manifest_consistent')?.detail).toContain('manifest batch appVersion does not match');
  });

  it('fails when manifest batch timestamps do not match the persisted batch timestamps', () => {
    const batchValue = batch();
    const manifestValue = manifest({
      ...batchValue,
      createdAt: '2026-06-01T00:00:30.000Z',
      completedAt: '2026-06-01T00:01:30.000Z',
    }, files(), batchValue.appVersion, '2026-06-01T00:02:00.000Z');
    const result = auditLingxingAcceptanceEvidence({
      batch: batchValue,
      files: files(),
      diagnostic: diagnostic(),
      diagnosticEvidenceReadiness: diagnosticReadiness(),
      manifest: manifestValue,
      fileExists: () => true,
    });

    expect(result.status).toBe('failed');
    expect(result.checks.find((check) => check.name === 'manifest_consistent')?.detail).toContain('manifest batch createdAt does not match');
    expect(result.checks.find((check) => check.name === 'manifest_consistent')?.detail).toContain('manifest batch completedAt does not match');
  });

  it('fails when manifest batch paths do not match the persisted batch paths', () => {
    const batchValue = batch();
    const manifestValue = manifest({
      ...batchValue,
      downloadDir: 'C:/tmp/other-downloads',
      manifestPath: 'C:/tmp/other-downloads/manifest.json',
    }, files(), batchValue.appVersion, '2026-06-01T00:02:00.000Z');
    const result = auditLingxingAcceptanceEvidence({
      batch: batchValue,
      files: files(),
      diagnostic: diagnostic(),
      diagnosticEvidenceReadiness: diagnosticReadiness(),
      manifest: manifestValue,
      fileExists: () => true,
    });

    expect(result.status).toBe('failed');
    expect(result.checks.find((check) => check.name === 'manifest_consistent')?.detail).toContain('manifest batch downloadDir does not match');
    expect(result.checks.find((check) => check.name === 'manifest_consistent')?.detail).toContain('manifest batch manifestPath does not match');
  });

  it('does not pass when version trace is missing from both batch and manifest', () => {
    const batchValue = batch({ appVersion: undefined });
    const manifestValue = manifest(batchValue, files(), undefined);
    const result = auditLingxingAcceptanceEvidence({
      batch: batchValue,
      files: files(),
      diagnostic: diagnostic(),
      diagnosticEvidenceReadiness: diagnosticReadiness(),
      manifest: manifestValue,
      fileExists: () => true,
    });

    expect(result.status).toBe('incomplete');
    expect(result.checks.find((check) => check.name === 'manifest_consistent')?.detail).toContain('manifest appVersion is missing');
  });

  it('does not pass when manifest generatedAt is missing', () => {
    const manifestValue = manifest(batch(), files(), batch().appVersion, '');
    const result = auditLingxingAcceptanceEvidence({
      batch: batch(),
      files: files(),
      diagnostic: diagnostic(),
      diagnosticEvidenceReadiness: diagnosticReadiness(),
      manifest: manifestValue,
      fileExists: () => true,
    });

    expect(result.status).toBe('incomplete');
    expect(result.checks.find((check) => check.name === 'manifest_consistent')?.detail).toContain('manifest generatedAt is missing');
  });

  it('fails when manifest generatedAt is not a parseable timestamp', () => {
    const result = auditLingxingAcceptanceEvidence({
      batch: batch(),
      files: files(),
      diagnostic: diagnostic(),
      diagnosticEvidenceReadiness: diagnosticReadiness(),
      manifest: manifest(batch(), files(), batch().appVersion, 'not-a-date'),
      fileExists: () => true,
    });

    expect(result.status).toBe('failed');
    expect(result.checks.find((check) => check.name === 'manifest_consistent')?.detail).toContain('manifest generatedAt is not a valid timestamp');
  });

  it('fails when manifest generatedAt predates the batch creation time', () => {
    const result = auditLingxingAcceptanceEvidence({
      batch: batch(),
      files: files(),
      diagnostic: diagnostic(),
      diagnosticEvidenceReadiness: diagnosticReadiness(),
      manifest: manifest(batch(), files(), batch().appVersion, '2026-05-31T23:59:59.999Z'),
      fileExists: () => true,
    });

    expect(result.status).toBe('failed');
    expect(result.checks.find((check) => check.name === 'manifest_consistent')?.detail).toContain('manifest generatedAt predates batch createdAt');
  });

  it('fails when manifest generatedAt predates the batch completion time', () => {
    const result = auditLingxingAcceptanceEvidence({
      batch: batch(),
      files: files(),
      diagnostic: diagnostic(),
      diagnosticEvidenceReadiness: diagnosticReadiness(),
      manifest: manifest(batch(), files(), batch().appVersion, '2026-06-01T00:00:30.000Z'),
      fileExists: () => true,
    });

    expect(result.status).toBe('failed');
    expect(result.checks.find((check) => check.name === 'manifest_consistent')?.detail).toContain('manifest generatedAt predates batch completedAt');
  });

  it('fails when manifest generatedAt is later than the audit time', () => {
    const result = auditLingxingAcceptanceEvidence({
      batch: batch(),
      files: files(),
      diagnostic: diagnostic(),
      diagnosticEvidenceReadiness: diagnosticReadiness(),
      manifest: manifest(batch(), files(), batch().appVersion, '2026-06-01T00:03:00.000Z'),
      fileExists: () => true,
      nowMs: Date.parse('2026-06-01T00:02:00.000Z'),
    });

    expect(result.status).toBe('failed');
    expect(result.checks.find((check) => check.name === 'manifest_consistent')?.detail).toContain('manifest generatedAt is after audit time');
  });

  it('fails when manifest file identity does not match the batch result', () => {
    const manifestFiles = files();
    manifestFiles[0] = { ...manifestFiles[0], id: 'other_file', batchId: 'other_batch' };
    const result = auditLingxingAcceptanceEvidence({
      batch: batch(),
      files: files(),
      diagnostic: diagnostic(),
      diagnosticEvidenceReadiness: diagnosticReadiness(),
      manifest: manifest(batch(), manifestFiles),
      fileExists: () => true,
    });

    expect(result.status).toBe('failed');
    expect(result.checks.find((check) => check.name === 'manifest_consistent')?.detail).toContain('manifest id mismatch');
  });

  it('fails when manifest file metadata does not match the persisted file row', () => {
    const manifestFiles = files();
    manifestFiles[0] = {
      ...manifestFiles[0],
      displayName: 'wrong display name',
      createdAt: '2026-06-01T00:00:30.000Z',
      updatedAt: '2026-06-01T00:01:30.000Z',
    };
    const result = auditLingxingAcceptanceEvidence({
      batch: batch(),
      files: files(),
      diagnostic: diagnostic(),
      diagnosticEvidenceReadiness: diagnosticReadiness(),
      manifest: manifest(batch(), manifestFiles),
      fileExists: () => true,
    });

    expect(result.status).toBe('failed');
    expect(result.checks.find((check) => check.name === 'manifest_consistent')?.detail).toContain('manifest displayName mismatch for campaign');
    expect(result.checks.find((check) => check.name === 'manifest_consistent')?.detail).toContain('manifest createdAt mismatch for campaign');
    expect(result.checks.find((check) => check.name === 'manifest_consistent')?.detail).toContain('manifest updatedAt mismatch for campaign');
  });

  it('fails when manifest failure evidence metadata does not match the persisted file row', () => {
    const batchValue = batch({ status: 'completed_with_errors' });
    const filesValue = files([{
      status: 'failed',
      maxAutoRetries: 2,
      autoRetryCount: 2,
      filePath: undefined,
      fileSizeBytes: undefined,
      errorMessage: 'final download failed',
      attemptErrors: ['first failure', 'second failure', 'final download failed'],
      failureScreenshotPath: 'C:/tmp/evidence/campaign.png',
      failureDomSnapshotPath: 'C:/tmp/evidence/campaign.html',
      failureTracePath: 'C:/tmp/evidence/campaign.zip',
      traceUnavailableReason: undefined,
    }]);
    const manifestFiles = filesValue.map((file, index) => index === 0 ? {
      ...file,
      maxAutoRetries: 1,
      autoRetryCount: 1,
      errorMessage: 'different failure',
      attemptErrors: ['different failure'],
      failureScreenshotPath: 'C:/tmp/evidence/other.png',
      failureDomSnapshotPath: 'C:/tmp/evidence/other.html',
      failureTracePath: undefined,
      traceUnavailableReason: 'trace missing',
    } : file);

    const result = auditLingxingAcceptanceEvidence({
      batch: batchValue,
      files: filesValue,
      diagnostic: diagnostic(),
      diagnosticEvidenceReadiness: diagnosticReadiness(),
      manifest: manifest(batchValue, manifestFiles),
      fileExists: () => true,
    });

    const detail = result.checks.find((check) => check.name === 'manifest_consistent')?.detail;
    expect(result.checks.find((check) => check.name === 'manifest_consistent')).toMatchObject({ status: 'failed' });
    expect(detail).toContain('manifest maxAutoRetries mismatch for campaign');
    expect(detail).toContain('manifest autoRetryCount mismatch for campaign');
    expect(detail).toContain('manifest errorMessage mismatch for campaign');
    expect(detail).toContain('manifest attemptErrors mismatch for campaign');
    expect(detail).toContain('manifest failureScreenshotPath mismatch for campaign');
    expect(detail).toContain('manifest failureDomSnapshotPath mismatch for campaign');
    expect(detail).toContain('manifest failureTracePath mismatch for campaign');
    expect(detail).toContain('manifest traceUnavailableReason mismatch for campaign');
  });

  it('fails when manifest or downloaded files are outside the batch download directory', () => {
    const batchValue = batch({
      downloadDir: 'C:/tmp/downloads/batch_1',
      manifestPath: 'C:/tmp/downloads-other/batch_1/manifest.json',
    });
    const filesValue = files().map((file, index) => ({
      ...file,
      filePath: index === 0
        ? 'C:/tmp/downloads-other/batch_1/campaign_2026-05-01_2026-05-31.xlsx'
        : `C:/tmp/downloads/batch_1/${file.reportType}_2026-05-01_2026-05-31.xlsx`,
    }));

    const result = auditLingxingAcceptanceEvidence({
      batch: batchValue,
      files: filesValue,
      diagnostic: diagnostic(),
      diagnosticEvidenceReadiness: diagnosticReadiness(),
      manifest: manifest(batchValue, filesValue),
      fileExists: () => true,
    });

    expect(result.status).toBe('failed');
    expect(result.checks.find((check) => check.name === 'download_directory_layout')).toMatchObject({
      status: 'failed',
      detail: expect.stringContaining('manifestPath is outside batch downloadDir'),
    });
    expect(result.checks.find((check) => check.name === 'download_directory_layout')?.detail).toContain('campaign filePath is outside batch downloadDir');
  });
});

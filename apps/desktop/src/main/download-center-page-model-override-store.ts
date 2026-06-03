import * as fs from 'fs';
import * as path from 'path';
import type { DownloadCenterPageModel } from '@amazon-ai-ops/shared-types';

export interface DownloadCenterPageModelOverrideMetadata {
  savedAt: string;
  appVersion: string;
  overridePath: string;
  backupPath?: string;
  requiresManualVerification: boolean;
  postSaveDiagnosticRequired: boolean;
  postSaveDiagnosticReason?: string;
  readiness: {
    ready: boolean;
    missing: string[];
    reason?: string;
  };
}

export interface SaveDownloadCenterPageModelOverrideOptions {
  model: DownloadCenterPageModel;
  overridePath: string;
  appVersion: string;
  readiness: DownloadCenterPageModelOverrideMetadata['readiness'];
  nowMs?: number;
}

export function saveDownloadCenterPageModelOverride(options: SaveDownloadCenterPageModelOverrideOptions): DownloadCenterPageModelOverrideMetadata {
  fs.mkdirSync(path.dirname(options.overridePath), { recursive: true });
  const backupPath = backupExistingDownloadCenterPageModelOverride(options.overridePath, options.nowMs);
  fs.writeFileSync(options.overridePath, `${JSON.stringify(options.model, null, 2)}\n`, 'utf8');

  const metadata: DownloadCenterPageModelOverrideMetadata = {
    savedAt: new Date(options.nowMs ?? Date.now()).toISOString(),
    appVersion: options.appVersion,
    overridePath: options.overridePath,
    backupPath,
    requiresManualVerification: options.model.requiresManualVerification,
    postSaveDiagnosticRequired: !options.model.requiresManualVerification,
    postSaveDiagnosticReason: options.model.requiresManualVerification
      ? undefined
      : 'manual verification was disabled; run a fresh read-only diagnostic for this exact enabled page-model snapshot before collection',
    readiness: options.readiness,
  };
  fs.writeFileSync(getDownloadCenterPageModelOverrideMetadataPath(options.overridePath), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  return metadata;
}

export function backupExistingDownloadCenterPageModelOverride(overridePath: string, nowMs = Date.now()): string | undefined {
  if (!fs.existsSync(overridePath) || !fs.statSync(overridePath).isFile()) {
    return undefined;
  }
  const backupDir = path.join(path.dirname(overridePath), 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `lingxing-download-center.override.${timestampForFilename(nowMs)}.json`);
  fs.copyFileSync(overridePath, backupPath);
  return backupPath;
}

export function getDownloadCenterPageModelOverrideMetadataPath(overridePath: string): string {
  return overridePath.replace(/\.json$/i, '.metadata.json');
}

function timestampForFilename(nowMs: number): string {
  return new Date(nowMs).toISOString().replace(/\D/g, '').slice(0, 14);
}

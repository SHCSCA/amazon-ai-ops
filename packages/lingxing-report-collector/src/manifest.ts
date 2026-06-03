import * as fs from 'fs';
import * as path from 'path';
import type { LingxingReportBatch, LingxingReportFile } from '@amazon-ai-ops/shared-types';

export interface LingxingReportManifest {
  appVersion?: string;
  batch: LingxingReportBatch;
  files: LingxingReportFile[];
  generatedAt: string;
}

export function writeManifest(batch: LingxingReportBatch, files: LingxingReportFile[]): string {
  fs.mkdirSync(batch.downloadDir, { recursive: true });
  const manifestPath = path.join(batch.downloadDir, 'manifest.json');
  const manifest: LingxingReportManifest = {
    appVersion: batch.appVersion,
    batch: { ...batch, manifestPath },
    files,
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  return manifestPath;
}

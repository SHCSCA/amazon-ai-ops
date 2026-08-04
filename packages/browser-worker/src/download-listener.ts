import type { Page } from 'playwright';
import * as fs from 'fs';
import type { DownloadFile } from '@amazon-ai-ops/shared-types';
import type { StoreCapsulePaths } from './store-profile';
import { ensureStoreCapsulePaths } from './store-profile';
import { resolveStoreCapsuleDownloadTarget } from './store-download';

export class DownloadListener {
  private downloads: DownloadFile[] = [];
  private readonly storeCapsule: StoreCapsulePaths;
  private readonly targetDirectory: string | undefined;

  constructor(storeCapsule: StoreCapsulePaths, targetDirectory?: string) {
    this.storeCapsule = ensureStoreCapsulePaths(storeCapsule);
    this.targetDirectory = targetDirectory;
  }

  async startListening(page: Page): Promise<void> {
    page.on('download', async (download) => {
      const target = resolveStoreCapsuleDownloadTarget(
        this.storeCapsule,
        download.suggestedFilename(),
        this.targetDirectory,
      );
      
      await download.saveAs(target.path);
      
      this.downloads.push({
        path: target.path,
        filename: target.filename,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: fs.statSync(target.path).size,
        downloadedAt: new Date().toISOString(),
      });
    });
  }

  getDownloads(): DownloadFile[] {
    return [...this.downloads];
  }

  clearDownloads(): void {
    this.downloads = [];
  }

  async waitForDownload(filenamePattern?: string, timeout = 60000): Promise<DownloadFile | null> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const found = this.downloads.find(d => 
        filenamePattern ? d.filename.includes(filenamePattern) : true
      );
      if (found) return found;
      await new Promise(r => setTimeout(r, 1000));
    }
    return null;
  }
}

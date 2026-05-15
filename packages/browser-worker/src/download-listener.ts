import { Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import type { DownloadFile } from '@amazon-ai-ops/shared-types';

export class DownloadListener {
  private downloads: DownloadFile[] = [];
  private downloadPath: string;

  constructor(downloadPath: string) {
    this.downloadPath = downloadPath;
    fs.mkdirSync(this.downloadPath, { recursive: true });
  }

  async startListening(page: Page): Promise<void> {
    page.on('download', async (download) => {
      const filename = download.suggestedFilename();
      const filepath = path.join(this.downloadPath, filename);
      
      await download.saveAs(filepath);
      
      this.downloads.push({
        path: filepath,
        filename,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: fs.statSync(filepath).size,
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

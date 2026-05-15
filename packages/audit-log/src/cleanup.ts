import * as fs from 'fs';
import * as path from 'path';
import { ScreenshotManager } from './screenshot';
import { TraceManager } from './trace';

export interface CleanupConfig {
  screenshotRetention: {
    beforeDays: number;   // 普通截图保留天数
    errorDays: number;    // 错误截图保留天数
  };
  traceRetentionDays: number;
  reportRetentionDays: number;
}

const DEFAULT_CONFIG: CleanupConfig = {
  screenshotRetention: {
    beforeDays: 30,
    errorDays: 90,
  },
  traceRetentionDays: 14,
  reportRetentionDays: 30,
};

export class CleanupManager {
  private screenshotMgr: ScreenshotManager;
  private traceMgr: TraceManager;
  private baseDir: string;
  private config: CleanupConfig;

  constructor(baseDir: string, config: Partial<CleanupConfig> = {}) {
    this.baseDir = baseDir;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.screenshotMgr = new ScreenshotManager(path.join(baseDir, 'screenshots'));
    this.traceMgr = new TraceManager(path.join(baseDir, 'traces'));
  }

  /**
   * 执行全量清理
   */
  async cleanup(): Promise<CleanupReport> {
    const report: CleanupReport = {
      screenshotsDeleted: 0,
      tracesDeleted: 0,
      reportsDeleted: 0,
      freedBytes: 0,
      errors: [],
    };

    // 清理截图
    try {
      const ssResult = this.cleanupScreenshots();
      report.screenshotsDeleted = ssResult.count;
      report.freedBytes += ssResult.bytes;
    } catch (e) {
      report.errors.push(`Screenshot cleanup error: ${(e as Error).message}`);
    }

    // 清理 Trace
    try {
      report.tracesDeleted = this.traceMgr.cleanupOldTraces(this.config.traceRetentionDays);
    } catch (e) {
      report.errors.push(`Trace cleanup error: ${(e as Error).message}`);
    }

    // 清理报表文件
    try {
      const reportResult = this.cleanupReports();
      report.reportsDeleted = reportResult.count;
      report.freedBytes += reportResult.bytes;
    } catch (e) {
      report.errors.push(`Report cleanup error: ${(e as Error).message}`);
    }

    return report;
  }

  private cleanupScreenshots(): { count: number; bytes: number } {
    let count = 0;
    let bytes = 0;
    const now = Date.now();
    
    const dirs = [
      { name: 'before', maxAge: this.config.screenshotRetention.beforeDays },
      { name: 'after', maxAge: this.config.screenshotRetention.beforeDays },
      { name: 'error', maxAge: this.config.screenshotRetention.errorDays },
    ];

    for (const { name, maxAge } of dirs) {
      const dir = path.join(this.baseDir, 'screenshots', name);
      if (!fs.existsSync(dir)) continue;

      const maxAgeMs = maxAge * 24 * 60 * 60 * 1000;
      
      for (const file of fs.readdirSync(dir)) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        
        if (now - stat.mtimeMs > maxAgeMs) {
          bytes += stat.size;
          fs.unlinkSync(filePath);
          count++;
        }
      }
    }

    return { count, bytes };
  }

  private cleanupReports(): { count: number; bytes: number } {
    let count = 0;
    let bytes = 0;
    const now = Date.now();
    const maxAgeMs = this.config.reportRetentionDays * 24 * 60 * 60 * 1000;

    const reportDirs = [
      path.join(this.baseDir, 'reports', 'daily'),
      path.join(this.baseDir, 'reports', 'export'),
    ];

    for (const dir of reportDirs) {
      if (!fs.existsSync(dir)) continue;

      for (const file of fs.readdirSync(dir)) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        
        if (stat.isFile() && now - stat.mtimeMs > maxAgeMs) {
          bytes += stat.size;
          fs.unlinkSync(filePath);
          count++;
        }
      }
    }

    return { count, bytes };
  }
}

export interface CleanupReport {
  screenshotsDeleted: number;
  tracesDeleted: number;
  reportsDeleted: number;
  freedBytes: number;
  errors: string[];
}

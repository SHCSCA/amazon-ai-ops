import * as fs from 'fs';
import * as path from 'path';

export class TraceManager {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }
  }

  /**
   * 生成 Trace 目录路径
   */
  generateTraceDir(taskId: string): string {
    const timestamp = new Date().toISOString().split('T')[0];
    const dirName = `trace_${taskId}_${timestamp}`;
    const dirPath = path.join(this.baseDir, dirName);
    
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    
    return dirPath;
  }

  /**
   * 清理超过指定天数的 Trace
   */
  cleanupOldTraces(maxAgeDays: number = 14): number {
    if (!fs.existsSync(this.baseDir)) return 0;
    
    const now = Date.now();
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
    let deletedCount = 0;

    const entries = fs.readdirSync(this.baseDir);
    for (const entry of entries) {
      const entryPath = path.join(this.baseDir, entry);
      const stat = fs.statSync(entryPath);
      
      if (stat.isDirectory() && now - stat.mtimeMs > maxAgeMs) {
        fs.rmSync(entryPath, { recursive: true, force: true });
        deletedCount++;
      }
    }

    return deletedCount;
  }

  /**
   * 获取 Trace 总大小
   */
  getTotalSize(): number {
    if (!fs.existsSync(this.baseDir)) return 0;
    
    return fs.readdirSync(this.baseDir).reduce((total, entry) => {
      const entryPath = path.join(this.baseDir, entry);
      const stat = fs.statSync(entryPath);
      if (stat.isDirectory()) {
        return total + this.getDirSize(entryPath);
      }
      return total + stat.size;
    }, 0);
  }

  private getDirSize(dir: string): number {
    return fs.readdirSync(dir).reduce((sum, file) => {
      const stat = fs.statSync(path.join(dir, file));
      return sum + (stat.isFile() ? stat.size : 0);
    }, 0);
  }
}

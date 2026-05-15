import * as fs from 'fs';
import * as path from 'path';

export interface ScreenshotOptions {
  fullPage?: boolean;
  label?: string;
}

export class ScreenshotManager {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    this.ensureDir();
  }

  private ensureDir(): void {
    const dirs = ['before', 'after', 'error'];
    for (const dir of dirs) {
      const dirPath = path.join(this.baseDir, dir);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
    }
  }

  /**
   * 生成截图路径
   */
  generatePath(label: 'before' | 'after' | 'error', extension = '.png'): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${label}_${timestamp}${extension}`;
    return path.join(this.baseDir, label, filename);
  }

  /**
   * 保存截图（由 BrowserController 调用后记录路径）
   */
  savePath(label: 'before' | 'after' | 'error', filePath: string): void {
    // 路径已由 BrowserController 保存，这里只做记录
    // 实际使用时由 caller 传入路径
  }

  /**
   * 获取截图目录大小
   */
  getStorageSize(): { before: number; after: number; error: number; total: number } {
    const getDirSize = (dir: string): number => {
      if (!fs.existsSync(dir)) return 0;
      return fs.readdirSync(dir)
        .reduce((sum, file) => {
          const stat = fs.statSync(path.join(dir, file));
          return sum + (stat.isFile() ? stat.size : 0);
        }, 0);
    };

    const before = getDirSize(path.join(this.baseDir, 'before'));
    const after = getDirSize(path.join(this.baseDir, 'after'));
    const error = getDirSize(path.join(this.baseDir, 'error'));

    return {
      before,
      after,
      error,
      total: before + after + error,
    };
  }

  /**
   * 格式化文件大小
   */
  static formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }
}

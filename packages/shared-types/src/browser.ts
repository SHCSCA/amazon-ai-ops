export interface BrowserConfig {
  headless: boolean;               // v1.2 默认 false (headful)
  userDataDir?: string;            // Playwright persistent profile
  viewport?: { width: number; height: number };
  userAgent?: string;
  downloadPath?: string;
  timeout?: number;                // 默认 30000ms
}

export interface SessionInfo {
  isLoggedIn: boolean;
  currentUrl: string;
  storeName?: string;
  marketplaceCode?: string;
  accountEmail?: string;
  sessionExpiry?: string;
  checkedAt: string;
}

export interface DownloadFile {
  path: string;
  filename: string;
  mimeType: string;
  size: number;
  downloadedAt: string;
}

export interface ScreenshotResult {
  path: string;
  label: 'before' | 'after' | 'error' | 'page';
  pageUrl: string;
  takenAt: string;
}

export interface PageSnapshot {
  url: string;
  title: string;
  screenshotPath: string;
  domSnapshot?: string;
  capturedAt: string;
}

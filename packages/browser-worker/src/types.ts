import type { BrowserConfig, SessionInfo, ScreenshotResult, DownloadFile } from '@amazon-ai-ops/shared-types';

export { BrowserConfig, SessionInfo, ScreenshotResult, DownloadFile };

export interface LocatorResult {
  found: boolean;
  selector?: string;
  element?: any;
  error?: string;
}

export interface NavigationOptions {
  timeout?: number;
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
}

export interface ClickOptions {
  force?: boolean;
  timeout?: number;
  retryCount?: number;
}

export interface FillOptions {
  timeout?: number;
}

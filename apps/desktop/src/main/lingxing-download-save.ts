import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  resolveStoreCapsuleDownloadTarget,
  type StoreCapsulePaths,
} from '@amazon-ai-ops/browser-worker';

const LINGXING_DOWNLOAD_BUCKET_HOSTS = new Set([
  'download-cent-prod-1254213275.cos.accelerate.myqcloud.com',
  'download-cent-prod-1254213275.cos.myqcloud.com',
]);

interface LingxingDownloadPort {
  suggestedFilename(): string;
  url(): string;
  saveAs(targetPath: string): Promise<void>;
  failure(): Promise<string | null>;
}

interface LingxingDownloadResponsePort {
  ok(): boolean;
  status(): number;
  headers(): Record<string, string>;
  body(): Promise<Buffer>;
}

interface LingxingDownloadRequestPort {
  get(
    url: string,
    options?: { timeout?: number; failOnStatusCode?: boolean },
  ): Promise<LingxingDownloadResponsePort>;
}

export interface SaveLingxingReportDownloadOptions {
  readonly download: LingxingDownloadPort;
  readonly request: LingxingDownloadRequestPort;
  readonly storeCapsule: StoreCapsulePaths;
  readonly downloadDir: string;
  readonly fallbackTimeoutMs?: number;
}

function assertTrustedLingxingReportDownloadUrl(rawUrl: string, suggestedFilename: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('领星报表下载地址无效，已阻断备用下载。');
  }
  if (
    url.protocol !== 'https:'
    || url.username.length > 0
    || url.password.length > 0
    || !LINGXING_DOWNLOAD_BUCKET_HOSTS.has(url.hostname.toLowerCase())
  ) {
    throw new Error('领星报表下载地址不在受信任的只读文件域，已阻断备用下载。');
  }
  let urlFilename: string;
  try {
    urlFilename = decodeURIComponent(path.posix.basename(url.pathname));
  } catch {
    throw new Error('领星报表下载文件名无法校验，已阻断备用下载。');
  }
  if (urlFilename !== suggestedFilename || !urlFilename.toLowerCase().endsWith('.xlsx')) {
    throw new Error('领星报表下载文件名与浏览器回读不一致，已阻断备用下载。');
  }
  return url;
}

function assertXlsxResponse(response: LingxingDownloadResponsePort, body: Buffer): void {
  if (!response.ok()) {
    throw new Error(`领星报表备用下载失败（HTTP ${response.status()}），请重试该报表。`);
  }
  const contentType = String(response.headers()['content-type'] || '').toLowerCase();
  if (
    !contentType.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    && !contentType.includes('application/octet-stream')
  ) {
    throw new Error('领星报表备用下载返回的文件类型不是 Excel，已阻断保存。');
  }
  if (body.length < 4 || body[0] !== 0x50 || body[1] !== 0x4b) {
    throw new Error('领星报表备用下载内容不是有效的 Excel 文件，已阻断保存。');
  }
}

function persistFallbackBody(targetPath: string, body: Buffer): void {
  if (fs.existsSync(targetPath)) return;
  const temporaryPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${process.pid}.${crypto.randomUUID()}.partial`,
  );
  let fileDescriptor: number | undefined;
  try {
    fileDescriptor = fs.openSync(temporaryPath, 'wx', 0o600);
    fs.writeFileSync(fileDescriptor, body);
    fs.closeSync(fileDescriptor);
    fileDescriptor = undefined;
    fs.renameSync(temporaryPath, targetPath);
  } finally {
    if (fileDescriptor !== undefined) fs.closeSync(fileDescriptor);
    fs.rmSync(temporaryPath, { force: true });
  }
}

export async function saveLingxingReportDownload(
  options: SaveLingxingReportDownloadOptions,
): Promise<string> {
  const suggestedFilename = options.download.suggestedFilename();
  const target = resolveStoreCapsuleDownloadTarget(
    options.storeCapsule,
    suggestedFilename,
    options.downloadDir,
  );
  try {
    await options.download.saveAs(target.path);
    return target.path;
  } catch (error) {
    const failure = await options.download.failure().catch(() => null);
    const message = error instanceof Error ? error.message : String(error);
    if (failure !== 'canceled' && !/\bcancell?ed\b/i.test(message)) throw error;
  }

  const url = assertTrustedLingxingReportDownloadUrl(options.download.url(), suggestedFilename);
  const response = await options.request.get(url.toString(), {
    timeout: options.fallbackTimeoutMs ?? 120000,
    failOnStatusCode: false,
  });
  const body = await response.body();
  assertXlsxResponse(response, body);
  persistFallbackBody(target.path, body);
  return target.path;
}

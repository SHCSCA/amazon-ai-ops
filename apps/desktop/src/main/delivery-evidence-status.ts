import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type Database from 'better-sqlite3';
import {
  isReadbackStoreSecurityError,
  readStoreScopedReadbackEvidenceFile,
  resolveStoreScopedReadbackReference,
  type StoreScopedReadbackAccess,
} from './readback-store-authority';

export interface DeliveryEvidenceStatusScope {
  dateFrom?: string;
  dateTo?: string;
  storeName?: string;
  marketplaceCode?: string;
  asin?: string;
  batchId?: string;
}

export interface DeliveryEvidenceStatus {
  listing: {
    readReady: boolean;
    draftReady: boolean;
    contentCount: number;
    fullContentCount: number;
    draftCount: number;
    aiDraftCount: number;
    ruleFallbackDraftCount: number;
    latestAsin?: string;
    latestUpdatedAt?: string;
  };
  readback: {
    verifiedCount: number;
    latestStatus?: string;
    latestJsonPath?: string;
    latestUpdatedAt?: string;
  };
  package: {
    installerAvailable: boolean;
    installerPath?: string;
    portablePath?: string;
    sha256?: string;
    latestBuiltAt?: string;
  };
}

export function getDeliveryEvidenceStatus(input: {
  db: Database.Database | null | undefined;
  storeId: string;
  readbackDir: string;
  readbackAccess?: StoreScopedReadbackAccess;
  releaseDir?: string;
  scope: DeliveryEvidenceStatusScope;
}): DeliveryEvidenceStatus {
  return {
    listing: getListingEvidenceStatus(input.db, input.storeId, input.scope),
    readback: getReadbackEvidenceStatus(input.readbackDir, input.scope, input.readbackAccess),
    package: getPackageEvidenceStatus(input.releaseDir || ''),
  };
}

function getListingEvidenceStatus(
  db: Database.Database | null | undefined,
  storeIdInput: string,
  scope: DeliveryEvidenceStatusScope,
): DeliveryEvidenceStatus['listing'] {
  const storeId = normalize(storeIdInput);
  if (!db || !storeId) {
    return {
      readReady: false,
      draftReady: false,
      contentCount: 0,
      fullContentCount: 0,
      draftCount: 0,
      aiDraftCount: 0,
      ruleFallbackDraftCount: 0,
    };
  }
  const asin = normalize(scope.asin);
  const contentRows = safeQueryAll<any>(db, `
    SELECT store_id, asin, store_name, marketplace_code, title, bullets_json, backend_terms, source_url, screenshot_path, updated_at
    FROM listing_content
    WHERE store_id = @storeId
    ${asin ? 'AND upper(asin) = upper(@asin)' : ''}
    ORDER BY datetime(updated_at) DESC, id DESC
  `, asin ? { storeId, asin } : { storeId });
  const draftRows = safeQueryAll<any>(db, `
    SELECT store_id, asin, store_name, marketplace_code, source, ai_fallback_reason, updated_at
    FROM listing_drafts
    WHERE store_id = @storeId
    ${asin ? 'AND upper(asin) = upper(@asin)' : ''}
    ORDER BY datetime(updated_at) DESC, id DESC
  `, asin ? { storeId, asin } : { storeId });
  const scopedContentRows = contentRows.filter((row) => listingRowMatchesScope(row, scope));
  const scopedDraftRows = draftRows.filter((row) => listingRowMatchesScope(row, scope));
  const fullContentRows = scopedContentRows.filter((row) => listingContentIsFull(row));
  const aiDraftRows = scopedDraftRows.filter((row) => row.source === 'ai' && !normalize(row.ai_fallback_reason));
  const ruleFallbackDraftRows = scopedDraftRows.filter((row) => normalize(row.ai_fallback_reason) || row.source !== 'ai');
  const latestContent = contentRows[0];
  const latestDraft = draftRows[0];

  return {
    readReady: Boolean(asin && fullContentRows.length > 0),
    draftReady: Boolean(asin && aiDraftRows.length > 0),
    contentCount: contentRows.length,
    fullContentCount: fullContentRows.length,
    draftCount: draftRows.length,
    aiDraftCount: aiDraftRows.length,
    ruleFallbackDraftCount: ruleFallbackDraftRows.length,
    latestAsin: latestContent?.asin || latestDraft?.asin || undefined,
    latestUpdatedAt: latestContent?.updated_at || latestDraft?.updated_at || undefined,
  };
}

function getReadbackEvidenceStatus(
  readbackDir: string,
  scope: DeliveryEvidenceStatusScope,
  readbackAccess?: StoreScopedReadbackAccess,
): DeliveryEvidenceStatus['readback'] {
  const files = listReadbackJsonFiles(readbackDir, readbackAccess);
  const matching = files
    .map((filePath) => readReadbackFile(filePath, readbackAccess))
    .filter((item): item is { filePath: string; payload: any; updatedAt: string } => Boolean(item))
    .filter((item) => readbackMatchesScope(item.payload, scope))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const verified = matching.filter((item) => (
    item.payload?.status === 'PASS'
    && item.payload?.readback?.verified === true
    && readbackEvidenceIsVerifierAligned(item.payload)
  ));
  const latest = matching[0];

  return {
    verifiedCount: verified.length,
    latestStatus: latest?.payload?.status,
    latestJsonPath: latest?.filePath,
    latestUpdatedAt: latest?.updatedAt,
  };
}

export function getPackageEvidenceStatus(releaseDir: string): DeliveryEvidenceStatus['package'] {
  const installerPath = latestReleaseFile(releaseDir, /^AmazonAIOpsAgent-.*(?<!portable)\.exe$/i);
  const portablePath = latestReleaseFile(releaseDir, /^AmazonAIOpsAgent-.*portable\.exe$/i);
  const hashTarget = portablePath || installerPath;
  if (!hashTarget) {
    return { installerAvailable: false };
  }
  const latestMtime = [installerPath, portablePath]
    .filter((filePath): filePath is string => Boolean(filePath))
    .map((filePath) => fs.statSync(filePath).mtime.toISOString())
    .sort()
    .pop();
  return {
    installerAvailable: Boolean(installerPath),
    installerPath: installerPath || undefined,
    portablePath: portablePath || undefined,
    sha256: sha256(hashTarget),
    latestBuiltAt: latestMtime,
  };
}

function latestReleaseFile(releaseDir: string, pattern: RegExp): string | undefined {
  if (!releaseDir || !fs.existsSync(releaseDir)) return undefined;
  return fs.readdirSync(releaseDir)
    .filter((name) => pattern.test(name))
    .map((name) => path.join(releaseDir, name))
    .filter((filePath) => fs.existsSync(filePath) && fs.statSync(filePath).isFile())
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}

function sha256(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function safeQueryAll<T>(db: Database.Database, sql: string, params: Record<string, unknown>): T[] {
  try {
    return db.prepare(sql).all(params) as T[];
  } catch {
    return [];
  }
}

function listingContentIsFull(row: any): boolean {
  const title = normalize(row?.title);
  const backendTerms = normalize(row?.backend_terms);
  const bullets = parseJsonArray(row?.bullets_json);
  return Boolean(normalize(row?.asin) && title && backendTerms && bullets.length > 0);
}

function listingRowMatchesScope(row: any, scope: DeliveryEvidenceStatusScope): boolean {
  return matchesOptional(scope.storeName, row?.store_name)
    && matchesOptional(scope.marketplaceCode, row?.marketplace_code);
}

function parseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function listReadbackJsonFiles(
  readbackDir: string,
  readbackAccess?: StoreScopedReadbackAccess,
): string[] {
  if (!readbackDir) return [];
  if (readbackAccess && path.resolve(readbackDir) !== path.resolve(readbackAccess.rootDir)) {
    throw new Error('READBACK_DELIVERY_ROOT_MISMATCH: delivery evidence must use the current store readback root.');
  }
  if (!fs.existsSync(readbackDir)) return [];
  if (!readbackAccess) {
    return fs.readdirSync(readbackDir)
      .filter((name) => /^real-ad-execution-readback-.*\.json$/i.test(name))
      .map((name) => path.join(readbackDir, name));
  }
  const files: string[] = [];
  const visit = (directory: string): void => {
    resolveStoreScopedReadbackReference(readbackAccess, directory, 'root');
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error('READBACK_UNSAFE_FILESYSTEM_ENTRY: delivery evidence must not traverse links or junctions.');
      }
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (entry.isFile() && /^real-ad-execution-readback-.*\.json$/i.test(entry.name)) {
        files.push(resolveStoreScopedReadbackReference(readbackAccess, entryPath, 'root'));
      }
    }
  };
  for (const entry of fs.readdirSync(readbackDir, { withFileTypes: true })) {
    const entryPath = path.join(readbackDir, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error('READBACK_UNSAFE_FILESYSTEM_ENTRY: delivery evidence must not traverse links or junctions.');
    }
    if (entry.isDirectory()) visit(entryPath);
    else if (entry.isFile() && /^real-ad-execution-readback-.*\.json$/i.test(entry.name)) {
      files.push(resolveStoreScopedReadbackReference(readbackAccess, entryPath, 'root'));
    }
  }
  return files;
}

function readReadbackFile(
  filePath: string,
  readbackAccess?: StoreScopedReadbackAccess,
): { filePath: string; payload: any; updatedAt: string } | null {
  try {
    const authorized = readbackAccess
      ? readStoreScopedReadbackEvidenceFile(readbackAccess, filePath, 'root')
      : { filePath, payload: JSON.parse(fs.readFileSync(filePath, 'utf8')) };
    const updatedAt = String(authorized.payload?.readback?.readAt || authorized.payload?.createdAt || fs.statSync(authorized.filePath).mtime.toISOString());
    return { filePath: authorized.filePath, payload: authorized.payload, updatedAt };
  } catch (error) {
    if (readbackAccess && isReadbackStoreSecurityError(error)) throw error;
    return null;
  }
}

function readbackMatchesScope(payload: any, scope: DeliveryEvidenceStatusScope): boolean {
  const target = payload?.target || {};
  return matchesOptional(scope.storeName, target.storeName)
    && matchesOptional(scope.marketplaceCode, target.marketplaceCode)
    && matchesOptional(scope.asin, target.asin)
    && matchesOptional(scope.batchId, payload?.source?.batchId)
    && matchesDateRange(scope, payload);
}

function readbackEvidenceIsVerifierAligned(payload: any): boolean {
  const source = payload?.source || {};
  const before = payload?.before || {};
  const after = payload?.after || {};
  const readback = payload?.readback || {};
  const target = payload?.target || {};
  const sourceFiles = Array.isArray(source.sourceFiles) ? source.sourceFiles : [];
  const sourceRow = Number(source.sourceRow);
  return sourceFiles.length > 0
    && sourceFiles.every(isRealReportFilePath)
    && Number.isFinite(sourceRow)
    && sourceRow > 0
    && normalize(source.currentValue)
    && normalize(source.recommendedValue)
    && normalize(before.value)
    && normalize(after.value)
    && !valuesMatch(before.value, after.value)
    && actionDirectionIsValid(target.actionType, before.value, after.value)
    && valuesMatch(readback.actualValue, after.value)
    && evidenceImagePathsAreDistinct(before.screenshotPath, after.screenshotPath, readback.evidencePath || readback.screenshotPath);
}

function isRealReportFilePath(filePath: unknown): boolean {
  const normalized = normalize(filePath).split(/[?#]/)[0];
  if (!/\.(xlsx|xls|csv)$/i.test(normalized)) return false;
  const resolved = path.resolve(normalized);
  return fs.existsSync(resolved) && fs.statSync(resolved).isFile();
}

function isEvidenceImagePath(filePath: unknown): boolean {
  const normalized = normalize(filePath).split(/[?#]/)[0];
  if (!/\.(png|jpg|jpeg|webp)$/i.test(normalized)) return false;
  const resolved = path.resolve(normalized);
  return fs.existsSync(resolved) && fs.statSync(resolved).isFile();
}

function evidenceImagePathsAreDistinct(...filePaths: unknown[]): boolean {
  if (!filePaths.every(isEvidenceImagePath)) return false;
  const canonical = filePaths.map((filePath) => canonicalizePath(String(filePath)).toLowerCase());
  if (new Set(canonical).size !== canonical.length) return false;
  try {
    const contentHashes = canonical.map((filePath) => sha256(filePath));
    return new Set(contentHashes).size === contentHashes.length;
  } catch {
    return false;
  }
}

function canonicalizePath(filePath: string): string {
  const resolved = path.resolve(filePath);
  return fs.existsSync(resolved) ? fs.realpathSync.native(resolved) : resolved;
}

function parseExecutableNumber(value: unknown): number {
  const text = String(value ?? '').trim();
  if (!text || /[%％]/.test(text)) return Number.NaN;
  return Number(text.replace(/^\$/, '').replace(/\s*usd$/i, ''));
}

function valuesMatch(left: unknown, right: unknown): boolean {
  const leftNumber = parseExecutableNumber(left);
  const rightNumber = parseExecutableNumber(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return Math.abs(leftNumber - rightNumber) < 0.0001;
  }
  return String(left ?? '').trim() === String(right ?? '').trim();
}

function actionDirectionIsValid(actionType: unknown, beforeValue: unknown, afterValue: unknown): boolean {
  if (String(actionType || '').trim() !== 'lower_bid') return true;
  const beforeNumber = parseExecutableNumber(beforeValue);
  const afterNumber = parseExecutableNumber(afterValue);
  return Number.isFinite(beforeNumber) && Number.isFinite(afterNumber) && afterNumber < beforeNumber;
}

function matchesOptional(expected: unknown, actual: unknown): boolean {
  const expectedText = normalize(expected);
  if (!expectedText) return true;
  return expectedText.toUpperCase() === normalize(actual).toUpperCase();
}

function matchesDateRange(scope: DeliveryEvidenceStatusScope, payload: any): boolean {
  const dateFrom = normalize(scope.dateFrom);
  const dateTo = normalize(scope.dateTo);
  if (!dateFrom && !dateTo) return true;
  const metricDate = normalize(payload?.source?.metricDate) || normalize(payload?.target?.metricDate);
  if (!metricDate) return false;
  if (dateFrom && metricDate < dateFrom) return false;
  if (dateTo && metricDate > dateTo) return false;
  return true;
}

function normalize(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

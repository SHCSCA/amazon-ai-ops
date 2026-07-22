import * as fs from 'fs';
import * as path from 'path';
import type { BrowserProfileId, StoreId } from '@amazon-ai-ops/shared-types';
import {
  normalizeBrowserProfileId,
  normalizeStoreId,
} from '@amazon-ai-ops/shared-types';

export interface StoreCapsulePaths {
  readonly storeId: StoreId;
  readonly browserProfileId: BrowserProfileId;
  readonly trustedStoresRoot: string;
  readonly storeRoot: string;
  readonly lingxingProfileDir: string;
  readonly amazonAdsProfileDir: string;
  readonly downloadsDir: string;
  readonly reportsDir: string;
  readonly screenshotsDir: string;
  readonly tracesDir: string;
  readonly evidenceDir: string;
  readonly backupsDir: string;
}

export class StoreProfilePathError extends Error {
  constructor(
    readonly code:
      | 'TRUSTED_ROOT_NOT_ABSOLUTE'
      | 'UNSAFE_RELATIVE_PATH'
      | 'PATH_OUTSIDE_STORE_CAPSULE'
      | 'REAL_PATH_OUTSIDE_STORE_CAPSULE'
      | 'UNSAFE_FILESYSTEM_ENTRY',
    message: string,
  ) {
    super(message);
    this.name = 'StoreProfilePathError';
  }
}

/** Main-only path derivation. Callers provide logical ids, never a profile path. */
export function deriveStoreCapsulePaths(
  trustedStoresRoot: string,
  storeIdInput: unknown,
  browserProfileIdInput: unknown,
): StoreCapsulePaths {
  const trustedRoot = normalizeTrustedRoot(trustedStoresRoot);
  const storeId = normalizeStoreId(storeIdInput);
  const browserProfileId = normalizeBrowserProfileId(browserProfileIdInput);
  assertSafeWindowsPathComponent(storeId, 'storeId');
  assertSafeWindowsPathComponent(browserProfileId, 'browserProfileId');
  const storeRoot = resolveContainedPath(trustedRoot, storeId);
  const browserRoot = resolveContainedPath(storeRoot, 'browser', browserProfileId);
  return Object.freeze({
    storeId,
    browserProfileId,
    trustedStoresRoot: trustedRoot,
    storeRoot,
    lingxingProfileDir: resolveContainedPath(browserRoot, 'lingxing'),
    amazonAdsProfileDir: resolveContainedPath(browserRoot, 'amazon-ads'),
    downloadsDir: resolveContainedPath(storeRoot, 'downloads'),
    reportsDir: resolveContainedPath(storeRoot, 'reports'),
    screenshotsDir: resolveContainedPath(storeRoot, 'screenshots'),
    tracesDir: resolveContainedPath(storeRoot, 'traces'),
    evidenceDir: resolveContainedPath(storeRoot, 'evidence'),
    backupsDir: resolveContainedPath(storeRoot, 'backups'),
  });
}

export function ensureStoreCapsulePaths(paths: StoreCapsulePaths): StoreCapsulePaths {
  const canonical = rederiveAndAssertPaths(paths);
  fs.mkdirSync(canonical.trustedStoresRoot, { recursive: true });
  ensureContainedDirectory(canonical.trustedStoresRoot, canonical.storeRoot);
  const directories = [
    canonical.lingxingProfileDir,
    canonical.amazonAdsProfileDir,
    canonical.downloadsDir,
    canonical.reportsDir,
    canonical.screenshotsDir,
    canonical.tracesDir,
    canonical.evidenceDir,
    canonical.backupsDir,
  ];
  for (const directory of directories) {
    // Walk and create one component at a time. This checks a pre-existing
    // junction/symlink before mkdir can follow it and write into another store.
    ensureContainedDirectory(canonical.storeRoot, directory);
  }
  return canonical;
}

/** Resolve a Main-owned relative artifact path under one store capsule. */
export function resolveStoreCapsulePath(
  paths: Pick<
    StoreCapsulePaths,
    'storeId' | 'browserProfileId' | 'trustedStoresRoot' | 'storeRoot'
  >,
  ...relativeSegments: string[]
): string {
  const canonical = rederiveAndAssertPaths(paths);
  const candidate = resolveContainedPath(canonical.storeRoot, ...relativeSegments);
  if (pathEntryExists(canonical.storeRoot)) {
    assertExistingPathChainSafe(
      canonical.trustedStoresRoot,
      canonical.storeRoot,
      false,
    );
    assertExistingPathChainSafe(canonical.storeRoot, candidate, true);
  }
  return candidate;
}

export function assertPathContained(rootPath: string, candidatePath: string): void {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(root, candidate);
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    return;
  }
  throw new StoreProfilePathError(
    'PATH_OUTSIDE_STORE_CAPSULE',
    'resolved path is outside the store capsule',
  );
}

function normalizeTrustedRoot(value: unknown): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.includes('\0')
    || value !== value.trim()
    || !path.isAbsolute(value)
  ) {
    throw new StoreProfilePathError(
      'TRUSTED_ROOT_NOT_ABSOLUTE',
      'trusted store root must be an absolute Main-owned path',
    );
  }
  return path.resolve(value);
}

function resolveContainedPath(rootPath: string, ...relativeSegments: string[]): string {
  for (const segment of relativeSegments) {
    const parts = typeof segment === 'string' ? segment.split(/[\\/]+/) : [];
    if (
      typeof segment !== 'string'
      || segment.length === 0
      || segment.includes('\0')
      || path.isAbsolute(segment)
      || path.win32.isAbsolute(segment)
      || path.posix.isAbsolute(segment)
      || parts.some((part) => part === '..' || part === '.')
    ) {
      throw new StoreProfilePathError(
        'UNSAFE_RELATIVE_PATH',
        'store capsule paths accept safe relative segments only',
      );
    }
    for (const part of parts) assertSafeWindowsPathComponent(part, 'path segment');
  }
  const candidate = path.resolve(rootPath, ...relativeSegments);
  assertPathContained(rootPath, candidate);
  return candidate;
}

function rederiveAndAssertPaths(
  paths: Pick<
    StoreCapsulePaths,
    'storeId' | 'browserProfileId' | 'trustedStoresRoot' | 'storeRoot'
  >,
): StoreCapsulePaths {
  const canonical = deriveStoreCapsulePaths(
    paths.trustedStoresRoot,
    paths.storeId,
    paths.browserProfileId,
  );
  if (path.resolve(paths.storeRoot) !== canonical.storeRoot) {
    throw new StoreProfilePathError(
      'PATH_OUTSIDE_STORE_CAPSULE',
      'store capsule paths must be derived by Main from the trusted root and logical ids',
    );
  }
  return canonical;
}

function ensureContainedDirectory(rootPath: string, targetPath: string): void {
  assertPathContained(rootPath, targetPath);
  const canonicalRoot = fs.realpathSync.native(rootPath);
  let current = rootPath;
  const relative = path.relative(rootPath, targetPath);
  for (const component of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    if (!pathEntryExists(current)) fs.mkdirSync(current);
    assertExistingEntrySafe(canonicalRoot, current, false);
  }
}

function assertExistingPathChainSafe(
  rootPath: string,
  candidatePath: string,
  allowFinalFile: boolean,
): void {
  assertPathContained(rootPath, candidatePath);
  const canonicalRoot = fs.realpathSync.native(rootPath);
  let current = rootPath;
  const components = path.relative(rootPath, candidatePath).split(path.sep).filter(Boolean);
  for (let index = 0; index < components.length; index += 1) {
    current = path.join(current, components[index]);
    if (!pathEntryExists(current)) break;
    assertExistingEntrySafe(
      canonicalRoot,
      current,
      allowFinalFile && index === components.length - 1,
    );
  }
}

function assertExistingEntrySafe(
  canonicalRoot: string,
  candidatePath: string,
  allowFile: boolean,
): void {
  const stat = fs.lstatSync(candidatePath);
  if (stat.isSymbolicLink()) {
    throw new StoreProfilePathError(
      'REAL_PATH_OUTSIDE_STORE_CAPSULE',
      'store capsule paths must not traverse symbolic links or junctions',
    );
  }
  if (!allowFile && !stat.isDirectory()) {
    throw new StoreProfilePathError(
      'UNSAFE_FILESYSTEM_ENTRY',
      'store capsule directory path is occupied by a non-directory entry',
    );
  }
  const canonicalCandidate = fs.realpathSync.native(candidatePath);
  try {
    assertPathContained(canonicalRoot, canonicalCandidate);
  } catch {
    throw new StoreProfilePathError(
      'REAL_PATH_OUTSIDE_STORE_CAPSULE',
      'store capsule path resolves outside its physical store boundary',
    );
  }
}

function pathEntryExists(candidatePath: string): boolean {
  try {
    fs.lstatSync(candidatePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function assertSafeWindowsPathComponent(value: string, label: string): void {
  const reservedDeviceName = /^(?:con|prn|aux|nul|clock\$|com[1-9]|lpt[1-9])(?:\..*)?$/i;
  if (
    value.length === 0
    || /[<>:"|?*\u0000-\u001f]/.test(value)
    || /[. ]$/.test(value)
    || reservedDeviceName.test(value)
  ) {
    throw new StoreProfilePathError(
      'UNSAFE_RELATIVE_PATH',
      `${label} is not a canonical Windows path component`,
    );
  }
}

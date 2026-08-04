import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { deriveStoreCapsulePaths, type StoreCapsulePaths } from './store-profile';

const PROFILE_MIGRATION_MANIFEST = '.amazon-ai-ops-profile-migration-v1.json';
const PROFILE_CLAIMS_DIRECTORY = '.profile-migration-claims-v1';

export type StoreProfileProvider = 'lingxing' | 'amazon_ads';

export interface StoreProfileIdentityBinding {
  storeId: string;
  browserProfileId: string;
  provider: StoreProfileProvider;
  externalAccountId: string;
  identityProofSha256: string;
  verifiedAt: string;
}

export interface LegacyStoreProfileMigrationInput {
  trustedLegacyRoot: string;
  sourceProfilePath: string;
  trustedStoresRoot: string;
  browserState: 'stopped' | 'running' | 'unknown';
  binding: StoreProfileIdentityBinding;
  resumePending?: boolean;
}

export interface ProfileFileManifestEntry {
  relativePath: string;
  sizeBytes: number;
  sha256: string;
}

export interface StoreProfileMigrationManifest {
  kind: 'store-profile-migration';
  schemaVersion: 1;
  status: 'pending' | 'published';
  operationId: string;
  sourceRealPath: string;
  sourceFingerprint: string;
  targetPath: string;
  binding: StoreProfileIdentityBinding;
  createdAt: string;
  publishedAt?: string;
  files: ProfileFileManifestEntry[];
  totalBytes: number;
}

export interface StoreProfileMigrationPreflight {
  canMigrate: boolean;
  alreadyMigrated: boolean;
  operationId: string;
  sourceRealPath: string;
  targetPath: string;
  sourceFingerprint: string;
  files: ProfileFileManifestEntry[];
  totalBytes: number;
  blockers: string[];
}

export interface StoreProfileMigrationResult extends StoreProfileMigrationPreflight {
  status: 'published' | 'reused';
  manifestPath: string;
  claimPath: string;
}

export interface StoreProfileMigrationHooks {
  /** Test-only failure injection after the staged copy has been verified. */
  afterStageVerified?: () => void;
}

export class StoreProfileMigrationError extends Error {
  constructor(
    readonly code:
      | 'PROFILE_MIGRATION_BLOCKED'
      | 'PROFILE_MIGRATION_PENDING'
      | 'PROFILE_MIGRATION_COPY_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'StoreProfileMigrationError';
  }
}

export function preflightLegacyStoreProfileMigration(
  input: LegacyStoreProfileMigrationInput,
): StoreProfileMigrationPreflight {
  const blockers: string[] = [];
  if (input.browserState !== 'stopped') {
    blockers.push('Browser profile migration requires an explicit stopped browser state.');
  }
  const binding = normalizeBinding(input.binding, blockers);
  const trustedLegacyRoot = normalizeAbsolutePath(input.trustedLegacyRoot, 'trusted legacy root', blockers);
  const trustedStoresRoot = normalizeAbsolutePath(input.trustedStoresRoot, 'trusted stores root', blockers);
  const sourceCandidate = normalizeAbsolutePath(input.sourceProfilePath, 'source profile path', blockers);
  let sourceRealPath = sourceCandidate;

  if (trustedLegacyRoot && sourceCandidate) {
    if (!isContainedPath(trustedLegacyRoot, sourceCandidate) || samePath(trustedLegacyRoot, sourceCandidate)) {
      blockers.push('Source profile must be a child directory of the trusted legacy root.');
    } else {
      try {
        assertSafeExistingDirectoryChain(trustedLegacyRoot, sourceCandidate);
        sourceRealPath = fs.realpathSync.native(sourceCandidate);
      } catch (error) {
        blockers.push(`Source profile path is unsafe: ${errorMessage(error)}`);
      }
    }
  }
  if (trustedStoresRoot && sourceRealPath && isContainedPath(trustedStoresRoot, sourceRealPath)) {
    blockers.push('Source profile must not be inside the new trusted stores root.');
  }

  let capsule: StoreCapsulePaths | undefined;
  try {
    capsule = deriveStoreCapsulePaths(
      trustedStoresRoot,
      binding.storeId,
      binding.browserProfileId,
    );
  } catch (error) {
    blockers.push(`Target store capsule is invalid: ${errorMessage(error)}`);
  }
  const targetPath = capsule
    ? binding.provider === 'lingxing' ? capsule.lingxingProfileDir : capsule.amazonAdsProfileDir
    : path.join(trustedStoresRoot || path.parse(sourceCandidate || process.cwd()).root, 'invalid-target');

  let files: ProfileFileManifestEntry[] = [];
  let sourceFingerprint = '';
  let totalBytes = 0;
  if (blockers.length === 0) {
    try {
      files = inventoryProfile(sourceRealPath);
      if (files.length === 0) blockers.push('Source profile is empty; require a verified login before migration.');
      sourceFingerprint = fingerprintInventory(files);
      totalBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0);
    } catch (error) {
      blockers.push(`Source profile inventory failed: ${errorMessage(error)}`);
    }
  }

  const operationId = createHash('sha256').update(JSON.stringify({
    sourceRealPath: normalizePathForComparison(sourceRealPath),
    binding,
  })).digest('hex').slice(0, 24);
  let alreadyMigrated = false;

  if (blockers.length === 0 && fs.existsSync(targetPath)) {
    try {
      assertSafeExistingDirectoryChain(trustedStoresRoot, targetPath);
      const entries = fs.readdirSync(targetPath);
      if (entries.length > 0) {
        const published = readPublishedManifest(targetPath);
        const targetFiles = published
          ? inventoryProfile(targetPath, new Set([PROFILE_MIGRATION_MANIFEST]))
          : [];
        if (published
          && sameManifestBinding(published, sourceRealPath, sourceFingerprint, targetPath, binding)
          && sameInventory(published.files, files)
          && sameInventory(targetFiles, published.files)) {
          alreadyMigrated = true;
        } else {
          blockers.push('Target profile is non-empty and is not the same verified migration.');
        }
      }
    } catch (error) {
      blockers.push(`Target profile cannot be inspected: ${errorMessage(error)}`);
    }
  }

  if (blockers.length === 0 && fs.existsSync(trustedStoresRoot)) {
    try {
      assertSafeExistingDirectoryChain(trustedStoresRoot, trustedStoresRoot);
      const claim = readClaimIfPresent(claimPathFor(trustedStoresRoot, sourceRealPath, false));
      const pending = readClaimIfPresent(claimPathFor(trustedStoresRoot, sourceRealPath, true));
      if (claim && !sameManifestBinding(claim, sourceRealPath, sourceFingerprint, targetPath, binding)) {
        blockers.push('Source profile is already bound to a different store or provider.');
      }
      if (pending && !sameManifestBinding(pending, sourceRealPath, sourceFingerprint, targetPath, binding)) {
        blockers.push('Source profile has a pending migration to a different store or provider.');
      } else if (pending && !alreadyMigrated && !input.resumePending) {
        blockers.push('A matching profile migration is pending; explicit resumePending is required.');
      }
    } catch (error) {
      blockers.push(`Profile migration claim cannot be verified: ${errorMessage(error)}`);
    }
  }

  return {
    canMigrate: blockers.length === 0,
    alreadyMigrated,
    operationId,
    sourceRealPath,
    targetPath,
    sourceFingerprint,
    files,
    totalBytes,
    blockers,
  };
}

export function migrateLegacyStoreProfile(
  input: LegacyStoreProfileMigrationInput,
  hooks: StoreProfileMigrationHooks = {},
): StoreProfileMigrationResult {
  const preflight = preflightLegacyStoreProfileMigration(input);
  if (!preflight.canMigrate) {
    const pending = preflight.blockers.some((blocker) => /pending/i.test(blocker));
    throw new StoreProfileMigrationError(
      pending ? 'PROFILE_MIGRATION_PENDING' : 'PROFILE_MIGRATION_BLOCKED',
      preflight.blockers.join(' '),
    );
  }

  const binding = normalizeBinding(input.binding, []);
  const trustedStoresRoot = path.resolve(input.trustedStoresRoot);
  const targetPath = preflight.targetPath;
  const manifestPath = path.join(targetPath, PROFILE_MIGRATION_MANIFEST);
  const finalClaimPath = claimPathFor(trustedStoresRoot, preflight.sourceRealPath, false);
  const pendingClaimPath = claimPathFor(trustedStoresRoot, preflight.sourceRealPath, true);

  if (preflight.alreadyMigrated) {
    const existing = readPublishedManifest(targetPath);
    if (!existing) {
      throw new StoreProfileMigrationError('PROFILE_MIGRATION_BLOCKED', 'Published profile manifest is missing.');
    }
    ensureClaimDirectory(trustedStoresRoot);
    if (!fs.existsSync(finalClaimPath)) writeJsonExclusive(finalClaimPath, existing);
    if (fs.existsSync(pendingClaimPath)) fs.rmSync(pendingClaimPath);
    return {
      ...preflight,
      status: 'reused',
      manifestPath,
      claimPath: finalClaimPath,
    };
  }

  ensureClaimDirectory(trustedStoresRoot);
  const createdAt = new Date().toISOString();
  const pendingManifest: StoreProfileMigrationManifest = {
    kind: 'store-profile-migration',
    schemaVersion: 1,
    status: 'pending',
    operationId: preflight.operationId,
    sourceRealPath: preflight.sourceRealPath,
    sourceFingerprint: preflight.sourceFingerprint,
    targetPath,
    binding,
    createdAt,
    files: preflight.files,
    totalBytes: preflight.totalBytes,
  };

  if (fs.existsSync(pendingClaimPath)) {
    const pending = readClaimIfPresent(pendingClaimPath);
    if (!input.resumePending || !pending
      || !sameManifestBinding(
        pending,
        preflight.sourceRealPath,
        preflight.sourceFingerprint,
        targetPath,
        binding,
      )) {
      throw new StoreProfileMigrationError(
        'PROFILE_MIGRATION_PENDING',
        'A profile migration is already pending and cannot be resumed by this binding.',
      );
    }
  } else {
    writeJsonExclusive(pendingClaimPath, pendingManifest);
  }

  const targetParent = path.dirname(targetPath);
  ensureSafeDirectoryChain(trustedStoresRoot, targetParent);
  const stagePath = path.join(targetParent, `.${path.basename(targetPath)}.migration-${preflight.operationId}`);
  const emptyRollbackPath = path.join(targetParent, `.${path.basename(targetPath)}.empty-${preflight.operationId}`);
  let targetMovedAside = false;
  let published = false;
  let finalClaimCreated = false;
  try {
    if (fs.existsSync(stagePath)) fs.rmSync(stagePath, { recursive: true, force: true });
    if (fs.existsSync(emptyRollbackPath)) {
      throw new StoreProfileMigrationError(
        'PROFILE_MIGRATION_BLOCKED',
        `Profile migration rollback path already exists: ${emptyRollbackPath}`,
      );
    }
    copyProfileToStage(preflight.sourceRealPath, stagePath);
    const stagedFiles = inventoryProfile(stagePath);
    if (!sameInventory(stagedFiles, preflight.files)) {
      throw new StoreProfileMigrationError(
        'PROFILE_MIGRATION_COPY_FAILED',
        'Staged profile inventory does not match the source.',
      );
    }
    hooks.afterStageVerified?.();

    const publishedManifest: StoreProfileMigrationManifest = {
      ...pendingManifest,
      status: 'published',
      publishedAt: new Date().toISOString(),
    };
    writeJsonExclusive(path.join(stagePath, PROFILE_MIGRATION_MANIFEST), publishedManifest);

    if (fs.existsSync(targetPath)) {
      if (fs.readdirSync(targetPath).length > 0) {
        throw new StoreProfileMigrationError(
          'PROFILE_MIGRATION_BLOCKED',
          'Target profile became non-empty during migration.',
        );
      }
      fs.renameSync(targetPath, emptyRollbackPath);
      targetMovedAside = true;
    }
    fs.renameSync(stagePath, targetPath);
    published = true;
    writeJsonExclusive(finalClaimPath, publishedManifest);
    finalClaimCreated = true;
    fs.rmSync(pendingClaimPath);
    if (targetMovedAside) fs.rmSync(emptyRollbackPath, { recursive: true, force: true });
    return {
      ...preflight,
      status: 'published',
      manifestPath,
      claimPath: finalClaimPath,
    };
  } catch (error) {
    if (published && fs.existsSync(targetPath)) fs.rmSync(targetPath, { recursive: true, force: true });
    if (targetMovedAside && fs.existsSync(emptyRollbackPath) && !fs.existsSync(targetPath)) {
      fs.renameSync(emptyRollbackPath, targetPath);
    }
    if (fs.existsSync(stagePath)) fs.rmSync(stagePath, { recursive: true, force: true });
    if (fs.existsSync(pendingClaimPath)) fs.rmSync(pendingClaimPath);
    if (finalClaimCreated && fs.existsSync(finalClaimPath)) fs.rmSync(finalClaimPath);
    if (error instanceof StoreProfileMigrationError) throw error;
    throw new StoreProfileMigrationError('PROFILE_MIGRATION_COPY_FAILED', errorMessage(error));
  }
}

function normalizeBinding(
  value: StoreProfileIdentityBinding,
  blockers: string[],
): StoreProfileIdentityBinding {
  const provider = value?.provider;
  if (provider !== 'lingxing' && provider !== 'amazon_ads') blockers.push('Profile provider is invalid.');
  const externalAccountId = normalizeText(value?.externalAccountId);
  if (!externalAccountId || externalAccountId.length > 256) blockers.push('Verified external account id is required.');
  const identityProofSha256 = String(value?.identityProofSha256 ?? '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(identityProofSha256)) blockers.push('Identity proof SHA-256 is required.');
  const verifiedAt = String(value?.verifiedAt ?? '').trim();
  if (!verifiedAt || Number.isNaN(Date.parse(verifiedAt))) blockers.push('Identity verification timestamp is invalid.');
  return {
    storeId: String(value?.storeId ?? '').trim().toLowerCase(),
    browserProfileId: String(value?.browserProfileId ?? '').trim().toLowerCase(),
    provider: provider === 'amazon_ads' ? 'amazon_ads' : 'lingxing',
    externalAccountId,
    identityProofSha256,
    verifiedAt,
  };
}

function normalizeAbsolutePath(value: string, label: string, blockers: string[]): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim() || value.includes('\0')
    || !path.isAbsolute(value)) {
    blockers.push(`${label} must be an absolute Main-owned path.`);
    return '';
  }
  return path.resolve(value);
}

function inventoryProfile(
  rootPath: string,
  excludedRelativePaths: ReadonlySet<string> = new Set(),
): ProfileFileManifestEntry[] {
  const files: ProfileFileManifestEntry[] = [];
  walk(rootPath, '');
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));

  function walk(currentPath: string, relativeDirectory: string): void {
    for (const entry of fs.readdirSync(currentPath, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const entryPath = path.join(currentPath, entry.name);
      const relativePath = path.posix.join(relativeDirectory.split(path.sep).join('/'), entry.name);
      if (excludedRelativePaths.has(relativePath)) continue;
      const stat = fs.lstatSync(entryPath);
      if (stat.isSymbolicLink()) throw new Error(`symbolic link or junction is forbidden: ${relativePath}`);
      if (stat.isDirectory()) {
        walk(entryPath, relativePath);
      } else if (stat.isFile()) {
        files.push({ relativePath, sizeBytes: stat.size, sha256: hashFile(entryPath) });
      } else {
        throw new Error(`unsupported filesystem entry: ${relativePath}`);
      }
    }
  }
}

function copyProfileToStage(sourcePath: string, stagePath: string): void {
  fs.mkdirSync(stagePath);
  copyDirectory(sourcePath, stagePath);

  function copyDirectory(sourceDirectory: string, destinationDirectory: string): void {
    for (const entry of fs.readdirSync(sourceDirectory, { withFileTypes: true })) {
      const sourceEntry = path.join(sourceDirectory, entry.name);
      const destinationEntry = path.join(destinationDirectory, entry.name);
      const stat = fs.lstatSync(sourceEntry);
      if (stat.isSymbolicLink()) throw new Error(`symbolic link or junction is forbidden: ${sourceEntry}`);
      if (stat.isDirectory()) {
        fs.mkdirSync(destinationEntry);
        copyDirectory(sourceEntry, destinationEntry);
      } else if (stat.isFile()) {
        fs.copyFileSync(sourceEntry, destinationEntry, fs.constants.COPYFILE_EXCL);
      } else {
        throw new Error(`unsupported filesystem entry: ${sourceEntry}`);
      }
    }
  }
}

function ensureClaimDirectory(trustedStoresRoot: string): void {
  ensureSafeDirectoryChain(trustedStoresRoot, path.join(trustedStoresRoot, PROFILE_CLAIMS_DIRECTORY));
}

function ensureSafeDirectoryChain(rootPath: string, targetPath: string): void {
  const absoluteRoot = path.resolve(rootPath);
  if (!fs.existsSync(absoluteRoot)) fs.mkdirSync(absoluteRoot, { recursive: true });
  assertEntryIsSafeDirectory(absoluteRoot, absoluteRoot);
  if (!isContainedPath(absoluteRoot, targetPath)) throw new Error('directory target escapes the trusted stores root');
  let current = absoluteRoot;
  for (const component of path.relative(absoluteRoot, targetPath).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    if (!fs.existsSync(current)) fs.mkdirSync(current);
    assertEntryIsSafeDirectory(absoluteRoot, current);
  }
}

function assertSafeExistingDirectoryChain(rootPath: string, targetPath: string): void {
  const absoluteRoot = path.resolve(rootPath);
  const absoluteTarget = path.resolve(targetPath);
  if (!fs.existsSync(absoluteRoot) || !fs.existsSync(absoluteTarget)) throw new Error('path does not exist');
  if (!isContainedPath(absoluteRoot, absoluteTarget)) throw new Error('path escapes its trusted root');
  assertEntryIsSafeDirectory(absoluteRoot, absoluteRoot);
  let current = absoluteRoot;
  for (const component of path.relative(absoluteRoot, absoluteTarget).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    assertEntryIsSafeDirectory(absoluteRoot, current);
  }
}

function assertEntryIsSafeDirectory(canonicalRootInput: string, candidatePath: string): void {
  const stat = fs.lstatSync(candidatePath);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('path contains a symbolic link, junction, or non-directory');
  const canonicalRoot = fs.realpathSync.native(canonicalRootInput);
  const canonicalCandidate = fs.realpathSync.native(candidatePath);
  if (!isContainedPath(canonicalRoot, canonicalCandidate)) throw new Error('physical path escapes its trusted root');
}

function claimPathFor(trustedStoresRoot: string, sourceRealPath: string, pending: boolean): string {
  const sourceKey = createHash('sha256').update(normalizePathForComparison(sourceRealPath)).digest('hex');
  return path.join(
    path.resolve(trustedStoresRoot),
    PROFILE_CLAIMS_DIRECTORY,
    `${sourceKey}${pending ? '.pending' : ''}.json`,
  );
}

function readClaimIfPresent(filePath: string): StoreProfileMigrationManifest | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('profile migration claim is not a regular file');
  return parseManifest(fs.readFileSync(filePath, 'utf8'));
}

function readPublishedManifest(targetPath: string): StoreProfileMigrationManifest | undefined {
  const filePath = path.join(targetPath, PROFILE_MIGRATION_MANIFEST);
  if (!fs.existsSync(filePath)) return undefined;
  const manifest = readClaimIfPresent(filePath);
  return manifest?.status === 'published' ? manifest : undefined;
}

function parseManifest(text: string): StoreProfileMigrationManifest {
  const parsed = JSON.parse(text) as Partial<StoreProfileMigrationManifest>;
  if (parsed.kind !== 'store-profile-migration' || parsed.schemaVersion !== 1
    || (parsed.status !== 'pending' && parsed.status !== 'published')
    || !parsed.binding || !Array.isArray(parsed.files)) {
    throw new Error('unsupported profile migration manifest');
  }
  return parsed as StoreProfileMigrationManifest;
}

function sameManifestBinding(
  manifest: StoreProfileMigrationManifest,
  sourceRealPath: string,
  sourceFingerprint: string,
  targetPath: string,
  binding: StoreProfileIdentityBinding,
): boolean {
  return samePath(manifest.sourceRealPath, sourceRealPath)
    && manifest.sourceFingerprint === sourceFingerprint
    && samePath(manifest.targetPath, targetPath)
    && JSON.stringify(manifest.binding) === JSON.stringify(binding);
}

function sameInventory(left: ProfileFileManifestEntry[], right: ProfileFileManifestEntry[]): boolean {
  return fingerprintInventory(left) === fingerprintInventory(right);
}

function fingerprintInventory(files: ProfileFileManifestEntry[]): string {
  return createHash('sha256').update(JSON.stringify(
    [...files].sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
  )).digest('hex');
}

function hashFile(filePath: string): string {
  const hash = createHash('sha256');
  const handle = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(handle, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(handle);
  }
  return hash.digest('hex');
}

function writeJsonExclusive(filePath: string, value: unknown): void {
  const handle = fs.openSync(filePath, 'wx');
  try {
    fs.writeFileSync(handle, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
}

function isContainedPath(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function samePath(left: string, right: string): boolean {
  return normalizePathForComparison(left) === normalizePathForComparison(right);
}

function normalizePathForComparison(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

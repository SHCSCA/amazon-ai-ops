import fs from 'node:fs';
import path from 'node:path';
import {
  deriveStoreCapsulePaths,
  type StoreCapsulePaths,
} from '@amazon-ai-ops/browser-worker';

const DAY_MS = 24 * 60 * 60 * 1_000;
const RETENTION_ROOTS = ['screenshots', 'traces'] as const;

type RetentionRoot = (typeof RETENTION_ROOTS)[number];
type ReferenceSource = 'database' | 'authority' | 'caller';

export interface StoreEvidenceRetentionReference {
  readonly source: ReferenceSource;
  readonly absolutePath: string;
}

export interface BuildStoreEvidenceRetentionManifestInput {
  readonly capsule: StoreCapsulePaths;
  readonly evidenceRetentionDays: number;
  readonly now?: Date | string;
  readonly references?: readonly StoreEvidenceRetentionReference[];
  /** Main-only blockers discovered while projecting or resolving references. */
  readonly referenceBlockers?: readonly StoreEvidenceRetentionBlocker[];
  /** Convenience inputs for callers that already keep DB and Authority refs separately. */
  readonly databaseReferencedPaths?: readonly string[];
  readonly authorityReferencedPaths?: readonly string[];
  readonly referencedPaths?: readonly string[];
}

export interface StoreEvidenceRetentionCandidate {
  readonly root: RetentionRoot;
  readonly relativePath: string;
  readonly bytes: number;
  readonly modifiedAt: string;
  readonly reason: 'expired-unreferenced-ordinary-file';
}

export interface StoreEvidenceRetentionProtectedScope {
  readonly scope:
    | 'evidence'
    | 'reports'
    | 'downloads'
    | 'backups'
    | 'browser-profiles';
  readonly relativePath: string;
  readonly reason: 'out-of-scope-authority-artifact' | 'browser-profile-never-retained';
}

export interface StoreEvidenceRetentionProtectedFile {
  readonly root: RetentionRoot;
  readonly relativePath: string;
  readonly bytes: number;
  readonly modifiedAt: string;
  readonly reasons: readonly (
    | 'within-retention-window'
    | 'database-reference'
    | 'authority-reference'
    | 'caller-reference'
  )[];
}

export interface StoreEvidenceRetentionBlocker {
  readonly code:
    | 'INVALID_STORE_CAPSULE'
    | 'MISSING_CAPSULE_PATH'
    | 'PATH_ESCAPE'
    | 'CROSS_STORE_REFERENCE'
    | 'DATABASE_REFERENCE_OWNERSHIP_MISMATCH'
    | 'UNRESOLVED_ARTIFACT_REFERENCE'
    | 'MISSING_REFERENCE'
    | 'UNSAFE_LINK_OR_REPARSE_POINT'
    | 'HARD_LINKED_FILE'
    | 'UNSUPPORTED_FILESYSTEM_ENTRY'
    | 'FILESYSTEM_INSPECTION_FAILED';
  readonly relativePath: string;
  readonly detail: string;
}

export interface StoreEvidenceRetentionManifest {
  readonly schemaVersion: 1;
  readonly mode: 'dry-run';
  readonly deletionSupported: false;
  readonly generatedAt: string;
  readonly storeId: string;
  readonly profileId: string;
  readonly marketplace: 'US';
  readonly currency: 'USD';
  readonly retentionDays: number;
  readonly cutoffAt: string;
  readonly expiryBasis: 'mtime-before-cutoff';
  /** Compatibility field. Retention remains preview-only and can never apply. */
  readonly applyable: false;
  /** True only when the complete scan and reference projection have no blockers. */
  readonly scanSafe: boolean;
  readonly candidateCount: number;
  readonly candidateBytes: number;
  readonly candidates: readonly StoreEvidenceRetentionCandidate[];
  readonly blockers: readonly StoreEvidenceRetentionBlocker[];
  readonly protectedScopes: readonly StoreEvidenceRetentionProtectedScope[];
  readonly protectedFiles: readonly StoreEvidenceRetentionProtectedFile[];
}

interface ValidatedReference {
  readonly source: ReferenceSource;
  readonly realPath: string;
}

/**
 * Builds an audit-only retention proposal. This module intentionally exposes no
 * apply/delete function: a manifest can describe safe candidates, but cannot
 * mutate the Store Capsule.
 */
export function buildStoreEvidenceRetentionManifest(
  input: BuildStoreEvidenceRetentionManifestInput,
): StoreEvidenceRetentionManifest {
  const generatedAt = normalizeNow(input.now);
  const retentionDays = normalizeRetentionDays(input.evidenceRetentionDays);
  const cutoffMs = generatedAt.getTime() - (retentionDays * DAY_MS);
  const cutoffAt = new Date(cutoffMs).toISOString();
  const blockers: StoreEvidenceRetentionBlocker[] = [
    ...(input.referenceBlockers ?? []).map(sanitizeReferenceBlocker),
  ];
  const candidates: StoreEvidenceRetentionCandidate[] = [];
  const protectedFiles: StoreEvidenceRetentionProtectedFile[] = [];
  const capsule = canonicalCapsule(input.capsule, blockers);

  if (capsule && inspectCapsuleBoundary(capsule, blockers)) {
    const references = validateReferences(capsule, collectReferences(input), blockers);
    const referenceSources = indexReferenceSources(references);

    enumerateRetentionRoot(
      capsule,
      'screenshots',
      cutoffMs,
      referenceSources,
      candidates,
      protectedFiles,
      blockers,
    );
    enumerateRetentionRoot(
      capsule,
      'traces',
      cutoffMs,
      referenceSources,
      candidates,
      protectedFiles,
      blockers,
    );
  }

  candidates.sort((left, right) => stableCompare(left.relativePath, right.relativePath));
  protectedFiles.sort((left, right) => stableCompare(left.relativePath, right.relativePath));
  const uniqueBlockers = deduplicateAndSortBlockers(blockers);

  return Object.freeze({
    schemaVersion: 1,
    mode: 'dry-run',
    deletionSupported: false,
    generatedAt: generatedAt.toISOString(),
    storeId: String(input.capsule.storeId),
    profileId: String(input.capsule.browserProfileId),
    marketplace: 'US',
    currency: 'USD',
    retentionDays,
    cutoffAt,
    expiryBasis: 'mtime-before-cutoff',
    applyable: false,
    scanSafe: uniqueBlockers.length === 0,
    candidateCount: candidates.length,
    candidateBytes: candidates.reduce((total, candidate) => total + candidate.bytes, 0),
    candidates: Object.freeze(candidates),
    blockers: Object.freeze(uniqueBlockers),
    protectedScopes: Object.freeze(protectedScopes(input.capsule)),
    protectedFiles: Object.freeze(protectedFiles),
  });
}

function sanitizeReferenceBlocker(
  blocker: StoreEvidenceRetentionBlocker,
): StoreEvidenceRetentionBlocker {
  const relativePath = String(blocker.relativePath || '[database-reference]');
  return {
    code: blocker.code,
    relativePath: path.isAbsolute(relativePath)
      ? '[redacted-reference]'
      : toPortablePath(relativePath),
    detail: redactAbsolutePaths(String(blocker.detail || 'reference safety check failed')),
  };
}

function redactAbsolutePaths(value: string): string {
  return value
    .replace(/[A-Za-z]:[\\/][^\r\n]*/g, '[redacted local path]')
    .replace(/\\\\[^\\/\s]+[\\/][^\r\n]*/g, '[redacted local path]')
    .replace(/(?:^|\s)\/(?:[^/\s]+\/)+[^/\s]*/g, (match) => (
      match.startsWith(' ') ? ' [redacted local path]' : '[redacted local path]'
    ));
}

function normalizeNow(value: Date | string | undefined): Date {
  const result = value === undefined ? new Date() : new Date(value);
  if (!Number.isFinite(result.getTime())) throw new Error('retention manifest now must be a valid date');
  return result;
}

function normalizeRetentionDays(value: number): number {
  if (!Number.isInteger(value) || value < 30 || value > 3_650) {
    throw new Error('evidenceRetentionDays must be an integer between 30 and 3650');
  }
  return value;
}

function canonicalCapsule(
  input: StoreCapsulePaths,
  blockers: StoreEvidenceRetentionBlocker[],
): StoreCapsulePaths | null {
  let expected: StoreCapsulePaths;
  try {
    expected = deriveStoreCapsulePaths(
      input.trustedStoresRoot,
      input.storeId,
      input.browserProfileId,
    );
  } catch (error) {
    addBlocker(blockers, 'INVALID_STORE_CAPSULE', '.', errorMessage(error));
    return null;
  }
  const pathKeys: readonly (keyof StoreCapsulePaths)[] = [
    'trustedStoresRoot',
    'storeRoot',
    'lingxingProfileDir',
    'amazonAdsProfileDir',
    'downloadsDir',
    'reportsDir',
    'screenshotsDir',
    'tracesDir',
    'evidenceDir',
    'backupsDir',
  ];
  for (const key of pathKeys) {
    if (path.resolve(String(input[key])) !== path.resolve(String(expected[key]))) {
      addBlocker(blockers, 'INVALID_STORE_CAPSULE', String(key), 'capsule path differs from Main-derived path');
    }
  }
  return blockers.some((blocker) => blocker.code === 'INVALID_STORE_CAPSULE') ? null : expected;
}

function protectedScopes(capsule: StoreCapsulePaths): StoreEvidenceRetentionProtectedScope[] {
  return [
    { scope: 'evidence', relativePath: 'evidence', reason: 'out-of-scope-authority-artifact' },
    { scope: 'reports', relativePath: 'reports', reason: 'out-of-scope-authority-artifact' },
    { scope: 'downloads', relativePath: 'downloads', reason: 'out-of-scope-authority-artifact' },
    { scope: 'backups', relativePath: 'backups', reason: 'out-of-scope-authority-artifact' },
    {
      scope: 'browser-profiles',
      relativePath: toPortablePath(path.join('browser', String(capsule.browserProfileId))),
      reason: 'browser-profile-never-retained',
    },
  ];
}

function collectReferences(input: BuildStoreEvidenceRetentionManifestInput): StoreEvidenceRetentionReference[] {
  return [
    ...(input.references ?? []),
    ...(input.databaseReferencedPaths ?? []).map((absolutePath) => ({ source: 'database' as const, absolutePath })),
    ...(input.authorityReferencedPaths ?? []).map((absolutePath) => ({ source: 'authority' as const, absolutePath })),
    ...(input.referencedPaths ?? []).map((absolutePath) => ({ source: 'caller' as const, absolutePath })),
  ].sort((left, right) => (
    stableCompare(left.absolutePath, right.absolutePath)
    || stableCompare(left.source, right.source)
  ));
}

function validateReferences(
  capsule: StoreCapsulePaths,
  references: readonly StoreEvidenceRetentionReference[],
  blockers: StoreEvidenceRetentionBlocker[],
): ValidatedReference[] {
  const validated: ValidatedReference[] = [];
  for (const reference of references) {
    if (!path.isAbsolute(reference.absolutePath)) {
      addBlocker(blockers, 'PATH_ESCAPE', '[invalid-reference]', 'referenced path must be absolute');
      continue;
    }
    const resolved = path.resolve(reference.absolutePath);
    if (!isContained(capsule.storeRoot, resolved)) {
      const code = isContained(capsule.trustedStoresRoot, resolved)
        ? 'CROSS_STORE_REFERENCE'
        : 'PATH_ESCAPE';
      addBlocker(
        blockers,
        code,
        code === 'CROSS_STORE_REFERENCE' ? '[cross-store-reference]' : '[outside-store-reference]',
        'reference is outside the current store capsule',
      );
      continue;
    }
    const relativePath = auditPath(capsule.storeRoot, resolved);
    const result = inspectExistingPath(capsule.storeRoot, resolved, blockers, relativePath);
    if (!result) continue;
    if (!result.stat.isFile()) {
      addBlocker(blockers, 'UNSUPPORTED_FILESYSTEM_ENTRY', relativePath, 'reference must identify an ordinary file');
      continue;
    }
    if (result.stat.nlink > 1) {
      addBlocker(blockers, 'HARD_LINKED_FILE', relativePath, 'referenced file has more than one hard link');
      continue;
    }
    validated.push({ source: reference.source, realPath: result.realPath });
  }
  return validated;
}

function indexReferenceSources(
  references: readonly ValidatedReference[],
): ReadonlyMap<string, ReadonlySet<ReferenceSource>> {
  const index = new Map<string, Set<ReferenceSource>>();
  for (const reference of references) {
    const key = pathKey(reference.realPath);
    const sources = index.get(key) ?? new Set<ReferenceSource>();
    sources.add(reference.source);
    index.set(key, sources);
  }
  return index;
}

function inspectCapsuleBoundary(
  capsule: StoreCapsulePaths,
  blockers: StoreEvidenceRetentionBlocker[],
): boolean {
  const blockerCount = blockers.length;
  for (const candidate of [capsule.trustedStoresRoot, capsule.storeRoot]) {
    if (!requiredEntryExists(
      candidate,
      blockers,
      auditPath(capsule.trustedStoresRoot, candidate),
    )) continue;
    inspectExistingPath(candidate, candidate, blockers, auditPath(capsule.trustedStoresRoot, candidate));
  }
  return blockers.length === blockerCount;
}

function enumerateRetentionRoot(
  capsule: StoreCapsulePaths,
  root: RetentionRoot,
  cutoffMs: number,
  references: ReadonlyMap<string, ReadonlySet<ReferenceSource>>,
  candidates: StoreEvidenceRetentionCandidate[],
  protectedFiles: StoreEvidenceRetentionProtectedFile[],
  blockers: StoreEvidenceRetentionBlocker[],
): void {
  const rootPath = root === 'screenshots' ? capsule.screenshotsDir : capsule.tracesDir;
  if (!requiredEntryExists(rootPath, blockers, root)) return;
  const inspectedRoot = inspectExistingPath(capsule.storeRoot, rootPath, blockers, root);
  if (!inspectedRoot) return;
  if (!inspectedRoot.stat.isDirectory()) {
    addBlocker(blockers, 'UNSUPPORTED_FILESYSTEM_ENTRY', root, 'retention root is not a directory');
    return;
  }
  walk(rootPath);

  function walk(directory: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true })
        .sort((left, right) => stableCompare(left.name, right.name));
    } catch (error) {
      addBlocker(blockers, 'FILESYSTEM_INSPECTION_FAILED', auditPath(capsule.storeRoot, directory), filesystemErrorDetail(error));
      return;
    }
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = auditPath(capsule.storeRoot, absolutePath);
      const inspected = inspectExistingPath(capsule.storeRoot, absolutePath, blockers, relativePath);
      if (!inspected) continue;
      if (inspected.stat.isDirectory()) {
        walk(absolutePath);
        continue;
      }
      if (!inspected.stat.isFile()) {
        addBlocker(blockers, 'UNSUPPORTED_FILESYSTEM_ENTRY', relativePath, 'retention tree contains a non-file entry');
        continue;
      }
      if (inspected.stat.nlink > 1) {
        addBlocker(blockers, 'HARD_LINKED_FILE', relativePath, 'candidate file has more than one hard link');
        continue;
      }
      const referenceSources = references.get(pathKey(inspected.realPath));
      if (referenceSources && referenceSources.size > 0) {
        protectedFiles.push({
          root,
          relativePath,
          bytes: inspected.stat.size,
          modifiedAt: inspected.stat.mtime.toISOString(),
          reasons: Object.freeze([...referenceSources]
            .map((source) => `${source}-reference` as const)
            .sort(stableCompare)),
        });
        continue;
      }
      if (inspected.stat.mtimeMs >= cutoffMs) {
        protectedFiles.push({
          root,
          relativePath,
          bytes: inspected.stat.size,
          modifiedAt: inspected.stat.mtime.toISOString(),
          reasons: Object.freeze(['within-retention-window']),
        });
        continue;
      }
      candidates.push({
        root,
        relativePath,
        bytes: inspected.stat.size,
        modifiedAt: inspected.stat.mtime.toISOString(),
        reason: 'expired-unreferenced-ordinary-file',
      });
    }
  }
}

function inspectExistingPath(
  containmentRoot: string,
  target: string,
  blockers: StoreEvidenceRetentionBlocker[],
  relativePath: string,
): { stat: fs.Stats; realPath: string } | null {
  if (!isContained(containmentRoot, target)) {
    addBlocker(blockers, 'PATH_ESCAPE', relativePath, 'path is outside its declared containment root');
    return null;
  }
  const chain = [
    containmentRoot,
    ...path.relative(containmentRoot, target).split(path.sep).filter(Boolean)
      .reduce<string[]>((paths, component) => {
        paths.push(path.join(paths.at(-1) ?? containmentRoot, component));
        return paths;
      }, []),
  ];
  for (const chainEntry of chain) {
    let chainStat: fs.Stats;
    try {
      chainStat = fs.lstatSync(chainEntry);
    } catch (error) {
      if (chainEntry === target && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        addBlocker(blockers, 'MISSING_REFERENCE', relativePath, 'referenced file does not exist');
      } else {
        addBlocker(blockers, 'FILESYSTEM_INSPECTION_FAILED', relativePath, filesystemErrorDetail(error));
      }
      return null;
    }
    if (chainStat.isSymbolicLink()) {
      addBlocker(blockers, 'UNSAFE_LINK_OR_REPARSE_POINT', relativePath, 'symbolic links and junctions are never followed');
      return null;
    }
  }

  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      addBlocker(blockers, 'MISSING_REFERENCE', relativePath, 'referenced file does not exist');
    } else {
      addBlocker(blockers, 'FILESYSTEM_INSPECTION_FAILED', relativePath, filesystemErrorDetail(error));
    }
    return null;
  }
  let realRoot: string;
  let realPath: string;
  try {
    realRoot = fs.realpathSync.native(containmentRoot);
    realPath = fs.realpathSync.native(target);
  } catch (error) {
    addBlocker(blockers, 'FILESYSTEM_INSPECTION_FAILED', relativePath, filesystemErrorDetail(error));
    return null;
  }
  if (!isContained(realRoot, realPath)) {
    addBlocker(blockers, 'UNSAFE_LINK_OR_REPARSE_POINT', relativePath, 'physical path escapes the store capsule');
    return null;
  }
  const logicalRelative = comparableRelative(path.relative(containmentRoot, target));
  const physicalRelative = comparableRelative(path.relative(realRoot, realPath));
  if (logicalRelative !== physicalRelative) {
    addBlocker(blockers, 'UNSAFE_LINK_OR_REPARSE_POINT', relativePath, 'physical path differs from the declared capsule path');
    return null;
  }
  return { stat, realPath };
}

function isContained(rootInput: string, candidateInput: string): boolean {
  const root = path.resolve(rootInput);
  const candidate = path.resolve(candidateInput);
  const relative = path.relative(root, candidate);
  return relative === '' || (
    relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

function requiredEntryExists(
  candidate: string,
  blockers: StoreEvidenceRetentionBlocker[],
  relativePath: string,
): boolean {
  try {
    fs.lstatSync(candidate);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      addBlocker(blockers, 'MISSING_CAPSULE_PATH', relativePath, 'required Store Capsule path does not exist');
    } else {
      addBlocker(blockers, 'FILESYSTEM_INSPECTION_FAILED', relativePath, filesystemErrorDetail(error));
    }
    return false;
  }
}

function addBlocker(
  blockers: StoreEvidenceRetentionBlocker[],
  code: StoreEvidenceRetentionBlocker['code'],
  relativePath: string,
  detail: string,
): void {
  blockers.push({ code, relativePath: toPortablePath(relativePath), detail });
}

function deduplicateAndSortBlockers(
  blockers: readonly StoreEvidenceRetentionBlocker[],
): StoreEvidenceRetentionBlocker[] {
  const unique = new Map<string, StoreEvidenceRetentionBlocker>();
  for (const blocker of blockers) {
    unique.set(`${blocker.code}\0${blocker.relativePath}\0${blocker.detail}`, blocker);
  }
  return [...unique.values()].sort((left, right) => (
    stableCompare(left.relativePath, right.relativePath)
    || stableCompare(left.code, right.code)
    || stableCompare(left.detail, right.detail)
  ));
}

function auditPath(root: string, candidate: string): string {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return toPortablePath(relative || '.');
}

function toPortablePath(value: string): string {
  return value.split(path.sep).join('/');
}

function pathKey(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function comparableRelative(value: string): string {
  const portable = toPortablePath(value);
  return process.platform === 'win32' ? portable.toLowerCase() : portable;
}

function stableCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function filesystemErrorDetail(error: unknown): string {
  const code = typeof error === 'object' && error
    ? (error as NodeJS.ErrnoException).code
    : undefined;
  return code ? `filesystem inspection failed (${code})` : 'filesystem inspection failed';
}

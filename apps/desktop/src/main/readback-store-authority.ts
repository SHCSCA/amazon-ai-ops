import * as fs from 'fs';
import * as path from 'path';
import {
  resolveStoreCapsulePath,
  type StoreCapsulePaths,
} from '@amazon-ai-ops/browser-worker';
import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';

export interface ReadbackStoreBinding {
  storeId: string;
  browserProfileId: string;
  sessionGeneration: number;
}

export interface StoreScopedReadbackAccess {
  readonly capsule: StoreCapsulePaths;
  readonly binding: ReadbackStoreBinding;
  readonly rootDir: string;
  readonly candidatesDir: string;
  readonly sessionsDir: string;
  readonly capturesDir: string;
}

export type ReadbackReferenceRoot = 'root' | 'candidates' | 'sessions' | 'captures';

const READBACK_PATH_SEGMENTS = ['evidence', 'ad-readback'] as const;

function bindingFromContext(context: StoreContextEnvelope): ReadbackStoreBinding {
  return Object.freeze({
    storeId: String(context.storeId),
    browserProfileId: String(context.browserProfileId),
    sessionGeneration: context.sessionGeneration,
  });
}

function isInside(childPath: string, parentPath: string): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function pathExists(candidate: string): boolean {
  try {
    fs.lstatSync(candidate);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function assertDirectoryChainSafe(rootDir: string, targetDir: string): void {
  if (!isInside(targetDir, rootDir)) {
    throw new Error('READBACK_PATH_OUTSIDE_STORE_CAPSULE: path is outside the current store readback capsule.');
  }
  let current = path.resolve(rootDir);
  const relative = path.relative(current, path.resolve(targetDir));
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!pathExists(current)) fs.mkdirSync(current);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error('READBACK_UNSAFE_FILESYSTEM_ENTRY: readback paths must not traverse links or files.');
    }
  }
}

function referenceBase(access: StoreScopedReadbackAccess, root: ReadbackReferenceRoot): string {
  if (root === 'candidates') return access.candidatesDir;
  if (root === 'sessions') return access.sessionsDir;
  if (root === 'captures') return access.capturesDir;
  return access.rootDir;
}

function readbackSegmentsFor(root: ReadbackReferenceRoot, relativeSegments: string[]): string[] {
  const prefix = root === 'root' ? [] : [root];
  return [...READBACK_PATH_SEGMENTS, ...prefix, ...relativeSegments];
}

function normalizeReferenceSegments(baseDir: string, value: unknown): string[] {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
    throw new Error('READBACK_REFERENCE_INVALID: a non-empty readback artifact reference is required.');
  }
  const raw = value.trim();
  let relative = raw;
  if (path.isAbsolute(raw) || path.win32.isAbsolute(raw) || path.posix.isAbsolute(raw)) {
    relative = path.relative(path.resolve(baseDir), path.resolve(raw));
  }
  if (!relative || path.isAbsolute(relative) || path.win32.isAbsolute(relative) || path.posix.isAbsolute(relative)) {
    throw new Error('READBACK_REFERENCE_INVALID: readback references must identify an artifact below the current store capsule.');
  }
  const segments = relative.split(/[\\/]+/).filter(Boolean);
  if (
    segments.length === 0
    || segments.some((segment) => segment === '.' || segment === '..' || segment.includes(':'))
  ) {
    throw new Error('READBACK_PATH_TRAVERSAL: readback references must not contain traversal or absolute path syntax.');
  }
  return segments;
}

export function createStoreScopedReadbackAccess(
  context: StoreContextEnvelope,
  capsule: StoreCapsulePaths,
): StoreScopedReadbackAccess {
  const binding = bindingFromContext(context);
  if (
    String(capsule.storeId) !== binding.storeId
    || String(capsule.browserProfileId) !== binding.browserProfileId
  ) {
    throw new Error('READBACK_STORE_CAPSULE_MISMATCH: StoreContext does not own the supplied store capsule.');
  }
  const rootDir = resolveStoreCapsulePath(capsule, ...READBACK_PATH_SEGMENTS);
  return Object.freeze({
    capsule,
    binding,
    rootDir,
    candidatesDir: resolveStoreCapsulePath(capsule, ...READBACK_PATH_SEGMENTS, 'candidates'),
    sessionsDir: resolveStoreCapsulePath(capsule, ...READBACK_PATH_SEGMENTS, 'sessions'),
    capturesDir: resolveStoreCapsulePath(capsule, ...READBACK_PATH_SEGMENTS, 'captures'),
  });
}

export function ensureStoreScopedReadbackDirectories(access: StoreScopedReadbackAccess): void {
  assertDirectoryChainSafe(access.capsule.storeRoot, access.rootDir);
  assertDirectoryChainSafe(access.capsule.storeRoot, access.candidatesDir);
  assertDirectoryChainSafe(access.capsule.storeRoot, access.sessionsDir);
  assertDirectoryChainSafe(access.capsule.storeRoot, access.capturesDir);
}

/**
 * Renderer-provided absolute paths are compatibility aliases only. They are
 * reduced to a relative reference below the current store root and then
 * re-derived from Main-owned capsule paths before any filesystem access.
 */
export function resolveStoreScopedReadbackReference(
  access: StoreScopedReadbackAccess,
  value: unknown,
  root: ReadbackReferenceRoot,
): string {
  const baseDir = referenceBase(access, root);
  const segments = normalizeReferenceSegments(baseDir, value);
  const resolved = resolveStoreCapsulePath(
    access.capsule,
    ...readbackSegmentsFor(root, segments),
  );
  if (!isInside(resolved, baseDir)) {
    throw new Error('READBACK_PATH_OUTSIDE_STORE_CAPSULE: path is outside the current store readback capsule.');
  }
  return resolved;
}

export function ensureStoreScopedReadbackDirectory(
  access: StoreScopedReadbackAccess,
  directory: string,
): void {
  if (!isInside(directory, access.rootDir)) {
    throw new Error('READBACK_PATH_OUTSIDE_STORE_CAPSULE: directory is outside the current store readback capsule.');
  }
  assertDirectoryChainSafe(access.capsule.storeRoot, directory);
}

export function assertReadbackStoreBinding(
  actual: unknown,
  access: StoreScopedReadbackAccess,
): ReadbackStoreBinding {
  if (!actual || typeof actual !== 'object') {
    throw new Error('READBACK_STORE_BINDING_MISSING: readback artifact is not bound to a store session.');
  }
  const value = actual as Record<string, unknown>;
  if (
    value.storeId !== access.binding.storeId
    || value.browserProfileId !== access.binding.browserProfileId
    || value.sessionGeneration !== access.binding.sessionGeneration
  ) {
    throw new Error('READBACK_STORE_BINDING_MISMATCH: readback artifact belongs to another store, profile, or session generation.');
  }
  return access.binding;
}

export function isReadbackStoreSecurityError(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code || '')
    : '';
  if ([
    'PATH_OUTSIDE_STORE_CAPSULE',
    'REAL_PATH_OUTSIDE_STORE_CAPSULE',
    'UNSAFE_FILESYSTEM_ENTRY',
    'UNSAFE_RELATIVE_PATH',
  ].includes(code)) return true;
  const message = error instanceof Error ? error.message : String(error || '');
  return [
    'READBACK_STORE_BINDING_MISMATCH',
    'READBACK_PATH_OUTSIDE_STORE_CAPSULE',
    'READBACK_PATH_TRAVERSAL',
    'READBACK_UNSAFE_FILESYSTEM_ENTRY',
    'READBACK_STORE_CAPSULE_MISMATCH',
    'READBACK_STORE_ARTIFACT_PATH_MISMATCH',
    'READBACK_SESSION_ARTIFACT_PATH_MISMATCH',
    'READBACK_SESSION_PATH_MISMATCH',
    'READBACK_SOURCE_PATH_MISMATCH',
  ].some((marker) => message.includes(marker));
}

export function assertPathInsideStoreCapsule(
  access: StoreScopedReadbackAccess,
  value: unknown,
): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('READBACK_STORE_ARTIFACT_PATH_INVALID: a store artifact path is required.');
  }
  const resolved = path.resolve(value.trim());
  if (!isInside(resolved, access.capsule.storeRoot)) {
    throw new Error('READBACK_STORE_ARTIFACT_PATH_MISMATCH: referenced artifact is outside the current store capsule.');
  }
  const relative = path.relative(access.capsule.storeRoot, resolved).split(path.sep).filter(Boolean);
  return resolveStoreCapsulePath(access.capsule, ...relative);
}

export function assertPathInsideReadbackRoot(
  access: StoreScopedReadbackAccess,
  value: unknown,
): string {
  return resolveStoreScopedReadbackReference(access, value, 'root');
}

export function assertPathInsideReadbackSession(sessionDir: string, value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('READBACK_SESSION_ARTIFACT_PATH_INVALID: a session artifact path is required.');
  }
  const resolved = path.resolve(value.trim());
  if (!isInside(resolved, sessionDir)) {
    throw new Error('READBACK_SESSION_ARTIFACT_PATH_MISMATCH: evidence path is outside the current readback session.');
  }
  return resolved;
}

export function withReadbackStoreBinding<T extends Record<string, unknown>>(
  value: T,
  access: StoreScopedReadbackAccess,
): T & { storeBinding: ReadbackStoreBinding } {
  return {
    ...value,
    storeBinding: { ...access.binding },
  };
}

function optionalPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || /<[^>]+>/.test(trimmed)) return null;
  return trimmed;
}

/** Validate every path that the evidence builder/verifier may inspect. */
export function assertStoreScopedReadbackEvidenceData(
  value: unknown,
  access: StoreScopedReadbackAccess,
  options: { requireBinding: boolean },
): void {
  if (!value || typeof value !== 'object') {
    throw new Error('READBACK_EVIDENCE_INVALID: readback evidence must be an object.');
  }
  const evidence = value as Record<string, any>;
  if (options.requireBinding) assertReadbackStoreBinding(evidence.storeBinding, access);

  const identityProofPath = optionalPath(evidence.target?.identityProofPath);
  if (identityProofPath) assertPathInsideStoreCapsule(access, identityProofPath);

  const sourceEvidencePath = optionalPath(evidence.source?.evidencePath);
  if (sourceEvidencePath) assertPathInsideStoreCapsule(access, sourceEvidencePath);
  const sourceFiles = Array.isArray(evidence.source?.sourceFiles)
    ? evidence.source.sourceFiles
    : [];
  for (const sourceFile of sourceFiles) {
    const filePath = optionalPath(sourceFile);
    if (filePath) assertPathInsideStoreCapsule(access, filePath);
  }

  const tracePath = optionalPath(evidence.tracePath);
  if (tracePath) assertPathInsideStoreCapsule(access, tracePath);

  const readbackArtifactPaths = [
    evidence.approval?.approvalArtifactPath,
    evidence.before?.screenshotPath,
    evidence.after?.screenshotPath,
    evidence.readback?.evidencePath,
    evidence.readback?.screenshotPath,
  ];
  for (const artifact of readbackArtifactPaths) {
    const artifactPath = optionalPath(artifact);
    if (artifactPath) assertPathInsideReadbackRoot(access, artifactPath);
  }
}

export function readStoreScopedReadbackEvidenceFile(
  access: StoreScopedReadbackAccess,
  value: unknown,
  root: ReadbackReferenceRoot = 'root',
): { filePath: string; payload: Record<string, any> } {
  const filePath = resolveStoreScopedReadbackReference(access, value, root);
  const payload = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, any>;
  assertStoreScopedReadbackEvidenceData(payload, access, { requireBinding: true });
  return { filePath, payload };
}

export function latestStoreScopedReadbackCandidate(
  access: StoreScopedReadbackAccess,
): string | null {
  if (!pathExists(access.candidatesDir)) return null;
  const candidates = fs.readdirSync(access.candidatesDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^real-ad-execution-readback-.*\.json$/i.test(entry.name))
    .map((entry) => resolveStoreScopedReadbackReference(access, entry.name, 'candidates'))
    .map((filePath) => {
      try {
        readStoreScopedReadbackEvidenceFile(access, filePath, 'candidates');
        return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
      } catch (error) {
        if (isReadbackStoreSecurityError(error)) throw error;
        return null;
      }
    })
    .filter((item): item is { filePath: string; mtimeMs: number } => Boolean(item))
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  return candidates[0]?.filePath ?? null;
}

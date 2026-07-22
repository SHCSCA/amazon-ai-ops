import * as path from 'path';
import type { StoreCapsulePaths } from './store-profile';
import {
  assertPathContained,
  resolveStoreCapsulePath,
} from './store-profile';

export interface StoreCapsuleDownloadTarget {
  readonly filename: string;
  readonly path: string;
}

export class StoreCapsuleDownloadPathError extends Error {
  constructor(
    readonly code:
      | 'DOWNLOAD_FILENAME_INVALID'
      | 'DOWNLOAD_FILENAME_PATH_ESCAPE'
      | 'DOWNLOAD_FILENAME_TOO_LONG'
      | 'DOWNLOAD_TARGET_DIRECTORY_INVALID'
      | 'DOWNLOAD_TARGET_DIRECTORY_OUTSIDE_CAPSULE',
    message: string,
  ) {
    super(message);
    this.name = 'StoreCapsuleDownloadPathError';
  }
}

/**
 * Treat the browser-provided suggestedFilename as untrusted. Path-shaped names
 * are rejected; harmless Windows-invalid characters are replaced so the
 * returned filename is one canonical component inside this store's downloads.
 */
export function sanitizeSuggestedDownloadFilename(value: unknown): string {
  if (typeof value !== 'string') {
    throw new StoreCapsuleDownloadPathError(
      'DOWNLOAD_FILENAME_INVALID',
      'suggested download filename must be a string',
    );
  }
  const normalized = value.normalize('NFKC').trim();
  if (
    normalized.length === 0
    || normalized.includes('\0')
    || normalized === '.'
    || normalized === '..'
  ) {
    throw new StoreCapsuleDownloadPathError(
      'DOWNLOAD_FILENAME_INVALID',
      'suggested download filename is empty or invalid',
    );
  }
  if (
    /[\\/]/.test(normalized)
    || /^[a-z]:/i.test(normalized)
    || path.isAbsolute(normalized)
    || path.win32.isAbsolute(normalized)
    || path.posix.isAbsolute(normalized)
  ) {
    throw new StoreCapsuleDownloadPathError(
      'DOWNLOAD_FILENAME_PATH_ESCAPE',
      'suggested download filename must not contain a path',
    );
  }
  if (normalized.length > 200) {
    throw new StoreCapsuleDownloadPathError(
      'DOWNLOAD_FILENAME_TOO_LONG',
      'suggested download filename exceeds 200 characters',
    );
  }

  let filename = normalized
    .replace(/[<>:"|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
  if (!filename || filename === '.' || filename === '..') {
    throw new StoreCapsuleDownloadPathError(
      'DOWNLOAD_FILENAME_INVALID',
      'suggested download filename is empty after sanitization',
    );
  }
  if (/^(?:con|prn|aux|nul|clock\$|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(filename)) {
    filename = `_${filename}`;
  }
  return filename;
}

export function resolveStoreCapsuleDownloadTarget(
  paths: Pick<
    StoreCapsulePaths,
    'browserProfileId' | 'storeId' | 'storeRoot' | 'trustedStoresRoot'
  >,
  suggestedFilename: unknown,
  targetDirectory?: string,
): StoreCapsuleDownloadTarget {
  const filename = sanitizeSuggestedDownloadFilename(suggestedFilename);
  const downloadsDir = resolveStoreCapsulePath(paths, 'downloads');
  const targetSegments = resolveDownloadTargetDirectorySegments(downloadsDir, targetDirectory);
  const targetPath = resolveStoreCapsulePath(paths, 'downloads', ...targetSegments, filename);
  const containedTargetDirectory = resolveStoreCapsulePath(paths, 'downloads', ...targetSegments);
  assertPathContained(containedTargetDirectory, targetPath);
  return Object.freeze({ filename, path: targetPath });
}

function resolveDownloadTargetDirectorySegments(
  downloadsDir: string,
  targetDirectory: string | undefined,
): string[] {
  if (targetDirectory === undefined) return [];
  if (
    typeof targetDirectory !== 'string'
    || targetDirectory.length === 0
    || targetDirectory !== targetDirectory.trim()
    || targetDirectory.includes('\0')
    || !path.isAbsolute(targetDirectory)
  ) {
    throw new StoreCapsuleDownloadPathError(
      'DOWNLOAD_TARGET_DIRECTORY_INVALID',
      'download target directory must be a canonical absolute path',
    );
  }
  const resolvedTarget = path.resolve(targetDirectory);
  try {
    assertPathContained(downloadsDir, resolvedTarget);
  } catch {
    throw new StoreCapsuleDownloadPathError(
      'DOWNLOAD_TARGET_DIRECTORY_OUTSIDE_CAPSULE',
      'download target directory must stay inside the store downloads capsule',
    );
  }
  const relative = path.relative(downloadsDir, resolvedTarget);
  if (!relative) return [];
  if (path.isAbsolute(relative) || relative.split(path.sep).some((segment) => segment === '..')) {
    throw new StoreCapsuleDownloadPathError(
      'DOWNLOAD_TARGET_DIRECTORY_OUTSIDE_CAPSULE',
      'download target directory escaped the store downloads capsule',
    );
  }
  return relative.split(path.sep).filter(Boolean);
}

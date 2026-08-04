import * as fs from 'fs';
import * as path from 'path';
import {
  assertPathInsideReadbackSession,
  assertReadbackStoreBinding,
  ensureStoreScopedReadbackDirectory,
  resolveStoreScopedReadbackReference,
  type StoreScopedReadbackAccess,
} from './readback-store-authority';

export type ReadbackCaptureSlot = 'approval' | 'before' | 'after' | 'readback';

export interface SaveReadbackCaptureInput {
  slot: ReadbackCaptureSlot;
  dataUrl: string;
  fileName?: string;
  sessionDir?: string;
  fallbackRootDir: string;
  storeAccess?: StoreScopedReadbackAccess;
  now?: Date;
}

export interface SavedReadbackCapture {
  slot: ReadbackCaptureSlot;
  filePath: string;
  directory: string;
  mimeType: string;
  byteLength: number;
  savedAt: string;
}

const SLOT_DIR_KEYS: Record<ReadbackCaptureSlot, string> = {
  approval: 'approvalsDir',
  before: 'beforeScreenshotsDir',
  after: 'afterScreenshotsDir',
  readback: 'readbackScreenshotsDir',
};

const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
};

const SESSION_INPUT_PATCH: Record<ReadbackCaptureSlot, { pathField: string; timeField: string }> = {
  approval: { pathField: 'approvalArtifactPath', timeField: 'approvalConfirmedAt' },
  before: { pathField: 'beforeScreenshotPath', timeField: 'beforeCapturedAt' },
  after: { pathField: 'afterScreenshotPath', timeField: 'afterCapturedAt' },
  readback: { pathField: 'readbackEvidencePath', timeField: 'readbackReadAt' },
};

function isInside(childPath: string, parentPath: string): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function parseDataUrl(dataUrl: string): { mimeType: string; buffer: Buffer } {
  const match = String(dataUrl || '').match(/^data:([^;,]+);base64,([a-z0-9+/=\r\n]+)$/i);
  if (!match) {
    throw new Error('Clipboard payload must be a base64 data URL.');
  }
  const mimeType = match[1].toLowerCase();
  if (!MIME_EXTENSIONS[mimeType]) {
    throw new Error(`Only image clipboard payloads are supported; received ${mimeType}.`);
  }
  const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  if (!buffer.length) {
    throw new Error('Clipboard image payload is empty.');
  }
  return { mimeType, buffer };
}

function safeStem(value: string): string {
  const stem = path.basename(value || '', path.extname(value || ''))
    .replace(/[^a-z0-9\u4e00-\u9fa5._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return stem || 'capture';
}

function timestampForFile(savedAt: string): string {
  return savedAt.replace(/[:.]/g, '-');
}

function readSessionPaths(sessionDir: string): Record<string, any> {
  const resolvedSessionDir = path.resolve(sessionDir);
  const pathsFile = path.join(resolvedSessionDir, 'session-paths.json');
  if (!fs.existsSync(pathsFile)) {
    throw new Error(`Readback session paths not found: ${pathsFile}`);
  }
  return JSON.parse(fs.readFileSync(pathsFile, 'utf8')) as Record<string, unknown>;
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function resolveTargetDirectory(input: SaveReadbackCaptureInput): { targetDir: string; sessionDir?: string } {
  if (input.sessionDir?.trim()) {
    const sessionDir = input.storeAccess
      ? resolveStoreScopedReadbackReference(input.storeAccess, input.sessionDir, 'sessions')
      : path.resolve(input.sessionDir);
    const paths = readSessionPaths(sessionDir);
    if (input.storeAccess) {
      assertReadbackStoreBinding(paths.storeBinding, input.storeAccess);
      if (!samePath(String(paths.sessionDir || ''), sessionDir)) {
        throw new Error('READBACK_SESSION_PATH_MISMATCH: capture session manifest does not match the current session.');
      }
    }
    const dir = path.resolve(String(paths[SLOT_DIR_KEYS[input.slot]] || ''));
    if (!dir || !isInside(dir, sessionDir)) {
      throw new Error(`Refusing to write ${input.slot} evidence outside the readback session.`);
    }
    if (input.storeAccess) {
      const expected = input.slot === 'approval'
        ? path.join(sessionDir, 'approvals')
        : path.join(sessionDir, 'screenshots', input.slot);
      const canonical = resolveStoreScopedReadbackReference(input.storeAccess, dir, 'root');
      if (!samePath(canonical, expected) || !samePath(dir, expected)) {
        throw new Error(`READBACK_SESSION_PATH_MISMATCH: ${input.slot} capture directory is not Main-derived.`);
      }
    }
    return { targetDir: dir, sessionDir };
  }
  const targetDir = input.storeAccess
    ? resolveStoreScopedReadbackReference(input.storeAccess, input.slot, 'captures')
    : path.join(path.resolve(input.fallbackRootDir), input.slot);
  return { targetDir };
}

function updateSessionInputIfPresent(
  input: SaveReadbackCaptureInput,
  sessionDir: string | undefined,
  filePath: string,
  savedAt: string,
): void {
  if (!sessionDir) return;
  const sessionInputPath = path.join(sessionDir, 'session-input.json');
  if (input.storeAccess) {
    assertPathInsideReadbackSession(sessionDir, sessionInputPath);
    resolveStoreScopedReadbackReference(input.storeAccess, sessionInputPath, 'root');
  }
  if (!fs.existsSync(sessionInputPath)) return;
  const parsed = JSON.parse(fs.readFileSync(sessionInputPath, 'utf8')) as Record<string, unknown>;
  const patch = SESSION_INPUT_PATCH[input.slot];
  parsed[patch.pathField] = filePath;
  parsed[patch.timeField] = savedAt;
  fs.writeFileSync(sessionInputPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
}

export function saveReadbackCaptureFile(input: SaveReadbackCaptureInput): SavedReadbackCapture {
  const { mimeType, buffer } = parseDataUrl(input.dataUrl);
  const savedAt = (input.now || new Date()).toISOString();
  const target = resolveTargetDirectory(input);
  const targetDir = target.targetDir;
  if (input.storeAccess) {
    ensureStoreScopedReadbackDirectory(input.storeAccess, targetDir);
  } else {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  const extension = MIME_EXTENSIONS[mimeType];
  const fileName = `${input.slot}-${timestampForFile(savedAt)}-${safeStem(input.fileName || '')}${extension}`;
  const filePath = path.join(targetDir, fileName);
  fs.writeFileSync(filePath, buffer);
  updateSessionInputIfPresent(input, target.sessionDir, filePath, savedAt);
  return {
    slot: input.slot,
    filePath,
    directory: targetDir,
    mimeType,
    byteLength: buffer.length,
    savedAt,
  };
}

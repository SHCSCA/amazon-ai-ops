import * as fs from 'fs';
import * as path from 'path';

export type ReadbackCaptureSlot = 'approval' | 'before' | 'after' | 'readback';

export interface SaveReadbackCaptureInput {
  slot: ReadbackCaptureSlot;
  dataUrl: string;
  fileName?: string;
  sessionDir?: string;
  fallbackRootDir: string;
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

function readSessionPaths(sessionDir: string): Record<string, string> {
  const resolvedSessionDir = path.resolve(sessionDir);
  const pathsFile = path.join(resolvedSessionDir, 'session-paths.json');
  if (!fs.existsSync(pathsFile)) {
    throw new Error(`Readback session paths not found: ${pathsFile}`);
  }
  const parsed = JSON.parse(fs.readFileSync(pathsFile, 'utf8')) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value || '')]));
}

function resolveTargetDirectory(input: SaveReadbackCaptureInput): string {
  if (input.sessionDir?.trim()) {
    const sessionDir = path.resolve(input.sessionDir);
    const paths = readSessionPaths(sessionDir);
    const dir = path.resolve(paths[SLOT_DIR_KEYS[input.slot]] || '');
    if (!dir || !isInside(dir, sessionDir)) {
      throw new Error(`Refusing to write ${input.slot} evidence outside the readback session.`);
    }
    return dir;
  }
  return path.join(path.resolve(input.fallbackRootDir), input.slot);
}

function updateSessionInputIfPresent(input: SaveReadbackCaptureInput, filePath: string, savedAt: string): void {
  if (!input.sessionDir?.trim()) return;
  const sessionInputPath = path.join(path.resolve(input.sessionDir), 'session-input.json');
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
  const targetDir = resolveTargetDirectory(input);
  fs.mkdirSync(targetDir, { recursive: true });
  const extension = MIME_EXTENSIONS[mimeType];
  const fileName = `${input.slot}-${timestampForFile(savedAt)}-${safeStem(input.fileName || '')}${extension}`;
  const filePath = path.join(targetDir, fileName);
  fs.writeFileSync(filePath, buffer);
  updateSessionInputIfPresent(input, filePath, savedAt);
  return {
    slot: input.slot,
    filePath,
    directory: targetDir,
    mimeType,
    byteLength: buffer.length,
    savedAt,
  };
}

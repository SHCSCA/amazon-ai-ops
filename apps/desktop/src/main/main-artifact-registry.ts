import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type MainArtifactKind =
  | 'report-file'
  | 'report-folder'
  | 'manifest'
  | 'diagnostic-file'
  | 'diagnostic-folder'
  | 'export-file'
  | 'export-folder';

export interface MainArtifactDescriptor {
  artifactId: string;
  kind: MainArtifactKind;
  displayName: string;
}

interface MainArtifactRecord extends MainArtifactDescriptor {
  storeId: string;
  realPath: string;
  issuedRoot: string;
}

export interface MainArtifactRegistryOptions {
  createId?: () => string;
}

const ARTIFACT_ID_PATTERN = /^artifact:v1:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RENDERER_FORBIDDEN_PATH_KEYS = new Set([
  'filePath',
  'folderPath',
  'downloadDir',
  'manifestPath',
  'screenshotPath',
  'domSnapshotPath',
  'failureScreenshotPath',
  'failureDomSnapshotPath',
  'failureTracePath',
  'tracePath',
  'jsonPath',
  'markdownPath',
  'exportPath',
]);
const WINDOWS_ABSOLUTE_PATH_PATTERN = /(?:^|[\s("'=:])(?:[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/][^\\/\s]+)/;

function isInside(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function existingRealRoots(roots: readonly string[]): string[] {
  return Array.from(new Set(roots.map((root) => fs.realpathSync(path.resolve(root)))));
}

function safeDisplayName(value: string | undefined, realPath: string): string {
  const fallback = path.basename(realPath) || '本地文件';
  const candidate = String(value || fallback).trim().slice(0, 160) || fallback;
  if (/^[A-Za-z]:[\\/]/.test(candidate) || /^(?:\\\\|\/\/)/.test(candidate) || candidate.includes('\\') || candidate.includes('/')) {
    return fallback;
  }
  return candidate;
}

function kindMatchesStat(kind: MainArtifactKind, stat: fs.Stats): boolean {
  return kind.endsWith('-folder') ? stat.isDirectory() : stat.isFile();
}

/** Reject accidental path regressions before an IPC payload leaves Main. */
export function assertRendererPayloadIsPathFree(value: unknown): void {
  const visited = new WeakSet<object>();
  const visit = (candidate: unknown, location: string): void => {
    if (typeof candidate === 'string') {
      if (WINDOWS_ABSOLUTE_PATH_PATTERN.test(candidate)) {
        throw new Error(`Renderer payload 包含绝对路径：${location}`);
      }
      return;
    }
    if (!candidate || typeof candidate !== 'object') return;
    if (visited.has(candidate)) return;
    visited.add(candidate);
    if (Array.isArray(candidate)) {
      candidate.forEach((item, index) => visit(item, `${location}[${index}]`));
      return;
    }
    for (const [key, child] of Object.entries(candidate as Record<string, unknown>)) {
      if (RENDERER_FORBIDDEN_PATH_KEYS.has(key)) {
        throw new Error(`Renderer payload 禁止字段 ${key}：${location}.${key}`);
      }
      visit(child, `${location}.${key}`);
    }
  };
  visit(value, '$');
}

/**
 * Main-only registry for filesystem artifacts exposed to the Renderer as
 * unguessable, store-bound capabilities. Paths never appear in descriptors.
 */
export class MainArtifactRegistry {
  private readonly createId: () => string;

  private readonly records = new Map<string, MainArtifactRecord>();

  private readonly idsByIdentity = new Map<string, string>();

  constructor(options: MainArtifactRegistryOptions = {}) {
    this.createId = options.createId ?? (() => crypto.randomUUID());
  }

  issue(input: {
    storeId: string;
    absolutePath: string;
    allowedRoots: readonly string[];
    kind: MainArtifactKind;
    displayName?: string;
  }): MainArtifactDescriptor {
    const storeId = String(input.storeId || '').trim();
    if (!storeId) throw new Error('Artifact 缺少店铺权威。');
    if (!path.isAbsolute(input.absolutePath)) throw new Error('Artifact 必须由 Main 使用绝对路径登记。');
    const realPath = fs.realpathSync(path.resolve(input.absolutePath));
    const stat = fs.statSync(realPath);
    if (!kindMatchesStat(input.kind, stat)) throw new Error('Artifact 类型与本地对象不一致。');
    const roots = existingRealRoots(input.allowedRoots);
    const issuedRoot = roots.find((root) => isInside(realPath, root));
    if (!issuedRoot) throw new Error('Artifact 不属于当前店铺的受控目录。');

    const identity = `${storeId}\u0000${input.kind}\u0000${realPath.toLowerCase()}`;
    const existingId = this.idsByIdentity.get(identity);
    if (existingId) {
      const existing = this.records.get(existingId);
      if (existing) return this.describe(existing);
    }

    const artifactId = `artifact:v1:${this.createId()}`;
    if (!ARTIFACT_ID_PATTERN.test(artifactId) || this.records.has(artifactId)) {
      throw new Error('Artifact ID 生成失败。');
    }
    const record: MainArtifactRecord = {
      artifactId,
      kind: input.kind,
      displayName: safeDisplayName(input.displayName, realPath),
      storeId,
      realPath,
      issuedRoot,
    };
    this.records.set(artifactId, record);
    this.idsByIdentity.set(identity, artifactId);
    return this.describe(record);
  }

  resolve(input: {
    artifactId: string;
    currentStoreId: string;
    allowedRoots: readonly string[];
  }): string {
    const artifactId = String(input.artifactId || '').trim();
    if (!ARTIFACT_ID_PATTERN.test(artifactId)) throw new Error('Artifact ID 无效或已失效。');
    const record = this.records.get(artifactId);
    if (!record) throw new Error('Artifact ID 无效或已失效。');
    if (record.storeId !== String(input.currentStoreId || '').trim()) {
      throw new Error('Artifact 不属于当前店铺。');
    }

    let currentRealPath: string;
    try {
      currentRealPath = fs.realpathSync(record.realPath);
    } catch {
      throw new Error('Artifact 已不存在或不可访问。');
    }
    const roots = existingRealRoots(input.allowedRoots);
    if (!isInside(currentRealPath, record.issuedRoot) || !roots.some((root) => isInside(currentRealPath, root))) {
      throw new Error('Artifact 已离开当前店铺的受控目录。');
    }
    if (!kindMatchesStat(record.kind, fs.statSync(currentRealPath))) {
      throw new Error('Artifact 类型已变化，拒绝打开。');
    }
    return currentRealPath;
  }

  private describe(record: MainArtifactRecord): MainArtifactDescriptor {
    return {
      artifactId: record.artifactId,
      kind: record.kind,
      displayName: record.displayName,
    };
  }
}

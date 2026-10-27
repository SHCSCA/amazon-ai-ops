import { shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import type { DownloadCenterDiagnosticResult } from '@amazon-ai-ops/shared-types';
import type { StoreRecord } from '@amazon-ai-ops/shared-types';
import { normalizeStoreId } from '@amazon-ai-ops/shared-types';
import { runtimeLog } from './runtime-log-adapter';
import { assertRendererPayloadIsPathFree, type MainArtifactKind } from './main-artifact-registry';
import { storeCapsuleFor } from './main-store-access-runtime';
import { requireCurrentCollectionStoreContext } from './main-collection-commands-runtime';
import { optionalTrimmedString } from './main-download-automation-runtime';
import type { RendererArtifactReference } from './main-runtime-contracts';
import { getMainRuntimeContext } from './main-runtime-access';

export function artifactAllowedRootsForStore(
  store: { storeId: string; browserProfileId: string },
  kind: MainArtifactKind,
): string[] {
  const mainRuntimeContext = getMainRuntimeContext();
  const capsule = storeCapsuleFor(store);
  const roots = [
    capsule.downloadsDir,
    capsule.reportsDir,
    capsule.screenshotsDir,
    capsule.tracesDir,
    capsule.evidenceDir,
  ];
  if (kind === 'export-file' || kind === 'export-folder') roots.push(mainRuntimeContext.EXPORTS_DIR);
  return roots;
}

export function issueRendererArtifact(
  storeId: string,
  targetPath: unknown,
  kind: MainArtifactKind,
  displayName?: string,
): RendererArtifactReference | undefined {
  const mainRuntimeContext = getMainRuntimeContext();
  if (typeof targetPath !== 'string' || !targetPath.trim()) return undefined;
  const normalizedStoreId = normalizeStoreId(storeId);
  const store = mainRuntimeContext.state.storeRepo?.getStore(normalizedStoreId);
  if (!store || store.status !== 'active') return undefined;
  try {
    return mainRuntimeContext.mainArtifactRegistry.issue({
      storeId: normalizedStoreId,
      absolutePath: path.resolve(targetPath),
      allowedRoots: artifactAllowedRootsForStore(store, kind),
      kind,
      displayName,
    });
  } catch (error) {
    runtimeLog.warn('[Security] artifact registration rejected', JSON.stringify({
      storeId: normalizedStoreId,
      kind,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    }));
    return undefined;
  }
}

export function rendererPayload<T>(value: T): T {
  assertRendererPayloadIsPathFree(value);
  return value;
}

export function rendererSafeDetail(value: unknown, fallback = '操作未完成，请在当前店铺的数据采集诊断中查看详情。'): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const withoutDrivePaths = value.replace(/[A-Za-z]:[\\/][^\r\n，。；;,)\]}]*/g, '[本地文件]');
  const withoutUncPaths = withoutDrivePaths.replace(/\\\\[^\\/\s]+[\\/][^\r\n，。；;,)\]}]*/g, '[本地文件]');
  return withoutUncPaths.trim() || fallback;
}

export function currentArtifactStore(): StoreRecord {
  const mainRuntimeContext = getMainRuntimeContext();
  const context = mainRuntimeContext.state.storeCoordinator?.getActiveStoreContext();
  if (!context) throw new Error('请先选择店铺，再访问本地 Artifact。');
  const store = mainRuntimeContext.state.storeRepo?.getStore(context.storeId);
  if (!store || store.status !== 'active') throw new Error('当前店铺不存在或已停用。');
  return store;
}

export function projectDiagnosticForRenderer(diagnostic: DownloadCenterDiagnosticResult) {
  const store = currentArtifactStore();
  const screenshotArtifact = issueRendererArtifact(
    store.storeId,
    diagnostic.screenshotPath,
    'diagnostic-file',
    '下载中心截图',
  );
  const domArtifact = issueRendererArtifact(
    store.storeId,
    diagnostic.domSnapshotPath,
    'diagnostic-file',
    '下载中心页面快照',
  );
  const {
    screenshotPath: _screenshotPath,
    domSnapshotPath: _domSnapshotPath,
    errorMessage,
    ...safeDiagnostic
  } = diagnostic;
  return rendererPayload({
    ...safeDiagnostic,
    ...(errorMessage ? { errorMessage: rendererSafeDetail(errorMessage) } : {}),
    ...(screenshotArtifact ? {
      screenshotArtifactId: screenshotArtifact.artifactId,
      screenshotDisplayName: screenshotArtifact.displayName,
    } : {}),
    ...(domArtifact ? {
      domArtifactId: domArtifact.artifactId,
      domDisplayName: domArtifact.displayName,
    } : {}),
  });
}

export function projectExportArtifactForCurrentStore(
  targetPath: string,
  kind: 'diagnostic-folder' | 'export-folder' | 'export-file',
  displayName: string,
) {
  const store = currentArtifactStore();
  const artifact = issueRendererArtifact(store.storeId, targetPath, kind, displayName);
  if (!artifact) throw new Error('导出已完成，但 Artifact 未通过当前店铺目录校验。');
  return rendererPayload(artifact);
}

export async function handleOpenArtifact(input: unknown): Promise<void> {
  const mainRuntimeContext = getMainRuntimeContext();
  const value = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const context = requireCurrentCollectionStoreContext(value.storeContext);
  const artifactId = optionalTrimmedString(value.artifactId);
  if (!artifactId) throw new Error('Artifact ID 无效或已失效。');
  const store = mainRuntimeContext.state.storeRepo?.getStore(context.storeId);
  if (!store || store.status !== 'active') throw new Error('当前店铺不存在或已停用。');
  const realPath = mainRuntimeContext.mainArtifactRegistry.resolve({
    artifactId,
    currentStoreId: context.storeId,
    allowedRoots: artifactAllowedRootsForStore(store, 'export-file'),
  });
  const stat = fs.statSync(realPath);
  if (stat.isFile() && !mainRuntimeContext.OPEN_PATH_ALLOWED_EXTENSIONS.has(path.extname(realPath).toLowerCase())) {
    throw new Error('文件类型不允许直接打开');
  }
  const error = await shell.openPath(realPath);
  if (error) {
    throw new Error(error);
  }
}

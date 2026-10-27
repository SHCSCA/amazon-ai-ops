import * as fs from 'node:fs';
import * as path from 'node:path';
import type Database from 'better-sqlite3';
import type { BootstrapPaths } from './bootstrap-configuration';
import {
  getDeliveryEvidenceStatus,
  getPackageEvidenceStatus,
  type DeliveryEvidenceStatusScope,
} from './delivery-evidence-status';
import {
  missingReadinessView,
  normalizeDeliveryReadiness,
  type DeliveryReadinessView,
} from './delivery-readiness-view';
import { refreshFinalReadiness } from './final-readiness-refresh';
import {
  latestStoreScopedReadbackCandidate,
  readStoreScopedReadbackEvidenceFile,
  resolveStoreScopedReadbackReference,
  type StoreScopedReadbackAccess,
} from './readback-store-authority';
import type { RuntimeLogPort } from './runtime-logger';

export type DeliveryRuntimePaths = Pick<BootstrapPaths,
  | 'userDataDir' | 'codexEvidenceDir' | 'downloadsDir' | 'exportsDir'
  | 'deliveryBundlesDir' | 'databasePath' | 'repositoryRoot' | 'finalReadinessPath'
>;

export interface DeliveryRuntimeOptions {
  readonly paths: DeliveryRuntimePaths;
  readonly appVersion: string;
  readonly getDatabase: () => Database.Database | null | undefined;
  readonly getOperationScope: () => unknown;
  readonly normalizeOperationScope: (input: unknown) => DeliveryEvidenceStatusScope;
  readonly getReadbackAccess: () => StoreScopedReadbackAccess;
  readonly validateAdReadbackAuthority: (evidencePath: string, stage: 'final-readiness') => {
    ok: boolean;
    message?: string;
  };
  readonly logger: Pick<RuntimeLogPort, 'error'> & Partial<Pick<RuntimeLogPort, 'info' | 'warn'>>;
}

function readJson(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function latestFinalReadinessPath(directory: string): string | null {
  if (!fs.existsSync(directory)) return null;
  const candidates = fs.readdirSync(directory)
    .filter((name) => /^final-readiness-.*\.json$/i.test(name))
    .map((name) => {
      const filePath = path.join(directory, name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  return candidates[0]?.filePath || null;
}

export function createLegacyDeliveryRuntime(options: DeliveryRuntimeOptions) {
  const { paths } = options;
  const releaseDir = path.join(paths.repositoryRoot, 'apps', 'desktop', 'release');
  const missingView = (message: string) => missingReadinessView(message, paths.finalReadinessPath);

  function getReadiness(): DeliveryReadinessView {
    const finalReadinessPath = paths.finalReadinessPath || latestFinalReadinessPath(paths.codexEvidenceDir);
    if (!finalReadinessPath) {
      return missingView(`最终验收 manifest 尚未生成：${paths.codexEvidenceDir}`);
    }
    if (!fs.existsSync(finalReadinessPath)) {
      return missingView(`最终验收 manifest 尚未生成：${finalReadinessPath}`);
    }
    try {
      return normalizeDeliveryReadiness(readJson(finalReadinessPath), finalReadinessPath, {
        currentPackage: getPackageEvidenceStatus(releaseDir),
        currentVersion: options.appVersion,
      });
    } catch (error) {
      options.logger.error('delivery.readiness_read_failed', { error, finalReadinessPath });
      return {
        ...missingView(`最终验收 manifest 读取失败：${error instanceof Error ? error.message : String(error)}`),
        path: finalReadinessPath,
        exists: true,
        missing: ['最终验收 manifest 无法解析'],
        actionItems: ['重新运行最终验收，生成可解析的 final-readiness JSON。'],
      };
    }
  }

  function getStoragePaths() {
    return {
      settingsPath: path.join(paths.userDataDir, 'settings.json'),
      evidenceDir: paths.codexEvidenceDir,
      downloadsDir: paths.downloadsDir,
      exportsDir: paths.exportsDir,
      deliveryDir: paths.deliveryBundlesDir,
      localDbPath: paths.databasePath,
    };
  }

  function getEvidenceStatus(input?: unknown) {
    const scope = options.normalizeOperationScope(input || options.getOperationScope() || {});
    const readbackAccess = options.getReadbackAccess();
    return getDeliveryEvidenceStatus({
      db: options.getDatabase(),
      storeId: readbackAccess.binding.storeId,
      readbackDir: readbackAccess.rootDir,
      readbackAccess,
      releaseDir,
      scope,
    });
  }

  function refreshReadiness(input?: { adReadbackPath?: string }) {
    const readbackAccess = options.getReadbackAccess();
    const requestedPath = typeof input?.adReadbackPath === 'string' && input.adReadbackPath.trim()
      ? input.adReadbackPath
      : undefined;
    const adReadbackPath = requestedPath
      ? readStoreScopedReadbackEvidenceFile(readbackAccess, requestedPath, 'root').filePath
      : latestStoreScopedReadbackCandidate(readbackAccess)
        ?? resolveStoreScopedReadbackReference(readbackAccess, 'real-ad-execution-readback-missing.json', 'candidates');
    const result = refreshFinalReadiness({
      repoRootDir: paths.repositoryRoot,
      evidenceDir: paths.codexEvidenceDir,
      releaseDir,
      appVersion: options.appVersion,
      // 缺少本店候选时仍传本店缺失路径，禁止退回全局回读文件。
      adReadbackPath,
      validateAdReadbackAuthority: (evidencePath) => options.validateAdReadbackAuthority(evidencePath, 'final-readiness'),
    });
    return {
      success: true,
      evidenceManifestPath: result.evidenceManifestPath,
      finalReadinessPath: result.finalReadinessPath,
      readiness: normalizeDeliveryReadiness(readJson(result.finalReadinessPath), result.finalReadinessPath, {
        currentPackage: getPackageEvidenceStatus(releaseDir),
        currentVersion: options.appVersion,
      }),
    };
  }

  return { getReadiness, getStoragePaths, getEvidenceStatus, refreshFinalReadiness: refreshReadiness };
}

import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { deriveStoreCapsulePaths, ensureStoreCapsulePaths, type StoreCapsulePaths } from '@amazon-ai-ops/browser-worker';
import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { createStoreScopedReadbackAccess, type StoreScopedReadbackAccess } from './readback-store-authority';
import { projectStoreEvidenceReferencePaths } from './store-evidence-reference-projection';
import { requireStoreRuntimeAnalysisConfig, type StoreRuntimeAnalysisConfig } from './store-runtime-analysis-config';
import { getMainRuntimeContext } from './main-runtime-access';

export function analysisRuleRevision(value: unknown): string {
  const stable = (candidate: unknown): string => {
    if (Array.isArray(candidate)) return `[${candidate.map(stable).join(',')}]`;
    if (candidate && typeof candidate === 'object') {
      const record = candidate as Record<string, unknown>;
      return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(',')}}`;
    }
    return JSON.stringify(candidate) ?? 'null';
  };
  return crypto.createHash('sha256').update(stable(value)).digest('hex');
}

export function currentStoreRuntimeAnalysisConfig(): StoreRuntimeAnalysisConfig {
  const mainRuntimeContext = getMainRuntimeContext();
  const context = mainRuntimeContext.state.storeCoordinator?.getActiveStoreContext();
  if (!context || !mainRuntimeContext.state.storeRuntimeConfigService) {
    throw new Error('当前店铺运行配置服务尚未就绪。');
  }
  return requireStoreRuntimeAnalysisConfig(
    mainRuntimeContext.state.ruleConfig,
    mainRuntimeContext.state.storeRuntimeConfigService.get(context),
  );
}

export function hasPackageUiFreshTypedProof(storeId: unknown, username: unknown): boolean {
  const mainRuntimeContext = getMainRuntimeContext();
  const normalizedStoreId = String(storeId ?? '').trim();
  const normalizedUsername = typeof username === 'string' ? username.trim() : '';
  return Boolean(
    mainRuntimeContext.packageUiFreshTypedProof
    && normalizedStoreId
    && normalizedUsername
    && mainRuntimeContext.packageUiFreshTypedProof.storeId === normalizedStoreId
    && mainRuntimeContext.packageUiFreshTypedProof.username === normalizedUsername
  );
}

export function storeCapsuleFor(store: { storeId: string; browserProfileId: string }): StoreCapsulePaths {
  const mainRuntimeContext = getMainRuntimeContext();
  return ensureStoreCapsulePaths(deriveStoreCapsulePaths(
    mainRuntimeContext.STORES_DIR,
    store.storeId,
    store.browserProfileId,
  ));
}

export function currentStoreScopedReadbackAccess(
  capturedContext?: StoreContextEnvelope,
): StoreScopedReadbackAccess {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!mainRuntimeContext.state.storeCoordinator) {
    throw new Error('READBACK_STORE_CONTEXT_UNAVAILABLE: store authority is not initialized.');
  }
  const current = capturedContext ?? mainRuntimeContext.state.storeCoordinator.getActiveStoreContext();
  if (!current) {
    throw new Error('READBACK_STORE_CONTEXT_UNAVAILABLE: select an active store before using readback evidence.');
  }
  const context = mainRuntimeContext.state.storeCoordinator.assertActiveStoreContext(current);
  return createStoreScopedReadbackAccess(context, storeCapsuleFor(context));
}

export function storeEvidenceRetentionReferencesFor(
  context: StoreContextEnvelope,
  capsule: StoreCapsulePaths,
) {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!mainRuntimeContext.state.db) throw new Error('STORE_RETENTION_DATABASE_UNAVAILABLE');
  return {
    databaseReferences: projectStoreEvidenceReferencePaths(
      mainRuntimeContext.state.db,
      context.storeId,
      capsule,
    ),
    
    
    authorityReferencedPaths: [],
  };
}

export function storeSessionGenerationSettingKey(storeId: string): string {
  const mainRuntimeContext = getMainRuntimeContext();
  return `${mainRuntimeContext.STORE_SESSION_GENERATION_SETTING_PREFIX}${storeId}`;
}

export function getBundledResourcesPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'resources')
    : path.resolve(app.getAppPath(), '../../resources');
}

export function ensureDirs(): void {
  const mainRuntimeContext = getMainRuntimeContext();
  for (const dir of [mainRuntimeContext.STORAGE_DIR, mainRuntimeContext.SCREENSHOTS_DIR, mainRuntimeContext.DOM_SNAPSHOTS_DIR, mainRuntimeContext.TRACES_DIR, mainRuntimeContext.REPORTS_DIR, mainRuntimeContext.DOWNLOADS_DIR, mainRuntimeContext.EXPORTS_DIR, mainRuntimeContext.PAGE_MODELS_DIR]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

export function canonicalizeExistingPath(filePath: string): string {
  const resolved = path.resolve(filePath);
  return fs.existsSync(resolved) ? fs.realpathSync.native(resolved) : resolved;
}

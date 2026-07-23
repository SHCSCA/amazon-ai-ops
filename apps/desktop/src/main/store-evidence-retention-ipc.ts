import path from 'node:path';
import type {
  StoreContextEnvelope,
  StoreEvidenceRetentionPreviewSummary,
  StoreRuntimeConfigProjection,
} from '@amazon-ai-ops/shared-types';
import type { StoreCapsulePaths } from '@amazon-ai-ops/browser-worker';
import {
  buildStoreEvidenceRetentionManifest,
  type StoreEvidenceRetentionBlocker,
  type StoreEvidenceRetentionManifest,
} from './store-evidence-retention';
import type {
  StoreEvidenceDatabaseReferenceProjection,
} from './store-evidence-reference-projection';

export const STORE_EVIDENCE_RETENTION_PREVIEW_CHANNEL = 'store-evidence-retention:preview';

export interface StoreEvidenceRetentionIpcRegistrar {
  handle(channel: string, listener: (event: unknown, input?: unknown) => unknown): void;
}

export interface StoreEvidenceRetentionAuthorityPort {
  assertActiveStoreContext(value: unknown): StoreContextEnvelope;
  getActiveStoreContext(): StoreContextEnvelope | null;
}

export interface StoreEvidenceRetentionReferenceProjection {
  readonly databaseReferences?: StoreEvidenceDatabaseReferenceProjection;
  /** Legacy Main-only projection accepted during the structured migration. */
  readonly databaseReferencedPaths?: readonly string[];
  readonly authorityReferencedPaths?: readonly string[];
}

export interface StoreEvidenceRetentionArtifactResolver {
  resolve(input: {
    artifactId: string;
    currentStoreId: string;
    allowedRoots: readonly string[];
  }): string;
}

export interface StoreEvidenceRetentionPreviewDependencies {
  readonly authority: StoreEvidenceRetentionAuthorityPort;
  readonly runtimeConfig: {
    get(context: StoreContextEnvelope): StoreRuntimeConfigProjection;
  };
  /**
   * Read-only path derivation. Implementations must not create Store Capsule
   * directories; collection/bootstrap owns filesystem initialization.
   */
  readonly deriveCapsuleFor: (context: StoreContextEnvelope) => StoreCapsulePaths;
  readonly referencesFor?: (
    context: StoreContextEnvelope,
    capsule: StoreCapsulePaths,
  ) => StoreEvidenceRetentionReferenceProjection;
  /** Main-owned registry/adapter. It is never supplied by Renderer input. */
  readonly artifactResolver?: StoreEvidenceRetentionArtifactResolver;
  readonly now?: () => Date;
}

/** Main-only authority adapter. Renderer input never controls paths or retention. */
export class StoreEvidenceRetentionPreviewService {
  constructor(private readonly dependencies: StoreEvidenceRetentionPreviewDependencies) {}

  preview(contextInput: unknown): StoreEvidenceRetentionPreviewSummary {
    return projectStoreEvidenceRetentionPreviewSummary(
      this.buildManifestForMain(contextInput),
    );
  }

  /** Full filesystem manifest for Main-only diagnostics and tests. */
  buildManifestForMain(contextInput: unknown): StoreEvidenceRetentionManifest {
    const context = this.dependencies.authority.assertActiveStoreContext(contextInput);
    if (context.marketplace !== 'US' || context.currency !== 'USD') {
      throw new Error('STORE_RETENTION_CONTEXT_UNSUPPORTED: retention preview requires US/USD store authority.');
    }
    const projection = this.dependencies.runtimeConfig.get(context);
    const config = projection.current;
    if (!config || config.status !== 'active') {
      throw new Error('STORE_RETENTION_CONFIG_UNAVAILABLE: current active store runtime config is required.');
    }
    if (
      String(config.storeId) !== String(context.storeId)
      || config.marketplace !== context.marketplace
      || config.currency !== context.currency
    ) {
      throw new Error('STORE_RETENTION_CONFIG_MISMATCH: runtime config does not belong to the active store.');
    }
    const capsule = this.dependencies.deriveCapsuleFor(context);
    if (
      String(capsule.storeId) !== String(context.storeId)
      || String(capsule.browserProfileId) !== String(context.browserProfileId)
    ) {
      throw new Error('STORE_RETENTION_CAPSULE_MISMATCH: capsule does not belong to the active store context.');
    }
    const references = this.dependencies.referencesFor?.(context, capsule) ?? {};
    const projected = references.databaseReferences;
    const referenceBlockers: StoreEvidenceRetentionBlocker[] = [
      ...(projected?.blockers ?? []),
    ];
    const resolvedArtifactPaths: string[] = [];
    for (const artifact of projected?.artifactReferences ?? []) {
      const foreignOwnership = artifact.ownership === 'foreign-store';
      try {
        const resolved = this.dependencies.artifactResolver?.resolve({
          artifactId: artifact.artifactId,
          currentStoreId: foreignOwnership
            ? artifact.referencedStoreId
            : String(context.storeId),
          allowedRoots: foreignOwnership
            ? [capsule.trustedStoresRoot]
            : [capsule.storeRoot],
        });
        if (typeof resolved !== 'string' || !resolved.trim()) {
          throw new Error('artifact resolver unavailable');
        }
        if (!foreignOwnership) {
          resolvedArtifactPaths.push(resolved);
        } else if (isContained(capsule.storeRoot, resolved)) {
          resolvedArtifactPaths.push(resolved);
          referenceBlockers.push({
            code: 'CROSS_STORE_REFERENCE',
            relativePath: '[artifact-reference]',
            detail: 'an artifact reference owned by another store resolves into the current Store Capsule',
          });
        }
      } catch {
        if (foreignOwnership) {
          try {
            const currentStoreResolved = this.dependencies.artifactResolver?.resolve({
              artifactId: artifact.artifactId,
              currentStoreId: String(context.storeId),
              allowedRoots: [capsule.storeRoot],
            });
            if (typeof currentStoreResolved === 'string' && currentStoreResolved.trim()) {
              resolvedArtifactPaths.push(currentStoreResolved);
            }
          } catch {
            // The blocker below preserves fail-closed truth when neither the
            // row owner nor the current store can prove the artifact identity.
          }
        }
        referenceBlockers.push({
          code: foreignOwnership
            ? 'CROSS_STORE_REFERENCE'
            : 'UNRESOLVED_ARTIFACT_REFERENCE',
          relativePath: '[artifact-reference]',
          detail: foreignOwnership
            ? 'an artifact reference owned by another store could not be proven outside the current Store Capsule'
            : `${artifact.source} could not be resolved by the current Main artifact registry`,
        });
      }
    }
    return buildStoreEvidenceRetentionManifest({
      capsule,
      evidenceRetentionDays: config.values.evidenceRetentionDays,
      now: this.dependencies.now?.(),
      databaseReferencedPaths: [
        ...(references.databaseReferencedPaths ?? []),
        ...(projected?.databaseReferencedPaths ?? []),
        ...resolvedArtifactPaths,
      ],
      authorityReferencedPaths: references.authorityReferencedPaths,
      referenceBlockers,
    });
  }

  previewActiveStore(): StoreEvidenceRetentionPreviewSummary | null {
    const context = this.dependencies.authority.getActiveStoreContext();
    return context ? this.preview(context) : null;
  }
}

const BLOCKER_DETAILS: Readonly<Record<
  StoreEvidenceRetentionBlocker['code'],
  string
>> = Object.freeze({
  INVALID_STORE_CAPSULE: '店铺证据目录结构未通过 Main 校验。',
  MISSING_CAPSULE_PATH: '店铺证据目录不完整，已停止安全判定。',
  PATH_ESCAPE: '发现当前店铺目录边界之外的引用。',
  CROSS_STORE_REFERENCE: '发现无法安全归属到当前店铺的跨店引用。',
  DATABASE_REFERENCE_OWNERSHIP_MISMATCH: '数据库证据引用的父级店铺归属不一致。',
  UNRESOLVED_ARTIFACT_REFERENCE: 'Main 无法解析一个持久化证据工件引用。',
  MISSING_REFERENCE: '数据库引用的证据文件不存在。',
  UNSAFE_LINK_OR_REPARSE_POINT: '证据目录包含不允许跟随的链接或重解析点。',
  HARD_LINKED_FILE: '证据文件存在多个硬链接，无法安全判定。',
  UNSUPPORTED_FILESYSTEM_ENTRY: '证据目录包含不支持的文件系统对象。',
  FILESYSTEM_INSPECTION_FAILED: 'Main 无法完成证据目录检查。',
});

/**
 * Removes every filename, relative path, timestamp-per-file and byte-per-file
 * record before a retention result crosses into Renderer.
 */
export function projectStoreEvidenceRetentionPreviewSummary(
  manifest: StoreEvidenceRetentionManifest,
): StoreEvidenceRetentionPreviewSummary {
  return Object.freeze({
    schemaVersion: 1,
    mode: 'dry-run',
    deletionSupported: false,
    applyable: false,
    generatedAt: manifest.generatedAt,
    storeId: manifest.storeId,
    profileId: manifest.profileId,
    marketplace: 'US',
    currency: 'USD',
    retentionDays: manifest.retentionDays,
    cutoffAt: manifest.cutoffAt,
    expiryBasis: 'mtime-before-cutoff',
    scanSafe: manifest.scanSafe,
    candidateCount: manifest.candidateCount,
    candidateBytes: manifest.candidateBytes,
    protectedScopeCount: manifest.protectedScopes.length,
    protectedFileCount: manifest.protectedFiles.length,
    blockerCount: manifest.blockers.length,
    blockers: Object.freeze(manifest.blockers.map((blocker) => Object.freeze({
      code: blocker.code,
      detail: BLOCKER_DETAILS[blocker.code],
    }))),
  });
}

export function registerStoreEvidenceRetentionIpcHandlers(
  ipc: StoreEvidenceRetentionIpcRegistrar,
  service: StoreEvidenceRetentionPreviewService,
): void {
  ipc.handle(STORE_EVIDENCE_RETENTION_PREVIEW_CHANNEL, (_event, raw) => {
    const request = readPreviewRequest(raw);
    return service.preview(request.storeContext);
  });
}

function readPreviewRequest(value: unknown): { storeContext: Record<string, unknown> } {
  const request = asObject(value, 'store evidence retention preview request');
  const keys = Object.keys(request).sort();
  if (keys.length !== 1 || keys[0] !== 'storeContext') {
    throw new TypeError('retention preview request accepts storeContext only');
  }
  return { storeContext: asObject(request.storeContext, 'storeContext') };
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
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

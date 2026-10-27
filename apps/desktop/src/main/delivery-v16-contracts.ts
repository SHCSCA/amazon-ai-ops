import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import type { DeliveryReadinessView } from './delivery-readiness-view';
import type { DeliveryEvidenceStatus } from './delivery-evidence-status';

export type DeliveryV16Operation = 'view' | 'refresh' | 'export';

export interface DeliveryV16Authority {
  readonly storeContext: StoreContextEnvelope | null;
  readonly scope: unknown;
  readonly scopeRevision: string;
  readonly mode: { readonly value: string | null; readonly revision: number | null };
  readonly configurationRevision: number;
  readonly workPackageRoot: string;
}

export interface DeliveryV16Paths {
  readonly appRoot: string;
  readonly executablePath: string;
  readonly mainBundlePath: string;
  readonly workerPath: string;
  readonly backupHelperPath: string;
  readonly workPackageRoot: string;
  readonly cacheRoot: string;
  readonly outputRoot: string;
  readonly authorityDbPath: string;
  readonly authoritySnapshotRoot: string;
  readonly tempRoot: string;
  readonly publicationRoot?: string | null;
}

export interface DeliveryV16Binding {
  readonly nonce: string;
  readonly epoch: number;
  readonly authoritySha256: string;
}

export interface DeliveryV16Request {
  readonly schemaVersion: 'v16.delivery-request/1';
  readonly binding: DeliveryV16Binding;
  readonly operation: DeliveryV16Operation;
  readonly authority: DeliveryV16Authority;
  readonly paths: DeliveryV16Paths;
  readonly appVersion: string;
  readonly nativeAbi: string;
}

export interface DeliveryV16Result {
  readonly schemaVersion: 'v16.delivery-result/1';
  readonly binding: DeliveryV16Binding;
  readonly readiness: DeliveryReadinessView;
  readonly evidenceStatus?: DeliveryEvidenceStatus;
  readonly refresh?: { success: boolean; evidenceManifestPath: string; finalReadinessPath: string };
  readonly exported?: { success: boolean; status: string; bundleDir?: string; manifestPath?: string; message?: string };
}

export interface DeliveryV16WorkerPort {
  execute(request: DeliveryV16Request, signal: AbortSignal): Promise<DeliveryV16Result>;
  stopAndDrain(): Promise<void>;
}

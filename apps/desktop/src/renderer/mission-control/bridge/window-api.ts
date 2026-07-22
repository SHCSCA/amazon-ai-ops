import type {
  ArchiveStoreInput,
  CreateStoreInput,
  MissionControlCommandRequest,
  MissionControlCommandResponse,
  MissionControlQueryRequest,
  MissionControlQueryResponse,
  RestoreStoreInput,
  StoreContextEnvelope,
  StoreId,
  StoreRecord,
  StoreWorkspaceView,
  UpdateStoreInput,
} from '@amazon-ai-ops/shared-types';

export interface MissionControlRendererApi {
  query(input: MissionControlQueryRequest): Promise<MissionControlQueryResponse>;
  command(input: MissionControlCommandRequest): Promise<MissionControlCommandResponse>;
}

export interface MissionControlWindowApi {
  missionControl: MissionControlRendererApi;
  listStores(input?: { includeArchived?: boolean }): Promise<StoreRecord[]>;
  getStore(storeId: StoreId): Promise<StoreRecord>;
  createStore(input: CreateStoreInput): Promise<StoreRecord>;
  updateStore(input: UpdateStoreInput): Promise<StoreRecord>;
  archiveStore(input: ArchiveStoreInput): Promise<StoreRecord>;
  restoreStore(input: RestoreStoreInput): Promise<StoreRecord>;
  switchStore(storeId: StoreId): Promise<StoreWorkspaceView>;
  getActiveStoreContext(): Promise<StoreContextEnvelope | null>;
  onStoreContextChanged(callback: (view: StoreWorkspaceView) => void): () => void;
  onStoresChanged(callback: (store: StoreRecord) => void): () => void;
}

export function getMissionControlWindowApi(): MissionControlWindowApi {
  const api = (window as unknown as { electronAPI?: Partial<MissionControlWindowApi> }).electronAPI;
  if (!api || !api.missionControl || !api.listStores || !api.getStore
    || !api.createStore || !api.updateStore || !api.archiveStore || !api.restoreStore
    || !api.switchStore || !api.getActiveStoreContext
    || !api.onStoreContextChanged || !api.onStoresChanged) {
    throw new Error('MISSION_CONTROL_PRELOAD_API_UNAVAILABLE');
  }
  return api as MissionControlWindowApi;
}

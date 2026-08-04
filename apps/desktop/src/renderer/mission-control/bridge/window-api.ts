import type {
  ArchiveStoreInput,
  CreateStoreConnectionInput,
  CreateStoreInput,
  ListStoreDailyStatusesInput,
  MissionControlCommandRequest,
  MissionControlCommandResponse,
  MissionControlQueryRequest,
  MissionControlQueryResponse,
  RemoveStoreConnectionInput,
  RestoreStoreInput,
  StoreContextEnvelope,
  StoreConnection,
  StoreDailyStatusListProjection,
  StoreId,
  StoreRecord,
  StoreScopeRef,
  StoreWorkspaceView,
  UpdateStoreConnectionInput,
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
  createStoreConnection(input: CreateStoreConnectionInput): Promise<StoreConnection>;
  updateStoreConnection(input: UpdateStoreConnectionInput): Promise<StoreConnection>;
  removeStoreConnection(input: RemoveStoreConnectionInput): Promise<{ success: true }>;
  switchStore(scope: StoreScopeRef): Promise<StoreWorkspaceView>;
  listStoreDailyStatuses(input: ListStoreDailyStatusesInput): Promise<StoreDailyStatusListProjection>;
  getActiveStoreContext(): Promise<StoreContextEnvelope | null>;
  getActiveStoreWorkspaceView(): Promise<StoreWorkspaceView | null>;
  onStoreContextChanged(callback: (view: StoreWorkspaceView | null) => void): () => void;
  onStoresChanged(callback: (store: StoreRecord) => void): () => void;
}

export function getMissionControlWindowApi(): MissionControlWindowApi {
  const api = (window as unknown as { electronAPI?: Partial<MissionControlWindowApi> }).electronAPI;
  if (!api || !api.missionControl || !api.listStores || !api.getStore
    || !api.createStore || !api.updateStore || !api.archiveStore || !api.restoreStore
    || !api.createStoreConnection || !api.updateStoreConnection || !api.removeStoreConnection
    || !api.switchStore || !api.listStoreDailyStatuses || !api.getActiveStoreContext
    || !api.getActiveStoreWorkspaceView
    || !api.onStoreContextChanged || !api.onStoresChanged) {
    throw new Error('MISSION_CONTROL_PRELOAD_API_UNAVAILABLE');
  }
  return api as MissionControlWindowApi;
}

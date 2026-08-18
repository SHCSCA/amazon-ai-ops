import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  missionControlContextKey,
  normalizeLingxingCollectionStoreName,
  type ArchiveStoreInput,
  type CreateStoreInput,
  type RestoreStoreInput,
  type StoreContextEnvelope,
  type StoreConnection,
  type StoreDailyStatusProjection,
  type StoreRecord,
  type StoreScopeRef,
  type StoreWorkspaceView,
  type UpdateStoreInput,
} from '@amazon-ai-ops/shared-types';
import {
  getMissionControlWindowApi,
  type MissionControlWindowApi,
} from './bridge/window-api';

export type MissionControlStorePhase =
  | 'loading'
  | 'needs-selection'
  | 'switching'
  | 'ready'
  | 'error';

export interface MissionControlStoreState {
  stores: StoreRecord[];
  activeStore: StoreRecord | null;
  activeView: StoreWorkspaceView | null;
  authoritativeContext: StoreContextEnvelope | null;
  authorityKey: string | null;
  contextEpoch: number;
  phase: MissionControlStorePhase;
  error: string | null;
  dailyStatuses: StoreDailyStatusProjection[];
  dailyStatusPhase: 'idle' | 'loading' | 'ready' | 'error';
  dailyStatusError: string | null;
  dailyStatusGeneratedAt: string | null;
  postCommitSyncWarning: string | null;
}

export interface MissionControlStoreContextValue extends MissionControlStoreState {
  switchStore(scope: StoreScopeRef): Promise<StoreWorkspaceView>;
  refreshStores(): Promise<StoreRecord[]>;
  refreshDailyStatuses(): Promise<StoreDailyStatusProjection[]>;
  retryBootstrap(): Promise<void>;
  createStore(input: CreateStoreInput): Promise<StoreRecord>;
  updateStore(input: UpdateStoreInput): Promise<StoreRecord>;
  archiveStore(input: ArchiveStoreInput): Promise<StoreRecord>;
  restoreStore(input: RestoreStoreInput): Promise<StoreRecord>;
  bindLingxingConnection(accountLabel: string, collectionStoreName: string): Promise<StoreConnection>;
  unbindStoreConnection(connection: StoreConnection): Promise<void>;
}

export class StoreSwitchAuthorityMismatchError extends Error {
  constructor() {
    super('切换店铺失败：Main 返回的店铺或站点与请求不匹配，请重试。');
    this.name = 'StoreSwitchAuthorityMismatchError';
  }
}

export async function requestStoreWorkspaceSwitch(
  api: Pick<MissionControlWindowApi, 'switchStore'>,
  scope: StoreScopeRef,
): Promise<StoreWorkspaceView> {
  const view = await api.switchStore(scope);
  if (
    view.store.storeId !== scope.storeId
    || view.store.marketplace !== scope.marketplace
    || view.context.storeId !== scope.storeId
    || view.context.marketplace !== scope.marketplace
  ) {
    throw new StoreSwitchAuthorityMismatchError();
  }
  return view;
}

export type MissionControlStoreAction =
  | { type: 'stores'; stores: StoreRecord[] }
  | { type: 'loading' }
  | { type: 'switching' }
  | { type: 'authority'; view: StoreWorkspaceView }
  | { type: 'connection-committed'; connection: StoreConnection }
  | { type: 'connection-removed'; connection: StoreConnection }
  | { type: 'clear-authority'; phase?: MissionControlStorePhase; error?: string | null }
  | { type: 'active-record'; store: StoreRecord }
  | { type: 'daily-status-loading' }
  | { type: 'daily-statuses'; statuses: StoreDailyStatusProjection[]; generatedAt: string }
  | { type: 'daily-status-error'; error: string }
  | { type: 'post-commit-sync-warning'; warning: string | null }
  | { type: 'error'; error: string };

export const INITIAL_MISSION_CONTROL_STORE_STATE: MissionControlStoreState = {
  stores: [],
  activeStore: null,
  activeView: null,
  authoritativeContext: null,
  authorityKey: null,
  contextEpoch: 0,
  phase: 'loading',
  error: null,
  dailyStatuses: [],
  dailyStatusPhase: 'idle',
  dailyStatusError: null,
  dailyStatusGeneratedAt: null,
  postCommitSyncWarning: null,
};

export function reduceMissionControlStoreState(
  state: MissionControlStoreState,
  action: MissionControlStoreAction,
): MissionControlStoreState {
  switch (action.type) {
    case 'stores':
      return { ...state, stores: action.stores };
    case 'loading':
      return { ...state, phase: 'loading', error: null };
    case 'switching':
      return { ...state, phase: 'switching', error: null };
    case 'authority': {
      const authorityKey = missionControlContextKey(action.view.context);
      const sameAuthority = authorityKey === state.authorityKey;
      return {
        ...state,
        activeStore: action.view.store,
        activeView: action.view,
        authoritativeContext: action.view.context,
        authorityKey,
        contextEpoch: sameAuthority ? state.contextEpoch : state.contextEpoch + 1,
        phase: 'ready',
        error: null,
      };
    }
    case 'connection-committed': {
      if (!state.activeView || state.activeView.store.storeId !== action.connection.storeId) return state;
      const connections = replaceConnection(state.activeView.connections, action.connection);
      return {
        ...state,
        activeView: {
          ...state.activeView,
          connections,
          sessions: state.activeView.sessions.filter(
            (session) => session.provider !== action.connection.provider,
          ),
        },
      };
    }
    case 'connection-removed': {
      if (!state.activeView || state.activeView.store.storeId !== action.connection.storeId) return state;
      return {
        ...state,
        activeView: {
          ...state.activeView,
          connections: state.activeView.connections.filter(
            (candidate) => candidate.id !== action.connection.id,
          ),
          sessions: state.activeView.sessions.filter(
            (session) => session.provider !== action.connection.provider,
          ),
        },
      };
    }
    case 'clear-authority': {
      const hadAuthority = state.authorityKey !== null || state.authoritativeContext !== null;
      return {
        ...state,
        activeStore: null,
        activeView: null,
        authoritativeContext: null,
        authorityKey: null,
        contextEpoch: hadAuthority ? state.contextEpoch + 1 : state.contextEpoch,
        phase: action.phase ?? 'needs-selection',
        error: action.error ?? null,
      };
    }
    case 'active-record':
      if (!state.activeStore || state.activeStore.storeId !== action.store.storeId) return state;
      return {
        ...state,
        activeStore: action.store,
        activeView: state.activeView ? { ...state.activeView, store: action.store } : null,
      };
    case 'daily-status-loading':
      return { ...state, dailyStatusPhase: 'loading', dailyStatusError: null };
    case 'daily-statuses':
      return {
        ...state,
        dailyStatuses: action.statuses,
        dailyStatusPhase: 'ready',
        dailyStatusError: null,
        dailyStatusGeneratedAt: action.generatedAt,
      };
    case 'daily-status-error':
      return { ...state, dailyStatusPhase: 'error', dailyStatusError: action.error };
    case 'post-commit-sync-warning':
      return { ...state, postCommitSyncWarning: action.warning };
    case 'error':
      return { ...state, phase: 'error', error: action.error };
    default:
      return state;
  }
}

const MissionControlStoreContext = createContext<MissionControlStoreContextValue | null>(null);

export interface MissionControlStoreContextProviderProps {
  children: ReactNode;
  api?: MissionControlWindowApi;
}

export function MissionControlStoreContextProvider({
  children,
  api: injectedApi,
}: MissionControlStoreContextProviderProps) {
  const api = useMemo(() => injectedApi ?? getMissionControlWindowApi(), [injectedApi]);
  const [state, setState] = useState(INITIAL_MISSION_CONTROL_STORE_STATE);
  const stateRef = useRef(state);
  const mountedRef = useRef(true);
  const resyncSequenceRef = useRef(0);
  const switchSequenceRef = useRef(0);
  const dailyStatusSequenceRef = useRef(0);
  const postCommitSyncSequenceRef = useRef(0);

  useEffect(() => { stateRef.current = state; }, [state]);

  const dispatch = useCallback((action: MissionControlStoreAction) => {
    if (!mountedRef.current) return;
    setState((current) => reduceMissionControlStoreState(current, action));
  }, []);

  const refreshStores = useCallback(async () => {
    const stores = await api.listStores({ includeArchived: true });
    dispatch({ type: 'stores', stores });
    return stores;
  }, [api, dispatch]);

  const refreshDailyStatuses = useCallback(async () => {
    const sequence = ++dailyStatusSequenceRef.current;
    dispatch({ type: 'daily-status-loading' });
    try {
      const projection = await api.listStoreDailyStatuses({
        marketplace: 'US',
        includeInactive: true,
        includeArchived: true,
      });
      if (!mountedRef.current || sequence !== dailyStatusSequenceRef.current) {
        return [...projection.stores];
      }
      const statuses = [...projection.stores];
      dispatch({ type: 'daily-statuses', statuses, generatedAt: projection.generatedAt });
      return statuses;
    } catch (error) {
      if (mountedRef.current && sequence === dailyStatusSequenceRef.current) {
        dispatch({ type: 'daily-status-error', error: errorMessage(error) });
      }
      throw error;
    }
  }, [api, dispatch]);

  const readActiveView = useCallback(async (): Promise<StoreWorkspaceView | null> => {
    return api.getActiveStoreWorkspaceView();
  }, [api]);

  const resyncAuthority = useCallback(async (
    phaseWhenMissing: MissionControlStorePhase = 'needs-selection',
    reservedSequence?: number,
  ): Promise<StoreWorkspaceView | null> => {
    const sequence = reservedSequence ?? ++resyncSequenceRef.current;
    if (!mountedRef.current || sequence !== resyncSequenceRef.current) return null;
    let view: StoreWorkspaceView | null;
    try {
      view = await readActiveView();
    } catch (error) {
      if (!mountedRef.current || sequence !== resyncSequenceRef.current) return null;
      throw error;
    }
    if (!mountedRef.current || sequence !== resyncSequenceRef.current) return null;
    if (view) dispatch({ type: 'authority', view });
    else dispatch({ type: 'clear-authority', phase: phaseWhenMissing });
    return view;
  }, [dispatch, readActiveView]);

  const runBestEffortPostCommitSync = useCallback(async (
    operation: string,
    tasks: ReadonlyArray<() => Promise<unknown>>,
  ): Promise<void> => {
    const sequence = ++postCommitSyncSequenceRef.current;
    const outcomes = await Promise.allSettled(
      tasks.map((task) => Promise.resolve().then(task)),
    );
    if (!mountedRef.current || sequence !== postCommitSyncSequenceRef.current) return;
    const failures = outcomes.filter(
      (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected',
    );
    if (failures.length === 0) {
      dispatch({ type: 'post-commit-sync-warning', warning: null });
      return;
    }
    const detail = failures.map((failure) => errorMessage(failure.reason)).join('；');
    dispatch({
      type: 'post-commit-sync-warning',
      warning: `写入成功，刷新失败/需重新同步（${operation}）：${detail}`,
    });
  }, [dispatch]);

  useEffect(() => {
    mountedRef.current = true;
    let disposed = false;
    const bootstrap = async () => {
      const authoritySequence = ++resyncSequenceRef.current;
      try {
        await refreshStores();
        await Promise.allSettled([refreshDailyStatuses()]);
        if (!disposed) await resyncAuthority('needs-selection', authoritySequence);
      } catch (error) {
        if (!disposed) dispatch({ type: 'error', error: errorMessage(error) });
      }
    };
    void bootstrap();

    const removeContextListener = api.onStoreContextChanged((view) => {
      ++resyncSequenceRef.current;
      if (view) dispatch({ type: 'authority', view });
      else dispatch({ type: 'clear-authority', phase: 'needs-selection' });
      void refreshDailyStatuses().catch(() => undefined);
    });
    const removeStoresListener = api.onStoresChanged((store) => {
      const current = stateRef.current;
      const nextStores = replaceStore(current.stores, store);
      dispatch({ type: 'stores', stores: nextStores });
      void refreshDailyStatuses().catch(() => undefined);
      if (current.activeStore?.storeId !== store.storeId) return;
      if (store.status !== 'active') {
        ++resyncSequenceRef.current;
        dispatch({ type: 'clear-authority', phase: 'needs-selection' });
        return;
      }
      const identityChanged = current.activeStore.businessTimezone !== store.businessTimezone
        || current.activeStore.browserProfileId !== store.browserProfileId
        || current.activeStore.marketplace !== store.marketplace
        || current.activeStore.currency !== store.currency;
      if (identityChanged) {
        dispatch({ type: 'clear-authority', phase: 'loading' });
        void resyncAuthority('needs-selection').catch((error) => {
          dispatch({ type: 'error', error: errorMessage(error) });
        });
      } else {
        dispatch({ type: 'active-record', store });
      }
    });

    return () => {
      disposed = true;
      mountedRef.current = false;
      ++resyncSequenceRef.current;
      ++dailyStatusSequenceRef.current;
      ++postCommitSyncSequenceRef.current;
      removeContextListener();
      removeStoresListener();
    };
  }, [api, dispatch, refreshDailyStatuses, refreshStores, resyncAuthority]);

  const switchStore = useCallback(async (scope: StoreScopeRef) => {
    const switchSequence = ++switchSequenceRef.current;
    dispatch({ type: 'switching' });
    let view: StoreWorkspaceView;
    try {
      view = await requestStoreWorkspaceSwitch(api, scope);
    } catch (error) {
      if (switchSequence === switchSequenceRef.current) {
        if (error instanceof StoreSwitchAuthorityMismatchError) {
          dispatch({
            type: 'clear-authority',
            phase: 'error',
            error: errorMessage(error),
          });
        } else {
          dispatch({ type: 'error', error: errorMessage(error) });
        }
      }
      throw error;
    }
    if (!mountedRef.current || switchSequence !== switchSequenceRef.current) return view;
    dispatch({ type: 'authority', view });
    await runBestEffortPostCommitSync('切换店铺', [
      () => resyncAuthority('needs-selection'),
      refreshStores,
      refreshDailyStatuses,
    ]);
    return view;
  }, [
    api,
    dispatch,
    refreshDailyStatuses,
    refreshStores,
    resyncAuthority,
    runBestEffortPostCommitSync,
  ]);

  const retryBootstrap = useCallback(async () => {
    dispatch({ type: 'loading' });
    const authoritySequence = ++resyncSequenceRef.current;
    try {
      await refreshStores();
      await Promise.allSettled([refreshDailyStatuses()]);
      await resyncAuthority('needs-selection', authoritySequence);
      dispatch({ type: 'post-commit-sync-warning', warning: null });
    } catch (error) {
      dispatch({ type: 'error', error: errorMessage(error) });
    }
  }, [dispatch, refreshDailyStatuses, refreshStores, resyncAuthority]);

  const createStore = useCallback(async (input: CreateStoreInput) => {
    const store = await api.createStore(input);
    dispatch({ type: 'stores', stores: replaceStore(stateRef.current.stores, store) });
    await runBestEffortPostCommitSync('创建店铺', [refreshStores, refreshDailyStatuses]);
    return store;
  }, [api, dispatch, refreshDailyStatuses, refreshStores, runBestEffortPostCommitSync]);

  const updateStore = useCallback(async (input: UpdateStoreInput) => {
    const activeBefore = stateRef.current.activeStore?.storeId === input.storeId
      ? stateRef.current.activeStore
      : null;
    const store = await api.updateStore(input);
    const wasActive = activeBefore !== null;
    const changesAuthority = activeBefore !== null && (
      activeBefore.status !== store.status
      || activeBefore.businessTimezone !== store.businessTimezone
      || activeBefore.browserProfileId !== store.browserProfileId
      || activeBefore.marketplace !== store.marketplace
      || activeBefore.currency !== store.currency
    );
    dispatch({ type: 'stores', stores: replaceStore(stateRef.current.stores, store) });
    if (changesAuthority) {
      dispatch({ type: 'clear-authority', phase: 'loading' });
    } else if (wasActive) {
      dispatch({ type: 'active-record', store });
    }
    await runBestEffortPostCommitSync('更新店铺', [
      ...(changesAuthority ? [() => resyncAuthority('needs-selection')] : []),
      refreshStores,
      refreshDailyStatuses,
    ]);
    return store;
  }, [
    api,
    dispatch,
    refreshDailyStatuses,
    refreshStores,
    resyncAuthority,
    runBestEffortPostCommitSync,
  ]);

  const archiveStore = useCallback(async (input: ArchiveStoreInput) => {
    const wasActive = stateRef.current.activeStore?.storeId === input.storeId;
    const store = await api.archiveStore(input);
    dispatch({ type: 'stores', stores: replaceStore(stateRef.current.stores, store) });
    if (wasActive) {
      ++resyncSequenceRef.current;
      dispatch({ type: 'clear-authority', phase: 'needs-selection' });
    }
    await runBestEffortPostCommitSync('归档店铺', [refreshStores, refreshDailyStatuses]);
    return store;
  }, [api, dispatch, refreshDailyStatuses, refreshStores, runBestEffortPostCommitSync]);

  const restoreStore = useCallback(async (input: RestoreStoreInput) => {
    const store = await api.restoreStore(input);
    dispatch({ type: 'stores', stores: replaceStore(stateRef.current.stores, store) });
    await runBestEffortPostCommitSync('恢复店铺', [refreshStores, refreshDailyStatuses]);
    return store;
  }, [api, dispatch, refreshDailyStatuses, refreshStores, runBestEffortPostCommitSync]);

  const bindLingxingConnection = useCallback(async (
    accountLabel: string,
    collectionStoreName: string,
  ) => {
    const activeView = stateRef.current.activeView;
    if (!activeView) throw new Error('当前没有 Main 授权店铺，无法绑定领星连接。');
    const normalizedAccountLabel = accountLabel.trim();
    if (!normalizedAccountLabel) throw new Error('请输入领星用户名后再绑定。');
    const normalizedCollectionStoreName = normalizeLingxingCollectionStoreName(collectionStoreName);
    if (!normalizedCollectionStoreName) {
      throw new Error('请输入与领星下载中心显示完全一致的店铺名称后再绑定。');
    }
    const existing = activeView.connections.find((connection) => connection.provider === 'lingxing');
    if (
      existing?.accountLabel?.trim() === normalizedAccountLabel
      && existing.normalizedCollectionStoreName === normalizedCollectionStoreName
    ) return existing;
    const changed = existing
      ? await api.updateStoreConnection({
        id: existing.id,
        storeId: activeView.store.storeId,
        accountLabel: normalizedAccountLabel,
        collectionStoreName: collectionStoreName.trim(),
        expectedUpdatedAt: existing.updatedAt,
      })
      : await api.createStoreConnection({
        storeId: activeView.store.storeId,
        provider: 'lingxing',
        accountLabel: normalizedAccountLabel,
        collectionStoreName: collectionStoreName.trim(),
      });
    dispatch({ type: 'connection-committed', connection: changed });
    await runBestEffortPostCommitSync('保存领星映射', [
      async () => {
        const confirmedView = await readActiveView();
        if (!confirmedView || !sameStoreAuthorityIdentity(activeView, confirmedView)) {
          throw new Error('店铺权限上下文已变化');
        }
        const confirmed = confirmedView.connections.find((candidate) =>
          candidate.provider === 'lingxing'
          && candidate.storeId === confirmedView.store.storeId
          && candidate.id === changed.id
          && candidate.accountLabel?.trim() === normalizedAccountLabel
          && candidate.normalizedCollectionStoreName === normalizedCollectionStoreName
          && candidate.status === 'not_configured'
          && !candidate.lastVerifiedAt
          && hasExpectedIdentityResetFailure(candidate, existing)
          && isResetConnectionSession(candidate, existing));
        if (!confirmed) throw new Error('Main 权限上下文尚未回读该映射');
        dispatch({ type: 'authority', view: confirmedView });
      },
      refreshDailyStatuses,
    ]);
    return changed;
  }, [api, dispatch, readActiveView, refreshDailyStatuses, runBestEffortPostCommitSync]);

  const unbindStoreConnection = useCallback(async (connection: StoreConnection) => {
    const activeView = stateRef.current.activeView;
    if (!activeView) throw new Error('当前没有 Main 授权店铺，无法解绑连接。');
    const existing = activeView.connections.find((candidate) =>
      candidate.id === connection.id && candidate.provider === connection.provider);
    if (!existing) return;
    await api.removeStoreConnection({
      id: connection.id,
      storeId: activeView.store.storeId,
      expectedUpdatedAt: connection.updatedAt,
    });
    dispatch({ type: 'connection-removed', connection });
    await runBestEffortPostCommitSync('解绑连接映射', [
      async () => {
        const confirmedView = await readActiveView();
        if (!confirmedView || !sameStoreAuthorityIdentity(activeView, confirmedView)) {
          throw new Error('店铺权限上下文已变化');
        }
        if (confirmedView.connections.some((candidate) => candidate.id === connection.id)) {
          throw new Error('Main 权限上下文尚未回读解绑结果');
        }
        dispatch({ type: 'authority', view: confirmedView });
      },
      refreshDailyStatuses,
    ]);
  }, [api, dispatch, readActiveView, refreshDailyStatuses, runBestEffortPostCommitSync]);

  const value = useMemo<MissionControlStoreContextValue>(() => ({
    ...state,
    switchStore,
    refreshStores,
    refreshDailyStatuses,
    retryBootstrap,
    createStore,
    updateStore,
    archiveStore,
    restoreStore,
    bindLingxingConnection,
    unbindStoreConnection,
  }), [
    state,
    switchStore,
    refreshStores,
    refreshDailyStatuses,
    retryBootstrap,
    createStore,
    updateStore,
    archiveStore,
    restoreStore,
    bindLingxingConnection,
    unbindStoreConnection,
  ]);

  return (
    <MissionControlStoreContext.Provider value={value}>
      {children}
    </MissionControlStoreContext.Provider>
  );
}

export function useMissionControlStoreContext(): MissionControlStoreContextValue {
  const value = useContext(MissionControlStoreContext);
  if (!value) throw new Error('MissionControlStoreContextProvider is required');
  return value;
}

function replaceStore(stores: StoreRecord[], store: StoreRecord): StoreRecord[] {
  const index = stores.findIndex((row) => row.storeId === store.storeId);
  if (index === -1) return [...stores, store];
  return stores.map((row, rowIndex) => rowIndex === index ? store : row);
}

function replaceConnection(
  connections: StoreConnection[],
  connection: StoreConnection,
): StoreConnection[] {
  const index = connections.findIndex((candidate) => candidate.id === connection.id);
  if (index === -1) return [...connections, connection];
  return connections.map((candidate, candidateIndex) =>
    candidateIndex === index ? connection : candidate);
}

function sameStoreAuthorityIdentity(
  expected: StoreWorkspaceView,
  actual: StoreWorkspaceView,
): boolean {
  return expected.store.storeId === actual.store.storeId
    && expected.context.storeId === actual.context.storeId
    && expected.context.browserProfileId === actual.context.browserProfileId
    && expected.context.marketplace === actual.context.marketplace
    && expected.context.currency === actual.context.currency
    && expected.context.businessTimezone === actual.context.businessTimezone
    && expected.context.businessDate === actual.context.businessDate
    && Number(actual.context.sessionGeneration) >= Number(expected.context.sessionGeneration);
}

function isResetConnectionSession(
  candidate: StoreConnection,
  previous?: StoreConnection,
): boolean {
  const session = candidate.session;
  if (!session) return true;
  if (
    session.status !== 'signed_out'
    || session.accountLabel
    || session.externalAccountId
    || session.verifiedAt
    || session.expiresAt
  ) return false;
  const previousGeneration = Number(previous?.session?.sessionGeneration ?? -1);
  return Number(session.sessionGeneration) > previousGeneration;
}

function hasExpectedIdentityResetFailure(
  candidate: StoreConnection,
  previous?: StoreConnection,
): boolean {
  return previous
    ? candidate.lastFailureCode === 'connection_identity_changed'
    : !candidate.lastFailureCode;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

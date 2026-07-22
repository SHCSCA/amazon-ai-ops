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
  type ArchiveStoreInput,
  type CreateStoreInput,
  type RestoreStoreInput,
  type StoreContextEnvelope,
  type StoreId,
  type StoreRecord,
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
}

export interface MissionControlStoreContextValue extends MissionControlStoreState {
  switchStore(storeId: StoreId): Promise<StoreWorkspaceView>;
  refreshStores(): Promise<StoreRecord[]>;
  retryBootstrap(): Promise<void>;
  createStore(input: CreateStoreInput): Promise<StoreRecord>;
  updateStore(input: UpdateStoreInput): Promise<StoreRecord>;
  archiveStore(input: ArchiveStoreInput): Promise<StoreRecord>;
  restoreStore(input: RestoreStoreInput): Promise<StoreRecord>;
}

export type MissionControlStoreAction =
  | { type: 'stores'; stores: StoreRecord[] }
  | { type: 'loading' }
  | { type: 'switching' }
  | { type: 'authority'; view: StoreWorkspaceView }
  | { type: 'clear-authority'; phase?: MissionControlStorePhase; error?: string | null }
  | { type: 'active-record'; store: StoreRecord }
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

  const readActiveView = useCallback(async (): Promise<StoreWorkspaceView | null> => {
    const first = await api.getActiveStoreContext();
    if (!first) return null;
    const store = await api.getStore(first.storeId);
    const confirmed = await api.getActiveStoreContext();
    if (!confirmed || missionControlContextKey(first) !== missionControlContextKey(confirmed)) {
      return null;
    }
    return { store, context: confirmed, connections: [], sessions: [] };
  }, [api]);

  const resyncAuthority = useCallback(async (phaseWhenMissing: MissionControlStorePhase = 'needs-selection') => {
    const sequence = ++resyncSequenceRef.current;
    let view: StoreWorkspaceView | null;
    try {
      view = await readActiveView();
    } catch (error) {
      if (!mountedRef.current || sequence !== resyncSequenceRef.current) return;
      throw error;
    }
    if (!mountedRef.current || sequence !== resyncSequenceRef.current) return;
    if (view) dispatch({ type: 'authority', view });
    else dispatch({ type: 'clear-authority', phase: phaseWhenMissing });
  }, [dispatch, readActiveView]);

  useEffect(() => {
    mountedRef.current = true;
    let disposed = false;
    const bootstrap = async () => {
      try {
        await refreshStores();
        if (!disposed) await resyncAuthority('needs-selection');
      } catch (error) {
        if (!disposed) dispatch({ type: 'error', error: errorMessage(error) });
      }
    };
    void bootstrap();

    const removeContextListener = api.onStoreContextChanged(() => {
      void resyncAuthority('needs-selection').catch((error) => {
        dispatch({ type: 'error', error: errorMessage(error) });
      });
    });
    const removeStoresListener = api.onStoresChanged((store) => {
      const current = stateRef.current;
      const nextStores = replaceStore(current.stores, store);
      dispatch({ type: 'stores', stores: nextStores });
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
      removeContextListener();
      removeStoresListener();
    };
  }, [api, dispatch, refreshStores, resyncAuthority]);

  const switchStore = useCallback(async (storeId: StoreId) => {
    const switchSequence = ++switchSequenceRef.current;
    dispatch({ type: 'switching' });
    try {
      const view = await api.switchStore(storeId);
      if (!mountedRef.current || switchSequence !== switchSequenceRef.current) return view;
      await resyncAuthority('needs-selection');
      await refreshStores();
      return view;
    } catch (error) {
      if (switchSequence === switchSequenceRef.current) {
        dispatch({ type: 'error', error: errorMessage(error) });
      }
      throw error;
    }
  }, [api, dispatch, refreshStores, resyncAuthority]);

  const retryBootstrap = useCallback(async () => {
    dispatch({ type: 'loading' });
    try {
      await refreshStores();
      await resyncAuthority('needs-selection');
    } catch (error) {
      dispatch({ type: 'error', error: errorMessage(error) });
    }
  }, [dispatch, refreshStores, resyncAuthority]);

  const createStore = useCallback(async (input: CreateStoreInput) => {
    const store = await api.createStore(input);
    await refreshStores();
    return store;
  }, [api, refreshStores]);

  const updateStore = useCallback(async (input: UpdateStoreInput) => {
    const wasActive = stateRef.current.activeStore?.storeId === input.storeId;
    const changesAuthority = wasActive && (
      Object.prototype.hasOwnProperty.call(input.patch, 'businessTimezone')
      || (Object.prototype.hasOwnProperty.call(input.patch, 'status') && input.patch.status !== 'active')
    );
    const store = await api.updateStore(input);
    if (changesAuthority) {
      dispatch({ type: 'clear-authority', phase: 'loading' });
      await resyncAuthority('needs-selection');
    } else if (wasActive) {
      dispatch({ type: 'active-record', store });
    }
    await refreshStores();
    return store;
  }, [api, dispatch, refreshStores, resyncAuthority]);

  const archiveStore = useCallback(async (input: ArchiveStoreInput) => {
    const wasActive = stateRef.current.activeStore?.storeId === input.storeId;
    const store = await api.archiveStore(input);
    if (wasActive) {
      ++resyncSequenceRef.current;
      dispatch({ type: 'clear-authority', phase: 'needs-selection' });
    }
    await refreshStores();
    return store;
  }, [api, dispatch, refreshStores]);

  const restoreStore = useCallback(async (input: RestoreStoreInput) => {
    const store = await api.restoreStore(input);
    await refreshStores();
    return store;
  }, [api, refreshStores]);

  const value = useMemo<MissionControlStoreContextValue>(() => ({
    ...state,
    switchStore,
    refreshStores,
    retryBootstrap,
    createStore,
    updateStore,
    archiveStore,
    restoreStore,
  }), [state, switchStore, refreshStores, retryBootstrap, createStore, updateStore, archiveStore, restoreStore]);

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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

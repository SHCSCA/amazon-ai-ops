import { useMemo, useState, type ReactNode } from 'react';
import type { StoreId, StoreRecord } from '@amazon-ai-ops/shared-types';
import {
  useMissionControlStoreContext,
  type MissionControlStorePhase,
} from './store-context';

export interface MissionControlStoreGateViewProps {
  phase: MissionControlStorePhase;
  stores: StoreRecord[];
  error: string | null;
  selectedStoreId: string;
  onSelectedStoreIdChange(storeId: string): void;
  onConfirm(): void;
  onRetry(): void;
  createDisplayName: string;
  onCreateDisplayNameChange(displayName: string): void;
  creating: boolean;
  createError: string | null;
  onCreate(): void;
  children: ReactNode;
}

export function MissionControlStoreGateView(props: MissionControlStoreGateViewProps) {
  if (props.phase === 'ready') return <>{props.children}</>;
  if (props.phase === 'loading' || props.phase === 'switching') {
    return (
      <main className="mission-control-store-gate" data-state={props.phase} aria-busy="true" aria-live="polite">
        <section className="mission-control-store-gate__card mission-control-store-gate__card--loading">
          <p className="mission-control-store-gate__status">正在读取 Main 授权店铺上下文…</p>
        </section>
      </main>
    );
  }
  if (props.phase === 'error') {
    return (
      <main className="mission-control-store-gate" data-state="error" role="alert">
        <section className="mission-control-store-gate__card mission-control-store-gate__card--error">
          <h1 className="mission-control-store-gate__title">店铺上下文暂不可用</h1>
          <p className="mission-control-store-gate__error">{props.error || '无法读取店铺上下文。'}</p>
          <button className="mission-control-store-gate__retry" type="button" onClick={props.onRetry}>重新读取</button>
        </section>
      </main>
    );
  }

  const activeStores = props.stores.filter((store) => store.status === 'active');
  return (
    <main className="mission-control-store-gate" data-state="needs-selection" aria-labelledby="mission-control-store-gate-title">
      <section className="mission-control-store-gate__card mission-control-store-gate__card--selection">
        <header className="mission-control-store-gate__header">
          <p className="mission-control-store-gate__eyebrow">MISSION CONTROL · US / USD</p>
          <h1 className="mission-control-store-gate__title" id="mission-control-store-gate-title">选择本次运营店铺</h1>
          <p className="mission-control-store-gate__description">首次进入必须明确选择。系统不会自动绑定店铺，也不会跨店铺复用数据或浏览器会话。</p>
        </header>
        <div className="mission-control-store-gate__selection-form">
          {activeStores.length === 0 ? (
            <p className="mission-control-store-gate__status" role="status">暂无可用店铺。创建后仍需由你明确选择并确认进入。</p>
          ) : (
            <>
              <label className="mission-control-store-gate__label" htmlFor="mission-control-store-select">美国站店铺</label>
              <select
                className="mission-control-store-gate__select"
                id="mission-control-store-select"
                value={props.selectedStoreId}
                onChange={(event) => props.onSelectedStoreIdChange(event.currentTarget.value)}
              >
                <option value="">请选择店铺</option>
                {activeStores.map((store) => (
                  <option key={store.storeId} value={store.storeId}>
                    {store.displayName} · US · USD
                  </option>
                ))}
              </select>
              <button className="mission-control-store-gate__confirm" type="button" disabled={!props.selectedStoreId} onClick={props.onConfirm}>
                进入所选店铺
              </button>
            </>
          )}
        </div>
      </section>
      <section className="mission-control-store-gate__card mission-control-store-gate__card--create" aria-labelledby="mission-control-store-create-title">
        <h2 className="mission-control-store-gate__subtitle" id="mission-control-store-create-title">创建美国站店铺</h2>
        <form className="mission-control-store-gate__create-form" onSubmit={(event) => { event.preventDefault(); props.onCreate(); }}>
          <label className="mission-control-store-gate__label" htmlFor="mission-control-store-name">店铺名称</label>
          <input
            className="mission-control-store-gate__input"
            id="mission-control-store-name"
            value={props.createDisplayName}
            maxLength={120}
            placeholder="例如 SHC001"
            disabled={props.creating}
            onChange={(event) => props.onCreateDisplayNameChange(event.currentTarget.value)}
          />
          <div className="mission-control-store-gate__fixed-fields" aria-label="固定站点配置">
            <span>站点 <strong>US</strong></span>
            <span>币种 <strong>USD</strong></span>
            <span>业务时区 <strong>America/Los_Angeles</strong></span>
          </div>
          <div className="mission-control-store-gate__feedback" aria-live="polite">
            {props.createError ? <p className="mission-control-store-gate__error">{props.createError}</p> : null}
          </div>
          <button
            className="mission-control-store-gate__create"
            type="submit"
            disabled={props.creating || !props.createDisplayName.trim()}
            aria-busy={props.creating}
          >
            {props.creating ? '创建中…' : '创建美国站店铺'}
          </button>
        </form>
      </section>
    </main>
  );
}

export function MissionControlStoreGate({ children }: { children: ReactNode }) {
  const store = useMissionControlStoreContext();
  const [selectedStoreId, setSelectedStoreId] = useState('');
  const [createDisplayName, setCreateDisplayName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const selected = useMemo(
    () => store.stores.find((row) => row.storeId === selectedStoreId && row.status === 'active'),
    [selectedStoreId, store.stores],
  );
  return (
    <MissionControlStoreGateView
      phase={store.phase}
      stores={store.stores}
      error={store.error}
      selectedStoreId={selectedStoreId}
      onSelectedStoreIdChange={setSelectedStoreId}
      onConfirm={() => {
        if (selected) void store.switchStore(selected.storeId as StoreId).catch(() => undefined);
      }}
      onRetry={() => { void store.retryBootstrap(); }}
      createDisplayName={createDisplayName}
      onCreateDisplayNameChange={setCreateDisplayName}
      creating={creating}
      createError={createError}
      onCreate={() => {
        const displayName = createDisplayName.trim();
        if (!displayName || creating) return;
        setCreating(true);
        setCreateError(null);
        void store.createStore({
          displayName,
          marketplace: 'US',
          currency: 'USD',
          businessTimezone: 'America/Los_Angeles',
        }).then(() => {
          setCreateDisplayName('');
        }).catch((error: unknown) => {
          setCreateError(error instanceof Error ? error.message : String(error));
        }).finally(() => {
          setCreating(false);
        });
      }}
    >
      {children}
    </MissionControlStoreGateView>
  );
}

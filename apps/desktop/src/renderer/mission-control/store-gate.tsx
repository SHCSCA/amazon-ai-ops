import type { ReactNode } from 'react';
import type {
  CreateStoreInput,
  StoreContextEnvelope,
  StoreDailyStatusProjection,
  StoreRecord,
  StoreScopeRef,
} from '@amazon-ai-ops/shared-types';
import { StoreScopeSwitcher } from '../components/store-scope-switcher';
import {
  useMissionControlStoreContext,
  type MissionControlStorePhase,
} from './store-context';

export interface MissionControlStoreGateViewProps {
  phase: MissionControlStorePhase;
  stores: readonly StoreRecord[];
  activeStore?: StoreRecord | null;
  authoritativeContext?: StoreContextEnvelope | null;
  dailyStatuses?: readonly StoreDailyStatusProjection[];
  dailyStatusPhase?: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  dailyStatusError?: string | null;
  onSwitch(scope: StoreScopeRef): Promise<unknown> | unknown;
  onCreate(input: CreateStoreInput): Promise<StoreRecord> | StoreRecord;
  onRetry(): Promise<unknown> | unknown;
  children: ReactNode;
}

function gateCopy(phase: MissionControlStorePhase) {
  if (phase === 'loading') {
    return {
      eyebrow: '店铺范围 · 正在确认',
      title: '正在读取店铺范围',
      description: '正在进入运营工作台；店铺范围确认前只暂停店铺级数据与动作。',
    };
  }
  if (phase === 'switching') {
    return {
      eyebrow: '店铺范围 · 正在切换',
      title: '正在切换店铺',
      description: '系统正在切换独立数据和浏览器会话；完成后将直接进入该店铺工作台。',
    };
  }
  if (phase === 'error') {
    return {
      eyebrow: '店铺范围 · 已暂停',
      title: '店铺上下文暂不可用',
      description: '店铺范围读取失败，请点击“重试”再次确认当前店铺。',
    };
  }
  return {
    eyebrow: '店铺范围 · 美国站 / 美元',
    title: '从左侧新增或选择店铺',
    description: '应用已经进入。先创建美国站店铺，再明确切换到目标店铺；领星连接在系统设置内配置。',
  };
}

export function MissionControlStoreGateView(props: MissionControlStoreGateViewProps) {
  if (props.phase === 'ready') return <>{props.children}</>;
  const copy = gateCopy(props.phase);
  const busy = props.phase === 'loading' || props.phase === 'switching';
  const safeStoreError = props.error
    ? '店铺状态读取失败，请重试；仍失败时可展开诊断详情。'
    : null;

  return (
    <div
      aria-busy={busy || undefined}
      className="mission-control-shell mission-control-store-gate-shell"
      data-state={props.phase}
    >
      <header className="mission-control-store-gate-shell__topbar">
        <div className="mission-control-store-gate-shell__brand">
          <span aria-hidden="true">A</span>
          <div>
            <strong>运营巡航台</strong>
            <small>Amazon US · USD</small>
          </div>
        </div>
        <span className="mission-control-store-gate-shell__authority">店铺范围待确认</span>
      </header>

      <div className="app-body mission-control-body mission-control-store-gate-shell__body">
        <nav aria-label="店铺范围导航" className="app-sidebar mission-control-store-gate__sidebar">
          <div className="app-sidebar-scroll">
            <StoreScopeSwitcher
              activeStore={props.activeStore}
              authoritativeContext={props.authoritativeContext}
              dailyStatusError={props.dailyStatusError}
              dailyStatusPhase={props.dailyStatusPhase}
              dailyStatuses={props.dailyStatuses}
              error={safeStoreError}
              initiallyExpanded={props.phase === 'needs-selection' || props.phase === 'error'}
              onCreate={props.onCreate}
              onRetry={props.onRetry}
              onSwitch={props.onSwitch}
              phase={props.phase}
              stores={props.stores}
            />
            <section className="mission-control-store-gate__sidebar-hint" aria-label="店铺范围说明">
              <strong>唯一店铺入口</strong>
              <p>新增、查看和显式切换都在上方完成。店铺级业务导航会在选择后启用。</p>
            </section>
          </div>
        </nav>

        <main
          aria-labelledby="mission-control-store-gate-title"
          className="app-content mission-control-content mission-control-store-gate__main"
        >
          <section
            className="mission-control-store-gate__safe-state"
            role={props.phase === 'error' ? 'alert' : 'status'}
          >
            <span>{copy.eyebrow}</span>
            <h1 id="mission-control-store-gate-title">{copy.title}</h1>
            <p>{copy.description}</p>
            {props.phase === 'error' && props.error && (
              <details>
                <summary>诊断详情</summary>
                <code>{props.error}</code>
              </details>
            )}
            <div aria-label="安全边界" className="mission-control-store-gate__boundaries">
              <span>创建后保持未选择</span>
              <span>切换后进入工作台</span>
              <span>店铺数据相互独立</span>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

export function MissionControlStoreGate({ children }: { children: ReactNode }) {
  const store = useMissionControlStoreContext();
  return (
    <MissionControlStoreGateView
      activeStore={store.activeStore}
      authoritativeContext={store.authoritativeContext}
      dailyStatusError={store.dailyStatusError}
      dailyStatusPhase={store.dailyStatusPhase}
      dailyStatuses={store.dailyStatuses}
      error={store.error}
      onCreate={store.createStore}
      onRetry={store.retryBootstrap}
      onSwitch={store.switchStore}
      phase={store.phase}
      stores={store.stores}
    >
      {children}
    </MissionControlStoreGateView>
  );
}

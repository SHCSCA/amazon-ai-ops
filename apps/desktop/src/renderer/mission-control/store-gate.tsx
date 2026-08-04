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

function gateCopy(phase: MissionControlStorePhase, error: string | null) {
  if (phase === 'loading') {
    return {
      eyebrow: 'STORE AUTHORITY · MAIN',
      title: '正在读取店铺范围',
      description: '店铺范围确认完成前，不会进入登录、采集、分析或执行流程。',
    };
  }
  if (phase === 'switching') {
    return {
      eyebrow: 'STORE AUTHORITY · SWITCHING',
      title: '正在切换店铺',
      description: 'Main 正在切换独立数据域与浏览器 Profile；完成后再进入该店铺登录。',
    };
  }
  if (phase === 'error') {
    return {
      eyebrow: 'STORE AUTHORITY · BLOCKED',
      title: '店铺上下文暂不可用',
      description: error || '请在左侧“店铺与站点”入口重试，所有店铺级动作当前均已停止。',
    };
  }
  return {
    eyebrow: 'STORE AUTHORITY · US / USD',
    title: '先从左侧选择或新增店铺',
    description: '新增只创建独立店铺数据域，不会自动切换。请对目标店铺明确点击“切换并登录”，再继续运营任务。',
  };
}

export function MissionControlStoreGateView(props: MissionControlStoreGateViewProps) {
  if (props.phase === 'ready') return <>{props.children}</>;
  const copy = gateCopy(props.phase, props.error);
  const busy = props.phase === 'loading' || props.phase === 'switching';

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
              error={props.error}
              initiallyExpanded={props.phase === 'needs-selection' || props.phase === 'error'}
              onCreate={props.onCreate}
              onRetry={props.onRetry}
              onSwitch={props.onSwitch}
              phase={props.phase}
              stores={props.stores}
            />
            <section className="mission-control-store-gate__sidebar-hint" aria-label="店铺范围说明">
              <strong>唯一店铺入口</strong>
              <p>新增、查看和显式切换都在上方完成。选择前不开放其他业务导航。</p>
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
            <div aria-label="安全边界" className="mission-control-store-gate__boundaries">
              <span>创建后保持未选择</span>
              <span>切换后再登录</span>
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

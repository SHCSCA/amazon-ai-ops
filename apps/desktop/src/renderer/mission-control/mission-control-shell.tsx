import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  CheckCircle,
  MagnifyingGlass,
  PlugsConnected,
  Question,
  Robot,
  SignOut,
  Sparkle,
  Storefront,
  Target,
  Warning,
  X,
} from '@phosphor-icons/react';
import type {
  MissionControlAutonomyMode,
  MissionControlAutonomyProjection,
  MissionControlCapabilityProjection,
  CreateStoreInput,
  StoreContextEnvelope,
  StoreDailyStatusProjection,
  StoreRecord,
  StoreScopeRef,
} from '@amazon-ai-ops/shared-types';
import { Sidebar, workspaceCapabilityState } from '../components/app-shell';
import {
  StoreScopeSwitcher,
  type StoreScopeSwitcherProps,
} from '../components/store-scope-switcher';
import { VISIBLE_WORKSPACES } from '../navigation';
import type { NavigationIntent } from '../navigation';

export const DEFAULT_BLOCKED_AUTONOMY: MissionControlAutonomyProjection = {
  currentMode: 'manual_approval',
  manualApprovalAvailable: true,
  policyAutoAvailable: false,
  policyAutoBlockerCode: 'POLICY_AUTHORITY_NOT_READY',
  policyAutoBlockerDetail: '策略内自动尚未获得真实执行权限，当前仅可人工审批。',
};

export interface MissionControlShellProps {
  activeIntent: NavigationIntent;
  pendingIntent?: NavigationIntent | null;
  stores: readonly StoreRecord[];
  activeStore?: StoreRecord | null;
  authoritativeContext: StoreContextEnvelope;
  storePhase?: StoreScopeSwitcherProps['phase'];
  storeError?: string | null;
  storeSyncWarning?: string | null;
  dailyStatuses?: readonly StoreDailyStatusProjection[];
  dailyStatusPhase?: 'idle' | 'loading' | 'ready' | 'error';
  dailyStatusError?: string | null;
  capabilities?: readonly MissionControlCapabilityProjection[];
  autonomy?: MissionControlAutonomyProjection | null;
  onNavigate: (intent: NavigationIntent) => void;
  onSwitchStore: (scope: StoreScopeRef) => Promise<unknown> | unknown;
  onCreateStore?: (input: CreateStoreInput) => Promise<StoreRecord> | StoreRecord;
  onRetryStores?: () => Promise<unknown> | unknown;
  onSetAutonomyMode?: (mode: MissionControlAutonomyMode) => Promise<unknown> | unknown;
  onLogout: () => Promise<unknown> | unknown;
  brandBadges?: React.ReactNode;
  contextTools?: React.ReactNode;
  sessionStatus?: React.ReactNode;
  routeHandoff?: boolean;
  contentRef?: React.Ref<HTMLElement>;
  children: React.ReactNode;
}

export function annotateMissionControlSidebarScrollOwner(root: ParentNode | null): void {
  const scrollOwner = root?.querySelector<HTMLElement>('.app-sidebar-scroll');
  if (!scrollOwner) return;
  scrollOwner.setAttribute('data-scroll-owner', 'main-navigation');
  scrollOwner.setAttribute('role', 'region');
  scrollOwner.setAttribute('aria-label', '主业务导航滚动区');
}

function autonomyModeLabel(mode: MissionControlAutonomyMode): string {
  return mode === 'manual_approval' ? '人工审批' : 'AI 策略内自动';
}

export function MissionControlShell({
  activeIntent,
  pendingIntent = null,
  stores,
  activeStore,
  authoritativeContext,
  storePhase = 'ready',
  storeError,
  storeSyncWarning,
  dailyStatuses = [],
  dailyStatusPhase = 'idle',
  dailyStatusError,
  capabilities = [],
  autonomy = DEFAULT_BLOCKED_AUTONOMY,
  onNavigate,
  onSwitchStore,
  onCreateStore,
  onRetryStores,
  onSetAutonomyMode,
  onLogout,
  brandBadges,
  contextTools,
  sessionStatus,
  routeHandoff = Boolean(pendingIntent),
  contentRef,
  children,
}: MissionControlShellProps) {
  const projection = autonomy ?? DEFAULT_BLOCKED_AUTONOMY;
  const [pendingMode, setPendingMode] = useState<MissionControlAutonomyMode | null>(null);
  const [modeFeedback, setModeFeedback] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [globalPopover, setGlobalPopover] = useState<'boundaries' | 'help' | null>(null);
  const commandInputRef = useRef<HTMLInputElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const activeStoreId = String(authoritativeContext.storeId);
  const autoBlockerId = 'mission-control-auto-mode-blocker';
  const visibleCommandItems = useMemo(() => {
    const normalized = commandQuery.trim().toLocaleLowerCase('zh-CN');
    return VISIBLE_WORKSPACES.filter((workspace) => (
      !normalized
      || `${workspace.label} ${workspace.description}`.toLocaleLowerCase('zh-CN').includes(normalized)
    ));
  }, [commandQuery]);
  const constrainedWorkspaces = useMemo(() => VISIBLE_WORKSPACES.map((workspace) => ({
    workspace,
    state: workspaceCapabilityState(capabilities, workspace.id),
  })).filter((item) => item.state === 'BLOCKED' || item.state === 'MIXED'), [capabilities]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setGlobalPopover(null);
        setCommandOpen(true);
      } else if (event.key === 'Escape') {
        setCommandOpen(false);
        setGlobalPopover(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!commandOpen) return;
    setCommandQuery('');
    window.requestAnimationFrame(() => commandInputRef.current?.focus());
  }, [commandOpen]);

  useEffect(() => {
    if (!modeFeedback) return undefined;
    const timeout = window.setTimeout(() => setModeFeedback(''), 8_000);
    return () => window.clearTimeout(timeout);
  }, [modeFeedback]);

  useLayoutEffect(() => {
    annotateMissionControlSidebarScrollOwner(shellRef.current);
  }, []);

  async function requestMode(mode: MissionControlAutonomyMode) {
    if (pendingMode) return;
    if (mode === projection.currentMode) {
      setModeFeedback(`当前已经是${autonomyModeLabel(mode)}模式。`);
      return;
    }
    if (mode === 'policy_auto' && !projection.policyAutoAvailable) {
      setModeFeedback(
        projection.policyAutoBlockerDetail
        || '策略内自动尚未开放：请先到“策略与风控”发布并启用不可变策略版本。',
      );
      return;
    }
    if (!onSetAutonomyMode) {
      setModeFeedback('模式权限尚未同步，未改变当前模式。');
      return;
    }
    setPendingMode(mode);
    setModeFeedback('');
    try {
      const result = await onSetAutonomyMode(mode);
      if (result == null) {
        setModeFeedback('店铺上下文已变化，模式请求未生效，请重新确认。');
        return;
      }
      if (isBlockedModeResponse(result)) {
        setModeFeedback(result.detail || '模式请求被本机安全边界阻断。');
        return;
      }
      setModeFeedback(readModeResponseDetail(result) || `${autonomyModeLabel(mode)}请求已处理，当前状态以确认结果为准。`);
    } catch (error) {
      setModeFeedback(error instanceof Error ? error.message : '模式切换失败');
    } finally {
      setPendingMode(null);
    }
  }

  return (
    <div
      className={`app-shell mission-control-shell${sidebarCollapsed ? ' mission-control-sidebar-collapsed' : ''}`}
      data-store-context={activeStoreId}
      ref={shellRef}
    >
      <header className="topbar mission-control-topbar">
        <div className="mission-control-brand-lockup">
          <span className="mission-control-brand-mark" aria-hidden="true">
            <Robot size={21} weight="fill" />
          </span>
          <span className="mission-control-brand-copy">
            <span className="mission-control-brand-title">
              <strong>运营智能体</strong>
              <small>运营工作台</small>
            </span>
            {brandBadges && <span className="mission-control-brand-badges">{brandBadges}</span>}
          </span>
        </div>

        <div
          aria-label="当前店铺权威摘要"
          className="mission-control-topbar-select mission-control-store-select mission-control-store-select--readonly"
          data-error={storeError ? 'true' : undefined}
          data-store-id={activeStoreId}
          role="status"
          title={storeError || activeStore?.displayName || activeStoreId}
        >
          <Storefront aria-hidden="true" size={17} weight="duotone" />
          <span className="mission-control-store-field">
            <strong>{activeStore?.displayName || activeStoreId}</strong>
            <small>当前店铺</small>
          </span>
          <span className="mission-control-fixed-scope" aria-label="美国站，美元">
            <span>US</span>
            <span>USD</span>
          </span>
        </div>

        <div className="mission-control-product-scope" aria-label="当前产品范围">
          <Target aria-hidden="true" size={17} weight="duotone" />
          <span className="mission-control-product-scope-copy">
            {contextTools || (
              <>
                <strong>产品范围</strong>
                <small>在工作区内选择</small>
              </>
            )}
          </span>
          <time dateTime={authoritativeContext.businessDate} title={`业务日 ${authoritativeContext.businessDate}`}>
            {authoritativeContext.businessDate}
          </time>
        </div>

        <div className="mission-control-session-health" aria-label="当前浏览器会话状态">
          <PlugsConnected aria-hidden="true" size={17} weight="fill" />
          {sessionStatus || <span className="session-line session-line-warning">会话状态待同步</span>}
        </div>

        <div className="mission-control-mode" aria-label="AI 执行模式" role="group">
          <button
            aria-pressed={projection.currentMode === 'manual_approval'}
            className="mission-control-mode-button"
            disabled={Boolean(pendingMode)}
            onClick={() => void requestMode('manual_approval')}
            type="button"
          >
            {pendingMode === 'manual_approval' ? '切换中...' : '人工审批'}
          </button>
          <button
            aria-label="AI 策略内自动"
            aria-describedby={!projection.policyAutoAvailable ? autoBlockerId : undefined}
            aria-disabled={!projection.policyAutoAvailable || undefined}
            aria-pressed={projection.currentMode === 'policy_auto'}
            className="mission-control-mode-button"
            data-authority-blocked={!projection.policyAutoAvailable ? 'true' : undefined}
            disabled={Boolean(pendingMode)}
            onClick={() => void requestMode('policy_auto')}
            type="button"
          >
            <Sparkle aria-hidden="true" size={14} weight="fill" />
            {pendingMode === 'policy_auto' ? '切换中...' : '策略内自动'}
          </button>
          {!projection.policyAutoAvailable && (
            <span className="mission-control-mode-blocker" id={autoBlockerId}>
              {projection.policyAutoBlockerDetail || DEFAULT_BLOCKED_AUTONOMY.policyAutoBlockerDetail}
            </span>
          )}
          {modeFeedback && (
            <div className="mission-control-mode-feedback" role="status">
              <span>{modeFeedback}</span>
              {!projection.policyAutoAvailable && (
                <button
                  className="mission-control-mode-feedback__action"
                  onClick={() => {
                    setModeFeedback('');
                    onNavigate(VISIBLE_WORKSPACES.find((item) => item.id === 'policy')!.defaultIntent);
                  }}
                  type="button"
                >
                  去策略配置
                </button>
              )}
              <button
                aria-label="关闭模式提示"
                className="mission-control-mode-feedback__close"
                onClick={() => setModeFeedback('')}
                type="button"
              >
                <X aria-hidden="true" size={14} />
              </button>
            </div>
          )}
        </div>

        <button
          aria-label="打开全局工作区搜索"
          className="mission-control-global-search"
          onClick={() => {
            setGlobalPopover(null);
            setCommandOpen(true);
          }}
          type="button"
        >
          <MagnifyingGlass aria-hidden="true" size={17} />
          <span>搜索工作区</span>
          <kbd>Ctrl K</kbd>
        </button>

        <div className="mission-control-global-actions">
          <div className="mission-control-popover-anchor">
            <button
              aria-expanded={globalPopover === 'boundaries'}
              aria-label={`能力边界，${constrainedWorkspaces.length} 个工作区需关注`}
              className="mission-control-icon-button"
              onClick={() => setGlobalPopover((current) => current === 'boundaries' ? null : 'boundaries')}
              type="button"
            >
              <Bell aria-hidden="true" size={19} />
              {constrainedWorkspaces.length > 0 && (
                <span className="mission-control-notification-dot">{constrainedWorkspaces.length}</span>
              )}
            </button>
            {globalPopover === 'boundaries' && (
              <div className="mission-control-small-popover" role="status">
                <strong>生产能力边界</strong>
                {constrainedWorkspaces.map(({ workspace, state }) => (
                  <button
                    key={workspace.id}
                    onClick={() => {
                      setGlobalPopover(null);
                      onNavigate(workspace.defaultIntent);
                    }}
                    type="button"
                  >
                    <span>{workspace.label}</span>
                    <small>{state === 'BLOCKED' ? '受阻' : '部分可用'}</small>
                  </button>
                ))}
                {constrainedWorkspaces.length === 0 && <span>当前没有工作区级阻断。</span>}
              </div>
            )}
          </div>
          <div className="mission-control-popover-anchor">
            <button
              aria-expanded={globalPopover === 'help'}
              aria-label="查看任务控制台说明"
              className="mission-control-icon-button"
              onClick={() => setGlobalPopover((current) => current === 'help' ? null : 'help')}
              type="button"
            >
              <Question aria-hidden="true" size={19} />
            </button>
            {globalPopover === 'help' && (
              <div className="mission-control-small-popover mission-control-help-popover" role="note">
                <strong>安全执行边界</strong>
                <p>店铺、会话和模式均以本机安全进程的确认结果为准。策略内自动只有在真实权限链完整后才会开放。</p>
                <p>无法确认外部写入结果时必须停止并转人工，界面不会把“结果不确定”显示成成功。</p>
              </div>
            )}
          </div>
          <button
            aria-label="断开外部会话"
            className="mission-control-icon-button"
            onClick={() => void onLogout()}
            title="断开外部会话"
            type="button"
          >
            <SignOut aria-hidden="true" size={19} />
          </button>
        </div>
      </header>

      {(storeError || !activeStore) && (
        <div className="mission-control-shell-alert" role="alert">
          <Warning aria-hidden="true" size={16} weight="fill" />
          <span>{storeError || '当前店铺记录不可用，所有店铺级动作已停止。'}</span>
        </div>
      )}
      {storeSyncWarning && (
        <div className="mission-control-shell-alert mission-control-shell-alert--warning" role="status">
          <Warning aria-hidden="true" size={16} weight="fill" />
          <span>{storeSyncWarning}</span>
        </div>
      )}

      <div className="app-body mission-control-body">
        <Sidebar
          activeIntent={activeIntent}
          capabilities={capabilities}
          collapsed={sidebarCollapsed}
          onNavigate={onNavigate}
          onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
          pendingIntent={pendingIntent}
          storeScopeControl={(
            <StoreScopeSwitcher
              activeStore={activeStore}
              authoritativeContext={authoritativeContext}
              collapsed={sidebarCollapsed}
              dailyStatusError={dailyStatusError}
              dailyStatusPhase={dailyStatusPhase}
              dailyStatuses={dailyStatuses}
              error={storeError}
              onCreate={onCreateStore ?? (() => Promise.reject(new Error('店铺创建接口不可用。')))}
              onManage={() => onNavigate(
                VISIBLE_WORKSPACES.find((item) => item.id === 'settings')!.defaultIntent,
              )}
              onRetry={onRetryStores ?? (() => undefined)}
              onSwitch={onSwitchStore}
              phase={storePhase}
              stores={stores}
            />
          )}
        />
        <main
          className={`app-content mission-control-content${routeHandoff ? ' app-content-navigating' : ''}`}
          ref={contentRef}
        >
          {routeHandoff && (
            <div className="route-handoff-feedback" role="status" aria-live="polite">
              转跳中...
            </div>
          )}
          {children}
        </main>
      </div>

      {commandOpen && (
        <div
          className="mission-control-command-backdrop"
          onMouseDown={() => setCommandOpen(false)}
          role="presentation"
        >
          <section
            aria-label="全局工作区搜索"
            aria-modal="true"
            className="mission-control-command-palette"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="mission-control-command-search">
              <MagnifyingGlass aria-hidden="true" size={19} />
              <input
                aria-controls="mission-control-command-results"
                aria-label="搜索工作区"
                onChange={(event) => setCommandQuery(event.target.value)}
                placeholder="搜索任务、决策、执行或设置"
                ref={commandInputRef}
                value={commandQuery}
              />
              <button aria-label="关闭搜索" onClick={() => setCommandOpen(false)} type="button">
                <X aria-hidden="true" size={17} />
              </button>
            </div>
            <div className="mission-control-command-results" id="mission-control-command-results" role="listbox">
              {visibleCommandItems.map((workspace) => {
                const state = workspaceCapabilityState(capabilities, workspace.id);
                return (
                  <button
                    key={workspace.id}
                    onClick={() => {
                      setCommandOpen(false);
                      onNavigate(workspace.defaultIntent);
                    }}
                    role="option"
                    type="button"
                  >
                    <span>
                      <strong>{workspace.label}</strong>
                      <small>{workspace.description}</small>
                    </span>
                    {(state === 'BLOCKED' || state === 'MIXED') && (
                      <b data-state={state}>{state === 'BLOCKED' ? '受阻' : '部分可用'}</b>
                    )}
                  </button>
                );
              })}
              {visibleCommandItems.length === 0 && <p>没有匹配的工作区。</p>}
            </div>
            <footer>
              <span><kbd>Enter</kbd> 打开</span>
              <span><kbd>Esc</kbd> 关闭</span>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}

function isBlockedModeResponse(value: unknown): value is { status: 'BLOCKED'; detail?: string } {
  return Boolean(value && typeof value === 'object' && 'status' in value && value.status === 'BLOCKED');
}

function readModeResponseDetail(value: unknown): string | null {
  if (!value || typeof value !== 'object' || !('detail' in value)) return null;
  return typeof value.detail === 'string' && value.detail.trim() ? value.detail : null;
}

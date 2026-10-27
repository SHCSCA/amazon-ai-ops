import {
missionControlContextKey
} from '@amazon-ai-ops/shared-types';
import React,{ useCallback,useEffect,useLayoutEffect,useRef,useState } from 'react';
import { defaultOperationScopeForAuthority,operationScopeBelongsToAuthority } from './app-authority';
import { browserPreviewBootstrap } from './app-bootstrap';
import { createConnectionOperationGuard } from './app-connection-operation';
import {
describeLoginSession,
emptyStoreConnectionCredentialDraft,
emptyStoreLoginAttemptEvidence,
headerReadinessClass,
headerReadinessLabel,
headerSessionStatusLabel,
type StoreConnectionCredentialDraft,
type StoreConnectionLoginAction,
type StoreLoginAttemptEvidence,
} from './app-connection-presentations';
import { type LoginSessionInfo,useStore } from './app-login-state';
import { createAppNavigationEventHandler,createLatestWorkflowLoadGuard,resetWorkspaceScrollPosition,subscribeAppWorkflowInvalidation } from './app-navigation';
import { StoreConnectionWorkbench } from './app-store-connection-workbench';
import { useMissionControlBridge } from './mission-control/bridge/use-mission-control-bridge';
import { StoreManagementPanel,StoreRuntimeConfigPanel } from './mission-control/components';
import {
DEFAULT_BLOCKED_AUTONOMY,
MissionControlShell,
} from './mission-control/mission-control-shell';
import { LegacyAdapterRouter } from './mission-control/router';
import {
useMissionControlStoreContext
} from './mission-control/store-context';
import { MissionControlWorkspaceView } from './mission-control/workspaces';
import type { NavigationIntent } from './navigation';
import {
navigationIntentsEqual,
navigationNeedsGlobalHandoff,
normalizeNavigationTarget
} from './navigation';
import { readbackAuthorityForMode } from './pages/readback-workspace-model';
import { rendererRuntimeLog } from './runtime-log';
import { useScopeStore } from './scope-store';
import type { AppRoute,DeliveryReadinessView } from './types';
import { toUserFacingError } from './user-facing-error';
import type { WorkflowEvidence } from './workflow-state';
import { deriveWorkflowEvidence,selectNextSafeAction } from './workflow-state';

export function MissionControlRuntime({
  loginSession,
  onLoggedOut,
}: {
  loginSession?: LoginSessionInfo | null;
  onLoggedOut: () => void;
}) {
  const { activeNavigation, setActiveNavigation } = useStore();
  const store = useMissionControlStoreContext();
  const operationGuard = useRef(createConnectionOperationGuard()).current;
  operationGuard.update(store);
  useLayoutEffect(() => () => operationGuard.invalidate(), [operationGuard]);
  const [logoutError, setLogoutError] = useState('');
  useLayoutEffect(() => setLogoutError(''), [store.authorityKey, store.contextEpoch]);
  const missionControl = useMissionControlBridge();
  const credentialDraftStoreId = String(store.activeStore?.storeId ?? '');
  const [storeConnectionCredentialDraft, setStoreConnectionCredentialDraft] =
    useState<StoreConnectionCredentialDraft>(() => (
      emptyStoreConnectionCredentialDraft(credentialDraftStoreId)
    ));
  const [storeLoginAttemptEvidence, setStoreLoginAttemptEvidence] = useState<StoreLoginAttemptEvidence>(() => ({
    storeId: credentialDraftStoreId,
    sequence: 0,
    pending: false,
    action: 'initial',
    error: '',
  }));
  const scope = useScopeStore((state) => state.scope);
  const setScope = useScopeStore((state) => state.setScope);
  const [deliveryReadiness, setDeliveryReadiness] = useState<DeliveryReadinessView | null>(null);
  const [workflowEvidence, setWorkflowEvidence] = useState<WorkflowEvidence>(() => deriveWorkflowEvidence({}));
  const [pendingNavigationIntent, setPendingNavigationIntent] = useState<NavigationIntent | null>(null);
  const nextSafeAction = selectNextSafeAction(workflowEvidence);
  const readbackAuthority = readbackAuthorityForMode(
    browserPreviewBootstrap.enabled ? 'preview-readonly' : 'production',
  );
  const contentRef = useRef<HTMLElement | null>(null);
  const navigationTimerRef = useRef<number | null>(null);
  const operationScopeLoadSequenceRef = useRef(0);

  useLayoutEffect(() => {
    setStoreConnectionCredentialDraft((current) => (
      current.storeId === credentialDraftStoreId
        ? current
        : emptyStoreConnectionCredentialDraft(credentialDraftStoreId)
    ));
    setStoreLoginAttemptEvidence((current) => (
      current.storeId === credentialDraftStoreId
        ? current
        : emptyStoreLoginAttemptEvidence(credentialDraftStoreId)
    ));
  }, [credentialDraftStoreId]);

  const setScopedLoginAttemptSequence = useCallback<React.Dispatch<React.SetStateAction<number>>>((next) => {
    setStoreLoginAttemptEvidence((current) => {
      const currentSequence = current.storeId === credentialDraftStoreId ? current.sequence : null;
      if (currentSequence === null) return current;
      return {
        ...current,
        sequence: typeof next === 'function' ? next(currentSequence) : next,
      };
    });
  }, [credentialDraftStoreId]);

  const setScopedLoginAttemptPending = useCallback<React.Dispatch<React.SetStateAction<boolean>>>((next) => {
    setStoreLoginAttemptEvidence((current) => {
      if (current.storeId !== credentialDraftStoreId) return current;
      return {
        ...current,
        pending: typeof next === 'function' ? next(current.pending) : next,
      };
    });
  }, [credentialDraftStoreId]);

  const setScopedLoginAction = useCallback<React.Dispatch<React.SetStateAction<StoreConnectionLoginAction>>>((next) => {
    setStoreLoginAttemptEvidence((current) => {
      if (current.storeId !== credentialDraftStoreId) return current;
      return {
        ...current,
        action: typeof next === 'function' ? next(current.action) : next,
      };
    });
  }, [credentialDraftStoreId]);

  const setScopedLoginAttemptError = useCallback<React.Dispatch<React.SetStateAction<string>>>((next) => {
    setStoreLoginAttemptEvidence((current) => {
      if (current.storeId !== credentialDraftStoreId) return current;
      return {
        ...current,
        error: typeof next === 'function' ? next(current.error) : next,
      };
    });
  }, [credentialDraftStoreId]);

  const requestNavigate = useCallback((target: AppRoute | NavigationIntent) => {
    const intent = normalizeNavigationTarget(target);
    if (!intent) return;
    if (navigationIntentsEqual(intent, activeNavigation) && !pendingNavigationIntent) return;
    if (navigationTimerRef.current) window.clearTimeout(navigationTimerRef.current);
    setActiveNavigation(intent);
    if (!navigationNeedsGlobalHandoff(activeNavigation, intent)) {
      setPendingNavigationIntent(null);
      navigationTimerRef.current = null;
      return;
    }
    setPendingNavigationIntent(intent);
    navigationTimerRef.current = window.setTimeout(() => {
      setPendingNavigationIntent((current) => (navigationIntentsEqual(current, intent) ? null : current));
      navigationTimerRef.current = null;
    }, 150);
  }, [activeNavigation, pendingNavigationIntent, setActiveNavigation]);

  useEffect(() => {
    const handleNavigate = createAppNavigationEventHandler(requestNavigate);
    window.addEventListener('amazon-ai-ops:navigate', handleNavigate);
    return () => window.removeEventListener('amazon-ai-ops:navigate', handleNavigate);
  }, [requestNavigate]);

  useEffect(() => () => {
    if (navigationTimerRef.current) window.clearTimeout(navigationTimerRef.current);
  }, []);

  useLayoutEffect(() => {
    const content = contentRef.current;
    resetWorkspaceScrollPosition(content);
    const repaintFrame = window.requestAnimationFrame(() => resetWorkspaceScrollPosition(content));
    return () => window.cancelAnimationFrame(repaintFrame);
  }, [activeNavigation.subview, activeNavigation.workspace]);

  useEffect(() => {
    if (!store.authoritativeContext || !store.activeStore) return;
    const context = store.authoritativeContext;
    const storeName = store.activeStore.displayName;
    const authorityKey = missionControlContextKey(context);
    const requestSequence = ++operationScopeLoadSequenceRef.current;
    setDeliveryReadiness(null);
    setWorkflowEvidence(deriveWorkflowEvidence({}));
    setScope(defaultOperationScopeForAuthority(context, storeName));
    const api = (window as any).electronAPI;
    void api?.getOperationScope?.(context)
      .then((savedScope: unknown) => {
        if (
          requestSequence !== operationScopeLoadSequenceRef.current
          || store.authorityKey !== authorityKey
        ) return;
        if (operationScopeBelongsToAuthority(savedScope, context, storeName)) {
          setScope(savedScope);
        }
      })
      .catch((caught: unknown) => rendererRuntimeLog.error('renderer.operation_scope_restore_failed', { error: caught }));
    return () => {
      operationScopeLoadSequenceRef.current += 1;
    };
  }, [setScope, store.authorityKey]);

  useEffect(() => {
    if (!store.authoritativeContext || !store.authorityKey) return;
    const dashboardCapability = missionControl.capabilities.find((capability) => (
      capability.view === 'today/overview'
        && capability.action === 'view'
        && capability.state === 'LEGACY_ADAPTER'
    ));
    if (!dashboardCapability) {
      setDeliveryReadiness(null);
      setWorkflowEvidence(deriveWorkflowEvidence({ scope }));
      return;
    }
    let cancelled = false;
    const workflowLoadGuard = createLatestWorkflowLoadGuard();
    async function loadWorkflowState() {
      const loadSequence = workflowLoadGuard.begin();
      try {
        const api = (window as any).electronAPI;
        const pipeline = await api?.getBusinessUiDataPipeline?.(scope);
        const batchId = scope.batchId || pipeline?.collection?.latestBatch?.id;
        const filter = {
          dateFrom: scope.dateFrom,
          dateTo: scope.dateTo,
          storeName: scope.storeName,
          marketplaceCode: scope.marketplaceCode,
          asin: scope.asin,
          batchId,
          limit: 100,
        };
        const [pending, needsReview, approved, readback, readiness] = await Promise.all([
          api?.getRecommendations?.({ ...filter, status: 'pending' }) || [],
          api?.getRecommendations?.({ ...filter, status: 'needs_review' }) || [],
          api?.getRecommendations?.({ ...filter, status: 'approved' }) || [],
          api?.getDeliveryEvidenceStatus?.(filter) || null,
          api?.getDeliveryReadiness?.() || null,
        ]);
        if (!cancelled && workflowLoadGuard.isCurrent(loadSequence)) {
          setDeliveryReadiness(readiness || null);
          setWorkflowEvidence(deriveWorkflowEvidence({
            scope,
            pipeline,
            recommendations: {
              pending: Array.isArray(pending) ? pending.length : 0,
              needsReview: Array.isArray(needsReview) ? needsReview.length : 0,
              approved: Array.isArray(approved) ? approved.length : 0,
            },
            readback: readback?.readback,
            readiness,
          }));
        }
      } catch (caught) {
        rendererRuntimeLog.error('renderer.workflow_state_load_failed', { error: caught });
        if (!cancelled && workflowLoadGuard.isCurrent(loadSequence)) {
          setDeliveryReadiness(null);
          setWorkflowEvidence(deriveWorkflowEvidence({ scope }));
        }
      }
    }

    loadWorkflowState();
    window.addEventListener('business-ui:data-updated', loadWorkflowState);
    const unsubscribeWorkflowInvalidation = subscribeAppWorkflowInvalidation(() => {
      void loadWorkflowState();
    });
    return () => {
      cancelled = true;
      workflowLoadGuard.invalidate();
      window.removeEventListener('business-ui:data-updated', loadWorkflowState);
      unsubscribeWorkflowInvalidation();
    };
  }, [missionControl.capabilities, scope, store.authorityKey, store.authoritativeContext]);

  async function handleLogout() {
    const isCurrent = operationGuard.capture();
    setLogoutError('');
    try {
      await (window as any).electronAPI.browserLogout();
      if (!isCurrent()) return;
      onLoggedOut();
    } catch (caught) {
      rendererRuntimeLog.error('renderer.logout_failed', { error: caught });
      if (isCurrent()) setLogoutError(toUserFacingError(caught, '退出登录未完成，请重试。'));
    }
  }

  if (!store.authoritativeContext || !store.activeStore) return null;
  const scopedStoreConnectionCredentialDraft =
    storeConnectionCredentialDraft.storeId === credentialDraftStoreId
      ? storeConnectionCredentialDraft
      : emptyStoreConnectionCredentialDraft(credentialDraftStoreId);
  const scopedLoginAttemptEvidence =
    storeLoginAttemptEvidence.storeId === credentialDraftStoreId
      ? storeLoginAttemptEvidence
      : emptyStoreLoginAttemptEvidence(credentialDraftStoreId);
  const scopedLoginAttemptSequence = scopedLoginAttemptEvidence.sequence;

  const previewScenarioId = 'scenarioId' in browserPreviewBootstrap
    ? browserPreviewBootstrap.scenarioId
    : undefined;
  const brandBadges = (
    <>
      {browserPreviewBootstrap.enabled && (
        <span
          className="app-status app-status-warning"
          role={browserPreviewBootstrap.warning ? 'alert' : 'status'}
          title={browserPreviewBootstrap.warning || '开发预览只使用内存 fixture，不写入真实业务数据或验收证据。'}
        >
          仅开发预览 · {previewScenarioId}
          {browserPreviewBootstrap.warning ? ` · ${browserPreviewBootstrap.warning}` : ''}
        </span>
      )}
      <span className={headerReadinessClass(deliveryReadiness)}>{headerReadinessLabel(deliveryReadiness)}</span>
      {missionControl.error && <span className="app-status app-status-warning">Capability 同步失败</span>}
    </>
  );
  const sessionConfirmed = loginSession?.sessionIdentityVerified === true
    && loginSession.erpSessionReady === true && loginSession.adsSessionReady === true;
  const sessionStatus = (
    <span
      aria-label={describeLoginSession(loginSession)}
      aria-live="polite"
      className={`session-line${sessionConfirmed ? '' : ' session-line-warning'}`}
      role="status"
      tabIndex={sessionConfirmed ? undefined : 0}
      title={describeLoginSession(loginSession)}
    >
      {headerSessionStatusLabel(loginSession)}
    </span>
  );

  return (
    <MissionControlShell
      activeIntent={activeNavigation}
      activeStore={store.activeStore}
      authoritativeContext={store.authoritativeContext}
      autonomy={missionControl.autonomy ?? DEFAULT_BLOCKED_AUTONOMY}
      brandBadges={brandBadges}
      capabilities={missionControl.capabilities}
      contentRef={contentRef}
      dailyStatusError={store.dailyStatusError}
      dailyStatusPhase={store.dailyStatusPhase}
      dailyStatuses={store.dailyStatuses}
      onCreateStore={store.createStore}
      onLogout={handleLogout}
      onNavigate={requestNavigate}
      onRetryStores={async () => {
        try {
          await store.retryBootstrap();
          await store.refreshDailyStatuses();
        } catch (caught) {
          rendererRuntimeLog.error('renderer.store_bootstrap_retry_failed', { error: caught });
        }
      }}
      onSetAutonomyMode={missionControl.setAutonomyMode}
      onSwitchStore={store.switchStore}
      pendingIntent={pendingNavigationIntent}
      sessionStatus={sessionStatus}
      storeError={store.error}
      storeSyncWarning={store.postCommitSyncWarning}
      storePhase={store.phase}
      stores={store.stores}
    >
      <div key={store.authorityKey} data-authority-key={store.authorityKey}>
        {logoutError && <div role="alert" className="app-status app-status-warning">
          {logoutError}
          <button type="button" className="secondary" onClick={handleLogout}>重试退出登录</button>
        </div>}
        <MissionControlWorkspaceView
          autonomy={missionControl.autonomy}
          today={missionControl.today}
          bridgeError={missionControl.error}
          bridgePhase={missionControl.phase}
          capabilities={missionControl.phase === 'loading' ? undefined : missionControl.capabilities}
          intent={activeNavigation}
          legacySlot={({ route, intent, capabilities }) => (
            <LegacyAdapterRouter
              capabilities={capabilities}
              intent={intent}
              nextSafeAction={nextSafeAction}
              previewMode={browserPreviewBootstrap.enabled}
              previewScenarioId={previewScenarioId}
              readbackAuthority={readbackAuthority}
              route={route}
              storeContext={store.authoritativeContext!}
            />
          )}
          onNavigate={requestNavigate}
          onRefreshAuthority={missionControl.refreshBootstrap}
          previewMode={browserPreviewBootstrap.enabled}
          settingsCrudSlot={(
            <>
              <StoreConnectionWorkbench
                credentialDraft={scopedStoreConnectionCredentialDraft}
                loginAction={scopedLoginAttemptEvidence.action}
                loginAttemptError={scopedLoginAttemptEvidence.error}
                loginAttemptPending={scopedLoginAttemptEvidence.pending}
                loginAttemptSequence={scopedLoginAttemptSequence}
                setCredentialDraft={setStoreConnectionCredentialDraft}
                setLoginAction={setScopedLoginAction}
                setLoginAttemptError={setScopedLoginAttemptError}
                setLoginAttemptPending={setScopedLoginAttemptPending}
                setLoginAttemptSequence={setScopedLoginAttemptSequence}
              />
              <StoreManagementPanel
                activeStoreId={store.activeStore.storeId}
                connections={store.activeView?.connections ?? []}
                error={store.error}
                onArchive={store.archiveStore}
                onRestore={store.restoreStore}
                onUnbindConnection={store.unbindStoreConnection}
                onUpdate={store.updateStore}
                stores={store.stores}
                syncWarning={store.postCommitSyncWarning}
              />
              <StoreRuntimeConfigPanel storeContext={store.authoritativeContext} />
            </>
          )}
          storeContext={store.authoritativeContext}
        />
      </div>
    </MissionControlShell>
  );
}

import type { StoreWorkspaceView } from '@amazon-ai-ops/shared-types';
import { runtimeLog } from './runtime-log-adapter';
import { runUserVisibleBrowserTransition } from './user-visible-browser-transition';
import { storeContextTracker } from './v16-store-context-guard';
import { assertUserVisibleBrowserRuntimeClosed, closeUserVisibleBrowserRuntimeForTransition, readEmptyUserVisibleBrowserTransitionState } from './main-browser-session-runtime';
import { getMainRuntimeContext } from './main-runtime-access';

export function publishStoreContextChanged(view: StoreWorkspaceView): void {
  const mainRuntimeContext = getMainRuntimeContext();
  mainRuntimeContext.lastPublishedStoreContext = Object.freeze({ ...view.context });
  
  
  storeContextTracker.setContext(view.context);
  
  mainRuntimeContext.mainWindow?.webContents.send('store-context:changed', view);
}

export async function refreshActiveStoreBusinessDateAuthority(): Promise<boolean> {
  const mainRuntimeContext = getMainRuntimeContext();
  const view = mainRuntimeContext.state.storeCoordinator?.getActiveStoreWorkspaceView();
  const previous = mainRuntimeContext.lastPublishedStoreContext;
  if (!view || !previous) return false;
  const next = view.context;
  if (
    previous.storeId !== next.storeId
    || previous.browserProfileId !== next.browserProfileId
    || previous.sessionGeneration !== next.sessionGeneration
    || previous.businessDate === next.businessDate
  ) return false;

  if (mainRuntimeContext.packageUiReadOnlyRuntime) {
    mainRuntimeContext.packageUiSchedulerAudit.recordSuppressed('automaticReconcile');
    return false;
  }
  const runtime = mainRuntimeContext.state.storeCollectionMainRuntime;
  if (!runtime || !mainRuntimeContext.state.storeCoordinator) return false;
  try {
    mainRuntimeContext.state.executionAuthorityService?.assertStoreMutationAllowed(next);
    return await runtime.withUserStoreMutation({
      operation: 'business-date-rollover',
      targetStoreId: String(next.storeId),
    }, () => runUserVisibleBrowserTransition({
      leases: mainRuntimeContext.browserOperationLeases,
      owner: 'business-date-rollover',
      closeRuntime: closeUserVisibleBrowserRuntimeForTransition,
      assertRuntimeClosed: assertUserVisibleBrowserRuntimeClosed,
      work: async () => {
        const freshView = mainRuntimeContext.state.storeCoordinator!.getActiveStoreWorkspaceView();
        const published = mainRuntimeContext.lastPublishedStoreContext;
        if (!freshView || !published) return false;
        const fresh = freshView.context;
        if (published.storeId !== fresh.storeId
          || published.browserProfileId !== fresh.browserProfileId
          || published.sessionGeneration !== fresh.sessionGeneration
          || published.businessDate === fresh.businessDate) return false;
        mainRuntimeContext.state.executionAuthorityService?.assertStoreMutationAllowed(fresh);
        publishStoreContextChanged(freshView);
        mainRuntimeContext.mainWindow?.webContents.send('business-ui:data-updated');
        return true;
      },
      readFinalState: readEmptyUserVisibleBrowserTransitionState,
    }));
  } catch (error) {
    const code = error && typeof error === 'object'
      ? String((error as { code?: unknown }).code ?? '')
      : '';
    if (code === 'USER_OPERATION_BLOCKED'
      || code === 'LANE_HELD'
      || code === 'VISIBLE_BROWSER_TRANSITION_BUSY') return false;
    throw error;
  }
}

export function startStoreBusinessDateAuthorityMonitor(): void {
  const mainRuntimeContext = getMainRuntimeContext();
  if (mainRuntimeContext.storeBusinessDateAuthorityTimer) return;
  mainRuntimeContext.storeBusinessDateAuthorityTimer = setInterval(
    () => {
      void refreshActiveStoreBusinessDateAuthority().catch((error) => {
        runtimeLog.error('[StoreAuthority] business-date rollover failed:', error);
      });
    },
    mainRuntimeContext.STORE_BUSINESS_DATE_AUTHORITY_POLL_MS,
  );
  mainRuntimeContext.storeBusinessDateAuthorityTimer.unref?.();
}

export function stopStoreBusinessDateAuthorityMonitor(): void {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!mainRuntimeContext.storeBusinessDateAuthorityTimer) return;
  clearInterval(mainRuntimeContext.storeBusinessDateAuthorityTimer);
  mainRuntimeContext.storeBusinessDateAuthorityTimer = null;
}

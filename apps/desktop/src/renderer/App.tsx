import { useStore } from './app-login-state';
import { MissionControlRuntime } from './app-runtime';
import { MissionControlSessionAuthorityBoundary } from './app-session-boundary';
import {
MissionControlStoreContextProvider
} from './mission-control/store-context';
import { MissionControlStoreGate } from './mission-control/store-gate';
import './styles.css';
import './styles/tokens.css';
import './styles/foundations.css';
import './styles/shell.css';
import './styles/workspace.css';
import './styles/priority-table.css';
import './styles/decisions.css';
import './styles/object-workspace.css';
import './styles/readback.css';
import './styles/states-motion.css';
import './styles/mission-control-shell.css';

export default function App() {
  const { loginSession, setLoginState } = useStore();

  return (
    <MissionControlStoreContextProvider>
      <MissionControlSessionAuthorityBoundary>
        <MissionControlStoreGate>
          <MissionControlRuntime
            loginSession={loginSession}
            onLoggedOut={() => setLoginState(false)}
          />
        </MissionControlStoreGate>
      </MissionControlSessionAuthorityBoundary>
    </MissionControlStoreContextProvider>
  );
}

export { defaultOperationScopeForAuthority,operationScopeBelongsToAuthority,shouldInvalidateLoginForStoreAuthority,shouldRestoreLoginForStoreAuthority,shouldStartLoginRestoreForAuthority,type StoreAuthoritySnapshot } from './app-authority';
export { buildBrowserLoginRequest,configuredSessionResetActionVisible,configuredSessionResetRequiredFromError,connectionAttemptOperatorCopy,connectionOperatorCopy,currentConnectionSessionState,describeLoginSession,headerReadinessLabel,headerSessionStatusLabel,loginSecurityTagView,loginStatusMessage,loginSubmitButtonView,resolveAdsRetryCredentialAvailability,savedLoginCredentialNotice,savedLoginCredentialTone,selectFreshBrowserLoginStoreContext,type LoginCredentialTone,type LoginSubmitButtonView,type SavedLoginCredentialState } from './app-connection-presentations';
export { createAppNavigationEventHandler,createLatestWorkflowLoadGuard,resetWorkspaceScrollPosition,subscribeAppWorkflowInvalidation } from './app-navigation';

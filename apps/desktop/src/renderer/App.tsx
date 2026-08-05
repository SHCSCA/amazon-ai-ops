import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import {
  missionControlContextKey,
  normalizeLingxingCollectionStoreName,
  type StoreConnection,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import type { AppRoute, DeliveryReadinessView, OperationScope } from './types';
import type {
  BrowserLoginCredentialPersistence,
  BrowserLoginRequest,
  BrowserLoginResult,
} from '../shared/login-contract';
import {
  DEFAULT_WORKSPACE_INTENTS,
  navigationIntentsEqual,
  navigationNeedsGlobalHandoff,
  normalizeNavigationTarget,
} from './navigation';
import type { NavigationIntent } from './navigation';
import { useScopeStore } from './scope-store';
import { deriveWorkflowEvidence, selectNextSafeAction } from './workflow-state';
import type { NextSafeAction, WorkflowEvidence } from './workflow-state';
import { subscribeWorkflowInvalidation } from './workflow-invalidation';
import type { WorkflowEventTarget, WorkflowInvalidationDetail } from './workflow-invalidation';
import { toUserFacingError } from './user-facing-error';
import { bootstrapBrowserPreview } from './dev-preview-api';
import { readbackAuthorityForMode } from './pages/readback-workspace-model';
import {
  MissionControlStoreContextProvider,
  useMissionControlStoreContext,
} from './mission-control/store-context';
import type { MissionControlStorePhase } from './mission-control/store-context';
import { MissionControlStoreGate } from './mission-control/store-gate';
import { useMissionControlBridge } from './mission-control/bridge/use-mission-control-bridge';
import {
  DEFAULT_BLOCKED_AUTONOMY,
  MissionControlShell,
} from './mission-control/mission-control-shell';
import { LegacyAdapterRouter } from './mission-control/router';
import { MissionControlWorkspaceView } from './mission-control/workspaces';
import { StoreManagementPanel, StoreRuntimeConfigPanel } from './mission-control/components';
import { useOverlayFocusScope } from './components/workspace/overlay-focus-scope';
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

interface LoginSessionInfo {
  erpSessionReady?: boolean;
  erpSessionReused?: boolean;
  sessionIdentityVerified?: boolean;
  adsSessionReady?: boolean;
  adsEntryMode?: string;
  adsUrl?: string;
  adsTitle?: string;
  adsUnavailableReason?: string;
  adsIdentityCandidate?: BrowserLoginResult['adsIdentityCandidate'];
  credentialPersistence?: BrowserLoginCredentialPersistence;
}

interface AppState {
  isLoggedIn: boolean;
  currentStore: string;
  loginSession?: LoginSessionInfo | null;
  loginStateRevision: number;
  activeNavigation: NavigationIntent;
  setActiveNavigation: (intent: NavigationIntent) => void;
  setLoginState: (isLoggedIn: boolean, store?: string, loginSession?: LoginSessionInfo | null) => void;
}

const useStore = create<AppState>((set) => ({
  isLoggedIn: false,
  currentStore: '',
  loginSession: null,
  loginStateRevision: 0,
  activeNavigation: DEFAULT_WORKSPACE_INTENTS.today,
  setActiveNavigation: (intent) => set({ activeNavigation: intent }),
  setLoginState: (isLoggedIn, store = '', loginSession = null) => set((state) => ({
    isLoggedIn,
    currentStore: store,
    loginSession,
    loginStateRevision: state.loginStateRevision + 1,
  })),
}));

export interface StoreAuthoritySnapshot {
  authorityKey: string | null;
  contextEpoch: number;
  phase: MissionControlStorePhase;
}

export function shouldInvalidateLoginForStoreAuthority(
  isLoggedIn: boolean,
  previous: StoreAuthoritySnapshot,
  current: StoreAuthoritySnapshot,
): boolean {
  if (!isLoggedIn) return false;

  // The first explicit store selection establishes the initial authority. Every
  // later switch starts a new browser/session authority, even when the operator
  // re-selects the same store.
  if (current.phase === 'switching') return current.contextEpoch > 0;

  // Once an authority has existed, losing it means the old ERP/Ads session can
  // no longer be displayed for any subsequent store selection.
  if (current.authorityKey === null) return current.contextEpoch > 0;

  // A direct Main-side authority replacement must also fail closed. The epoch
  // guard distinguishes it from the initial null -> first-authority bootstrap.
  if (previous.authorityKey === null) return current.contextEpoch > 1;
  return previous.authorityKey !== current.authorityKey;
}

export function shouldRestoreLoginForStoreAuthority(input: {
  responseIsLoggedIn: boolean;
  responseAuthorityKey: string | null;
  requestedAuthorityKey: string;
  currentAuthorityKey: string | null;
}): boolean {
  return input.responseIsLoggedIn
    && input.responseAuthorityKey !== null
    && input.responseAuthorityKey === input.requestedAuthorityKey
    && input.responseAuthorityKey === input.currentAuthorityKey;
}

function appStateAuthorityKey(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const context = (value as { storeContext?: unknown }).storeContext;
  if (!context) return null;
  try {
    return missionControlContextKey(context as StoreContextEnvelope);
  } catch {
    return null;
  }
}

function bootstrapAppBrowserPreview(username = 'SHC001') {
  if (typeof window === 'undefined') return { enabled: false } as const;
  return bootstrapBrowserPreview({
    dev: import.meta.env.DEV,
    target: window as any,
    username,
  });
}

interface WorkspaceScrollOwner {
  scrollLeft: number;
  scrollTop: number;
  scrollTo: (options: ScrollToOptions) => void;
}

export function resetWorkspaceScrollPosition(owner: WorkspaceScrollOwner | null): boolean {
  if (!owner) return false;
  owner.scrollTop = 0;
  owner.scrollLeft = 0;
  owner.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  return true;
}

const browserPreviewBootstrap = bootstrapAppBrowserPreview();

export function createAppNavigationEventHandler(onNavigate: (intent: NavigationIntent) => void) {
  return (event: Event): boolean => {
    const intent = normalizeNavigationTarget((event as CustomEvent<unknown>).detail);
    if (!intent) return false;
    onNavigate(intent);
    return true;
  };
}

export function subscribeAppWorkflowInvalidation(
  onInvalidate: (detail: WorkflowInvalidationDetail) => void,
  target?: WorkflowEventTarget,
): () => void {
  return subscribeWorkflowInvalidation(onInvalidate, target);
}

export function createLatestWorkflowLoadGuard() {
  let sequence = 0;
  return {
    begin() {
      sequence += 1;
      return sequence;
    },
    invalidate() {
      sequence += 1;
    },
    isCurrent(requestSequence: number) {
      return requestSequence === sequence;
    },
  };
}

function appElectronApi(username = 'SHC001') {
  bootstrapAppBrowserPreview(username);
  return (window as any).electronAPI;
}

const loginStyles: Record<string, React.CSSProperties> = {
  container: {
    display: 'grid',
    minHeight: '100vh',
    alignItems: 'start',
    justifyItems: 'center',
    background: 'var(--aao-bg)',
    overflow: 'auto',
    padding: '18px 20px',
  },
  card: {
    display: 'grid',
    gap: 12,
    width: 'min(1120px, 100%)',
    border: '1px solid var(--aao-line)',
    borderRadius: 12,
    background: 'var(--aao-surface)',
    boxSizing: 'border-box',
    padding: 18,
    boxShadow: '0 16px 40px rgba(15, 23, 42, 0.12)',
  },
  topbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 20,
  },
  brand: {
    display: 'grid',
    gap: 3,
  },
  title: { margin: 0, color: 'var(--aao-ink)', fontSize: 24, lineHeight: 1.15 },
  subtitle: { margin: 0, color: 'var(--aao-ink-2)', fontSize: 13, fontWeight: 700 },
  version: {
    border: '1px solid var(--aao-line)',
    borderRadius: 999,
    background: 'var(--aao-surface-subtle)',
    color: 'var(--aao-ink-2)',
    padding: '5px 9px',
    fontSize: 12,
    fontWeight: 800,
  },
  contextBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    borderTop: '1px solid var(--aao-line)',
    borderBottom: '1px solid var(--aao-line)',
    padding: '10px 2px',
  },
  contextIdentity: {
    display: 'grid',
    gap: 2,
    minWidth: 0,
  },
  contextLabel: {
    color: 'var(--aao-ink-3)',
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  },
  contextValue: {
    overflow: 'hidden',
    color: 'var(--aao-ink)',
    fontSize: 14,
    fontWeight: 800,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  marketPill: {
    flex: '0 0 auto',
    border: '1px solid var(--tone-ready-border)',
    borderRadius: 999,
    background: 'var(--tone-ready-bg)',
    color: 'var(--tone-ready-text)',
    padding: '6px 10px',
    fontSize: 12,
    fontWeight: 800,
  },
  workflowGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.55fr) minmax(310px, 0.75fr)',
    gap: 12,
    alignItems: 'stretch',
  },
  leftColumn: {
    display: 'grid',
    gap: 12,
  },
  stepCard: {
    display: 'grid',
    alignContent: 'start',
    gap: 10,
    border: '1px solid var(--aao-line)',
    borderRadius: 10,
    background: 'var(--aao-surface)',
    padding: 14,
  },
  stepHeader: {
    display: 'grid',
    gridTemplateColumns: '28px minmax(0, 1fr)',
    gap: 10,
    alignItems: 'start',
  },
  stepIndex: {
    display: 'grid',
    width: 28,
    height: 28,
    placeItems: 'center',
    borderRadius: 8,
    background: 'var(--aao-brand-600)',
    color: 'white',
    fontSize: 13,
    fontWeight: 900,
  },
  stepHeadingGroup: {
    display: 'grid',
    gap: 2,
  },
  stepTitle: {
    margin: 0,
    color: 'var(--aao-ink)',
    fontSize: 15,
    lineHeight: 1.3,
  },
  stepDescription: {
    margin: 0,
    color: 'var(--aao-ink-2)',
    fontSize: 12,
    lineHeight: 1.45,
  },
  fieldsGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
    gap: 10,
  },
  fieldLabel: {
    display: 'grid',
    gap: 5,
    minWidth: 0,
  },
  fieldName: {
    color: 'var(--aao-ink-2)',
    fontSize: 12,
    fontWeight: 800,
  },
  form: { display: 'grid', gap: 10 },
  input: {
    width: '100%',
    height: 38,
    border: '1px solid var(--aao-line-strong)',
    borderRadius: 8,
    boxSizing: 'border-box',
    padding: '0 12px',
    fontSize: 14,
  },
  hint: {
    border: '1px solid var(--tone-pending-border)',
    borderRadius: 8,
    background: 'var(--tone-pending-bg)',
    color: 'var(--aao-ink-2)',
    padding: '8px 10px',
    fontSize: 12,
    lineHeight: 1.45,
  },
  rememberRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    color: 'var(--aao-ink-2)',
    fontSize: 13,
    fontWeight: 700,
  },
  rememberLabel: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    cursor: 'pointer',
  },
  enrollmentResetRow: {
    display: 'grid',
    gridTemplateColumns: '18px minmax(0, 1fr)',
    alignItems: 'start',
    gap: 9,
    border: '1px solid var(--tone-pending-border)',
    borderRadius: 8,
    background: 'var(--tone-pending-bg)',
    color: 'var(--aao-ink-2)',
    padding: '9px 10px',
    cursor: 'pointer',
  },
  enrollmentResetCopy: {
    display: 'grid',
    gap: 2,
    fontSize: 12,
    lineHeight: 1.45,
  },
  notice: {
    color: 'var(--aao-ink-2)',
    fontSize: 11,
    lineHeight: 1.4,
  },
  error: {
    border: '1px solid var(--tone-blocked-border)',
    borderRadius: 8,
    background: 'var(--tone-blocked-bg)',
    color: 'var(--tone-blocked-text)',
    padding: '10px 12px',
    fontSize: 13,
  },
  connectionPanel: {
    display: 'grid',
    alignContent: 'start',
    gap: 7,
    border: '1px solid var(--aao-line)',
    borderRadius: 8,
    background: 'var(--aao-surface-subtle)',
    padding: 10,
  },
  connectionGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 0.85fr) minmax(0, 1.15fr)',
    gap: 10,
  },
  connectionName: {
    margin: 0,
    color: 'var(--aao-ink)',
    fontSize: 12,
    fontWeight: 900,
  },
  connectionStatus: {
    margin: 0,
    color: 'var(--aao-ink-2)',
    fontSize: 12,
    lineHeight: 1.4,
  },
  connectionButton: {
    minHeight: 34,
    border: '1px solid var(--aao-brand-600)',
    borderRadius: 8,
    background: 'var(--aao-surface)',
    color: 'var(--aao-brand-700)',
    padding: '6px 10px',
    fontSize: 12,
    fontWeight: 800,
  },
  actionCard: {
    display: 'grid',
    alignContent: 'start',
    gap: 12,
    border: '1px solid var(--aao-brand-200)',
    borderRadius: 10,
    background: 'var(--aao-surface)',
    padding: 14,
  },
  readinessPanel: {
    display: 'grid',
    gap: 7,
    borderRadius: 8,
    background: 'var(--aao-surface-subtle)',
    padding: 10,
  },
  readinessTitle: {
    margin: 0,
    color: 'var(--aao-ink)',
    fontSize: 12,
    fontWeight: 900,
  },
  readinessList: {
    display: 'grid',
    gap: 5,
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  readinessItem: {
    color: 'var(--aao-ink-2)',
    fontSize: 12,
    lineHeight: 1.4,
  },
  guidanceList: {
    display: 'grid',
    gap: 7,
    margin: 0,
    padding: '0 0 0 18px',
    color: 'var(--aao-ink-2)',
    fontSize: 12,
    lineHeight: 1.45,
  },
  button: {
    minHeight: 44,
    border: 0,
    borderRadius: 8,
    background: 'var(--aao-brand-600)',
    color: 'white',
    padding: '10px 14px',
    fontSize: 15,
    fontWeight: 800,
  },
};

export function describeLoginSession(session?: LoginSessionInfo | null): string {
  if (!session) return 'ERP/Ads 会话：待确认';
  if (
    session.erpSessionReused
    && session.sessionIdentityVerified === false
  ) {
    const ads = session.adsTitle || session.adsUrl ? `Ads 已进入：${session.adsTitle || session.adsUrl}` : 'Ads 会话待确认';
    const identity = session.credentialPersistence === 'not_saved_unverified_session'
      ? '账号和本次密码均未核验'
      : '保存账号未与当前 ERP 会话核验';
    return `ERP 已复用登录态；${identity}，本机安全区未更改；${ads}`;
  }
  const erp = session.erpSessionReused ? 'ERP 已复用登录态' : 'ERP 已完成登录';
  const ads = session.adsSessionReady === false
    ? `Ads 未连接：${session.adsUnavailableReason || '独立 Profile 待授权，广告执行保持阻断'}`
    : session.adsTitle || session.adsUrl
      ? `Ads 已进入：${session.adsTitle || session.adsUrl}`
      : 'Ads 会话待确认';
  return `${erp}；${ads}`;
}

export function headerSessionStatusLabel(session?: LoginSessionInfo | null): string {
  if (!session) return '会话待确认';
  if (
    session.erpSessionReused
    && session.sessionIdentityVerified === false
  ) {
    return 'ERP 会话复用 · 身份未核验';
  }
  const erpReady = session.erpSessionReady === true || Boolean(session.erpSessionReused);
  const adsReady = session.adsSessionReady === true
    || (session.adsSessionReady === undefined && Boolean(session.adsTitle || session.adsUrl || session.adsEntryMode));
  if (erpReady && adsReady) return 'ERP/Ads 已连接';
  if (erpReady && session.adsSessionReady === false) return 'ERP 已连接 · Ads 待授权';
  if (adsReady) return 'Ads 已连接';
  if (erpReady) return 'ERP 已连接';
  return '会话确认中';
}

export function headerReadinessLabel(readiness: DeliveryReadinessView | null): string {
  if (readiness?.appReady && readiness?.manifestDriven) return '应用包验收通过';
  if (readiness?.available === false) return '待生成验收';
  return '等待最终验收';
}

export interface LoginSubmitButtonView {
  ariaBusy?: boolean;
  className: string;
  label: string;
  loading: boolean;
}

export function loginSubmitButtonView(loading: boolean): LoginSubmitButtonView {
  return {
    ariaBusy: loading ? true : undefined,
    className: ['login-submit-button', loading ? 'button-loading' : ''].filter(Boolean).join(' '),
    label: loading ? '正在启动当前店铺连接...' : '启动当前店铺连接',
    loading,
  };
}

export function loginStatusMessage(input: {
  credentialSource?: 'saved' | 'typed';
  loading: boolean;
  credentialNotice?: string;
  rememberPassword: boolean;
}): string {
  if (input.loading) {
    return input.credentialSource === 'saved'
      ? '正在启动领星与 Ads 可见会话；已保存密码只在本机安全区解密。'
      : '正在启动领星与 Ads 可见会话；本次输入只用于建立当前会话。';
  }
  if (input.credentialNotice) return input.credentialNotice;
  if (input.rememberPassword) return '勾选后密码保存在本机安全区；账号保留在本机用于下次识别。';
  return '未记住密码；账号仍保留在本机，密码只用于本次登录。';
}

export type SavedLoginCredentialState =
  | 'none'
  | 'encrypted_ready'
  | 'migrated'
  | 'encryption_unavailable'
  | 'encrypted_corrupt'
  | 'migration_failed';

export type LoginCredentialTone = 'neutral' | 'ready' | 'warning' | 'blocked';

export function savedLoginCredentialTone(input: {
  credentialState?: SavedLoginCredentialState;
  passwordAvailable?: boolean;
}): LoginCredentialTone {
  if (input.passwordAvailable) return 'ready';
  if (input.credentialState === 'encrypted_corrupt' || input.credentialState === 'migration_failed') {
    return 'blocked';
  }
  if (input.credentialState === 'encryption_unavailable') return 'warning';
  return 'neutral';
}

export function loginSecurityTagView(input: {
  credentialSource: 'saved' | 'typed';
  credentialState: SavedLoginCredentialState;
  loading: boolean;
  passwordAvailable: boolean;
}): { className: string; label: string } {
  if (input.loading) {
    return { className: 'login-security-tag login-security-tag-pending', label: '会话确认中' };
  }
  if (input.credentialSource === 'saved' && input.passwordAvailable) {
    return { className: 'login-security-tag login-security-tag-ready', label: '本机安全区托管' };
  }
  if (input.credentialState === 'encryption_unavailable') {
    return { className: 'login-security-tag login-security-tag-warning', label: '本次不保存' };
  }
  if (input.credentialState === 'encrypted_corrupt' || input.credentialState === 'migration_failed') {
    return { className: 'login-security-tag login-security-tag-blocked', label: '需重新输入' };
  }
  return { className: 'login-security-tag', label: '当前页面输入' };
}

export function savedLoginCredentialNotice(input: {
  credentialState?: SavedLoginCredentialState;
  passwordAvailable?: boolean;
  rememberPassword?: boolean;
}): string {
  if (input.passwordAvailable) {
    return input.credentialState === 'migrated'
      ? '旧版密码已迁移至本机安全区；后续登录由本机安全区托管，当前页面不会读取密码。'
      : '已加载账号；保存的密码由本机安全区托管，当前页面不会读取。';
  }
  if (input.credentialState === 'encryption_unavailable') {
    return '当前系统无法使用本机加密；请重新输入密码，本次仅登录、不保存密码。';
  }
  if (input.credentialState === 'encrypted_corrupt') {
    return '本机保存的密码无法解密，请重新输入并保存。';
  }
  if (input.credentialState === 'migration_failed') {
    return '旧版凭证尚未完成安全迁移，系统未把旧密码发送到界面；请重新输入密码。';
  }
  if (input.rememberPassword) return '已加载账号，密码需重新输入。';
  return '';
}

export function buildBrowserLoginRequest(input: {
  credentialSource: 'saved' | 'typed';
  password: string;
  resetLingxingSessionForEnrollment?: boolean;
  rememberPassword: boolean;
  savedCredentialUsername: string;
  savedPasswordAvailable: boolean;
  storeContext: StoreContextEnvelope | null;
  lingxingCollectionStoreName: string;
  username: string;
}): BrowserLoginRequest | null {
  const username = input.username.trim();
  const lingxingCollectionStoreName = input.lingxingCollectionStoreName.trim();
  const useSavedCredential = input.credentialSource === 'saved'
    && input.savedPasswordAvailable
    && input.rememberPassword
    && input.resetLingxingSessionForEnrollment !== true
    && username === input.savedCredentialUsername;
  if (!username || !lingxingCollectionStoreName || !input.storeContext) return null;
  if (useSavedCredential) {
    return {
      username,
      credentialSource: 'saved',
      rememberPassword: true,
      storeContext: input.storeContext,
    };
  }
  if (!input.password) return null;
  return {
    username,
    credentialSource: 'typed',
    password: input.password,
    rememberPassword: input.rememberPassword,
    storeContext: input.storeContext,
    ...(input.resetLingxingSessionForEnrollment === true
      ? { resetLingxingSessionForEnrollment: true }
      : {}),
  };
}

function headerReadinessClass(readiness: DeliveryReadinessView | null): string {
  if (readiness?.appReady && readiness?.manifestDriven) return 'app-status app-status-ready';
  if (readiness?.available === false) return 'app-status app-status-pending';
  return 'app-status app-status-warning';
}

interface StoreConnectionCredentialDraft {
  storeId: string;
  username: string;
  password: string;
  rememberPassword: boolean;
  credentialSource: 'saved' | 'typed';
  resetLingxingSessionForEnrollment: boolean;
  dirty: boolean;
  hydrated: boolean;
}

function emptyStoreConnectionCredentialDraft(storeId: string): StoreConnectionCredentialDraft {
  return {
    storeId,
    username: '',
    password: '',
    rememberPassword: false,
    credentialSource: 'typed',
    resetLingxingSessionForEnrollment: false,
    dirty: false,
    hydrated: false,
  };
}

function StoreConnectionWorkbench({
  credentialDraft,
  setCredentialDraft,
}: {
  credentialDraft: StoreConnectionCredentialDraft;
  setCredentialDraft: React.Dispatch<React.SetStateAction<StoreConnectionCredentialDraft>>;
}) {
  const store = useMissionControlStoreContext();
  const {
    username,
    password,
    rememberPassword,
    credentialSource,
    resetLingxingSessionForEnrollment,
  } = credentialDraft;
  const [savedCredentialUsername, setSavedCredentialUsername] = useState('');
  const [savedPasswordAvailable, setSavedPasswordAvailable] = useState(false);
  const [savedCredentialState, setSavedCredentialState] = useState<SavedLoginCredentialState>('none');
  const [packageUiEvidenceMode, setPackageUiEvidenceMode] = useState(false);
  const [freshTypedProofRequired, setFreshTypedProofRequired] = useState(false);
  const [credentialNotice, setCredentialNotice] = useState('');
  const [credentialTone, setCredentialTone] = useState<LoginCredentialTone>('neutral');
  const [lingxingCollectionStoreName, setLingxingCollectionStoreName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loginConnectionState, setLoginConnectionState] = useState<'missing' | 'binding' | 'unbinding' | 'ready' | 'error'>('missing');
  const [amazonAdsConnectionState, setAmazonAdsConnectionState] =
    useState<'missing' | 'detected' | 'binding' | 'unbinding' | 'ready' | 'error'>('missing');
  const [confirmUnbindConnection, setConfirmUnbindConnection] = useState<StoreConnection | null>(null);
  const credentialDraftDirtyRef = useRef(credentialDraft.dirty);
  credentialDraftDirtyRef.current = credentialDraft.dirty;
  const { loginSession, setLoginState } = useStore();
  const lingxingConnection = store.activeView?.connections.find(
    (connection) => connection.provider === 'lingxing',
  );
  const amazonAdsConnection = store.activeView?.connections.find(
    (connection) => connection.provider === 'amazon_ads',
  );
  const normalizedLingxingCollectionStoreName = normalizeLingxingCollectionStoreName(
    lingxingCollectionStoreName,
  );
  const lingxingConnectionReady = Boolean(username.trim())
    && Boolean(normalizedLingxingCollectionStoreName)
    && lingxingConnection?.accountLabel?.trim() === username.trim()
    && lingxingConnection?.normalizedCollectionStoreName === normalizedLingxingCollectionStoreName;
  const amazonAdsConnectionReady = Boolean(
    amazonAdsConnection?.externalAccountId
    && amazonAdsConnection.normalizedExternalAccountId,
  );
  const adsIdentityCandidate = loginSession?.adsIdentityCandidate;
  const loginConnectionsReady = lingxingConnectionReady;
  const lingxingEnrollmentPending = lingxingConnectionReady
    && !lingxingConnection?.externalAccountId;
  const freshTypedProofStorageReady = savedCredentialState !== 'encryption_unavailable';
  const freshTypedProofReady = !freshTypedProofRequired
    || (
      freshTypedProofStorageReady
      && credentialSource === 'typed'
      && Boolean(password)
      && rememberPassword
    );
  const enrollmentTypedProofReady = !lingxingEnrollmentPending
    || (credentialSource === 'typed' && Boolean(password));
  const loginWorkbenchReady = lingxingConnectionReady
    && freshTypedProofReady
    && enrollmentTypedProofReady;
  const loginButtonView = loginSubmitButtonView(loading);
  const loginStatus = loginStatusMessage({ credentialSource, loading, credentialNotice, rememberPassword });
  const loginStatusClass = [
    'login-status-line',
    loading ? 'login-status-line-pending' : '',
    !loading && credentialTone === 'ready' ? 'login-status-line-ready' : '',
    !loading && credentialTone === 'warning' ? 'login-status-line-warning' : '',
    !loading && credentialTone === 'blocked' ? 'login-status-line-blocked' : '',
  ].filter(Boolean).join(' ');
  const securityTagView = loginSecurityTagView({
    credentialSource,
    credentialState: savedCredentialState,
    loading,
    passwordAvailable: savedPasswordAvailable,
  });
  const unbindBusy = loginConnectionState === 'unbinding' || amazonAdsConnectionState === 'unbinding';
  const unbindDialogFocus = useOverlayFocusScope<HTMLDivElement, HTMLElement>({
    dismissDisabled: unbindBusy,
    onDismiss: () => setConfirmUnbindConnection(null),
    open: confirmUnbindConnection !== null,
  });

  useEffect(() => {
    setLoginConnectionState(lingxingConnectionReady ? 'ready' : 'missing');
  }, [
    lingxingConnection?.accountLabel,
    lingxingConnection?.id,
    lingxingConnectionReady,
    store.authorityKey,
    username,
    lingxingCollectionStoreName,
  ]);

  useEffect(() => {
    setLingxingCollectionStoreName(lingxingConnection?.collectionStoreName?.trim() ?? '');
  }, [
    lingxingConnection?.collectionStoreName,
    lingxingConnection?.id,
    store.activeStore?.storeId,
  ]);

  useEffect(() => {
    setAmazonAdsConnectionState(
      amazonAdsConnectionReady
        ? 'ready'
        : adsIdentityCandidate
          ? 'detected'
          : 'missing',
    );
  }, [
    amazonAdsConnection?.externalAccountId,
    amazonAdsConnection?.id,
    amazonAdsConnectionReady,
    adsIdentityCandidate?.confirmationToken,
    store.authorityKey,
  ]);

  useEffect(() => {
    let cancelled = false;
    const requestedStoreId = store.activeStore?.storeId ?? null;
    const requestedStoreKey = String(requestedStoreId ?? '');
    const connectionUsername = lingxingConnection?.accountLabel?.trim() ?? '';
    if (!credentialDraft.hydrated) {
      setSavedCredentialUsername('');
      setSavedPasswordAvailable(false);
      setSavedCredentialState('none');
      setPackageUiEvidenceMode(false);
      setFreshTypedProofRequired(false);
      setCredentialNotice('正在读取当前店铺的本机凭证状态…');
      setCredentialTone('neutral');
    } else if (credentialDraft.dirty) {
      setCredentialNotice('本次将使用当前页面输入的凭证；同店连接刷新不会清空尚未提交的密码。');
      setCredentialTone('neutral');
    }
    if (connectionUsername) {
      setCredentialDraft((current) => (
        current.storeId === requestedStoreKey && !current.dirty && !current.username.trim()
          ? { ...current, username: connectionUsername }
          : current
      ));
    }
    async function loadSavedCredentialStatus() {
      const api = appElectronApi(connectionUsername);
      if (!api?.getSavedLoginCredentialStatus) return;
      try {
        const saved = await api.getSavedLoginCredentialStatus();
        if (cancelled || !saved) return;
        if (String(saved.storeId ?? '') !== String(requestedStoreId ?? '')) return;
        const savedUsername = typeof saved.username === 'string' ? saved.username : '';
        const effectiveUsername = savedUsername || connectionUsername;
        const passwordAvailable = Boolean(saved.passwordAvailable);
        const credentialState = saved.credentialState || 'none';
        const requiresFreshTypedProof = Boolean(saved.freshTypedProofRequired);
        const enrollmentPending = Boolean(
          lingxingConnection
          && !lingxingConnection.externalAccountId,
        );
        const encryptionAvailable = credentialState !== 'encryption_unavailable';
        const remember = encryptionAvailable && (
          requiresFreshTypedProof ? true : Boolean(saved.rememberPassword)
        );
        setSavedCredentialUsername(savedUsername);
        setSavedPasswordAvailable(passwordAvailable);
        setSavedCredentialState(credentialState);
        setPackageUiEvidenceMode(Boolean(saved.packageUiEvidenceMode));
        setFreshTypedProofRequired(requiresFreshTypedProof);
        setCredentialDraft((current) => {
          if (current.storeId !== requestedStoreKey || current.hydrated) return current;
          if (current.dirty) return { ...current, hydrated: true };
          return {
            ...current,
            username: effectiveUsername,
            password: '',
            rememberPassword: remember,
            credentialSource:
              !enrollmentPending && !requiresFreshTypedProof && passwordAvailable && remember
                ? 'saved'
                : 'typed',
            resetLingxingSessionForEnrollment: false,
            hydrated: true,
          };
        });
        if (!credentialDraftDirtyRef.current) {
          setCredentialNotice(enrollmentPending
            ? '当前店铺需要首次建立领星稳定身份，请手动输入本次密码；不会复用其他店铺或旧会话的身份。'
            : requiresFreshTypedProof
            ? encryptionAvailable
              ? '本次为正式证据首轮：请重新输入密码并保持“记住密码”勾选，以建立可核验的新会话。'
              : '本次正式证据首轮需要本机加密保存密码，但当前系统加密不可用，暂不能开始正式取证。'
            : savedLoginCredentialNotice({
                credentialState,
                passwordAvailable,
                rememberPassword: remember,
              }));
          setCredentialTone(enrollmentPending
            ? 'warning'
            : requiresFreshTypedProof
            ? encryptionAvailable ? 'warning' : 'blocked'
            : savedLoginCredentialTone({ credentialState, passwordAvailable }));
        }
      } catch {
        if (!cancelled) {
          setCredentialNotice('无法读取本机凭证状态，请重新输入密码。');
          setCredentialTone('blocked');
        }
      }
    }

    loadSavedCredentialStatus();
    return () => {
      cancelled = true;
    };
  }, [
    lingxingConnection?.accountLabel,
    lingxingConnection?.externalAccountId,
    lingxingConnection?.id,
    credentialDraft.hydrated,
    credentialDraft.storeId,
    store.activeStore?.storeId,
  ]);

  async function handleLogin() {
    if (loading) return;
    if (!lingxingConnectionReady) {
      setError('请先把当前领星账号绑定到所选店铺。');
      return;
    }
    if (!freshTypedProofReady) {
      setError(freshTypedProofStorageReady
        ? '本次正式证据首轮必须重新输入密码并勾选“记住密码”。'
        : '本次正式证据首轮需要本机加密保存密码，但当前系统加密不可用。');
      return;
    }
    const request = buildBrowserLoginRequest({
      credentialSource,
      password,
      resetLingxingSessionForEnrollment:
        lingxingEnrollmentPending && resetLingxingSessionForEnrollment,
      rememberPassword,
      savedCredentialUsername,
      savedPasswordAvailable,
      storeContext: store.authoritativeContext,
      lingxingCollectionStoreName,
      username,
    });
    if (!request) {
      setError('请输入用户名和密码');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const api = appElectronApi(username);
      if (!api?.browserLogin && browserPreviewBootstrap.enabled) {
        const previewState = await api.getState();
        setCredentialNotice('已进入浏览器预览模式；这里不连接真实 ERP/Ads，也不会写入本地数据库。');
        setLoginState(true, previewState.currentStore, previewState.loginSession || null);
        return;
      }
      const session = await api.browserLogin(request) as BrowserLoginResult;
      setLoginState(true, session.currentStore, session);
      setCredentialDraft((current) => current.storeId === String(store.activeStore?.storeId ?? '')
        ? { ...current, password: '', dirty: false, hydrated: true }
        : current);
    } catch (caught) {
      setError(toUserFacingError(caught, '登录失败'));
    } finally {
      setLoading(false);
    }
  }

  async function handleBindLingxingConnection() {
    if (loading || loginConnectionState === 'binding' || lingxingConnectionReady) return;
    if (!username.trim() || !lingxingCollectionStoreName.trim()) {
      setError('请同时输入领星用户名和领星下载中心店铺名称后再绑定。');
      return;
    }
    setLoginConnectionState('binding');
    setError('');
    try {
      await store.bindLingxingConnection(username.trim(), lingxingCollectionStoreName.trim());
      setLoginConnectionState('ready');
    } catch (caught) {
      setLoginConnectionState('error');
      setError(toUserFacingError(caught, '领星连接绑定失败'));
    }
  }

  async function handleUnbindConnection(connection: StoreConnection) {
    if (loading || unbindBusy) return;
    const provider = connection.provider;
    if (provider === 'lingxing') setLoginConnectionState('unbinding');
    else setAmazonAdsConnectionState('unbinding');
    setError('');
    try {
      await store.unbindStoreConnection(connection);
      if (provider === 'lingxing') setLoginConnectionState('missing');
      else setAmazonAdsConnectionState('missing');
      setConfirmUnbindConnection(null);
      setCredentialNotice('连接映射已解绑；本机保存的领星密码没有被清除。');
      setCredentialTone('warning');
    } catch (caught) {
      if (provider === 'lingxing') setLoginConnectionState('error');
      else setAmazonAdsConnectionState('error');
      setError(toUserFacingError(caught, provider === 'lingxing' ? '领星连接解绑失败' : 'Amazon Ads 连接解绑失败'));
    }
  }

  async function handleConfirmAmazonAdsConnection() {
    if (loading || amazonAdsConnectionReady || !adsIdentityCandidate || !store.authoritativeContext) return;
    setAmazonAdsConnectionState('binding');
    setError('');
    try {
      const api = appElectronApi(username);
      if (!api?.confirmBrowserLoginAdsIdentity) {
        throw new Error('当前版本未暴露广告账户确认接口。');
      }
      const session = await api.confirmBrowserLoginAdsIdentity({
        confirmationToken: adsIdentityCandidate.confirmationToken,
        storeContext: store.authoritativeContext,
      }) as BrowserLoginResult;
      setLoginState(true, session.currentStore, session);
      setAmazonAdsConnectionState('ready');
    } catch (caught) {
      setAmazonAdsConnectionState('error');
      setError(toUserFacingError(caught, '领星广告账户确认失败'));
    }
  }

  const loginConnectionStatus = loginConnectionState === 'ready'
    ? lingxingConnection?.externalAccountId
      ? '领星连接已绑定；稳定身份已由 Main 识别。'
      : '领星连接已绑定；稳定身份待首次新鲜登录识别。'
    : loginConnectionState === 'binding'
      ? '正在绑定当前领星账号与店铺身份…'
      : loginConnectionState === 'unbinding'
        ? '正在解绑领星连接映射…'
      : loginConnectionState === 'error'
        ? '领星连接绑定失败，请检查后重试。'
        : lingxingConnection
          ? '当前用户名与店铺领星连接不一致，请更新绑定。'
          : '当前店铺尚未绑定领星连接。';

  const amazonAdsConnectionStatus = amazonAdsConnectionState === 'ready'
    ? '领星广告账户已由 Main 验证并绑定'
    : amazonAdsConnectionState === 'binding'
      ? '正在确认领星广告账户…'
      : amazonAdsConnectionState === 'detected'
        ? '已自动识别，等待你确认当前店铺绑定。'
      : amazonAdsConnectionState === 'unbinding'
        ? '正在解绑领星广告账户…'
      : amazonAdsConnectionState === 'error'
        ? '领星广告账户确认失败，请检查可见 Ads 窗口后重试。'
        : amazonAdsConnection
          ? '当前广告账户连接尚未完成可信身份确认。'
          : '当前店铺尚未识别领星广告账户。';
  const lingxingReadinessDetail = lingxingConnectionReady
    ? lingxingConnection?.externalAccountId
      ? '已就绪：账号与下载中心店铺名称一致，稳定身份已识别。'
      : enrollmentTypedProofReady
        ? '待登记：已输入本次密码；稳定身份将在首次新鲜登录时由 Main 识别。'
        : '待登记：请手动输入本次密码，旧会话不会直接作为稳定身份。'
    : !username.trim()
      ? '未就绪：请先在步骤 1 输入领星用户名。'
      : !lingxingCollectionStoreName.trim()
        ? '未就绪：请填写与领星下载中心显示完全一致的店铺名称。'
      : `未就绪：${loginConnectionStatus}`;
  const amazonAdsReadinessDetail = amazonAdsConnectionReady
    ? '已就绪：Main 已验证当前可见 Ads 账户与店铺绑定。'
    : adsIdentityCandidate
      ? `待确认：已自动识别账户 ${adsIdentityCandidate.detectedAccountLabel || adsIdentityCandidate.detectedExternalAccountId}。`
      : '待识别：启动可见连接后，在 Ads 窗口打开任一广告活动或广告组页面。';

  return (
    <div
      className="store-connection-workbench"
      style={{ ...loginStyles.container, minHeight: 'auto', padding: 0, background: 'transparent' }}
    >
      <section
        aria-label="当前店铺外部连接工作台"
        style={{ ...loginStyles.card, width: '100%', maxWidth: 'none', minHeight: 'auto', boxShadow: 'none' }}
      >
        <header style={loginStyles.topbar}>
          <div style={loginStyles.brand}>
            <h2 style={loginStyles.title}>当前店铺外部连接</h2>
            <p style={loginStyles.subtitle}>领星采集会话与真实广告执行身份</p>
          </div>
          <span style={loginStyles.version}>店铺级配置</span>
        </header>

        <section
          aria-label="当前店铺上下文"
          data-login-workbench-store
          style={loginStyles.contextBar}
        >
          <div style={loginStyles.contextIdentity}>
            <span style={loginStyles.contextLabel}>当前店铺</span>
            <span style={loginStyles.contextValue}>
              {store.activeStore?.displayName || '店铺待确认'} · {store.activeStore?.storeId || '未选择'}
            </span>
          </div>
          <span style={loginStyles.marketPill}>美国站 · USD</span>
        </section>

        <div style={loginStyles.workflowGrid}>
          <div style={loginStyles.leftColumn}>
            <section
              aria-labelledby="login-step-credentials-title"
              data-login-workbench-step="credentials"
              style={loginStyles.stepCard}
            >
              <div style={loginStyles.stepHeader}>
                <span aria-hidden="true" style={loginStyles.stepIndex}>1</span>
                <div style={loginStyles.stepHeadingGroup}>
                  <h2 id="login-step-credentials-title" style={loginStyles.stepTitle}>输入领星凭证</h2>
                  <p style={loginStyles.stepDescription}>
                    {freshTypedProofRequired
                      ? '本次正式证据首轮必须重新输入密码并勾选“记住密码”；密码仅由 Main 进程写入本机安全区。'
                      : '需要刷新登录身份时，请重新输入密码并勾选“记住密码”；密码仅由 Main 进程写入本机安全区。'}
                  </p>
                </div>
              </div>
              <div style={loginStyles.fieldsGrid}>
                <label style={loginStyles.fieldLabel}>
                  <span style={loginStyles.fieldName}>领星用户名</span>
                  <input
                    onChange={(event) => {
                      const nextUsername = event.target.value;
                      const canReuseSaved = savedPasswordAvailable
                        && !lingxingEnrollmentPending
                        && rememberPassword
                        && !password
                        && nextUsername.trim() === savedCredentialUsername;
                      setCredentialDraft((current) => ({
                        ...current,
                        username: nextUsername,
                        credentialSource: canReuseSaved ? 'saved' : 'typed',
                        dirty: true,
                      }));
                      if (savedPasswordAvailable && !canReuseSaved) {
                        setCredentialNotice('账号已修改；请输入密码以建立新的登录会话。');
                        setCredentialTone('warning');
                      } else if (canReuseSaved) {
                        setCredentialNotice(savedLoginCredentialNotice({
                          credentialState: 'encrypted_ready',
                          passwordAvailable: true,
                          rememberPassword: true,
                        }));
                        setCredentialTone('ready');
                      }
                    }}
                    aria-label="领星用户名"
                    onKeyDown={(event) => event.key === 'Enter' && !loading && loginConnectionsReady && handleLogin()}
                    placeholder="领星用户名"
                    style={loginStyles.input}
                    type="text"
                    value={username}
                  />
                </label>
                <label style={loginStyles.fieldLabel}>
                  <span style={loginStyles.fieldName}>领星密码</span>
                  <input
                    data-credential-source={credentialSource}
                    onChange={(event) => {
                      const nextPassword = event.target.value;
                      const canReuseSaved = !nextPassword
                        && !lingxingEnrollmentPending
                        && savedPasswordAvailable
                        && rememberPassword
                        && username.trim() === savedCredentialUsername;
                      setCredentialDraft((current) => ({
                        ...current,
                        password: nextPassword,
                        credentialSource: canReuseSaved ? 'saved' : 'typed',
                        dirty: true,
                      }));
                      if (canReuseSaved) {
                        setCredentialNotice(savedLoginCredentialNotice({
                          credentialState: 'encrypted_ready',
                          passwordAvailable: true,
                          rememberPassword: true,
                        }));
                        setCredentialTone('ready');
                      } else if (savedCredentialState === 'encryption_unavailable') {
                        setCredentialNotice('当前系统无法使用本机加密；本次仅登录、不保存密码。');
                        setCredentialTone('warning');
                      } else {
                        setCredentialNotice('本次将使用当前页面输入的密码；已保存密码不会发送到当前页面。');
                        setCredentialTone('neutral');
                      }
                    }}
                    aria-label="领星密码"
                    onKeyDown={(event) => event.key === 'Enter' && !loading && loginConnectionsReady && handleLogin()}
                    placeholder="领星密码"
                    style={loginStyles.input}
                    type="password"
                    value={password}
                  />
                </label>
              </div>
              <div style={loginStyles.rememberRow}>
                <label style={loginStyles.rememberLabel}>
                  <input
                    checked={rememberPassword}
                    disabled={savedCredentialState === 'encryption_unavailable'}
                    onChange={(event) => {
                      const remember = event.target.checked;
                      const canReuseSaved = remember
                        && !lingxingEnrollmentPending
                        && savedPasswordAvailable
                        && !password
                        && username.trim() === savedCredentialUsername;
                      setCredentialDraft((current) => ({
                        ...current,
                        rememberPassword: remember,
                        credentialSource: canReuseSaved ? 'saved' : 'typed',
                        dirty: true,
                      }));
                      if (!remember && savedPasswordAvailable) {
                        setCredentialNotice('取消后请重新输入密码；登录成功会清除本机保存的密码，账号仍保留。');
                        setCredentialTone('warning');
                      } else if (canReuseSaved) {
                        setCredentialNotice(savedLoginCredentialNotice({
                          credentialState: 'encrypted_ready',
                          passwordAvailable: true,
                          rememberPassword: true,
                        }));
                        setCredentialTone('ready');
                      } else {
                        setCredentialTone('neutral');
                      }
                    }}
                    type="checkbox"
                  />
                  <span>记住密码</span>
                </label>
                <span className={securityTagView.className}>{securityTagView.label}</span>
              </div>
              {lingxingEnrollmentPending && (
                <label style={loginStyles.enrollmentResetRow}>
                  <input
                    aria-label="允许重置当前店铺领星会话"
                    checked={resetLingxingSessionForEnrollment}
                    disabled={loading || credentialSource !== 'typed'}
                    onChange={(event) => {
                      setCredentialDraft((current) => ({
                        ...current,
                        resetLingxingSessionForEnrollment: event.target.checked,
                        dirty: true,
                      }));
                    }}
                    type="checkbox"
                  />
                  <span style={loginStyles.enrollmentResetCopy}>
                    <strong>若检测到旧登录，允许重置当前店铺领星会话</strong>
                    <span>
                      只清理当前店铺独立 Chromium 中的登录会话并重新进入可见登录页；不会删除 Profile、报表或其他店铺数据。
                    </span>
                  </span>
                </label>
              )}
              <div className={loginStatusClass} role="status" aria-live="polite">
                {loginStatus}
              </div>
            </section>

            <section
              aria-labelledby="login-step-bindings-title"
              data-login-workbench-step="bindings"
              style={loginStyles.stepCard}
            >
              <div style={loginStyles.stepHeader}>
                <span aria-hidden="true" style={loginStyles.stepIndex}>2</span>
                <div style={loginStyles.stepHeadingGroup}>
                  <h2 id="login-step-bindings-title" style={loginStyles.stepTitle}>配置当前店铺连接</h2>
                  <p style={loginStyles.stepDescription}>
                    只需配置领星账号与下载中心店铺名称；广告账户由 Main 从可见 Ads 页面自动识别。
                  </p>
                </div>
              </div>
              <div style={loginStyles.connectionGrid}>
                <div style={loginStyles.connectionPanel}>
                  <p style={loginStyles.connectionName}>领星 ERP</p>
                  <label style={loginStyles.fieldLabel}>
                    <span style={loginStyles.notice}>领星下载中心店铺名称</span>
                    <input
                      aria-label="领星下载中心店铺名称"
                      autoComplete="off"
                      data-package-ui-evidence-field="lingxing-shop-identity"
                      maxLength={256}
                      onChange={(event) => setLingxingCollectionStoreName(event.target.value)}
                      onKeyDown={(event) => {
                        if (
                          event.key === 'Enter'
                          && !loading
                          && loginConnectionState !== 'binding'
                          && username.trim()
                          && lingxingCollectionStoreName.trim()
                        ) void handleBindLingxingConnection();
                      }}
                      placeholder="必须与领星下载中心显示完全一致"
                      style={loginStyles.input}
                      type="text"
                      value={lingxingCollectionStoreName}
                    />
                  </label>
                  <div className="login-stable-identity" role="status" aria-live="polite">
                    <span>稳定身份（Main 首次新鲜登录识别）</span>
                    <output aria-label="领星稳定身份只读状态">
                      {lingxingConnection?.externalAccountId
                        ? `已识别：${lingxingConnection.externalAccountId}`
                        : '待首次新鲜登录识别'}
                    </output>
                  </div>
                  <p
                    data-login-connection-status
                    data-state={loginConnectionState}
                    role="status"
                    aria-live="polite"
                    style={loginStyles.connectionStatus}
                  >
                    {loginConnectionStatus}
                  </p>
                  {!lingxingConnectionReady ? (
                    <button
                      data-package-ui-evidence-action="bind-lingxing-connection"
                      type="button"
                      disabled={loading || loginConnectionState === 'binding' || !username.trim() || !lingxingCollectionStoreName.trim()}
                      onClick={handleBindLingxingConnection}
                      style={loginStyles.connectionButton}
                    >
                      {loginConnectionState === 'binding'
                        ? '绑定中…'
                        : lingxingConnection
                          ? '更新领星账号与店铺绑定'
                          : '绑定领星账号与店铺'}
                    </button>
                  ) : null}
                  {lingxingConnection && (
                    <button
                      className="login-connection-unbind"
                      disabled={loading || unbindBusy}
                      onClick={() => setConfirmUnbindConnection({ ...lingxingConnection })}
                      type="button"
                    >
                      解绑领星映射
                    </button>
                  )}
                </div>
                <div style={loginStyles.connectionPanel}>
                  <p style={loginStyles.connectionName}>领星广告账户 · US / USD</p>
                  <div className="login-stable-identity" role="status" aria-live="polite">
                    <span>广告账户（Main 自动识别，只读）</span>
                    <output aria-label="领星广告账户自动识别状态">
                      {amazonAdsConnectionReady
                        ? `已绑定：${amazonAdsConnection?.accountLabel || amazonAdsConnection?.externalAccountId}`
                        : adsIdentityCandidate
                          ? `待确认：${adsIdentityCandidate.detectedAccountLabel || adsIdentityCandidate.detectedExternalAccountId}`
                          : '启动连接后自动识别，无需在领星中查找编号'}
                    </output>
                  </div>
                  <p
                    data-login-amazon-ads-connection-status
                    data-state={amazonAdsConnectionState}
                    role="status"
                    aria-live="polite"
                    style={loginStyles.connectionStatus}
                  >
                    {amazonAdsConnectionStatus}
                  </p>
                  {adsIdentityCandidate && !amazonAdsConnectionReady ? (
                    <button
                      data-package-ui-evidence-action="confirm-amazon-ads-identity"
                      type="button"
                      disabled={loading || amazonAdsConnectionState === 'binding' || amazonAdsConnectionState === 'unbinding'}
                      onClick={handleConfirmAmazonAdsConnection}
                      style={loginStyles.connectionButton}
                    >
                      {amazonAdsConnectionState === 'binding' ? '确认中…' : '确认绑定到当前店铺'}
                    </button>
                  ) : null}
                  {amazonAdsConnection && (
                    <button
                      className="login-connection-unbind"
                      disabled={loading || unbindBusy}
                      onClick={() => setConfirmUnbindConnection({ ...amazonAdsConnection })}
                      type="button"
                    >
                      解绑领星广告账户
                    </button>
                  )}
                </div>
              </div>
              <div style={loginStyles.hint}>
                领星下载中心店铺名称必须与下载中心当前可见名称完全一致；广告账户编号不要求人工查找或填写。解绑映射不会清除本机保存的密码。
              </div>
            </section>
          </div>

          <section
            aria-labelledby="login-step-authorize-title"
            data-login-workbench-step="authorize"
            style={loginStyles.actionCard}
          >
            <div style={loginStyles.stepHeader}>
              <span aria-hidden="true" style={loginStyles.stepIndex}>3</span>
              <div style={loginStyles.stepHeadingGroup}>
                <h2 id="login-step-authorize-title" style={loginStyles.stepTitle}>启动可见浏览器连接</h2>
                <p style={loginStyles.stepDescription}>
                  领星映射就绪后即可启动；广告账户会在可见 Ads 页面中自动识别，整个过程中请保持主窗口打开。
                </p>
              </div>
            </div>

            <div
              aria-live="polite"
              data-login-workbench-readiness={loginWorkbenchReady ? 'ready' : 'blocked'}
              role="status"
              style={loginStyles.readinessPanel}
            >
              <p style={loginStyles.readinessTitle}>
                {loginWorkbenchReady ? '登录条件已就绪，可以开始授权' : '暂不能登录，请先处理以下项目'}
              </p>
              <ul style={loginStyles.readinessList}>
                <li style={loginStyles.readinessItem}>领星：{lingxingReadinessDetail}</li>
                <li style={loginStyles.readinessItem}>Amazon Ads：{amazonAdsReadinessDetail}</li>
                {lingxingEnrollmentPending && (
                  <li style={loginStyles.readinessItem}>
                    首次身份登记：{resetLingxingSessionForEnrollment
                      ? '若发现旧登录，会仅重置当前店铺的领星会话后重新登录。'
                      : '默认不清理会话；若检测到旧登录，系统会停下并要求你确认重置。'}
                  </li>
                )}
                {freshTypedProofRequired && (
                  <li style={loginStyles.readinessItem}>
                    首轮证据：{!freshTypedProofStorageReady
                      ? '本机加密不可用，无法建立可核验的新凭证会话。'
                      : freshTypedProofReady
                        ? '已重新输入密码并选择保存。'
                        : '请重新输入密码并勾选“记住密码”。'}
                  </li>
                )}
              </ul>
            </div>

            <ol style={loginStyles.guidanceList}>
              <li>点击登录后，保持 Electron 主窗口打开；可以最小化，但不要关闭。</li>
              <li>在项目自带的独立 Playwright Chromium 中完成领星 ERP 与 Ads 授权；如系统提示，请打开任一广告活动或广告组页面。</li>
              <li>识别到账户后回到这里点击“确认绑定到当前店铺”；确认前真实广告写入保持阻断。</li>
              <li>
                {packageUiEvidenceMode
                  ? 'Package UI 证据采集器不会读取、填写或点击你的账号密码；应用 Main 进程只在本机解密并提交你明确选择使用的领星凭证。'
                  : '应用 Main 进程只在本机解密并提交你明确选择使用的领星凭证；验证码、MFA 与 Amazon Ads 授权由你在可见窗口完成。'}
              </li>
            </ol>

            {store.postCommitSyncWarning && (
              <div className="store-post-commit-sync-warning" role="status">
                {store.postCommitSyncWarning}
              </div>
            )}
            {error && <div role="alert" style={loginStyles.error}>{error}</div>}
            <button
              aria-busy={loginButtonView.ariaBusy}
              className={loginButtonView.className}
              disabled={loading || !loginWorkbenchReady}
              onClick={handleLogin}
              style={loginStyles.button}
              type="button"
            >
              <span className="button-content">
                {loginButtonView.loading && <span className="button-spinner" aria-hidden="true" />}
                <span>{loginButtonView.label}</span>
              </span>
            </button>
            <div style={loginStyles.notice}>
              主动作保持禁用时，上方会逐项说明未就绪原因；不会以静默禁用代替操作指引。
            </div>
          </section>
        </div>
      </section>
      {confirmUnbindConnection && (
        <div
          className="mission-control-dialog-backdrop login-unbind-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !unbindBusy) setConfirmUnbindConnection(null);
          }}
          ref={unbindDialogFocus.overlayRootRef}
          role="presentation"
        >
          <section
            aria-describedby="login-unbind-description"
            aria-labelledby="login-unbind-title"
            aria-modal="true"
            className="mission-control-dialog mission-control-dialog--confirm login-unbind-dialog"
            onMouseDown={(event) => event.stopPropagation()}
            ref={unbindDialogFocus.surfaceRef}
            role="alertdialog"
            tabIndex={-1}
          >
            <header>
              <div>
                <span>REMOVE STORE MAPPING</span>
                <h2 id="login-unbind-title">
                  解绑{confirmUnbindConnection.provider === 'lingxing' ? '领星下载中心店铺映射' : '领星广告账户'}？
                </h2>
                <p id="login-unbind-description">
                  解绑只移除当前店铺的连接映射并使会话失效；不会清除本机保存的领星密码。
                </p>
                <dl className="store-connection-unbind-facts">
                  <div><dt>账号</dt><dd>{confirmUnbindConnection.accountLabel || '未记录'}</dd></div>
                  {confirmUnbindConnection.provider === 'lingxing' ? (
                    <>
                      <div><dt>下载中心店铺名称</dt><dd>{confirmUnbindConnection.collectionStoreName || '未记录'}</dd></div>
                      <div><dt>稳定身份</dt><dd>{confirmUnbindConnection.externalAccountId || '待首次新鲜登录识别'}</dd></div>
                    </>
                  ) : (
                    <div><dt>自动识别身份</dt><dd>{confirmUnbindConnection.externalAccountId || '未记录'}</dd></div>
                  )}
                </dl>
              </div>
            </header>
            <footer>
              <button disabled={unbindBusy} onClick={() => setConfirmUnbindConnection(null)} type="button">取消</button>
              <button
                aria-busy={unbindBusy || undefined}
                autoFocus
                className="workspace-button workspace-button--primary"
                disabled={unbindBusy}
                onClick={() => void handleUnbindConnection(confirmUnbindConnection)}
                type="button"
              >
                {unbindBusy ? '解绑中…' : '确认解绑映射'}
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}

function MissionControlRuntime({
  loginSession,
  onLoggedOut,
}: {
  loginSession?: LoginSessionInfo | null;
  onLoggedOut: () => void;
}) {
  const { activeNavigation, setActiveNavigation } = useStore();
  const store = useMissionControlStoreContext();
  const missionControl = useMissionControlBridge();
  const credentialDraftStoreId = String(store.activeStore?.storeId ?? '');
  const [storeConnectionCredentialDraft, setStoreConnectionCredentialDraft] =
    useState<StoreConnectionCredentialDraft>(() => (
      emptyStoreConnectionCredentialDraft(credentialDraftStoreId)
    ));
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
      .catch(() => undefined);
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
      } catch {
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
    await (window as any).electronAPI.browserLogout();
    onLoggedOut();
  }

  if (!store.authoritativeContext || !store.activeStore) return null;
  const scopedStoreConnectionCredentialDraft =
    storeConnectionCredentialDraft.storeId === credentialDraftStoreId
      ? storeConnectionCredentialDraft
      : emptyStoreConnectionCredentialDraft(credentialDraftStoreId);

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
  const sessionStatus = (
    <span
      aria-label={describeLoginSession(loginSession)}
      aria-live="polite"
      className={`session-line${loginSession?.sessionIdentityVerified === false || loginSession?.adsSessionReady === false ? ' session-line-warning' : ''}`}
      role="status"
      tabIndex={loginSession?.sessionIdentityVerified === false || loginSession?.adsSessionReady === false ? 0 : undefined}
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
        await store.retryBootstrap();
        await store.refreshDailyStatuses().catch(() => undefined);
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
          storeCrudSlot={(
            <>
              <StoreConnectionWorkbench
                credentialDraft={scopedStoreConnectionCredentialDraft}
                setCredentialDraft={setStoreConnectionCredentialDraft}
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
            </>
          )}
          settingsCrudSlot={(
            <StoreRuntimeConfigPanel storeContext={store.authoritativeContext} />
          )}
          storeContext={store.authoritativeContext}
        />
      </div>
    </MissionControlShell>
  );
}

export function defaultOperationScopeForAuthority(
  context: StoreContextEnvelope,
  storeName: string,
): OperationScope {
  const end = new Date(`${context.businessDate}T12:00:00.000Z`);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 13);
  return {
    dateFrom: start.toISOString().slice(0, 10),
    dateTo: context.businessDate,
    storeName,
    marketplaceCode: 'US',
    currency: 'USD',
    asin: undefined,
    batchId: undefined,
  };
}

export function operationScopeBelongsToAuthority(
  value: unknown,
  context: StoreContextEnvelope,
  storeName: string,
): value is OperationScope {
  if (!value || typeof value !== 'object') return false;
  const scope = value as Partial<OperationScope>;
  return typeof scope.dateFrom === 'string'
    && typeof scope.dateTo === 'string'
    && scope.storeName === storeName
    && scope.marketplaceCode === context.marketplace
    && scope.currency === context.currency;
}

export function shouldStartLoginRestoreForAuthority(
  restoredAuthorityKey: string | null,
  current: StoreAuthoritySnapshot,
): current is StoreAuthoritySnapshot & { authorityKey: string } {
  return current.phase === 'ready'
    && Boolean(current.authorityKey)
    && restoredAuthorityKey !== current.authorityKey;
}

function MissionControlSessionAuthorityBoundary({ children }: { children: React.ReactNode }) {
  const store = useMissionControlStoreContext();
  const { isLoggedIn, setLoginState } = useStore();
  const loginRestoreAuthorityRef = useRef<string | null>(null);
  const previousAuthorityRef = useRef<StoreAuthoritySnapshot>({
    authorityKey: store.authorityKey,
    contextEpoch: store.contextEpoch,
    phase: store.phase,
  });

  useLayoutEffect(() => {
    const currentAuthority: StoreAuthoritySnapshot = {
      authorityKey: store.authorityKey,
      contextEpoch: store.contextEpoch,
      phase: store.phase,
    };
    const previousAuthority = previousAuthorityRef.current;
    previousAuthorityRef.current = currentAuthority;
    if (shouldInvalidateLoginForStoreAuthority(isLoggedIn, previousAuthority, currentAuthority)) {
      setLoginState(false);
    }
  }, [isLoggedIn, setLoginState, store.authorityKey, store.contextEpoch, store.phase]);

  useEffect(() => {
    const currentAuthority: StoreAuthoritySnapshot = {
      authorityKey: store.authorityKey,
      contextEpoch: store.contextEpoch,
      phase: store.phase,
    };
    if (!shouldStartLoginRestoreForAuthority(loginRestoreAuthorityRef.current, currentAuthority)) return;
    loginRestoreAuthorityRef.current = currentAuthority.authorityKey;
    const requestedAuthorityKey = currentAuthority.authorityKey;
    const requestedLoginRevision = useStore.getState().loginStateRevision;

    async function restoreLoginState() {
      try {
        const state = await appElectronApi().getState();
        if (useStore.getState().loginStateRevision !== requestedLoginRevision) return;
        const currentAuthorityKey = previousAuthorityRef.current.authorityKey;
        if (shouldRestoreLoginForStoreAuthority({
          responseIsLoggedIn: Boolean(state?.isLoggedIn),
          responseAuthorityKey: appStateAuthorityKey(state),
          requestedAuthorityKey,
          currentAuthorityKey,
        })) {
          setLoginState(true, state.currentStore, state.loginSession || null);
        } else {
          setLoginState(false);
        }
      } catch (caught) {
        console.error(caught);
        if (useStore.getState().loginStateRevision === requestedLoginRevision) {
          setLoginState(false);
        }
      }
    }

    void restoreLoginState();
  }, [setLoginState, store.authorityKey, store.contextEpoch, store.phase]);

  return <>{children}</>;
}

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

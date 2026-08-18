import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import {
  missionControlContextKey,
  normalizeLingxingCollectionStoreName,
  type StoreConnection,
  type StoreContextEnvelope,
  type StoreWorkspaceView,
} from '@amazon-ai-ops/shared-types';
import type { AppRoute, DeliveryReadinessView, OperationScope } from './types';
import type {
  BrowserLoginCredentialPersistence,
  BrowserLoginRequest,
  BrowserLoginResult,
  StoreScopedSavedLoginCredentialStatus,
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

const CONNECTION_INTERNAL_OPERATOR_COPY = /\b(?:Mission|Experiment|UNKNOWN|revision|draft|Main|StoreContext|Authority|Profile|manifest|fingerprint|Renderer|CRUD|PRODUCTION_NATIVE|PROTOTYPE_ONLY|LEGACY_ADAPTER|sequence|correction|DECISION|ACTION|READBACK|EFFECT)\b|\bset_keyword_bid\b|\bdry-run\b|\bappend-only\b/i;

export function connectionOperatorCopy(value: unknown, fallback: string): string {
  const message = typeof value === 'string' ? value.trim() : '';
  if (!message || CONNECTION_INTERNAL_OPERATOR_COPY.test(message)) return fallback;
  return message;
}

export function configuredSessionResetRequiredFromError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return message.includes('当前领星会话身份未经本次凭证验证');
}

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
    ? session.adsTitle || session.adsUrl
      ? `Ads 页面已打开，当前店铺身份待识别：${session.adsUnavailableReason || '真实广告执行保持阻断'}`
      : `Ads 未连接：${session.adsUnavailableReason || '独立 Ads 会话待授权，广告执行保持阻断'}`
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
  if (erpReady && session.adsSessionReady === false && Boolean(session.adsTitle || session.adsUrl)) {
    return 'ERP 已连接 · Ads 待识别';
  }
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
  if (input.credentialNotice) {
    return connectionOperatorCopy(
      input.credentialNotice,
      '凭证状态异常，请重新输入密码后重试。',
    );
  }
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

export function resolveAdsRetryCredentialAvailability(input: Readonly<{
  connectionUsername: string;
  loginSession?: LoginSessionInfo | null;
  rememberPassword: boolean;
  savedCredentialUsername: string;
  savedPasswordAvailable: boolean;
}>): Readonly<{
  passwordAvailable: boolean;
  rememberPassword: boolean;
  username: string;
}> {
  const connectionUsername = input.connectionUsername.trim();
  const sessionBackedCredential = Boolean(
    connectionUsername
    && input.loginSession?.erpSessionReady === true
    && input.loginSession?.sessionIdentityVerified === true
    && (
      input.loginSession?.credentialPersistence === 'saved'
      || input.loginSession?.credentialPersistence === 'main_managed'
    ),
  );
  return {
    passwordAvailable: input.savedPasswordAvailable || sessionBackedCredential,
    rememberPassword: input.rememberPassword || sessionBackedCredential,
    username: input.savedCredentialUsername.trim()
      || (sessionBackedCredential ? connectionUsername : ''),
  };
}

export function selectFreshBrowserLoginStoreContext(
  expected: StoreContextEnvelope | null,
  activeView: StoreWorkspaceView | null,
): StoreContextEnvelope {
  if (!expected || !activeView) {
    throw new Error('当前店铺授权上下文不可用，请刷新店铺后重新连接。');
  }
  const candidate = activeView.context;
  const returnedStore = activeView.store;
  if (
    candidate.storeId !== expected.storeId
    || candidate.browserProfileId !== expected.browserProfileId
    || candidate.marketplace !== expected.marketplace
    || candidate.currency !== expected.currency
    || candidate.businessTimezone !== expected.businessTimezone
    || returnedStore.storeId !== candidate.storeId
    || returnedStore.browserProfileId !== candidate.browserProfileId
    || returnedStore.marketplace !== candidate.marketplace
    || returnedStore.currency !== candidate.currency
    || returnedStore.businessTimezone !== candidate.businessTimezone
  ) {
    throw new Error('本机读取的当前店铺身份与正在操作的店铺不一致，请刷新店铺后重新连接；本次操作已阻断。');
  }
  return candidate;
}

function formatConnectionSuccessTime(value?: string): string {
  if (!value) return '本次会话刚刚确认';
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return '本次会话已确认';
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
    day: '2-digit',
  }).format(timestamp);
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

type StoreConnectionLoginAction = 'initial' | 'retry-ads' | 'reconnect-all';

interface StoreLoginAttemptEvidence {
  storeId: string;
  sequence: number;
  pending: boolean;
  action: StoreConnectionLoginAction;
  error: string;
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

function emptyStoreLoginAttemptEvidence(storeId: string): StoreLoginAttemptEvidence {
  return {
    storeId,
    sequence: 0,
    pending: false,
    action: 'initial',
    error: '',
  };
}

function StoreConnectionWorkbench({
  credentialDraft,
  loginAction,
  loginAttemptError,
  loginAttemptPending,
  loginAttemptSequence,
  setLoginAction,
  setLoginAttemptError,
  setLoginAttemptPending,
  setLoginAttemptSequence,
  setCredentialDraft,
}: {
  credentialDraft: StoreConnectionCredentialDraft;
  loginAction: StoreConnectionLoginAction;
  loginAttemptError: string;
  loginAttemptPending: boolean;
  loginAttemptSequence: number;
  setLoginAction: React.Dispatch<React.SetStateAction<StoreConnectionLoginAction>>;
  setLoginAttemptError: React.Dispatch<React.SetStateAction<string>>;
  setLoginAttemptPending: React.Dispatch<React.SetStateAction<boolean>>;
  setLoginAttemptSequence: React.Dispatch<React.SetStateAction<number>>;
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
  const [configuredSessionResetRequired, setConfiguredSessionResetRequired] = useState(false);
  const [lingxingCollectionStoreName, setLingxingCollectionStoreName] = useState('');
  const loading = loginAttemptPending;
  const error = loginAttemptError;
  const setLoading = setLoginAttemptPending;
  const setError = setLoginAttemptError;
  const [loginConnectionState, setLoginConnectionState] = useState<'missing' | 'configured' | 'binding' | 'unbinding' | 'ready' | 'error'>('missing');
  const [amazonAdsConnectionState, setAmazonAdsConnectionState] =
    useState<'missing' | 'configured' | 'opened' | 'detected' | 'binding' | 'unbinding' | 'ready' | 'error'>('missing');
  const [confirmUnbindConnection, setConfirmUnbindConnection] = useState<StoreConnection | null>(null);
  const credentialDraftDirtyRef = useRef(credentialDraft.dirty);
  const credentialStatusRequestSequence = useRef(0);
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
  const erpSessionConnected = loginSession?.erpSessionReady === true
    || lingxingConnection?.session?.status === 'ready';
  const adsSessionConnected = loginSession?.adsSessionReady === true
    || amazonAdsConnection?.session?.status === 'ready';
  const adsIdentityCandidate = loginSession?.adsIdentityCandidate;
  const adsPageVisible = Boolean(loginSession?.adsUrl || loginSession?.adsTitle);
  const adsConfirmationStoreLabel = adsIdentityCandidate?.detectedAccountLabel?.trim()
    || lingxingCollectionStoreName.trim()
    || '当前店铺';
  const adsConfirmationPending = erpSessionConnected
    && !adsSessionConnected
    && Boolean(adsIdentityCandidate)
    && !amazonAdsConnectionReady;
  const adsRetryRequiresFullReconnect =
    amazonAdsConnection?.session?.failureCode === 'VISIBLE_BROWSER_CLOSED';
  const loginConnectionsReady = lingxingConnectionReady;
  const lingxingEnrollmentPending = lingxingConnectionReady
    && !lingxingConnection?.externalAccountId;
  const lingxingSessionResetAvailable = lingxingConnectionReady && credentialSource === 'typed';
  const configuredSavedSessionResetReady = !packageUiEvidenceMode
    && lingxingConnectionReady
    && !lingxingEnrollmentPending
    && credentialSource === 'saved'
    && savedPasswordAvailable
    && rememberPassword
    && Boolean(savedCredentialUsername)
    && username.trim() === savedCredentialUsername;
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
  const enrollmentResetConsentReady = !lingxingEnrollmentPending
    || resetLingxingSessionForEnrollment;
  const loginLaunchReady = lingxingConnectionReady
    && freshTypedProofReady
    && enrollmentTypedProofReady;
  const loginWorkbenchReady = loginLaunchReady;
  const loginResetAuthorizationReady = loginLaunchReady
    && enrollmentResetConsentReady;
  const adsRetryCredential = resolveAdsRetryCredentialAvailability({
    connectionUsername: lingxingConnection?.accountLabel ?? '',
    loginSession,
    rememberPassword,
    savedCredentialUsername,
    savedPasswordAvailable,
  });
  const effectiveSavedCredentialUsername = adsRetryCredential.username;
  const effectiveSavedPasswordAvailable = adsRetryCredential.passwordAvailable;
  const effectiveRetryRememberPassword = adsRetryCredential.rememberPassword;
  const retryAdsReady = erpSessionConnected
    && !adsSessionConnected
    && !adsIdentityCandidate
    && !adsRetryRequiresFullReconnect
    && lingxingConnectionReady
    && effectiveSavedPasswordAvailable
    && effectiveRetryRememberPassword
    && Boolean(effectiveSavedCredentialUsername)
    && username.trim() === effectiveSavedCredentialUsername;
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
    passwordAvailable: effectiveSavedPasswordAvailable,
  });
  const unbindBusy = loginConnectionState === 'unbinding' || amazonAdsConnectionState === 'unbinding';
  const unbindDialogFocus = useOverlayFocusScope<HTMLDivElement, HTMLElement>({
    dismissDisabled: unbindBusy,
    onDismiss: () => setConfirmUnbindConnection(null),
    open: confirmUnbindConnection !== null,
  });

  const refreshSavedCredentialStatus = useCallback(async (
    options: Readonly<{
      force?: boolean;
      shouldAbort?: () => boolean;
    }> = {},
  ): Promise<boolean> => {
    const force = options.force === true;
    const statusRequestSequence = ++credentialStatusRequestSequence.current;
    const requestedStoreId = store.activeStore?.storeId ?? null;
    const requestedStoreKey = String(requestedStoreId ?? '');
    const connectionUsername = lingxingConnection?.accountLabel?.trim() ?? '';
    const api = appElectronApi(connectionUsername);
    if (!api?.getSavedLoginCredentialStatus) return false;
    try {
      const saved = await api.getSavedLoginCredentialStatus() as StoreScopedSavedLoginCredentialStatus;
      if (options.shouldAbort?.()
        || statusRequestSequence !== credentialStatusRequestSequence.current
        || !saved) return false;
      if (String(saved.storeId ?? '') !== String(requestedStoreId ?? '')) return false;
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
      const savedCredentialReady = !enrollmentPending
        && !requiresFreshTypedProof
        && passwordAvailable
        && remember
        && Boolean(effectiveUsername)
        && (
          saved.credentialState === 'encrypted_ready'
          || saved.credentialState === 'migrated'
        );
      if (force && !savedCredentialReady) return false;

      setSavedCredentialUsername(savedUsername);
      setSavedPasswordAvailable(passwordAvailable);
      setSavedCredentialState(credentialState);
      setPackageUiEvidenceMode(Boolean(saved.packageUiEvidenceMode));
      setFreshTypedProofRequired(requiresFreshTypedProof);
      setCredentialDraft((current) => {
        if (current.storeId !== requestedStoreKey) return current;
        if (!force) {
          if (current.hydrated) return current;
          if (current.dirty) return { ...current, hydrated: true };
        }
        const refreshedDraft = {
          ...current,
          username: effectiveUsername,
          password: '',
          rememberPassword: remember,
          resetLingxingSessionForEnrollment: false,
          hydrated: true,
        };
        if (force) {
          return {
            ...refreshedDraft,
            credentialSource: 'saved',
            dirty: false,
          };
        }
        return {
          ...refreshedDraft,
          credentialSource: savedCredentialReady ? 'saved' : 'typed',
          dirty: current.dirty,
        };
      });
      if (force || !credentialDraftDirtyRef.current) {
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
      return true;
    } catch {
      if (!force
        && !options.shouldAbort?.()
        && statusRequestSequence === credentialStatusRequestSequence.current) {
        setCredentialNotice('无法读取本机凭证状态，请重新输入密码。');
        setCredentialTone('blocked');
      }
      return false;
    }
  }, [
    lingxingConnection?.accountLabel,
    lingxingConnection?.externalAccountId,
    store.activeStore?.storeId,
    setCredentialDraft,
  ]);

  useEffect(() => {
    setLoginConnectionState(
      erpSessionConnected ? 'ready' : lingxingConnectionReady ? 'configured' : 'missing',
    );
  }, [
    erpSessionConnected,
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
      adsSessionConnected
        ? 'ready'
        : adsIdentityCandidate
          ? 'detected'
          : adsPageVisible
            ? 'opened'
          : loginSession?.adsUnavailableReason
            ? 'error'
          : amazonAdsConnectionReady
            ? 'configured'
          : 'missing',
    );
  }, [
    adsSessionConnected,
    amazonAdsConnection?.externalAccountId,
    amazonAdsConnection?.id,
    amazonAdsConnectionReady,
    adsIdentityCandidate?.confirmationToken,
    adsPageVisible,
    loginSession?.adsUnavailableReason,
    store.authorityKey,
  ]);

  useEffect(() => {
    let cancelled = false;
    const requestedStoreKey = String(store.activeStore?.storeId ?? '');
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
    void refreshSavedCredentialStatus({ shouldAbort: () => cancelled });
    return () => {
      cancelled = true;
    };
  }, [
    lingxingConnection?.accountLabel,
    lingxingConnection?.externalAccountId,
    lingxingConnection?.id,
    credentialDraft.hydrated,
    credentialDraft.storeId,
    refreshSavedCredentialStatus,
    store.activeStore?.storeId,
  ]);

  async function handleLogin(action: 'initial' | 'retry-ads' | 'reconnect-all' = 'initial') {
    if (loading) return;
    const retryingAds = action === 'retry-ads';
    if (!lingxingConnectionReady) {
      setError('请先把当前领星账号绑定到所选店铺。');
      return;
    }
    if (retryingAds && !retryAdsReady) {
      setError(effectiveSavedPasswordAvailable
        ? '当前 ERP 会话或店铺身份已变化，不能只重试 Ads；请使用“重新连接 ERP 与 Ads”。'
        : '当前店铺没有本机安全区托管的密码，不能只重试 Ads；请重新输入密码并连接 ERP 与 Ads。');
      return;
    }
    if (!retryingAds && !freshTypedProofReady) {
      setError(freshTypedProofStorageReady
        ? '本次正式证据首轮必须重新输入密码并勾选“记住密码”。'
        : '本次正式证据首轮需要本机加密保存密码，但当前系统加密不可用。');
      return;
    }
    if (!retryingAds && !enrollmentResetConsentReady) {
      setCredentialNotice('未授权重置：系统会先检查当前会话，不会在未授权时清理登录数据；若检测到无法核验的旧会话，会说明原因并保持首次绑定阻断。');
      setCredentialTone('warning');
    }
    setLoginAttemptSequence((current) => current + 1);
    setLoading(true);
    setLoginAction(action);
    setError('');
    setConfiguredSessionResetRequired(false);
    try {
      const api = appElectronApi(username);
      if (!api?.browserLogin && browserPreviewBootstrap.enabled) {
        const previewState = await api.getState();
        setCredentialNotice('已进入浏览器预览模式；这里不连接真实 ERP/Ads，也不会写入本地数据库。');
        setLoginState(true, previewState.currentStore, previewState.loginSession || null);
        return;
      }
      const activeView = await api.getActiveStoreWorkspaceView();
      const freshStoreContext = selectFreshBrowserLoginStoreContext(
        store.authoritativeContext,
        activeView,
      );
      const request = buildBrowserLoginRequest({
        credentialSource: retryingAds ? 'saved' : credentialSource,
        password,
        resetLingxingSessionForEnrollment:
          !retryingAds && credentialSource === 'typed' && resetLingxingSessionForEnrollment,
        rememberPassword: retryingAds ? effectiveRetryRememberPassword : rememberPassword,
        savedCredentialUsername: effectiveSavedCredentialUsername,
        savedPasswordAvailable: effectiveSavedPasswordAvailable,
        storeContext: freshStoreContext,
        lingxingCollectionStoreName,
        username: retryingAds ? effectiveSavedCredentialUsername : username,
      });
      if (!request) {
        setError('请输入用户名和密码');
        return;
      }
      const session = await api.browserLogin(request) as BrowserLoginResult;
      credentialStatusRequestSequence.current += 1;
      setLoginState(true, session.currentStore, session);
      setLoginConnectionState(session.erpSessionReady ? 'ready' : 'configured');
      setAmazonAdsConnectionState(
        session.adsSessionReady
          ? 'ready'
          : session.adsIdentityCandidate
            ? 'detected'
            : session.adsUrl || session.adsTitle
              ? 'opened'
            : session.adsUnavailableReason
              ? 'error'
              : 'missing',
      );
      setCredentialNotice(session.adsSessionReady
        ? 'ERP 与 Ads 已连接，可以继续当前店铺任务。'
        : session.adsUrl || session.adsTitle
          ? `ERP 已连接；Ads 页面已打开，当前店铺身份尚未确认。${session.adsUnavailableReason || '真实广告执行保持阻断。'}`
          : `ERP 已连接；${session.adsUnavailableReason || 'Ads 待识别，真实广告执行保持阻断。'}`);
      setCredentialTone(session.adsSessionReady ? 'ready' : 'warning');
      setConfiguredSessionResetRequired(false);
      if (session.credentialPersistence === 'saved'
        || session.credentialPersistence === 'main_managed') {
        setSavedCredentialUsername(username.trim());
        setSavedPasswordAvailable(true);
        setSavedCredentialState('encrypted_ready');
        setFreshTypedProofRequired(false);
      }
      setCredentialDraft((current) => current.storeId === String(store.activeStore?.storeId ?? '')
        ? {
            ...current,
            password: '',
            credentialSource: session.credentialPersistence === 'saved'
              || session.credentialPersistence === 'main_managed'
              ? 'saved'
              : current.credentialSource,
            dirty: false,
            hydrated: true,
          }
        : current);
    } catch (caught) {
      setConfiguredSessionResetRequired(configuredSessionResetRequiredFromError(caught));
      setError(toUserFacingError(caught, '登录失败'));
      await refreshSavedCredentialStatus({ force: true });
    } finally {
      setLoading(false);
    }
  }

  async function handleResetConfiguredLingxingSession() {
    if (loading) return;
    if (!configuredSavedSessionResetReady) {
      setError('当前店铺没有可用的本机安全区密码，无法安全重置会话；请重新输入密码后重试。');
      return;
    }
    setLoading(true);
    setLoginAction('reconnect-all');
    setError('');
    setConfiguredSessionResetRequired(false);
    try {
      const api = appElectronApi(username);
      await api.browserLogout();
      setLoginState(false);
      setLoginConnectionState('configured');
      setAmazonAdsConnectionState('missing');
      setCredentialNotice('当前店铺的旧领星会话已标记为重置；本机安全区密码仍保留，请点击“重新连接 ERP 与 Ads”。');
      setCredentialTone('ready');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setCredentialTone('blocked');
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
      setLoginConnectionState('configured');
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
      const mutationError = caught instanceof Error ? caught.message : String(caught);
      setError(mutationError.includes('Package UI setup mutations are allowed only before visible login starts')
        ? '正式验收登录开始后不允许修改连接映射。请保持当前绑定并完成 Ads 确认；如确需解绑，请关闭本次验收并重新启动应用。'
        : toUserFacingError(caught, provider === 'lingxing' ? '领星连接解绑失败' : 'Amazon Ads 连接解绑失败'));
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

  const visibleAdsUnavailableReason = connectionOperatorCopy(
    loginSession?.adsUnavailableReason,
    '系统尚未唯一确认当前店铺。请保持可见 Ads 窗口打开，核对店铺后重试；真实广告执行继续阻断。',
  );
  const visibleConnectionError = connectionOperatorCopy(
    error,
    '连接状态异常，请刷新当前店铺后重试；真实广告执行继续阻断。',
  );
  const visibleSyncWarning = connectionOperatorCopy(
    store.postCommitSyncWarning,
    '店铺状态刷新未完成，请刷新当前店铺后重试。',
  );

  const loginConnectionStatus = loginConnectionState === 'ready'
    ? '领星 ERP 当前会话已连接并验证。'
    : loginConnectionState === 'configured'
      ? '账号与店铺名称已配置，尚未建立当前会话。'
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
    ? 'Ads 已连接：当前会话与店铺身份已验证。'
    : amazonAdsConnectionState === 'configured'
      ? '广告账户已识别，尚未建立当前会话。'
      : amazonAdsConnectionState === 'opened'
        ? `Ads 页面已打开，当前店铺身份尚未确认：${visibleAdsUnavailableReason}`
      : amazonAdsConnectionState === 'binding'
        ? '正在确认领星广告账户…'
      : amazonAdsConnectionState === 'detected'
        ? 'Ads 待用户确认：已自动识别，等待你确认当前店铺绑定。'
      : amazonAdsConnectionState === 'unbinding'
        ? '正在解绑领星广告账户…'
      : amazonAdsConnectionState === 'error'
        ? `Ads 连接失败：${visibleAdsUnavailableReason}`
        : amazonAdsConnection
          ? '当前广告账户连接尚未完成可信身份确认。'
          : erpSessionConnected
            ? 'Ads 待识别：ERP 可继续只读采集；真实广告执行保持阻断。'
            : '当前店铺尚未识别领星广告账户。';
  const lingxingReadinessDetail = lingxingConnectionReady
    ? erpSessionConnected
      ? '已连接：当前 ERP 会话可用。'
      : lingxingConnection?.externalAccountId
      ? '已配置：账号与店铺名称一致，点击下方按钮建立当前会话。'
      : !enrollmentTypedProofReady
        ? '待登记：请手动输入本次密码，旧会话不会直接作为稳定身份。'
      : !enrollmentResetConsentReady
        ? '可启动检查：尚未授权重置；若检测到无法核验的旧会话，系统会说明原因并保持首次绑定阻断。'
      : enrollmentTypedProofReady
        ? '待登记：已输入本次密码；稳定身份将在首次新鲜登录时由本机安全进程识别。'
        : '待登记：请手动输入本次密码，旧会话不会直接作为稳定身份。'
    : !username.trim()
      ? '未就绪：请先在步骤 1 输入领星用户名。'
      : !lingxingCollectionStoreName.trim()
        ? '未就绪：请填写与领星下载中心显示完全一致的店铺名称。'
      : `未就绪：${loginConnectionStatus}`;
  const amazonAdsReadinessDetail = adsIdentityCandidate && !amazonAdsConnectionReady
    ? `待确认：已自动识别账户${adsIdentityCandidate.detectedAccountLabel ? ` ${adsIdentityCandidate.detectedAccountLabel}` : ''}。请点击下方“确认当前店铺并完成连接”；确认前真实写入保持阻断。`
    : adsPageVisible && !adsSessionConnected
    ? `待识别：Ads 页面已打开，但当前店铺身份尚未唯一确认。请在可见 Ads 窗口核对 ${lingxingCollectionStoreName || '当前店铺'} 后点击“重试 Ads”；真实写入保持阻断。`
    : amazonAdsConnectionReady
    ? adsSessionConnected
      ? '已连接：当前 Ads 会话已验证。'
      : '已识别：点击下方按钮重新建立 Ads 会话。'
    : '待识别：启动可见连接后，本机安全进程将从 ERP 的“广告”入口进入 Ads，并读取、锁定当前美国站店铺。';
  const overallConnectionState = loading
    ? 'connecting'
    : erpSessionConnected && adsSessionConnected
      ? 'connected'
      : erpSessionConnected
        ? 'partial'
        : error
          ? 'error'
          : 'disconnected';
  const overallConnectionLabel = overallConnectionState === 'connected'
    ? 'ERP 与 Ads 已连接'
    : overallConnectionState === 'partial'
      ? adsIdentityCandidate
        ? 'ERP 已连接，Ads 待确认'
        : adsPageVisible
          ? 'ERP 已连接，Ads 已打开待识别'
          : 'ERP 已连接，Ads 尚未连接'
      : overallConnectionState === 'connecting'
        ? '正在连接当前店铺'
        : overallConnectionState === 'error'
          ? '当前店铺连接失败'
          : '当前店铺尚未连接';
  const currentConnectionStep = adsSessionConnected
    ? 'Ads 已连接'
    : adsIdentityCandidate
      ? 'Ads 待用户确认'
      : adsPageVisible
        ? 'Ads 待识别'
      : loginSession?.adsUnavailableReason
        ? 'Ads 连接失败'
        : erpSessionConnected
          ? 'Ads 待识别'
          : 'ERP 待连接';
  const erpSuccessTime = formatConnectionSuccessTime(lingxingConnection?.lastVerifiedAt);
  const adsSuccessTime = formatConnectionSuccessTime(amazonAdsConnection?.lastVerifiedAt);

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
              {store.activeStore?.displayName || '店铺待确认'}
            </span>
          </div>
          <span style={loginStyles.marketPill}>美国站 · USD</span>
        </section>

        <section
          aria-live="polite"
          className="store-connection-overall-status"
          data-state={overallConnectionState}
          role="status"
        >
          <strong>{overallConnectionLabel}</strong>
          <span>
            {overallConnectionState === 'connected'
              ? '当前店铺可以继续采集，并在获得授权后进入真实广告执行。'
              : overallConnectionState === 'partial'
                ? adsIdentityCandidate
                  ? `已识别 ${adsConfirmationStoreLabel}，请使用下方唯一确认动作完成连接。`
                  : '请保持可见浏览器打开，完成 Ads 自动识别与当前店铺确认。'
                : overallConnectionState === 'connecting'
                  ? '请不要关闭主窗口或可见浏览器，完成后这里会自动更新。'
                  : '填写配置不等于已连接；请使用下方按钮建立真实会话。'}
          </span>
          <span>当前步骤：{currentConnectionStep}</span>
          {erpSessionConnected && <span>ERP 成功时间：{erpSuccessTime}</span>}
          {adsSessionConnected && <span>Ads 成功时间：{adsSuccessTime}</span>}
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
                      ? '本次正式证据首轮必须重新输入密码并勾选“记住密码”；密码仅由本机安全进程写入本机安全区。'
                      : '需要刷新登录身份时，请重新输入密码并勾选“记住密码”；密码仅由本机安全进程写入本机安全区。'}
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
              {lingxingSessionResetAvailable && (
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
                      只清理当前店铺的独立浏览器登录会话并重新进入可见登录页；不会删除报表或其他店铺数据。
                    </span>
                  </span>
                </label>
              )}
              {lingxingConnectionReady && credentialSource === 'saved' && (
                <div role="status" style={loginStyles.hint}>
                  使用本机安全区托管的密码重新连接时，若检测到旧会话，只会重置当前店铺会话并重新验证；无需再次输入密码。
                </div>
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
                    只需配置领星账号与下载中心店铺名称；广告账户由本机安全进程从可见 Ads 页面自动识别。
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
                    <span>连接验证</span>
                    <output aria-label="领星稳定身份只读状态">
                      {lingxingConnection?.externalAccountId
                        ? '账号已识别并受保护'
                        : '待首次可见登录验证'}
                    </output>
                  </div>
                  <p
                    data-login-connection-status
                    data-login-attempt-active={loading}
                    data-login-attempt-sequence={loginAttemptSequence}
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
                      disabled={loading || unbindBusy || (packageUiEvidenceMode && erpSessionConnected)}
                      onClick={() => setConfirmUnbindConnection({ ...lingxingConnection })}
                      title={packageUiEvidenceMode && erpSessionConnected
                        ? '本轮正式验收登录已开始，连接映射已冻结；无需解绑，请继续重试或确认 Ads。'
                        : undefined}
                      type="button"
                    >
                      解绑领星映射
                    </button>
                  )}
                </div>
                <div style={loginStyles.connectionPanel}>
                  <p style={loginStyles.connectionName}>领星广告账户 · US / USD</p>
                  <div className="login-stable-identity" role="status" aria-live="polite">
                    <span>广告账户（自动识别，只读）</span>
                    <output aria-label="领星广告账户自动识别状态">
                      {amazonAdsConnectionReady
                        ? `已识别${amazonAdsConnection?.accountLabel ? `：${amazonAdsConnection.accountLabel}` : ''}`
                        : adsIdentityCandidate
                          ? `待确认${adsIdentityCandidate.detectedAccountLabel ? `：${adsIdentityCandidate.detectedAccountLabel}` : ''}`
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
                  {amazonAdsConnection && (
                    <button
                      className="login-connection-unbind"
                      disabled={loading || unbindBusy || (packageUiEvidenceMode && erpSessionConnected)}
                      onClick={() => setConfirmUnbindConnection({ ...amazonAdsConnection })}
                      title={packageUiEvidenceMode && erpSessionConnected
                        ? '本轮正式验收登录已开始，连接映射已冻结；无需解绑，请继续重试或确认 Ads。'
                        : undefined}
                      type="button"
                    >
                      解绑领星广告账户
                    </button>
                  )}
                </div>
              </div>
              <div style={loginStyles.hint}>
                领星下载中心店铺名称必须与下载中心当前可见名称完全一致；广告账户编号不要求人工查找或填写。解绑映射不会清除本机保存的密码。
                {packageUiEvidenceMode && erpSessionConnected
                  ? ' 本轮正式验收登录已开始，连接映射已冻结；无需解绑，请继续重试或确认 Ads。'
                  : ''}
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
                {loginWorkbenchReady
                  ? loginResetAuthorizationReady
                    ? '登录条件已就绪，可以开始授权'
                    : '可以先检查当前会话；未授权时不会重置登录数据'
                  : '暂不能登录，请先处理以下项目'}
              </p>
              <ul style={loginStyles.readinessList}>
                <li style={loginStyles.readinessItem}>领星：{lingxingReadinessDetail}</li>
                <li style={loginStyles.readinessItem}>Amazon Ads：{amazonAdsReadinessDetail}</li>
                {lingxingEnrollmentPending && (
                  <li style={loginStyles.readinessItem}>
                    首次身份登记：{resetLingxingSessionForEnrollment
                      ? '若发现旧登录，会仅重置当前店铺的领星会话后重新登录。'
                      : '未授权重置；仍可启动非破坏性检查。若发现旧登录，会提示：请先勾选“允许重置当前店铺领星会话”，并保持首次绑定阻断。'}
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
              <li>点击登录后，保持应用主窗口打开；可以最小化，但不要关闭。</li>
              <li>在项目自带的独立浏览器中完成领星 ERP 登录；系统会从 ERP 的“广告”入口进入 Ads 并锁定已配置的美国站店铺，无需查找内部编号。</li>
              <li>识别到账户后回到这里点击“确认绑定到当前店铺”；确认前真实广告写入保持阻断。</li>
              <li>
                {packageUiEvidenceMode
                  ? '验收证据采集器不会读取、填写或点击你的账号密码；本机安全进程只在本机解密并提交你明确选择使用的领星凭证。'
                  : '本机安全进程只在本机解密并提交你明确选择使用的领星凭证；验证码、MFA 与 Amazon Ads 授权由你在可见窗口完成。'}
              </li>
            </ol>
            <details className="login-technical-diagnostics">
              <summary>诊断详情</summary>
              <p>广告账户由 Main 从可见 Ads 页面自动识别</p>
              <p>应用 Main 进程只在本机解密并提交你明确选择使用的领星凭证</p>
              <p>Main 将从 ERP 的“广告”入口进入 Ads</p>
              <p>保持 Electron 主窗口打开 · 独立 Playwright Chromium</p>
              <p>Package UI 证据采集器不会读取、填写或点击你的账号密码</p>
              <p>领星连接已绑定</p>
              <p>无需你查找 Profile ID 或手动打开广告活动</p>
              <p>待首次新鲜登录识别</p>
              <p>不会删除 Profile、报表或其他店铺数据</p>
            </details>

            {store.postCommitSyncWarning && (
              <div className="store-post-commit-sync-warning" role="status">
                {visibleSyncWarning}
              </div>
            )}
            {error && <div role="alert" style={loginStyles.error}>{visibleConnectionError}</div>}
            {configuredSessionResetRequired && (
              <button
                data-login-action="reset-lingxing-session"
                disabled={loading || !configuredSavedSessionResetReady}
                onClick={() => void handleResetConfiguredLingxingSession()}
                style={loginStyles.button}
                type="button"
              >
                重置当前店铺会话（保留本机密码）
              </button>
            )}
            {adsConfirmationPending && (
              <button
                aria-busy={amazonAdsConnectionState === 'binding' || undefined}
                aria-label={`确认绑定到当前店铺：${adsConfirmationStoreLabel}`}
                className={amazonAdsConnectionState === 'binding' ? 'button-loading' : undefined}
                data-login-action="confirm-ads-identity"
                data-package-ui-evidence-action="confirm-amazon-ads-identity"
                disabled={loading || amazonAdsConnectionState === 'binding' || amazonAdsConnectionState === 'unbinding'}
                onClick={() => void handleConfirmAmazonAdsConnection()}
                style={loginStyles.button}
                type="button"
              >
                <span className="button-content">
                  {amazonAdsConnectionState === 'binding' && <span className="button-spinner" aria-hidden="true" />}
                  <span>{amazonAdsConnectionState === 'binding'
                    ? '正在确认 Ads…'
                    : `确认 ${adsConfirmationStoreLabel} 并完成连接`}</span>
                </span>
              </button>
            )}
            {!adsConfirmationPending && (
              <button
                aria-busy={loginButtonView.ariaBusy}
                className={loginButtonView.className}
                data-login-action="reconnect-all"
                disabled={loading || !loginWorkbenchReady}
                onClick={() => void handleLogin(erpSessionConnected ? 'reconnect-all' : 'initial')}
                style={loginStyles.button}
                type="button"
              >
                <span className="button-content">
                  {loginButtonView.loading && <span className="button-spinner" aria-hidden="true" />}
                  <span>{loginButtonView.loading
                    ? loginAction === 'retry-ads' ? '正在重试 Ads…' : '正在重新连接…'
                    : erpSessionConnected ? '重新连接 ERP 与 Ads' : loginButtonView.label}</span>
                </span>
              </button>
            )}
            {erpSessionConnected && !adsSessionConnected && !adsIdentityCandidate && (
              <button
                aria-busy={loading && loginAction === 'retry-ads' || undefined}
                className="login-retry-ads-button"
                data-login-action="retry-ads"
                disabled={loading || !retryAdsReady}
                onClick={() => void handleLogin('retry-ads')}
                type="button"
              >
                {loading && loginAction === 'retry-ads' ? '正在重试 Ads…' : '重试 Ads'}
              </button>
            )}
            {erpSessionConnected && !adsSessionConnected && !adsIdentityCandidate && !retryAdsReady && (
              <div className="login-retry-ads-reason" role="status" style={loginStyles.notice}>
                {adsRetryRequiresFullReconnect
                  ? 'Ads 可见窗口已关闭或身份已变化，请重新连接 ERP 与 Ads；真实广告执行继续阻断。'
                  : savedPasswordAvailable
                  ? 'Ads 只能在当前店铺、当前 ERP 会话未变化时单独重试；身份已变化请重新连接 ERP 与 Ads。'
                  : '单独重试 Ads 需要本次已保存到本机安全区的密码；请重新输入密码并连接 ERP 与 Ads。'}
              </div>
            )}
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
                  <span>解绑当前店铺连接</span>
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
                      <div><dt>连接验证</dt><dd>{confirmUnbindConnection.externalAccountId ? '已识别并受保护' : '尚未验证'}</dd></div>
                    </>
                  ) : (
                    <div><dt>连接验证</dt><dd>{confirmUnbindConnection.externalAccountId ? '已识别并受保护' : '尚未验证'}</dd></div>
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

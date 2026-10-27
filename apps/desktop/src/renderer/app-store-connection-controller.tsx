import {
normalizeLingxingCollectionStoreName,
type StoreConnection
} from '@amazon-ai-ops/shared-types';
import React,{ useCallback,useEffect,useLayoutEffect,useRef,useState } from 'react';
import type {
BrowserLoginResult,
StoreScopedSavedLoginCredentialStatus
} from '../shared/login-contract';
import { appElectronApi,browserPreviewBootstrap } from './app-bootstrap';
import { createConnectionOperationGuard, type ConnectionOperationKind, type ConnectionOperationTicket } from './app-connection-operation';
import {
buildBrowserLoginRequest,
configuredSessionResetActionVisible,
configuredSessionResetRequiredFromError,
connectionAttemptOperatorCopy,
connectionOperatorCopy,
currentConnectionSessionState,
formatConnectionSuccessTime,
loginSecurityTagView,
loginStatusMessage,
loginSubmitButtonView,
resolveAdsRetryCredentialAvailability,
savedLoginCredentialNotice,
savedLoginCredentialTone,
selectFreshBrowserLoginStoreContext,
type LoginCredentialTone,
type SavedLoginCredentialState,
type StoreConnectionCredentialDraft,
type StoreConnectionLoginAction,
} from './app-connection-presentations';
import { useStore } from './app-login-state';
import { useOverlayFocusScope } from './components/workspace/overlay-focus-scope';
import {
useMissionControlStoreContext
} from './mission-control/store-context';
import { rendererRuntimeLog } from './runtime-log';
import { toUserFacingError } from './user-facing-error';

export type StoreConnectionWorkbenchProps = {
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
};

export function useStoreConnectionWorkbench({
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
}: StoreConnectionWorkbenchProps) {

  const store = useMissionControlStoreContext();
  const operationGuard = useRef(createConnectionOperationGuard()).current;
  operationGuard.update(store);
  const renderIsCurrent = operationGuard.capture();
  const [activeOperation, setActiveOperation] = useState<{ kind: ConnectionOperationKind; ticket: ConnectionOperationTicket } | null>(null);
  const connectionActiveAction = activeOperation?.ticket.isCurrent() ? activeOperation.kind : null;
  const connectionOperationBusy = Boolean(connectionActiveAction);
  function beginOperation(kind: ConnectionOperationKind) {
    if (!renderIsCurrent()) return null;
    const ticket = operationGuard.begin();
    if (ticket) setActiveOperation({ kind, ticket });
    return ticket;
  }
  function finishOperation(ticket: ConnectionOperationTicket) {
    if (ticket.isCurrent()) setActiveOperation(current => current?.ticket === ticket ? null : current);
    ticket.finish();
  }
  function canEditConnectionDraft() {
    return renderIsCurrent() && store.phase === 'ready' && Boolean(store.authoritativeContext)
      && !operationGuard.isBusy() && !loginAttemptPending;
  }
  function dismissUnbindDialog() {
    if (renderIsCurrent() && !operationGuard.isBusy()) setConfirmUnbindConnection(null);
  }
  useLayoutEffect(() => () => operationGuard.invalidate(), [operationGuard]);
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
  useLayoutEffect(() => {
    // 权威换代已使旧请求失效，外层反馈也必须退休，不能留下永久禁用。
    setLoginAttemptPending(false);
    setConfirmUnbindConnection(null);
  }, [store.authorityKey, store.contextEpoch, store.phase, setLoginAttemptPending]);
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
  const { adsSessionConnected, erpSessionConnected } = currentConnectionSessionState(loginSession);
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
  const showConfiguredSessionReset = configuredSessionResetActionVisible(
    error,
    configuredSessionResetRequired,
  );
  const securityTagView = loginSecurityTagView({
    credentialSource,
    credentialState: savedCredentialState,
    loading,
    passwordAvailable: effectiveSavedPasswordAvailable,
  });
  const unbindBusy = loginConnectionState === 'unbinding' || amazonAdsConnectionState === 'unbinding';
  const unbindDialogFocus = useOverlayFocusScope<HTMLDivElement, HTMLElement>({
    dismissDisabled: unbindBusy,
    onDismiss: dismissUnbindDialog,
    open: confirmUnbindConnection !== null,
  });

  const refreshSavedCredentialStatus = useCallback(async (
    options: Readonly<{
      force?: boolean;
      shouldAbort?: () => boolean;
    }> = {},
  ): Promise<boolean> => {
    const isCurrent = operationGuard.capture();
    const force = options.force === true;
    const statusRequestSequence = ++credentialStatusRequestSequence.current;
    const requestedStoreId = store.activeStore?.storeId ?? null;
    const requestedStoreKey = String(requestedStoreId ?? '');
    const connectionUsername = lingxingConnection?.accountLabel?.trim() ?? '';
    const api = appElectronApi(connectionUsername);
    if (!api?.getSavedLoginCredentialStatus) return false;
    try {
      const saved = await api.getSavedLoginCredentialStatus() as StoreScopedSavedLoginCredentialStatus;
      if (!isCurrent() || options.shouldAbort?.()
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
    } catch (caught) {
      rendererRuntimeLog.error('renderer.saved_credential_status_failed', { error: caught });
      if (isCurrent() && !force
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
    store.contextEpoch,
    store.phase,
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
    store.contextEpoch,
    store.phase,
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
    if (loading || connectionOperationBusy) return;
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
    const ticket = beginOperation(action);
    if (!ticket) return;
    const isCurrent = ticket.isCurrent;
    setLoginAttemptSequence((current) => current + 1);
    setLoading(true);
    setLoginAction(action);
    setError('');
    setConfiguredSessionResetRequired(false);
    try {
      const api = appElectronApi(username);
      if (!api?.browserLogin && browserPreviewBootstrap.enabled) {
        const previewState = await api.getState();
        if (!isCurrent()) return;
        setCredentialNotice('已进入浏览器预览模式；这里不连接真实 ERP/Ads，也不会写入本地数据库。');
        setLoginState(true, previewState.currentStore, previewState.loginSession || null);
        return;
      }
      const activeView = await api.getActiveStoreWorkspaceView();
      if (!isCurrent()) return;
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
      if (!isCurrent()) return;
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
      rendererRuntimeLog.error('renderer.store_connection_login_failed', { error: caught });
      if (!isCurrent()) return;
      setConfiguredSessionResetRequired(configuredSessionResetRequiredFromError(caught));
      setError(toUserFacingError(caught, '登录失败'));
      await refreshSavedCredentialStatus({ force: true });
    } finally {
      if (isCurrent()) setLoading(false);
      finishOperation(ticket);
    }
  }

  async function handleResetConfiguredLingxingSession() {
    if (loading) return;
    if (!configuredSavedSessionResetReady) {
      setError('当前店铺没有可用的本机安全区密码，无法安全重置会话；请重新输入密码后重试。');
      return;
    }
    const ticket = beginOperation('reset');
    if (!ticket) return;
    const isCurrent = ticket.isCurrent;
    setLoading(true);
    setLoginAction('reconnect-all');
    setError('');
    setConfiguredSessionResetRequired(false);
    try {
      const api = appElectronApi(username);
      await api.browserLogout();
      if (!isCurrent()) return;
      setLoginState(false);
      setLoginConnectionState('configured');
      setAmazonAdsConnectionState('missing');
      setCredentialNotice('当前店铺的旧领星会话已标记为重置；本机安全区密码仍保留，请点击“重新连接 ERP 与 Ads”。');
      setCredentialTone('ready');
    } catch (caught) {
      rendererRuntimeLog.error('renderer.store_connection_reset_failed', { error: caught });
      if (!isCurrent()) return;
      setError(caught instanceof Error ? caught.message : String(caught));
      setCredentialTone('blocked');
    } finally {
      if (isCurrent()) setLoading(false);
      finishOperation(ticket);
    }
  }

  async function handleBindLingxingConnection() {
    if (loading || loginConnectionState === 'binding' || lingxingConnectionReady) return;
    if (!username.trim() || !lingxingCollectionStoreName.trim()) {
      setError('请同时输入领星用户名和领星下载中心店铺名称后再绑定。');
      return;
    }
    const ticket = beginOperation('bind-lingxing');
    if (!ticket) return;
    const isCurrent = ticket.isCurrent;
    setLoginConnectionState('binding');
    setError('');
    try {
      await store.bindLingxingConnection(username.trim(), lingxingCollectionStoreName.trim());
      if (!isCurrent()) return;
      setLoginConnectionState('configured');
    } catch (caught) {
      rendererRuntimeLog.error('renderer.lingxing_connection_bind_failed', { error: caught });
      if (!isCurrent()) return;
      setLoginConnectionState('error');
      setError(toUserFacingError(caught, '领星连接绑定失败'));
    } finally {
      finishOperation(ticket);
    }
  }

  async function handleUnbindConnection(connection: StoreConnection) {
    if (loading || unbindBusy) return;
    const provider = connection.provider;
    const ticket = beginOperation(provider === 'lingxing' ? 'unbind-lingxing' : 'unbind-amazon_ads');
    if (!ticket) return;
    const isCurrent = ticket.isCurrent;
    if (provider === 'lingxing') setLoginConnectionState('unbinding');
    else setAmazonAdsConnectionState('unbinding');
    setError('');
    try {
      await store.unbindStoreConnection(connection);
      if (!isCurrent()) return;
      if (provider === 'lingxing') setLoginConnectionState('missing');
      else setAmazonAdsConnectionState('missing');
      setConfirmUnbindConnection(null);
      setCredentialNotice('连接映射已解绑；本机保存的领星密码没有被清除。');
      setCredentialTone('warning');
    } catch (caught) {
      rendererRuntimeLog.error('renderer.store_connection_unbind_failed', { error: caught });
      if (!isCurrent()) return;
      if (provider === 'lingxing') setLoginConnectionState('error');
      else setAmazonAdsConnectionState('error');
      const mutationError = caught instanceof Error ? caught.message : String(caught);
      setError(mutationError.includes('Package UI setup mutations are allowed only before visible login starts')
        ? '正式验收登录开始后不允许修改连接映射。请保持当前绑定并完成 Ads 确认；如确需解绑，请关闭本次验收并重新启动应用。'
        : toUserFacingError(caught, provider === 'lingxing' ? '领星连接解绑失败' : 'Amazon Ads 连接解绑失败'));
    } finally {
      finishOperation(ticket);
    }
  }

  async function handleConfirmAmazonAdsConnection() {
    if (loading || amazonAdsConnectionReady || !adsIdentityCandidate || !store.authoritativeContext) return;
    const ticket = beginOperation('confirm-ads');
    if (!ticket) return;
    const isCurrent = ticket.isCurrent;
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
      if (!isCurrent()) return;
      setLoginState(true, session.currentStore, session);
      setAmazonAdsConnectionState('ready');
    } catch (caught) {
      rendererRuntimeLog.error('renderer.ads_identity_confirmation_failed', { error: caught });
      if (!isCurrent()) return;
      setAmazonAdsConnectionState('error');
      setError(toUserFacingError(caught, '领星广告账户确认失败'));
    } finally {
      finishOperation(ticket);
    }
  }

  const visibleAdsUnavailableReason = connectionOperatorCopy(
    loginSession?.adsUnavailableReason,
    '系统尚未唯一确认当前店铺。请保持可见 Ads 窗口打开，核对店铺后重试；真实广告执行继续阻断。',
  );
  const visibleConnectionError = connectionOperatorCopy(
    error,
    connectionAttemptOperatorCopy('', {
      adsSessionConnected,
      erpSessionConnected,
    }),
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

  
  return {
    store,
    connectionActiveAction,
    connectionOperationBusy,
    canEditConnectionDraft,
    dismissUnbindDialog,
    overallConnectionState,
    overallConnectionLabel,
    adsIdentityCandidate,
    adsConfirmationStoreLabel,
    currentConnectionStep,
    erpSessionConnected,
    erpSuccessTime,
    adsSessionConnected,
    adsSuccessTime,
    freshTypedProofRequired,
    savedPasswordAvailable,
    lingxingEnrollmentPending,
    rememberPassword,
    password,
    savedCredentialUsername,
    setCredentialDraft,
    setCredentialNotice,
    setCredentialTone,
    loading,
    loginConnectionsReady,
    handleLogin,
    username,
    credentialSource,
    savedCredentialState,
    securityTagView,
    lingxingSessionResetAvailable,
    resetLingxingSessionForEnrollment,
    lingxingConnectionReady,
    loginStatusClass,
    loginStatus,
    setLingxingCollectionStoreName,
    loginConnectionState,
    lingxingCollectionStoreName,
    handleBindLingxingConnection,
    lingxingConnection,
    loginAttemptSequence,
    loginConnectionStatus,
    unbindBusy,
    packageUiEvidenceMode,
    setConfirmUnbindConnection,
    amazonAdsConnectionReady,
    amazonAdsConnection,
    amazonAdsConnectionState,
    amazonAdsConnectionStatus,
    loginWorkbenchReady,
    loginResetAuthorizationReady,
    lingxingReadinessDetail,
    amazonAdsReadinessDetail,
    freshTypedProofStorageReady,
    freshTypedProofReady,
    visibleSyncWarning,
    error,
    visibleConnectionError,
    showConfiguredSessionReset,
    configuredSavedSessionResetReady,
    handleResetConfiguredLingxingSession,
    adsConfirmationPending,
    handleConfirmAmazonAdsConnection,
    loginButtonView,
    loginAction,
    retryAdsReady,
    adsRetryRequiresFullReconnect,
    confirmUnbindConnection,
    unbindDialogFocus,
    handleUnbindConnection,
  };
}


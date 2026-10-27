import { loginSubmitButtonView, savedLoginCredentialNotice } from './app-connection-presentations';
import { loginStyles } from './app-login-styles';
import type { useStoreConnectionWorkbench } from './app-store-connection-controller';

export function StoreConnectionWorkbenchView({
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
  loading: loginAttemptLoading,
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
  loginAction,
  retryAdsReady,
  adsRetryRequiresFullReconnect,
  confirmUnbindConnection,
  unbindDialogFocus,
  handleUnbindConnection,
}: ReturnType<typeof useStoreConnectionWorkbench>) {
  const authorityReason = store.phase !== 'ready' || !store.authoritativeContext
    ? '当前店铺身份尚未就绪，请先在顶部确认店铺并等待状态恢复。' : '';
  const actionReasons = {
    initial: '正在建立当前店铺连接，请在可见浏览器完成登录，暂不能修改凭证或其他连接。',
    'reconnect-all': '正在重新连接 ERP 与 Ads，请保持可见浏览器打开，完成后再修改配置。',
    'retry-ads': '正在重试 Ads，ERP 会话保持不变，请在可见窗口完成确认后再操作。',
    reset: '正在重置当前店铺会话，请稍候；本机保存的密码会保留。',
    'bind-lingxing': '正在绑定领星账号与下载中心店铺名称，请稍候再修改配置。',
    'confirm-ads': '正在确认当前店铺的 Ads 身份，请稍候，确认前真实广告写入继续阻断。',
    'unbind-lingxing': '正在解绑领星映射，请稍候；本机保存的密码会保留。',
    'unbind-amazon_ads': '正在解绑领星广告账户，请稍候；本机保存的密码会保留。',
  };
  const busyReason = connectionActiveAction ? actionReasons[connectionActiveAction]
    : loginAttemptLoading ? actionReasons[loginAction] : '';
  const controlsReason = authorityReason || busyReason;
  const loading = loginAttemptLoading || connectionOperationBusy || Boolean(authorityReason);
  const mainLoginBusy = connectionActiveAction === 'initial' || connectionActiveAction === 'reconnect-all'
    || (!connectionActiveAction && loginAttemptLoading && loginAction !== 'retry-ads');
  const loginButtonView = loginSubmitButtonView(mainLoginBusy);
  const retryAdsBusy = connectionActiveAction === 'retry-ads'
    || (!connectionActiveAction && loginAttemptLoading && loginAction === 'retry-ads');
  const rememberReason = controlsReason || (savedCredentialState === 'encryption_unavailable'
    ? '本机加密当前不可用，暂不能记住密码；本次可输入密码登录，恢复本机加密后再保存。' : '');
  const bindReason = controlsReason || (!username.trim() ? '请先输入领星用户名，再绑定当前店铺。'
    : !lingxingCollectionStoreName.trim() ? '请填写与领星下载中心完全一致的店铺名称后再绑定。' : '');
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

        {controlsReason && <p id="store-connection-operation-reason" role="status" style={loginStyles.hint}>{controlsReason}</p>}

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
                    disabled={loading}
                    aria-describedby={controlsReason ? 'store-connection-operation-reason' : undefined}
                    onChange={(event) => {
                      if (!canEditConnectionDraft()) return;
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
                    disabled={loading}
                    aria-describedby={controlsReason ? 'store-connection-operation-reason' : undefined}
                    data-credential-source={credentialSource}
                    onChange={(event) => {
                      if (!canEditConnectionDraft()) return;
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
                    disabled={loading || savedCredentialState === 'encryption_unavailable'}
                    aria-describedby={rememberReason ? 'store-connection-remember-reason' : undefined}
                    onChange={(event) => {
                      if (!canEditConnectionDraft()) return;
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
              {rememberReason && <p id="store-connection-remember-reason" role="status" style={loginStyles.hint}>{rememberReason}</p>}
              {lingxingSessionResetAvailable && (
                <label style={loginStyles.enrollmentResetRow}>
                  <input
                    aria-label="允许重置当前店铺领星会话"
                    checked={resetLingxingSessionForEnrollment}
                    disabled={loading || credentialSource !== 'typed'}
                    onChange={(event) => {
                      if (!canEditConnectionDraft()) return;
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
                      disabled={loading}
                      aria-describedby={controlsReason ? 'store-connection-operation-reason' : undefined}
                      onChange={(event) => { if (canEditConnectionDraft()) setLingxingCollectionStoreName(event.target.value); }}
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
                      aria-busy={connectionActiveAction === 'bind-lingxing' || undefined}
                      aria-describedby={bindReason ? 'store-connection-bind-reason' : undefined}
                      className={connectionActiveAction === 'bind-lingxing' ? 'button-loading' : undefined}
                      data-package-ui-evidence-action="bind-lingxing-connection"
                      type="button"
                      disabled={loading || loginConnectionState === 'binding' || !username.trim() || !lingxingCollectionStoreName.trim()}
                      onClick={handleBindLingxingConnection}
                      style={loginStyles.connectionButton}
                    >
                      {connectionActiveAction === 'bind-lingxing' && <span className="button-spinner" aria-hidden="true" />}
                      {connectionActiveAction === 'bind-lingxing'
                        ? '绑定中…'
                        : lingxingConnection
                          ? '更新领星账号与店铺绑定'
                          : '绑定领星账号与店铺'}
                    </button>
                  ) : null}
                  {!lingxingConnectionReady && bindReason && <p id="store-connection-bind-reason" role="status" style={loginStyles.hint}>{bindReason}</p>}
                  {lingxingConnection && (
                    <button
                      className="login-connection-unbind"
                      disabled={loading || unbindBusy || (packageUiEvidenceMode && erpSessionConnected)}
                      onClick={() => { if (canEditConnectionDraft()) setConfirmUnbindConnection({ ...lingxingConnection }); }}
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
                      onClick={() => { if (canEditConnectionDraft()) setConfirmUnbindConnection({ ...amazonAdsConnection }); }}
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
              id="store-connection-readiness"
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
            {(showConfiguredSessionReset || connectionActiveAction === 'reset') && (
              <button
                aria-busy={connectionActiveAction === 'reset' || undefined}
                className={connectionActiveAction === 'reset' ? 'button-loading' : undefined}
                data-login-action="reset-lingxing-session"
                disabled={loading || !configuredSavedSessionResetReady}
                onClick={() => void handleResetConfiguredLingxingSession()}
                style={loginStyles.button}
                type="button"
              >
                {connectionActiveAction === 'reset' && <span className="button-spinner" aria-hidden="true" />}
                {connectionActiveAction === 'reset' ? '正在重置当前店铺会话…' : '重置当前店铺会话（保留本机密码）'}
              </button>
            )}
            {showConfiguredSessionReset && !configuredSavedSessionResetReady && <p role="status" style={loginStyles.hint}>请确认当前店铺已绑定且本机保存的密码可用；也可重新输入密码后连接 ERP 与 Ads。</p>}
            {adsConfirmationPending && (
              <button
                aria-busy={connectionActiveAction === 'confirm-ads' || undefined}
                aria-label={`确认绑定到当前店铺：${adsConfirmationStoreLabel}`}
                className={connectionActiveAction === 'confirm-ads' ? 'button-loading' : undefined}
                data-login-action="confirm-ads-identity"
                data-package-ui-evidence-action="confirm-amazon-ads-identity"
                disabled={loading || amazonAdsConnectionState === 'binding' || amazonAdsConnectionState === 'unbinding'}
                onClick={() => void handleConfirmAmazonAdsConnection()}
                style={loginStyles.button}
                type="button"
              >
                <span className="button-content">
                  {connectionActiveAction === 'confirm-ads' && <span className="button-spinner" aria-hidden="true" />}
                  <span>{connectionActiveAction === 'confirm-ads'
                    ? '正在确认 Ads…'
                    : `确认 ${adsConfirmationStoreLabel} 并完成连接`}</span>
                </span>
              </button>
            )}
            {!adsConfirmationPending && (
              <button
                aria-busy={loginButtonView.ariaBusy}
                aria-describedby={controlsReason ? 'store-connection-operation-reason' : !loginWorkbenchReady ? 'store-connection-readiness' : undefined}
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
                    ? connectionActiveAction === 'initial' ? '正在启动当前店铺连接…' : '正在重新连接…'
                    : erpSessionConnected ? '重新连接 ERP 与 Ads' : loginButtonView.label}</span>
                </span>
              </button>
            )}
            {erpSessionConnected && !adsSessionConnected && !adsIdentityCandidate && (
              <button
                aria-busy={retryAdsBusy || undefined}
                className="login-retry-ads-button"
                data-login-action="retry-ads"
                disabled={loading || !retryAdsReady}
                onClick={() => void handleLogin('retry-ads')}
                type="button"
              >
                {retryAdsBusy ? '正在重试 Ads…' : '重试 Ads'}
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
            if (event.target === event.currentTarget && !unbindBusy) dismissUnbindDialog();
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
              {controlsReason && <p role="status">{controlsReason}</p>}
              <button disabled={unbindBusy} onClick={dismissUnbindDialog} type="button">取消</button>
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

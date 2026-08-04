import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeStoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import * as AppModule from './App';
import {
  buildBrowserLoginRequest,
  describeLoginSession,
  headerReadinessLabel,
  headerSessionStatusLabel,
  loginSecurityTagView,
  savedLoginCredentialNotice,
  savedLoginCredentialTone,
} from './App';

const LOGIN_STORE_CONTEXT = normalizeStoreContextEnvelope({
  browserProfileId: 'profile-test',
  businessDate: '2026-07-28',
  businessTimezone: 'America/Los_Angeles',
  currency: 'USD',
  marketplace: 'US',
  sessionGeneration: 1,
  storeId: 'store-test',
});

describe('headerReadinessLabel', () => {
  it('labels final readiness as application package readiness instead of current business delivery', () => {
    expect(headerReadinessLabel({
      appReady: true,
      manifestDriven: true,
    } as any)).toBe('应用包验收通过');
  });
});

describe('headerSessionStatusLabel', () => {
  it('keeps the top bar session text compact while the full detail can live in the tooltip', () => {
    expect(headerSessionStatusLabel({
      erpSessionReused: true,
      adsTitle: 'Amazon Ads Console - Sponsored Products Dashboard',
    })).toBe('ERP/Ads 已连接');
  });

  it('does not show long browser state text before login state is confirmed', () => {
    expect(headerSessionStatusLabel(null)).toBe('会话待确认');
  });

  it('shows Lingxing ready separately while Ads authorization remains blocked', () => {
    const session = {
      erpSessionReady: true,
      erpSessionReused: false,
      sessionIdentityVerified: true,
      adsSessionReady: false,
      adsUnavailableReason: '独立 Profile 待授权',
    };

    expect(headerSessionStatusLabel(session)).toBe('ERP 已连接 · Ads 待授权');
    expect(describeLoginSession(session)).toContain('ERP 已完成登录');
    expect(describeLoginSession(session)).toContain('Ads 未连接：独立 Profile 待授权');
  });

  it('visibly marks a reused ERP session whose typed identity and password were not verified', () => {
    const session = {
      erpSessionReused: true,
      sessionIdentityVerified: false,
      credentialPersistence: 'not_saved_unverified_session' as const,
      adsTitle: 'Amazon Ads Console',
    };

    expect(headerSessionStatusLabel(session)).toBe('ERP 会话复用 · 身份未核验');
    expect(describeLoginSession(session)).toContain('账号和本次密码均未核验');
    expect(describeLoginSession(session)).toContain('本机安全区未更改');
  });

  it('does not present a saved account as verified when another ERP session was reused', () => {
    const session = {
      erpSessionReused: true,
      sessionIdentityVerified: false,
      credentialPersistence: 'main_managed' as const,
      adsTitle: 'Amazon Ads Console',
    };

    expect(headerSessionStatusLabel(session)).toBe('ERP 会话复用 · 身份未核验');
    expect(describeLoginSession(session)).toContain('保存账号未与当前 ERP 会话核验');
    expect(describeLoginSession(session)).toContain('本机安全区未更改');
  });

  it('uses the Main-verified store result instead of promoting the submitted username in Renderer', () => {
    const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');

    expect(source).toContain('setLoginState(true, session.currentStore, session)');
    expect(source).not.toContain('setLoginState(true, request.username, session)');
    expect(source).toContain('activeStore={store.activeStore}');
    expect(source).toContain('{headerSessionStatusLabel(loginSession)}');
  });

  it('exposes unverified session detail as a focusable warning status instead of title-only copy', () => {
    const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
    const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

    expect(source).toContain('aria-label={describeLoginSession(loginSession)}');
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain('role="status"');
    expect(source).toContain("loginSession?.adsSessionReady === false ? ' session-line-warning' : ''");
    expect(source).toContain('loginSession?.adsSessionReady === false ? 0 : undefined}');
    expect(source).toContain("session-line-warning");
    expect(css).toContain('.session-line-warning');
    expect(css).toMatch(/\.session-line-warning:focus-visible\s*\{/);
  });
});

describe('login micro-response contract', () => {
  it('turns the login submit action into a real busy button state', () => {
    const loginSubmitButtonView = (AppModule as any).loginSubmitButtonView as
      | ((loading: boolean) => { ariaBusy?: boolean; className: string; label: string; loading: boolean })
      | undefined;

    expect(typeof loginSubmitButtonView).toBe('function');
    const busy = loginSubmitButtonView!(true);

    expect(busy.label).toBe('正在确认 ERP 和 Ads 会话...');
    expect(busy.loading).toBe(true);
    expect(busy.ariaBusy).toBe(true);
    expect(busy.className).toContain('login-submit-button');
    expect(busy.className).toContain('button-loading');
  });

  it('requires an explicit visible Lingxing binding before login without exposing the username in DOM data', () => {
    const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
    const loginPage = source.slice(source.indexOf('function LoginPage()'), source.indexOf('function MissionControlRuntime'));

    expect(loginPage).toContain('data-login-connection-status');
    expect(loginPage).toContain('data-state={loginConnectionState}');
    expect(loginPage).toContain('data-package-ui-evidence-action="bind-lingxing-connection"');
    expect(loginPage).toContain('领星下载中心店铺名称');
    expect(loginPage).toContain('必须与领星下载中心显示完全一致');
    expect(loginPage).toContain('data-package-ui-evidence-field="lingxing-shop-identity"');
    expect(loginPage).toContain('绑定领星账号与店铺');
    expect(loginPage).toContain('更新领星账号与店铺绑定');
    expect(loginPage).toContain('领星连接已绑定');
    expect(loginPage).toContain('disabled={loading || !loginWorkbenchReady}');
    expect(loginPage).toContain('lingxingConnection?.accountLabel?.trim() === username.trim()');
    expect(loginPage).toContain('lingxingConnection?.normalizedCollectionStoreName === normalizedLingxingCollectionStoreName');
    expect(loginPage).toContain('store.bindLingxingConnection(username.trim(), lingxingCollectionStoreName.trim())');
    expect(loginPage).toContain('setConfirmUnbindConnection({ ...lingxingConnection })');
    expect(loginPage).toContain('待首次新鲜登录识别');
    expect(loginPage).toContain('aria-label="领星稳定身份只读状态"');
    expect(loginPage).not.toMatch(/<input[\s\S]{0,180}value=\{lingxingConnection\?\.externalAccountId/);
    expect(loginPage).not.toMatch(/data-[\\w-]*(?:user|account)[\\w-]*=\\{?username/i);
  });

  it('requires a visible US Amazon Ads Profile binding and keeps login blocked until both connections match', () => {
    const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
    const loginPage = source.slice(source.indexOf('function LoginPage()'), source.indexOf('function MissionControlRuntime'));

    expect(loginPage).toContain("connection.provider === 'amazon_ads'");
    expect(loginPage).toContain('aria-label="Amazon Ads Profile ID"');
    expect(loginPage).toContain('data-package-ui-evidence-field="amazon-ads-profile-id"');
    expect(loginPage).toContain('maxLength={256}');
    expect(loginPage).toContain('void handleBindAmazonAdsConnection()');
    expect(loginPage).toContain('void handleLogin()');
    expect(loginPage).toContain('ads.lingxing.com');
    expect(loginPage).toContain('profile_id');
    expect(loginPage).toContain('美国站 · USD');
    expect(loginPage).toContain('data-login-amazon-ads-connection-status');
    expect(loginPage).toContain('data-state={amazonAdsConnectionState}');
    expect(loginPage).toContain('data-package-ui-evidence-action="bind-amazon-ads-connection"');
    expect(loginPage).toContain('绑定 Amazon Ads Profile');
    expect(loginPage).toContain('更新 Amazon Ads Profile 绑定');
    expect(loginPage).toContain('Amazon Ads Profile 已绑定');
    expect(loginPage).toContain('amazonAdsConnection?.normalizedExternalAccountId === normalizedAmazonAdsProfileId');
    expect(loginPage).toContain('store.bindAmazonAdsConnection(amazonAdsProfileId)');
    expect(loginPage).toContain('setConfirmUnbindConnection({ ...amazonAdsConnection })');
    expect(loginPage).toContain('const loginConnectionsReady = lingxingConnectionReady && amazonAdsConnectionReady');
    expect(loginPage).toContain('disabled={loading || !loginWorkbenchReady}');
    expect(loginPage).not.toMatch(/type="password"[\s\S]{0,200}value=\{amazonAdsProfileId\}/);
  });

  it('presents the formal login as a desktop three-step workbench with visible blockers', () => {
    const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
    const loginPage = source.slice(source.indexOf('function LoginPage()'), source.indexOf('function MissionControlRuntime'));

    expect(loginPage).toContain('aria-label="登录与双连接工作台"');
    expect(loginPage).toContain('data-login-workbench-store');
    expect(loginPage).toContain('当前店铺');
    expect(loginPage).toContain('美国站 · USD');
    expect(loginPage).toContain('data-login-workbench-step="credentials"');
    expect(loginPage).toContain('data-login-workbench-step="bindings"');
    expect(loginPage).toContain('data-login-workbench-step="authorize"');
    expect(loginPage).toContain('本次正式证据首轮必须重新输入密码并勾选“记住密码”');
    expect(loginPage).toContain('需要刷新登录身份时，请重新输入密码并勾选“记住密码”');
    expect(loginPage).toContain('同时确认领星登录账号、下载中心店铺名称与 Amazon Ads Profile ID');
    expect(loginPage).toContain('保持 Electron 主窗口打开');
    expect(loginPage).toContain('独立 Playwright Chromium');
    expect(loginPage).toContain('Package UI 证据采集器不会读取、填写或点击你的账号密码');
    expect(loginPage).toContain('应用 Main 进程只在本机解密并提交你明确选择使用的领星凭证');
    expect(loginPage).toContain("data-login-workbench-readiness={loginWorkbenchReady ? 'ready' : 'blocked'}");
    expect(loginPage).toContain('disabled={loading || !loginWorkbenchReady}');
    expect(loginPage).toContain("freshTypedProofStorageReady");
    expect(loginPage).toContain("credentialSource === 'typed'");
    expect(loginPage).toContain('&& Boolean(password)');
    expect(loginPage).toContain('&& rememberPassword');
    expect(loginPage).toContain('本机加密不可用，无法建立可核验的新凭证会话。');
    expect(loginPage).toContain('暂不能登录，请先处理以下项目');
    expect(loginPage).toContain('未就绪：请先在步骤 1 输入领星用户名。');
    expect(loginPage).toContain('未就绪：请填写 ads.lingxing.com 当前广告账户的 profile_id。');
    expect(loginPage).toContain('允许重置当前店铺领星会话');
    expect(loginPage).toContain('不会删除 Profile、报表或其他店铺数据');
    expect(loginPage).toContain("String(saved.storeId ?? '') !== String(requestedStoreId ?? '')");
    expect(loginPage).toContain('store.activeStore?.storeId');
  });

  it('does not erase a typed Ads profile id on an unrelated same-store authority revision', () => {
    const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
    const loginPage = source.slice(source.indexOf('function LoginPage()'), source.indexOf('function MissionControlRuntime'));
    const profileSyncStart = loginPage.indexOf(
      'setAmazonAdsProfileId(amazonAdsConnection?.externalAccountId?.trim()',
    );
    const profileSyncEffect = loginPage.slice(
      profileSyncStart,
      loginPage.indexOf('setAmazonAdsConnectionState', profileSyncStart),
    );

    expect(profileSyncEffect).toContain('store.activeStore?.storeId');
    expect(profileSyncEffect).toContain('amazonAdsConnection?.externalAccountId');
    expect(profileSyncEffect).not.toContain('store.authorityKey');
  });

  it('keeps credential and loading feedback in one stable live region', () => {
    const loginStatusMessage = (AppModule as any).loginStatusMessage as
      | ((input: {
          credentialSource?: 'saved' | 'typed';
          loading: boolean;
          credentialNotice?: string;
          rememberPassword: boolean;
        }) => string)
      | undefined;

    expect(typeof loginStatusMessage).toBe('function');
    expect(loginStatusMessage!({
      credentialSource: 'saved',
      loading: true,
      rememberPassword: true,
    })).toContain('已保存密码只在本机安全区解密');
    expect(loginStatusMessage!({
      loading: false,
      credentialNotice: '已加载账号，密码需重新输入。',
      rememberPassword: true,
    })).toBe('已加载账号，密码需重新输入。');
    expect(loginStatusMessage!({ loading: false, rememberPassword: false })).toContain('本次登录');
  });

  it('defines non-layout-shifting login feedback styles', () => {
    const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

    expect(css).toContain('.login-submit-button');
    expect(css).toContain('.login-status-line');
    expect(css).toMatch(/\.login-status-line\s*\{[^}]*min-height:/s);
    expect(css).toMatch(/\.login-submit-button\s*\{[^}]*display:\s*inline-flex/s);
  });

  it('keeps remembered passwords in Main while preserving one-click saved login', () => {
    const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');

    expect(source).toContain('getSavedLoginCredentialStatus');
    expect(source).toContain("credentialSource: 'saved'");
    expect(source).not.toMatch(/saved\.password\b/);
    expect(source).not.toContain('setPassword(saved');
    expect(savedLoginCredentialNotice({
      credentialState: 'encrypted_ready',
      passwordAvailable: true,
      rememberPassword: true,
    })).toContain('本机安全区托管');

    expect(buildBrowserLoginRequest({
      amazonAdsProfileId: '1234567890',
      credentialSource: 'saved',
      password: '',
      rememberPassword: true,
      savedCredentialUsername: 'operator@example.com',
      savedPasswordAvailable: true,
      storeContext: LOGIN_STORE_CONTEXT,
      lingxingCollectionStoreName: 'SHC001-US',
      username: 'operator@example.com',
    })).toEqual({
      amazonAdsProfileId: '1234567890',
      username: 'operator@example.com',
      credentialSource: 'saved',
      rememberPassword: true,
      storeContext: LOGIN_STORE_CONTEXT,
    });
  });

  it('requires typed password when the username or remember choice no longer matches saved state', () => {
    expect(buildBrowserLoginRequest({
      amazonAdsProfileId: '1234567890',
      credentialSource: 'typed',
      password: 'typed-for-this-login',
      rememberPassword: false,
      savedCredentialUsername: 'saved-user',
      savedPasswordAvailable: false,
      storeContext: LOGIN_STORE_CONTEXT,
      lingxingCollectionStoreName: '',
      username: 'changed-user',
    })).toBeNull();

    expect(buildBrowserLoginRequest({
      amazonAdsProfileId: '1234567890',
      credentialSource: 'saved',
      password: '',
      rememberPassword: true,
      savedCredentialUsername: 'saved-user',
      savedPasswordAvailable: true,
      storeContext: LOGIN_STORE_CONTEXT,
      lingxingCollectionStoreName: 'SHC001-US',
      username: 'changed-user',
    })).toBeNull();

    expect(buildBrowserLoginRequest({
      amazonAdsProfileId: '1234567890',
      credentialSource: 'typed',
      password: 'typed-for-this-login',
      rememberPassword: false,
      savedCredentialUsername: 'saved-user',
      savedPasswordAvailable: true,
      storeContext: LOGIN_STORE_CONTEXT,
      lingxingCollectionStoreName: 'SHC001-US',
      username: 'changed-user',
    })).toEqual({
      amazonAdsProfileId: '1234567890',
      username: 'changed-user',
      credentialSource: 'typed',
      password: 'typed-for-this-login',
      rememberPassword: false,
      storeContext: LOGIN_STORE_CONTEXT,
    });

    expect(buildBrowserLoginRequest({
      amazonAdsProfileId: '1234567890',
      credentialSource: 'typed',
      password: 'fresh-enrollment-password',
      resetLingxingSessionForEnrollment: true,
      rememberPassword: false,
      savedCredentialUsername: 'saved-user',
      savedPasswordAvailable: true,
      storeContext: LOGIN_STORE_CONTEXT,
      lingxingCollectionStoreName: 'SHC001-US',
      username: 'saved-user',
    })).toMatchObject({
      credentialSource: 'typed',
      resetLingxingSessionForEnrollment: true,
      storeContext: LOGIN_STORE_CONTEXT,
    });

    expect(buildBrowserLoginRequest({
      amazonAdsProfileId: '1234567890',
      credentialSource: 'saved',
      password: '',
      resetLingxingSessionForEnrollment: true,
      rememberPassword: true,
      savedCredentialUsername: 'saved-user',
      savedPasswordAvailable: true,
      storeContext: LOGIN_STORE_CONTEXT,
      lingxingCollectionStoreName: 'SHC001-US',
      username: 'saved-user',
    })).toBeNull();
  });

  it('uses warning and blocked feedback instead of green success for unavailable credentials', () => {
    expect(savedLoginCredentialTone({
      credentialState: 'encrypted_ready',
      passwordAvailable: true,
    })).toBe('ready');
    expect(savedLoginCredentialTone({
      credentialState: 'encryption_unavailable',
      passwordAvailable: false,
    })).toBe('warning');
    expect(savedLoginCredentialTone({
      credentialState: 'encrypted_corrupt',
      passwordAvailable: false,
    })).toBe('blocked');
    expect(loginSecurityTagView({
      credentialSource: 'typed',
      credentialState: 'encryption_unavailable',
      loading: false,
      passwordAvailable: false,
    })).toEqual({
      className: 'login-security-tag login-security-tag-warning',
      label: '本次不保存',
    });
    expect(savedLoginCredentialNotice({
      credentialState: 'encryption_unavailable',
      passwordAvailable: false,
      rememberPassword: false,
    })).toContain('本次仅登录、不保存密码');
  });

  it('locks Enter submission while login is already busy and disables persistence when encryption is unavailable', () => {
    const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');

    expect(source).toContain('if (loading) return;');
    expect(source.match(/event\.key === 'Enter' && !loading && loginConnectionsReady && handleLogin\(\)/g)).toHaveLength(2);
    expect(source).toContain("disabled={savedCredentialState === 'encryption_unavailable'}");
    expect(source).toContain('const remember = encryptionAvailable && (');
    expect(source).toContain('requiresFreshTypedProof ? true : Boolean(saved.rememberPassword)');
    expect(source).toContain('<span>记住密码</span>');
  });
});

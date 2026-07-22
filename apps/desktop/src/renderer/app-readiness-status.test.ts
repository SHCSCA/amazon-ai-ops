import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
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
    expect(source).toContain("loginSession?.sessionIdentityVerified === false ? '账号未核验'");
  });

  it('exposes unverified session detail as a focusable warning status instead of title-only copy', () => {
    const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
    const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

    expect(source).toContain('aria-label={describeLoginSession(loginSession)}');
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain('role="status"');
    expect(source).toContain('tabIndex={loginSession?.sessionIdentityVerified === false ? 0 : undefined}');
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
      credentialSource: 'saved',
      password: '',
      rememberPassword: true,
      savedCredentialUsername: 'operator@example.com',
      savedPasswordAvailable: true,
      username: 'operator@example.com',
    })).toEqual({
      username: 'operator@example.com',
      credentialSource: 'saved',
      rememberPassword: true,
    });
  });

  it('requires typed password when the username or remember choice no longer matches saved state', () => {
    expect(buildBrowserLoginRequest({
      credentialSource: 'saved',
      password: '',
      rememberPassword: true,
      savedCredentialUsername: 'saved-user',
      savedPasswordAvailable: true,
      username: 'changed-user',
    })).toBeNull();

    expect(buildBrowserLoginRequest({
      credentialSource: 'typed',
      password: 'typed-for-this-login',
      rememberPassword: false,
      savedCredentialUsername: 'saved-user',
      savedPasswordAvailable: true,
      username: 'changed-user',
    })).toEqual({
      username: 'changed-user',
      credentialSource: 'typed',
      password: 'typed-for-this-login',
      rememberPassword: false,
    });
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
    expect(source.match(/event\.key === 'Enter' && !loading && handleLogin\(\)/g)).toHaveLength(2);
    expect(source).toContain("disabled={savedCredentialState === 'encryption_unavailable'}");
    expect(source).toContain("const remember = encryptionAvailable && Boolean(saved.rememberPassword)");
    expect(source).toContain('<span>记住密码</span>');
  });
});

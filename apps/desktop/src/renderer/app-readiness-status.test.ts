import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as AppModule from './App';
import { headerReadinessLabel, headerSessionStatusLabel } from './App';

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
      | ((input: { loading: boolean; credentialNotice?: string; rememberPassword: boolean }) => string)
      | undefined;

    expect(typeof loginStatusMessage).toBe('function');
    expect(loginStatusMessage!({ loading: true, rememberPassword: true })).toContain('主进程安全区');
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
});

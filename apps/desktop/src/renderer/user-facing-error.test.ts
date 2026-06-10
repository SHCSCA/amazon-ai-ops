import { describe, expect, it } from 'vitest';
import { toUserFacingError } from './user-facing-error';

describe('toUserFacingError', () => {
  it('does not render raw Playwright launch output to the login page', () => {
    const message = toUserFacingError(new Error([
      'browserType.launchPersistentContext: failed',
      'Call log:',
      '<launching> chrome.exe --disable-background-networking --user-data-dir=C:\\Users\\wz\\AppData\\Roaming\\@amazon-ai-ops\\desktop\\storage\\browser-data',
      '--disable-blink-features=AutomationControlled',
    ].join('\n')), '登录失败');

    expect(message).toBe('浏览器启动失败：领星自动化浏览器配置正在被另一个实例占用。请关闭残留的自动化浏览器窗口后重试。');
    expect(message).not.toContain('--user-data-dir');
    expect(message).not.toContain('Call log');
    expect(message).not.toContain('chrome.exe');
  });

  it('keeps ordinary operator errors short and readable', () => {
    const message = toUserFacingError(new Error('领星 ERP 登录未完成：仍停留在账号登录页\ninternal stack'), '登录失败');

    expect(message).toBe('领星 ERP 登录未完成：仍停留在账号登录页');
  });

  it('turns live-collection blockers into operator actions', () => {
    expect(toUserFacingError(
      new Error('Browser session is not ready. Set LINGXING_USERNAME and LINGXING_PASSWORD and pass --login.'),
      '采集失败',
    )).toBe('浏览器会话未就绪：请先登录领星 ERP，并从 ERP 广告入口进入 Ads 后重试。');

    expect(toUserFacingError(
      new Error('download center page model still requires manual verification'),
      '采集失败',
    )).toBe('页面模型仍在人工复核状态：需完成 8 类单报表验证和启用审计后再放行完整采集。');
  });

  it('summarizes selector failures without exposing raw locator text', () => {
    const message = toUserFacingError(
      new Error('locator.click: Timeout 30000ms exceeded while waiting for selector .JS-download-report'),
      '下载失败',
    );

    expect(message).toBe('页面控件定位失败：请重新验证页面并导出诊断证据包，用高级诊断修正页面模型。');
    expect(message).not.toContain('.JS-download-report');
  });
});

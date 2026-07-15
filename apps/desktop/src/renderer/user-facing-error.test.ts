import { describe, expect, it } from 'vitest';
import { toReadbackUserFacingError, toUserFacingError } from './user-facing-error';

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

  it('turns recommendation data blockers into product-scope next actions', () => {
    const message = toUserFacingError(
      new Error("Error invoking remote method 'v1_5:business-ui:ad-strategy-diagnosis': Error: 生成优化建议被阻断：当前范围没有由真实报表导入的广告指标行。"),
      'AI 阶段分析失败',
    );

    expect(message).toBe('当前产品范围缺少已导入的日级广告指标：请先在数据采集页重新获取完整 8 类报表，并在数据导入与校验页导入当前批次后再运行 AI。');
    expect(message).not.toContain('Error invoking remote method');
  });

  it('turns scoped metric binding blockers into product and import actions', () => {
    const message = toUserFacingError(
      new Error('生成优化建议被阻断：当前范围缺少可绑定的日级广告指标。请回到数据导入与校验页，确认真实报表 source_file、批次、店铺、站点和日期范围与 DB 指标一致。'),
      '生成优化建议失败',
    );

    expect(message).toBe('当前产品范围缺少可回查的日级广告指标：请先在产品管理选择 ASIN，并在数据导入与校验页重新导入当前批次真实报表后再运行 AI。');
    expect(message).not.toContain('source_file');
  });
});

describe('toReadbackUserFacingError', () => {
  it.each([
    'SQLITE_ERROR: no such table: action_recommendations',
    'EPERM: operation not permitted, open C:\\private\\evidence.json',
    'TypeError: Cannot read properties of undefined\n    at verify (index.ts:7420:11)',
  ])('fails closed to stable copy for technical error: %s', (raw) => {
    const message = toReadbackUserFacingError(new Error(raw), '校验回读证据失败。');

    expect(message).toBe('校验回读证据失败。');
    expect(message).not.toMatch(/SQLITE|EPERM|TypeError|index\.ts|private/i);
  });

  it('preserves stable readback business blockers without exposing the IPC prefix', () => {
    expect(toReadbackUserFacingError(
      new Error("Error invoking remote method 'export': Error: 结果核对状态冲突：建议版本已变化，请刷新后重试。"),
      '导出回读证据失败。',
    )).toBe('结果核对状态冲突：建议版本已变化，请刷新后重试。');
  });
});

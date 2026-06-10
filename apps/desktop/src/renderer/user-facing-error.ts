export function toUserFacingError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error || '');
  if (!message) return fallback;

  if (/browser session is not ready/i.test(message)) {
    return '浏览器会话未就绪：请先登录领星 ERP，并从 ERP 广告入口进入 Ads 后重试。';
  }
  if (/requires manual verification|manual verification/i.test(message)) {
    return '页面模型仍在人工复核状态：需完成 8 类单报表验证和启用审计后再放行完整采集。';
  }
  if (/diagnostic evidence/i.test(message) && /stale|expired|missing|not found|not ready/i.test(message)) {
    return '当前范围缺少有效诊断证据：请先点击“验证页面”，刷新截图、DOM 和页面模型证据。';
  }
  if (/selector|locator/i.test(message) && /not found|missing|strict mode|timeout|exceeded/i.test(message)) {
    return '页面控件定位失败：请重新验证页面并导出诊断证据包，用高级诊断修正页面模型。';
  }
  if (/Call log:|--user-data-dir|--disable-|chrome-win64|ms-playwright|playwright|chromium/i.test(message)) {
    if (/Target page, context or browser has been closed/i.test(message)) {
      return '浏览器连接已关闭，请关闭残留的自动化浏览器窗口后重试。';
    }
    if (/profile|user[- ]data[- ]dir|already in use|ProcessSingleton|另一个程序/i.test(message)) {
      return '浏览器启动失败：领星自动化浏览器配置正在被另一个实例占用。请关闭残留的自动化浏览器窗口后重试。';
    }
    return '浏览器启动失败：请关闭残留的自动化浏览器窗口后重试；如果仍失败，请重新启动桌面应用。';
  }

  return message.split(/\r?\n/)[0].slice(0, 240);
}

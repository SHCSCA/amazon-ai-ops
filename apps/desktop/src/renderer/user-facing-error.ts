export function toUserFacingError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error || '');
  if (!message) return fallback;

  if (/browser session is not ready/i.test(message)) {
    return '浏览器会话未就绪：请先登录领星 ERP，并从 ERP 广告入口进入 Ads 后重试。';
  }
  if (/只读数据接口未暴露|getBusinessUiDataPipeline|electronAPI/i.test(message)) {
    return '应用运行环境异常：当前页面没有连接到桌面端数据接口。请使用最新安装版或免安装版重新打开。';
  }
  if (/not implemented|not exposed|未暴露/i.test(message)) {
    return '功能入口尚未连接到桌面端接口：请重新打开最新安装版；如果仍出现，请导出诊断证据。';
  }
  if (/missing|not found/i.test(message) && /report|file|path|batch/i.test(message)) {
    return '当前范围缺少可用文件或数据批次：请先在数据采集页确认真实报表文件存在并完成导入。';
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

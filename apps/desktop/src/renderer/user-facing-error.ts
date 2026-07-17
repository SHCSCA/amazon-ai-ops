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
  if (/生成优化建议被阻断/.test(message)) {
    if (/缺少可绑定的日级广告指标/.test(message)) {
      return '当前产品范围缺少可回查的日级广告指标：请先在“产品工作台”选择 ASIN，并到“数据准备 → 导入检查”重新导入当前批次真实报表后再运行 AI。';
    }
    if (/没有由真实报表导入的广告指标行|缺少导入后的日级广告指标|没有真实报表文件和导入指标/.test(message)) {
      return '当前产品范围缺少已导入的日级广告指标：请先到“数据准备 → 报表采集”重新获取完整 8 类报表，再到“数据准备 → 导入检查”导入当前批次后运行 AI。';
    }
    if (/没有真实 \.xlsx\/\.xls\/\.csv 原始报表文件|缺少真实广告报表文件|只找到 \d+\/\d+ 类真实广告报表/.test(message)) {
      return '当前产品范围缺少完整真实广告报表：请先到“数据准备 → 报表采集”重新获取完整 8 类报表，再到“导入检查”导入当前批次。';
    }
    if (/缺少可绑定产品 ASIN/.test(message)) {
      return '当前广告指标缺少可绑定产品 ASIN：请先在“产品工作台”选择 ASIN，或重新导入包含 ASIN 的真实报表。';
    }
    return '当前产品范围的数据证据不足，AI 不会生成正式建议：请先补齐真实报表、导入指标和产品 ASIN 后重试。';
  }
  if (/读取关键词机会被阻断/.test(message)) {
    const coverage = message.match(/(\d+)\s*\/\s*8\s*类/);
    const coverageSummary = coverage
      ? `当前范围仅覆盖 ${coverage[1]}/8 类报表。`
      : '当前范围缺少完整报表。';
    return `关键词机会暂不可用：${coverageSummary}请到“数据准备”补齐并导入缺失报表后重试。`;
  }
  if (/missing|not found/i.test(message) && /report|file|path|batch/i.test(message)) {
    return '当前范围缺少可用文件或数据批次：请先到“数据准备 → 报表采集”确认真实报表文件存在，再到“导入检查”完成导入。';
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

export function toReadbackUserFacingError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error || '');
  const stableBusinessMessage = message.match(/结果核对(?:被阻断|状态冲突)：[^\r\n]*/)?.[0];
  if (stableBusinessMessage) return stableBusinessMessage.slice(0, 240);

  const mapped = toUserFacingError(error, fallback);
  const rawFirstLine = message.split(/\r?\n/)[0].slice(0, 240);
  return mapped !== rawFirstLine ? mapped : fallback;
}

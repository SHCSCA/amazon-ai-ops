export const PROTOTYPE_NOW = "2026-07-20T09:15:08+08:00";
export const PROTOTYPE_DATE = "2026-07-20";
export const DEFAULT_STORE_ID = "SHC001";

export const WORKSPACE_REGISTRY = [
  {
    id: "today",
    label: "今日任务",
    shortLabel: "今日",
    description: "查看当前运营重点、数据健康与下一安全动作",
    section: "daily",
    iconKey: "compass",
    defaultSubview: "overview",
    subviews: [
      { id: "overview", label: "今日总览", description: "串联采集、诊断、决策、执行与回读", legacyRoute: "dashboard" },
    ],
  },
  {
    id: "product",
    label: "产品工作台",
    shortLabel: "产品",
    description: "维护产品、利润目标与运营事件",
    section: "daily",
    iconKey: "package",
    defaultSubview: "products",
    subviews: [
      { id: "products", label: "产品", description: "选择并锁定当前运营产品", legacyRoute: "product-management" },
      { id: "targets", label: "目标与成本", description: "维护利润边界与广告目标", legacyRoute: "product-config" },
      { id: "events", label: "运营事件", description: "记录影响判断的运营上下文", legacyRoute: "operation-events" },
    ],
  },
  {
    id: "data-preparation",
    label: "数据准备",
    shortLabel: "数据",
    description: "配置范围、采集八类报表并检查导入",
    section: "daily",
    iconKey: "database",
    defaultSubview: "scope",
    subviews: [
      { id: "scope", label: "工作范围", description: "确认日期、店铺、站点与产品范围", legacyRoute: "operation-scope" },
      { id: "reports", label: "报表采集", description: "获取完整八类真实业务报表", legacyRoute: "data-collection" },
      { id: "import-check", label: "导入检查", description: "核对逐类入库与指标口径", legacyRoute: "data-import-validation" },
    ],
  },
  {
    id: "diagnosis",
    label: "广告诊断",
    shortLabel: "诊断",
    description: "基于真实广告对象检查风险与机会",
    section: "daily",
    iconKey: "chart",
    defaultSubview: "analysis",
    subviews: [
      { id: "analysis", label: "广告诊断", description: "检查真实广告对象的风险与机会", legacyRoute: "ad-quant" },
    ],
  },
  {
    id: "decisions",
    label: "建议与审批",
    shortLabel: "决策",
    description: "复核建议、人工审批并查看已决策记录",
    section: "daily",
    iconKey: "list-checks",
    defaultSubview: "recommendations",
    subviews: [
      { id: "recommendations", label: "待判断", description: "复核 AI 建议与证据", legacyRoute: "recommendations" },
      { id: "approval", label: "待审批", description: "为高影响动作签发执行许可", legacyRoute: "approval" },
      { id: "decided", label: "已决策", description: "只读查看批准、拒绝和已执行记录", legacyRoute: "approval" },
    ],
  },
  {
    id: "readback",
    label: "结果核对",
    shortLabel: "回读",
    description: "核对可见浏览器执行、页面重载值与结果证据",
    section: "daily",
    iconKey: "seal-check",
    defaultSubview: "evidence",
    subviews: [
      { id: "evidence", label: "执行回读", description: "补齐审批、前后值、截图和重载回读", legacyRoute: "readback" },
    ],
  },
  {
    id: "growth",
    label: "关键词与 Listing",
    shortLabel: "增长",
    description: "发现关键词机会并维护本地 Listing 草案",
    section: "daily",
    iconKey: "sparkle",
    defaultSubview: "keywords",
    subviews: [
      { id: "keywords", label: "关键词机会", description: "筛选可行动的真实关键词机会", legacyRoute: "keyword-opportunities" },
      { id: "listing", label: "Listing 草案", description: "生成并导出仅本地使用的 Listing 草案", legacyRoute: "listing-optimization" },
    ],
  },
  {
    id: "system",
    label: "系统与交付",
    shortLabel: "系统",
    description: "管理 AI、自动任务与候选包交付门槛",
    section: "system",
    iconKey: "gear",
    defaultSubview: "settings",
    subviews: [
      { id: "settings", label: "AI 与规则", description: "配置 AI 连接与本地运营规则", legacyRoute: "settings" },
      { id: "scheduler", label: "定时任务", description: "检查自动任务状态与最近结果", legacyRoute: "scheduler" },
      { id: "delivery", label: "交付验收", description: "核对当前候选包与正式交付门槛", legacyRoute: "delivery" },
    ],
  },
];

export const SUBVIEW_REGISTRY = WORKSPACE_REGISTRY.flatMap((workspace) =>
  workspace.subviews.map((subview) => ({ ...subview, workspace: workspace.id, key: `${workspace.id}:${subview.id}` })),
);

export const REPORT_TYPE_REGISTRY = [
  { type: "campaign", label: "广告活动报告", grain: "campaign", expectedFilenameKeyword: "campaign" },
  { type: "ad_group", label: "广告组报告", grain: "ad-group", expectedFilenameKeyword: "ad_group" },
  { type: "placement", label: "广告位报告", grain: "breakdown", expectedFilenameKeyword: "placement" },
  { type: "advertised_product", label: "广告（推广的商品）报告", grain: "product", expectedFilenameKeyword: "advertised_product" },
  { type: "auto_targeting", label: "自动投放报告", grain: "target", expectedFilenameKeyword: "auto_targeting" },
  { type: "keyword", label: "关键词报告", grain: "keyword", expectedFilenameKeyword: "keyword" },
  { type: "product_targeting", label: "商品投放报告", grain: "target", expectedFilenameKeyword: "product_targeting" },
  { type: "user_search_term", label: "用户搜索词报告", grain: "search-term", expectedFilenameKeyword: "search_term" },
];

export const RECOMMENDATION_STATUS_REGISTRY = [
  { id: "pending_review", label: "待判断", tone: "info", mutable: true },
  { id: "pending_approval", label: "待审批", tone: "warning", mutable: true },
  { id: "approved", label: "许可已签发", tone: "success", mutable: false },
  { id: "rejected", label: "已拒绝", tone: "neutral", mutable: false },
  { id: "executed", label: "已执行", tone: "success", mutable: false },
  { id: "superseded", label: "已被新版本替代", tone: "neutral", mutable: false },
];

const reportRowsByStore = {
  SHC001: [142, 684, 315, 840, 622, 1420, 930, 1874],
  LMX002: [96, 412, 204, 480, 338, 810, 562, 1010],
  NOC003: [121, 566, 0, 630, 478, 1120, 721, 1470],
};

function createReports(storeId, dateFrom, dateTo) {
  return REPORT_TYPE_REGISTRY.map((definition, index) => {
    const importedRows = reportRowsByStore[storeId][index];
    const missing = importedRows === 0;
    return {
      ...definition,
      id: `${storeId}-report-${definition.type}`,
      status: missing ? "missing" : "imported",
      realFileAvailable: !missing,
      importedRows,
      generatedAt: missing ? null : `2026-07-20T08:${String(32 + index).padStart(2, "0")}:00+08:00`,
      importedAt: missing ? null : `2026-07-20T08:${String(43 + index).padStart(2, "0")}:00+08:00`,
      source: "领星 Ads 下载中心",
      filename: missing ? null : `${String(index + 1).padStart(2, "0")}_${definition.label}_${dateFrom}_${dateTo}.xlsx`,
      checksum: missing ? null : `sha256:${storeId.toLowerCase()}-${definition.type}-20260720`,
      error: missing ? "下载中心仍在生成，尚未取得真实文件" : null,
    };
  });
}

function deliveryFixture(storeId, packageTone = "warning") {
  return {
    candidate: "external-security-p1",
    appStatus: "APP_NEEDS_WORK",
    formalGates: { passed: 7, total: 8 },
    packageTone,
    blocker: "real-ad-execution-readback",
    lastCheckedAt: "2026-07-20T08:12:00+08:00",
    bundle: "v15-delivery-bundle-20260717-external-security-p1-non-ready",
    storeEvidenceNamespace: `${storeId}/delivery`,
    gates: [
      { id: "tests", label: "全量测试", status: "passed", detail: "1992/1992" },
      { id: "typecheck", label: "类型检查", status: "passed", detail: "desktop + packages" },
      { id: "package-launch", label: "包体启动", status: "passed", detail: "Windows smoke" },
      { id: "workspace-ui", label: "工作区 UI", status: "passed", detail: "46/46" },
      { id: "business-smoke", label: "业务冒烟", status: "passed", detail: "5/5" },
      { id: "security", label: "安全边界", status: "passed", detail: "11/11" },
      { id: "bundle-safety", label: "NON_READY 安全", status: "passed", detail: "19/19" },
      { id: "real-readback", label: "真实广告执行回读", status: "blocked", detail: "等待人工批准与真实 Ads 前后值" },
    ],
  };
}

function schedulerFixture(storeId, collectionTime, diagnosisTime) {
  return [
    { id: `${storeId}-schedule-collect`, name: "每日领星八报表采集", cron: collectionTime, enabled: true, nextRun: `2026-07-21 ${collectionTime}`, lastRun: `2026-07-20 ${collectionTime}`, lastStatus: "success", owner: "本机可见浏览器" },
    { id: `${storeId}-schedule-diagnose`, name: "导入后广告量化", cron: diagnosisTime, enabled: true, nextRun: `2026-07-21 ${diagnosisTime}`, lastRun: `2026-07-20 ${diagnosisTime}`, lastStatus: "success", owner: "本地 AI 编排器" },
    { id: `${storeId}-schedule-readback`, name: "执行后页面回读", cron: "每次执行后 +10m", enabled: true, nextRun: "由执行队列触发", lastRun: "2026-07-20 09:15", lastStatus: storeId === "LMX002" ? "success" : "waiting", owner: "可见浏览器" },
  ];
}

const stores = {
  SHC001: {
    id: "SHC001",
    name: "嘉风家居",
    storeName: "JF-US",
    marketplace: "美国站",
    marketplaceCode: "US",
    currencyCode: "USD",
    currencySymbol: "$",
    locale: "en-US",
    timeZone: "America/Los_Angeles",
    session: { status: "ready", label: "领星会话正常", checkedAt: "2026-07-20T08:30:00+08:00", profile: "profile-SHC001" },
    connections: { erp: { status: "ready" }, ads: { status: "ready", storeMatched: "verified" } },
    adsIdentity: { status: "verified", storeMatched: true, canonicalObjectReady: true },
    policyAuthority: { status: "enabled", versionLabel: "关键词竞价策略 · 版本 1", selectedProductBound: true, currentValueFresh: true },
    autonomy: { mode: "auto", paused: false, lowRiskLimitPercent: 15, budgetChangeLimitPercent: 20, dailyBudgetCap: 100, executedToday: 3, eligibleToday: 8, budgetImpactToday: 24 },
    scope: { dateFrom: "2026-06-17", dateTo: "2026-07-20", batchId: "batch_SHC001_20260720_0842", selectedProductId: "SHC001-product-D6", asin: "B0GTTJFQTM", productLabel: "JF-US / B0GTTJFQTM" },
    metrics: { sales: 4862, salesDelta: 0.086, adSpend: 1867.01, orders: 113, acos: 0.384, targetAcos: 0.28, tacos: 0.119, targetTacos: 0.1, cpc: 1.06, cvr: 0.083, anomalies: 2 },
    products: [
      { id: "SHC001-product-D6", asin: "B0GTTJFQTM", sku: "D6-SKU", msku: "D6-M", title: "D6 Keypad Door Lock with Handle", stage: "keyword_exploration", status: "active", selected: true, updatedAt: "2026-07-20T08:28:00+08:00", target: { purchaseCost: 15.7, firstLegCost: 1.8, fbaFee: 6.49, referralFeeRate: 0.15, storageFee: 0.42, otherCost: 0.3, currentPrice: 49.99, minPrice: 33.99, targetNetMargin: 0.15, targetAcos: 0.28, targetTacos: 0.1 } },
      { id: "SHC001-product-D7", asin: "B0GVRW2HPY", sku: "D7-SKU", msku: "D7-M", title: "D7 Smart Lock", stage: "scaling", status: "active", selected: false, updatedAt: "2026-07-19T16:20:00+08:00", target: { purchaseCost: 16.2, firstLegCost: 1.9, fbaFee: 6.59, referralFeeRate: 0.15, storageFee: 0.45, otherCost: 0.3, currentPrice: 52.99, minPrice: 36.99, targetNetMargin: 0.18, targetAcos: 0.26, targetTacos: 0.09 } },
      { id: "SHC001-product-D8", asin: "B0GVS5LVK2", sku: "D8-SKU", msku: "D8-M", title: "D8 Bedroom Lock", stage: "declining_repair", status: "watch", selected: false, updatedAt: "2026-07-18T11:04:00+08:00", target: { purchaseCost: 13.8, firstLegCost: 1.6, fbaFee: 5.92, referralFeeRate: 0.15, storageFee: 0.39, otherCost: 0.28, currentPrice: 39.99, minPrice: 29.99, targetNetMargin: 0.1, targetAcos: 0.34, targetTacos: 0.14 } },
    ],
    events: [
      { id: "SHC001-event-001", occurredAt: "2026-07-18T09:00:00+08:00", type: "listing_change", title: "Listing 标题补充 keypad door lock", description: "调整标题前 80 字符，保留品牌词与兼容性声明", productId: "SHC001-product-D6", impact: "watch", aiContext: true },
      { id: "SHC001-event-002", occurredAt: "2026-07-19T15:30:00+08:00", type: "promotion", title: "7% Coupon 开始", description: "预计影响 CVR 与广告归因销售", productId: "SHC001-product-D6", impact: "positive", aiContext: true },
      { id: "SHC001-event-003", occurredAt: "2026-07-20T07:45:00+08:00", type: "price_change", title: "售价 $47.99 恢复至 $49.99", description: "结束 Prime Day 临时价格", productId: "SHC001-product-D6", impact: "material", aiContext: true },
    ],
    reports: createReports("SHC001", "2026-06-17", "2026-07-20"),
    importRun: { id: "SHC001-import-20260720", status: "validated", reportTypesImported: 8, reportTypesExpected: 8, importedRows: 6827, rejectedRows: 0, duplicateRows: 12, sourceFiles: 8, startedAt: "2026-07-20T08:43:00+08:00", completedAt: "2026-07-20T08:46:00+08:00", metricGrain: "user_search_term", reconciliation: "passed" },
    diagnostics: [
      { id: "SHC001-diag-001", objectKey: "SHC001|B0GTTJFQTM|Exact-Core|keypad door lock with handle", objectType: "keyword", objectName: "keypad door lock with handle", campaignName: "D6-精准-核心长尾", adGroupName: "Exact-Core", matchType: "exact", impressions: 8230, clicks: 98, spend: 127.4, sales: 199.96, orders: 4, acos: 0.637, cpc: 1.3, cvr: 0.0408, severity: "high", quantStatus: "waste", lifecycleStage: "testing", diagnosis: "花费上升且转化率下降", recommendedAction: "竞价下调", suggestedValue: 1.17 },
      { id: "SHC001-diag-002", objectKey: "SHC001|B0GTTJFQTM|Exact-Core|budget", objectType: "ad_group", objectName: "Exact-Core", campaignName: "D6-精准-核心长尾", adGroupName: "Exact-Core", impressions: 28440, clicks: 322, spend: 412.9, sales: 1249.75, orders: 25, acos: 0.33, cpc: 1.28, cvr: 0.0776, severity: "high", quantStatus: "opportunity", lifecycleStage: "scaling", diagnosis: "高转化时段预算提前耗尽", recommendedAction: "日预算上调", suggestedValue: 168 },
      { id: "SHC001-diag-003", objectKey: "SHC001|B0GTTJFQTM|Broad-Test|bedroom lock cheap", objectType: "search_term", objectName: "bedroom lock cheap", campaignName: "D6-广泛-测词", adGroupName: "Broad-Test", matchType: "broad", impressions: 1460, clicks: 22, spend: 26.18, sales: 0, orders: 0, acos: null, cpc: 1.19, cvr: 0, severity: "medium", quantStatus: "waste", lifecycleStage: "testing", diagnosis: "连续点击无订单", recommendedAction: "加入否定精准", suggestedValue: "negative_exact" },
      { id: "SHC001-diag-004", objectKey: "SHC001|B0GTTJFQTM|Auto-Low|close-match", objectType: "auto_targeting", objectName: "close-match", campaignName: "D6-Auto-Low", adGroupName: "Auto", impressions: 19210, clicks: 176, spend: 151.36, sales: 549.89, orders: 11, acos: 0.275, cpc: 0.86, cvr: 0.0625, severity: "low", quantStatus: "healthy", lifecycleStage: "scaling", diagnosis: "ACOS 低于目标且订单稳定", recommendedAction: "保持", suggestedValue: 0.86 },
      { id: "SHC001-diag-005", objectKey: "SHC001|B0GTTJFQTM|D6-精准-核心长尾|top-of-search", objectType: "placement", objectName: "搜索结果顶部", campaignName: "D6-精准-核心长尾", adGroupName: null, impressions: 6130, clicks: 76, spend: 64.2, sales: 220.55, orders: 5, acos: 0.291, cpc: 0.845, cvr: 0.0658, severity: "medium", quantStatus: "watch", lifecycleStage: "testing", diagnosis: "活动级广告位溢价需继续观察", recommendedAction: "保持当前广告位系数", suggestedValue: 20 },
    ],
    recommendations: [
      { id: "REC-20260720-004", actionId: "ACT-20260720-004", revision: 3, status: "pending_approval", risk: "high", title: "广告组 Exact-Core 日预算上调", entityType: "ad_group", objectName: "广告组 Exact-Core · B0GTTJFQTM", campaignName: "D6-精准-核心长尾", adGroupName: "Exact-Core", actionType: "budget_change", currentValue: 120, recommendedValue: 168, recalculatedValue: 154, unit: "currency", deltaPercent: 40, requiresApproval: true, reason: "高转化时段预算提前耗尽，近 7 天错失约 14 个订单；变更幅度超过本店 20% 自动边界。", evidence: ["近 7 天 11:40 前预算耗尽 5 次", "高转化时段 CVR 18.2%", "预计订单 +6.2%，TACOS +0.8pct"], authority: { batchId: "batch_SHC001_20260720_0842", reportType: "ad_group", diagnosticId: "SHC001-diag-002", model: "ad-strategy-v2.1" }, policy: { id: "POL-SHC001-v12", boundary: "日预算单次变更 ±20%", eligible: false, blocker: "超过自动边界" }, createdAt: "2026-07-20T08:52:40+08:00" },
      { id: "REC-20260720-003", actionId: "ACT-20260720-003", revision: 2, status: "executed", risk: "low", title: "精确词竞价下调", entityType: "keyword", objectName: "关键词 keypad door lock with handle · exact", campaignName: "D6-精准-核心长尾", adGroupName: "Exact-Core", actionType: "bid_change", currentValue: 1.3, recommendedValue: 1.17, unit: "currency", deltaPercent: -10, requiresApproval: false, reason: "近 7 天花费上升 21%，转化率下降 8%，竞品出价均值低于当前 12%。", evidence: ["近 7 天花费趋势 +21%", "转化率变化 -8%", "竞品出价中位数 $1.14"], authority: { batchId: "batch_SHC001_20260720_0842", reportType: "keyword", diagnosticId: "SHC001-diag-001", model: "ad-strategy-v2.1" }, policy: { id: "POL-SHC001-v12", boundary: "关键词竞价单次变更 ±15%", eligible: true, blocker: null }, createdAt: "2026-07-20T08:52:12+08:00" },
      { id: "REC-20260720-002", actionId: null, revision: 1, status: "pending_review", risk: "medium", title: "低意向搜索词否定", entityType: "search_term", objectName: "bedroom lock cheap", campaignName: "D6-广泛-测词", adGroupName: "Broad-Test", actionType: "negative_exact", currentValue: "投放中", recommendedValue: "否定精准", unit: "state", deltaPercent: null, requiresApproval: true, reason: "22 次点击无订单，需要先复核相关性。", evidence: ["22 点击 / 0 订单", "花费 $26.18", "相关性模型 0.34"], authority: { batchId: "batch_SHC001_20260720_0842", reportType: "user_search_term", diagnosticId: "SHC001-diag-003", model: "ad-strategy-v2.1" }, policy: { id: "POL-SHC001-v12", boundary: "否定词必须人工确认相关性", eligible: false, blocker: "等待判断" }, createdAt: "2026-07-20T08:51:58+08:00" },
      { id: "REC-20260719-008", actionId: null, revision: 2, status: "rejected", risk: "high", title: "暂停 D6-Auto-Low", entityType: "campaign", objectName: "D6-Auto-Low", campaignName: "D6-Auto-Low", adGroupName: null, actionType: "pause", currentValue: "启用", recommendedValue: "暂停", unit: "state", deltaPercent: -100, requiresApproval: true, reason: "旧诊断误把活动级和关键词级花费相加。", evidence: ["口径复核失败", "被 2026-07-20 新批次替代"], authority: { batchId: "batch_SHC001_20260719_0840", reportType: "campaign", diagnosticId: null, model: "ad-strategy-v2.0" }, policy: { id: "POL-SHC001-v11", boundary: "暂停始终审批", eligible: false, blocker: "人工拒绝" }, createdAt: "2026-07-19T08:50:00+08:00", decidedAt: "2026-07-19T09:02:00+08:00", decisionNote: "聚合口径不可信" },
    ],
    executionQueue: [
      { id: "ACT-20260720-003", recommendationId: "REC-20260720-003", status: "awaiting_readback", mode: "auto", permission: "policy", target: "keypad door lock with handle · exact", entityType: "keyword", beforeValue: 1.3, intendedValue: 1.17, observedValue: 1.17, unit: "currency", queuedAt: "2026-07-20T09:00:00+08:00", startedAt: "2026-07-20T09:04:58+08:00", savedAt: "2026-07-20T09:05:27+08:00", browserProfile: "profile-SHC001", storeIdentityVerified: true },
      { id: "ACT-20260720-004", recommendationId: "REC-20260720-004", status: "waiting_permission", mode: "review", permission: null, target: "Exact-Core", entityType: "ad_group", beforeValue: 120, intendedValue: 168, observedValue: 120, unit: "currency", queuedAt: null, startedAt: null, savedAt: null, browserProfile: "profile-SHC001", storeIdentityVerified: true },
    ],
    readbacks: [
      { id: "SHC001-readback-003", actionId: "ACT-20260720-003", recommendationId: "REC-20260720-003", status: "waiting", requiredAt: "2026-07-20T09:15:27+08:00", checkedAt: null, beforeValue: 1.3, savedValue: 1.17, reloadValue: null, screenshots: { before: true, after: true, reload: false }, authorityBound: true, storeIdentityVerified: true, note: "等待页面重载确认" },
      { id: "SHC001-readback-history-001", actionId: "ACT-20260719-001", recommendationId: "REC-20260719-001", status: "verified", requiredAt: "2026-07-19T09:20:00+08:00", checkedAt: "2026-07-19T09:20:08+08:00", beforeValue: 1.42, savedValue: 1.3, reloadValue: 1.3, screenshots: { before: true, after: true, reload: true }, authorityBound: true, storeIdentityVerified: true, note: "24h ACOS -3.1pct，订单 +2" },
    ],
    outcomes: [{ id: "SHC001-outcome-001", actionId: "ACT-20260719-001", title: "24h 回读：ACOS -3.1pct，订单 +2", objectName: "关键词 door lock · exact", before: "$1.42", after: "$1.30", result: "花费 $34.21 → $32.08", verifiedAt: "2026-07-20T09:10:00+08:00" }],
    keywords: [
      { id: "SHC001-kw-001", keyword: "keypad door lock with handle", source: "user_search_term", campaignName: "D6-精准-核心长尾", matchType: "exact", relevance: 0.96, searchVolume: 13200, clicks: 98, orders: 4, acos: 0.637, opportunity: "bid_down", priority: "high", selected: true },
      { id: "SHC001-kw-002", keyword: "fingerprint door handle lock", source: "user_search_term", campaignName: "D6-Auto-Low", matchType: "close-match", relevance: 0.91, searchVolume: 8100, clicks: 31, orders: 4, acos: 0.243, opportunity: "promote_exact", priority: "high", selected: false },
      { id: "SHC001-kw-003", keyword: "bedroom door lock keypad", source: "keyword", campaignName: "D6-广泛-测词", matchType: "broad", relevance: 0.84, searchVolume: 6600, clicks: 22, orders: 1, acos: 0.524, opportunity: "watch", priority: "medium", selected: false },
      { id: "SHC001-kw-004", keyword: "bedroom lock cheap", source: "user_search_term", campaignName: "D6-广泛-测词", matchType: "broad", relevance: 0.34, searchVolume: 1900, clicks: 22, orders: 0, acos: null, opportunity: "negative_exact", priority: "medium", selected: false },
    ],
    listing: { asin: "B0GTTJFQTM", source: "领星 Listing 快照", fetchedAt: "2026-07-20T08:20:00+08:00", current: { title: "Keypad Door Lock with Handle, Keyless Entry Lever", bullets: ["Fingerprint and keypad entry", "Auto-lock for bedroom and office", "Easy installation"], backendTerms: "keypad lock door handle keyless entry" }, draft: { id: "SHC001-listing-draft-004", status: "local_draft", title: "Keypad Door Lock with Handle, Fingerprint Keyless Entry Lever for Bedroom and Office", bullets: ["6-in-1 keyless entry with fingerprint, passcode and backup key", "Adjustable auto-lock helps protect bedrooms, offices and rentals", "Fits standard US doors with guided local installation notes"], backendTerms: "fingerprint keypad door lever smart bedroom lock", includedKeywords: ["keypad door lock with handle", "fingerprint door handle lock"], missingKeywords: ["rental property door lock"], generatedAt: "2026-07-20T08:58:00+08:00", exportedAt: null, amazonWriteAllowed: false }, history: [{ id: "SHC001-listing-v3", createdAt: "2026-07-18T09:12:00+08:00", note: "补充 keypad 核心词", status: "exported_local" }] },
    aiRules: { provider: "DeepSeek", model: "deepseek-chat", connectionStatus: "ready", keyStored: true, outputContract: "ad-strategy-diagnosis-v2", temperature: 0.1, thresholds: { minClicksWithoutOrder: 12, targetAcosTolerance: 0.05, highRiskDeltaPercent: 20, minEvidenceRows: 7 }, safety: { requireSourceAuthority: true, requireWritableTarget: true, requireHumanForPause: true, requireReadback: true, allowAutoExecute: true }, updatedAt: "2026-07-20T07:55:00+08:00" },
    scheduler: schedulerFixture("SHC001", "08:30", "08:48"),
    delivery: deliveryFixture("SHC001"),
  },

  LMX002: {
    id: "LMX002",
    name: "HomeNest 家居",
    storeName: "HN-US",
    marketplace: "美国站",
    marketplaceCode: "US",
    currencyCode: "USD",
    currencySymbol: "$",
    locale: "en-US",
    timeZone: "America/Los_Angeles",
    session: { status: "warning", label: "领星会话待续期", checkedAt: "2026-07-20T07:58:00+08:00", profile: "profile-LMX002" },
    connections: { erp: { status: "ready" }, ads: { status: "blocked", storeMatched: "blocked" } },
    adsIdentity: { status: "blocked", storeMatched: false, canonicalObjectReady: false },
    policyAuthority: { status: "enabled", versionLabel: "关键词竞价策略 · 版本 1", selectedProductBound: true, currentValueFresh: true },
    autonomy: { mode: "review", paused: false, lowRiskLimitPercent: 12, budgetChangeLimitPercent: 18, dailyBudgetCap: 80, executedToday: 0, eligibleToday: 6, budgetImpactToday: 0 },
    scope: { dateFrom: "2026-06-17", dateTo: "2026-07-20", batchId: "batch_LMX002_20260720_0840", selectedProductId: "LMX002-product-LM02", asin: "B0D8W2RC8Q", productLabel: "HN-US / B0D8W2RC8Q" },
    metrics: { sales: 2146, salesDelta: -0.012, adSpend: 534.35, orders: 61, acos: 0.249, targetAcos: 0.25, tacos: 0.087, targetTacos: 0.09, cpc: 0.78, cvr: 0.091, anomalies: 1 },
    products: [
      { id: "LMX002-product-LM02", asin: "B0D8W2RC8Q", sku: "LM02-SKU", msku: "LM02-M", title: "Wooden Gate Latch Set", stage: "scaling", status: "active", selected: true, updatedAt: "2026-07-20T07:50:00+08:00", target: { purchaseCost: 9.4, firstLegCost: 1.3, fbaFee: 5.12, referralFeeRate: 0.15, storageFee: 0.31, otherCost: 0.2, currentPrice: 34.99, minPrice: 26.99, targetNetMargin: 0.18, targetAcos: 0.25, targetTacos: 0.09 } },
      { id: "LMX002-product-LM03", asin: "B0DM8K4P2L", sku: "LM03-SKU", msku: "LM03-M", title: "Black Barn Door Latch", stage: "keyword_exploration", status: "active", selected: false, updatedAt: "2026-07-19T12:00:00+08:00", target: { purchaseCost: 8.8, firstLegCost: 1.2, fbaFee: 4.96, referralFeeRate: 0.15, storageFee: 0.28, otherCost: 0.2, currentPrice: 32.99, minPrice: 24.99, targetNetMargin: 0.16, targetAcos: 0.29, targetTacos: 0.11 } },
      { id: "LMX002-product-LM04", asin: "B0F1L7Z6QT", sku: "LM04-SKU", msku: "LM04-M", title: "Cabin Hook Latch 4 Pack", stage: "stable", status: "active", selected: false, updatedAt: "2026-07-18T10:30:00+08:00", target: { purchaseCost: 6.2, firstLegCost: 0.9, fbaFee: 4.1, referralFeeRate: 0.15, storageFee: 0.22, otherCost: 0.18, currentPrice: 24.99, minPrice: 18.99, targetNetMargin: 0.2, targetAcos: 0.23, targetTacos: 0.08 } },
    ],
    events: [
      { id: "LMX002-event-001", occurredAt: "2026-07-17T08:30:00+08:00", type: "inventory", title: "美西仓补货入库", description: "可售库存恢复至 43 天", productId: "LMX002-product-LM02", impact: "positive", aiContext: true },
      { id: "LMX002-event-002", occurredAt: "2026-07-18T14:20:00+08:00", type: "promotion", title: "$3 Coupon 结束", description: "CVR 对比需排除促销结束影响", productId: "LMX002-product-LM02", impact: "material", aiContext: true },
      { id: "LMX002-event-003", occurredAt: "2026-07-20T07:58:00+08:00", type: "session", title: "领星会话失效", description: "数据快照可分析，但新执行许可暂不签发", productId: "LMX002-product-LM02", impact: "blocking", aiContext: true },
    ],
    reports: createReports("LMX002", "2026-06-17", "2026-07-20"),
    importRun: { id: "LMX002-import-20260720", status: "validated", reportTypesImported: 8, reportTypesExpected: 8, importedRows: 3912, rejectedRows: 0, duplicateRows: 4, sourceFiles: 8, startedAt: "2026-07-20T08:41:00+08:00", completedAt: "2026-07-20T08:45:00+08:00", metricGrain: "user_search_term", reconciliation: "passed" },
    diagnostics: [
      { id: "LMX002-diag-001", objectKey: "LMX002|B0D8W2RC8Q|Brand-Exact|budget", objectType: "ad_group", objectName: "Brand-Exact", campaignName: "LM02-Brand", adGroupName: "Brand-Exact", impressions: 12400, clicks: 184, spend: 128.4, sales: 744.8, orders: 22, acos: 0.172, cpc: 0.7, cvr: 0.1196, severity: "medium", quantStatus: "opportunity", lifecycleStage: "scaling", diagnosis: "品牌词订单稳定但预算耗尽", recommendedAction: "预算恢复", suggestedValue: 84 },
      { id: "LMX002-diag-002", objectKey: "LMX002|B0D8W2RC8Q|Generic-Phrase|wooden latch cheap", objectType: "search_term", objectName: "wooden latch cheap", campaignName: "LM02-Generic", adGroupName: "Generic-Phrase", matchType: "phrase", impressions: 2100, clicks: 18, spend: 31.4, sales: 0, orders: 0, acos: null, cpc: 1.744, cvr: 0, severity: "high", quantStatus: "waste", lifecycleStage: "testing", diagnosis: "连续 18 次点击无订单", recommendedAction: "否定词", suggestedValue: "negative_phrase" },
      { id: "LMX002-diag-003", objectKey: "LMX002|B0D8W2RC8Q|Generic-Exact|gate latch outdoor", objectType: "keyword", objectName: "gate latch outdoor", campaignName: "LM02-Generic", adGroupName: "Generic-Exact", matchType: "exact", impressions: 7650, clicks: 79, spend: 60.04, sales: 244.93, orders: 7, acos: 0.245, cpc: 0.76, cvr: 0.0886, severity: "low", quantStatus: "healthy", lifecycleStage: "stable", diagnosis: "接近目标 ACOS", recommendedAction: "保持", suggestedValue: 0.76 },
      { id: "LMX002-diag-004", objectKey: "LMX002|B0D8W2RC8Q|Auto|substitutes", objectType: "auto_targeting", objectName: "substitutes", campaignName: "LM02-Auto", adGroupName: "Auto", impressions: 9800, clicks: 101, spend: 91.91, sales: 279.92, orders: 8, acos: 0.328, cpc: 0.91, cvr: 0.0792, severity: "medium", quantStatus: "watch", lifecycleStage: "testing", diagnosis: "ACOS 高于目标但仍有稳定订单", recommendedAction: "竞价下调", suggestedValue: 0.84 },
    ],
    recommendations: [
      { id: "REC-20260720-017", actionId: "ACT-20260720-017", revision: 1, status: "pending_approval", risk: "medium", title: "品牌词预算恢复", entityType: "ad_group", objectName: "广告组 Brand-Exact · B0D8W2RC8Q", campaignName: "LM02-Brand", adGroupName: "Brand-Exact", actionType: "budget_change", currentValue: 72, recommendedValue: 84, recalculatedValue: 80, unit: "currency", deltaPercent: 16.7, requiresApproval: true, reason: "品牌词订单稳定，但领星会话需要重新确认后才能生成执行许可。", evidence: ["品牌词 ROAS 5.8", "近 3 天预算耗尽 2 次", "会话身份 07:58 失效"], authority: { batchId: "batch_LMX002_20260720_0840", reportType: "ad_group", diagnosticId: "LMX002-diag-001", model: "ad-strategy-v2.1" }, policy: { id: "POL-LMX002-v8", boundary: "必须先确认可见浏览器身份", eligible: false, blocker: "领星会话待续期" }, createdAt: "2026-07-20T08:50:00+08:00" },
      { id: "REC-20260719-011", actionId: "ACT-20260719-011", revision: 2, status: "executed", risk: "low", title: "否定低意向搜索词", entityType: "search_term", objectName: "搜索词 wooden latch cheap · phrase", campaignName: "LM02-Generic", adGroupName: "Generic-Phrase", actionType: "negative_phrase", currentValue: "投放中", recommendedValue: "已否定", unit: "state", deltaPercent: null, requiresApproval: false, reason: "连续 18 次点击无订单，已完成页面保存与次日数据回读。", evidence: ["18 点击 / 0 订单", "浪费花费 $31.40", "24h 后无新增曝光"], authority: { batchId: "batch_LMX002_20260719_0841", reportType: "user_search_term", diagnosticId: "LMX002-diag-002", model: "ad-strategy-v2.1" }, policy: { id: "POL-LMX002-v8", boundary: "连续 12 点击无转化", eligible: true, blocker: null }, createdAt: "2026-07-19T08:50:00+08:00" },
      { id: "REC-20260720-018", actionId: null, revision: 1, status: "pending_review", risk: "medium", title: "自动投放 substitutes 竞价下调", entityType: "auto_targeting", objectName: "substitutes", campaignName: "LM02-Auto", adGroupName: "Auto", actionType: "bid_change", currentValue: 0.91, recommendedValue: 0.84, unit: "currency", deltaPercent: -7.7, requiresApproval: false, reason: "ACOS 高于目标但仍有订单，建议小幅收紧。", evidence: ["ACOS 32.8%", "目标 ACOS 25%", "8 单稳定转化"], authority: { batchId: "batch_LMX002_20260720_0840", reportType: "auto_targeting", diagnosticId: "LMX002-diag-004", model: "ad-strategy-v2.1" }, policy: { id: "POL-LMX002-v8", boundary: "自动投放竞价 ±12%", eligible: false, blocker: "当前为人工审批模式" }, createdAt: "2026-07-20T08:50:20+08:00" },
      { id: "REC-20260718-009", actionId: null, revision: 2, status: "rejected", risk: "medium", title: "gate latch outdoor 提价", entityType: "keyword", objectName: "gate latch outdoor", campaignName: "LM02-Generic", adGroupName: "Generic-Exact", actionType: "bid_change", currentValue: 0.76, recommendedValue: 0.9, unit: "currency", deltaPercent: 18.4, requiresApproval: true, reason: "旧建议未纳入 Coupon 结束事件。", evidence: ["事件上下文缺失"], authority: { batchId: "batch_LMX002_20260718_0840", reportType: "keyword", diagnosticId: null, model: "ad-strategy-v2.0" }, policy: { id: "POL-LMX002-v7", boundary: "竞价单次变更 ±12%", eligible: false, blocker: "人工拒绝" }, createdAt: "2026-07-18T08:52:00+08:00", decidedAt: "2026-07-18T09:01:00+08:00", decisionNote: "等待促销后稳定数据" },
    ],
    executionQueue: [
      { id: "ACT-20260719-011", recommendationId: "REC-20260719-011", status: "verified", mode: "auto", permission: "policy", target: "wooden latch cheap · phrase", entityType: "search_term", beforeValue: "投放中", intendedValue: "已否定", observedValue: "已否定", unit: "state", queuedAt: "2026-07-19T09:00:00+08:00", startedAt: "2026-07-19T09:03:00+08:00", savedAt: "2026-07-19T09:03:24+08:00", browserProfile: "profile-LMX002", storeIdentityVerified: true },
      { id: "ACT-20260720-017", recommendationId: "REC-20260720-017", status: "blocked_session", mode: "review", permission: null, target: "Brand-Exact", entityType: "ad_group", beforeValue: 72, intendedValue: 84, observedValue: 72, unit: "currency", queuedAt: null, startedAt: null, savedAt: null, browserProfile: "profile-LMX002", storeIdentityVerified: false },
    ],
    readbacks: [
      { id: "LMX002-readback-011", actionId: "ACT-20260719-011", recommendationId: "REC-20260719-011", status: "verified", requiredAt: "2026-07-20T09:03:24+08:00", checkedAt: "2026-07-20T09:05:08+08:00", beforeValue: "投放中", savedValue: "已否定", reloadValue: "已否定", screenshots: { before: true, after: true, reload: true }, authorityBound: true, storeIdentityVerified: true, note: "24h 后无新增曝光" },
    ],
    outcomes: [{ id: "LMX002-outcome-001", actionId: "ACT-20260719-011", title: "24h 回读：无效点击归零，浪费花费 -$31.40", objectName: "搜索词 wooden latch cheap · phrase", before: "$0.96", after: "已否定", result: "花费 $31.40 → $0", verifiedAt: "2026-07-20T09:05:08+08:00" }],
    keywords: [
      { id: "LMX002-kw-001", keyword: "gate latch outdoor", source: "keyword", campaignName: "LM02-Generic", matchType: "exact", relevance: 0.95, searchVolume: 4800, clicks: 79, orders: 7, acos: 0.245, opportunity: "hold", priority: "medium", selected: true },
      { id: "LMX002-kw-002", keyword: "barn door latch black", source: "user_search_term", campaignName: "LM02-Auto", matchType: "close-match", relevance: 0.9, searchVolume: 3900, clicks: 28, orders: 4, acos: 0.21, opportunity: "promote_exact", priority: "high", selected: false },
      { id: "LMX002-kw-003", keyword: "wood gate latch outdoor", source: "user_search_term", campaignName: "LM02-Generic", matchType: "phrase", relevance: 0.87, searchVolume: 2100, clicks: 19, orders: 2, acos: 0.27, opportunity: "watch", priority: "medium", selected: false },
      { id: "LMX002-kw-004", keyword: "wooden latch cheap", source: "user_search_term", campaignName: "LM02-Generic", matchType: "phrase", relevance: 0.28, searchVolume: 940, clicks: 18, orders: 0, acos: null, opportunity: "negative_phrase", priority: "high", selected: false },
    ],
    listing: { asin: "B0D8W2RC8Q", source: "领星 Listing 快照", fetchedAt: "2026-07-20T07:40:00+08:00", current: { title: "Wooden Gate Latch, Heavy Duty Outdoor Hardware", bullets: ["Weather-resistant steel", "For gates and sheds", "Mounting screws included"], backendTerms: "gate latch barn shed outdoor" }, draft: { id: "LMX002-listing-draft-002", status: "local_draft", title: "Heavy Duty Wooden Gate Latch for Outdoor Gates, Sheds and Barn Doors", bullets: ["Weather-resistant black steel latch for all seasons", "One-hand operation for gates, sheds and garden doors", "Mounting template and hardware included"], backendTerms: "gate latch outdoor barn door black hardware", includedKeywords: ["gate latch outdoor", "barn door latch black"], missingKeywords: ["child proof gate latch"], generatedAt: "2026-07-20T08:54:00+08:00", exportedAt: null, amazonWriteAllowed: false }, history: [{ id: "LMX002-listing-v1", createdAt: "2026-07-17T10:00:00+08:00", note: "美国站英语本地化", status: "exported_local" }] },
    aiRules: { provider: "DeepSeek", model: "deepseek-chat", connectionStatus: "ready", keyStored: true, outputContract: "ad-strategy-diagnosis-v2", temperature: 0.1, thresholds: { minClicksWithoutOrder: 12, targetAcosTolerance: 0.04, highRiskDeltaPercent: 18, minEvidenceRows: 7 }, safety: { requireSourceAuthority: true, requireWritableTarget: true, requireHumanForPause: true, requireReadback: true, allowAutoExecute: false }, updatedAt: "2026-07-20T07:42:00+08:00" },
    scheduler: schedulerFixture("LMX002", "08:20", "08:46"),
    delivery: deliveryFixture("LMX002"),
  },

  NOC003: {
    id: "NOC003",
    name: "ToolPeak 工具",
    storeName: "TP-US",
    marketplace: "美国站",
    marketplaceCode: "US",
    currencyCode: "USD",
    currencySymbol: "$",
    locale: "en-US",
    timeZone: "America/Los_Angeles",
    session: { status: "ready", label: "领星会话正常", checkedAt: "2026-07-20T08:25:00+08:00", profile: "profile-NOC003" },
    connections: { erp: { status: "ready" }, ads: { status: "ready", storeMatched: "verified" } },
    adsIdentity: { status: "verified", storeMatched: true, canonicalObjectReady: true },
    policyAuthority: { status: "enabled", versionLabel: "关键词竞价策略 · 版本 1", selectedProductBound: true, currentValueFresh: true },
    autonomy: { mode: "auto", paused: false, lowRiskLimitPercent: 12, budgetChangeLimitPercent: 15, dailyBudgetCap: 70, executedToday: 2, eligibleToday: 5, budgetImpactToday: 18 },
    scope: { dateFrom: "2026-06-17", dateTo: "2026-07-20", batchId: "batch_NOC003_20260720_0838", selectedProductId: "NOC003-product-NK01", asin: "B0F3Q91L7P", productLabel: "TP-US / B0F3Q91L7P" },
    metrics: { sales: 3274, salesDelta: 0.041, adSpend: 1037.86, orders: 78, acos: 0.317, targetAcos: 0.3, tacos: 0.112, targetTacos: 0.1, cpc: 0.94, cvr: 0.069, anomalies: 3 },
    products: [
      { id: "NOC003-product-NK01", asin: "B0F3Q91L7P", sku: "NK01-SKU", msku: "NK01-M", title: "Heavy Duty Door Latch", stage: "keyword_exploration", status: "active", selected: true, updatedAt: "2026-07-20T08:10:00+08:00", target: { purchaseCost: 12.1, firstLegCost: 1.45, fbaFee: 5.82, referralFeeRate: 0.15, storageFee: 0.36, otherCost: 0.25, currentPrice: 42.99, minPrice: 31.99, targetNetMargin: 0.16, targetAcos: 0.3, targetTacos: 0.1 } },
      { id: "NOC003-product-NK02", asin: "B0F5K20J8M", sku: "NK02-SKU", msku: "NK02-M", title: "Stainless Gate Bolt", stage: "scaling", status: "active", selected: false, updatedAt: "2026-07-19T10:10:00+08:00", target: { purchaseCost: 10.7, firstLegCost: 1.3, fbaFee: 5.41, referralFeeRate: 0.15, storageFee: 0.32, otherCost: 0.22, currentPrice: 39.99, minPrice: 29.99, targetNetMargin: 0.18, targetAcos: 0.27, targetTacos: 0.09 } },
      { id: "NOC003-product-NK03", asin: "B0F7M62Q3R", sku: "NK03-SKU", msku: "NK03-M", title: "Shed Door Locking Bar", stage: "launch", status: "watch", selected: false, updatedAt: "2026-07-18T15:40:00+08:00", target: { purchaseCost: 14.3, firstLegCost: 1.7, fbaFee: 6.2, referralFeeRate: 0.15, storageFee: 0.41, otherCost: 0.28, currentPrice: 48.99, minPrice: 36.99, targetNetMargin: 0.12, targetAcos: 0.38, targetTacos: 0.15 } },
    ],
    events: [
      { id: "NOC003-event-001", occurredAt: "2026-07-16T09:20:00+08:00", type: "listing_change", title: "主图加入尺寸标注", description: "预计降低不匹配点击", productId: "NOC003-product-NK01", impact: "positive", aiContext: true },
      { id: "NOC003-event-002", occurredAt: "2026-07-18T08:00:00+08:00", type: "competitor", title: "核心竞品降价 $3", description: "商品投放 CPC 与 CVR 可能波动", productId: "NOC003-product-NK01", impact: "material", aiContext: true },
      { id: "NOC003-event-003", occurredAt: "2026-07-20T08:38:00+08:00", type: "data_gap", title: "广告位报告仍在生成", description: "7/8 报表可分析，广告位拆分暂不可用", productId: "NOC003-product-NK01", impact: "warning", aiContext: true },
    ],
    reports: createReports("NOC003", "2026-06-17", "2026-07-20"),
    importRun: { id: "NOC003-import-20260720", status: "partial", reportTypesImported: 7, reportTypesExpected: 8, importedRows: 5106, rejectedRows: 3, duplicateRows: 7, sourceFiles: 7, startedAt: "2026-07-20T08:39:00+08:00", completedAt: "2026-07-20T08:46:00+08:00", metricGrain: "user_search_term", reconciliation: "warning" },
    diagnostics: [
      { id: "NOC003-diag-001", objectKey: "NOC003|B0F3Q91L7P|Broad-Core|heavy duty door latch", objectType: "keyword", objectName: "heavy duty door latch", campaignName: "NK01-Broad", adGroupName: "Broad-Core", matchType: "broad", impressions: 11600, clicks: 41, spend: 96, sales: 0, orders: 0, acos: null, cpc: 2.341, cvr: 0, severity: "high", quantStatus: "waste", lifecycleStage: "testing", diagnosis: "过去 14 天高花费无订单", recommendedAction: "暂停投放", suggestedValue: "paused" },
      { id: "NOC003-diag-002", objectKey: "NOC003|B0F3Q91L7P|Product-Core|B0C8V4M1RX", objectType: "product_targeting", objectName: "ASIN B0C8V4M1RX", campaignName: "NK01-Product", adGroupName: "Product-Core", impressions: 9340, clicks: 67, spend: 61.64, sales: 171.96, orders: 4, acos: 0.358, cpc: 0.92, cvr: 0.0597, severity: "medium", quantStatus: "watch", lifecycleStage: "testing", diagnosis: "竞品位转化下降且点击成本升高", recommendedAction: "竞价下调", suggestedValue: 0.84 },
      { id: "NOC003-diag-003", objectKey: "NOC003|B0F3Q91L7P|Exact-Core|shed door latch", objectType: "keyword", objectName: "shed door latch", campaignName: "NK01-Exact", adGroupName: "Exact-Core", matchType: "exact", impressions: 7400, clicks: 83, spend: 69.72, sales: 343.92, orders: 8, acos: 0.203, cpc: 0.84, cvr: 0.0964, severity: "low", quantStatus: "healthy", lifecycleStage: "scaling", diagnosis: "低于目标 ACOS 且订单稳定", recommendedAction: "竞价小幅上调", suggestedValue: 0.89 },
      { id: "NOC003-diag-004", objectKey: "NOC003|B0F3Q91L7P|Auto|loose-match", objectType: "auto_targeting", objectName: "loose-match", campaignName: "NK01-Auto", adGroupName: "Auto", impressions: 17100, clicks: 154, spend: 147.84, sales: 386.91, orders: 9, acos: 0.382, cpc: 0.96, cvr: 0.0584, severity: "medium", quantStatus: "watch", lifecycleStage: "testing", diagnosis: "ACOS 高于目标且搜索词分散", recommendedAction: "收紧竞价", suggestedValue: 0.86 },
    ],
    recommendations: [
      { id: "REC-20260720-026", actionId: "ACT-20260720-026", revision: 1, status: "pending_approval", risk: "high", title: "高花费词暂停投放", entityType: "keyword", objectName: "关键词 heavy duty door latch · broad", campaignName: "NK01-Broad", adGroupName: "Broad-Core", actionType: "pause", currentValue: "启用", recommendedValue: "暂停", recalculatedValue: "竞价 $0.72", unit: "state", deltaPercent: -100, requiresApproval: true, reason: "过去 14 天花费 $96 无订单，但暂停属于不可自动恢复的高影响动作。", evidence: ["41 点击 / 0 订单", "14 天花费 $96", "自然排名未进入前 50"], authority: { batchId: "batch_NOC003_20260720_0838", reportType: "keyword", diagnosticId: "NOC003-diag-001", model: "ad-strategy-v2.1" }, policy: { id: "POL-NOC003-v6", boundary: "暂停投放始终需要人工审批", eligible: false, blocker: "等待审批" }, createdAt: "2026-07-20T08:50:50+08:00" },
      { id: "REC-20260720-024", actionId: "ACT-20260720-024", revision: 1, status: "executed", risk: "low", title: "商品投放竞价下调", entityType: "product_targeting", objectName: "ASIN B0C8V4M1RX · product targeting", campaignName: "NK01-Product", adGroupName: "Product-Core", actionType: "bid_change", currentValue: 0.92, recommendedValue: 0.84, unit: "currency", deltaPercent: -8.7, requiresApproval: false, reason: "竞品位转化下降且点击成本升高，调整仍在店铺自动边界内。", evidence: ["CPC +13%", "CVR -6%", "目标竞价区间 $0.80–$0.86"], authority: { batchId: "batch_NOC003_20260720_0838", reportType: "product_targeting", diagnosticId: "NOC003-diag-002", model: "ad-strategy-v2.1" }, policy: { id: "POL-NOC003-v6", boundary: "商品投放竞价单次变更 ±12%", eligible: true, blocker: null }, createdAt: "2026-07-20T08:49:50+08:00" },
      { id: "REC-20260720-025", actionId: null, revision: 1, status: "pending_review", risk: "medium", title: "loose-match 竞价下调", entityType: "auto_targeting", objectName: "loose-match", campaignName: "NK01-Auto", adGroupName: "Auto", actionType: "bid_change", currentValue: 0.96, recommendedValue: 0.86, unit: "currency", deltaPercent: -10.4, requiresApproval: false, reason: "ACOS 高于目标，搜索词分散。", evidence: ["ACOS 38.2%", "目标 30%", "搜索词集中度 41%"], authority: { batchId: "batch_NOC003_20260720_0838", reportType: "auto_targeting", diagnosticId: "NOC003-diag-004", model: "ad-strategy-v2.1" }, policy: { id: "POL-NOC003-v6", boundary: "自动投放竞价 ±12%", eligible: true, blocker: null }, createdAt: "2026-07-20T08:50:20+08:00" },
      { id: "REC-20260719-020", actionId: null, revision: 2, status: "superseded", risk: "medium", title: "shed door latch 提价", entityType: "keyword", objectName: "shed door latch", campaignName: "NK01-Exact", adGroupName: "Exact-Core", actionType: "bid_change", currentValue: 0.84, recommendedValue: 0.94, unit: "currency", deltaPercent: 11.9, requiresApproval: false, reason: "已被包含竞品降价事件的新版本替代。", evidence: ["旧批次建议"], authority: { batchId: "batch_NOC003_20260719_0838", reportType: "keyword", diagnosticId: null, model: "ad-strategy-v2.0" }, policy: { id: "POL-NOC003-v5", boundary: "关键词竞价 ±12%", eligible: false, blocker: "版本已过期" }, createdAt: "2026-07-19T08:50:00+08:00" },
    ],
    executionQueue: [
      { id: "ACT-20260720-024", recommendationId: "REC-20260720-024", status: "awaiting_readback", mode: "auto", permission: "policy", target: "ASIN B0C8V4M1RX", entityType: "product_targeting", beforeValue: 0.92, intendedValue: 0.84, observedValue: 0.84, unit: "currency", queuedAt: "2026-07-20T09:00:00+08:00", startedAt: "2026-07-20T09:04:20+08:00", savedAt: "2026-07-20T09:04:49+08:00", browserProfile: "profile-NOC003", storeIdentityVerified: true },
      { id: "ACT-20260720-026", recommendationId: "REC-20260720-026", status: "waiting_permission", mode: "review", permission: null, target: "heavy duty door latch · broad", entityType: "keyword", beforeValue: "启用", intendedValue: "暂停", observedValue: "启用", unit: "state", queuedAt: null, startedAt: null, savedAt: null, browserProfile: "profile-NOC003", storeIdentityVerified: true },
    ],
    readbacks: [
      { id: "NOC003-readback-024", actionId: "ACT-20260720-024", recommendationId: "REC-20260720-024", status: "waiting", requiredAt: "2026-07-20T09:14:49+08:00", checkedAt: null, beforeValue: 0.92, savedValue: 0.84, reloadValue: null, screenshots: { before: true, after: true, reload: false }, authorityBound: true, storeIdentityVerified: true, note: "等待页面重载确认" },
      { id: "NOC003-readback-history-001", actionId: "ACT-20260719-018", recommendationId: "REC-20260719-018", status: "verified", requiredAt: "2026-07-19T09:18:00+08:00", checkedAt: "2026-07-19T09:18:12+08:00", beforeValue: 1.04, savedValue: 0.92, reloadValue: 0.92, screenshots: { before: true, after: true, reload: true }, authorityBound: true, storeIdentityVerified: true, note: "24h ACOS -2.4pct，订单 +1" },
    ],
    outcomes: [{ id: "NOC003-outcome-001", actionId: "ACT-20260719-018", title: "24h 回读：ACOS -2.4pct，订单 +1", objectName: "ASIN B0C8V4M1RX · product targeting", before: "$0.92", after: "$0.84", result: "花费 $41.70 → $37.10", verifiedAt: "2026-07-20T09:12:00+08:00" }],
    keywords: [
      { id: "NOC003-kw-001", keyword: "shed door latch", source: "keyword", campaignName: "NK01-Exact", matchType: "exact", relevance: 0.96, searchVolume: 5200, clicks: 83, orders: 8, acos: 0.203, opportunity: "bid_up", priority: "high", selected: true },
      { id: "NOC003-kw-002", keyword: "heavy duty gate latch", source: "user_search_term", campaignName: "NK01-Auto", matchType: "close-match", relevance: 0.91, searchVolume: 6200, clicks: 46, orders: 5, acos: 0.264, opportunity: "promote_exact", priority: "high", selected: false },
      { id: "NOC003-kw-003", keyword: "door latch heavy duty", source: "keyword", campaignName: "NK01-Broad", matchType: "broad", relevance: 0.78, searchVolume: 7100, clicks: 41, orders: 0, acos: null, opportunity: "pause", priority: "high", selected: false },
      { id: "NOC003-kw-004", keyword: "shed lock bar", source: "user_search_term", campaignName: "NK01-Product", matchType: "product", relevance: 0.82, searchVolume: 2700, clicks: 17, orders: 2, acos: 0.302, opportunity: "watch", priority: "medium", selected: false },
    ],
    listing: { asin: "B0F3Q91L7P", source: "领星 Listing 快照", fetchedAt: "2026-07-20T08:00:00+08:00", current: { title: "Heavy Duty Door Latch for Sheds and Gates", bullets: ["Thick steel construction", "Outdoor powder coating", "Fixings included"], backendTerms: "shed gate door latch heavy duty" }, draft: { id: "NOC003-listing-draft-003", status: "local_draft", title: "Heavy Duty Door Latch for Sheds, Gates and Barn Doors, Weather-Resistant Steel", bullets: ["Heavy-gauge steel latch for sheds, gates and outdoor storage", "Powder-coated finish tested for all-season outdoor use", "Includes fitting template, screws and installation notes"], backendTerms: "shed door latch gate bolt barn lock heavy duty", includedKeywords: ["shed door latch", "heavy duty gate latch"], missingKeywords: ["garden gate security latch"], generatedAt: "2026-07-20T08:56:00+08:00", exportedAt: null, amazonWriteAllowed: false }, history: [{ id: "NOC003-listing-v2", createdAt: "2026-07-16T09:30:00+08:00", note: "补充美国站表达与尺寸", status: "exported_local" }] },
    aiRules: { provider: "DeepSeek", model: "deepseek-chat", connectionStatus: "ready", keyStored: true, outputContract: "ad-strategy-diagnosis-v2", temperature: 0.1, thresholds: { minClicksWithoutOrder: 14, targetAcosTolerance: 0.05, highRiskDeltaPercent: 15, minEvidenceRows: 7 }, safety: { requireSourceAuthority: true, requireWritableTarget: true, requireHumanForPause: true, requireReadback: true, allowAutoExecute: true }, updatedAt: "2026-07-20T07:52:00+08:00" },
    scheduler: schedulerFixture("NOC003", "08:25", "08:47"),
    delivery: deliveryFixture("NOC003"),
  },
};

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

export const STORE_FIXTURES = deepFreeze(stores);
export const STORE_IDS = deepFreeze(Object.keys(STORE_FIXTURES));
export const STORE_SUMMARIES = deepFreeze(STORE_IDS.map((id) => {
  const store = STORE_FIXTURES[id];
  return {
    id: store.id,
    name: store.name,
    storeName: store.storeName,
    marketplace: store.marketplace,
    marketplaceCode: store.marketplaceCode,
    currencyCode: store.currencyCode,
    currencySymbol: store.currencySymbol,
    session: store.session,
    productLabel: store.scope.productLabel,
  };
}));

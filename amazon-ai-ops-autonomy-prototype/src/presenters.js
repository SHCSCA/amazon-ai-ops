import {
  formatActionValue,
  formatMoney,
  formatPercent,
  getCurrentProduct,
  getExecutionCounts,
  getRecommendationCounts,
  getReportCoverage,
} from "./model.js";

function sessionTone(status) {
  return status === "ready" ? "success" : status === "warning" || status === "expired" ? "warning" : "danger";
}

function productStatus(status) {
  return status === "active" ? "在售" : status === "watch" ? "观察" : status === "paused" ? "已暂停" : "待确认";
}

function riskLabel(risk) {
  return risk === "high" || risk === "critical" ? "高影响" : risk === "medium" ? "中风险" : "低风险";
}

function recommendationState(status, eligible) {
  if (status === "pending_review") return eligible ? "可自动" : "待判断";
  if (status === "pending_approval") return "待审批";
  if (status === "approved") return "许可已签发";
  if (status === "rejected") return "已驳回";
  if (status === "executed") return "已决定";
  return "已过期";
}

function decisionLabel(status) {
  if (status === "rejected") return "驳回";
  return "批准";
}

function executionLabel(status) {
  return {
    waiting_permission: "等待审批",
    queued: "等待可见浏览器",
    running: "执行中",
    awaiting_readback: "等待回读",
    verified: "已回读",
    blocked_session: "会话阻断",
    failed: "执行失败",
    cancelled: "已终止",
  }[status] || status;
}

function reportStatus(status) {
  return status === "imported" || status === "downloaded" ? "已校验" : status === "missing" ? "待下载" : "采集中";
}

function opportunityLabel(value) {
  return {
    promote_exact: "待纳入",
    bid_up: "已投放",
    pause: "排除",
    watch: "待纳入",
    listing: "待纳入",
  }[value] || "已覆盖";
}

function intentLabel(priority) {
  return priority === "high" ? "强购买" : priority === "medium" ? "品类" : "场景";
}

export function buildWorkspacePresenter(rawStore) {
  const product = getCurrentProduct(rawStore);
  const coverage = getReportCoverage(rawStore);
  const recommendationCounts = getRecommendationCounts(rawStore);
  const executionCounts = getExecutionCounts(rawStore);
  const products = rawStore.products.map((item) => ({
    ...item,
    name: item.title,
    status: productStatus(item.status),
    price: formatMoney(item.target.currentPrice, rawStore),
    targetAcos: formatPercent(item.target.targetAcos),
    targetTacos: formatPercent(item.target.targetTacos),
    margin: formatPercent(item.target.targetNetMargin),
  }));
  const events = rawStore.events.map((item) => ({
    ...item,
    at: item.occurredAt.slice(0, 16).replace("T", " "),
    type: item.type.replaceAll("_", " "),
    scope: rawStore.products.find((entry) => entry.id === item.productId)?.asin || "全店",
    impact: item.description,
    context: item.aiContext ? "已进入诊断" : "仅记录",
  }));
  const reports = rawStore.reports.map((item) => ({
    ...item,
    name: item.label,
    window: `${rawStore.scope.dateFrom} → ${rawStore.scope.dateTo}`,
    status: reportStatus(item.status),
    rows: item.importedRows ? item.importedRows.toLocaleString("en-US") : "—",
    updated: item.importedAt ? item.importedAt.slice(11, 16) : "等待领星会话",
  }));
  const diagnoses = rawStore.diagnostics.map((item) => ({
    ...item,
    severity: item.severity === "high" ? "高" : item.severity === "medium" ? "中" : "低",
    object: item.objectName,
    signal: item.diagnosis,
    spend: formatMoney(item.spend, rawStore),
    acos: item.acos === null ? "无订单" : formatPercent(item.acos),
    target: formatPercent(rawStore.metrics.targetAcos),
    delta: item.acos === null ? "止损" : formatPercent(item.acos - rawStore.metrics.targetAcos, { signed: true }),
    confidence: item.severity === "high" ? "94%" : item.severity === "medium" ? "86%" : "79%",
  }));
  const recommendations = rawStore.recommendations.map((item) => ({
    ...item,
    risk: riskLabel(item.risk),
    action: item.title,
    object: item.objectName,
    before: formatActionValue(item.currentValue, item.unit, rawStore),
    after: formatActionValue(item.recommendedValue, item.unit, rawStore),
    delta: `${Number(item.deltaPercent) > 0 ? "+" : ""}${item.deltaPercent}%`,
    state: recommendationState(item.status, item.policy?.eligible),
    owner: item.requiresApproval ? "运营负责人" : "AI 策略",
  }));
  const decisions = rawStore.recommendations
    .filter((item) => ["approved", "rejected", "executed"].includes(item.status))
    .map((item, index) => ({
      id: `DEC-${item.id.replace("REC-", "")}`,
      recommendationId: item.id,
      at: (item.decidedAt || item.createdAt).slice(11, 16),
      decision: decisionLabel(item.status),
      action: `${item.title} · rev ${item.revision}`,
      actor: item.requiresApproval ? "WZ · 人工" : "AI 自动边界",
      license: item.status === "rejected" ? "—" : `LIC-${String(340 + index).padStart(4, "0")}`,
      execution: item.status === "executed" ? "已回读" : item.status === "approved" ? "排队中" : "已终止",
    }));
  const executionQueue = rawStore.executionQueue.map((item, index) => ({
    ...item,
    position: index + 1,
    object: item.target,
    action: `${formatActionValue(item.beforeValue, item.unit, rawStore)} → ${formatActionValue(item.intendedValue, item.unit, rawStore)}`,
    source: item.recommendationId,
    state: executionLabel(item.status),
    gate: ["queued", "running", "awaiting_readback", "verified"].includes(item.status) ? "许可已签发" : "缺少人工许可",
    from: formatActionValue(item.beforeValue, item.unit, rawStore),
    to: formatActionValue(item.intendedValue, item.unit, rawStore),
  }));
  const readbacks = rawStore.readbacks.map((item) => ({ ...item, state: item.status === "verified" ? "已回读" : "等待回读" }));
  const keywords = rawStore.keywords.map((item) => ({
    ...item,
    source: item.source.replaceAll("_", " "),
    intent: intentLabel(item.priority),
    volume: Number(item.searchVolume || 0).toLocaleString("en-US"),
    rank: item.rank || "—",
    orders: item.orders || 0,
    acos: item.acos === null || item.acos === undefined ? "—" : formatPercent(item.acos),
    state: opportunityLabel(item.opportunity),
  }));
  const schedules = rawStore.scheduler.map((item) => ({
    ...item,
    task: item.name,
    cadence: item.cron,
    next: item.nextRun,
    last: `${item.lastRun} · ${item.lastStatus === "success" ? "成功" : item.lastStatus === "waiting" ? "等待" : "失败"}`,
  }));
  const waitingReadback = rawStore.readbacks.find((item) => item.status !== "verified") || rawStore.readbacks[0];
  const readbackAction = executionQueue.find((item) => item.id === waitingReadback?.actionId) || executionQueue[0];
  const readbackRecommendation = rawStore.recommendations.find((item) => item.id === waitingReadback?.recommendationId);
  const action = readbackAction ? {
    id: readbackAction.id,
    recommendationId: readbackAction.recommendationId,
    object: readbackAction.object,
    from: readbackAction.from,
    to: readbackAction.to,
    revision: readbackRecommendation?.revision || 1,
  } : null;

  const store = {
    ...rawStore,
    storeId: rawStore.id,
    session: rawStore.session.label,
    sessionTone: sessionTone(rawStore.session.status),
    browserProfileId: rawStore.session.profile,
    product: product ? `${product.sku} / ${product.asin}` : "全部产品",
    asin: product?.asin,
    sales: formatMoney(rawStore.metrics.sales, rawStore),
    salesDelta: formatPercent(rawStore.metrics.salesDelta, { signed: true }),
    acos: formatPercent(rawStore.metrics.acos),
    target: formatPercent(rawStore.metrics.targetAcos),
    anomalies: rawStore.metrics.anomalies,
    reports: `${coverage.available}/${coverage.expected}`,
    rows: coverage.importedRows.toLocaleString("en-US"),
    diagnosedKeywords: rawStore.diagnostics.length,
    mode: rawStore.mode || rawStore.autonomy.mode,
    autoCount: `${rawStore.autonomy.executedToday}/${rawStore.autonomy.eligibleToday}`,
    budgetImpact: `${formatMoney(rawStore.autonomy.budgetImpactToday, rawStore)} / ${formatMoney(rawStore.autonomy.dailyBudgetCap, rawStore)}`,
    currency: rawStore.currencySymbol,
    actionSummary: {
      total: rawStore.recommendations.length,
      automatic: recommendationCounts.autoEligible,
      approval: recommendationCounts.pendingApproval,
    },
    action: { readback: action },
  };

  const state = {
    ...rawStore,
    products,
    events,
    reports,
    diagnoses,
    recommendations,
    decisions,
    executionQueue,
    readbacks,
    keywords,
    schedules,
    listingDraft: rawStore.listing?.draft,
    settings: {
      provider: rawStore.aiRules?.provider,
      model: rawStore.aiRules?.model,
      temperature: rawStore.aiRules?.temperature,
      maxBidChange: rawStore.autonomy?.lowRiskLimitPercent,
      maxBudgetChange: rawStore.autonomy?.budgetChangeLimitPercent,
    },
    readbackVerified: rawStore.readbacks.some((item) => item.status === "verified"),
    actionSummary: store.actionSummary,
    executionCounts,
  };

  return { store, state, product, action };
}

export function buildInspectorRecord(record, store) {
  if (!record) return null;
  const evidence = record.evidence || [record.signal, record.reason, record.detail].filter(Boolean);
  const status = record.state || record.status || record.result || record.risk || "已载入";
  return {
    ...record,
    title: record.action || record.title || record.object || record.name || record.keyword || record.task,
    object: record.object || record.objectName || record.keyword || record.scope,
    before: record.before || record.currentValue,
    after: record.after || record.recommendedValue,
    reason: record.reason || record.signal || record.detail || record.impact,
    evidence,
    status,
    tone: /高|阻断|失败|驳回/.test(String(status)) ? "danger" : /等待|待|观察|警告/.test(String(status)) ? "warning" : /通过|成功|已|正常/.test(String(status)) ? "success" : "neutral",
    storeId: store.id,
    asin: store.asin,
    batchId: store.scope?.batchId,
    revision: record.revision ? `rev ${record.revision}` : undefined,
  };
}

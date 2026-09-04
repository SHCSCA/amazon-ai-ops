import {
  DEFAULT_STORE_ID,
  PROTOTYPE_NOW,
  REPORT_TYPE_REGISTRY,
  STORE_FIXTURES,
  STORE_IDS,
  SUBVIEW_REGISTRY,
  WORKSPACE_REGISTRY,
} from "./mockData.js";

const terminalRecommendationStatuses = new Set(["approved", "rejected", "executed", "superseded"]);
const recommendationTransitions = {
  pending_review: new Set(["pending_approval", "rejected", "superseded"]),
  pending_approval: new Set(["approved", "rejected", "superseded"]),
  approved: new Set(["executed"]),
  rejected: new Set(),
  executed: new Set(),
  superseded: new Set(),
};

const riskRank = { critical: 0, high: 1, medium: 2, low: 3 };
const legacyRouteIntents = Object.fromEntries(
  SUBVIEW_REGISTRY.map((subview) => [subview.legacyRoute, { workspace: subview.workspace, subview: subview.id }]),
);
legacyRouteIntents.approval = { workspace: "decisions", subview: "approval" };

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
}

function mergeRecord(base, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return base;
  return { ...base, ...patch };
}

function storeData(input) {
  if (typeof input === "string") return getStoreFixture(input);
  if (!input || typeof input !== "object") throw new TypeError("必须提供店铺 ID、fixture 或店铺状态");
  if (!isStoreId(input.id || input.storeId)) throw new RangeError(`未知店铺：${input.id || input.storeId || "empty"}`);
  return input;
}

function stateValue(store, state, key, fallback) {
  if (state && Object.prototype.hasOwnProperty.call(state, key)) return state[key];
  if (Object.prototype.hasOwnProperty.call(store, key)) return store[key];
  return fallback;
}

function statusTone(status) {
  if (["validated", "imported", "ready", "success", "approved", "executed", "verified", "passed", "healthy"].includes(status)) return "success";
  if (["missing", "partial", "warning", "pending_review", "pending_approval", "waiting", "awaiting_readback", "waiting_permission", "blocked", "blocked_session"].includes(status)) return "warning";
  if (["failed", "error", "critical"].includes(status)) return "danger";
  return "neutral";
}

function recommendationStatusLabel(status) {
  return {
    pending_review: "待判断",
    pending_approval: "待审批",
    approved: "许可已签发",
    rejected: "已拒绝",
    executed: "已执行",
    superseded: "已被新版本替代",
  }[status] || status;
}

function executionStatusLabel(status) {
  return {
    waiting_permission: "等待执行许可",
    queued: "已进入执行队列",
    running: "可见浏览器执行中",
    awaiting_readback: "已保存，等待回读",
    verified: "执行与回读已验证",
    blocked_session: "会话阻断",
    failed: "执行失败",
  }[status] || status;
}

function readbackStatusLabel(status) {
  return {
    waiting: "等待页面重载",
    verified: "回读已验证",
    failed: "回读不一致",
  }[status] || status;
}

function sortByRiskAndTime(left, right) {
  const riskDifference = (riskRank[left.risk] ?? 9) - (riskRank[right.risk] ?? 9);
  if (riskDifference !== 0) return riskDifference;
  return String(right.createdAt || "").localeCompare(String(left.createdAt || ""));
}

function deriveDecisionArrays(store) {
  return {
    recommendations: store.recommendations.filter((item) => item.status === "pending_review").sort(sortByRiskAndTime),
    approval: store.recommendations.filter((item) => item.status === "pending_approval").sort(sortByRiskAndTime),
    decided: store.recommendations.filter((item) => terminalRecommendationStatuses.has(item.status)).sort((left, right) => String(right.decidedAt || right.createdAt).localeCompare(String(left.decidedAt || left.createdAt))),
  };
}

export function isStoreId(value) {
  return typeof value === "string" && STORE_IDS.includes(value);
}

export function getStoreFixture(storeId = DEFAULT_STORE_ID) {
  if (!isStoreId(storeId)) throw new RangeError(`未知店铺：${String(storeId)}`);
  return STORE_FIXTURES[storeId];
}

export function cloneStoreFixture(storeId = DEFAULT_STORE_ID) {
  return cloneValue(getStoreFixture(storeId));
}

export function createInitialStoreState(storeId = DEFAULT_STORE_ID) {
  const fixture = cloneStoreFixture(storeId);
  const decisions = deriveDecisionArrays(fixture);
  const selectedRecommendation = decisions.approval[0] || decisions.recommendations[0] || decisions.decided[0] || null;
  const selectedExecution = fixture.executionQueue.find((item) => item.status !== "verified") || fixture.executionQueue[0] || null;
  return {
    ...fixture,
    storeId: fixture.id,
    mode: fixture.autonomy.mode,
    paused: fixture.autonomy.paused,
    selectedProductId: fixture.scope.selectedProductId,
    selectedRecommendationId: selectedRecommendation?.id || null,
    selectedExecutionId: selectedExecution?.id || null,
    selectedKeywordId: fixture.keywords.find((item) => item.selected)?.id || fixture.keywords[0]?.id || null,
    approvedRecommendationIds: fixture.recommendations.filter((item) => item.status === "approved" || item.status === "executed").map((item) => item.id),
    readbackVerifiedIds: fixture.readbacks.filter((item) => item.status === "verified").map((item) => item.id),
    filters: {
      ledgerKind: "all",
      ledgerPendingOnly: false,
      decisionRisk: "all",
      diagnosisSeverity: "all",
      keywordOpportunity: "all",
    },
    ui: {
      inspectorOpen: true,
      selectedLedgerId: null,
      query: "",
      queryResponse: "",
      busyAction: null,
      toast: null,
    },
    stateRevision: 1,
    updatedAt: PROTOTYPE_NOW,
  };
}

export function createInitialAppState(activeStoreId = DEFAULT_STORE_ID) {
  if (!isStoreId(activeStoreId)) throw new RangeError(`未知店铺：${String(activeStoreId)}`);
  return {
    activeStoreId,
    navigation: { workspace: "today", subview: "overview" },
    stores: Object.fromEntries(STORE_IDS.map((storeId) => [storeId, createInitialStoreState(storeId)])),
    commandPaletteOpen: false,
    appRevision: 1,
  };
}

export function updateStoreState(appState, storeId, updater) {
  if (!appState?.stores || !isStoreId(storeId) || !appState.stores[storeId]) throw new RangeError(`无法更新店铺：${String(storeId)}`);
  const current = appState.stores[storeId];
  const patch = typeof updater === "function" ? updater(current) : updater;
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new TypeError("店铺更新必须返回对象 patch");
  return {
    ...appState,
    stores: {
      ...appState.stores,
      [storeId]: {
        ...current,
        ...cloneValue(patch),
        storeId,
        id: storeId,
        stateRevision: Number(current.stateRevision || 0) + 1,
        updatedAt: patch.updatedAt || PROTOTYPE_NOW,
      },
    },
    appRevision: Number(appState.appRevision || 0) + 1,
  };
}

export function selectStore(appState, storeId) {
  if (!appState?.stores?.[storeId]) throw new RangeError(`未知店铺：${String(storeId)}`);
  return {
    ...appState,
    activeStoreId: storeId,
    navigation: { workspace: "today", subview: "overview" },
    appRevision: Number(appState.appRevision || 0) + 1,
  };
}

export function getActiveStoreState(appState) {
  if (!appState?.stores?.[appState.activeStoreId]) throw new RangeError("应用状态缺少当前店铺");
  return appState.stores[appState.activeStoreId];
}

export function getWorkspaceDefinition(workspaceId) {
  return WORKSPACE_REGISTRY.find((workspace) => workspace.id === workspaceId) || null;
}

export function getSubviewDefinition(workspaceId, subviewId) {
  return SUBVIEW_REGISTRY.find((subview) => subview.workspace === workspaceId && subview.id === subviewId) || null;
}

export function isNavigationIntent(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && getSubviewDefinition(value.workspace, value.subview));
}

export function resolveNavigationTarget(target) {
  if (isNavigationIntent(target)) return { workspace: target.workspace, subview: target.subview };
  if (typeof target !== "string") return null;
  if (target.includes(":")) {
    const [workspace, subview] = target.split(":");
    return getSubviewDefinition(workspace, subview) ? { workspace, subview } : null;
  }
  if (legacyRouteIntents[target]) return { ...legacyRouteIntents[target] };
  const workspace = getWorkspaceDefinition(target);
  return workspace ? { workspace: workspace.id, subview: workspace.defaultSubview } : null;
}

export function navigationIntentKey(intent) {
  return isNavigationIntent(intent) ? `${intent.workspace}:${intent.subview}` : null;
}

export function navigationNeedsGlobalHandoff(current, target) {
  return Boolean(isNavigationIntent(current) && isNavigationIntent(target) && current.workspace !== target.workspace);
}

export function formatMoney(value, storeInput = DEFAULT_STORE_ID, options = {}) {
  const store = storeData(storeInput);
  const amount = Number(value);
  if (!Number.isFinite(amount)) return `${store.currencySymbol}—`;
  const digits = options.maximumFractionDigits ?? (Number.isInteger(amount) ? 0 : 2);
  const absolute = Math.abs(amount).toLocaleString(store.locale, { minimumFractionDigits: options.minimumFractionDigits ?? 0, maximumFractionDigits: digits });
  const prefix = options.signed && amount > 0 ? "+" : amount < 0 ? "-" : "";
  return `${prefix}${store.currencySymbol}${absolute}`;
}

export function formatPercent(value, options = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  const percentage = options.alreadyPercent ? number : number * 100;
  const signed = options.signed && percentage > 0 ? "+" : "";
  return `${signed}${percentage.toFixed(options.fractionDigits ?? 1).replace(/\.0$/, "")}%`;
}

export function formatActionValue(value, unit, storeInput) {
  if (unit === "currency") return formatMoney(value, storeInput, { maximumFractionDigits: 2 });
  if (unit === "percent") return formatPercent(value);
  return String(value ?? "—");
}

export function getCurrentProduct(storeInput) {
  const store = storeData(storeInput);
  const selectedProductId = store.selectedProductId || store.scope.selectedProductId;
  return store.products.find((product) => product.id === selectedProductId) || store.products[0] || null;
}

export function getReportCoverage(storeInput) {
  const store = storeData(storeInput);
  const expected = REPORT_TYPE_REGISTRY.length;
  const available = store.reports.filter((report) => report.realFileAvailable).length;
  const imported = store.reports.filter((report) => report.status === "imported").length;
  const importedRows = store.reports.reduce((total, report) => total + Number(report.importedRows || 0), 0);
  const missing = store.reports.filter((report) => !report.realFileAvailable).map((report) => report.type);
  return {
    expected,
    available,
    imported,
    importedRows,
    missing,
    filesComplete: available === expected,
    importComplete: imported === expected,
    label: `${available}/${expected} 类真实报表`,
    importLabel: `${imported}/${expected} 类 · ${importedRows.toLocaleString("en-US")} 行`,
    status: imported === expected ? "ready" : available === 0 ? "missing" : "partial",
  };
}

export function getRecommendationCounts(storeInput) {
  const store = storeData(storeInput);
  const counts = {
    total: store.recommendations.length,
    pendingReview: 0,
    pendingApproval: 0,
    approved: 0,
    rejected: 0,
    executed: 0,
    superseded: 0,
    highRisk: 0,
    autoEligible: 0,
  };
  store.recommendations.forEach((item) => {
    if (item.status === "pending_review") counts.pendingReview += 1;
    if (item.status === "pending_approval") counts.pendingApproval += 1;
    if (item.status === "approved") counts.approved += 1;
    if (item.status === "rejected") counts.rejected += 1;
    if (item.status === "executed") counts.executed += 1;
    if (item.status === "superseded") counts.superseded += 1;
    if (item.risk === "high" || item.risk === "critical") counts.highRisk += 1;
    if (item.policy?.eligible) counts.autoEligible += 1;
  });
  counts.actionable = counts.pendingReview + counts.pendingApproval;
  return counts;
}

export function getExecutionCounts(storeInput) {
  const store = storeData(storeInput);
  const counts = { total: store.executionQueue.length, waitingPermission: 0, queued: 0, running: 0, awaitingReadback: 0, verified: 0, blocked: 0, failed: 0 };
  store.executionQueue.forEach((item) => {
    if (item.status === "waiting_permission") counts.waitingPermission += 1;
    if (item.status === "queued") counts.queued += 1;
    if (item.status === "running") counts.running += 1;
    if (item.status === "awaiting_readback") counts.awaitingReadback += 1;
    if (item.status === "verified") counts.verified += 1;
    if (item.status === "blocked_session") counts.blocked += 1;
    if (item.status === "failed") counts.failed += 1;
  });
  counts.pending = counts.waitingPermission + counts.queued + counts.running + counts.awaitingReadback + counts.blocked + counts.failed;
  return counts;
}

export function getReadbackCounts(storeInput) {
  const store = storeData(storeInput);
  return store.readbacks.reduce((counts, item) => {
    counts.total += 1;
    if (item.status === "verified") counts.verified += 1;
    if (item.status === "waiting") counts.waiting += 1;
    if (item.status === "failed") counts.failed += 1;
    return counts;
  }, { total: 0, verified: 0, waiting: 0, failed: 0 });
}

export function getWorkspaceBadgeCounts(storeInput) {
  const store = storeData(storeInput);
  const reports = getReportCoverage(store);
  const recommendations = getRecommendationCounts(store);
  const execution = getExecutionCounts(store);
  const readbacks = getReadbackCounts(store);
  const schedulerIssues = store.scheduler.filter((item) => item.lastStatus === "failed" || item.lastStatus === "waiting").length;
  const deliveryBlocked = store.delivery.gates.filter((gate) => gate.status !== "passed").length;
  return {
    today: store.metrics.anomalies + recommendations.actionable + readbacks.waiting,
    product: store.events.filter((event) => event.impact === "blocking" || event.impact === "material" || event.impact === "warning").length,
    "data-preparation": reports.missing.length,
    diagnosis: store.diagnostics.filter((item) => item.severity === "high" || item.severity === "critical").length,
    decisions: recommendations.actionable,
    readback: readbacks.waiting + readbacks.failed,
    growth: store.keywords.filter((item) => item.priority === "high" && !item.selected).length,
    system: schedulerIssues + deliveryBlocked,
    execution: execution.pending,
  };
}

export function getDecisionViews(storeInput) {
  const store = storeData(storeInput);
  const views = deriveDecisionArrays(store);
  return {
    recommendations: views.recommendations.map(cloneValue),
    approval: views.approval.map(cloneValue),
    decided: views.decided.map(cloneValue),
  };
}

export function buildTimeline(storeInput, state = {}) {
  const store = storeData(storeInput);
  const reports = getReportCoverage(store);
  const recommendations = getRecommendationCounts(store);
  const executions = getExecutionCounts(store);
  const readbacks = getReadbackCounts(store);
  const mode = stateValue(store, state, "mode", store.autonomy.mode);
  const paused = stateValue(store, state, "paused", store.autonomy.paused);
  const approvalReady = recommendations.pendingApproval === 0;
  const executionActive = executions.queued + executions.running + executions.awaitingReadback > 0;
  return [
    { id: "scope", time: "08:30", at: "2026-07-20T08:30:00+08:00", title: "身份与店铺范围确认", meta: `${store.id} · ${store.marketplace} · ${store.scope.asin}`, state: store.session.status === "ready" ? "done" : "warning", type: "fact", workspace: "data-preparation", subview: "scope" },
    { id: "reports", time: "08:42", at: "2026-07-20T08:42:00+08:00", title: `广告报表 ${reports.available}/${reports.expected}`, meta: `${reports.importedRows.toLocaleString("en-US")} 行 · ${reports.missing.length ? `缺 ${reports.missing.join("、")}` : "来源完整"}`, state: reports.filesComplete ? "done" : "warning", type: "fact", workspace: "data-preparation", subview: "reports" },
    { id: "import", time: "08:46", at: "2026-07-20T08:46:00+08:00", title: `导入 ${store.importRun.importedRows.toLocaleString("en-US")} 行，隔离库 ${store.id}`, meta: `${store.importRun.reportTypesImported}/${store.importRun.reportTypesExpected} 类 · 对账 ${store.importRun.reconciliation}`, state: store.importRun.status === "validated" ? "done" : "warning", type: "fact", workspace: "data-preparation", subview: "import-check" },
    { id: "analysis", time: "08:49", at: "2026-07-20T08:49:00+08:00", title: `AI 完成 ${store.diagnostics.length} 个广告对象诊断`, meta: `ACOS ${formatPercent(store.metrics.acos)} · 目标 ${formatPercent(store.metrics.targetAcos)}`, state: store.diagnostics.length ? "done" : "pending", type: "analysis", workspace: "diagnosis", subview: "analysis" },
    { id: "decision", time: "08:52", at: "2026-07-20T08:52:00+08:00", title: `生成 ${store.recommendations.length} 个调整建议`, meta: `待判断 ${recommendations.pendingReview} · 待审批 ${recommendations.pendingApproval} · 已决策 ${store.recommendations.length - recommendations.actionable}`, state: recommendations.total ? "done" : "pending", type: "decision", workspace: "decisions", subview: "recommendations" },
    { id: "safety", time: "09:00", at: "2026-07-20T09:00:00+08:00", title: "执行前安全检查", meta: paused ? "本店自动执行已暂停" : mode === "auto" ? `${recommendations.autoEligible} 个建议在自动边界内` : "人工审批模式，不自动写入 Ads", state: paused || !approvalReady ? "active" : "done", type: "action", workspace: "decisions", subview: "approval", expanded: !approvalReady },
    { id: "execution", time: "09:05", at: "2026-07-20T09:05:00+08:00", title: executionActive ? "可见浏览器执行进行中" : executions.verified ? "可见浏览器执行已完成" : "等待执行许可", meta: `队列 ${executions.total} · 待处理 ${executions.pending}`, state: executions.failed || executions.blocked ? "warning" : executionActive ? "active" : executions.verified ? "done" : "pending", type: "action", workspace: "readback", subview: "evidence" },
    { id: "readback", time: "09:15", at: "2026-07-20T09:15:00+08:00", title: readbacks.waiting ? "等待页面重载回读" : "执行回读已验证", meta: `已验证 ${readbacks.verified} · 等待 ${readbacks.waiting} · 失败 ${readbacks.failed}`, state: readbacks.failed ? "warning" : readbacks.waiting ? "pending" : "done", type: "outcome", workspace: "readback", subview: "evidence" },
  ];
}

export function buildLedger(storeInput, state = {}) {
  const store = storeData(storeInput);
  const reports = getReportCoverage(store);
  const entries = [
    {
      id: `${store.id}-ledger-scope`,
      at: "2026-07-20T08:30:00+08:00",
      time: "08:30",
      kind: "fact",
      kindLabel: "FACT",
      title: `范围已锁定：${store.scope.productLabel}`,
      detail: `${store.scope.dateFrom} → ${store.scope.dateTo} · ${store.scope.batchId}`,
      change: "—",
      status: store.session.label,
      statusTone: statusTone(store.session.status),
      result: `浏览器档案 ${store.session.profile}`,
      select: "scope",
      workspace: "data-preparation",
      subview: "scope",
      entityId: store.scope.selectedProductId,
    },
    {
      id: `${store.id}-ledger-reports`,
      at: "2026-07-20T08:42:00+08:00",
      time: "08:42",
      kind: "fact",
      kindLabel: "FACT",
      title: `广告报表 ${reports.available}/${reports.expected} · ${reports.importedRows.toLocaleString("en-US")} 行`,
      detail: `${reports.available} 个真实文件 · 领星下载中心`,
      change: reports.missing.length ? `缺 ${reports.missing.join("、")}` : "—",
      status: reports.filesComplete ? "采集完成" : "部分完成",
      statusTone: reports.filesComplete ? "success" : "warning",
      result: reports.filesComplete ? "文件与来源校验通过" : "不完整维度保持不可用",
      select: "reports",
      workspace: "data-preparation",
      subview: "reports",
      entityId: store.scope.batchId,
    },
    {
      id: `${store.id}-ledger-import`,
      at: store.importRun.completedAt,
      time: store.importRun.completedAt.slice(11, 16),
      kind: "fact",
      kindLabel: "IMPORT",
      title: `导入 ${store.importRun.importedRows.toLocaleString("en-US")} 行到 ${store.id} 隔离库`,
      detail: `${store.importRun.reportTypesImported}/${store.importRun.reportTypesExpected} 类 · ${store.importRun.sourceFiles} 个文件`,
      change: `重复 ${store.importRun.duplicateRows} · 拒绝 ${store.importRun.rejectedRows}`,
      status: store.importRun.status === "validated" ? "已验证" : "需复核",
      statusTone: statusTone(store.importRun.status),
      result: `指标口径 ${store.importRun.metricGrain}`,
      select: "import",
      workspace: "data-preparation",
      subview: "import-check",
      entityId: store.importRun.id,
    },
    {
      id: `${store.id}-ledger-analysis`,
      at: "2026-07-20T08:49:00+08:00",
      time: "08:49",
      kind: "analysis",
      kindLabel: "ANALYSIS",
      title: `ACOS ${formatPercent(store.metrics.acos)}，目标 ${formatPercent(store.metrics.targetAcos)}`,
      detail: `${store.diagnostics.length} 个对象 · 高风险 ${store.diagnostics.filter((item) => item.severity === "high").length}`,
      change: "—",
      status: "已生成",
      statusTone: "success",
      result: `诊断模型 ${store.aiRules.outputContract}`,
      select: "analysis",
      workspace: "diagnosis",
      subview: "analysis",
      entityId: store.diagnostics[0]?.id || null,
    },
    ...store.events.map((event) => ({
      id: `${store.id}-ledger-${event.id}`,
      at: event.occurredAt,
      time: event.occurredAt.slice(5, 16).replace("T", " "),
      kind: "fact",
      kindLabel: "EVENT",
      title: event.title,
      detail: event.description,
      change: event.type,
      status: event.aiContext ? "已进入 AI 上下文" : "仅记录",
      statusTone: event.impact === "blocking" ? "warning" : "success",
      result: `影响 ${event.impact}`,
      select: "event",
      workspace: "product",
      subview: "events",
      entityId: event.id,
    })),
    ...store.recommendations.map((recommendation) => ({
      id: `${store.id}-ledger-${recommendation.id}`,
      at: recommendation.createdAt,
      time: recommendation.createdAt.slice(11, 16),
      kind: "analysis",
      kindLabel: "DECISION",
      title: recommendation.title,
      detail: `${recommendation.objectName} · rev ${recommendation.revision}`,
      change: `${formatActionValue(recommendation.currentValue, recommendation.unit, store)} → ${formatActionValue(recommendation.recommendedValue, recommendation.unit, store)}`,
      status: recommendationStatusLabel(recommendation.status),
      statusTone: statusTone(recommendation.status),
      result: recommendation.policy?.blocker || recommendation.policy?.boundary || "证据已绑定",
      select: recommendation.status === "pending_approval" ? "approval" : recommendation.status === "pending_review" ? "recommendation" : "decided",
      workspace: "decisions",
      subview: recommendation.status === "pending_approval" ? "approval" : recommendation.status === "pending_review" ? "recommendations" : "decided",
      entityId: recommendation.id,
      risk: recommendation.risk,
    })),
    ...store.executionQueue.map((execution) => ({
      id: `${store.id}-ledger-${execution.id}`,
      at: execution.savedAt || execution.startedAt || execution.queuedAt || "2026-07-20T09:00:00+08:00",
      time: (execution.savedAt || execution.startedAt || execution.queuedAt || "2026-07-20T09:00:00+08:00").slice(11, 16),
      kind: "action",
      kindLabel: "ACTION",
      title: `网页动作：${execution.target}`,
      detail: `${execution.entityType} · ${execution.mode === "auto" ? "AI 自动边界" : "人工许可"}`,
      change: `${formatActionValue(execution.beforeValue, execution.unit, store)} → ${formatActionValue(execution.intendedValue, execution.unit, store)}`,
      status: executionStatusLabel(execution.status),
      statusTone: statusTone(execution.status),
      result: execution.storeIdentityVerified ? `店铺身份 ${store.id} 已校验` : "店铺身份尚未确认",
      select: "execution",
      workspace: "readback",
      subview: "evidence",
      entityId: execution.id,
    })),
    ...store.readbacks.map((readback) => ({
      id: `${store.id}-ledger-${readback.id}`,
      at: readback.checkedAt || readback.requiredAt,
      time: (readback.checkedAt || readback.requiredAt).slice(11, 16),
      kind: "outcome",
      kindLabel: "READBACK",
      title: `执行回读：${readback.actionId}`,
      detail: readback.note,
      change: `${formatActionValue(readback.savedValue, typeof readback.savedValue === "number" ? "currency" : "state", store)} → ${formatActionValue(readback.reloadValue, typeof readback.reloadValue === "number" ? "currency" : "state", store)}`,
      status: readbackStatusLabel(readback.status),
      statusTone: statusTone(readback.status),
      result: readback.authorityBound ? "建议、动作与截图已绑定" : "缺少权威建议绑定",
      select: "readback",
      workspace: "readback",
      subview: "evidence",
      entityId: readback.id,
    })),
    ...store.outcomes.map((outcome) => ({
      id: `${store.id}-ledger-${outcome.id}`,
      at: outcome.verifiedAt,
      time: `昨日 ${outcome.verifiedAt.slice(11, 16)}`,
      kind: "outcome",
      kindLabel: "OUTCOME",
      title: outcome.title,
      detail: outcome.objectName,
      change: `${outcome.before} → ${outcome.after}`,
      status: "已验证",
      statusTone: "success",
      result: outcome.result,
      select: "outcome",
      workspace: "readback",
      subview: "evidence",
      entityId: outcome.id,
    })),
  ];

  const stateLedger = Array.isArray(state.ledgerEntries) ? state.ledgerEntries.map(cloneValue) : [];
  return [...entries, ...stateLedger]
    .map((entry) => ({ ...entry, storeId: store.id }))
    .sort((left, right) => String(left.at).localeCompare(String(right.at)));
}

export function filterLedgerEntries(entries, filters = {}) {
  const kind = filters.kind || filters.ledgerKind || "all";
  const query = String(filters.query || "").trim().toLowerCase();
  const pendingOnly = Boolean(filters.pendingOnly ?? filters.ledgerPendingOnly);
  const storeId = filters.storeId || null;
  return entries.filter((entry) => {
    if (storeId && entry.storeId !== storeId) return false;
    if (kind !== "all") {
      const kindMatch = kind === "analysis" ? entry.kind === "analysis" : kind === "action" ? entry.kind === "action" : kind === "outcome" ? entry.kind === "outcome" : entry.kind === kind;
      if (!kindMatch) return false;
    }
    if (pendingOnly && entry.statusTone !== "warning" && entry.statusTone !== "danger") return false;
    if (query && !`${entry.title} ${entry.detail} ${entry.result} ${entry.entityId}`.toLowerCase().includes(query)) return false;
    return true;
  });
}

export function getLedgerCounts(entries) {
  return entries.reduce((counts, entry) => {
    counts.total += 1;
    counts[entry.kind] = (counts[entry.kind] || 0) + 1;
    if (entry.statusTone === "warning" || entry.statusTone === "danger") counts.pending += 1;
    return counts;
  }, { total: 0, pending: 0, fact: 0, analysis: 0, action: 0, outcome: 0 });
}

export function transitionRecommendation(storeInput, recommendationId, nextStatus, options = {}) {
  const store = cloneValue(storeData(storeInput));
  const index = store.recommendations.findIndex((item) => item.id === recommendationId);
  if (index < 0) throw new RangeError(`建议不存在：${recommendationId}`);
  const current = store.recommendations[index];
  if (options.expectedRevision !== undefined && Number(options.expectedRevision) !== Number(current.revision)) {
    throw new Error(`建议版本冲突：期望 rev ${options.expectedRevision}，当前 rev ${current.revision}`);
  }
  if (!recommendationTransitions[current.status]?.has(nextStatus)) {
    throw new Error(`不允许将建议从 ${current.status} 转为 ${nextStatus}`);
  }
  const at = options.at || PROTOTYPE_NOW;
  const updated = {
    ...current,
    status: nextStatus,
    revision: Number(current.revision || 0) + 1,
    decidedAt: terminalRecommendationStatuses.has(nextStatus) ? at : current.decidedAt,
    decisionNote: options.decisionNote ?? current.decisionNote ?? null,
  };
  store.recommendations[index] = updated;
  if (nextStatus === "approved" && current.actionId) {
    store.executionQueue = store.executionQueue.map((action) => action.id === current.actionId ? {
      ...action,
      status: "queued",
      permission: "human",
      queuedAt: at,
    } : action);
  }
  if (nextStatus === "rejected" && current.actionId) {
    store.executionQueue = store.executionQueue.map((action) => action.id === current.actionId && action.status === "waiting_permission" ? {
      ...action,
      status: "cancelled",
      permission: null,
    } : action);
  }
  store.approvedRecommendationIds = store.recommendations.filter((item) => item.status === "approved" || item.status === "executed").map((item) => item.id);
  store.stateRevision = Number(store.stateRevision || 0) + 1;
  store.updatedAt = at;
  return store;
}

export function recordReadback(storeInput, actionId, evidence, options = {}) {
  const store = cloneValue(storeData(storeInput));
  const index = store.readbacks.findIndex((item) => item.actionId === actionId);
  if (index < 0) throw new RangeError(`回读任务不存在：${actionId}`);
  const current = store.readbacks[index];
  if (current.status === "verified") throw new Error(`回读已是终态：${actionId}`);
  const next = mergeRecord(current, evidence);
  const shouldVerify = next.status === "verified";
  if (shouldVerify) {
    const screenshotsComplete = Boolean(next.screenshots?.before && next.screenshots?.after && next.screenshots?.reload);
    const valuesMatch = String(next.savedValue) === String(next.reloadValue);
    if (!next.authorityBound) throw new Error("回读缺少权威建议绑定");
    if (!next.storeIdentityVerified) throw new Error("回读店铺身份未通过校验");
    if (!screenshotsComplete) throw new Error("回读缺少 before/after/reload 截图");
    if (!valuesMatch) throw new Error("页面重载值与保存值不一致");
  }
  const at = options.at || PROTOTYPE_NOW;
  store.readbacks[index] = { ...next, checkedAt: shouldVerify ? (next.checkedAt || at) : next.checkedAt };
  if (shouldVerify) {
    store.executionQueue = store.executionQueue.map((action) => action.id === actionId ? { ...action, status: "verified", observedValue: next.reloadValue } : action);
    const recommendationId = current.recommendationId;
    store.recommendations = store.recommendations.map((recommendation) => recommendation.id === recommendationId && recommendation.status === "approved" ? { ...recommendation, status: "executed", revision: Number(recommendation.revision || 0) + 1, decidedAt: at } : recommendation);
  }
  store.readbackVerifiedIds = store.readbacks.filter((item) => item.status === "verified").map((item) => item.id);
  store.stateRevision = Number(store.stateRevision || 0) + 1;
  store.updatedAt = at;
  return store;
}

export function setExecutionMode(storeInput, mode) {
  if (mode !== "auto" && mode !== "review") throw new RangeError(`不支持执行模式：${String(mode)}`);
  const store = cloneValue(storeData(storeInput));
  store.mode = mode;
  store.paused = false;
  store.autonomy = { ...store.autonomy, mode, paused: false };
  store.aiRules = { ...store.aiRules, safety: { ...store.aiRules.safety, allowAutoExecute: mode === "auto" } };
  store.stateRevision = Number(store.stateRevision || 0) + 1;
  store.updatedAt = PROTOTYPE_NOW;
  return store;
}

export function toggleAutonomyPause(storeInput) {
  const store = cloneValue(storeData(storeInput));
  const mode = store.mode || store.autonomy.mode;
  if (mode !== "auto") return store;
  const paused = !(store.paused ?? store.autonomy.paused);
  store.paused = paused;
  store.autonomy = { ...store.autonomy, paused };
  store.stateRevision = Number(store.stateRevision || 0) + 1;
  store.updatedAt = PROTOTYPE_NOW;
  return store;
}

export function selectProduct(storeInput, productId) {
  const store = cloneValue(storeData(storeInput));
  if (!store.products.some((product) => product.id === productId)) throw new RangeError(`产品不属于 ${store.id}：${productId}`);
  const product = store.products.find((item) => item.id === productId);
  store.selectedProductId = productId;
  store.scope = {
    ...store.scope,
    selectedProductId: productId,
    asin: product?.asin || "",
    productLabel: `${store.storeName || store.name || store.id} / ${product?.asin || "当前产品"}`,
  };
  store.products = store.products.map((product) => ({ ...product, selected: product.id === productId }));
  store.stateRevision = Number(store.stateRevision || 0) + 1;
  store.updatedAt = PROTOTYPE_NOW;
  return store;
}

export function appendOperationEvent(storeInput, event) {
  const store = cloneValue(storeData(storeInput));
  if (!event?.id || !event?.title || !event?.occurredAt) throw new TypeError("运营事件必须包含 id、title、occurredAt");
  if (!String(event.id).startsWith(store.id)) throw new Error(`运营事件 ID 必须属于 ${store.id}`);
  if (store.events.some((item) => item.id === event.id)) throw new Error(`运营事件已存在：${event.id}`);
  store.events = [...store.events, cloneValue(event)].sort((left, right) => String(right.occurredAt).localeCompare(String(left.occurredAt)));
  store.stateRevision = Number(store.stateRevision || 0) + 1;
  store.updatedAt = PROTOTYPE_NOW;
  return store;
}

export function getSubviewData(storeInput, target) {
  const store = storeData(storeInput);
  const intent = resolveNavigationTarget(target);
  if (!intent) throw new RangeError(`无效导航目标：${String(target)}`);
  const decisions = getDecisionViews(store);
  const map = {
    "today:overview": () => ({ timeline: buildTimeline(store), metrics: cloneValue(store.metrics), badges: getWorkspaceBadgeCounts(store), ledger: buildLedger(store).slice(-6) }),
    "product:products": () => ({ products: cloneValue(store.products), selectedProduct: cloneValue(getCurrentProduct(store)) }),
    "product:targets": () => ({ products: cloneValue(store.products), selectedProduct: cloneValue(getCurrentProduct(store)), target: cloneValue(getCurrentProduct(store)?.target || null) }),
    "product:events": () => ({ events: cloneValue(store.events), selectedProductId: store.scope.selectedProductId }),
    "data-preparation:scope": () => ({ scope: cloneValue(store.scope), store: { id: store.id, storeName: store.storeName, marketplace: store.marketplace, marketplaceCode: store.marketplaceCode }, session: cloneValue(store.session) }),
    "data-preparation:reports": () => ({ reports: cloneValue(store.reports), coverage: getReportCoverage(store) }),
    "data-preparation:import-check": () => ({ importRun: cloneValue(store.importRun), reports: cloneValue(store.reports), coverage: getReportCoverage(store) }),
    "diagnosis:analysis": () => ({ diagnostics: cloneValue(store.diagnostics), metrics: cloneValue(store.metrics), events: cloneValue(store.events) }),
    "decisions:recommendations": () => ({ items: decisions.recommendations, counts: getRecommendationCounts(store) }),
    "decisions:approval": () => ({ items: decisions.approval, counts: getRecommendationCounts(store), session: cloneValue(store.session) }),
    "decisions:decided": () => ({ items: decisions.decided, counts: getRecommendationCounts(store), readOnly: true }),
    "readback:evidence": () => ({ queue: cloneValue(store.executionQueue), readbacks: cloneValue(store.readbacks), outcomes: cloneValue(store.outcomes), counts: getExecutionCounts(store) }),
    "growth:keywords": () => ({ keywords: cloneValue(store.keywords), diagnostics: cloneValue(store.diagnostics) }),
    "growth:listing": () => ({ listing: cloneValue(store.listing), keywords: cloneValue(store.keywords.filter((item) => item.selected || item.priority === "high")) }),
    "system:settings": () => ({ aiRules: cloneValue(store.aiRules), autonomy: cloneValue(store.autonomy) }),
    "system:scheduler": () => ({ tasks: cloneValue(store.scheduler), storeId: store.id }),
    "system:delivery": () => ({ delivery: cloneValue(store.delivery), readbackCounts: getReadbackCounts(store) }),
  };
  return map[`${intent.workspace}:${intent.subview}`]();
}

export function buildStoreQueryAnswer(storeInput, query) {
  const store = storeData(storeInput);
  const normalized = String(query || "").trim().toLowerCase();
  const recommendations = getRecommendationCounts(store);
  const executions = getExecutionCounts(store);
  const reports = getReportCoverage(store);
  if (!normalized) return { storeId: store.id, answer: "请输入要查询的店铺问题。", evidenceIds: [] };
  if (normalized.includes("预算") || normalized.includes("budget")) {
    return { storeId: store.id, answer: `${store.id} 今日预算影响 ${formatMoney(store.autonomy.budgetImpactToday, store)} / 上限 ${formatMoney(store.autonomy.dailyBudgetCap, store)}；待审批建议 ${recommendations.pendingApproval} 条。`, evidenceIds: store.recommendations.filter((item) => item.actionType === "budget_change").map((item) => item.id) };
  }
  if (normalized.includes("报表") || normalized.includes("数据")) {
    return { storeId: store.id, answer: `${store.id} 当前 ${reports.available}/${reports.expected} 类真实报表、${reports.imported}/${reports.expected} 类已入库，共 ${reports.importedRows.toLocaleString("en-US")} 行。`, evidenceIds: store.reports.map((item) => item.id) };
  }
  if (normalized.includes("审批") || normalized.includes("为什么")) {
    const approval = store.recommendations.find((item) => item.status === "pending_approval");
    return { storeId: store.id, answer: approval ? `${approval.title} 需要审批：${approval.policy.blocker || approval.policy.boundary}。审批只签发执行许可，不代表 Ads 已执行。` : `${store.id} 当前没有待审批动作。`, evidenceIds: approval ? [approval.id, approval.authority.diagnosticId].filter(Boolean) : [] };
  }
  if (normalized.includes("回读") || normalized.includes("效果") || normalized.includes("acos")) {
    const latest = store.outcomes[0];
    return { storeId: store.id, answer: latest ? `${store.id} 最近一条已验证结果：${latest.title}；${latest.result}。当前仍有 ${executions.awaitingReadback} 条动作等待页面回读。` : `${store.id} 暂无已验证效果回读。`, evidenceIds: latest ? [latest.id, latest.actionId] : [] };
  }
  const highPriorityKeyword = store.keywords.find((item) => item.priority === "high");
  return { storeId: store.id, answer: `${store.id} 当前 ACOS ${formatPercent(store.metrics.acos)}，目标 ${formatPercent(store.metrics.targetAcos)}；高优先级关键词“${highPriorityKeyword?.keyword || "无"}”，待判断 ${recommendations.pendingReview} 条、待审批 ${recommendations.pendingApproval} 条。`, evidenceIds: [highPriorityKeyword?.id, ...store.recommendations.filter((item) => item.status === "pending_review" || item.status === "pending_approval").map((item) => item.id)].filter(Boolean) };
}

export function validateStoreIsolation(appState) {
  if (!appState?.stores) return { valid: false, errors: ["缺少 stores"] };
  const errors = [];
  STORE_IDS.forEach((storeId) => {
    const store = appState.stores[storeId];
    if (!store) {
      errors.push(`缺少店铺 ${storeId}`);
      return;
    }
    if ((store.id || store.storeId) !== storeId) errors.push(`${storeId} 顶层身份不一致`);
    const scopedCollections = ["products", "events", "reports", "diagnostics", "keywords"];
    scopedCollections.forEach((collection) => {
      (store[collection] || []).forEach((item) => {
        if (item.id && !String(item.id).startsWith(storeId)) errors.push(`${storeId}.${collection} 混入 ${item.id}`);
      });
    });
    (store.executionQueue || []).forEach((action) => {
      if (action.browserProfile !== store.session.profile) errors.push(`${storeId} 动作 ${action.id} 浏览器档案不一致`);
    });
  });
  const references = STORE_IDS.map((storeId) => appState.stores[storeId]);
  if (new Set(references).size !== references.length) errors.push("多个店铺复用了同一状态对象");
  return { valid: errors.length === 0, errors };
}

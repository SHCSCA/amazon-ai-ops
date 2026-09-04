const DEFAULT_CONFIG = Object.freeze({
  collectionTime: "08:30",
  lookbackDays: 14,
  analysisWindowDays: 7,
  targetAcosPct: 30,
  minConfidencePct: 85,
  evidenceRetentionDays: 180,
  killSwitch: false,
});

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
}

function storeKey(store) {
  return String(store?.storeId || store?.id || store?.storeKey || "").trim();
}

function policyRules() {
  return [
    {
      id: "selected-product-exact-keywords",
      priority: 10,
      scope: "当前店铺 > 所选产品 > 广告活动 > 广告组 > 精准关键词",
      actionType: "keyword_bid_adjustment",
      actionLabel: "调整关键词竞价",
      changeLimitPct: 10,
      dailyLimit: 3,
      cooldownHours: 24,
      approvalMode: "策略内自动",
      stopConditions: ["店铺身份变化", "刷新回读不一致", "库存风险"],
    },
    {
      id: "other-keywords",
      priority: 20,
      scope: "当前店铺 > 其他关键词",
      actionType: "keyword_bid_adjustment",
      actionLabel: "调整关键词竞价",
      changeLimitPct: 5,
      dailyLimit: 1,
      cooldownHours: 24,
      approvalMode: "人工审批",
      stopConditions: ["店铺身份变化", "刷新回读不一致", "证据不足"],
    },
  ];
}

function validateState(state) {
  if (!state || typeof state !== "object" || !state.storeKey) throw new TypeError("必须提供店铺级设置状态");
}

export function createStoreSettings(store) {
  const marketplaceCode = String(store?.marketplaceCode || store?.marketplace || "US").toUpperCase();
  const currencyCode = String(store?.currencyCode || "USD").toUpperCase();
  if (marketplaceCode !== "US" || currencyCode !== "USD") {
    throw new RangeError("当前原型仅支持 Amazon 美国站和 USD");
  }
  const enabled = store?.policyAuthority?.status === "enabled";
  return {
    schemaVersion: 1,
    storeKey: storeKey(store),
    storeLabel: String(store?.storeName || store?.name || storeKey(store)),
    marketplaceCode,
    currencyCode,
    revision: 1,
    config: { ...DEFAULT_CONFIG },
    policy: {
      status: enabled ? "enabled" : "missing",
      revision: enabled ? 1 : 0,
      versionLabel: enabled ? String(store.policyAuthority.versionLabel || "关键词竞价策略 · 版本 1") : null,
      checkedAt: enabled ? "2026-08-28 15:30" : null,
      enabledAt: enabled ? "2026-08-28 15:31" : null,
      rules: enabled ? policyRules() : [],
    },
    automationTasks: (store?.scheduler || []).map((task) => ({
      ...clone(task),
      lastReason: task.lastStatus === "failed" ? String(task.lastReason || "最近运行失败") : null,
      nextAction: task.lastStatus === "failed" ? "修复后重试" : null,
    })),
    feedback: null,
  };
}

export function createPolicyDraft(state) {
  validateState(state);
  const revision = Number(state.policy?.revision || 0) + 1;
  return {
    ...clone(state),
    revision: Number(state.revision || 0) + 1,
    policy: {
      status: "draft",
      revision,
      versionLabel: null,
      checkedAt: null,
      enabledAt: null,
      rules: policyRules(),
    },
    feedback: {
      tone: "info",
      title: "策略草稿已创建",
      message: "请检查对象范围、允许动作、限制、证据与停止条件。",
      nextAction: "检查草稿",
    },
  };
}

export function checkPolicyDraft(state) {
  validateState(state);
  if (state.policy?.status !== "draft") {
    return { ok: false, state: clone(state), reason: "只有策略草稿可以检查。" };
  }
  const rules = [...(state.policy.rules || [])].sort((left, right) => left.priority - right.priority);
  const valid = rules.length > 0
    && rules.every((rule) =>
      rule.actionType === "keyword_bid_adjustment"
      && Number(rule.priority) > 0
      && Number(rule.changeLimitPct) > 0
      && Number(rule.changeLimitPct) <= 10
      && Array.isArray(rule.stopConditions)
      && rule.stopConditions.length > 0,
    )
    && new Set(rules.map((rule) => rule.priority)).size === rules.length;
  if (!valid) {
    return {
      ok: false,
      state: clone(state),
      reason: "策略检查失败：V1 只允许关键词竞价，且优先级、变更上限和停止条件必须完整。",
    };
  }
  const next = {
    ...clone(state),
    revision: Number(state.revision || 0) + 1,
    policy: { ...clone(state.policy), status: "checked", rules, checkedAt: "2026-08-28 15:32" },
    feedback: { tone: "success", title: "策略检查通过", message: "可以启用当前草稿。", nextAction: "启用策略" },
  };
  return { ok: true, state: next, reason: "策略检查通过。" };
}

export function enablePolicyDraft(state) {
  validateState(state);
  if (state.policy?.status !== "checked") {
    return { ok: false, state: clone(state), reason: "请先检查策略草稿，检查通过后才能启用。" };
  }
  const next = {
    ...clone(state),
    revision: Number(state.revision || 0) + 1,
    policy: {
      ...clone(state.policy),
      status: "enabled",
      versionLabel: `关键词竞价策略 · 版本 ${state.policy.revision}`,
      enabledAt: "2026-08-28 15:33",
    },
    feedback: { tone: "success", title: "策略已启用", message: "新执行只会使用这个已检查版本。", nextAction: "返回今日任务" },
  };
  return { ok: true, state: next, reason: "策略已启用。" };
}

export function updateStoreConfig(state, request = {}) {
  validateState(state);
  if (Number(request.expectedRevision) !== Number(state.revision)) {
    return { ok: false, state: clone(state), reason: "配置已变化，请刷新当前店铺后重试。" };
  }
  const nextConfig = { ...clone(state.config), ...clone(request.patch || {}) };
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(nextConfig.collectionTime))) {
    return { ok: false, state: clone(state), reason: "采集时间必须是 00:00 至 23:59。" };
  }
  if (!Number.isFinite(Number(nextConfig.minConfidencePct)) || Number(nextConfig.minConfidencePct) < 0 || Number(nextConfig.minConfidencePct) > 100) {
    return { ok: false, state: clone(state), reason: "最低置信度必须在 0% 至 100% 之间。" };
  }
  for (const [key, label] of [["lookbackDays", "回看天数"], ["analysisWindowDays", "分析窗口"], ["evidenceRetentionDays", "证据保留天数"]]) {
    if (!Number.isInteger(Number(nextConfig[key])) || Number(nextConfig[key]) <= 0) {
      return { ok: false, state: clone(state), reason: `${label}必须是正整数。` };
    }
  }
  const next = {
    ...clone(state),
    revision: Number(state.revision || 0) + 1,
    config: nextConfig,
    feedback: {
      tone: nextConfig.killSwitch ? "danger" : "success",
      title: nextConfig.killSwitch ? "执行总开关已关闭" : "当前店铺配置已保存",
      message: nextConfig.killSwitch ? "采集和分析仍可运行，所有新广告执行保持阻断。" : "新设置只作用于当前店铺。",
      nextAction: nextConfig.killSwitch ? "检查阻断原因" : "返回今日任务",
    },
  };
  return { ok: true, state: next, reason: next.feedback.message };
}

export function toggleAutomationTask(state, taskId) {
  validateState(state);
  if (!(state.automationTasks || []).some((task) => task.id === taskId)) return clone(state);
  return {
    ...clone(state),
    revision: Number(state.revision || 0) + 1,
    automationTasks: state.automationTasks.map((task) => task.id === taskId ? { ...clone(task), enabled: !task.enabled } : clone(task)),
    feedback: { tone: "success", title: "自动任务设置已更新", message: "变更只作用于当前店铺。" },
  };
}

export function runAutomationTask(state, taskId, result = {}) {
  validateState(state);
  if (!(state.automationTasks || []).some((task) => task.id === taskId)) {
    return { ok: false, state: clone(state), reason: "未找到当前店铺的自动任务。" };
  }
  const outcome = result.outcome === "failed" ? "failed" : "success";
  const next = {
    ...clone(state),
    revision: Number(state.revision || 0) + 1,
    automationTasks: state.automationTasks.map((task) => task.id === taskId ? {
      ...clone(task),
      lastRun: "2026-08-28 15:36",
      lastStatus: outcome,
      lastReason: outcome === "failed" ? String(result.reason || "自动任务未完成") : null,
      nextAction: outcome === "failed" ? "修复连接后重试" : null,
    } : clone(task)),
    feedback: outcome === "failed"
      ? { tone: "danger", title: "自动任务运行失败", message: String(result.reason || "自动任务未完成"), nextAction: "修复连接后重试" }
      : { tone: "success", title: "自动任务运行完成", message: "结果已保存到当前店铺。", nextAction: "查看运行结果" },
  };
  return { ok: true, state: next, reason: next.feedback.message };
}

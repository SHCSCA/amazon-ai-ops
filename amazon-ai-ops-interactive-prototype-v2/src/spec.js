export const STORE_CATALOG = [
  { id: "SHC001", name: "独立站", marketplace: "美国站", currency: "USD" },
  { id: "LMX002", name: "乐米家居", marketplace: "加拿大站", currency: "CAD" },
  { id: "NOC003", name: "北岸户外", marketplace: "英国站", currency: "GBP" },
];

export const WORKSPACES = [
  {
    id: "today",
    label: "今日巡航",
    group: "运营工作台",
    description: "按优先级完成今天最影响经营结果的动作",
    subviews: [{ id: "overview", label: "今日总览" }],
  },
  {
    id: "product",
    label: "产品工作台",
    group: "运营工作台",
    description: "维护产品范围、量化目标与运营上下文",
    subviews: [
      { id: "products", label: "产品" },
      { id: "targets", label: "量化目标" },
      { id: "events", label: "运营事件" },
    ],
  },
  {
    id: "data",
    label: "数据准备",
    group: "运营工作台",
    description: "锁定范围、采集领星报表并完成导入校验",
    subviews: [
      { id: "scope", label: "采集范围" },
      { id: "reports", label: "报表采集" },
      { id: "import-check", label: "导入校验" },
    ],
  },
  {
    id: "diagnosis",
    label: "广告诊断",
    group: "运营工作台",
    description: "从事实批次识别浪费、增长机会与风险",
    subviews: [{ id: "analysis", label: "量化诊断" }],
  },
  {
    id: "decisions",
    label: "建议与审批",
    group: "运营工作台",
    description: "把 AI 建议转化为有边界、可追溯的决策",
    subviews: [
      { id: "recommendations", label: "建议队列" },
      { id: "approval", label: "人工审批" },
      { id: "decided", label: "决策账本" },
    ],
  },
  {
    id: "readback",
    label: "执行与回读",
    group: "运营工作台",
    description: "预检、模拟执行并验证 before/save/reload 证据链",
    subviews: [{ id: "execution", label: "执行回读" }],
  },
  {
    id: "growth",
    label: "关键词与 Listing",
    group: "运营工作台",
    description: "将广告搜索词沉淀为可版本化的 Listing 优化",
    subviews: [
      { id: "keywords", label: "关键词机会" },
      { id: "listing", label: "Listing 优化" },
    ],
  },
  {
    id: "system",
    label: "系统与交付",
    group: "系统",
    description: "配置规则、调度任务并检查交付证据",
    subviews: [
      { id: "settings", label: "系统设置" },
      { id: "scheduler", label: "定时任务" },
      { id: "delivery", label: "交付检查" },
    ],
  },
];

export const DEFAULT_ROUTE = { workspace: "today", subview: "overview" };

export function getWorkspace(workspaceId) {
  return WORKSPACES.find((workspace) => workspace.id === workspaceId) ?? WORKSPACES[0];
}

export function normalizeRoute(route) {
  const workspace = getWorkspace(route?.workspace);
  const subview = workspace.subviews.some((item) => item.id === route?.subview)
    ? route.subview
    : workspace.subviews[0].id;
  return { workspace: workspace.id, subview };
}

export function formatMoney(value, currency = "USD") {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

export function formatPercent(value, digits = 1) {
  return `${(Number(value || 0) * 100).toFixed(digits)}%`;
}

export function formatDateTime(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

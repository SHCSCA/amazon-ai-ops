const MATCH_TYPE_LABELS = Object.freeze({
  exact: "精准匹配",
  phrase: "词组匹配",
  broad: "广泛匹配",
  close_match: "紧密匹配",
  auto_targeting: "自动投放",
  product: "商品投放",
  product_targeting: "商品投放",
  targeting_expression: "商品投放",
  substitutes: "替代商品",
  complements: "关联商品",
  loose_match: "宽泛匹配",
});

const OBJECT_TYPE_LABELS = Object.freeze({
  campaign: "广告活动",
  ad_group: "广告组",
  placement: "广告位",
  keyword: "关键词",
  product_targeting: "商品投放",
  auto_targeting: "自动投放",
  search_term: "搜索词",
});

const ACTION_LABELS = Object.freeze({
  keyword_bid_adjustment: "调整关键词竞价",
  bid_change: "调整关键词竞价",
  adjust_keyword_bid: "调整关键词竞价",
  budget_change: "调整日预算",
  placement_adjustment: "调整广告位系数",
  pause: "暂停投放",
  negative_exact: "添加否定精准",
  negative_phrase: "添加否定词组",
});

const STATUS_LABELS = Object.freeze({
  waiting_approval: "待判断",
  pending_review: "待判断",
  pending_approval: "待审批",
  approved: "许可已签发",
  executed: "已执行",
  rejected: "已拒绝",
  superseded: "已替代",
});

function normalizeToken(value) {
  return String(value || "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function money(value, currency = "USD") {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value ?? "—");
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numeric);
}

function percent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "—";
  const normalized = Math.abs(numeric) <= 1 ? numeric * 100 : numeric;
  return `${normalized.toFixed(1).replace(/\.0$/, "")}%`;
}

export function localizeMatchType(value) {
  const normalized = normalizeToken(value);
  return MATCH_TYPE_LABELS[normalized] || (normalized ? "其他投放方式" : "不适用");
}

export function localizeObjectType(value) {
  return OBJECT_TYPE_LABELS[normalizeToken(value)] || "其他对象";
}

export function localizeAction(value, fallback, entityType) {
  const actionType = normalizeToken(value);
  const normalizedEntityType = normalizeToken(entityType);
  if (["bid_change", "adjust_keyword_bid"].includes(actionType)) {
    if (normalizedEntityType === "auto_targeting") return "调整自动投放竞价";
    if (normalizedEntityType === "product_targeting") return "调整商品投放竞价";
  }
  return ACTION_LABELS[actionType] || String(fallback || "人工复核");
}

function businessObjectName(item, typeField) {
  const objectType = normalizeToken(item?.[typeField]);
  let label = String(item?.objectName || item?.keyword || item?.title || "未命名对象").trim();
  if (objectType === "keyword") label = label.replace(/^关键词\s*/i, "");
  if (objectType === "search_term") label = label.replace(/^搜索词\s*/i, "");
  if (objectType === "ad_group") label = label.replace(/^广告组\s*/i, "");
  return label.replace(
    /\s*·\s*(exact|phrase|broad|close[-_ ]match|loose[-_ ]match|substitutes|complements|product[-_ ]targeting)$/i,
    "",
  );
}

function targetingTypeLabel(item, typeField) {
  const objectType = normalizeToken(item?.[typeField]);
  if (objectType === "product_targeting") return "商品投放";
  if (objectType === "auto_targeting") {
    const localized = localizeMatchType(item?.matchType || item?.objectName);
    return localized === "其他投放方式" || localized === "不适用" ? "自动投放" : localized;
  }
  if (["keyword", "search_term"].includes(objectType)) return localizeMatchType(item?.matchType);
  return "不适用";
}

function formattedChangeValue(value, item) {
  const actionType = normalizeToken(item?.actionType);
  const unit = normalizeToken(item?.unit);
  if (actionType === "placement_adjustment" || ["percent", "percentage", "pct"].includes(unit)) {
    return percent(value);
  }
  if (
    unit === "currency" ||
    ["keyword_bid_adjustment", "bid_change", "adjust_keyword_bid", "budget_change"].includes(actionType)
  ) {
    return money(value, item?.currency || "USD");
  }
  return String(value ?? "—");
}

export function businessGroupPath(item) {
  const campaign = String(item?.campaign || item?.campaignName || "未归属活动");
  const adGroup = String(item?.adGroup || item?.adGroupName || "");
  const level = String(item?.level || localizeObjectType(item?.entityType || item?.objectType));
  const path = [{
    key: `campaign:${campaign}`,
    level: "campaign",
    label: `广告活动：${campaign}`,
  }];
  if (adGroup && adGroup !== "活动级" && !["广告活动", "广告位"].includes(level)) {
    path.push({
      key: `ad-group:${campaign}:${adGroup}`,
      level: "ad-group",
      label: `广告组：${adGroup}`,
    });
  }
  return path;
}

export function businessGroupLabel(item) {
  return businessGroupPath(item).map((group) => group.label).join(" · ");
}

function normalizeBusinessGroupPath(value) {
  if (!value) return [];
  const rawPath = Array.isArray(value) ? value : [{ key: String(value), level: "group", label: String(value) }];
  return rawPath
    .filter((group) => group && (group.key || group.label))
    .map((group) => ({
      key: String(group.key || group.label),
      level: String(group.level || "group"),
      label: String(group.label || group.key),
    }));
}

export function businessGroupTransitions(rows, groupBy = businessGroupPath) {
  let previousPath = [];
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const path = normalizeBusinessGroupPath(groupBy?.(row));
    let sharedDepth = 0;
    while (
      sharedDepth < path.length &&
      sharedDepth < previousPath.length &&
      path[sharedDepth].key === previousPath[sharedDepth].key
    ) {
      sharedDepth += 1;
    }
    const groups = path.slice(sharedDepth);
    previousPath = path;
    return { row, groups };
  });
}

export function adObjectTableRow(item) {
  const severity = normalizeToken(item?.severity);
  const objectType = normalizeToken(item?.objectType);
  return {
    ...item,
    id: item?.objectKey || item?.id,
    campaign: String(item?.campaignName || (objectType === "campaign" ? item?.objectName : "未归属活动")),
    adGroup: ["campaign", "placement"].includes(objectType)
      ? "活动级"
      : String(item?.adGroupName || (objectType === "ad_group" ? item?.objectName : "活动级")),
    level: localizeObjectType(item?.objectType),
    object: businessObjectName(item, "objectType"),
    targetingType: targetingTypeLabel(item, "objectType"),
    spendLabel: money(item?.spend),
    acosLabel: item?.acos === null ? "无订单" : percent(item?.acos),
    health: ["critical", "high"].includes(severity)
      ? "高风险"
      : severity === "medium"
        ? "需观察"
        : ["low", "healthy", "normal"].includes(severity)
          ? "正常"
          : "待核验",
  };
}

export function recommendationTableRow(item) {
  const before = formattedChangeValue(item?.currentValue, item);
  const after = formattedChangeValue(item?.recommendedValue, item);
  return {
    ...item,
    campaign: String(item?.campaignName || "未归属活动"),
    adGroup: String(item?.adGroupName || (item?.entityType === "campaign" ? "活动级" : "未归属广告组")),
    level: localizeObjectType(item?.entityType),
    object: businessObjectName(item, "entityType"),
    targetingType: targetingTypeLabel(item, "entityType"),
    action: localizeAction(item?.actionType, item?.actionLabel, item?.entityType),
    beforeLabel: before,
    afterLabel: after,
    change: `${before} → ${after}`,
    basis: String(item?.reason || "等待补充业务依据"),
    statusLabel: STATUS_LABELS[String(item?.status || "")] || "待处理",
  };
}

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  US_BUSINESS_TIMEZONE,
  US_MARKET_IDENTITY,
  businessTimezoneOf,
  hasUsMarketIdentity,
  withUsMarketIdentity,
} from "./us-market.js";

const STATE_VERSION = 5;

export const STORAGE_KEY = "amazon-ai-ops:mission-control:us-v1";

export const STORE_CATALOG = Object.freeze([
  {
    id: "SHC001",
    code: "SHC001",
    name: "SHC Home · 美国站",
    shortName: "SHC",
    ...US_MARKET_IDENTITY,
    accent: "#5b6cff",
  },
  {
    id: "LMX002",
    code: "LMX002",
    name: "Lumex Kitchen · 美国站",
    shortName: "LMX",
    ...US_MARKET_IDENTITY,
    accent: "#d59032",
  },
  {
    id: "NOC003",
    code: "NOC003",
    name: "Nordic Calm · 美国站",
    shortName: "NOC",
    ...US_MARKET_IDENTITY,
    accent: "#2f9d77",
  },
]);

export const NAV_GROUPS = Object.freeze([
  { id: "today", label: "今日任务", group: "任务", iconKey: "sun" },
  { id: "missions", label: "任务中心", group: "任务", iconKey: "crosshair" },
  { id: "decisions", label: "决策与审批", group: "任务", iconKey: "git-branch" },
  { id: "experiments", label: "经营实验", group: "学习闭环", iconKey: "flask" },
  { id: "execution", label: "实时执行", group: "学习闭环", iconKey: "rocket-launch" },
  { id: "memory", label: "因果记忆", group: "学习闭环", iconKey: "path" },
  { id: "objects", label: "店铺与广告对象", group: "运营底座", iconKey: "stack" },
  { id: "collection", label: "数据采集", group: "运营底座", iconKey: "database" },
  { id: "policy", label: "策略与风控", group: "治理", iconKey: "shield-check" },
  { id: "settings", label: "系统设置", group: "治理", iconKey: "gear" },
]);

export const MODE_OPTIONS = Object.freeze([
  {
    id: "approval",
    label: "人工审批",
    description: "Agent 只提出建议，关键动作由运营者批准并执行。",
  },
  {
    id: "auto",
    label: "策略内自动",
    description: "仅在当前店铺策略护栏内自动推进；越界动作始终等待人工。",
  },
]);

const MODE_ALIASES = {
  human: "approval",
  manual: "approval",
  copilot: "approval",
  approval: "approval",
  human_approval: "approval",
  auto: "auto",
  autopilot: "auto",
  policy_auto: "auto",
};

const AD_OBJECT_TYPES = new Set([
  "campaign",
  "ad_group",
  "keyword",
  "target",
  "product_ad",
]);

const COLLECTION_SOURCES = new Set([
  "lingxing",
  "amazon_ads",
]);

const COLLECTION_REPORT_TYPES = {
  lingxing: new Set(["business", "ads_campaign", "search_term", "inventory", "listing"]),
  amazon_ads: new Set(["ads_campaign", "search_term", "advertised_product"]),
};

const REPORT_IMPORT_TYPES = {
  local_csv: new Set(["business", "ads_campaign", "search_term", "advertised_product", "inventory", "listing"]),
  lingxing_export: COLLECTION_REPORT_TYPES.lingxing,
  amazon_export: COLLECTION_REPORT_TYPES.amazon_ads,
};

const ABSOLUTE_AUTO_BID_DECREASE_LIMIT_PCT = 15;
const ABSOLUTE_AUTO_BID_INCREASE_LIMIT_PCT = 10;
const ABSOLUTE_AUTO_BUDGET_CHANGE_LIMIT_PCT = 20;

function firstArray(...values) {
  return values.find((value) => Array.isArray(value)) || [];
}

export function resolveProductId(store, item) {
  if (!store || !item) return "";
  if (item.productId) return String(item.productId);
  const fromCollection = (collection, id) => (store[collection] || []).find((candidate) => candidate.id === String(id || ""));
  if (typeof item.scope === "string" && item.scope.startsWith("product:")) return item.scope.slice("product:".length);
  if (typeof item.scope === "string" && item.scope.startsWith("adObject:")) {
    const scopedObject = fromCollection("adObjects", item.scope.slice("adObject:".length));
    if (scopedObject?.productId) return String(scopedObject.productId);
  }
  const directRelations = [
    fromCollection("adObjects", item.adObjectId),
    fromCollection("missions", item.missionId),
    fromCollection("experiments", item.experimentId),
  ];
  for (const relation of directRelations) {
    if (relation?.productId) return String(relation.productId);
  }
  if (item.entityId) {
    if (item.entityType === "product" && fromCollection("products", item.entityId)) return String(item.entityId);
    const entityCollections = {
      adObject: "adObjects",
      ad_object: "adObjects",
      mission: "missions",
      experiment: "experiments",
      decision: "decisions",
      execution: "executionQueue",
      operation_event: "operationEvents",
      policy: "policies",
    };
    const entity = fromCollection(entityCollections[item.entityType], item.entityId);
    if (entity) {
      const nested = resolveProductId(store, entity);
      if (nested) return nested;
    }
  }
  for (const link of Array.isArray(item.links) ? item.links : []) {
    const directProduct = fromCollection("products", link);
    if (directProduct) return String(directProduct.id);
    for (const collection of ["adObjects", "missions", "experiments", "decisions", "executionQueue", "operationEvents"]) {
      const relation = fromCollection(collection, link);
      if (relation) {
        const nested = resolveProductId(store, relation);
        if (nested) return nested;
      }
    }
  }
  return "";
}

let fallbackSequence = 0;

function clone(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function nowFor(action) {
  return action?.meta?.timestamp || new Date().toISOString();
}

function businessDateFor(value, timeZone = US_BUSINESS_TIMEZONE) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || "").slice(0, 10);
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function eventIdFor(action) {
  if (action?.meta?.eventId) return action.meta.eventId;
  fallbackSequence += 1;
  return "evt-" + Date.now().toString(36) + "-" + fallbackSequence.toString(36);
}

function makeEntityId(prefix, action) {
  return prefix + "-" + eventIdFor(action).replace(/^evt-/, "");
}

function uniqueRecordId(items, baseId) {
  if (!(items || []).some((item) => item.id === baseId)) return baseId;
  let suffix = 2;
  while ((items || []).some((item) => item.id === `${baseId}-${suffix}`)) suffix += 1;
  return `${baseId}-${suffix}`;
}

function actorFor(action) {
  return action?.actor || action?.meta?.actor || "operator";
}

function explicitHumanApprovalPrincipal(store, action) {
  const requestedActor = String(action?.actor || action?.meta?.actor || "").trim().toLowerCase();
  if (requestedActor !== "human") return null;
  return asText(action?.principal || action?.meta?.principal)
    || asText(store?.session?.operator)
    || "local-operator";
}

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asFiniteNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function payloadFor(action, entityName) {
  const candidate = action?.[entityName] ?? action?.payload ?? action?.data;
  if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
    return candidate;
  }

  const {
    type,
    storeId,
    id,
    entityId,
    meta,
    actor,
    force,
    ...rest
  } = action || {};
  return rest;
}

function targetIdFor(action, entityName) {
  return (
    action?.[entityName + "Id"] ||
    action?.payload?.[entityName + "Id"] ||
    action?.payload?.id ||
    action?.entityId ||
    action?.id ||
    null
  );
}

function appendAudit(store, action, descriptor) {
  const at = nowFor(action);
  const eventId = eventIdFor(action);
  const outcome = descriptor.outcome || "success";
  const record = {
    id: uniqueRecordId(store.audit, "audit-" + eventId),
    at,
    actor: actorFor(action),
    action: action.type,
    outcome,
    entityType: descriptor.entityType || "store",
    entityId: descriptor.entityId || store.id,
    summary: descriptor.summary,
    details: descriptor.details || null,
  };

  return {
    ...store,
    audit: [record, ...(store.audit || [])],
    lastValidation: {
      ok: outcome === "success",
      message: descriptor.summary,
      at,
      action: action.type,
    },
  };
}

function appendCausal(store, action, descriptor) {
  const eventId = eventIdFor(action);
  const entry = {
    id: uniqueRecordId(store.causalLedger, descriptor.id || "cause-" + eventId),
    at: descriptor.at || nowFor(action),
    type: descriptor.type || "mutation",
    source: descriptor.source || action.type,
    actor: actorFor(action),
    entityType: descriptor.entityType || null,
    entityId: descriptor.entityId || null,
    missionId: descriptor.missionId || null,
    productId: descriptor.productId || null,
    adObjectId: descriptor.adObjectId || null,
    experimentId: descriptor.experimentId || null,
    policyId: descriptor.policyId || null,
    policyVersion: descriptor.policyVersion ?? null,
    title: descriptor.title,
    signal: descriptor.signal || null,
    intervention: descriptor.intervention || null,
    expectedEffect: descriptor.expectedEffect || null,
    observedEffect: descriptor.observedEffect || null,
    confidence: descriptor.confidence ?? null,
    beforeSnapshot: descriptor.beforeSnapshot ? clone(descriptor.beforeSnapshot) : null,
    afterSnapshot: descriptor.afterSnapshot ? clone(descriptor.afterSnapshot) : null,
    status: descriptor.status || "recorded",
    links: descriptor.links || [],
  };

  return {
    ...store,
    causalLedger: [entry, ...(store.causalLedger || [])],
  };
}

function succeed(store, action, descriptor, causalDescriptor) {
  let next = store;
  if (causalDescriptor) {
    next = appendCausal(next, action, causalDescriptor);
  }
  return appendAudit(next, action, { ...descriptor, outcome: "success" });
}

function reject(store, action, summary, entityType = "store", entityId = null, details = null) {
  return appendAudit(store, action, {
    outcome: "blocked",
    entityType,
    entityId: entityId || store.id,
    summary,
    details,
  });
}

function updateStore(state, action, updater) {
  const storeId = action.storeId || action.payload?.storeId || state.activeStoreId;
  const store = state.stores[storeId];
  if (!store) return state;

  const nextStore = updater(store);
  if (!nextStore || nextStore === store) return state;

  return {
    ...state,
    stores: {
      ...state.stores,
      [storeId]: nextStore,
    },
    updatedAt: nowFor(action),
  };
}

function validateProduct(input, store, excludeId) {
  const sku = asText(input.sku);
  if (!sku) return "SKU 不能为空";
  if (store.products.some((item) => item.id !== excludeId && asText(item.sku).toLowerCase() === sku.toLowerCase())) {
    return "当前店铺已存在相同 SKU";
  }
  if (!asText(input.name)) return "产品名称不能为空";
  const marketplace = asText(input.marketplace);
  if (!marketplace) return "产品站点不能为空";
  if (marketplace !== asText(store.marketplace)) return "产品站点必须与当前店铺站点一致";
  const asin = asText(input.asin).toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(asin)) return "ASIN 必须是 10 位字母或数字";
  if (store.products.some((item) => item.id !== excludeId && item.asin === asin)) {
    return "当前店铺已存在相同 ASIN";
  }
  const previous = excludeId ? store.products.find((item) => item.id === excludeId) : null;
  if (previous) {
    const identityChanged = asText(previous.sku).toLowerCase() !== sku.toLowerCase()
      || asText(previous.asin).toUpperCase() !== asin
      || asText(previous.marketplace || store.marketplace).toLowerCase() !== marketplace.toLowerCase();
    const referenced = store.adObjects.some((item) => item.productId === previous.id)
      || store.missions.some((item) => item.productId === previous.id)
      || store.experiments.some((item) => item.productId === previous.id)
      || store.decisions.some((item) => item.productId === previous.id)
      || store.executionQueue.some((item) => item.productId === previous.id)
      || store.policies.some((item) => item.scope === `product:${previous.id}`)
      || store.causalLedger.some((item) => (item.productId === previous.id || item.entityType === "product" && item.entityId === previous.id || Array.isArray(item.links) && item.links.includes(previous.id))
        && !(item.type === "entity_mutation" && item.entityType === "product" && item.entityId === previous.id));
    if (identityChanged && referenced) return "产品已有业务或因果记录，不能更改 SKU、ASIN 或站点；请新建产品";
  }
  const price = asFiniteNumber(input.price);
  if (price === null || price <= 0) return "售价必须大于 0";
  if (input.cost !== undefined && input.cost !== null && input.cost !== "") {
    const cost = asFiniteNumber(input.cost);
    if (cost === null || cost < 0) return "成本必须是非负数字";
  }
  const targetAcos = asFiniteNumber(input.targetAcos);
  if (targetAcos === null || targetAcos <= 0 || targetAcos > 100) return "目标 ACOS 必须在 0–100% 之间";
  if (input.targetMargin !== undefined && input.targetMargin !== null && input.targetMargin !== "") {
    const targetMargin = asFiniteNumber(input.targetMargin);
    if (targetMargin === null || targetMargin < -100 || targetMargin > 100) return "目标净利率必须在 -100–100% 之间";
  }
  return null;
}

function validateAdObject(input, store, excludeId) {
  if (!asText(input.name)) return "广告对象名称不能为空";
  if (!AD_OBJECT_TYPES.has(input.type)) return "广告对象类型无效";
  if (!asText(input.externalId)) return "Amazon 对象 ID 不能为空";
  if (!store.products.some((product) => product.id === input.productId && !product.archived && product.status !== "archived")) {
    return "广告对象必须关联当前店铺内的产品";
  }
  const externalId = asText(input.externalId);
  if (
    externalId &&
    store.adObjects.some(
      (item) => item.id !== excludeId && asText(item.externalId).toLowerCase() === externalId.toLowerCase(),
    )
  ) {
    return "当前店铺已存在相同广告平台 ID";
  }
  if (input.type === "campaign" && asText(input.parentId)) return "广告活动必须是顶级对象";
  const previous = excludeId ? store.adObjects.find((item) => item.id === excludeId) : null;
  if (previous) {
    const identityChanged = previous.type !== input.type
      || previous.productId !== input.productId
      || String(previous.parentId || "") !== String(input.parentId || "")
      || asText(previous.externalId).toLowerCase() !== externalId.toLowerCase()
      || String(previous.matchType || "") !== String(input.matchType || "")
      || asText(previous.targetingExpression) !== asText(input.targetingExpression)
      || (["keyword", "target"].includes(previous.type) && asText(previous.name) !== asText(input.name));
    const referenced = store.adObjects.some((item) => item.parentId === previous.id)
      || store.experiments.some((item) => item.adObjectId === previous.id)
      || store.decisions.some((item) => item.adObjectId === previous.id)
      || store.executionQueue.some((item) => item.adObjectId === previous.id)
      || store.policies.some((item) => item.scope === `adObject:${previous.id}`)
      || store.causalLedger.some((item) => (item.adObjectId === previous.id || ["adObject", "ad_object"].includes(item.entityType) && item.entityId === previous.id || Array.isArray(item.links) && item.links.includes(previous.id))
        && !(item.type === "entity_mutation" && ["adObject", "ad_object"].includes(item.entityType) && item.entityId === previous.id));
    if (identityChanged && referenced) {
      return "广告对象已有下级或业务链路引用，不能更改类型、产品、父级或 Amazon ID；请新建对象";
    }
  }
  const parentType = input.type === "ad_group" ? "campaign" : ["keyword", "target"].includes(input.type) ? "ad_group" : null;
  if (parentType) {
    const parent = store.adObjects.find((item) => item.id === input.parentId);
    if (!parent || parent.type !== parentType || parent.productId !== input.productId || parent.archived || ["archived", "deleted", "disabled", "paused"].includes(parent.status)) {
      return `广告对象必须关联同产品下可用的${parentType === "campaign" ? "广告活动" : "广告组"}`;
    }
  }
  if (input.type === "campaign") {
    const dailyBudget = asFiniteNumber(input.dailyBudget);
    if (dailyBudget === null || dailyBudget <= 0) return "广告活动日预算必须是正数";
  }
  if (["keyword", "target"].includes(input.type)) {
    const bid = asFiniteNumber(input.bid);
    if (bid === null || bid <= 0) return "竞价必须是正数";
  }
  if (input.type === "keyword" && !["exact", "phrase", "broad"].includes(input.matchType)) return "关键词匹配方式无效";
  if (input.type === "target" && !asText(input.targetingExpression)) return "商品投放表达式不能为空";
  if (input.targetAcos !== undefined && input.targetAcos !== null && input.targetAcos !== "") {
    const targetAcos = asFiniteNumber(input.targetAcos);
    if (targetAcos === null || targetAcos <= 0 || targetAcos > 100) return "目标 ACOS 必须在 0–100% 之间";
  }
  return null;
}

function validateCollectionJob(input) {
  if (!asText(input.name)) return "采集任务名称不能为空";
  if (!COLLECTION_SOURCES.has(input.source)) return "采集来源无效";
  const reportType = input.reportType === "ads" ? "ads_campaign" : input.reportType === "search-term" ? "search_term" : input.reportType;
  if (!COLLECTION_REPORT_TYPES[input.source]?.has(reportType)) return "所选报告类型不支持当前采集来源";
  if (input.frequencyMinutes !== undefined) {
    const frequency = asFiniteNumber(input.frequencyMinutes);
    if (frequency === null || frequency < 5) return "采集间隔不能小于 5 分钟";
  }
  return null;
}

function validateReportImport(input, store, excludeId) {
  if (!asText(input.name || input.fileName)) return "报表文件名不能为空";
  if (!asText(input.reportType)) return "报表类型不能为空";
  const source = asText(input.source || "local_csv");
  const reportType = input.reportType === "ads" ? "ads_campaign" : input.reportType === "search-term" ? "search_term" : input.reportType;
  if (!REPORT_IMPORT_TYPES[source]?.has(reportType)) return "所选报告类型与文件来源不兼容";
  const fileName = asText(input.fileName || input.name).toLowerCase();
  if (
    store.reportImports.some(
      (item) =>
        item.id !== excludeId &&
        asText(item.fileName || item.name).toLowerCase() === fileName,
    )
  ) {
    return "当前店铺已导入同名报表";
  }
  if (input.rowCount !== undefined) {
    const rowCount = asFiniteNumber(input.rowCount);
    if (rowCount === null || rowCount < 0 || !Number.isInteger(rowCount)) {
      return "报表行数必须是非负整数";
    }
  }
  return null;
}

function validatePolicy(input, store, excludeId) {
  if (!asText(input.name)) return "策略名称不能为空";
  if (
    store.policies.some(
      (policy) =>
        policy.id !== excludeId &&
        policy.name.trim().toLowerCase() === input.name.trim().toLowerCase(),
    )
  ) {
    return "当前店铺已存在同名策略";
  }
  if (!input.rules || typeof input.rules !== "object") return "策略规则不能为空";

  for (const key of [
    "maxAutoBidDecreasePct",
    "maxAutoBidIncreasePct",
    "maxDailyBudgetChangePct",
    "minDataFreshnessMinutes",
  ]) {
    if (input.rules[key] !== undefined) {
      const value = asFiniteNumber(input.rules[key]);
      const hardLimit = key === "maxAutoBidDecreasePct"
        ? ABSOLUTE_AUTO_BID_DECREASE_LIMIT_PCT
        : key === "maxAutoBidIncreasePct"
          ? ABSOLUTE_AUTO_BID_INCREASE_LIMIT_PCT
          : key === "maxDailyBudgetChangePct"
            ? ABSOLUTE_AUTO_BUDGET_CHANGE_LIMIT_PCT
          : Number.POSITIVE_INFINITY;
      if (value === null || value < 0 || value > hardLimit) {
        return key + " 超出允许范围";
      }
    }
  }

  const rules = input.rules || {};
  const isFreshnessPolicy =
    input.scope === "data" ||
    rules.metric === "dataFreshnessMinutes" ||
    rules.minDataFreshnessMinutes !== undefined;
  if (isFreshnessPolicy && input.scope !== "data") {
    return "数据新鲜度策略必须使用数据质量门范围";
  }
  if (!isFreshnessPolicy && input.scope === "data") {
    return "经营动作策略不能使用数据质量门范围";
  }
  if (isFreshnessPolicy && rules.action && rules.action !== "block") {
    return "数据新鲜度越界必须直接阻断";
  }
  if ((rules.metric === "budgetChangePct" || rules.maxDailyBudgetChangePct !== undefined) && input.scope === "bid") {
    return "预算策略不能使用竞价对象范围";
  }
  if ((rules.metric === "bidChangePct" || rules.maxAutoBidDecreasePct !== undefined) && input.scope === "budget") {
    return "竞价策略不能使用预算对象范围";
  }
  if (typeof input.scope !== "string" || !["store", "bid", "budget", "data"].includes(input.scope) && !input.scope.startsWith("product:") && !input.scope.startsWith("adObject:")) {
    return "策略作用范围无效";
  }
  if (input.scope.startsWith("product:")) {
    const productId = input.scope.slice("product:".length);
    if (!store.products.some((product) => product.id === productId && !product.archived && !["archived", "deleted", "disabled"].includes(product.status))) {
      return "策略关联的产品不存在或不可用";
    }
  }
  if (input.scope.startsWith("adObject:")) {
    const adObjectId = input.scope.slice("adObject:".length);
    const adObject = store.adObjects.find((item) => item.id === adObjectId);
    if (!adObject || adObject.archived || ["archived", "deleted", "disabled", "paused"].includes(adObject.status)) {
      return "策略关联的广告对象不存在或未启用";
    }
    const budgetPolicy = rules.metric === "budgetChangePct" || rules.maxDailyBudgetChangePct !== undefined;
    const bidPolicy = rules.metric === "bidChangePct" || rules.maxAutoBidDecreasePct !== undefined;
    if (budgetPolicy && adObject.type !== "campaign") return "日预算策略只能绑定广告活动";
    if (bidPolicy && !["keyword", "target"].includes(adObject.type)) return "竞价策略只能绑定关键词或商品投放对象";
  }
  return null;
}

function validateExperiment(input, store, excludeId) {
  if (!asText(input.name)) return "实验名称不能为空";
  if (!asText(input.hypothesis)) return "实验假设不能为空";
  if (!asText(input.primaryMetric)) return "实验必须指定主指标";
  if (!excludeId && input.status && input.status !== "draft") return "新实验必须先保存为草稿，再通过专用动作启动";
  if (input.productId && !store.products.some((item) => item.id === input.productId && !item.archived && item.status !== "archived")) {
    return "实验关联的产品不存在";
  }
  if (input.adObjectId && !store.adObjects.some((item) => item.id === input.adObjectId && !item.archived && !["archived", "deleted"].includes(item.status))) {
    return "实验关联的广告对象不存在";
  }
  if (input.productId && input.adObjectId && !store.adObjects.some((item) => item.id === input.adObjectId && item.productId === input.productId)) {
    return "实验关联的广告对象不属于所选产品";
  }
  if (input.missionId && !store.missions.some((item) => item.id === input.missionId && !item.archived && !["archived", "completed"].includes(item.status))) {
    return "实验关联的 Mission 不存在或已封存";
  }
  if (input.missionId && input.productId) {
    const mission = store.missions.find((item) => item.id === input.missionId);
    if (mission?.productId && mission.productId !== input.productId) return "实验关联的 Mission 不属于所选产品";
  }
  const previous = excludeId ? store.experiments.find((item) => item.id === excludeId) : null;
  if (previous) {
    if (previous.status === "completed") return "已完成实验为只读；如需继续验证，请新建实验";
    const relationshipChanged = ["productId", "adObjectId", "missionId"].some((field) => String(previous[field] || "") !== String(input[field] || ""));
    const hasCausalHistory = (Array.isArray(previous.records) && previous.records.length > 0)
      || store.causalLedger.some((record) => (
        String(record.experimentId || record.entityId || "") === previous.id
        || firstArray(record.links).map(String).includes(previous.id)
      ) && !(record.type === "entity_mutation" && record.entityType === "experiment" && record.entityId === previous.id));
    if (relationshipChanged && hasCausalHistory) return "实验已有因果记录，不能更改产品、广告对象或 Mission；请新建实验";
  }
  return null;
}

function normalizeProduct(input, previous, action) {
  const at = nowFor(action);
  return {
    ...(previous || {}),
    ...input,
    id: previous?.id || input.id || makeEntityId("product", action),
    name: asText(input.name),
    asin: asText(input.asin).toUpperCase(),
    sku: asText(input.sku) || previous?.sku || "",
    status: input.status || previous?.status || "active",
    price:
      input.price === undefined ? previous?.price ?? 0 : asFiniteNumber(input.price),
    cost:
      input.cost === undefined ? previous?.cost ?? 0 : asFiniteNumber(input.cost),
    targetAcos:
      input.targetAcos === undefined
        ? previous?.targetAcos ?? 0
        : asFiniteNumber(input.targetAcos),
    createdAt: previous?.createdAt || at,
    updatedAt: at,
  };
}

function normalizeAdObject(input, previous, action) {
  const at = nowFor(action);
  return {
    ...(previous || {}),
    ...input,
    id: previous?.id || input.id || makeEntityId("ad", action),
    name: asText(input.name),
    externalId: asText(input.externalId),
    status: input.status || previous?.status || "enabled",
    bid: input.bid === undefined ? previous?.bid ?? null : asFiniteNumber(input.bid),
    dailyBudget: input.dailyBudget === undefined ? previous?.dailyBudget ?? null : asFiniteNumber(input.dailyBudget),
    targetAcos: input.targetAcos === undefined ? previous?.targetAcos ?? null : asFiniteNumber(input.targetAcos),
    createdAt: previous?.createdAt || at,
    updatedAt: at,
  };
}

function normalizeCollectionJob(input, previous, action) {
  const at = nowFor(action);
  const reportType = input.reportType === "ads" ? "ads_campaign" : input.reportType === "search-term" ? "search_term" : input.reportType;
  return {
    ...(previous || {}),
    ...input,
    id: previous?.id || input.id || makeEntityId("collect", action),
    name: asText(input.name),
    reportType,
    kind: "job",
    status: input.status || previous?.status || "idle",
    frequencyMinutes:
      input.frequencyMinutes === undefined
        ? previous?.frequencyMinutes ?? 60
        : asFiniteNumber(input.frequencyMinutes),
    progress: previous?.progress ?? 0,
    createdAt: previous?.createdAt || at,
    updatedAt: at,
  };
}

function normalizeReportImport(input, previous, action) {
  const at = nowFor(action);
  const fileName = asText(input.fileName || input.name);
  return {
    ...(previous || {}),
    ...input,
    id: previous?.id || input.id || makeEntityId("report", action),
    name: asText(input.name) || fileName,
    fileName,
    source: input.source || previous?.source || "lingxing",
    reportType: asText(input.reportType),
    status: input.status || previous?.status || "imported",
    rowCount:
      input.rowCount === undefined
        ? previous?.rowCount ?? 0
        : asFiniteNumber(input.rowCount),
    importedAt: input.importedAt || previous?.importedAt || at,
    createdAt: previous?.createdAt || at,
    updatedAt: at,
  };
}

function policySnapshotOf(policy, validTo = null) {
  if (!policy) return null;
  return {
    id: policy.id,
    version: Number(policy.version || 1),
    name: policy.name,
    scope: policy.scope,
    status: policy.status,
    priority: policy.priority,
    riskBudget: policy.riskBudget,
    rules: clone(policy.rules || {}),
    validFrom: policy.updatedAt || policy.createdAt || null,
    validTo,
  };
}

function policySemanticSignature(policy) {
  return stableSerialize({
    name: asText(policy?.name),
    scope: asText(policy?.scope || "store"),
    status: asText(policy?.status || "active"),
    priority: asFiniteNumber(policy?.priority),
    riskBudget: asFiniteNumber(policy?.riskBudget),
    rules: policy?.rules || {},
  });
}

function normalizePolicy(input, previous, action) {
  const at = nowFor(action);
  const previousVersion = Number(previous?.version || 1);
  return {
    ...(previous || {}),
    ...input,
    id: previous?.id || input.id || makeEntityId("policy", action),
    name: asText(input.name),
    status: input.status || previous?.status || "active",
    rules: input.rules
      ? { ...input.rules }
      : { ...(previous?.rules || {}) },
    version: previous ? previousVersion + 1 : Number(input.version || 1),
    versionHistory: previous
      ? [...firstArray(previous.versionHistory), policySnapshotOf(previous, at)]
      : firstArray(input.versionHistory),
    createdAt: previous?.createdAt || at,
    updatedAt: at,
  };
}

function normalizeExperiment(input, previous, action) {
  const at = nowFor(action);
  return {
    ...(previous || {}),
    ...input,
    id: previous?.id || input.id || makeEntityId("experiment", action),
    name: asText(input.name),
    hypothesis: asText(input.hypothesis),
    primaryMetric: asText(input.primaryMetric),
    status: previous?.status || "draft",
    records: Array.isArray(input.records)
      ? input.records
      : previous?.records || [],
    createdAt: previous?.createdAt || at,
    updatedAt: at,
  };
}

const CRUD_CONFIG = {
  PRODUCT: {
    entityName: "product",
    entityLabel: "产品",
    collection: "products",
    idPrefix: "product",
    validate: validateProduct,
    normalize: normalizeProduct,
  },
  AD_OBJECT: {
    entityName: "adObject",
    entityLabel: "广告对象",
    collection: "adObjects",
    idPrefix: "ad",
    validate: validateAdObject,
    normalize: normalizeAdObject,
  },
  COLLECTION_JOB: {
    entityName: "collectionJob",
    entityLabel: "采集任务",
    collection: "collectionRuns",
    idPrefix: "collect",
    validate: validateCollectionJob,
    normalize: normalizeCollectionJob,
  },
  REPORT_IMPORT: {
    entityName: "reportImport",
    entityLabel: "报表导入",
    collection: "reportImports",
    idPrefix: "report",
    validate: validateReportImport,
    normalize: normalizeReportImport,
  },
  POLICY: {
    entityName: "policy",
    entityLabel: "策略",
    collection: "policies",
    idPrefix: "policy",
    validate: validatePolicy,
    normalize: normalizePolicy,
  },
  EXPERIMENT: {
    entityName: "experiment",
    entityLabel: "实验",
    collection: "experiments",
    idPrefix: "experiment",
    validate: validateExperiment,
    normalize: normalizeExperiment,
  },
};

function maintainProductSelection(store) {
  if (store.products.some((item) => item.id === store.selectedProductId && !item.archived && item.status !== "archived")) {
    return store;
  }
  const fallback = store.products.find((item) => !item.archived && item.status !== "archived") || null;
  return {
    ...store,
    selectedProductId: fallback?.id || null,
  };
}

function reduceCrud(state, action, entityType, verb) {
  const config = CRUD_CONFIG[entityType];
  if (!config) return state;

  return updateStore(state, action, (store) => {
    const list = store[config.collection] || [];
    const targetId = targetIdFor(action, config.entityName);
    const previous = targetId ? list.find((item) => item.id === targetId) : null;

    if (verb !== "create" && !previous) {
      return reject(
        store,
        action,
        config.entityLabel + "不存在，操作未执行",
        config.entityName,
        targetId,
      );
    }

    if (["archive", "delete"].includes(verb) && entityType === "POLICY") {
      const referenced = verb === "delete"
        ? store.decisions.some((decision) => decision.policyId === targetId || decision.approval?.policyId === targetId)
          || store.executionQueue.some((execution) => execution.policyId === targetId)
          || store.causalLedger.some((entry) => (entry.policyId === targetId || firstArray(entry.links).includes(targetId))
            && !(entry.type === "entity_mutation" && entry.entityType === "policy" && entry.entityId === targetId && entry.intervention === "create"))
        : store.decisions.some(
            (decision) => decision.policyId === targetId && !["rejected", "verified", "archived", "completed"].includes(decision.status),
          );
      if (referenced) {
        return reject(
          store,
          action,
          verb === "delete" ? "策略已被历史决策、执行或因果记录引用，必须保留以便审计" : "策略仍被活动决策引用，请先完成或拒绝关联决策",
          "policy",
          targetId,
        );
      }
    }

    if (["archive", "delete"].includes(verb) && entityType === "PRODUCT") {
      const dependencyCount = store.adObjects.filter((item) => item.productId === targetId).length
        + store.missions.filter((item) => item.productId === targetId).length
        + store.experiments.filter((item) => item.productId === targetId).length
        + store.decisions.filter((item) => item.productId === targetId).length
        + store.executionQueue.filter((item) => item.productId === targetId).length
        + store.policies.filter((item) => item.scope === `product:${targetId}`).length;
      if (dependencyCount) {
        return reject(
          store,
          action,
          `产品仍被 ${dependencyCount} 个业务对象或历史链路引用，请先处理依赖`,
          "product",
          targetId,
        );
      }
    }

    if (["archive", "delete"].includes(verb) && entityType === "AD_OBJECT") {
      const dependencyCount = store.adObjects.filter((item) => item.parentId === targetId).length
        + store.experiments.filter((item) => item.adObjectId === targetId).length
        + store.decisions.filter((item) => item.adObjectId === targetId).length
        + store.executionQueue.filter((item) => item.adObjectId === targetId).length
        + store.policies.filter((item) => item.scope === `adObject:${targetId}`).length;
      if (dependencyCount) {
        return reject(
          store,
          action,
          `广告对象仍被 ${dependencyCount} 个下级对象或业务链路引用，请先处理依赖`,
          "adObject",
          targetId,
        );
      }
    }

    if (verb === "delete" && entityType === "COLLECTION_JOB") {
      const importedReports = store.reportImports.filter((item) => item.collectionJobId === targetId);
      if (importedReports.length) {
        return reject(
          store,
          action,
          `采集任务已生成 ${importedReports.length} 份入库报告，只能归档以保留来源链路`,
          "collectionJob",
          targetId,
        );
      }
    }

    if (verb === "delete" && entityType === "EXPERIMENT") {
      if (!previous.archived && previous.status !== "archived") {
        return reject(store, action, "只能删除已归档实验", "experiment", targetId);
      }
      const referencedByMission = store.missions.some((mission) => (
        mission.id === previous.missionId || firstArray(mission.experimentIds).map(String).includes(targetId)
      ));
      const referencedByDecision = store.decisions.some((decision) => (
        decision.experimentId === targetId || firstArray(decision.links).map(String).includes(targetId)
      ));
      const referencedByExecution = store.executionQueue.some((execution) => (
        execution.experimentId === targetId || firstArray(execution.links).map(String).includes(targetId)
      ));
      const referencedByCausal = store.causalLedger.some((entry) => (
        String(entry.experimentId || "") === targetId || firstArray(entry.links).map(String).includes(targetId)
      ) && !(entry.type === "entity_mutation" && entry.entityType === "experiment" && entry.entityId === targetId));
      if (referencedByMission || referencedByDecision || referencedByExecution || referencedByCausal) {
        return reject(
          store,
          action,
          "实验已被 Mission、决策、执行或因果记录引用，只能保留归档以维持历史链路",
          "experiment",
          targetId,
        );
      }
    }

    let entity;
    let nextList;

    if (verb === "create") {
      const input = payloadFor(action, config.entityName);
      if (input.id && list.some((item) => item.id === input.id)) {
        return reject(store, action, `${config.entityLabel}内部 ID 已存在，创建已阻断`, config.entityName, input.id);
      }
      const error = config.validate(input, store, null);
      if (error) return reject(store, action, error, config.entityName, input.id);
      entity = config.normalize(input, null, action);
      if (list.some((item) => item.id === entity.id)) {
        return reject(store, action, `${config.entityLabel}内部 ID 已存在，创建已阻断`, config.entityName, entity.id);
      }
      nextList = [entity, ...list];
    } else if (verb === "update") {
      const input = payloadFor(action, config.entityName);
      if ((!previous.archived && input.archived === true) || (!["archived", "deleted"].includes(previous.status) && ["archived", "deleted"].includes(input.status))) {
        return reject(store, action, `${config.entityLabel}归档或删除必须使用专用操作`, config.entityName, previous.id);
      }
      if (entityType === "EXPERIMENT" && input.status && input.status !== previous.status) {
        return reject(store, action, "实验状态只能通过暂停、恢复或归档操作改变", "experiment", previous.id);
      }
      const merged = { ...previous, ...input, id: previous.id };
      const error = config.validate(merged, store, previous.id);
      if (error) return reject(store, action, error, config.entityName, previous.id);
      if (entityType === "POLICY" && policySemanticSignature(previous) === policySemanticSignature(merged)) {
        return appendAudit(store, action, {
          outcome: "success",
          entityType: "policy",
          entityId: previous.id,
          summary: `策略「${previous.name}」无语义变化，保留 v${previous.version || 1}`,
          details: { noOp: true, policyVersion: previous.version || 1 },
        });
      }
      entity = config.normalize(merged, previous, action);
      nextList = list.map((item) => (item.id === previous.id ? entity : item));
    } else if (verb === "archive") {
      entity = {
        ...previous,
        status: "archived",
        archived: true,
        archivedAt: nowFor(action),
        updatedAt: nowFor(action),
      };
      nextList = list.map((item) => (item.id === previous.id ? entity : item));
    } else if (verb === "restore" && entityType === "EXPERIMENT") {
      if (!previous.archived && previous.status !== "archived") return reject(store, action, "只有已归档实验可以恢复", "experiment", previous.id);
      const restored = { ...previous, status: "paused", archived: false, archivedAt: null };
      const error = config.validate(restored, store, previous.id);
      if (error) return reject(store, action, error, "experiment", previous.id);
      entity = { ...restored, updatedAt: nowFor(action) };
      nextList = list.map((item) => item.id === previous.id ? entity : item);
    } else if (verb === "delete") {
      entity = previous;
      nextList = list.filter((item) => item.id !== previous.id);
    } else {
      return store;
    }

    let nextStore = {
      ...store,
      [config.collection]: nextList,
    };

    if (entityType === "PRODUCT") nextStore = maintainProductSelection(nextStore);

    if (entityType === "POLICY" && verb === "update") {
      const affectedDecisionIds = new Set(
        nextStore.decisions
          .filter((decision) => decision.policyId === entity.id && !["rejected", "executed", "completed", "verified", "archived"].includes(decision.status))
          .map((decision) => decision.id),
      );
      if (affectedDecisionIds.size) {
        const changedAt = nowFor(action);
        nextStore = {
          ...nextStore,
          decisions: nextStore.decisions.map((decision) => affectedDecisionIds.has(decision.id)
            ? {
                ...decision,
                policyHistory: [...firstArray(decision.policyHistory), {
                  policyId: decision.policyId,
                  policyVersion: decision.policyVersion || decision.policySnapshot?.version || null,
                  policySnapshot: decision.policySnapshot || policySnapshotOf(previous),
                  decisionStatus: decision.status,
                  closedAt: changedAt,
                }],
                policyVersion: entity.version,
                policySnapshot: policySnapshotOf(entity),
                status: "needs_approval",
                policyBound: false,
                autoExecutable: false,
                approval: {
                  ...(decision.approval || {}),
                  required: true,
                  status: "waiting",
                  approvedBy: null,
                  approvedAt: null,
                  policyId: entity.id,
                  policyVersion: entity.version,
                  reason: "关联策略已更新，必须基于当前版本重新评估并审批",
                },
                updatedAt: changedAt,
              }
            : decision),
          executionQueue: nextStore.executionQueue.map((item) => affectedDecisionIds.has(item.decisionId) && !["applied", "verified", "completed", "skipped"].includes(item.status)
            ? {
                ...item,
                status: "awaiting_approval",
                autoEligible: false,
                policyBound: false,
                policyId: entity.id,
                policyVersion: entity.version,
                policySnapshot: policySnapshotOf(entity),
                executionMode: "human_only",
                owner: "operator",
                blockedReason: "关联策略已更新，等待重新审批",
                updatedAt: changedAt,
              }
            : item),
        };
      }
    }

    const verbLabel = {
      create: "已创建",
      update: "已更新",
      archive: "已归档",
      restore: "已恢复",
      delete: "已删除",
    }[verb];

    return succeed(
      nextStore,
      action,
      {
        entityType: config.entityName,
        entityId: entity.id,
        summary: verbLabel + config.entityLabel + "「" + (entity.name || entity.id) + "」",
        details: entityType === "POLICY" ? {
          policyVersion: entity.version || null,
          before: previous ? policySnapshotOf(previous) : null,
          after: verb === "delete" ? null : policySnapshotOf(entity),
        } : null,
      },
      {
        type: "entity_mutation",
        entityType: config.entityName,
        entityId: entity.id,
        productId: entityType === "PRODUCT" ? entity.id : entity.productId || null,
        adObjectId: entityType === "AD_OBJECT" ? entity.id : entity.adObjectId || null,
        experimentId: entityType === "EXPERIMENT" ? entity.id : null,
        missionId: entity.missionId || null,
        title: verbLabel + config.entityLabel + "「" + (entity.name || entity.id) + "」",
        intervention: verb,
        policyId: entityType === "POLICY" ? entity.id : entity.policyId || null,
        policyVersion: entityType === "POLICY" ? entity.version || null : entity.policyVersion || null,
        beforeSnapshot: entityType === "POLICY" && previous ? policySnapshotOf(previous) : null,
        afterSnapshot: entityType === "POLICY" && verb !== "delete" ? policySnapshotOf(entity) : null,
        status: verb === "delete" ? "closed" : "recorded",
      },
    );
  });
}

function reduceCollectionRun(state, action) {
  return updateStore(state, action, (store) => {
    const collectionJobId = targetIdFor(action, "collectionJob");
    const job = store.collectionRuns.find((item) => item.id === collectionJobId);
    if (!job) {
      return reject(
        store,
        action,
        "采集任务不存在，无法立即运行",
        "collectionJob",
        collectionJobId,
      );
    }
    if (job.status === "archived") {
      return reject(
        store,
        action,
        "已归档采集任务不可运行",
        "collectionJob",
        collectionJobId,
      );
    }
    if (job.status === "running") {
      return reject(
        store,
        action,
        "采集任务已在运行，请勿重复启动",
        "collectionJob",
        collectionJobId,
      );
    }
    if (job.source === "lingxing" && store.session.lingxing?.status !== "connected") {
      return reject(
        store,
        action,
        "领星会话未连接，采集任务被安全阻断",
        "collectionJob",
        collectionJobId,
      );
    }
    if (
      job.source === "amazon_ads" &&
      store.session.amazonAds?.status !== "connected"
    ) {
      return reject(
        store,
        action,
        "Amazon Ads 会话未连接，采集任务被安全阻断",
        "collectionJob",
        collectionJobId,
      );
    }

    const at = nowFor(action);
    const deferred = action.defer === true || action.payload?.defer === true;
    const explicitRecords = asFiniteNumber(action.records ?? action.payload?.records);
    const priorRecords = asFiniteNumber(job.records);
    const inferredRecords = Math.max(1, Math.round(
      priorRecords && priorRecords > 0
        ? priorRecords
        : job.source === "amazon_ads"
          ? 684
          : job.reportType === "inventory"
            ? 326
            : job.reportType === "listing"
              ? 148
              : 1284,
    ));
    const records = explicitRecords === null ? inferredRecords : Math.max(0, Math.round(explicitRecords));
    const emptyResult = !deferred && records === 0;
    const canonicalReportType = job.reportType === "ads" ? "ads_campaign" : job.reportType === "search-term" ? "search_term" : job.reportType || (job.source === "amazon_ads" ? "ads_campaign" : "business");
    const businessDate = businessDateFor(at, businessTimezoneOf(store));
    const dateToken = businessDate.replaceAll("-", "");
    const runNumber = Number(job.runCount || 0) + 1;
    const jobToken = String(job.id || "job").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(-12);
    const reportFileName = `${store.id}_${canonicalReportType}_${jobToken}_${dateToken}_r${String(runNumber).padStart(2, "0")}.xlsx`;
    const evidence = deferred ? job.lastEvidence || null : {
      id: makeEntityId("collection-evidence", action),
      fileName: reportFileName,
      rowCount: records,
      capturedAt: at,
      sessionId: store.session?.id || null,
      profile: store.browserProfileId || store.session?.profile || `${store.id.toLowerCase()}-profile`,
      source: job.source,
      status: emptyResult ? "empty" : "verified",
    };
    const nextJob = {
      ...job,
      reportType: canonicalReportType,
      status: deferred ? "running" : emptyResult ? "empty" : "completed",
      progress: deferred ? 12 : 100,
      startedAt: at,
      lastRunAt: deferred ? job.lastRunAt : at,
      completedAt: deferred ? job.completedAt : at,
      records,
      error: emptyResult ? "报告已生成但没有可导入数据，本次不刷新数据新鲜度" : null,
      lastEvidence: evidence,
      runCount: (job.runCount || 0) + 1,
      updatedAt: at,
    };
    const nextStore = {
      ...store,
      collectionRuns: store.collectionRuns.map((item) =>
        item.id === job.id ? nextJob : item,
      ),
      reportImports: deferred || emptyResult
        ? store.reportImports
        : [{
            id: makeEntityId("report", { ...action, meta: { ...(action.meta || {}), eventId: `${eventIdFor(action)}-report` } }),
            name: `${job.name} · 自动下载`,
            fileName: reportFileName,
            source: job.source,
            reportType: canonicalReportType,
            status: "imported",
            rowCount: records,
            period: businessDate,
            periodStart: businessDate,
            periodEnd: businessDate,
            collectionJobId: job.id,
            evidenceId: evidence.id,
            importedAt: at,
            createdAt: at,
            updatedAt: at,
          }, ...store.reportImports],
      session: deferred || emptyResult
        ? store.session
        : job.source === "lingxing"
          ? {
              ...store.session,
              lingxing: {
                ...store.session.lingxing,
                freshnessMinutes: 0,
                lastRunAt: at,
                lastCollectedAt: at,
              },
            }
          : job.source === "amazon_ads"
            ? {
                ...store.session,
                amazonAds: {
                  ...store.session.amazonAds,
                  freshnessMinutes: 0,
                  lastRunAt: at,
                  lastCollectedAt: at,
                },
              }
            : store.session,
    };
    return succeed(
      nextStore,
      action,
      {
        entityType: "collectionJob",
        entityId: job.id,
        summary: deferred
          ? "已启动采集任务「" + job.name + "」"
          : emptyResult
            ? "模拟采集返回空报告，未导入且未刷新数据新鲜度"
            : "已完成一次模拟采集并导入「" + job.name + "」",
      },
      {
        type: "collection",
        entityType: "collectionJob",
        entityId: job.id,
        title: deferred ? "数据采集已启动" : "数据采集已完成",
        signal: job.source,
        observedEffect: deferred
          ? "采集任务正在运行"
          : emptyResult
            ? "报告为 0 行，未写入数据库"
            : "已校验并写入 " + nextJob.records + " 条模拟采集记录",
        status: nextJob.status,
      },
    );
  });
}

function dataFreshnessEvaluation(store) {
  const policy = store.policies
    .filter((item) => {
      const rules = item.rules || {};
      return item.status === "active" && !item.archived && (
        item.scope === "data" ||
        rules.metric === "dataFreshnessMinutes" ||
        rules.minDataFreshnessMinutes !== undefined
      );
    })
    .sort((a, b) => Number(a.priority ?? 50) - Number(b.priority ?? 50))[0];
  if (!policy) return { ok: true, policy: null, freshnessMinutes: null };
  const rules = policy.rules || {};
  if (rules.requireLingxingSession === true && store.session?.lingxing?.status !== "connected") {
    return { ok: false, policy, freshnessMinutes: null, reason: "数据策略要求有效领星会话，当前会话未连接" };
  }
  if (rules.requireAdsSession === true && store.session?.amazonAds?.status !== "connected") {
    return { ok: false, policy, freshnessMinutes: null, reason: "数据策略要求有效 Amazon Ads 会话，当前会话未连接" };
  }
  const limit = asFiniteNumber(
    rules.minDataFreshnessMinutes ?? rules.requireFreshDataMinutes ?? rules.threshold,
  );
  const freshnessMinutes = asFiniteNumber(store.session?.lingxing?.freshnessMinutes);
  if (limit === null) {
    return { ok: false, policy, freshnessMinutes, reason: "数据新鲜度策略缺少有效阈值，执行已阻断" };
  }
  if (freshnessMinutes === null || freshnessMinutes < 0) {
    return { ok: false, policy, freshnessMinutes, reason: "当前数据新鲜度未知，执行已阻断" };
  }
  return freshnessMinutes <= limit
    ? { ok: true, policy, freshnessMinutes }
    : { ok: false, policy, freshnessMinutes, reason: `数据已延迟 ${freshnessMinutes} 分钟，超过 ${limit} 分钟执行门` };
}

function policyEvaluation(store, decision) {
  const beforeBid = asFiniteNumber(decision.beforeBid ?? decision.beforeValue);
  const proposedBid = asFiniteNumber(decision.proposedBid ?? decision.targetValue);
  const beforeBudget = asFiniteNumber(decision.beforeBudget);
  const proposedBudget = asFiniteNumber(decision.proposedBudget);
  const hasBidValue = beforeBid !== null || proposedBid !== null;
  const hasBudgetValue = beforeBudget !== null || proposedBudget !== null;
  const kind = hasBidValue ? "bid" : hasBudgetValue ? "budget" : "generic";

  if (kind === "bid" && (beforeBid === null || beforeBid <= 0 || proposedBid === null || proposedBid <= 0)) {
    return { error: "原竞价和目标竞价必须是正数", kind };
  }
  if (kind === "budget" && (beforeBudget === null || beforeBudget <= 0 || proposedBudget === null || proposedBudget <= 0)) {
    return { error: "原日预算和目标日预算必须是正数", kind };
  }

  if (kind === "generic") {
    const explicitPolicy = store.policies.find(
      (item) => item.id === decision.policyId && item.status === "active" && !item.archived,
    ) || null;
    return {
      error: null,
      kind,
      beforeValue: null,
      proposedValue: null,
      changePct: null,
      changePctExact: null,
      policy: explicitPolicy,
      withinPolicy: false,
      requiresApproval: true,
      blocked: false,
      outsideAction: "require_approval",
      absoluteAutoLimits: null,
      reason: "非数值经营决策必须由运营者人工审批",
    };
  }

  const beforeValue = kind === "bid" ? beforeBid : beforeBudget;
  const proposedValue = kind === "bid" ? proposedBid : proposedBudget;
  const exactChange = ((proposedValue - beforeValue) / beforeValue) * 100;
  const changePct = Math.round(exactChange);
  const decisionAdObject = store.adObjects.find((item) => item.id === decision.adObjectId);
  const decisionProductId = String(decisionAdObject?.productId || decision.productId || "");
  const policyApplies = (item) => {
    if (item.status !== "active" || item.archived) return false;
    const rules = item.rules || {};
    const metricMatches = kind === "bid"
      ? rules.maxAutoBidDecreasePct !== undefined
      : rules.maxDailyBudgetChangePct !== undefined;
    if (!metricMatches) return false;
    if (["store", kind, ""].includes(item.scope || "store")) return true;
    if (item.scope?.startsWith("product:")) {
      return item.scope.slice("product:".length) === decisionProductId;
    }
    if (item.scope?.startsWith("adObject:")) {
      return item.scope.slice("adObject:".length) === String(decision.adObjectId || "");
    }
    return false;
  };
  const candidates = store.policies
    .filter(policyApplies)
    .sort((a, b) => Number(a.priority ?? 50) - Number(b.priority ?? 50));
  const policy = candidates.find((item) => item.id === decision.policyId) || candidates[0];
  const decreasePct = Math.max(0, -exactChange);
  const increasePct = Math.max(0, exactChange);
  const configuredMaxDecrease = kind === "bid"
    ? policy?.rules?.maxAutoBidDecreasePct ?? 0
    : policy?.rules?.maxDailyBudgetChangePct ?? 0;
  const configuredMaxIncrease = kind === "bid"
    ? policy?.rules?.maxAutoBidIncreasePct ?? 0
    : policy?.rules?.maxDailyBudgetChangePct ?? 0;
  const maxDecrease = Math.min(
    configuredMaxDecrease,
    kind === "bid" ? ABSOLUTE_AUTO_BID_DECREASE_LIMIT_PCT : ABSOLUTE_AUTO_BUDGET_CHANGE_LIMIT_PCT,
  );
  const maxIncrease = Math.min(
    configuredMaxIncrease,
    kind === "bid" ? ABSOLUTE_AUTO_BID_INCREASE_LIMIT_PCT : ABSOLUTE_AUTO_BUDGET_CHANGE_LIMIT_PCT,
  );
  const minValue = kind === "bid" ? policy?.rules?.minBid ?? 0 : policy?.rules?.minDailyBudget ?? 0;
  const maxValue = kind === "bid"
    ? policy?.rules?.maxBid ?? Number.POSITIVE_INFINITY
    : policy?.rules?.maxDailyBudget ?? Number.POSITIVE_INFINITY;
  const withinPolicy =
    Boolean(policy) &&
    decreasePct <= maxDecrease &&
    increasePct <= maxIncrease &&
    proposedValue >= minValue &&
    proposedValue <= maxValue;
  const outsideAction = policy?.rules?.action || "require_approval";
  const blocked = Boolean(policy) && !withinPolicy && outsideAction === "block";
  const policyRequiresHuman = Boolean(policy?.rules?.requireHumanApproval);
  const requiresApproval = policyRequiresHuman || (!withinPolicy && !blocked);

  return {
    error: null,
    kind,
    beforeValue: round(beforeValue),
    proposedValue: round(proposedValue),
    beforeBid: kind === "bid" ? round(beforeBid) : null,
    proposedBid: kind === "bid" ? round(proposedBid) : null,
    beforeBudget: kind === "budget" ? round(beforeBudget) : null,
    proposedBudget: kind === "budget" ? round(proposedBudget) : null,
    changePct,
    changePctExact: round(exactChange),
    policy,
    withinPolicy,
    requiresApproval,
    blocked,
    outsideAction,
    absoluteAutoLimits: {
      maxDecreasePct: kind === "bid" ? ABSOLUTE_AUTO_BID_DECREASE_LIMIT_PCT : ABSOLUTE_AUTO_BUDGET_CHANGE_LIMIT_PCT,
      maxIncreasePct: kind === "bid" ? ABSOLUTE_AUTO_BID_INCREASE_LIMIT_PCT : ABSOLUTE_AUTO_BUDGET_CHANGE_LIMIT_PCT,
    },
    reason: withinPolicy
      ? policyRequiresHuman
        ? "策略要求所有匹配动作由运营者人工审批"
        : `变更位于店铺自动${kind === "bid" ? "竞价" : "日预算"}护栏内`
      : !policy
        ? `没有可用的${kind === "bid" ? "竞价" : "日预算"}策略`
        : blocked
          ? "变更超出策略边界并命中强制阻断规则"
        : decreasePct > (kind === "bid" ? ABSOLUTE_AUTO_BID_DECREASE_LIMIT_PCT : ABSOLUTE_AUTO_BUDGET_CHANGE_LIMIT_PCT)
          || increasePct > (kind === "bid" ? ABSOLUTE_AUTO_BID_INCREASE_LIMIT_PCT : ABSOLUTE_AUTO_BUDGET_CHANGE_LIMIT_PCT)
          ? "变更幅度超过系统不可放宽的策略内自动执行硬上限"
          : `变更幅度或目标${kind === "bid" ? "竞价" : "日预算"}超出自动策略护栏`,
  };
}

function updateLinkedExecution(store, decision, patch) {
  const { allowDecisionRewriteRevive = false, ...safePatch } = patch;
  return {
    ...store,
    executionQueue: store.executionQueue.map((item) =>
      item.decisionId === decision.id && (
        !["applied", "verified", "completed", "skipped"].includes(item.status)
        || (allowDecisionRewriteRevive && item.status === "skipped" && item.skipReason === "decision_changed_to_non_numeric")
      )
        ? { ...item, ...safePatch, updatedAt: safePatch.updatedAt }
        : item,
    ),
  };
}

function reduceDecision(state, action, verb) {
  return updateStore(state, action, (store) => {
    const decisionId = targetIdFor(action, "decision");
    const previous = store.decisions.find((item) => item.id === decisionId);
    if (!previous) {
      return reject(store, action, "决策不存在，操作未执行", "decision", decisionId);
    }

    const decisionMission = previous.missionId
      ? store.missions.find((item) => item.id === previous.missionId)
      : null;
    if (["approve", "edit"].includes(verb) && (!decisionMission || ["archived", "completed"].includes(decisionMission.status) || decisionMission.archived)) {
      return reject(
        store,
        action,
        !decisionMission ? "决策缺少有效 Mission 绑定，已按失败关闭" : decisionMission.status === "completed" ? "Mission 已完成，决策不可再进入执行" : "Mission 已归档，决策已封存",
        "decision",
        decisionId,
        { missionId: previous.missionId || null },
      );
    }

    const at = nowFor(action);
    if (verb === "edit") {
      if (["approved", "executed", "verified", "completed"].includes(previous.status)) {
        return reject(
          store,
          action,
          "已批准或已执行的决策不可直接编辑，请创建新的修订决策",
          "decision",
          decisionId,
        );
      }
      const changes = payloadFor(action, "decision");
      const relationshipChanged = ["missionId", "adObjectId", "productId"].some((field) =>
        Object.prototype.hasOwnProperty.call(changes, field)
        && String(changes[field] || "") !== String(previous[field] || ""),
      );
      if (relationshipChanged) {
        return reject(
          store,
          action,
          "决策的 Mission、产品与广告对象关系不可重绑，请创建新决策",
          "decision",
          decisionId,
        );
      }
      const candidate = { ...previous, ...changes, id: previous.id };
      const evaluation = policyEvaluation(store, candidate);
      if (evaluation.error) {
        return reject(store, action, evaluation.error, "decision", decisionId);
      }
      const previousKind = policyEvaluation(store, previous).kind;
      if (previousKind !== evaluation.kind && store.executionQueue.some((item) => item.decisionId === previous.id)) {
        return reject(store, action, "已有执行项的决策不能更改动作类型，请创建新决策", "decision", decisionId);
      }
      if (evaluation.kind !== "generic") {
        const target = executionTargetEvaluation(store, { ...candidate, decisionKind: evaluation.kind });
        if (!target.ok) {
          return reject(store, action, target.reason, "decision", decisionId, {
            adObjectId: candidate.adObjectId || null,
            productId: target.adObject?.productId || candidate.productId || null,
          });
        }
      }

      const modeRequiresApproval = store.mode === "approval" && !evaluation.blocked;
      const approvalRequired = evaluation.requiresApproval || modeRequiresApproval;
      const approvalReason = modeRequiresApproval && evaluation.withinPolicy
        ? "当前店铺处于人工审批模式，策略内动作也必须逐项批准"
        : evaluation.reason;
      const evaluatedValues = evaluation.kind === "bid"
        ? {
            beforeBid: evaluation.beforeBid,
            proposedBid: evaluation.proposedBid,
            changePct: evaluation.changePct,
            changePctExact: evaluation.changePctExact,
          }
        : evaluation.kind === "budget"
          ? {
              beforeBudget: evaluation.beforeBudget,
              proposedBudget: evaluation.proposedBudget,
              changePct: evaluation.changePct,
              changePctExact: evaluation.changePctExact,
            }
          : {};

      const nextDecision = {
        ...candidate,
        ...evaluatedValues,
        decisionKind: evaluation.kind,
        policyId: evaluation.policy?.id || candidate.policyId || null,
        policyVersion: evaluation.policy?.version || candidate.policyVersion || null,
        policySnapshot: policySnapshotOf(evaluation.policy) || candidate.policySnapshot || null,
        policyBound: evaluation.withinPolicy,
        autoExecutable: evaluation.withinPolicy && !evaluation.requiresApproval,
        status: evaluation.blocked ? "blocked" : approvalRequired ? "needs_approval" : "proposed",
        approval: {
          required: approvalRequired,
          status: evaluation.blocked ? "blocked" : approvalRequired ? "waiting" : "policy_eligible",
          modeRequired: modeRequiresApproval,
          reason: approvalReason,
          policyId: evaluation.policy?.id || null,
        },
        updatedAt: at,
      };
      let nextStore = {
        ...store,
        decisions: store.decisions.map((item) =>
          item.id === decisionId ? nextDecision : item,
        ),
      };
      nextStore = updateLinkedExecution(nextStore, nextDecision, {
        allowDecisionRewriteRevive: evaluation.kind !== "generic",
        beforeValue: evaluation.beforeValue,
        targetValue: evaluation.proposedValue,
        deltaPct: nextDecision.changePct,
        autoEligible: evaluation.kind !== "generic" && nextDecision.autoExecutable && store.mode === "auto",
        policyBound: nextDecision.policyBound,
        policyId: nextDecision.policyId || null,
        policyVersion: nextDecision.policyVersion || null,
        policySnapshot: nextDecision.policySnapshot || null,
        status: evaluation.kind === "generic" ? "skipped" : evaluation.blocked ? "blocked" : nextDecision.approval.required ? "awaiting_approval" : "ready",
        executionMode: evaluation.kind !== "generic" && nextDecision.autoExecutable && store.mode === "auto" ? "policy_auto" : "human_only",
        blockedReason: evaluation.kind === "generic" ? "决策已改为非数值经营动作，不再复用原广告写入项" : evaluation.blocked || nextDecision.approval.required ? nextDecision.approval.reason : null,
        skipReason: evaluation.kind === "generic" ? "decision_changed_to_non_numeric" : null,
        updatedAt: at,
      });
      return succeed(
        nextStore,
        action,
        {
          entityType: "decision",
          entityId: decisionId,
          summary: evaluation.kind === "generic"
            ? "已编辑经营决策「" + nextDecision.title + "」"
            : "已编辑决策，目标" + (evaluation.kind === "bid" ? "竞价 " : "日预算 ") +
              evaluation.beforeValue.toFixed(2) + " → " + evaluation.proposedValue.toFixed(2) +
              "（" + nextDecision.changePct + "%）",
        },
        {
          type: "decision_revision",
          entityType: "decision",
          entityId: decisionId,
          missionId: nextDecision.missionId,
          title: "Crux 决策已修订",
          intervention: evaluation.kind === "generic"
            ? nextDecision.recommendation || nextDecision.proposedAction || nextDecision.title
            : evaluation.beforeValue + " → " + evaluation.proposedValue,
          expectedEffect: nextDecision.expectedEffect || null,
          status: nextDecision.status,
          links: nextDecision.policyId ? [nextDecision.policyId] : [],
        },
      );
    }

    if (verb === "approve") {
      if (previous.status === "blocked") {
        return reject(
          store,
          action,
          "该决策命中强制阻断规则，必须先编辑建议或策略",
          "decision",
          decisionId,
        );
      }
      if (previous.status === "rejected") {
        return reject(
          store,
          action,
          "已拒绝的决策需先编辑后再审批",
          "decision",
          decisionId,
        );
      }
      if (!["proposed", "needs_approval", "awaiting_approval", "pending", "draft"].includes(previous.status)) {
        return reject(
          store,
          action,
          "当前决策状态不能再次批准，执行状态保持不变",
          "decision",
          decisionId,
          { currentStatus: previous.status },
        );
      }
      const humanPrincipal = explicitHumanApprovalPrincipal(store, action);
      if (!humanPrincipal) {
        return reject(
          store,
          action,
          "审批必须由当前运营者显式确认，自动身份或缺失身份不能批准",
          "decision",
          decisionId,
        );
      }
      const liveEvaluation = policyEvaluation(store, previous);
      if (liveEvaluation.error) {
        return reject(store, action, liveEvaluation.error, "decision", decisionId);
      }
      if (liveEvaluation.kind !== "generic") {
        const target = executionTargetEvaluation(store, { ...previous, decisionKind: liveEvaluation.kind });
        if (!target.ok) {
          return reject(store, action, target.reason, "decision", decisionId, {
            adObjectId: previous.adObjectId || null,
            productId: target.adObject?.productId || previous.productId || null,
          });
        }
      }
      if (liveEvaluation.kind !== "generic" && !liveEvaluation.policy) {
        return reject(store, action, "当前没有可用策略，不能批准数值写入决策", "decision", decisionId);
      }
      if (liveEvaluation.blocked) {
        const blockedDecision = {
          ...previous,
          status: "blocked",
          policyId: liveEvaluation.policy?.id || previous.policyId || null,
          policyBound: false,
          autoExecutable: false,
          approval: {
            ...(previous.approval || {}),
            required: false,
            status: "blocked",
            reason: liveEvaluation.reason,
            policyId: liveEvaluation.policy?.id || null,
          },
          updatedAt: at,
        };
        let blockedStore = {
          ...store,
          decisions: store.decisions.map((item) => item.id === decisionId ? blockedDecision : item),
        };
        blockedStore = updateLinkedExecution(blockedStore, blockedDecision, {
          status: "blocked",
          autoEligible: false,
          policyBound: false,
          executionMode: "human_only",
          owner: "operator",
          blockedReason: liveEvaluation.reason,
          updatedAt: at,
        });
        return reject(
          blockedStore,
          action,
          "当前策略已变化并要求强制阻断，请先编辑建议或策略",
          "decision",
          decisionId,
          { policyId: liveEvaluation.policy?.id || null },
        );
      }
      const nextDecision = {
        ...previous,
        status: "approved",
        policyId: liveEvaluation.policy?.id || previous.policyId || null,
        policyVersion: liveEvaluation.policy?.version || previous.policyVersion || null,
        policySnapshot: policySnapshotOf(liveEvaluation.policy) || previous.policySnapshot || null,
        policyBound: liveEvaluation.withinPolicy,
        autoExecutable: liveEvaluation.withinPolicy && !liveEvaluation.requiresApproval,
        approval: {
          ...(previous.approval || {}),
          required: previous.approval?.required ?? !previous.autoExecutable,
          status: "approved",
          modeRequired: false,
          approvedBy: humanPrincipal,
          approvedAt: at,
          policyId: liveEvaluation.policy?.id || null,
          note: action.note || action.payload?.note || null,
        },
        updatedAt: at,
      };
      let nextStore = {
        ...store,
        decisions: store.decisions.map((item) =>
          item.id === decisionId ? nextDecision : item,
        ),
      };
      nextStore = updateLinkedExecution(nextStore, nextDecision, {
        status: "ready",
        policyId: nextDecision.policyId || null,
        policyVersion: nextDecision.policyVersion || null,
        policySnapshot: nextDecision.policySnapshot || null,
        executionMode: store.mode === "auto" && nextDecision.autoExecutable ? "policy_auto" : "human_only",
        owner: store.mode === "auto" && nextDecision.autoExecutable ? "agent" : "operator",
        blockedReason: null,
        updatedAt: at,
      });
      if (
        liveEvaluation.kind !== "generic" &&
        !nextStore.executionQueue.some((item) => item.decisionId === nextDecision.id)
      ) {
        const execution = {
          id: makeEntityId("execution", action),
          missionId: nextDecision.missionId || null,
          decisionId: nextDecision.id,
          adObjectId: nextDecision.adObjectId || null,
          productId: nextDecision.productId || null,
          title: nextDecision.recommendation || nextDecision.proposedAction || nextDecision.title,
          actionType: liveEvaluation.kind === "budget" ? "日预算调整" : "关键词出价调整",
          decisionKind: liveEvaluation.kind,
          beforeValue: liveEvaluation.beforeValue,
          targetValue: liveEvaluation.proposedValue,
          deltaPct: liveEvaluation.changePct,
          status: "ready",
          autoEligible: false,
          policyBound: liveEvaluation.withinPolicy,
          policyId: liveEvaluation.policy?.id || nextDecision.policyId || null,
          policyVersion: liveEvaluation.policy?.version || nextDecision.policyVersion || null,
          policySnapshot: policySnapshotOf(liveEvaluation.policy) || nextDecision.policySnapshot || null,
          executionMode: "human_only",
          owner: "operator",
          createdAt: at,
          updatedAt: at,
        };
        nextStore = {
          ...nextStore,
          executionQueue: [execution, ...nextStore.executionQueue],
        };
      }
      return succeed(
        nextStore,
        action,
        {
          entityType: "decision",
          entityId: decisionId,
          summary: "已批准决策「" + previous.title + "」",
        },
        {
          type: "approval",
          entityType: "decision",
          entityId: decisionId,
          missionId: previous.missionId,
          title: "人工批准 Crux 决策",
          intervention: previous.proposedBid
            ? "批准目标竞价 " + previous.proposedBid
            : previous.proposedBudget
              ? "批准目标日预算 " + previous.proposedBudget
              : "批准执行",
          status: "approved",
        },
      );
    }

    if (verb === "reject") {
      if (["approved", "executed", "verified", "completed"].includes(previous.status)) {
        return reject(
          store,
          action,
          "已批准或已执行的决策不能回退为拒绝，请创建新的修订决策",
          "decision",
          decisionId,
          { currentStatus: previous.status },
        );
      }
      const nextDecision = {
        ...previous,
        status: "rejected",
        approval: {
          ...(previous.approval || {}),
          status: "rejected",
          rejectedBy: actorFor(action),
          rejectedAt: at,
          note: action.note || action.payload?.note || "运营者拒绝",
        },
        updatedAt: at,
      };
      let nextStore = {
        ...store,
        decisions: store.decisions.map((item) =>
          item.id === decisionId ? nextDecision : item,
        ),
      };
      nextStore = updateLinkedExecution(nextStore, nextDecision, {
        status: "blocked",
        blockedReason: "关联决策已被拒绝",
        updatedAt: at,
      });
      return succeed(
        nextStore,
        action,
        {
          entityType: "decision",
          entityId: decisionId,
          summary: "已拒绝决策「" + previous.title + "」",
        },
        {
          type: "approval",
          entityType: "decision",
          entityId: decisionId,
          missionId: previous.missionId,
          title: "Crux 决策被拒绝",
          observedEffect: nextDecision.approval.note,
          status: "rejected",
        },
      );
    }

    return store;
  });
}

function reduceMissionCrud(state, action, verb) {
  return updateStore(state, action, (store) => {
    const missionId = targetIdFor(action, "mission");
    const previous = missionId ? store.missions.find((item) => item.id === missionId) : null;
    const input = payloadFor(action, "mission");
    const at = nowFor(action);
    if (verb !== "create" && !previous) return reject(store, action, "Mission 不存在，操作未执行", "mission", missionId);
    const validate = (candidate, excludeId) => {
      if (!asText(candidate.title)) return "Mission 标题不能为空";
      if (!asText(candidate.objective)) return "Mission 经营目标不能为空";
      if (candidate.productId && !store.products.some((item) => item.id === candidate.productId && !item.archived && item.status !== "archived")) return "Mission 关联产品不存在或已归档";
      if (store.missions.some((item) => item.id !== excludeId && asText(item.title).toLowerCase() === asText(candidate.title).toLowerCase())) return "当前店铺已存在同名 Mission";
      if (!excludeId && !["paused", "active"].includes(candidate.status || "paused")) return "新 Mission 只能以暂停或运行状态创建";
      return null;
    };
    let mission;
    let missions;
    if (verb === "create") {
      const error = validate(input, null);
      if (error) return reject(store, action, error, "mission", input.id);
      if (input.id && store.missions.some((item) => item.id === input.id)) return reject(store, action, "Mission 内部 ID 已存在，创建已阻断", "mission", input.id);
      mission = {
        ...input,
        id: input.id || makeEntityId("mission", action),
        title: asText(input.title),
        objective: asText(input.objective),
        status: input.status || "paused",
        phase: input.phase || "observe",
        progress: Number(input.progress || 0),
        owner: input.owner || "operator",
        archived: false,
        decisionIds: input.decisionIds || [],
        experimentIds: input.experimentIds || [],
        executionIds: input.executionIds || [],
        createdAt: at,
        updatedAt: at,
      };
      if (store.missions.some((item) => item.id === mission.id)) return reject(store, action, "Mission 内部 ID 已存在，创建已阻断", "mission", mission.id);
      missions = [mission, ...store.missions];
    } else if (verb === "update") {
      if ((!previous.archived && input.archived === true) || (!["archived", "deleted"].includes(previous.status) && ["archived", "deleted"].includes(input.status))) {
        return reject(store, action, "Mission 归档或删除必须使用专用操作", "mission", previous.id);
      }
      if (input.status && input.status !== previous.status) {
        return reject(store, action, "Mission 状态只能通过启动、暂停、恢复或系统完成动作改变", "mission", previous.id);
      }
      const candidate = { ...previous, ...input, id: previous.id };
      const productChanged = String(candidate.productId || "") !== String(previous.productId || "");
      const hasDependencies = store.decisions.some((item) => item.missionId === previous.id)
        || store.executionQueue.some((item) => item.missionId === previous.id)
        || store.experiments.some((item) => item.missionId === previous.id);
      if (productChanged && hasDependencies) {
        return reject(store, action, "Mission 已有关联决策、实验或执行记录，不能更改产品范围", "mission", previous.id);
      }
      const error = validate(candidate, previous.id);
      if (error) return reject(store, action, error, "mission", previous.id);
      mission = { ...candidate, title: asText(candidate.title), objective: asText(candidate.objective), updatedAt: at };
      missions = store.missions.map((item) => item.id === previous.id ? mission : item);
    } else if (verb === "archive") {
      mission = { ...previous, status: "archived", archived: true, archivedAt: at, updatedAt: at };
      missions = store.missions.map((item) => item.id === previous.id ? mission : item);
    } else if (verb === "restore") {
      if (!previous.archived && previous.status !== "archived") return reject(store, action, "只有已归档 Mission 可以恢复", "mission", previous.id);
      const restored = { ...previous, status: "paused", archived: false, archivedAt: null };
      const error = validate(restored, previous.id);
      if (error) return reject(store, action, error, "mission", previous.id);
      mission = { ...restored, updatedAt: at };
      missions = store.missions.map((item) => item.id === previous.id ? mission : item);
    } else if (verb === "delete") {
      const dependencies = [
        ...store.decisions.filter((item) => item.missionId === previous.id),
        ...store.executionQueue.filter((item) => item.missionId === previous.id),
        ...store.experiments.filter((item) => item.missionId === previous.id),
      ];
      if (previous.status !== "archived" || !previous.archived) return reject(store, action, "仅已归档 Mission 可以删除", "mission", previous.id);
      if (dependencies.length) return reject(store, action, "Mission 仍有关联决策、实验或执行记录，只能保留归档", "mission", previous.id);
      mission = previous;
      missions = store.missions.filter((item) => item.id !== previous.id);
    } else {
      return store;
    }
    const verbCopy = { create: "创建", update: "更新", archive: "归档", restore: "恢复", delete: "删除" }[verb];
    const nextStore = verb === "archive"
      ? {
          ...store,
          missions,
          executionQueue: store.executionQueue.map((item) => item.missionId === mission.id && ["ready", "running", "queued", "executing"].includes(item.status)
            ? { ...item, status: "paused", pauseReason: "mission_archived", updatedAt: at }
            : item),
          experiments: store.experiments.map((item) => item.missionId === mission.id && ["active", "running"].includes(item.status)
            ? { ...item, status: "paused", pausedReason: "mission_archived", pausedAt: at, updatedAt: at }
            : item),
        }
      : { ...store, missions };
    return succeed(
      nextStore,
      action,
      { entityType: "mission", entityId: mission.id, summary: `已${verbCopy} Mission「${mission.title}」` },
      { type: "mission_state", entityType: "mission", entityId: mission.id, missionId: mission.id, title: `Mission 已${verbCopy}`, intervention: verb, status: verb === "delete" ? "closed" : mission.status },
    );
  });
}

function reduceMissionStatus(state, action, status) {
  return updateStore(state, action, (store) => {
    const missionId = targetIdFor(action, "mission");
    const mission = store.missions.find((item) => item.id === missionId);
    if (!mission) {
      return reject(store, action, "Mission 不存在，操作未执行", "mission", missionId);
    }
    if (["archived", "completed"].includes(mission.status)) {
      return reject(
        store,
        action,
        mission.status === "completed" ? "已完成 Mission 不可回退运行状态" : "已归档 Mission 不可改变运行状态",
        "mission",
        missionId,
      );
    }
    const at = nowFor(action);
    const nextMission = {
      ...mission,
      status,
      pausedReason:
        status === "paused"
          ? action.reason || action.payload?.reason || "operator_pause"
          : null,
      updatedAt: at,
    };
    const nextStore = {
      ...store,
      missions: store.missions.map((item) =>
        item.id === missionId ? nextMission : item,
      ),
      executionQueue: store.executionQueue.map((item) => {
        if (item.missionId !== missionId) return item;
        if (status === "paused" && ["ready", "running", "queued", "executing", "awaiting_approval", "needs_approval"].includes(item.status)) {
          return { ...item, status: "paused", resumeStatus: item.status, pauseReason: "mission_paused", updatedAt: at };
        }
        if (status === "active" && item.status === "paused" && item.pauseReason === "mission_paused") {
          return { ...item, status: item.resumeStatus || "ready", resumeStatus: null, pauseReason: null, updatedAt: at };
        }
        return item;
      }),
      experiments: store.experiments.map((item) => {
        if (item.missionId !== missionId) return item;
        if (status === "paused" && ["active", "running"].includes(item.status)) {
          return { ...item, status: "paused", resumeStatus: item.status, pausedReason: "mission_paused", pausedAt: at, updatedAt: at };
        }
        if (status === "active" && item.status === "paused" && item.pausedReason === "mission_paused") {
          return { ...item, status: item.resumeStatus || "running", resumeStatus: null, pausedReason: null, resumedAt: at, updatedAt: at };
        }
        return item;
      }),
    };
    return succeed(
      nextStore,
      action,
      {
        entityType: "mission",
        entityId: missionId,
        summary:
          status === "active"
            ? "Mission「" + mission.title + "」已运行"
            : "Mission「" + mission.title + "」已暂停",
      },
      {
        type: "mission_state",
        entityType: "mission",
        entityId: missionId,
        missionId,
        title: status === "active" ? "Mission 恢复运行" : "Mission 人工暂停",
        intervention: status,
        status,
      },
    );
  });
}

function linkedDecision(store, execution) {
  return store.decisions.find((item) => item.id === execution.decisionId) || null;
}

function executionKindOf(item) {
  if (["bid", "budget"].includes(item?.decisionKind)) return item.decisionKind;
  const actionType = String(item?.actionType || "").toLowerCase();
  if (item?.beforeBudget !== undefined || item?.proposedBudget !== undefined || actionType.includes("budget") || actionType.includes("预算")) return "budget";
  if (item?.beforeBid !== undefined || item?.proposedBid !== undefined || actionType.includes("bid") || actionType.includes("竞价")) return "bid";
  return null;
}

function executionTargetEvaluation(store, execution) {
  const adObjectId = asText(execution.adObjectId);
  if (!adObjectId) return { ok: false, reason: "执行项缺少目标广告对象，已阻断" };
  const adObject = store.adObjects.find((item) => item.id === adObjectId);
  if (!adObject) return { ok: false, reason: "目标广告对象不存在，执行已阻断" };
  const executionKind = executionKindOf(execution);
  if (executionKind === "budget" && adObject.type !== "campaign") {
    return { ok: false, reason: "日预算动作只能绑定广告活动，执行已阻断", adObject };
  }
  if (executionKind === "bid" && !["keyword", "target"].includes(adObject.type)) {
    return { ok: false, reason: "竞价动作只能绑定关键词或商品投放对象，执行已阻断", adObject };
  }
  if (adObject.type === "campaign" && adObject.parentId) {
    return { ok: false, reason: "广告活动不能存在父级，执行已阻断", adObject };
  }
  const productId = asText(adObject.productId);
  if (!productId) {
    return { ok: false, reason: "目标广告对象缺少产品归属，执行已阻断", adObject };
  }
  if (!asText(execution.productId) || String(execution.productId) !== productId) {
    return { ok: false, reason: "决策产品与目标广告对象不一致，执行已阻断", adObject };
  }
  const missionId = asText(execution.missionId);
  if (missionId) {
    const mission = store.missions.find((item) => item.id === missionId);
    if (!mission) return { ok: false, reason: "执行项关联的 Mission 不存在，执行已阻断", adObject };
    if (!asText(mission.productId) || String(mission.productId) !== productId) {
      return { ok: false, reason: "Mission 产品范围与目标广告对象不一致，执行已阻断", adObject, mission };
    }
  }
  if (adObject.archived || ["archived", "deleted", "disabled", "paused"].includes(adObject.status)) {
    return { ok: false, reason: "目标广告对象未处于可执行状态，执行已阻断", adObject };
  }
  const visited = new Set([adObject.id]);
  let child = adObject;
  while (child.parentId) {
    const parent = store.adObjects.find((item) => item.id === child.parentId);
    if (!parent) return { ok: false, reason: "目标广告对象的父级不存在，执行已阻断", adObject };
    const expectedParentType = child.type === "ad_group" ? "campaign" : ["keyword", "target"].includes(child.type) ? "ad_group" : null;
    if (!expectedParentType || parent.type !== expectedParentType) {
      return { ok: false, reason: "目标广告对象的父子层级类型无效，执行已阻断", adObject };
    }
    if (visited.has(parent.id)) return { ok: false, reason: "目标广告对象层级存在循环，执行已阻断", adObject };
    if (!asText(parent.productId) || String(parent.productId) !== productId) return { ok: false, reason: "目标广告对象与父级产品不一致，执行已阻断", adObject };
    if (parent.archived || ["archived", "deleted", "disabled", "paused"].includes(parent.status)) {
      return { ok: false, reason: "目标广告对象的父级未处于可执行状态，执行已阻断", adObject };
    }
    visited.add(parent.id);
    child = parent;
  }
  if (adObject.type !== "campaign" && child.type !== "campaign") {
    return { ok: false, reason: "目标广告对象未连接到有效广告活动，执行已阻断", adObject };
  }
  const product = store.products.find((item) => item.id === productId);
  if (!product) return { ok: false, reason: "目标广告对象的所属产品不存在，执行已阻断", adObject };
  if (product.archived || ["archived", "deleted", "disabled", "paused"].includes(product.status)) {
    return { ok: false, reason: "目标广告对象的所属产品未处于可执行状态，执行已阻断", adObject, product };
  }
  return { ok: true, adObject, product };
}

function recalculateMission(store, missionId, phase, action) {
  if (!missionId) return store;
  const queue = store.executionQueue.filter((item) => item.missionId === missionId);
  const terminal = queue.filter((item) =>
    ["verified", "skipped", "blocked"].includes(item.status),
  ).length;
  const progress = queue.length ? Math.round((terminal / queue.length) * 100) : 0;
  const complete =
    queue.length > 0 &&
    queue.every((item) => ["verified", "skipped"].includes(item.status));
  const mission = store.missions.find((item) => item.id === missionId);
  let nextStore = {
    ...store,
    missions: store.missions.map((mission) =>
      mission.id === missionId
        ? {
            ...mission,
            phase: complete ? "complete" : phase || mission.phase,
            status: complete ? "completed" : mission.status,
            progress,
            checkpoints: complete && Array.isArray(mission.checkpoints)
              ? mission.checkpoints.map((checkpoint) => ({
                  ...checkpoint,
                  status: "completed",
                  evidenceCount: checkpoint.evidenceCount === "0 / —" ? "已完成或跳过" : checkpoint.evidenceCount,
                }))
              : mission.checkpoints,
          }
        : mission,
    ),
  };
  if (!complete || !mission) return nextStore;

  const linkedExperimentIds = new Set(firstArray(mission.experimentIds).map(String));
  const finalizedExperiments = [];
  const at = nowFor(action || { type: "SYSTEM_COMPLETE_EXPERIMENT" });
  const experiments = store.experiments.map((experiment) => {
    const linked = experiment.missionId === missionId || linkedExperimentIds.has(experiment.id);
    if (!linked || ["completed", "archived"].includes(experiment.status)) return experiment;
    const finalized = {
      ...experiment,
      status: "completed",
      completedAt: at,
      completedByMissionId: missionId,
      updatedAt: at,
    };
    finalizedExperiments.push(finalized);
    return finalized;
  });
  nextStore = { ...nextStore, experiments };
  for (const experiment of finalizedExperiments) {
    nextStore = appendCausal(nextStore, action || { type: "SYSTEM_COMPLETE_EXPERIMENT", at }, {
      type: "experiment_state",
      entityType: "experiment",
      entityId: experiment.id,
      experimentId: experiment.id,
      missionId,
      productId: experiment.productId || mission.productId || null,
      adObjectId: experiment.adObjectId || null,
      title: "Mission 完成，实验同步收口",
      intervention: "completed",
      observedEffect: "关联执行均已验证或跳过，实验随 Mission 一致进入终态。",
      status: "completed",
      links: [missionId, experiment.id].filter(Boolean),
    });
  }
  return nextStore;
}

function reduceExecution(state, action, verb) {
  return updateStore(state, action, (store) => {
    let executionId = targetIdFor(action, "execution");
    if (!executionId && action.itemId) executionId = action.itemId;
    let execution = store.executionQueue.find((item) => item.id === executionId);

    if (!execution && verb === "start") {
      const missionId = targetIdFor(action, "mission");
      execution = store.executionQueue.find(
        (item) =>
          (!missionId || item.missionId === missionId) &&
          ["ready", "paused"].includes(item.status),
      );
      executionId = execution?.id || null;
    }

    if (!execution) {
      return reject(
        store,
        action,
        "没有找到可操作的执行项",
        "execution",
        executionId,
      );
    }

    const decision = linkedDecision(store, execution);
    const mission = execution.missionId
      ? store.missions.find((item) => item.id === execution.missionId)
      : null;
    const at = nowFor(action);
    const requestedActor = actorFor(action);
    const automatedActor = ["agent", "system", "auto"].includes(requestedActor);
    const gatedVerb = ["start", "resume", "apply"].includes(verb);
    const lifecycleVerb = ["start", "resume", "apply", "takeover", "skip"].includes(verb);

    if (lifecycleVerb && (!execution.missionId || !mission)) {
      return reject(
        store,
        action,
        "执行项缺少有效 Mission 绑定，已按失败关闭",
        "execution",
        executionId,
        { missionId: execution.missionId || null },
      );
    }

    if (lifecycleVerb && ["archived", "completed", "paused"].includes(mission?.status)) {
      return reject(
        store,
        action,
        mission.status === "archived" ? "Mission 已归档，关联执行项已封存" : mission.status === "paused" ? "Mission 已暂停，关联执行项保持锁定" : "Mission 已完成，不能继续写入",
        "execution",
        executionId,
        { missionId: mission.id },
      );
    }

    if (gatedVerb && !decision) {
      return reject(
        store,
        action,
        "执行项缺少关联决策，已阻断",
        "execution",
        executionId,
      );
    }

    if (gatedVerb && decision) {
      const decisionStatus = String(decision.status || "").toLowerCase();
      const policyEligibleProposal = decisionStatus === "proposed"
        && store.mode === "auto"
        && decision.autoExecutable === true
        && decision.approval?.required !== true;
      if (decisionStatus !== "approved" && !policyEligibleProposal) {
        return reject(
          store,
          action,
          "关联决策未处于已批准或策略内可执行状态，执行已阻断",
          "execution",
          executionId,
          { decisionId: decision.id, decisionStatus },
        );
      }
      const decisionKind = executionKindOf(decision);
      const queueKind = executionKindOf(execution);
      if (!decisionKind || !queueKind || decisionKind !== queueKind) {
        return reject(
          store,
          action,
          "执行项与关联决策的动作类型不一致，执行已阻断",
          "execution",
          executionId,
          { decisionId: decision.id, decisionKind, queueKind },
        );
      }
      if (
        String(decision.missionId || "") !== String(execution.missionId || "")
        || String(decision.adObjectId || "") !== String(execution.adObjectId || "")
        || (decision.productId && execution.productId && String(decision.productId) !== String(execution.productId))
      ) {
        return reject(
          store,
          action,
          "执行项与关联决策的 Mission、产品或广告对象不一致，执行已阻断",
          "execution",
          executionId,
          { decisionId: decision.id },
        );
      }
    }

    if (gatedVerb) {
      const target = executionTargetEvaluation(store, execution);
      if (!target.ok) {
        return reject(
          store,
          action,
          target.reason,
          "execution",
          executionId,
          { adObjectId: execution.adObjectId || null, productId: target.adObject?.productId || null },
        );
      }
    }

    if (gatedVerb && store.session?.status !== "connected") {
      return reject(
        store,
        action,
        "可见领星会话未连接，执行已阻断",
        "execution",
        executionId,
      );
    }

    if (gatedVerb && store.session?.amazonAds?.status !== "connected") {
      return reject(
        store,
        action,
        "Amazon Ads 会话未连接，执行已阻断",
        "execution",
        executionId,
      );
    }

    if (gatedVerb && store.session?.lingxing?.status !== "connected") {
      return reject(
        store,
        action,
        "领星会话未连接，执行已阻断",
        "execution",
        executionId,
      );
    }

    if (gatedVerb && store.session?.amazonAds?.scope !== "read_write_simulated") {
      return reject(
        store,
        action,
        "Amazon Ads 当前为只读授权，不能应用变更",
        "execution",
        executionId,
      );
    }

    if (gatedVerb && store.settings?.requireVisibleBrowser !== true) {
      return reject(
        store,
        action,
        "可见浏览器安全边界未启用，执行已阻断",
        "execution",
        executionId,
      );
    }

    if (gatedVerb && store.settings?.simulationOnly !== true) {
      return reject(
        store,
        action,
        "原型模拟执行边界无效，执行已阻断",
        "execution",
        executionId,
      );
    }

    if (gatedVerb) {
      const freshness = dataFreshnessEvaluation(store);
      if (!freshness.ok) {
        return reject(
          store,
          action,
          freshness.reason,
          "execution",
          executionId,
          { policyId: freshness.policy?.id || null, freshnessMinutes: freshness.freshnessMinutes },
        );
      }
    }

    if (gatedVerb && automatedActor && store.mode !== "auto") {
      return reject(
        store,
        action,
        "当前店铺处于人工审批模式，Agent 不会自主执行",
        "execution",
        executionId,
      );
    }

    if (
      gatedVerb &&
      store.mode === "approval" &&
      (!decision || !["approved", "executed", "verified"].includes(decision.status))
    ) {
      return reject(
        store,
        action,
        "当前店铺处于人工审批模式，必须先由运营者明确批准该决策",
        "execution",
        executionId,
        { decisionId: decision?.id || null },
      );
    }

    if (gatedVerb && automatedActor && mission?.status === "paused") {
      return reject(
        store,
        action,
        "Mission 已暂停，Agent 不会继续执行",
        "execution",
        executionId,
        { missionId: mission.id },
      );
    }

    if (
      gatedVerb &&
      decision?.approval?.required &&
      decision.status !== "approved" &&
      decision.status !== "executed"
    ) {
      return reject(
        store,
        action,
        "该执行项等待人工审批，Agent 不会越过审批门",
        "execution",
        executionId,
        { decisionId: decision.id },
      );
    }

    if (
      gatedVerb &&
      !execution.autoEligible &&
      automatedActor
    ) {
      return reject(
        store,
        action,
        "该执行项被标记为 human_only，禁止策略内自动执行",
        "execution",
        executionId,
      );
    }

    if (gatedVerb) {
      if (!decision && automatedActor) {
        return reject(
          store,
          action,
          "策略内自动执行缺少关联决策，已阻断",
          "execution",
          executionId,
        );
      }
      const liveDecision = decision?.decisionKind === "budget" || decision?.beforeBudget !== undefined
        ? {
            ...decision,
            beforeBudget: decision.beforeBudget ?? execution.beforeValue,
            proposedBudget: decision.proposedBudget ?? execution.targetValue,
          }
        : decision
          ? {
              ...decision,
              beforeBid: decision.beforeBid ?? execution.beforeValue,
              proposedBid: decision.proposedBid ?? execution.targetValue,
            }
          : null;
      const liveEvaluation = liveDecision ? policyEvaluation(store, liveDecision) : null;
      const approvedBy = String(decision?.approval?.approvedBy || "").toLowerCase();
      const humanApprovalValid = decision?.approval?.status === "approved"
        && Boolean(approvedBy)
        && !["policy-engine", "agent", "system", "auto"].includes(approvedBy)
        && Boolean(liveEvaluation?.policy?.id)
        && decision?.approval?.policyId === liveEvaluation.policy.id;
      if (
        liveEvaluation?.error ||
        liveEvaluation?.blocked ||
        (liveEvaluation?.requiresApproval && !humanApprovalValid) ||
        (automatedActor && liveEvaluation && (!liveEvaluation.withinPolicy || liveEvaluation.requiresApproval))
      ) {
        return reject(
          store,
          action,
          liveEvaluation.error || (liveEvaluation.blocked
            ? "当前策略已变化并要求强制阻断，人工审批不能绕过"
            : liveEvaluation.requiresApproval
              ? "当前策略要求人工审批，该决策尚未明确批准"
            : "当前策略已变化，该动作不再满足策略内自动执行边界"),
          "execution",
          executionId,
          {
            decisionId: decision.id,
            policyId: liveEvaluation.policy?.id || decision.policyId || null,
            changePct: liveEvaluation.changePct ?? decision.changePct ?? execution.deltaPct,
          },
        );
      }
    }

    let nextExecution = execution;
    let summary = "";
    let causalTitle = "";
    let causalStatus = "";

    if (verb === "start") {
      if (!["ready", "paused"].includes(execution.status)) {
        return reject(
          store,
          action,
          "当前执行状态不能启动",
          "execution",
          executionId,
        );
      }
      nextExecution = {
        ...execution,
        status: "running",
        startedAt: execution.startedAt || at,
        resumedAt: execution.status === "paused" ? at : execution.resumedAt,
        updatedAt: at,
      };
      summary = "已启动执行「" + execution.title + "」";
      causalTitle = "执行项开始";
      causalStatus = "running";
    } else if (verb === "pause") {
      if (execution.status !== "running") {
        return reject(
          store,
          action,
          "仅运行中的执行项可以暂停",
          "execution",
          executionId,
        );
      }
      nextExecution = {
        ...execution,
        status: "paused",
        pausedAt: at,
        pauseReason: action.reason || action.payload?.reason || "operator_pause",
        updatedAt: at,
      };
      summary = "已暂停执行「" + execution.title + "」";
      causalTitle = "执行项暂停";
      causalStatus = "paused";
    } else if (verb === "resume") {
      if (execution.status !== "paused") {
        return reject(
          store,
          action,
          "仅暂停中的执行项可以恢复",
          "execution",
          executionId,
        );
      }
      nextExecution = {
        ...execution,
        status: "running",
        resumedAt: at,
        updatedAt: at,
      };
      summary = "已恢复执行「" + execution.title + "」";
      causalTitle = "执行项恢复";
      causalStatus = "running";
    } else if (verb === "takeover") {
      if (!["ready", "running", "paused", "awaiting_approval"].includes(execution.status)) {
        return reject(
          store,
          action,
          "当前执行状态不可接管，已应用或终态动作不会回退",
          "execution",
          executionId,
        );
      }
      nextExecution = {
        ...execution,
        status: execution.status === "awaiting_approval" ? "awaiting_approval" : "paused",
        owner: "operator",
        executionMode: "human_only",
        autoEligible: false,
        takenOverAt: at,
        updatedAt: at,
      };
      summary = "运营者已接管「" + execution.title + "」";
      causalTitle = "执行控制权转交运营者";
      causalStatus = "human_control";
    } else if (verb === "skip") {
      if (!["ready", "running", "paused", "awaiting_approval", "queued"].includes(execution.status)) {
        return reject(
          store,
          action,
          "当前执行状态不能跳过，已应用或终态动作不会回退",
          "execution",
          executionId,
        );
      }
      nextExecution = {
        ...execution,
        status: "skipped",
        skippedAt: at,
        skipReason: action.reason || action.payload?.reason || "operator_skip",
        updatedAt: at,
      };
      summary = "已跳过执行「" + execution.title + "」";
      causalTitle = "执行项被跳过";
      causalStatus = "skipped";
    } else if (verb === "apply") {
      if (!["ready", "running", "paused"].includes(execution.status)) {
        return reject(
          store,
          action,
          "当前执行状态不能应用变更",
          "execution",
          executionId,
        );
      }
      const evidence = action.evidence || action.payload?.evidence || {};
      nextExecution = {
        ...execution,
        status: "applied",
        owner: automatedActor ? "agent" : "operator",
        appliedAt: at,
        updatedAt: at,
        evidence: {
          ...evidence,
          id: "sim-" + eventIdFor(action),
          source: "prototype_simulator",
          simulation: true,
          beforeValue: execution.beforeValue,
          appliedValue: execution.targetValue,
          capturedAt: at,
          policyId: decision?.policyId || execution.policyId || null,
          policyVersion: decision?.policyVersion || execution.policyVersion || null,
          policySnapshot: decision?.policySnapshot || execution.policySnapshot || null,
        },
      };
      summary = "已模拟应用「" + execution.title + "」";
      causalTitle = "变更已应用并生成执行证据";
      causalStatus = "applied";
    } else if (verb === "verify") {
      if (execution.status !== "applied") {
        return reject(
          store,
          action,
          "只有已应用的执行项可以验证回读",
          "execution",
          executionId,
        );
      }
      const verification = action.verification || action.payload?.verification || {};
      const readbackValue = execution.targetValue ?? null;
      const matched = readbackValue !== null
        && asFiniteNumber(readbackValue) === asFiniteNumber(execution.targetValue);
      nextExecution = {
        ...execution,
        status: matched ? "verified" : "verification_failed",
        verifiedAt: matched ? at : null,
        updatedAt: at,
        verification: {
          ...verification,
          source: "prototype_visible_reload",
          matched,
          readbackValue,
          capturedAt: at,
          simulation: true,
        },
      };
      summary = matched
        ? "已验证回读「" + execution.title + "」"
        : "回读不一致「" + execution.title + "」，等待人工处理";
      causalTitle = matched ? "执行回读已验证" : "执行回读不一致";
      causalStatus = matched ? "verified" : "verification_failed";
    } else {
      return store;
    }

    let nextStore = {
      ...store,
      executionQueue: store.executionQueue.map((item) =>
        item.id === executionId ? nextExecution : item,
      ),
    };

    if (decision && verb === "apply") {
      nextStore = {
        ...nextStore,
        decisions: nextStore.decisions.map((item) =>
          item.id === decision.id
            ? { ...item, status: "executed", executedAt: at, updatedAt: at }
            : item,
        ),
      };
    }
    if (decision && verb === "verify" && nextExecution.status === "verified") {
      nextStore = {
        ...nextStore,
        decisions: nextStore.decisions.map((item) =>
          item.id === decision.id
            ? { ...item, status: "verified", verifiedAt: at, updatedAt: at }
            : item,
        ),
      };
    }

    nextStore = recalculateMission(
      nextStore,
      execution.missionId,
      verb === "verify" ? "readback" : "execution",
      action,
    );

    return succeed(
      nextStore,
      action,
      {
        entityType: "execution",
        entityId: executionId,
        summary,
        details: {
          decisionId: execution.decisionId || null,
          simulation: true,
        },
      },
      {
        type: "execution",
        entityType: "execution",
        entityId: executionId,
        missionId: execution.missionId,
        title: causalTitle,
        intervention:
          execution.beforeValue !== undefined
            ? execution.beforeValue + " → " + execution.targetValue
            : execution.actionType,
        observedEffect:
          verb === "verify"
            ? nextExecution.verification.matched
              ? "回读与目标值一致（原型模拟）"
              : "回读与目标值不一致（原型模拟）"
            : null,
        status: causalStatus,
        links: [execution.decisionId, execution.adObjectId].filter(Boolean),
      },
    );
  });
}

function reduceExperimentStatus(state, action, status) {
  return updateStore(state, action, (store) => {
    const experimentId = targetIdFor(action, "experiment");
    const experiment = store.experiments.find((item) => item.id === experimentId);
    if (!experiment) {
      return reject(
        store,
        action,
        "实验不存在，操作未执行",
        "experiment",
        experimentId,
      );
    }
    if (["archived", "completed"].includes(experiment.status)) {
      return reject(
        store,
        action,
        experiment.status === "completed" ? "已完成实验不可改变运行状态" : "已归档实验不可改变运行状态",
        "experiment",
        experimentId,
      );
    }
    if (status === "running" && experiment.missionId) {
      const mission = store.missions.find((item) => item.id === experiment.missionId);
      if (!mission || mission.archived || ["archived", "completed", "paused"].includes(mission.status)) {
        return reject(store, action, !mission ? "实验关联的 Mission 不存在，不能恢复" : mission.status === "paused" ? "实验关联的 Mission 已暂停，请先恢复 Mission" : "实验关联的 Mission 已封存，不能恢复", "experiment", experimentId);
      }
    }
    const nextExperiment = {
      ...experiment,
      status,
      pausedAt: status === "paused" ? nowFor(action) : experiment.pausedAt,
      resumedAt: status === "running" ? nowFor(action) : experiment.resumedAt,
      updatedAt: nowFor(action),
    };
    const nextStore = {
      ...store,
      experiments: store.experiments.map((item) =>
        item.id === experimentId ? nextExperiment : item,
      ),
    };
    return succeed(
      nextStore,
      action,
      {
        entityType: "experiment",
        entityId: experimentId,
        summary:
          status === "paused"
            ? "实验「" + experiment.name + "」已暂停"
            : "实验「" + experiment.name + "」已恢复",
      },
      {
        type: "experiment_state",
        entityType: "experiment",
        entityId: experimentId,
        missionId: experiment.missionId,
        title: status === "paused" ? "运营实验暂停" : "运营实验恢复",
        intervention: status,
        status,
      },
    );
  });
}

function reduceExperimentRecord(state, action, verb) {
  return updateStore(state, action, (store) => {
    const experimentId =
      action.experimentId ||
      action.payload?.experimentId ||
      action.record?.experimentId ||
      null;
    const experiment = store.experiments.find((item) => item.id === experimentId);
    if (!experiment) {
      return reject(
        store,
        action,
        "实验不存在，无法修改实验记录",
        "experiment",
        experimentId,
      );
    }
    if (["archived", "completed"].includes(experiment.status)) {
      return reject(
        store,
        action,
        experiment.status === "completed" ? "已完成实验不可修改记录" : "已归档实验不可修改记录",
        "experiment",
        experimentId,
      );
    }
    if (["create", "edit"].includes(verb) && experiment.missionId) {
      const mission = store.missions.find((item) => item.id === experiment.missionId);
      if (!mission || mission.archived || ["archived", "completed"].includes(mission.status)) {
        return reject(store, action, !mission ? "实验关联的 Mission 不存在，不能写入记录" : "实验关联的 Mission 已封存，不能写入记录", "experiment", experimentId);
      }
    }

    const records = Array.isArray(experiment.records) ? experiment.records : [];
    const input =
      action.record ||
      action.payload?.record ||
      action.payload ||
      action.data ||
      {};
    const recordId = action.recordId || input.recordId || input.id || null;
    const previous = recordId
      ? records.find((item) => item.id === recordId)
      : null;

    if (verb !== "create" && !previous) {
      return reject(
        store,
        action,
        "实验记录不存在，操作未执行",
        "experiment_record",
        recordId,
      );
    }

    let record;
    let nextRecords;
    const at = nowFor(action);
    if (verb === "create") {
      const title = asText(input.title || input.name);
      if (!title) {
        return reject(
          store,
          action,
          "实验记录标题不能为空",
          "experiment_record",
        );
      }
      if (input.id && records.some((item) => item.id === input.id)) {
        return reject(store, action, "实验记录内部 ID 已存在，创建已阻断", "experiment_record", input.id);
      }
      record = {
        ...input,
        id: input.id || makeEntityId("experiment-record", action),
        title,
        type: input.type || "observation",
        status: input.status || "recorded",
        observedAt: input.observedAt || at,
        createdAt: at,
        updatedAt: at,
      };
      if (records.some((item) => item.id === record.id)) return reject(store, action, "实验记录内部 ID 已存在，创建已阻断", "experiment_record", record.id);
      nextRecords = [record, ...records];
    } else if (verb === "edit") {
      if ((!previous.archived && input.archived === true) || (!["archived", "deleted"].includes(previous.status) && ["archived", "deleted"].includes(input.status))) {
        return reject(store, action, "实验记录归档或删除必须使用专用操作", "experiment_record", previous.id);
      }
      const title = asText(input.title || input.name || previous.title);
      if (!title) {
        return reject(
          store,
          action,
          "实验记录标题不能为空",
          "experiment_record",
          previous.id,
        );
      }
      record = {
        ...previous,
        ...input,
        id: previous.id,
        title,
        updatedAt: at,
      };
      nextRecords = records.map((item) => (item.id === previous.id ? record : item));
    } else if (verb === "archive") {
      record = {
        ...previous,
        status: "archived",
        archived: true,
        archivedAt: at,
        updatedAt: at,
      };
      nextRecords = records.map((item) => (item.id === previous.id ? record : item));
    } else if (verb === "delete") {
      record = previous;
      nextRecords = records.filter((item) => item.id !== previous.id);
    } else {
      return store;
    }

    const nextExperiment = {
      ...experiment,
      records: nextRecords,
      updatedAt: at,
    };
    const nextStore = {
      ...store,
      experiments: store.experiments.map((item) =>
        item.id === experiment.id ? nextExperiment : item,
      ),
    };
    const verbLabel = {
      create: "新增",
      edit: "编辑",
      archive: "归档",
      delete: "删除",
    }[verb];
    return succeed(
      nextStore,
      action,
      {
        entityType: "experiment_record",
        entityId: record.id,
        summary: "已" + verbLabel + "实验记录「" + record.title + "」",
      },
      {
        type: "experiment_record",
        entityType: "experiment_record",
        entityId: record.id,
        experimentId: experiment.id,
        missionId: experiment.missionId,
        title: verbLabel + "实验记录「" + record.title + "」",
        signal: record.notes || record.observation || null,
        observedEffect: record.observedEffect || null,
        status: verb === "delete" ? "closed" : record.status,
        links: [experiment.id, experiment.productId, experiment.adObjectId].filter(Boolean),
      },
    );
  });
}

function reduceOperationEvent(state, action, verb = "create") {
  return updateStore(state, action, (store) => {
    const list = store.operationEvents || [];
    const targetId = targetIdFor(action, "operationEvent") || action.eventId || action.id;
    const previous = targetId ? list.find((item) => item.id === targetId) : null;
    const at = nowFor(action);
    if (verb !== "create" && !previous) {
      return reject(store, action, "运营事件不存在，操作未执行", "operation_event", targetId);
    }
    const input = payloadFor(action, "operationEvent");
    const validateEvent = (candidate) => {
      if (!asText(candidate.title)) return "运营事件标题不能为空";
      if (!["promotion", "price", "inventory", "listing", "competitor", "external", "operation"].includes(candidate.type || "operation")) return "运营事件类型无效";
      if (!["low", "medium", "high", "negative_short_term", "positive_short_term", "unknown"].includes(candidate.impact || "unknown")) return "运营事件影响等级无效";
      if (!asText(candidate.occurredAt) || !Number.isFinite(Date.parse(candidate.occurredAt))) return "运营事件发生时间无效";
      if (candidate.productId && !store.products.some((product) => product.id === candidate.productId && !product.archived && !["archived", "deleted", "disabled"].includes(product.status))) return "运营事件关联产品不属于当前店铺或已不可用";
      return null;
    };
    let event;
    let nextEvents;
    if (verb === "create") {
      const error = validateEvent(input);
      if (error) return reject(store, action, error, "operation_event");
      if (input.id && list.some((item) => item.id === input.id)) return reject(store, action, "运营事件内部 ID 已存在，创建已阻断", "operation_event", input.id);
      event = {
        ...input,
        id: input.id || makeEntityId("operation", action),
        title: asText(input.title),
        type: input.type || "operation",
        impact: input.impact || "unknown",
        productId: Object.prototype.hasOwnProperty.call(input, "productId")
          ? asText(input.productId) || null
          : store.selectedProductId || null,
        status: input.status || "observed",
        archived: false,
        createdAt: at,
        updatedAt: at,
        actor: actorFor(action),
      };
      if (list.some((item) => item.id === event.id)) return reject(store, action, "运营事件内部 ID 已存在，创建已阻断", "operation_event", event.id);
      nextEvents = [event, ...list];
    } else if (verb === "update") {
      const merged = { ...previous, ...input, id: previous.id };
      if ((!previous.archived && input.archived === true) || (!["archived", "deleted"].includes(previous.status) && ["archived", "deleted"].includes(input.status))) {
        return reject(store, action, "运营事件归档或删除必须使用专用操作", "operation_event", previous.id);
      }
      const error = validateEvent(merged);
      if (error) return reject(store, action, error, "operation_event", previous.id);
      event = { ...merged, title: asText(merged.title), updatedAt: at };
      nextEvents = list.map((item) => item.id === previous.id ? event : item);
    } else if (verb === "archive") {
      event = { ...previous, status: "archived", archived: true, archivedAt: at, updatedAt: at };
      nextEvents = list.map((item) => item.id === previous.id ? event : item);
    } else if (verb === "restore") {
      event = { ...previous, status: "observed", archived: false, archivedAt: null, updatedAt: at };
      nextEvents = list.map((item) => item.id === previous.id ? event : item);
    } else if (verb === "delete") {
      event = previous;
      nextEvents = list.filter((item) => item.id !== previous.id);
    } else {
      return store;
    }
    const verbCopy = { create: "记录", update: "更新", archive: "归档", restore: "恢复", delete: "删除" }[verb];
    const nextStore = {
      ...store,
      operationEvents: nextEvents,
    };
    return succeed(
      nextStore,
      action,
      {
        entityType: "operation_event",
        entityId: event.id,
        summary: "已" + verbCopy + "运营事件「" + event.title + "」",
      },
      {
        type: "operation_event",
        entityType: "operation_event",
        entityId: event.id,
        missionId: event.missionId || null,
        productId: event.productId || null,
        adObjectId: event.adObjectId || null,
        title: "运营事件已" + verbCopy + " · " + event.title,
        signal: event.context || event.description || null,
        observedEffect: event.observedEffect || null,
        status: verb === "delete" ? "closed" : event.status || "observed",
        links: [event.productId, event.adObjectId].filter(Boolean),
      },
    );
  });
}

function reduceCausalEntry(state, action) {
  return updateStore(state, action, (store) => {
    const input = payloadFor(action, "causalEntry");
    if (!asText(input.title)) {
      return reject(store, action, "因果记录标题不能为空", "causal_entry");
    }
    if (input.id && store.causalLedger.some((item) => item.id === input.id)) {
      return reject(store, action, "因果记录内部 ID 已存在，创建已阻断", "causal_entry", input.id);
    }
    const entryId = input.id || makeEntityId("cause", action);
    if (store.causalLedger.some((item) => item.id === entryId)) {
      return reject(store, action, "因果记录内部 ID 已存在，创建已阻断", "causal_entry", entryId);
    }
    const nextStore = appendCausal(store, action, {
      ...input,
      id: entryId,
      title: asText(input.title),
      type: input.type || "manual_observation",
      source: input.source || "operator",
      status: input.status || "observed",
    });
    return appendAudit(nextStore, action, {
      outcome: "success",
      entityType: "causal_entry",
      entityId: nextStore.causalLedger[0].id,
      summary: "已写入因果记录「" + asText(input.title) + "」",
    });
  });
}

function reduceSettings(state, action) {
  return updateStore(state, action, (store) => {
    const changes = payloadFor(action, "settings");
    if (["apiKey", "aiApiKey", "token", "secret", "password"].some((key) => asText(changes[key]))) {
      return reject(store, action, "Renderer 不允许持久化 AI 密钥或密码；这里只能保存 Main-only 非敏感凭证状态", "settings");
    }
    if (changes.currency !== undefined && asText(changes.currency).toUpperCase() !== "USD") {
      return reject(store, action, "第一版仅支持 Amazon US / USD，币种不能在运行设置中修改", "settings");
    }
    const requestedTimezone = changes.businessTimezone ?? changes.timezone;
    if (requestedTimezone !== undefined && asText(requestedTimezone) !== US_BUSINESS_TIMEZONE) {
      return reject(store, action, `第一版业务时区固定为 ${US_BUSINESS_TIMEZONE}，已有数据不允许被重新解释`, "settings");
    }
    if (changes.simulationOnly === false) {
      return reject(
        store,
        action,
        "原型仅允许模拟执行，不能关闭 simulationOnly",
        "settings",
      );
    }
    if (changes.requireVisibleBrowser === false) {
      return reject(
        store,
        action,
        "未来真实执行必须使用可见浏览器；当前原型仍只模拟 Ads 写入，该安全边界不可关闭",
        "settings",
      );
    }
    if (changes.collectionFrequencyMinutes !== undefined) {
      const value = asFiniteNumber(changes.collectionFrequencyMinutes);
      if (value === null || value < 5) {
        return reject(
          store,
          action,
          "默认采集间隔不能小于 5 分钟",
          "settings",
        );
      }
    }

    const { currency: _ignoredCurrency, timezone: _ignoredTimezone, businessTimezone: _ignoredBusinessTimezone, apiKey: _apiKey, aiApiKey: _aiApiKey, token: _token, secret: _secret, password: _password, ...safeChanges } = changes;
    if (safeChanges.aiCredentialStatus && typeof safeChanges.aiCredentialStatus === "object") {
      safeChanges.aiCredentialStatus = {
        configured: safeChanges.aiCredentialStatus.configured === true,
        provider: asText(safeChanges.aiCredentialStatus.provider || safeChanges.aiProvider || store.settings?.aiProvider) || "openai",
        storage: "main_only_simulated",
        updatedAt: safeChanges.aiCredentialStatus.updatedAt || nowFor(action),
        lastTestedAt: safeChanges.aiCredentialStatus.lastTestedAt || null,
        lastTestStatus: ["success", "failed"].includes(safeChanges.aiCredentialStatus.lastTestStatus) ? safeChanges.aiCredentialStatus.lastTestStatus : null,
      };
    }
    const nextSettings = {
      ...store.settings,
      ...safeChanges,
      simulationOnly: true,
      requireVisibleBrowser: true,
      notifications: {
        ...(store.settings.notifications || {}),
        ...(safeChanges.notifications || {}),
      },
      updatedAt: nowFor(action),
    };
    const nextStore = {
      ...store,
      settings: nextSettings,
    };
    return succeed(
      nextStore,
      action,
      {
        entityType: "settings",
        entityId: store.id,
        summary: "已更新当前店铺设置",
      },
      {
        type: "settings_change",
        entityType: "settings",
        entityId: store.id,
        title: "店铺运行设置已更新",
        intervention: Object.keys(safeChanges).join(", "),
        status: "recorded",
      },
    );
  });
}

const STORE_ID_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,15}$/;

function storeBusinessRecordCount(store) {
  const liveRecords = [
    "products",
    "adObjects",
    "collectionRuns",
    "reportImports",
    "missions",
    "decisions",
    "experiments",
    "executionQueue",
    "operationEvents",
    "policies",
  ].reduce((total, key) => total + firstArray(store?.[key]).length, 0);
  const configurationOnlyTypes = new Set(["store", "settings", "session", "credential"]);
  const causalHistory = firstArray(store?.causalLedger).filter((entry) => !configurationOnlyTypes.has(String(entry.entityType || ""))).length;
  const auditHistory = firstArray(store?.audit).filter((entry) => !configurationOnlyTypes.has(String(entry.entityType || ""))).length;
  return liveRecords + causalHistory + auditHistory;
}

function validateStoreInput(input, state, previous = null) {
  const id = asText(previous?.id || input.id || input.code).toUpperCase();
  if (!STORE_ID_PATTERN.test(id)) return "店铺编码需为 3–16 位大写字母、数字、下划线或连字符";
  if (!previous && Object.keys(state.stores).some((storeId) => storeId.toUpperCase() === id)) return "店铺编码已存在";
  if (previous && asText(input.id || input.code) && asText(input.id || input.code).toUpperCase() !== previous.id) return "店铺编码是数据隔离主键，创建后不可修改";
  if (!asText(input.name)) return "店铺名称不能为空";
  if (!hasUsMarketIdentity(input)) return `第一版店铺固定为 Amazon US / USD / ${US_BUSINESS_TIMEZONE}`;
  const profileId = asText(input.browserProfileId || previous?.browserProfileId || previous?.session?.profile || `${id.toLowerCase()}-profile`).toLowerCase();
  if (Object.values(state.stores).some((store) => store.id !== previous?.id && asText(store.browserProfileId || store.session?.profile || `${store.id.toLowerCase()}-profile`).toLowerCase() === profileId)) {
    return "可见浏览器 Profile 已被其他店铺占用，店铺之间禁止复用 Cookie 与浏览器数据";
  }
  if (previous && storeBusinessRecordCount(previous) > 0) {
    const identityChanged = !hasUsMarketIdentity(previous) || !hasUsMarketIdentity(input);
    if (identityChanged) return "店铺已有业务数据，不能修改站点、区域、币种或时区；请新建店铺";
  }
  return null;
}

function normalizeStoreCatalog(input, previous = null) {
  const id = asText(previous?.id || input.id || input.code).toUpperCase();
  const name = asText(input.name);
  return withUsMarketIdentity({
    ...(previous || {}),
    id,
    code: id,
    name,
    shortName: asText(input.shortName) || name.split(/\s|·/).filter(Boolean)[0]?.slice(0, 8) || id,
    accent: asText(input.accent) || previous?.accent || "#5b6cff",
    lingxingAccount: asText(input.lingxingAccount) || previous?.lingxingAccount || id,
    browserProfileId: asText(input.browserProfileId) || previous?.browserProfileId || `${id.toLowerCase()}-profile`,
  });
}

function reconcileProfileConflicts(stores, at = new Date().toISOString(), actionName = "RECONCILE_PROFILE_CONFLICTS") {
  const nextStores = { ...stores };
  const profileGroups = new Map();
  for (const store of Object.values(nextStores)) {
    const profile = asText(store.browserProfileId || store.session?.profile || `${store.id.toLowerCase()}-profile`).toLowerCase();
    const group = profileGroups.get(profile) || [];
    group.push(store.id);
    profileGroups.set(profile, group);
  }
  for (const [storeId, store] of Object.entries(nextStores)) {
    const profile = asText(store.browserProfileId || store.session?.profile || `${store.id.toLowerCase()}-profile`).toLowerCase();
    const conflictWith = firstArray(profileGroups.get(profile)).filter((id) => id !== storeId);
    if (profile && conflictWith.length) {
      nextStores[storeId] = {
        ...store,
        profileConflict: true,
        profileConflictWith: conflictWith,
        status: store.archived ? "archived" : "blocked",
        mode: "approval",
        session: {
          ...store.session,
          status: "disconnected",
          statusLabel: "Profile 冲突，等待修复",
          lastVerifiedAt: null,
          lastHeartbeat: null,
          lingxing: { ...store.session?.lingxing, status: "disconnected", freshnessMinutes: null },
          amazonAds: { ...store.session?.amazonAds, status: "disconnected", scope: "none", freshnessMinutes: null },
        },
        lastValidation: {
          ok: false,
          message: `检测到浏览器 Profile「${profile}」被多个店铺复用；会话已全部断开，请修复后重新确认`,
          at,
          action: actionName,
        },
      };
    } else if (store.profileConflict) {
      nextStores[storeId] = {
        ...store,
        profileConflict: false,
        profileConflictWith: [],
        status: store.archived ? "archived" : "active",
        session: {
          ...store.session,
          status: "disconnected",
          statusLabel: "Profile 已唯一，等待重新确认",
          lastVerifiedAt: null,
          lastHeartbeat: null,
          lingxing: { ...store.session?.lingxing, status: "disconnected", freshnessMinutes: null },
          amazonAds: { ...store.session?.amazonAds, status: "disconnected", scope: "none", freshnessMinutes: null },
        },
        lastValidation: {
          ok: true,
          message: "浏览器 Profile 冲突已解除，请重新确认领星与 Amazon Ads 会话",
          at,
          action: actionName,
        },
      };
    }
  }
  return nextStores;
}

function reduceStoreCrud(state, action, operation) {
  const input = payloadFor(action, "store");
  const targetStoreId = asText(
    action.targetStoreId || action.payload?.targetStoreId || input.id || input.code,
  ).toUpperCase();
  const previous = state.stores[targetStoreId] || null;
  const at = nowFor(action);

  if (operation === "create") {
    const error = validateStoreInput(input, state);
    if (error) {
      const active = reject(state.stores[state.activeStoreId], action, error, "store", targetStoreId || state.activeStoreId);
      return { ...state, stores: { ...state.stores, [state.activeStoreId]: active }, updatedAt: at };
    }
    const catalog = normalizeStoreCatalog(input);
    const base = createSecondaryStore(catalog, {
      archived: false,
      status: "active",
      session: {
        id: `session-${catalog.id.toLowerCase()}`,
        status: "disconnected",
        statusLabel: "待登录",
        startedAt: null,
        lastVerifiedAt: null,
        lastHeartbeat: null,
        operator: actorFor(action),
        profile: catalog.browserProfileId,
        lingxing: { status: "disconnected", account: catalog.lingxingAccount, freshnessMinutes: null },
        amazonAds: { status: "disconnected", profileId: null, scope: "none" },
      },
    });
    const created = appendAudit(base, action, {
      outcome: "success",
      entityType: "store",
      entityId: catalog.id,
      summary: `已创建独立店铺 ${catalog.id}`,
      details: { marketplace: catalog.marketplace, profile: catalog.browserProfileId },
    });
    return {
      ...state,
      stores: { ...state.stores, [catalog.id]: created },
      updatedAt: at,
    };
  }

  if (!previous) {
    const active = reject(state.stores[state.activeStoreId], action, "店铺不存在", "store", targetStoreId || state.activeStoreId);
    return { ...state, stores: { ...state.stores, [state.activeStoreId]: active }, updatedAt: at };
  }

  if (operation === "update") {
    const mergedInput = { ...previous, ...input, id: previous.id, code: previous.code };
    const error = validateStoreInput(mergedInput, state, previous);
    if (error) {
      const rejected = reject(previous, action, error, "store", previous.id);
      return { ...state, stores: { ...state.stores, [previous.id]: rejected }, updatedAt: at };
    }
    const catalog = normalizeStoreCatalog(mergedInput, previous);
    const profileChanged = asText(previous.browserProfileId || previous.session?.profile) !== catalog.browserProfileId;
    const lingxingAccountChanged = asText(previous.lingxingAccount || previous.session?.lingxing?.account) !== catalog.lingxingAccount;
    const sessionIdentityChanged = profileChanged || lingxingAccountChanged;
    const next = appendAudit({
      ...previous,
      ...catalog,
      profileConflict: false,
      status: previous.archived ? "archived" : "active",
      session: {
        ...previous.session,
        status: sessionIdentityChanged ? "disconnected" : previous.session?.status,
        statusLabel: sessionIdentityChanged ? "身份配置已变化，等待重新确认" : previous.session?.statusLabel,
        lastVerifiedAt: sessionIdentityChanged ? null : previous.session?.lastVerifiedAt,
        lastHeartbeat: sessionIdentityChanged ? null : previous.session?.lastHeartbeat,
        profile: catalog.browserProfileId,
        lingxing: {
          ...previous.session?.lingxing,
          account: catalog.lingxingAccount,
          status: sessionIdentityChanged ? "disconnected" : previous.session?.lingxing?.status,
          freshnessMinutes: sessionIdentityChanged ? null : previous.session?.lingxing?.freshnessMinutes,
          lastRunAt: sessionIdentityChanged ? null : previous.session?.lingxing?.lastRunAt,
          lastCollectedAt: sessionIdentityChanged ? null : previous.session?.lingxing?.lastCollectedAt,
        },
        amazonAds: profileChanged
          ? {
              ...previous.session?.amazonAds,
              status: "disconnected",
              profileId: catalog.browserProfileId,
              scope: "none",
              freshnessMinutes: null,
              lastRunAt: null,
              lastCollectedAt: null,
            }
          : previous.session?.amazonAds,
      },
    }, action, {
      outcome: "success",
      entityType: "store",
      entityId: previous.id,
      summary: `已更新店铺 ${previous.id} 配置`,
      details: { before: normalizeStoreCatalog(previous, previous), after: catalog, sessionInvalidated: sessionIdentityChanged },
    });
    const nextStores = reconcileProfileConflicts({ ...state.stores, [previous.id]: next }, at, action.type);
    return { ...state, stores: nextStores, updatedAt: at };
  }

  if (operation === "archive") {
    if (targetStoreId === state.activeStoreId) {
      const rejected = reject(previous, action, "当前正在使用的店铺不能归档，请先切换店铺", "store", targetStoreId);
      return { ...state, stores: { ...state.stores, [targetStoreId]: rejected }, updatedAt: at };
    }
    const hasRunningWork = firstArray(previous.missions).some((item) => ["active", "running"].includes(item.status))
      || firstArray(previous.executionQueue).some((item) => ["ready", "queued", "running", "applied"].includes(item.status))
      || firstArray(previous.experiments).some((item) => ["active", "running"].includes(item.status));
    if (hasRunningWork) {
      const rejected = reject(previous, action, "店铺仍有运行中的 Mission、实验或待回读动作，不能归档", "store", targetStoreId);
      return { ...state, stores: { ...state.stores, [targetStoreId]: rejected }, updatedAt: at };
    }
    const next = appendAudit({ ...previous, archived: true, status: "archived", mode: "approval" }, action, {
      outcome: "success",
      entityType: "store",
      entityId: targetStoreId,
      summary: `已归档店铺 ${targetStoreId}`,
    });
    return { ...state, stores: { ...state.stores, [targetStoreId]: next }, updatedAt: at };
  }

  if (operation === "restore") {
    const next = appendAudit({ ...previous, archived: false, status: "active", mode: "approval" }, action, {
      outcome: "success",
      entityType: "store",
      entityId: targetStoreId,
      summary: `已恢复店铺 ${targetStoreId}`,
    });
    return { ...state, stores: { ...state.stores, [targetStoreId]: next }, updatedAt: at };
  }

  if (operation === "delete") {
    if (targetStoreId === state.activeStoreId) {
      const rejected = reject(previous, action, "当前正在使用的店铺不能删除，请先切换店铺", "store", targetStoreId);
      return { ...state, stores: { ...state.stores, [targetStoreId]: rejected }, updatedAt: at };
    }
    if (!previous.archived && previous.status !== "archived") {
      const rejected = reject(previous, action, "只能删除已归档店铺", "store", targetStoreId);
      return { ...state, stores: { ...state.stores, [targetStoreId]: rejected }, updatedAt: at };
    }
    if (storeBusinessRecordCount(previous) > 0 || firstArray(previous.causalLedger).length > 0) {
      const rejected = reject(previous, action, "店铺仍有业务或因果记录，只能保留归档不能删除", "store", targetStoreId);
      return { ...state, stores: { ...state.stores, [targetStoreId]: rejected }, updatedAt: at };
    }
    const remainingStores = { ...state.stores };
    delete remainingStores[targetStoreId];
    const stores = reconcileProfileConflicts(remainingStores, at, action.type);
    stores[state.activeStoreId] = appendAudit(stores[state.activeStoreId], action, {
      outcome: "success",
      entityType: "store",
      entityId: targetStoreId,
      summary: `已永久删除空店铺 ${targetStoreId}`,
    });
    return { ...state, stores, updatedAt: at };
  }

  return state;
}

function reduceSession(state, action, operation) {
  return updateStore(state, action, (store) => {
    const at = nowFor(action);
    const source = action.source || action.payload?.source || "lingxing";
    if (!COLLECTION_SOURCES.has(source)) return reject(store, action, "会话来源无效", "session", store.session?.id);
    if (store.profileConflict && operation !== "disconnect") return reject(store, action, "浏览器 Profile 与其他店铺冲突，请先在店铺设置中改为唯一 Profile", "session", store.session?.id);
    const sourceLabel = source === "amazon_ads" ? "Amazon Ads" : "领星";
    if (operation === "connect") {
      const profile = store.browserProfileId || store.session?.profile || `${store.id.toLowerCase()}-profile`;
      const account = store.lingxingAccount || store.session?.lingxing?.account || store.id;
      const nextLingxing = source === "lingxing"
        ? { ...(store.session?.lingxing || {}), status: "connected", account, freshnessMinutes: 0, lastVerifiedAt: at }
        : { ...(store.session?.lingxing || {}) };
      const nextAds = source === "amazon_ads"
        ? { ...(store.session?.amazonAds || {}), status: "connected", profileId: store.session?.amazonAds?.profileId || `ads-${store.id.toLowerCase()}`, scope: "read_write_simulated", lastVerifiedAt: at }
        : { ...(store.session?.amazonAds || {}) };
      const bothConnected = nextLingxing.status === "connected" && nextAds.status === "connected";
      const nextStore = {
        ...store,
        mode: "approval",
        session: {
          ...(store.session || {}),
          status: bothConnected ? "connected" : "attention",
          statusLabel: bothConnected ? "领星与 Ads 会话正常" : `${sourceLabel} 已连接，另一路待确认`,
          startedAt: store.session?.startedAt || at,
          lastVerifiedAt: at,
          lastHeartbeat: "刚刚",
          uptime: "00:00",
          profile,
          visibleBrowser: true,
          lingxing: nextLingxing,
          amazonAds: nextAds,
        },
      };
      return succeed(nextStore, action, {
        entityType: "session",
        entityId: nextStore.session.id,
        summary: `已通过可见浏览器模拟确认 ${store.id} 的 ${sourceLabel} 会话`,
      }, {
        type: "session_reconnect",
        entityType: "session",
        entityId: nextStore.session.id,
        title: `${store.id} ${sourceLabel} 会话已重新确认`,
        intervention: `Profile ${profile} · ${sourceLabel} · 可见浏览器`,
        status: "recorded",
      });
    }
    if (operation === "refresh") {
      const sourceSession = source === "amazon_ads" ? store.session?.amazonAds : store.session?.lingxing;
      if (sourceSession?.status !== "connected") return reject(store, action, `${sourceLabel} 会话未连接，请先打开对应的可见浏览器完成确认`, "session", store.session?.id);
      return appendAudit({
        ...store,
        session: {
          ...store.session,
          lastVerifiedAt: at,
          lastHeartbeat: "刚刚",
          lingxing: source === "lingxing" ? { ...store.session.lingxing, freshnessMinutes: 0, lastVerifiedAt: at } : store.session.lingxing,
          amazonAds: source === "amazon_ads" ? { ...store.session.amazonAds, freshnessMinutes: 0, lastVerifiedAt: at } : store.session.amazonAds,
        },
      }, action, {
        outcome: "success",
        entityType: "session",
        entityId: store.session?.id,
        summary: `${sourceLabel} 会话心跳与数据新鲜度已刷新`,
      });
    }
    const nextLingxing = source === "lingxing"
      ? { ...(store.session?.lingxing || {}), status: "disconnected" }
      : { ...(store.session?.lingxing || {}) };
    const nextAds = source === "amazon_ads"
      ? { ...(store.session?.amazonAds || {}), status: "disconnected", scope: "none" }
      : { ...(store.session?.amazonAds || {}) };
    const remainingConnected = nextLingxing.status === "connected" || nextAds.status === "connected";
    const nextStore = {
      ...store,
      mode: "approval",
      session: {
        ...(store.session || {}),
        status: remainingConnected ? "attention" : "disconnected",
        statusLabel: remainingConnected ? `${sourceLabel} 已断开，另一路仍连接` : "全部会话已断开",
        lastHeartbeat: null,
        uptime: null,
        lingxing: nextLingxing,
        amazonAds: nextAds,
      },
    };
    return appendAudit(nextStore, action, {
      outcome: "success",
      entityType: "session",
      entityId: store.session?.id,
      summary: `已断开 ${store.id} 的 ${sourceLabel} 会话`,
    });
  });
}

const SHC_STORE = {
  ...STORE_CATALOG[0],
  mode: "approval",
  selectedProductId: "product-shc-airfryer",
  session: {
    id: "session-shc-20260721",
    status: "connected",
    startedAt: "2026-07-21T08:42:00.000Z",
    lastVerifiedAt: "2026-07-21T09:38:00.000Z",
    operator: "WZ",
    lingxing: {
      status: "connected",
      account: "SHC001",
      freshnessMinutes: 6,
    },
    amazonAds: {
      status: "connected",
      profileId: "amz-us-shc-01",
      scope: "read_write_simulated",
    },
  },
  products: [
    {
      id: "product-shc-airfryer",
      name: "Compact Glass Air Fryer",
      asin: "B0C7KZ8P2Q",
      sku: "SHC-AF-4QT",
      status: "active",
      price: 79.99,
      cost: 31.4,
      targetAcos: 24,
      currency: "USD",
      inventory: 864,
      contributionMarginPct: 28.7,
      createdAt: "2026-06-02T02:00:00.000Z",
      updatedAt: "2026-07-21T08:30:00.000Z",
    },
    {
      id: "product-shc-bags",
      name: "Reusable Storage Bags · 12 Pack",
      asin: "B0BXN6W2L7",
      sku: "SHC-BAG-12",
      status: "active",
      price: 22.99,
      cost: 7.8,
      targetAcos: 21,
      currency: "USD",
      inventory: 1470,
      contributionMarginPct: 32.1,
      createdAt: "2026-05-19T02:00:00.000Z",
      updatedAt: "2026-07-20T20:15:00.000Z",
    },
  ],
  adObjects: [
    {
      id: "ad-shc-campaign",
      externalId: "SP-US-8842901",
      productId: "product-shc-airfryer",
      name: "SP · Air Fryer · Exact",
      type: "campaign",
      status: "enabled",
      dailyBudget: 85,
      sales7d: 1943.7,
      spend7d: 512.6,
      acos7d: 26.37,
      currency: "USD",
      createdAt: "2026-06-03T02:00:00.000Z",
      updatedAt: "2026-07-21T09:34:00.000Z",
    },
    {
      id: "ad-shc-group-exact",
      externalId: "AG-US-8842901-01",
      productId: "product-shc-airfryer",
      parentId: "ad-shc-campaign",
      name: "Air Fryer · Core Exact",
      type: "ad_group",
      status: "enabled",
      targetAcos: 24,
      currency: "USD",
      createdAt: "2026-06-03T02:00:00.000Z",
      updatedAt: "2026-07-21T09:34:00.000Z",
    },
    {
      id: "ad-shc-keyword-air-fryer",
      externalId: "KW-US-447721",
      productId: "product-shc-airfryer",
      parentId: "ad-shc-group-exact",
      name: "compact air fryer",
      type: "keyword",
      matchType: "exact",
      status: "enabled",
      bid: 1.3,
      cpc7d: 1.17,
      conversions7d: 24,
      currency: "USD",
      createdAt: "2026-06-03T02:00:00.000Z",
      updatedAt: "2026-07-21T09:34:00.000Z",
    },
    {
      id: "ad-shc-keyword-glass",
      externalId: "KW-US-447735",
      productId: "product-shc-airfryer",
      parentId: "ad-shc-group-exact",
      name: "glass air fryer",
      type: "keyword",
      matchType: "phrase",
      status: "enabled",
      bid: 1.2,
      cpc7d: 1.11,
      conversions7d: 5,
      currency: "USD",
      createdAt: "2026-06-03T02:00:00.000Z",
      updatedAt: "2026-07-21T09:34:00.000Z",
    },
  ],
  collectionRuns: [
    {
      id: "collect-shc-hourly",
      name: "领星经营与广告小时同步",
      kind: "job",
      source: "lingxing",
      status: "completed",
      progress: 100,
      frequencyMinutes: 60,
      records: 12842,
      freshnessMinutes: 6,
      lastRunAt: "2026-07-21T09:32:00.000Z",
      nextRunAt: "2026-07-21T10:32:00.000Z",
      createdAt: "2026-06-01T02:00:00.000Z",
      updatedAt: "2026-07-21T09:35:00.000Z",
    },
    {
      id: "collect-shc-ads-readback",
      name: "Amazon Ads 竞价回读",
      kind: "job",
      source: "amazon_ads",
      status: "idle",
      progress: 0,
      frequencyMinutes: 30,
      lastRunAt: "2026-07-21T09:20:00.000Z",
      nextRunAt: "2026-07-21T09:50:00.000Z",
      createdAt: "2026-06-01T02:00:00.000Z",
      updatedAt: "2026-07-21T09:20:00.000Z",
    },
  ],
  reportImports: [
    {
      id: "report-shc-ads-20260721",
      name: "广告活动报表 · 2026-07-21",
      fileName: "SHC001_ads_campaign_20260721.xlsx",
      source: "lingxing",
      reportType: "ads_campaign",
      status: "imported",
      rowCount: 12842,
      period: "2026-07-14 — 2026-07-20",
      importedAt: "2026-07-21T09:32:00.000Z",
      createdAt: "2026-07-21T09:32:00.000Z",
      updatedAt: "2026-07-21T09:32:00.000Z",
    },
  ],
  missions: [
    {
      id: "mission-shc-margin",
      title: "Prime Day 后 7 日利润守护",
      objective: "在保持订单量的前提下把 Air Fryer 广告 ACOS 拉回 24% 以内",
      status: "active",
      phase: "decide",
      priority: "P1",
      progress: 33,
      productId: "product-shc-airfryer",
      productLabel: "SHC-AF-4QT / B0C7KZ8P2Q",
      observationWindow: "2026-07-20 — 2026-07-26（7 天）",
      boundaryLabel: "策略内自动 · 高影响需审批",
      automationBudget: "$42 / $120",
      currentSkill: "Crux 决策引擎 v1.6",
      pauseReason: "检测到 25% 高影响竞价调整，Agent 已在写入前停驻并等待人工批准。",
      screenshotCount: "1 张 · 09:02:15",
      lastReloadId: "7f2c9e1a · 200 OK",
      evidenceProgress: "43 / 43 已校验",
      owner: "agent",
      startedAt: "2026-07-21T08:45:00.000Z",
      dueAt: "2026-07-28T08:45:00.000Z",
      decisionIds: ["decision-shc-policy-cut", "decision-shc-aggressive-cut"],
      experimentIds: ["experiment-shc-elasticity"],
      executionIds: ["execution-shc-policy-cut", "execution-shc-aggressive-cut"],
      successCriteria: [
        "ACOS ≤ 24%",
        "订单量下降不超过 8%",
        "所有竞价写入均有回读证据",
      ],
      guardrails: ["ACOS ≥ 25%", "订单量下降 ≤ 8%", "花费下降 ≤ 15%"],
      checkpoints: [
        { id: "mission-shc-observe", stage: "FACT", time: "08:30", title: "领星报表已采集", skill: "报表采集 v2.1", status: "completed", evidenceCount: "8 / 8" },
        { id: "mission-shc-validate", stage: "ANALYSIS", time: "08:36", title: "数据口径已校验", skill: "指标校验 v1.4", status: "completed", evidenceCount: "12 / 12" },
        { id: "mission-shc-diagnose", stage: "ANALYSIS", time: "08:45", title: "广告对象已诊断", skill: "广告诊断 v2.3", status: "completed", evidenceCount: "23 / 23" },
        { id: "mission-shc-decide", stage: "DECISION", time: "09:02", title: "正在等待 Crux 决策", skill: "Crux 决策引擎 v1.6", status: "needs_approval", evidenceCount: "23 条证据" },
        { id: "mission-shc-act", stage: "ACTION", time: "—", title: "执行与回读", skill: "可见浏览器执行 v2.0", status: "pending", evidenceCount: "0 / —" },
        { id: "mission-shc-effect", stage: "EFFECT", time: "—", title: "7 日效果观察", skill: "效果观察 v1.2", status: "pending", evidenceCount: "0 / —" },
      ],
    },
  ],
  decisions: [
    {
      id: "decision-shc-policy-cut",
      missionId: "mission-shc-margin",
      productId: "product-shc-airfryer",
      adObjectId: "ad-shc-keyword-air-fryer",
      title: "将 compact air fryer 竞价从 $1.30 调至 $1.14",
      rationale: "近 7 日 CPC 上扬但转化率稳定，温和降价可修复 ACOS 且不破坏曝光。",
      beforeBid: 1.3,
      proposedBid: 1.14,
      changePct: -12,
      changePctExact: -12.31,
      currency: "USD",
      status: "approved",
      policyId: "policy-shc-bid-guardrail",
      policyBound: true,
      autoExecutable: true,
      expectedEffect: "预计 ACOS 下降 2.1–3.4 个百分点，订单量变化在 ±5% 内。",
      recommendation: "将 compact air fryer 竞价从 $1.30 降至 $1.14（-12%）",
      facts: [
        "过去 7 日 ACOS 26.37%，高于目标 24%。",
        "CPC 上升 9.8%，CVR 仅下降 0.7%。",
        "当前竞价仍高于策略最低值 $1.00。",
      ],
      alternatives: ["下调 8%（更保守）", "下调 15%（更激进）", "维持不变"],
      validity: "批准后生效 · 24 小时内执行",
      confidence: 0.82,
      approval: {
        required: false,
        status: "policy_approved",
        approvedBy: "policy-engine",
        approvedAt: "2026-07-21T09:36:00.000Z",
        policyId: "policy-shc-bid-guardrail",
        reason: "12% 降幅小于策略允许的 15%，目标竞价高于 $1.00 下限。",
      },
      createdAt: "2026-07-21T09:35:00.000Z",
      updatedAt: "2026-07-21T09:36:00.000Z",
    },
    {
      id: "decision-shc-aggressive-cut",
      missionId: "mission-shc-margin",
      productId: "product-shc-airfryer",
      adObjectId: "ad-shc-keyword-glass",
      title: "将 glass air fryer 竞价从 $1.20 调至 $0.90",
      rationale: "低转化搜索词的激进止损备选方案，需运营者判断流量损失风险。",
      beforeBid: 1.2,
      proposedBid: 0.9,
      changePct: -25,
      changePctExact: -25,
      currency: "USD",
      status: "needs_approval",
      policyId: "policy-shc-bid-guardrail",
      policyBound: false,
      autoExecutable: false,
      expectedEffect: "预计浪费点击减少，但曝光可能下降 18–30%。",
      recommendation: "将 glass air fryer 竞价从 $1.20 降至 $0.90（-25%）",
      facts: [
        "过去 7 日 ACOS 48.2%，显著高于目标 28%。",
        "花费占广告活动 14.6%，贡献订单占比 8.3%。",
        "近 7 天转化率下降 11%，竞争度上升 18%。",
      ],
      alternatives: ["下调 8%（更保守）", "下调 15%（策略上限）", "维持不变", "加入否定词"],
      validity: "人工批准后生效 · 2026-07-22 09:00 过期",
      confidence: 0.66,
      approval: {
        required: true,
        status: "waiting",
        approvedBy: null,
        policyId: "policy-shc-bid-guardrail",
        reason: "25% 降幅超过策略自动上限 15%；该动作永不进入策略内自动执行。",
      },
      createdAt: "2026-07-21T09:37:00.000Z",
      updatedAt: "2026-07-21T09:37:00.000Z",
    },
  ],
  experiments: [
    {
      id: "experiment-shc-elasticity",
      missionId: "mission-shc-margin",
      productId: "product-shc-airfryer",
      adObjectId: "ad-shc-keyword-air-fryer",
      name: "核心词竞价弹性 · 7 日",
      hypothesis: "竞价下降 10–15% 可降低 CPC，同时保持至少 92% 的订单量。",
      primaryMetric: "ACOS",
      guardrailMetrics: ["订单量", "自然排名", "曝光"],
      status: "running",
      variant: "1.14 USD",
      baseline: "1.30 USD",
      observationWindow: "2026-07-21 — 2026-07-28（7 天）",
      guardrails: ["订单量 ≥ 基线 92%", "自然排名不下降超过 3 位", "曝光下降 ≤ 15%"],
      startedAt: "2026-07-21T09:38:00.000Z",
      endsAt: "2026-07-28T09:38:00.000Z",
      sampleProgress: 18,
      records: [
        {
          id: "experiment-record-shc-baseline",
          title: "基线窗口已锁定",
          type: "baseline",
          status: "recorded",
          observation: "基线竞价 $1.30，7 日 ACOS 26.37%，24 单。",
          observedAt: "2026-07-21T09:38:00.000Z",
          createdAt: "2026-07-21T09:38:00.000Z",
          updatedAt: "2026-07-21T09:38:00.000Z",
        },
      ],
      createdAt: "2026-07-21T09:38:00.000Z",
      updatedAt: "2026-07-21T09:38:00.000Z",
    },
  ],
  executionQueue: [
    {
      id: "execution-shc-policy-cut",
      missionId: "mission-shc-margin",
      decisionId: "decision-shc-policy-cut",
      productId: "product-shc-airfryer",
      adObjectId: "ad-shc-keyword-air-fryer",
      title: "应用核心词策略内竞价",
      actionType: "set_keyword_bid",
      beforeValue: 1.3,
      targetValue: 1.14,
      deltaPct: -12,
      currency: "USD",
      status: "ready",
      owner: "agent",
      executionMode: "policy_auto",
      policyBound: true,
      autoEligible: true,
      simulation: true,
      policyId: "policy-shc-bid-guardrail",
      createdAt: "2026-07-21T09:36:00.000Z",
      updatedAt: "2026-07-21T09:36:00.000Z",
    },
    {
      id: "execution-shc-aggressive-cut",
      missionId: "mission-shc-margin",
      decisionId: "decision-shc-aggressive-cut",
      productId: "product-shc-airfryer",
      adObjectId: "ad-shc-keyword-glass",
      title: "应用高风险 25% 竞价降幅",
      actionType: "set_keyword_bid",
      beforeValue: 1.2,
      targetValue: 0.9,
      deltaPct: -25,
      currency: "USD",
      status: "awaiting_approval",
      owner: "operator",
      executionMode: "human_only",
      policyBound: false,
      autoEligible: false,
      simulation: true,
      policyId: "policy-shc-bid-guardrail",
      blockedReason: "25% 降幅超过 15% 自动策略护栏，等待人工审批且禁止策略内自动执行。",
      createdAt: "2026-07-21T09:37:00.000Z",
      updatedAt: "2026-07-21T09:37:00.000Z",
    },
  ],
  causalLedger: [
    {
      id: "cause-shc-policy-decision",
      at: "2026-07-21T09:36:00.000Z",
      type: "decision",
      source: "policy-engine",
      actor: "agent",
      entityType: "decision",
      entityId: "decision-shc-policy-cut",
      missionId: "mission-shc-margin",
      title: "12% 温和降价进入策略内执行",
      signal: "7 日 CPC +9.8%，CVR 仅 -0.7%，ACOS 达 26.37%。",
      intervention: "$1.30 → $1.14（-12%）",
      expectedEffect: "ACOS 回落且订单量变化不超过 5%。",
      observedEffect: null,
      confidence: 0.82,
      status: "approved",
      links: ["policy-shc-bid-guardrail", "ad-shc-keyword-air-fryer"],
    },
    {
      id: "cause-shc-price-event",
      at: "2026-07-20T16:00:00.000Z",
      type: "operation_event",
      source: "operator",
      actor: "WZ",
      entityType: "operation_event",
      entityId: "operation-shc-coupon",
      missionId: "mission-shc-margin",
      title: "Prime Day Coupon 从 15% 恢复为 5%",
      signal: "活动结束后价格恢复，广告 CVR 出现短期回落。",
      intervention: "Coupon 15% → 5%",
      expectedEffect: null,
      observedEffect: "随后 12 小时 CVR 下降 6.2%。",
      confidence: 0.91,
      status: "observed",
      links: ["product-shc-airfryer"],
    },
  ],
  operationEvents: [
    {
      id: "operation-shc-coupon",
      title: "Prime Day Coupon 从 15% 恢复为 5%",
      type: "promotion",
      impact: "negative_short_term",
      productId: "product-shc-airfryer",
      description: "活动结束后的计划性调价，需在 AI 诊断中排除价格混杂因素。",
      createdAt: "2026-07-20T16:00:00.000Z",
      actor: "WZ",
    },
  ],
  policies: [
    {
      id: "policy-shc-bid-guardrail",
      name: "SHC 核心词竞价自动护栏",
      scope: "bid",
      status: "active",
      priority: 10,
      rules: {
        maxAutoBidDecreasePct: 15,
        maxAutoBidIncreasePct: 10,
        minBid: 1,
        maxBid: 2.5,
      },
      createdAt: "2026-06-10T02:00:00.000Z",
      updatedAt: "2026-07-18T02:00:00.000Z",
    },
    {
      id: "policy-shc-budget-guardrail",
      name: "SHC 广告预算自动护栏",
      scope: "budget",
      status: "active",
      priority: 15,
      riskBudget: 120,
      rules: {
        metric: "budgetChangePct",
        maxDailyBudgetChangePct: 10,
        action: "require_approval",
      },
      createdAt: "2026-06-10T02:00:00.000Z",
      updatedAt: "2026-07-18T02:00:00.000Z",
    },
    {
      id: "policy-shc-data-freshness",
      name: "数据新鲜度执行门",
      scope: "data",
      status: "active",
      priority: 20,
      rules: {
        minDataFreshnessMinutes: 90,
        requireLingxingSession: true,
        requireAdsSession: true,
      },
      createdAt: "2026-06-10T02:00:00.000Z",
      updatedAt: "2026-07-18T02:00:00.000Z",
    },
  ],
  settings: {
    simulationOnly: true,
    requireVisibleBrowser: true,
    collectionFrequencyMinutes: 60,
    defaultMissionHorizonDays: 7,
    autoStartPolicyEligible: false,
    locale: "zh-CN",
    aiProvider: "openai",
    aiModel: "gpt-5",
    aiBaseUrl: "https://api.openai.com/v1",
    aiCredentialStatus: { configured: false, provider: "openai", storage: "main_only_simulated", updatedAt: null, lastTestedAt: null, lastTestStatus: null },
    notifications: {
      approvalRequired: true,
      executionFailed: true,
      missionComplete: true,
    },
    updatedAt: "2026-07-21T08:40:00.000Z",
  },
  audit: [
    {
      id: "audit-shc-approval",
      at: "2026-07-21T09:36:00.000Z",
      actor: "policy-engine",
      action: "POLICY_APPROVAL",
      outcome: "success",
      entityType: "decision",
      entityId: "decision-shc-policy-cut",
      summary: "12% 竞价降幅通过策略护栏",
      details: { policyId: "policy-shc-bid-guardrail" },
    },
    {
      id: "audit-shc-block",
      at: "2026-07-21T09:37:00.000Z",
      actor: "policy-engine",
      action: "POLICY_GATE",
      outcome: "blocked",
      entityType: "decision",
      entityId: "decision-shc-aggressive-cut",
      summary: "25% 竞价降幅被转入人工审批",
      details: { maxAutoBidDecreasePct: 15 },
    },
  ],
  lastValidation: {
    ok: true,
    message: "店铺演示数据已就绪",
    at: "2026-07-21T09:38:00.000Z",
    action: "INIT",
  },
};

function createSecondaryStore(catalog, overrides) {
  return {
    ...catalog,
    mode: "approval",
    selectedProductId: null,
    session: {
      id: "session-" + catalog.id.toLowerCase(),
      status: "disconnected",
      startedAt: null,
      lastVerifiedAt: null,
      operator: "WZ",
      lingxing: { status: "disconnected", account: catalog.id, freshnessMinutes: null },
      amazonAds: { status: "disconnected", profileId: null, scope: "none" },
    },
    products: [],
    adObjects: [],
    collectionRuns: [],
    reportImports: [],
    missions: [],
    decisions: [],
    experiments: [],
    executionQueue: [],
    causalLedger: [],
    operationEvents: [],
    policies: [],
    settings: {
      simulationOnly: true,
      requireVisibleBrowser: true,
      collectionFrequencyMinutes: 60,
      defaultMissionHorizonDays: 7,
      autoStartPolicyEligible: false,
      locale: "zh-CN",
      aiProvider: "openai",
      aiModel: "gpt-5",
      aiBaseUrl: "https://api.openai.com/v1",
      aiCredentialStatus: { configured: false, provider: "openai", storage: "main_only_simulated", updatedAt: null, lastTestedAt: null, lastTestStatus: null },
      notifications: {
        approvalRequired: true,
        executionFailed: true,
        missionComplete: true,
      },
      updatedAt: "2026-07-21T08:00:00.000Z",
    },
    audit: [],
    lastValidation: {
      ok: true,
      message: "店铺演示数据已就绪",
      at: "2026-07-21T08:00:00.000Z",
      action: "INIT",
    },
    ...overrides,
  };
}

const LMX_STORE = createSecondaryStore(STORE_CATALOG[1], {
  mode: "approval",
  selectedProductId: "product-lmx-kettle",
  session: {
    id: "session-lmx-20260721",
    status: "attention",
    startedAt: "2026-07-21T07:10:00.000Z",
    lastVerifiedAt: "2026-07-21T07:12:00.000Z",
    operator: "WZ",
    lingxing: { status: "expired", account: "LMX002", freshnessMinutes: 173 },
    amazonAds: {
      status: "connected",
      profileId: "amz-us-lmx-02",
      scope: "read_write_simulated",
    },
  },
  products: [
    {
      id: "product-lmx-kettle",
      name: "Temperature Control Kettle",
      asin: "B0D1LMX2Q8",
      sku: "LMX-KTL-US",
      status: "active",
      price: 54.9,
      cost: 21.7,
      targetAcos: 22,
      currency: "USD",
      inventory: 328,
      contributionMarginPct: 25.3,
      createdAt: "2026-06-12T02:00:00.000Z",
      updatedAt: "2026-07-21T07:00:00.000Z",
    },
  ],
  adObjects: [
    {
      id: "ad-lmx-campaign",
      externalId: "SP-US-221008",
      productId: "product-lmx-kettle",
      name: "SP · Wasserkocher · Exact",
      type: "campaign",
      status: "enabled",
      dailyBudget: 45,
      currency: "USD",
      createdAt: "2026-06-13T02:00:00.000Z",
      updatedAt: "2026-07-21T06:50:00.000Z",
    },
  ],
  collectionRuns: [
    {
      id: "collect-lmx-daily",
      name: "领星美国站经营日报",
      kind: "job",
      source: "lingxing",
      status: "failed",
      progress: 62,
      frequencyMinutes: 1440,
      lastRunAt: "2026-07-21T07:04:00.000Z",
      error: "领星会话已过期，等待重新连接",
      createdAt: "2026-06-12T02:00:00.000Z",
      updatedAt: "2026-07-21T07:08:00.000Z",
    },
  ],
  missions: [
    {
      id: "mission-lmx-recover",
      title: "美国站数据恢复与利润诊断",
      objective: "恢复领星数据后重新评估水壶广告效率",
      status: "paused",
      phase: "collect",
      priority: "P1",
      progress: 10,
      productId: "product-lmx-kettle",
      owner: "operator",
      pausedReason: "lingxing_session_expired",
      startedAt: "2026-07-21T07:00:00.000Z",
      dueAt: "2026-07-22T07:00:00.000Z",
      decisionIds: ["decision-lmx-wait"],
      experimentIds: [],
      executionIds: [],
      successCriteria: ["数据新鲜度 < 90 分钟", "完成一次利润诊断"],
    },
  ],
  decisions: [
    {
      id: "decision-lmx-wait",
      missionId: "mission-lmx-recover",
      title: "暂停广告优化直至领星数据恢复",
      rationale: "经营数据已超过新鲜度门限，任何竞价建议都可能基于过期信号。",
      status: "needs_data",
      policyId: "policy-lmx-freshness",
      policyBound: true,
      autoExecutable: false,
      confidence: 0.97,
      approval: {
        required: false,
        status: "blocked_by_data",
        reason: "领星数据新鲜度 173 分钟，超过 90 分钟上限。",
      },
      createdAt: "2026-07-21T07:08:00.000Z",
      updatedAt: "2026-07-21T07:08:00.000Z",
    },
  ],
  policies: [
    {
      id: "policy-lmx-freshness",
      name: "LMX 数据新鲜度执行门",
      scope: "data",
      status: "active",
      priority: 10,
      rules: {
        minDataFreshnessMinutes: 90,
        requireLingxingSession: true,
        requireAdsSession: true,
      },
      createdAt: "2026-06-12T02:00:00.000Z",
      updatedAt: "2026-07-18T02:00:00.000Z",
    },
  ],
  causalLedger: [
    {
      id: "cause-lmx-session-expired",
      at: "2026-07-21T07:08:00.000Z",
      type: "data_gate",
      source: "collection-runner",
      actor: "agent",
      entityType: "collectionJob",
      entityId: "collect-lmx-daily",
      missionId: "mission-lmx-recover",
      title: "领星会话过期阻断诊断",
      signal: "数据新鲜度 173 分钟。",
      intervention: "暂停 Mission",
      expectedEffect: "避免使用过期数据生成广告动作。",
      observedEffect: "没有执行项进入队列。",
      confidence: 1,
      status: "blocked",
      links: ["policy-lmx-freshness"],
    },
  ],
  audit: [
    {
      id: "audit-lmx-block",
      at: "2026-07-21T07:08:00.000Z",
      actor: "collection-runner",
      action: "DATA_FRESHNESS_GATE",
      outcome: "blocked",
      entityType: "mission",
      entityId: "mission-lmx-recover",
      summary: "领星会话过期，Mission 已暂停",
      details: { freshnessMinutes: 173 },
    },
  ],
});

const NOC_STORE = createSecondaryStore(STORE_CATALOG[2], {
  mode: "approval",
  selectedProductId: "product-noc-lamp",
  session: {
    id: "session-noc-20260721",
    status: "connected",
    startedAt: "2026-07-21T06:30:00.000Z",
    lastVerifiedAt: "2026-07-21T09:25:00.000Z",
    operator: "WZ",
    lingxing: { status: "connected", account: "NOC003", freshnessMinutes: 14 },
    amazonAds: {
      status: "connected",
      profileId: "amz-us-noc-03",
      scope: "read_only",
    },
  },
  products: [
    {
      id: "product-noc-lamp",
      name: "Sunrise Sleep Lamp",
      asin: "B0CNOC8L42",
      sku: "NOC-LAMP-US",
      status: "active",
      price: 46.99,
      cost: 18.2,
      targetAcos: 23,
      currency: "USD",
      inventory: 506,
      contributionMarginPct: 30.4,
      createdAt: "2026-05-28T02:00:00.000Z",
      updatedAt: "2026-07-21T09:10:00.000Z",
    },
  ],
  adObjects: [
    {
      id: "ad-noc-campaign",
      externalId: "SP-US-932114",
      productId: "product-noc-lamp",
      name: "SP · Sunrise Lamp · Research",
      type: "campaign",
      status: "enabled",
      dailyBudget: 38,
      currency: "USD",
      createdAt: "2026-05-29T02:00:00.000Z",
      updatedAt: "2026-07-21T09:12:00.000Z",
    },
  ],
  collectionRuns: [
    {
      id: "collect-noc-hourly",
      name: "领星美国站小时同步",
      kind: "job",
      source: "lingxing",
      status: "completed",
      progress: 100,
      frequencyMinutes: 60,
      records: 5218,
      freshnessMinutes: 14,
      lastRunAt: "2026-07-21T09:16:00.000Z",
      nextRunAt: "2026-07-21T10:16:00.000Z",
      createdAt: "2026-05-28T02:00:00.000Z",
      updatedAt: "2026-07-21T09:18:00.000Z",
    },
  ],
  missions: [
    {
      id: "mission-noc-launch",
      title: "Sunrise Lamp 美国站搜索词探索",
      objective: "发现可扩量的新搜索词并控制探索期浪费",
      status: "paused",
      phase: "experiment",
      priority: "P2",
      progress: 45,
      productId: "product-noc-lamp",
      owner: "operator",
      pausedReason: "manual_review",
      startedAt: "2026-07-18T09:00:00.000Z",
      dueAt: "2026-07-25T09:00:00.000Z",
      decisionIds: ["decision-noc-expand"],
      experimentIds: ["experiment-noc-search"],
      executionIds: [],
      successCriteria: ["发现 ≥ 3 个有效搜索词", "探索 ACOS ≤ 35%"],
    },
  ],
  decisions: [
    {
      id: "decision-noc-expand",
      missionId: "mission-noc-launch",
      productId: "product-noc-lamp",
      adObjectId: "ad-noc-campaign",
      title: "扩大 wake up light 词组探索预算",
      rationale: "点击质量改善但样本仍不足，等待实验复核。",
      decisionKind: "budget",
      beforeBudget: 38,
      proposedBudget: 46,
      changePct: 21,
      status: "draft",
      policyId: "policy-noc-exploration",
      policyBound: false,
      autoExecutable: false,
      confidence: 0.58,
      approval: {
        required: true,
        status: "not_requested",
        reason: "Amazon Ads 会话当前为只读，且实验样本尚未达标。",
      },
      createdAt: "2026-07-21T09:18:00.000Z",
      updatedAt: "2026-07-21T09:18:00.000Z",
    },
  ],
  experiments: [
    {
      id: "experiment-noc-search",
      missionId: "mission-noc-launch",
      productId: "product-noc-lamp",
      adObjectId: "ad-noc-campaign",
      name: "wake up light 搜索词探索",
      hypothesis: "扩大词组覆盖可在 ACOS 35% 内发现至少 3 个可转 Exact 的词。",
      primaryMetric: "有效搜索词数",
      guardrailMetrics: ["探索 ACOS", "无效点击"],
      status: "paused",
      pauseReason: "operator_review",
      baseline: "$38/day",
      variant: "候选 $46/day",
      startedAt: "2026-07-18T09:10:00.000Z",
      endsAt: "2026-07-25T09:10:00.000Z",
      sampleProgress: 45,
      records: [
        {
          id: "experiment-record-noc-review",
          title: "中期样本人工复核",
          type: "observation",
          status: "recorded",
          observation: "两个候选搜索词出现，但转化样本仍不足。",
          observedAt: "2026-07-21T09:20:00.000Z",
          createdAt: "2026-07-21T09:20:00.000Z",
          updatedAt: "2026-07-21T09:20:00.000Z",
        },
      ],
      createdAt: "2026-07-18T09:10:00.000Z",
      updatedAt: "2026-07-21T09:20:00.000Z",
    },
  ],
  policies: [
    {
      id: "policy-noc-exploration",
      name: "NOC 探索预算护栏",
      scope: "budget",
      status: "active",
      priority: 10,
      rules: {
        metric: "budgetChangePct",
        maxDailyBudgetChangePct: 10,
        action: "require_approval",
        requireHumanApproval: true,
      },
      createdAt: "2026-06-01T02:00:00.000Z",
      updatedAt: "2026-07-18T02:00:00.000Z",
    },
  ],
  causalLedger: [
    {
      id: "cause-noc-pause",
      at: "2026-07-21T09:20:00.000Z",
      type: "experiment_state",
      source: "operator",
      actor: "WZ",
      entityType: "experiment",
      entityId: "experiment-noc-search",
      missionId: "mission-noc-launch",
      title: "探索实验进入人工复核",
      signal: "样本完成 45%，两个候选词出现但统计置信度不足。",
      intervention: "暂停实验",
      expectedEffect: "避免过早扩预算。",
      observedEffect: null,
      confidence: 0.74,
      status: "paused",
      links: ["ad-noc-campaign"],
    },
  ],
  audit: [
    {
      id: "audit-noc-pause",
      at: "2026-07-21T09:20:00.000Z",
      actor: "WZ",
      action: "PAUSE_EXPERIMENT",
      outcome: "success",
      entityType: "experiment",
      entityId: "experiment-noc-search",
      summary: "实验已暂停，等待人工复核",
      details: null,
    },
  ],
});

const INITIAL_STATE = {
  version: STATE_VERSION,
  activeStoreId: "SHC001",
  stores: {
    SHC001: SHC_STORE,
    LMX002: LMX_STORE,
    NOC003: NOC_STORE,
  },
  createdAt: "2026-07-21T09:40:00.000Z",
  updatedAt: "2026-07-21T09:40:00.000Z",
};

export function createInitialState() {
  const state = clone(INITIAL_STATE);
  for (const store of Object.values(state.stores)) {
    store.policies = firstArray(store.policies).map((policy) => ({ ...policy, version: Number(policy.version || 1), versionHistory: firstArray(policy.versionHistory) }));
    store.decisions = firstArray(store.decisions).map((decision) => {
      const policy = store.policies.find((candidate) => candidate.id === decision.policyId);
      return policy ? { ...decision, policyVersion: decision.policyVersion || policy.version, policySnapshot: decision.policySnapshot || policySnapshotOf(policy) } : decision;
    });
    store.executionQueue = firstArray(store.executionQueue).map((execution) => {
      const decision = store.decisions.find((candidate) => candidate.id === execution.decisionId);
      const policy = store.policies.find((candidate) => candidate.id === (execution.policyId || decision?.policyId));
      return policy ? { ...execution, policyId: policy.id, policyVersion: execution.policyVersion || decision?.policyVersion || policy.version, policySnapshot: execution.policySnapshot || decision?.policySnapshot || policySnapshotOf(policy) } : execution;
    });
  }
  return state;
}

function hasDuplicateIds(items) {
  const ids = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    if (!item?.id) continue;
    if (ids.has(item.id)) return true;
    ids.add(item.id);
  }
  return false;
}

function normalizePersistedState(candidate) {
  if (!candidate || candidate.version !== STATE_VERSION || typeof candidate.stores !== "object") {
    return createInitialState();
  }

  const defaults = createInitialState();
  const stores = {};
  const catalogById = new Map(STORE_CATALOG.map((catalog) => [catalog.id, catalog]));
  for (const [candidateId, savedStore] of Object.entries(candidate.stores || {})) {
    const id = asText(savedStore?.id || candidateId).toUpperCase();
    if (catalogById.has(id) || !STORE_ID_PATTERN.test(id) || id !== candidateId.toUpperCase()) continue;
    if (!hasUsMarketIdentity(savedStore)) continue;
    const safeCatalog = normalizeStoreCatalog({
      id,
      name: savedStore?.name,
      shortName: savedStore?.shortName,
      marketplace: savedStore?.marketplace,
      region: savedStore?.region,
      currency: savedStore?.currency,
      businessTimezone: savedStore?.businessTimezone || savedStore?.timezone,
      timezone: savedStore?.timezone || savedStore?.businessTimezone,
      accent: savedStore?.accent,
      lingxingAccount: savedStore?.lingxingAccount || savedStore?.session?.lingxing?.account,
      browserProfileId: savedStore?.browserProfileId || savedStore?.session?.profile,
    });
    if (!safeCatalog.name || !hasUsMarketIdentity(safeCatalog)) continue;
    catalogById.set(id, safeCatalog);
  }
  for (const catalog of catalogById.values()) {
    const fallback = defaults.stores[catalog.id] || createSecondaryStore(catalog, {
      archived: Boolean(candidate.stores[catalog.id]?.archived),
      status: candidate.stores[catalog.id]?.archived ? "archived" : "active",
    });
    const saved = candidate.stores[catalog.id];
    if (!saved || typeof saved !== "object") {
      stores[catalog.id] = fallback;
      continue;
    }
    const savedSession = saved.session && typeof saved.session === "object" ? saved.session : {};
    const savedLingxing = savedSession.lingxing && typeof savedSession.lingxing === "object" ? savedSession.lingxing : {};
    const savedAds = savedSession.amazonAds && typeof savedSession.amazonAds === "object" ? savedSession.amazonAds : {};
    const savedFreshness = asFiniteNumber(savedLingxing.freshnessMinutes);
    const normalized = {
      ...fallback,
      ...saved,
      ...catalog,
      mode: "approval",
      archived: Boolean(saved.archived),
      status: saved.archived ? "archived" : "active",
      session: {
        ...fallback.session,
        ...savedSession,
        lingxing: {
          ...fallback.session.lingxing,
          ...savedLingxing,
          account: catalog.lingxingAccount || savedLingxing.account || catalog.id,
          freshnessMinutes: savedFreshness !== null && savedFreshness >= 0 ? savedFreshness : null,
        },
        amazonAds: {
          ...fallback.session.amazonAds,
          ...savedAds,
          scope: savedAds.scope === "read_write_simulated" ? "read_write_simulated" : "none",
        },
        profile: catalog.browserProfileId || savedSession.profile || `${catalog.id.toLowerCase()}-profile`,
      },
      settings:
        saved.settings && typeof saved.settings === "object"
          ? {
              ...fallback.settings,
              ...saved.settings,
              simulationOnly: true,
              requireVisibleBrowser: true,
              notifications: {
                ...fallback.settings.notifications,
                ...(saved.settings.notifications || {}),
              },
            }
          : fallback.settings,
    };
    for (const key of [
      "products",
      "adObjects",
      "collectionRuns",
      "reportImports",
      "missions",
      "decisions",
      "experiments",
      "executionQueue",
      "causalLedger",
      "operationEvents",
      "policies",
      "audit",
    ]) {
      normalized[key] = Array.isArray(saved[key]) ? saved[key] : fallback[key];
    }
    const productIdForRelation = (record) => {
      const adObject = normalized.adObjects.find((item) => item.id === record?.adObjectId);
      const mission = normalized.missions.find((item) => item.id === record?.missionId);
      const candidates = [asText(record?.productId), asText(adObject?.productId), asText(mission?.productId)].filter(Boolean);
      return candidates.length && candidates.every((value) => value === candidates[0]) ? candidates[0] : record?.productId || null;
    };
    normalized.policies = normalized.policies.map((policy) => ({ ...policy, version: Number(policy.version || 1), versionHistory: firstArray(policy.versionHistory) }));
    normalized.decisions = normalized.decisions.map((decision) => {
      const policy = normalized.policies.find((candidate) => candidate.id === decision.policyId);
      return {
        ...decision,
        productId: productIdForRelation(decision),
        policyVersion: decision.policyVersion || policy?.version || null,
        policySnapshot: decision.policySnapshot || policySnapshotOf(policy),
      };
    });
    normalized.executionQueue = normalized.executionQueue.map((execution) => {
      const decision = normalized.decisions.find((candidate) => candidate.id === execution.decisionId);
      const policy = normalized.policies.find((candidate) => candidate.id === (execution.policyId || decision?.policyId));
      return {
        ...execution,
        productId: productIdForRelation(execution),
        policyId: execution.policyId || decision?.policyId || policy?.id || null,
        policyVersion: execution.policyVersion || decision?.policyVersion || policy?.version || null,
        policySnapshot: execution.policySnapshot || decision?.policySnapshot || policySnapshotOf(policy),
      };
    });
    normalized.experiments = normalized.experiments.map((experiment) => ({
      ...experiment,
      records: Array.isArray(experiment.records) ? experiment.records : [],
    }));
    const persistedCollections = [
      "products",
      "adObjects",
      "collectionRuns",
      "reportImports",
      "missions",
      "decisions",
      "experiments",
      "executionQueue",
      "causalLedger",
      "operationEvents",
      "policies",
      "audit",
    ];
    const duplicateIdentity = persistedCollections.some((key) => hasDuplicateIds(normalized[key]))
      || normalized.experiments.some((experiment) => hasDuplicateIds(experiment.records));
    if (duplicateIdentity) {
      stores[catalog.id] = {
        ...fallback,
        lastValidation: {
          ok: false,
          message: "检测到重复内部 ID，本店铺已回退到安全演示数据",
          at: new Date().toISOString(),
          action: "NORMALIZE_PERSISTED_STATE",
        },
      };
      continue;
    }
    stores[catalog.id] = maintainProductSelection(normalized);
  }

  const profileGroups = new Map();
  for (const store of Object.values(stores)) {
    const profile = asText(store.browserProfileId || store.session?.profile || `${store.id.toLowerCase()}-profile`).toLowerCase();
    const group = profileGroups.get(profile) || [];
    group.push(store.id);
    profileGroups.set(profile, group);
  }
  for (const [profile, storeIds] of profileGroups.entries()) {
    if (!profile || storeIds.length < 2) continue;
    for (const storeId of storeIds) {
      const store = stores[storeId];
      stores[storeId] = {
        ...store,
        profileConflict: true,
        profileConflictWith: storeIds.filter((id) => id !== storeId),
        status: store.archived ? "archived" : "blocked",
        mode: "approval",
        session: {
          ...store.session,
          status: "disconnected",
          statusLabel: "Profile 冲突，等待修复",
          lastVerifiedAt: null,
          lastHeartbeat: null,
          lingxing: { ...store.session?.lingxing, status: "disconnected", freshnessMinutes: null },
          amazonAds: { ...store.session?.amazonAds, status: "disconnected", scope: "none", freshnessMinutes: null },
        },
        lastValidation: {
          ok: false,
          message: `检测到浏览器 Profile「${profile}」被多个店铺复用；会话已全部断开，请修复后重新确认`,
          at: new Date().toISOString(),
          action: "NORMALIZE_PERSISTED_STATE",
        },
      };
    }
  }

  const activeStoreId = stores[candidate.activeStoreId] && !stores[candidate.activeStoreId].archived
    ? candidate.activeStoreId
    : Object.keys(stores).find((storeId) => !stores[storeId].archived) || defaults.activeStoreId;
  return {
    ...defaults,
    ...candidate,
    version: STATE_VERSION,
    activeStoreId,
    stores,
  };
}

function loadInitialState() {
  if (typeof window === "undefined" || !window.localStorage) {
    return createInitialState();
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? normalizePersistedState(JSON.parse(raw)) : createInitialState();
  } catch {
    return createInitialState();
  }
}

export function prototypeReducer(state, action) {
  if (!action || typeof action.type !== "string") return state;

  switch (action.type) {
    case "SET_ACTIVE_STORE":
    case "SWITCH_STORE":
    case "SELECT_STORE": {
      const storeId =
        action.storeId || action.id || action.payload?.storeId || action.payload?.id;
      if (!state.stores[storeId] || state.stores[storeId].archived || storeId === state.activeStoreId) return state;
      const targetStore = appendAudit(state.stores[storeId], action, {
        outcome: "success",
        entityType: "store",
        entityId: storeId,
        summary: "已切换到店铺 " + storeId,
      });
      return {
        ...state,
        activeStoreId: storeId,
        stores: { ...state.stores, [storeId]: targetStore },
        updatedAt: nowFor(action),
      };
    }

    case "CREATE_STORE":
      return reduceStoreCrud(state, action, "create");
    case "UPDATE_STORE":
      return reduceStoreCrud(state, action, "update");
    case "ARCHIVE_STORE":
      return reduceStoreCrud(state, action, "archive");
    case "RESTORE_STORE":
      return reduceStoreCrud(state, action, "restore");
    case "DELETE_STORE":
      return reduceStoreCrud(state, action, "delete");

    case "CONNECT_SESSION":
      return reduceSession(state, action, "connect");
    case "REFRESH_SESSION":
      return reduceSession(state, action, "refresh");
    case "DISCONNECT_SESSION":
      return reduceSession(state, action, "disconnect");

    case "SET_MODE":
      return updateStore(state, action, (store) => {
        const rawMode = action.mode || action.value || action.payload?.mode;
        const mode = MODE_ALIASES[rawMode];
        if (!mode) return reject(store, action, "运行模式无效", "mode");
        if (mode === store.mode) return store;
        let decisions = store.decisions;
        let executionQueue = store.executionQueue;
        if (mode === "approval") {
          const modeDecisionIds = new Set();
          decisions = store.decisions.map((decision) => {
            if (
              decision.autoExecutable &&
              ["approved", "proposed", "ready"].includes(decision.status) &&
              !["executed", "verified", "rejected", "blocked"].includes(decision.status)
            ) {
              modeDecisionIds.add(decision.id);
              return {
                ...decision,
                status: "needs_approval",
                approval: {
                  ...(decision.approval || {}),
                  required: true,
                  status: "waiting",
                  modeRequired: true,
                  approvedBy: null,
                  approvedAt: null,
                  reason: "当前店铺采用人工审批模式，策略内动作也需操作者明确批准。",
                },
                updatedAt: nowFor(action),
              };
            }
            return decision;
          });
          executionQueue = store.executionQueue.map((execution) =>
            modeDecisionIds.has(execution.decisionId) && ["ready", "running", "paused"].includes(execution.status)
              ? {
                  ...execution,
                  status: "awaiting_approval",
                  owner: "operator",
                  executionMode: "human_only",
                  blockedReason: "人工审批模式要求操作者明确批准。",
                  updatedAt: nowFor(action),
                }
              : execution,
          );
        } else {
          const restoredDecisionIds = new Set();
          decisions = store.decisions.map((decision) => {
            if (decision.approval?.modeRequired && decision.status === "needs_approval") {
              const evaluation = policyEvaluation(store, decision);
              if (evaluation.withinPolicy && !evaluation.requiresApproval) {
                restoredDecisionIds.add(decision.id);
                return {
                  ...decision,
                  status: "approved",
                  policyBound: true,
                  autoExecutable: true,
                  approval: {
                    ...(decision.approval || {}),
                    required: false,
                    status: "policy_approved",
                    modeRequired: false,
                    approvedBy: "policy-engine",
                    approvedAt: nowFor(action),
                    reason: evaluation.reason,
                  },
                  updatedAt: nowFor(action),
                };
              }
              return {
                ...decision,
                approval: {
                  ...(decision.approval || {}),
                  required: true,
                  status: "waiting",
                  modeRequired: false,
                  reason: evaluation.reason,
                },
                updatedAt: nowFor(action),
              };
            }
            return decision;
          });
          executionQueue = store.executionQueue.map((execution) =>
            restoredDecisionIds.has(execution.decisionId) && execution.status === "awaiting_approval"
              ? {
                  ...execution,
                  status: "ready",
                  owner: "agent",
                  executionMode: "policy_auto",
                  autoEligible: true,
                  blockedReason: null,
                  updatedAt: nowFor(action),
                }
              : execution,
          );
        }
        const nextStore = { ...store, mode, decisions, executionQueue };
        return succeed(
          nextStore,
          action,
          {
            entityType: "mode",
            entityId: store.id,
            summary:
              mode === "auto"
                ? "已切换为策略内自动模式"
                : "已切换为人工审批模式",
          },
          {
            type: "mode_change",
            entityType: "mode",
            entityId: store.id,
            title:
              mode === "auto"
                ? "店铺进入策略内自动模式"
                : "店铺进入人工审批模式",
            intervention: mode,
            status: "recorded",
          },
        );
      });

    case "SELECT_PRODUCT":
      return updateStore(state, action, (store) => {
        const productId =
          action.productId || action.id || action.payload?.productId || action.payload?.id;
        const product = store.products.find(
          (item) => item.id === productId && item.status !== "archived",
        );
        if (!product) {
          return reject(
            store,
            action,
            "产品不存在或已归档，无法选择",
            "product",
            productId,
          );
        }
        if (store.selectedProductId === productId) return store;
        return appendAudit(
          { ...store, selectedProductId: productId },
          action,
          {
            outcome: "success",
            entityType: "product",
            entityId: productId,
            summary: "已选择产品「" + product.name + "」",
          },
        );
      });

    case "APPROVE_DECISION":
      return reduceDecision(state, action, "approve");
    case "REJECT_DECISION":
      return reduceDecision(state, action, "reject");
    case "EDIT_DECISION":
      return reduceDecision(state, action, "edit");

    case "CREATE_MISSION":
      return reduceMissionCrud(state, action, "create");
    case "EDIT_MISSION":
    case "UPDATE_MISSION":
      return reduceMissionCrud(state, action, "update");
    case "ARCHIVE_MISSION":
      return reduceMissionCrud(state, action, "archive");
    case "RESTORE_MISSION":
      return reduceMissionCrud(state, action, "restore");
    case "DELETE_MISSION":
      return reduceMissionCrud(state, action, "delete");
    case "START_MISSION":
      return reduceMissionStatus(state, action, "active");
    case "PAUSE_MISSION":
      return reduceMissionStatus(state, action, "paused");
    case "RESUME_MISSION":
      return reduceMissionStatus(state, action, "active");

    case "START_EXECUTION":
      return reduceExecution(state, action, "start");
    case "PAUSE_EXECUTION":
      return reduceExecution(state, action, "pause");
    case "RESUME_EXECUTION":
      return reduceExecution(state, action, "resume");
    case "TAKEOVER_EXECUTION":
      return reduceExecution(state, action, "takeover");
    case "SKIP_EXECUTION_ITEM":
      return reduceExecution(state, action, "skip");
    case "APPLY_EXECUTION_ITEM":
      return reduceExecution(state, action, "apply");
    case "VERIFY_EXECUTION_ITEM":
      return reduceExecution(state, action, "verify");

    case "CREATE_PRODUCT":
      return reduceCrud(state, action, "PRODUCT", "create");
    case "UPDATE_PRODUCT":
      return reduceCrud(state, action, "PRODUCT", "update");
    case "ARCHIVE_PRODUCT":
      return reduceCrud(state, action, "PRODUCT", "archive");
    case "DELETE_PRODUCT":
      return reduceCrud(state, action, "PRODUCT", "delete");

    case "CREATE_AD_OBJECT":
      return reduceCrud(state, action, "AD_OBJECT", "create");
    case "UPDATE_AD_OBJECT":
      return reduceCrud(state, action, "AD_OBJECT", "update");
    case "ARCHIVE_AD_OBJECT":
      return reduceCrud(state, action, "AD_OBJECT", "archive");
    case "DELETE_AD_OBJECT":
      return reduceCrud(state, action, "AD_OBJECT", "delete");

    case "CREATE_COLLECTION_JOB":
      return reduceCrud(state, action, "COLLECTION_JOB", "create");
    case "UPDATE_COLLECTION_JOB":
      return reduceCrud(state, action, "COLLECTION_JOB", "update");
    case "ARCHIVE_COLLECTION_JOB":
      return reduceCrud(state, action, "COLLECTION_JOB", "archive");
    case "DELETE_COLLECTION_JOB":
      return reduceCrud(state, action, "COLLECTION_JOB", "delete");
    case "RUN_COLLECTION_JOB":
      return reduceCollectionRun(state, action);

    case "CREATE_REPORT_IMPORT":
      return reduceCrud(state, action, "REPORT_IMPORT", "create");
    case "DELETE_REPORT_IMPORT":
      return reduceCrud(state, action, "REPORT_IMPORT", "delete");

    case "CREATE_POLICY":
      return reduceCrud(state, action, "POLICY", "create");
    case "UPDATE_POLICY":
      return reduceCrud(state, action, "POLICY", "update");
    case "ARCHIVE_POLICY":
      return reduceCrud(state, action, "POLICY", "archive");
    case "DELETE_POLICY":
      return reduceCrud(state, action, "POLICY", "delete");

    case "CREATE_EXPERIMENT":
      return reduceCrud(state, action, "EXPERIMENT", "create");
    case "EDIT_EXPERIMENT":
    case "UPDATE_EXPERIMENT":
      return reduceCrud(state, action, "EXPERIMENT", "update");
    case "ARCHIVE_EXPERIMENT":
      return reduceCrud(state, action, "EXPERIMENT", "archive");
    case "RESTORE_EXPERIMENT":
      return reduceCrud(state, action, "EXPERIMENT", "restore");
    case "DELETE_EXPERIMENT":
      return reduceCrud(state, action, "EXPERIMENT", "delete");
    case "PAUSE_EXPERIMENT":
      return reduceExperimentStatus(state, action, "paused");
    case "RESUME_EXPERIMENT":
      return reduceExperimentStatus(state, action, "running");
    case "CREATE_EXPERIMENT_RECORD":
      return reduceExperimentRecord(state, action, "create");
    case "EDIT_EXPERIMENT_RECORD":
    case "UPDATE_EXPERIMENT_RECORD":
      return reduceExperimentRecord(state, action, "edit");
    case "ARCHIVE_EXPERIMENT_RECORD":
      return reduceExperimentRecord(state, action, "archive");
    case "DELETE_EXPERIMENT_RECORD":
      return reduceExperimentRecord(state, action, "delete");

    case "ADD_OPERATION_EVENT":
    case "CREATE_OPERATION_EVENT":
      return reduceOperationEvent(state, action, "create");
    case "UPDATE_OPERATION_EVENT":
    case "EDIT_OPERATION_EVENT":
      return reduceOperationEvent(state, action, "update");
    case "ARCHIVE_OPERATION_EVENT":
      return reduceOperationEvent(state, action, "archive");
    case "RESTORE_OPERATION_EVENT":
      return reduceOperationEvent(state, action, "restore");
    case "DELETE_OPERATION_EVENT":
      return reduceOperationEvent(state, action, "delete");
    case "ADD_CAUSAL_ENTRY":
      return reduceCausalEntry(state, action);
    case "UPDATE_SETTINGS":
      return reduceSettings(state, action);

    case "RESET_DEMO":
      return createInitialState();

    default:
      return state;
  }
}

export function usePrototypeModel() {
  const [state, rawDispatch] = useReducer(
    prototypeReducer,
    undefined,
    loadInitialState,
  );
  const [persistenceStatus, setPersistenceStatus] = useState({
    status: "saved",
    message: "本地原型数据已持久保存",
    at: null,
  });
  const stateRef = useRef(state);
  const sequence = useRef(0);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const dispatch = useCallback((action) => {
    if (!action || typeof action !== "object") return null;
    sequence.current += 1;
    const timestamp = new Date().toISOString();
    const enrichedAction = {
      ...action,
      meta: {
        timestamp,
        eventId:
          "evt-" +
          Date.now().toString(36) +
          "-" +
          sequence.current.toString(36),
        actor: "operator",
        ...(action.meta || {}),
      },
    };
    const nextState = prototypeReducer(stateRef.current, enrichedAction);
    stateRef.current = nextState;
    let persistenceFailure = null;
    if (typeof window === "undefined" || !window.localStorage) {
      persistenceFailure = "浏览器本地存储不可用；本次修改仅保留在内存中，重启会丢失";
    } else {
      try {
        const serialized = JSON.stringify(nextState);
        window.localStorage.setItem(STORAGE_KEY, serialized);
        setPersistenceStatus({
          status: "saved",
          message: `本地原型数据已保存 · ${Math.max(1, Math.round(serialized.length / 1024))} KB`,
          at: timestamp,
        });
      } catch (error) {
        persistenceFailure = `本地保存失败：${error instanceof Error ? error.message : "存储不可写"}；当前修改仅保留在内存中`;
        setPersistenceStatus({ status: "error", message: persistenceFailure, at: timestamp });
      }
    }
    rawDispatch(enrichedAction);
    const storeId = enrichedAction.targetStoreId || enrichedAction.payload?.targetStoreId || enrichedAction.storeId || enrichedAction.payload?.storeId || nextState.activeStoreId;
    const validation = nextState.stores?.[storeId]?.lastValidation || nextState.stores?.[nextState.activeStoreId]?.lastValidation;
    const mutationValidation = validation?.at === timestamp && validation?.action === enrichedAction.type
      ? validation
      : null;
    if (persistenceFailure) {
      return {
        ok: false,
        message: persistenceFailure,
        at: timestamp,
        action: enrichedAction.type,
        persistenceFailed: true,
        mutationAppliedInMemory: mutationValidation?.ok !== false,
      };
    }
    return mutationValidation;
  }, []);

  const resetDemo = useCallback(() => {
    if (typeof window !== "undefined" && window.localStorage) {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Resetting reducer state is sufficient when storage is unavailable.
      }
    }
    return dispatch({ type: "RESET_DEMO" });
  }, [dispatch]);

  const activeStore =
    state.stores[state.activeStoreId] || state.stores[STORE_CATALOG[0].id];

  return useMemo(
    () => ({ state, activeStore, dispatch, resetDemo, persistenceStatus }),
    [state, activeStore, dispatch, resetDemo, persistenceStatus],
  );
}

import { DEFAULT_ROUTE, STORE_CATALOG, normalizeRoute } from "./spec.js";

const SCHEMA_VERSION = 2;
const MANIFEST_KEY = "amazon-ai-ops:v2:manifest";
const STORE_KEY = (storeId) => `amazon-ai-ops:v2:store:${storeId}`;
const INSTANCE_ID = `instance-${Math.random().toString(36).slice(2, 10)}`;
const BASE_TIME = "2026-07-20T09:15:00.000Z";

const REPORT_TYPES = [
  ["campaign", "广告活动报告"],
  ["ad_group", "广告组报告"],
  ["placement", "广告位报告"],
  ["advertised_product", "推广商品报告"],
  ["auto_targeting", "自动投放报告"],
  ["keyword", "关键词报告"],
  ["product_targeting", "商品投放报告"],
  ["user_search_term", "用户搜索词报告"],
];

const STORE_PROFILES = {
  SHC001: {
    name: "独立站",
    marketplace: "US",
    currency: "USD",
    timezone: "America/Los_Angeles",
    currencySymbol: "$",
    productSeed: [
      ["FT-US-US", "B0GTTJFQTM", "Keypad Door Lock with Handle", 79.99, 0.28, 0.12, 0.31],
      ["FT-US-BK", "B0F9W8P2KM", "Fingerprint Smart Lock", 92, 0.25, 0.1, 0.35],
      ["FT-US-RF", "B0D7HC2Q9V", "Retrofit Keyless Deadbolt", 69.5, 0.32, 0.15, 0.24],
    ],
    selectedIndex: 0,
    eventTitle: "Prime Deal 结束",
    eventDescription: "转化基线可能回落，未来 72 小时需要按活动后基线解释。",
    keywordSeed: ["keypad door lock with handle", "fingerprint door handle lock", "smart lock for bedroom door", "door latch cheap"],
    listingTitle: "Keypad Door Lock with Handle, Fingerprint Keyless Entry Lever",
    reportRows: [421, 1187, 216, 389, 622, 1420, 930, 0],
    targetAcos: 0.28,
    sales: 4862,
    acos: 0.384,
    mode: "auto",
    sessionStatus: "ready",
    pendingStatus: "pending_approval",
    recommendationTitle: "Exact-Core 日预算上调",
    currentValue: 120,
    recommendedValue: 168,
  },
  LMX002: {
    name: "乐米家居",
    marketplace: "CA",
    currency: "CAD",
    timezone: "America/Toronto",
    currencySymbol: "CA$",
    productSeed: [
      ["LM02-SKU", "B0D8W2RC8Q", "Wooden Gate Latch", 42.99, 0.25, 0.09, 0.27],
      ["LM03-SKU", "B0E4L18M6Q", "Barn Door Latch Black", 34.99, 0.27, 0.1, 0.25],
      ["LM04-SKU", "B0F2K51D7C", "Garden Gate Bolt", 29.99, 0.3, 0.11, 0.22],
    ],
    selectedIndex: 0,
    eventTitle: "加拿大站 Coupon 到期",
    eventDescription: "Coupon 到期可能导致 CVR 暂时下降，预算建议需降低影响。",
    keywordSeed: ["gate latch outdoor", "barn door latch black", "wood gate latch canada", "wooden latch cheap"],
    listingTitle: "Heavy Duty Wooden Gate Latch for Outdoor Gates and Sheds",
    reportRows: [96, 412, 204, 480, 338, 810, 562, 1010],
    targetAcos: 0.25,
    sales: 3280,
    acos: 0.268,
    mode: "review",
    sessionStatus: "warning",
    pendingStatus: "pending_review",
    recommendationTitle: "Brand-Exact 预算恢复",
    currentValue: 72,
    recommendedValue: 84,
  },
  NOC003: {
    name: "北岸户外",
    marketplace: "UK",
    currency: "GBP",
    timezone: "Europe/London",
    currencySymbol: "£",
    productSeed: [
      ["NK01-SKU", "B0F3Q91L7P", "Heavy Duty Door Latch", 42.99, 0.3, 0.1, 0.16],
      ["NK02-SKU", "B0F5K20J8M", "Stainless Gate Bolt", 39.99, 0.27, 0.09, 0.18],
      ["NK03-SKU", "B0F7M62Q3R", "Shed Door Locking Bar", 48.99, 0.38, 0.15, 0.12],
    ],
    selectedIndex: 0,
    eventTitle: "竞品价格下调 9%",
    eventDescription: "英国站竞品促销导致广告转化承压，暂停动作仍需人工审批。",
    keywordSeed: ["shed door latch", "heavy duty gate latch", "door latch heavy duty", "shed lock bar"],
    listingTitle: "Heavy Duty Door Latch for Sheds, Gates and Barn Doors",
    reportRows: [121, 566, 0, 630, 478, 1120, 721, 0],
    targetAcos: 0.3,
    sales: 2740,
    acos: 0.412,
    mode: "auto",
    sessionStatus: "ready",
    pendingStatus: "pending_approval",
    recommendationTitle: "高花费词暂停投放",
    currentValue: "启用",
    recommendedValue: "暂停",
  },
};

function now() {
  return new Date().toISOString();
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function idFor(storeId, kind) {
  const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return `${storeId}-${kind}-${token}`;
}

function entity(storeId, id, values = {}, timestamp = BASE_TIME) {
  return {
    id,
    storeId,
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...values,
  };
}

function table(items = []) {
  return {
    byId: Object.fromEntries(items.map((item) => [item.id, item])),
    allIds: items.map((item) => item.id),
  };
}

function tableValues(entityTable) {
  return entityTable.allIds.map((id) => entityTable.byId[id]).filter(Boolean);
}

function addToTable(entityTable, item) {
  entityTable.byId[item.id] = item;
  if (!entityTable.allIds.includes(item.id)) entityTable.allIds.push(item.id);
}

function replaceInTable(entityTable, item) {
  if (!entityTable.byId[item.id]) throw domainError("NOT_FOUND", `记录不存在：${item.id}`);
  entityTable.byId[item.id] = item;
}

function touch(item, patch = {}, timestamp = now()) {
  return {
    ...item,
    ...patch,
    revision: Number(item.revision || 0) + 1,
    updatedAt: timestamp,
  };
}

function domainError(code, message, fieldErrors) {
  const error = new Error(message);
  error.code = code;
  error.fieldErrors = fieldErrors;
  return error;
}

function fail(code, message, fieldErrors) {
  return { ok: false, code, message, ...(fieldErrors ? { fieldErrors } : {}) };
}

function ok(value, storeRevision, extra = {}) {
  return { ok: true, value, ...(storeRevision == null ? {} : { storeRevision }), ...extra };
}

function assertEntity(entityValue, label = "记录") {
  if (!entityValue) throw domainError("NOT_FOUND", `${label}不存在`);
  return entityValue;
}

function assertExpectedRevision(entityValue, expectedRevision) {
  if (expectedRevision == null) return;
  if (Number(entityValue.revision) !== Number(expectedRevision)) {
    throw domainError("REVISION_CONFLICT", `版本冲突：期望 rev ${expectedRevision}，当前 rev ${entityValue.revision}`);
  }
}

function fixtureFor(storeId) {
  const profile = STORE_PROFILES[storeId];
  const catalog = STORE_CATALOG.find((item) => item.id === storeId);
  const timestamp = BASE_TIME;
  const products = profile.productSeed.map(([sku, asin, title, currentPrice, targetAcos, targetTacos, targetNetMargin], index) => entity(
    storeId,
    `${storeId}-product-${index + 1}`,
    {
      sku,
      asin,
      title,
      name: title,
      status: index === 2 ? "watch" : "active",
      target: {
        currentPrice,
        minPrice: Number((currentPrice * 0.76).toFixed(2)),
        targetAcos,
        targetTacos,
        targetNetMargin,
      },
    },
    timestamp,
  ));
  const selectedProduct = products[profile.selectedIndex];

  const events = [
    entity(storeId, `${storeId}-event-1`, {
      productId: selectedProduct.id,
      type: "promotion",
      title: profile.eventTitle,
      description: profile.eventDescription,
      occurredAt: "2026-07-20T08:15:00.000Z",
      impact: "material",
      status: "active",
      consumedByBatchIds: [`${storeId}-batch-20260720`],
      voidReason: null,
    }, timestamp),
    entity(storeId, `${storeId}-event-2`, {
      productId: null,
      type: "inventory",
      title: "FBA 可售恢复至 28 天",
      description: "解除库存保护，但不得自动恢复已暂停动作。",
      occurredAt: "2026-07-19T10:05:00.000Z",
      impact: "warning",
      status: "active",
      consumedByBatchIds: [],
      voidReason: null,
    }, timestamp),
  ];

  const reports = REPORT_TYPES.map(([type, label], index) => {
    const rows = profile.reportRows[index];
    return entity(storeId, `${storeId}-report-${type}`, {
      type,
      label,
      status: rows ? "imported" : "missing",
      rows,
      dateFrom: "2026-07-06",
      dateTo: "2026-07-19",
      source: "领星 Ads 下载中心",
      filename: rows ? `${type}_${storeId}_20260720.xlsx` : null,
      errorCode: rows ? null : "FILE_NOT_READY",
      errorMessage: rows ? null : "下载中心尚未生成文件",
      retryCount: 0,
    }, timestamp);
  });

  const diagnostics = [
    entity(storeId, `${storeId}-diagnostic-1`, {
      productId: selectedProduct.id,
      batchId: `${storeId}-batch-20260720`,
      objectType: "keyword",
      objectName: profile.keywordSeed[0],
      severity: profile.acos > profile.targetAcos + 0.08 ? "high" : "medium",
      diagnosis: `ACOS ${(profile.acos * 100).toFixed(1)}% 高于目标 ${(profile.targetAcos * 100).toFixed(1)}%`,
      suggestedAction: "bid_change",
      status: "active",
    }, timestamp),
    entity(storeId, `${storeId}-diagnostic-2`, {
      productId: selectedProduct.id,
      batchId: `${storeId}-batch-20260720`,
      objectType: "search_term",
      objectName: profile.keywordSeed[3],
      severity: "high",
      diagnosis: "连续点击无订单，需要进入人工判断。",
      suggestedAction: "negative_phrase",
      status: "active",
    }, timestamp),
  ];

  const pendingRecommendationId = `${storeId}-recommendation-current`;
  const pendingRevisionId = `${pendingRecommendationId}-r1`;
  const pendingRevision = entity(storeId, pendingRevisionId, {
    recommendationId: pendingRecommendationId,
    revisionNumber: 1,
    actionType: typeof profile.currentValue === "string" ? "pause" : "budget_change",
    entityType: typeof profile.currentValue === "string" ? "keyword" : "ad_group",
    entityId: `${storeId}-ads-object-current`,
    currentValue: profile.currentValue,
    recommendedValue: profile.recommendedValue,
    unit: typeof profile.currentValue === "string" ? "state" : "currency",
    risk: profile.pendingStatus === "pending_approval" ? "high" : "medium",
    title: profile.recommendationTitle,
    reason: diagnostics[0].diagnosis,
    evidenceIds: diagnostics.map((item) => item.id),
    diagnosticIds: diagnostics.map((item) => item.id),
    authorityBatchId: `${storeId}-batch-20260720`,
    policySnapshot: {
      mode: profile.mode,
      eligible: profile.pendingStatus === "pending_review",
      boundary: "单次预算 ±20%，暂停动作始终人工审批",
    },
  }, timestamp);
  const pendingRecommendation = entity(storeId, pendingRecommendationId, {
    productId: selectedProduct.id,
    status: profile.pendingStatus,
    currentRevisionId: pendingRevisionId,
    decisionId: null,
    executionId: null,
  }, timestamp);

  const historicRecommendationId = `${storeId}-recommendation-history`;
  const historicRevisionId = `${historicRecommendationId}-r1`;
  const historicDecisionId = `${storeId}-decision-history`;
  const historicExecutionId = `${storeId}-execution-history`;
  const historicReadbackId = `${storeId}-readback-history`;
  const historicRevision = entity(storeId, historicRevisionId, {
    recommendationId: historicRecommendationId,
    revisionNumber: 1,
    actionType: "bid_change",
    entityType: "keyword",
    entityId: `${storeId}-ads-object-history`,
    currentValue: 1.42,
    recommendedValue: 1.3,
    unit: "currency",
    risk: "low",
    title: "低风险关键词竞价下调",
    reason: "花费上升且 CVR 下降，变化在策略边界内。",
    evidenceIds: [`${storeId}-diagnostic-1`],
    diagnosticIds: [`${storeId}-diagnostic-1`],
    authorityBatchId: `${storeId}-batch-20260719`,
    policySnapshot: { mode: "auto", eligible: true, boundary: "关键词竞价 ±15%" },
  }, timestamp);
  const historicRecommendation = entity(storeId, historicRecommendationId, {
    productId: selectedProduct.id,
    status: "executed",
    currentRevisionId: historicRevisionId,
    decisionId: historicDecisionId,
    executionId: historicExecutionId,
  }, timestamp);
  const historicDecision = entity(storeId, historicDecisionId, {
    recommendationId: historicRecommendationId,
    recommendationRevisionId: historicRevisionId,
    outcome: "approved",
    actor: "AI 自动边界",
    reason: "满足店铺确定性低风险策略",
    licenseId: `${storeId}-LIC-001`,
    decidedAt: "2026-07-19T08:58:00.000Z",
  }, timestamp);
  const historicExecution = entity(storeId, historicExecutionId, {
    recommendationId: historicRecommendationId,
    recommendationRevisionId: historicRevisionId,
    decisionId: historicDecisionId,
    status: "verified",
    entityType: "keyword",
    entityId: historicRevision.entityId,
    beforeValue: 1.42,
    intendedValue: 1.3,
    observedValue: 1.3,
    browserProfileId: `profile-${storeId}`,
    identityVerifiedAt: "2026-07-19T09:03:00.000Z",
    queuedAt: "2026-07-19T09:00:00.000Z",
    startedAt: "2026-07-19T09:03:00.000Z",
    savedAt: "2026-07-19T09:03:24.000Z",
    errorCode: null,
    errorMessage: null,
  }, timestamp);
  const evidence = ["before", "after", "reload"].map((type, index) => entity(storeId, `${storeId}-evidence-history-${type}`, {
    readbackId: historicReadbackId,
    type,
    origin: "prototype",
    filename: `${type}-${storeId}.png`,
    mimeType: "image/png",
    sha256: `prototype-${storeId}-${type}`,
    capturedAt: `2026-07-19T09:0${3 + index}:00.000Z`,
    localRef: null,
    status: "attached",
  }, timestamp));
  const historicReadback = entity(storeId, historicReadbackId, {
    executionId: historicExecutionId,
    recommendationId: historicRecommendationId,
    recommendationRevisionId: historicRevisionId,
    status: "verified",
    verificationMode: "simulated",
    evidenceIds: evidence.map((item) => item.id),
    beforeValue: 1.42,
    savedValue: 1.3,
    reloadValue: 1.3,
    authorityBound: true,
    storeIdentityVerified: true,
    checkedAt: "2026-07-19T09:05:08.000Z",
    failureReasons: [],
  }, timestamp);

  const keywords = profile.keywordSeed.map((keyword, index) => entity(storeId, `${storeId}-keyword-${index + 1}`, {
    keyword,
    source: index % 2 ? "user_search_term" : "keyword",
    priority: index < 2 ? "high" : "medium",
    searchVolume: [8100, 5400, 3600, 1300][index],
    orders: [24, 0, 7, 0][index],
    acos: index === 3 ? null : [0.238, null, 0.312, null][index],
    state: index === 0 ? "covered" : index === 3 ? "excluded" : "candidate",
  }, timestamp));

  const listingVersion = entity(storeId, `${storeId}-listing-version-1`, {
    productId: selectedProduct.id,
    sourceDraftId: `${storeId}-listing-draft-1`,
    versionNumber: 1,
    title: selectedProduct.title,
    bullets: ["稳定版本标题与五点", "保留当前事实声明", "仅本地版本记录"],
    backendTerms: profile.keywordSeed.slice(0, 2).join(" "),
    keywordIds: [keywords[0].id],
    note: "现网基线快照",
  }, timestamp);
  const listingDraft = entity(storeId, `${storeId}-listing-draft-1`, {
    productId: selectedProduct.id,
    status: "editing",
    title: profile.listingTitle,
    bullets: [
      "围绕核心使用场景表达真实卖点。",
      "保留尺寸、材质与安装信息。",
      "避免关键词堆砌与未经证实的声明。",
    ],
    backendTerms: profile.keywordSeed.slice(0, 3).join(" "),
    keywordIds: keywords.slice(0, 2).map((item) => item.id),
    baseVersionId: listingVersion.id,
  }, timestamp);

  const schedules = [
    entity(storeId, `${storeId}-schedule-collection`, { name: "广告报表日采集", kind: "collection", cron: "30 8 * * *", timezone: profile.timezone, status: "enabled", config: { reportTypes: 8 }, lastRunId: `${storeId}-schedule-run-1` }, timestamp),
    entity(storeId, `${storeId}-schedule-diagnosis`, { name: "导入后量化诊断", kind: "diagnosis", cron: "after:import", timezone: profile.timezone, status: "enabled", config: {}, lastRunId: null }, timestamp),
    entity(storeId, `${storeId}-schedule-readback`, { name: "执行回读检查", kind: "readback", cron: "0 * * * *", timezone: profile.timezone, status: storeId === "LMX002" ? "paused" : "enabled", config: { intervalHours: 1 }, lastRunId: null }, timestamp),
  ];
  const scheduleRun = entity(storeId, `${storeId}-schedule-run-1`, {
    scheduleId: schedules[0].id,
    status: profile.reportRows.every(Boolean) ? "success" : "warning",
    startedAt: "2026-07-20T08:30:00.000Z",
    completedAt: "2026-07-20T08:42:00.000Z",
    summary: `${profile.reportRows.filter(Boolean).length}/8 类报表`,
  }, timestamp);

  const auditSeed = entity(storeId, `${storeId}-audit-seed`, {
    type: "store.initialized",
    entityType: "store",
    entityId: storeId,
    actor: "prototype",
    summary: `${profile.name} 独立数据舱已初始化`,
    at: timestamp,
  }, timestamp);

  return {
    schemaVersion: SCHEMA_VERSION,
    storeId,
    revision: 1,
    updatedAt: timestamp,
    config: entity(storeId, `${storeId}-config`, {
      name: profile.name,
      marketplace: catalog?.marketplace || profile.marketplace,
      currency: profile.currency,
      currencySymbol: profile.currencySymbol,
      timezone: profile.timezone,
      lingxingUsername: `${storeId.toLowerCase()}@operator.local`,
      aiProvider: "OpenAI-compatible",
      aiModel: storeId === "LMX002" ? "deepseek-chat" : "gpt-5.4",
      temperature: 0.1,
    }, timestamp),
    // Compatibility view for workspace forms; rules.update keeps it in sync with config.
    settings: entity(storeId, `${storeId}-settings`, {
      name: profile.name,
      marketplace: catalog?.marketplace || profile.marketplace,
      currency: profile.currency,
      currencySymbol: profile.currencySymbol,
      timezone: profile.timezone,
      lingxingUsername: `${storeId.toLowerCase()}@operator.local`,
      aiProvider: "OpenAI-compatible",
      aiModel: storeId === "LMX002" ? "deepseek-chat" : "gpt-5.4",
      temperature: 0.1,
    }, timestamp),
    session: entity(storeId, `${storeId}-session`, {
      status: profile.sessionStatus,
      browserProfileId: `profile-${storeId}`,
      checkedAt: "2026-07-20T08:20:00.000Z",
    }, timestamp),
    scope: entity(storeId, `${storeId}-scope`, {
      selectedProductId: selectedProduct.id,
      marketplace: catalog?.marketplace || profile.marketplace,
      marketplaceCode: profile.marketplace,
      dateFrom: "2026-07-06",
      dateTo: "2026-07-19",
      attributionWindow: "7d_click_1d_view",
      attribution: "7 天点击 / 1 天浏览",
      batchId: `${storeId}-batch-20260720`,
      lockedAt: storeId === "LMX002" ? null : "2026-07-20T08:30:00.000Z",
      status: storeId === "LMX002" ? "draft" : "locked",
    }, timestamp),
    autonomy: entity(storeId, `${storeId}-autonomy`, {
      mode: profile.mode,
      paused: false,
      bidChangeLimitPercent: 15,
      budgetChangeLimitPercent: 20,
      pauseAlwaysNeedsApproval: true,
      killSwitchReason: null,
    }, timestamp),
    metrics: {
      sales: profile.sales,
      acos: profile.acos,
      targetAcos: profile.targetAcos,
      anomalies: profile.reportRows.filter((value) => !value).length + (profile.acos > profile.targetAcos ? 1 : 0),
    },
    delivery: entity(storeId, `${storeId}-delivery`, {
      status: "PROTOTYPE_ONLY",
      productionReady: false,
      checkedAt: null,
      lastExportAt: null,
      checks: [
        { id: `${storeId}-DLV-1`, gate: "V2 交互原型构建", evidence: "本地 Vite build", status: "pending" },
        { id: `${storeId}-DLV-2`, gate: "17 子视图交互", evidence: "需要逐页运行验收", status: "pending" },
        { id: `${storeId}-DLV-3`, gate: "跨店铺隔离", evidence: "三个独立 localStorage key", status: "pending" },
        { id: `${storeId}-DLV-4`, gate: "真实 Ads 执行回读", evidence: "原型只允许 prototype evidence", status: "blocked" },
      ],
    }, timestamp),
    entities: {
      products: table(products),
      targetVersions: table(products.map((product, index) => entity(storeId, `${storeId}-target-version-${index + 1}`, {
        productId: product.id,
        versionNumber: 1,
        ...clone(product.target),
        note: "fixture baseline",
      }, timestamp))),
      events: table(events),
      reports: table(reports),
      imports: table([]),
      diagnostics: table(diagnostics),
      keywords: table(keywords),
      listingDrafts: table([listingDraft]),
      listingVersions: table([listingVersion]),
      recommendations: table([pendingRecommendation, historicRecommendation]),
      recommendationRevisions: table([pendingRevision, historicRevision]),
      decisions: table([historicDecision]),
      executions: table([historicExecution]),
      readbacks: table([historicReadback]),
      evidence: table(evidence),
      schedules: table(schedules),
      scheduleRuns: table([scheduleRun]),
      auditEntries: table([auditSeed]),
    },
  };
}

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

const fallbackStorage = createMemoryStorage();

function storage() {
  try {
    if (globalThis.localStorage) return globalThis.localStorage;
  } catch {
    // Sandboxed imports use the in-memory adapter.
  }
  return fallbackStorage;
}

function defaultManifest() {
  const timestamp = now();
  return {
    schemaVersion: SCHEMA_VERSION,
    activeStoreId: STORE_CATALOG[0].id,
    storeIds: STORE_CATALOG.map((item) => item.id),
    navigationByStore: Object.fromEntries(STORE_CATALOG.map((item) => [item.id, { ...DEFAULT_ROUTE }])),
    updatedAt: timestamp,
  };
}

function validStoreShape(value, storeId) {
  return Boolean(value && value.schemaVersion === SCHEMA_VERSION && value.storeId === storeId && value.entities?.products?.byId);
}

function normalizeLoadedStore(value, storeId) {
  const baseline = fixtureFor(storeId);
  const loaded = clone(value);
  loaded.config = loaded.config || loaded.settings || baseline.config;
  loaded.settings = loaded.settings || baseline.settings || clone(loaded.config);
  loaded.session = loaded.session || baseline.session;
  loaded.scope = { ...baseline.scope, ...(loaded.scope || {}) };
  loaded.autonomy = { ...baseline.autonomy, ...(loaded.autonomy || {}) };
  loaded.metrics = { ...baseline.metrics, ...(loaded.metrics || {}) };
  loaded.delivery = loaded.delivery || baseline.delivery;
  loaded.entities = loaded.entities || {};
  for (const [name, baselineTable] of Object.entries(baseline.entities)) {
    if (!loaded.entities[name]?.byId || !Array.isArray(loaded.entities[name]?.allIds)) loaded.entities[name] = baselineTable;
  }
  for (const product of tableValues(loaded.entities.products)) {
    if (!product.name) product.name = product.title;
    if (!product.title) product.title = product.name;
  }
  return loaded;
}

function loadInitialSnapshot() {
  const adapter = storage();
  let manifest = defaultManifest();
  try {
    const parsed = JSON.parse(adapter.getItem(MANIFEST_KEY) || "null");
    if (parsed?.schemaVersion === SCHEMA_VERSION && STORE_PROFILES[parsed.activeStoreId]) {
      manifest = {
        ...manifest,
        ...parsed,
        storeIds: STORE_CATALOG.map((item) => item.id),
        navigationByStore: Object.fromEntries(STORE_CATALOG.map((item) => [
          item.id,
          normalizeRoute(parsed.navigationByStore?.[item.id] || DEFAULT_ROUTE),
        ])),
      };
    } else {
      adapter.setItem(MANIFEST_KEY, JSON.stringify(manifest));
    }
  } catch {
    try { adapter.setItem(MANIFEST_KEY, JSON.stringify(manifest)); } catch { /* read-only environment */ }
  }

  const stores = {};
  for (const catalogEntry of STORE_CATALOG) {
    const storeId = catalogEntry.id;
    let loaded = null;
    try {
      const envelope = JSON.parse(adapter.getItem(STORE_KEY(storeId)) || "null");
      if (validStoreShape(envelope?.data, storeId)) loaded = normalizeLoadedStore(envelope.data, storeId);
    } catch {
      loaded = null;
    }
    if (!loaded) {
      loaded = fixtureFor(storeId);
      const envelope = { schemaVersion: SCHEMA_VERSION, storeId, revision: loaded.revision, savedAt: now(), sourceInstanceId: INSTANCE_ID, data: loaded };
      try { adapter.setItem(STORE_KEY(storeId), JSON.stringify(envelope)); } catch { /* usable in memory */ }
    }
    stores[storeId] = loaded;
  }
  return { manifest, stores };
}

function appendAudit(store, type, details = {}) {
  const timestamp = now();
  const audit = entity(store.storeId, idFor(store.storeId, "audit"), {
    type,
    entityType: details.entityType || "store",
    entityId: details.entityId || store.storeId,
    actor: details.actor || "operator",
    summary: details.summary || type,
    at: timestamp,
  }, timestamp);
  addToTable(store.entities.auditEntries, audit);
  return audit;
}

function validateStore(store) {
  if (!validStoreShape(store, store.storeId)) throw domainError("VALIDATION_FAILED", "店铺状态结构无效");
  if (!STORE_PROFILES[store.storeId]) throw domainError("STORE_MISMATCH", `未知店铺：${store.storeId}`);
  const errors = [];
  for (const [tableName, entityTable] of Object.entries(store.entities)) {
    for (const id of entityTable.allIds) {
      const item = entityTable.byId[id];
      if (!item) errors.push(`${tableName}.${id} 缺少记录`);
      else if (item.storeId !== store.storeId) errors.push(`${tableName}.${id} 跨店铺引用`);
      else if (item.id !== id) errors.push(`${tableName}.${id} 主键不一致`);
    }
  }
  if (store.scope.selectedProductId && !store.entities.products.byId[store.scope.selectedProductId]) errors.push("scope.selectedProductId 不存在");
  if (store.scope.dateFrom > store.scope.dateTo) errors.push("dateFrom 必须早于 dateTo");
  for (const recommendation of tableValues(store.entities.recommendations)) {
    const revision = store.entities.recommendationRevisions.byId[recommendation.currentRevisionId];
    if (!revision || revision.recommendationId !== recommendation.id) errors.push(`建议 ${recommendation.id} 缺少当前 revision`);
  }
  for (const execution of tableValues(store.entities.executions)) {
    if (!store.entities.recommendations.byId[execution.recommendationId]) errors.push(`执行 ${execution.id} 缺少建议`);
    if (!store.entities.decisions.byId[execution.decisionId]) errors.push(`执行 ${execution.id} 缺少决定`);
  }
  for (const readback of tableValues(store.entities.readbacks)) {
    if (!store.entities.executions.byId[readback.executionId]) errors.push(`回读 ${readback.id} 缺少执行`);
  }
  if (errors.length) throw domainError("VALIDATION_FAILED", errors[0], { state: errors.join("；") });
}

let snapshot = loadInitialSnapshot();
const listeners = new Set();

function emit() {
  for (const listener of [...listeners]) listener();
}

function saveManifest(nextManifest) {
  try {
    storage().setItem(MANIFEST_KEY, JSON.stringify(nextManifest));
  } catch {
    return fail("PERSIST_FAILED", "无法保存应用导航与当前店铺");
  }
  snapshot = { manifest: nextManifest, stores: snapshot.stores };
  emit();
  return ok(nextManifest);
}

function saveStore(nextStore, expectedRevision) {
  const storeId = nextStore.storeId;
  const adapter = storage();
  try {
    const persisted = JSON.parse(adapter.getItem(STORE_KEY(storeId)) || "null");
    const persistedRevision = persisted?.data?.revision ?? expectedRevision;
    if (Number(persistedRevision) !== Number(expectedRevision)) {
      return fail("REVISION_CONFLICT", `店铺 ${storeId} 已被其他窗口更新，请刷新后重试`);
    }
    validateStore(nextStore);
    const envelope = {
      schemaVersion: SCHEMA_VERSION,
      storeId,
      revision: nextStore.revision,
      savedAt: now(),
      sourceInstanceId: INSTANCE_ID,
      data: nextStore,
    };
    adapter.setItem(STORE_KEY(storeId), JSON.stringify(envelope));
  } catch (error) {
    if (error?.code) return fail(error.code, error.message, error.fieldErrors);
    return fail("PERSIST_FAILED", `无法保存 ${storeId}：${error instanceof Error ? error.message : "localStorage 写入失败"}`);
  }
  snapshot = { manifest: snapshot.manifest, stores: { ...snapshot.stores, [storeId]: nextStore } };
  emit();
  return ok(nextStore, nextStore.revision);
}

function mutateStore(storeId, type, payload, mutator) {
  const current = snapshot.stores[storeId];
  if (!current) return fail("STORE_MISMATCH", `未知店铺：${storeId}`);
  if (payload.expectedStoreRevision != null && Number(payload.expectedStoreRevision) !== Number(current.revision)) {
    return fail("REVISION_CONFLICT", `店铺版本冲突：期望 rev ${payload.expectedStoreRevision}，当前 rev ${current.revision}`);
  }
  const next = clone(current);
  try {
    const mutation = mutator(next) || {};
    appendAudit(next, type, {
      entityType: mutation.entityType,
      entityId: mutation.entityId,
      actor: payload.actor,
      summary: mutation.summary,
    });
    next.revision = Number(current.revision || 0) + 1;
    next.updatedAt = now();
    const saved = saveStore(next, current.revision);
    if (!saved.ok) return saved;
    return ok(mutation.value ?? next, next.revision, mutation.extra);
  } catch (error) {
    return fail(error?.code || "VALIDATION_FAILED", error instanceof Error ? error.message : "操作失败", error?.fieldErrors);
  }
}

function ensureUniqueProduct(store, values, excludingId = null) {
  const duplicate = tableValues(store.entities.products).find((item) => item.id !== excludingId && item.status !== "archived" && (item.sku === values.sku || item.asin === values.asin));
  if (duplicate) throw domainError("VALIDATION_FAILED", "同一店铺的 SKU 与 ASIN 必须唯一", { sku: "SKU 或 ASIN 已存在", asin: "SKU 或 ASIN 已存在" });
}

function normalizeTarget(target = {}) {
  const normalized = {
    currentPrice: Number(target.currentPrice),
    minPrice: Number(target.minPrice),
    targetAcos: Number(target.targetAcos),
    targetTacos: Number(target.targetTacos),
    targetNetMargin: Number(target.targetNetMargin),
  };
  const invalidRatio = [normalized.targetAcos, normalized.targetTacos, normalized.targetNetMargin].some((value) => !Number.isFinite(value) || value < 0 || value > 1);
  if (!Number.isFinite(normalized.currentPrice) || normalized.currentPrice <= 0) throw domainError("VALIDATION_FAILED", "当前售价必须大于 0", { currentPrice: "请输入有效售价" });
  if (!Number.isFinite(normalized.minPrice) || normalized.minPrice <= 0 || normalized.minPrice > normalized.currentPrice) throw domainError("VALIDATION_FAILED", "最低可接受价不能高于当前售价", { minPrice: "必须大于 0 且不高于当前售价" });
  if (invalidRatio) throw domainError("VALIDATION_FAILED", "ACOS、TACOS 与净利率必须是 0 到 1 的小数");
  return normalized;
}

function currentStoreId(payload = {}) {
  return payload.storeId || snapshot.manifest.activeStoreId;
}

function resolveDraft(store, draftId, productId) {
  if (draftId) return assertEntity(store.entities.listingDrafts.byId[draftId], "Listing 草稿");
  return tableValues(store.entities.listingDrafts).find((item) => item.productId === (productId || store.scope.selectedProductId) && item.status !== "archived") || null;
}

function recommendationWithRevision(store, recommendationId) {
  const recommendation = assertEntity(store.entities.recommendations.byId[recommendationId], "建议");
  const revision = assertEntity(store.entities.recommendationRevisions.byId[recommendation.currentRevisionId], "建议 revision");
  return { recommendation, revision };
}

function addDecision(store, recommendation, revision, outcome, payload) {
  const timestamp = now();
  const decision = entity(store.storeId, idFor(store.storeId, "decision"), {
    recommendationId: recommendation.id,
    recommendationRevisionId: revision.id,
    outcome,
    actor: payload.actor || "operator",
    reason: payload.reason,
    licenseId: outcome === "approved" ? idFor(store.storeId, "license") : null,
    decidedAt: timestamp,
  }, timestamp);
  addToTable(store.entities.decisions, decision);
  const updated = touch(recommendation, { status: outcome === "approved" ? "approved" : "rejected", decisionId: decision.id }, timestamp);
  replaceInTable(store.entities.recommendations, updated);
  return { decision, recommendation: updated };
}

function readbackGateFor(store, readbackId) {
  const readback = store.entities.readbacks.byId[readbackId];
  if (!readback) return null;
  const evidence = readback.evidenceIds.map((id) => store.entities.evidence.byId[id]).filter((item) => item?.status === "attached");
  const byType = Object.fromEntries(evidence.map((item) => [item.type, item]));
  const ids = evidence.map((item) => item.id);
  const distinctEvidence = new Set(ids).size === ids.length;
  const valuesMatch = readback.savedValue != null && readback.reloadValue != null && String(readback.savedValue) === String(readback.reloadValue);
  const realEvidence = ["before", "after", "reload"].every((type) => byType[type]?.origin === "real");
  const blockers = [];
  if (!readback.authorityBound) blockers.push("缺少 authority recommendation revision 绑定");
  if (!readback.storeIdentityVerified) blockers.push("店铺身份未验证");
  for (const type of ["before", "after", "reload"]) if (!byType[type]) blockers.push(`缺少 ${type} 证据`);
  if (!distinctEvidence) blockers.push("before/after/reload 必须是不同证据");
  if (!valuesMatch) blockers.push("reload 值与保存值不一致");
  const evidenceComplete = ["before", "after", "reload"].every((type) => Boolean(byType[type]));
  return {
    authorityBound: Boolean(readback.authorityBound),
    identityVerified: Boolean(readback.storeIdentityVerified),
    beforeAttached: Boolean(byType.before),
    afterAttached: Boolean(byType.after),
    reloadAttached: Boolean(byType.reload),
    distinctEvidence,
    valuesMatch,
    realEvidence,
    eligibleForSimulatedVerification: blockers.length === 0,
    eligibleForProductionVerification: blockers.length === 0 && realEvidence,
    blockers,
  };
}

const aliases = {
  setActiveStore: "switchStore",
  "app.switchStore": "switchStore",
  "app.navigate": "navigate",
  createProduct: "product.create",
  updateProduct: "product.update",
  archiveProduct: "product.archive",
  deleteProduct: "product.archive",
  restoreProduct: "product.restore",
  selectProduct: "product.select",
  saveProductTargets: "product.saveTargets",
  saveTargets: "product.saveTargets",
  restoreProductTargetVersion: "product.restoreTargetVersion",
  createEvent: "event.create",
  addEvent: "event.create",
  updateEvent: "event.update",
  voidEvent: "event.void",
  saveScope: "scope.lock",
  updateScope: "scope.update",
  lockScope: "scope.lock",
  collectReports: "report.collect",
  retryReport: "report.retry",
  cancelReport: "report.cancel",
  cancelReportCollection: "report.cancelAll",
  importReports: "report.import",
  runDiagnosis: "diagnosis.run",
  generateRecommendations: "recommendation.generate",
  recalculateRecommendation: "recommendation.recalculate",
  submitForApproval: "recommendation.submit",
  approveRecommendation: "recommendation.approve",
  rejectRecommendation: "recommendation.reject",
  queueExecution: "execution.enqueue",
  runSimulatedExecution: "execution.simulate",
  pauseExecution: "execution.pause",
  attachEvidence: "evidence.attach",
  captureEvidence: "evidence.attach",
  setReloadValue: "readback.setReloadValue",
  verifyReadback: "readback.verify",
  sendToListing: "keyword.addToListing",
  removeFromListing: "keyword.removeFromListing",
  createListingDraft: "listing.createDraft",
  saveListingDraft: "listing.updateDraft",
  updateListingDraft: "listing.updateDraft",
  saveListingVersion: "listing.saveVersion",
  restoreListingVersion: "listing.restoreVersion",
  archiveListingDraft: "listing.archiveDraft",
  saveAiSettings: "rules.update",
  createSchedule: "schedule.create",
  updateSchedule: "schedule.update",
  deleteSchedule: "schedule.archive",
  toggleSchedule: "schedule.toggle",
  runScheduleNow: "schedule.runNow",
  runDeliveryCheck: "delivery.check",
  exportPrototypeBundle: "delivery.exportPrototype",
  setMode: "autonomy.setMode",
  setExecutionMode: "autonomy.setMode",
  killSwitch: "autonomy.killSwitch",
};

function canonicalType(type) {
  return aliases[type] || type;
}

function executeCommand(typeInput, payloadInput = {}) {
  const type = canonicalType(typeInput);
  const payload = payloadInput || {};
  if (type === "switchStore") {
    const storeId = payload.storeId;
    if (!snapshot.stores[storeId]) return fail("STORE_MISMATCH", `未知店铺：${storeId}`);
    if (storeId === snapshot.manifest.activeStoreId) return ok(snapshot.manifest);
    return saveManifest({ ...snapshot.manifest, activeStoreId: storeId, updatedAt: now() });
  }
  if (type === "navigate") {
    const storeId = currentStoreId(payload);
    if (!snapshot.stores[storeId]) return fail("STORE_MISMATCH", `未知店铺：${storeId}`);
    const route = normalizeRoute({ workspace: payload.workspace, subview: payload.subview });
    return saveManifest({
      ...snapshot.manifest,
      navigationByStore: { ...snapshot.manifest.navigationByStore, [storeId]: route },
      updatedAt: now(),
    });
  }

  const storeId = currentStoreId(payload);
  return mutateStore(storeId, type, payload, (store) => {
    const timestamp = now();
    switch (type) {
      case "product.create": {
        const values = payload.product || payload;
        const productTitle = values.title || values.name;
        if (!values.sku?.trim() || !values.asin?.trim() || !productTitle?.trim()) throw domainError("VALIDATION_FAILED", "SKU、ASIN 与产品名称必填");
        ensureUniqueProduct(store, values);
        const product = entity(storeId, values.id || idFor(storeId, "product"), {
          sku: values.sku.trim(),
          asin: values.asin.trim(),
          title: productTitle.trim(),
          name: productTitle.trim(),
          status: values.status || "active",
          target: values.target ? normalizeTarget(values.target) : {
            currentPrice: null,
            minPrice: null,
            targetAcos: null,
            targetTacos: null,
            targetNetMargin: null,
          },
        }, timestamp);
        addToTable(store.entities.products, product);
        return { value: product, entityType: "product", entityId: product.id, summary: `新增产品 ${product.sku}` };
      }
      case "product.update": {
        const productId = payload.productId || payload.id;
        const current = assertEntity(store.entities.products.byId[productId], "产品");
        assertExpectedRevision(current, payload.expectedRevision);
        const patch = payload.patch || payload.product || {};
        ensureUniqueProduct(store, { sku: patch.sku ?? current.sku, asin: patch.asin ?? current.asin }, productId);
        const nextTitle = patch.title ?? patch.name ?? current.title;
        const updated = touch(current, {
          ...patch,
          title: nextTitle,
          name: nextTitle,
          target: patch.target ? normalizeTarget({ ...current.target, ...patch.target }) : current.target,
          id: current.id,
          storeId,
        }, timestamp);
        replaceInTable(store.entities.products, updated);
        return { value: updated, entityType: "product", entityId: updated.id, summary: `更新产品 ${updated.sku}` };
      }
      case "product.archive":
      case "product.restore": {
        const productId = payload.productId || payload.id;
        const current = assertEntity(store.entities.products.byId[productId], "产品");
        assertExpectedRevision(current, payload.expectedRevision);
        const status = type.endsWith("restore") ? "active" : "archived";
        const updated = touch(current, { status, archiveReason: status === "archived" ? payload.reason || "operator_archive" : null }, timestamp);
        replaceInTable(store.entities.products, updated);
        if (status === "archived" && store.scope.selectedProductId === productId) {
          const replacement = tableValues(store.entities.products).find((item) => item.id !== productId && item.status === "active") || null;
          store.scope = touch(store.scope, { selectedProductId: replacement?.id || null }, timestamp);
        }
        return { value: updated, entityType: "product", entityId: updated.id, summary: `${status === "archived" ? "归档" : "恢复"}产品 ${updated.sku}` };
      }
      case "product.select": {
        const product = assertEntity(store.entities.products.byId[payload.productId || payload.id], "产品");
        if (product.status === "archived") throw domainError("VALIDATION_FAILED", "不能选择已归档产品");
        store.scope = touch(store.scope, { selectedProductId: product.id }, timestamp);
        return { value: product, entityType: "scope", entityId: store.scope.id, summary: `锁定产品 ${product.asin}` };
      }
      case "product.saveTargets": {
        const productId = payload.productId || payload.id;
        const current = assertEntity(store.entities.products.byId[productId], "产品");
        assertExpectedRevision(current, payload.expectedRevision);
        const target = normalizeTarget(payload.targets || payload.target || {});
        const priorVersions = tableValues(store.entities.targetVersions).filter((item) => item.productId === productId);
        const versionNumber = Math.max(0, ...priorVersions.map((item) => Number(item.versionNumber || 0))) + 1;
        const version = entity(storeId, idFor(storeId, "target-version"), {
          productId,
          versionNumber,
          ...clone(target),
          note: payload.note || "操作员保存目标版本",
        }, timestamp);
        addToTable(store.entities.targetVersions, version);
        const updated = touch(current, { target, targets: clone(target), targetRevision: versionNumber }, timestamp);
        replaceInTable(store.entities.products, updated);
        return { value: { product: updated, version }, entityType: "targetVersion", entityId: version.id, summary: `保存产品目标 v${versionNumber}` };
      }
      case "product.restoreTargetVersion": {
        const productId = payload.productId;
        const current = assertEntity(store.entities.products.byId[productId], "产品");
        const source = assertEntity(store.entities.targetVersions.byId[payload.versionId], "目标版本");
        if (source.productId !== productId) throw domainError("STORE_MISMATCH", "目标版本不属于当前产品");
        const priorVersions = tableValues(store.entities.targetVersions).filter((item) => item.productId === productId);
        const versionNumber = Math.max(0, ...priorVersions.map((item) => Number(item.versionNumber || 0))) + 1;
        const target = {
          currentPrice: source.currentPrice,
          minPrice: source.minPrice,
          targetAcos: source.targetAcos,
          targetTacos: source.targetTacos,
          targetNetMargin: source.targetNetMargin,
        };
        const restored = entity(storeId, idFor(storeId, "target-version"), {
          productId,
          versionNumber,
          ...clone(target),
          note: `从 v${source.versionNumber} 恢复为新版本`,
        }, timestamp);
        addToTable(store.entities.targetVersions, restored);
        const updated = touch(current, { target, targets: clone(target), targetRevision: versionNumber }, timestamp);
        replaceInTable(store.entities.products, updated);
        return { value: { product: updated, version: restored }, entityType: "targetVersion", entityId: restored.id, summary: `恢复目标为 v${versionNumber}` };
      }
      case "event.create": {
        const values = payload.event || payload;
        if (!values.title?.trim() || !values.occurredAt) throw domainError("VALIDATION_FAILED", "事件标题与发生时间必填");
        if (values.productId && !store.entities.products.byId[values.productId]) throw domainError("NOT_FOUND", "事件产品不存在");
        const event = entity(storeId, values.id || idFor(storeId, "event"), {
          productId: values.productId ?? store.scope.selectedProductId,
          type: values.type || "operation",
          title: values.title.trim(),
          description: values.description || values.impact || "",
          occurredAt: values.occurredAt,
          impact: values.impactLevel || "material",
          status: "active",
          consumedByBatchIds: [],
          voidReason: null,
        }, timestamp);
        addToTable(store.entities.events, event);
        return { value: event, entityType: "event", entityId: event.id, summary: `新增运营事件 ${event.title}` };
      }
      case "event.update": {
        const eventId = payload.eventId || payload.id;
        const current = assertEntity(store.entities.events.byId[eventId], "运营事件");
        assertExpectedRevision(current, payload.expectedRevision);
        if (current.status === "voided") throw domainError("TERMINAL_STATE", "已作废事件不能编辑");
        if (current.consumedByBatchIds?.length) throw domainError("REFERENCE_EXISTS", "事件已进入诊断批次，请追加纠错事件而不是覆盖历史");
        const patch = payload.patch || payload.event || {};
        const updated = touch(current, { ...patch, id: current.id, storeId }, timestamp);
        replaceInTable(store.entities.events, updated);
        return { value: updated, entityType: "event", entityId: updated.id, summary: `编辑运营事件 ${updated.title}` };
      }
      case "event.void": {
        const current = assertEntity(store.entities.events.byId[payload.eventId || payload.id], "运营事件");
        assertExpectedRevision(current, payload.expectedRevision);
        if (!payload.reason?.trim()) throw domainError("VALIDATION_FAILED", "作废原因必填", { reason: "请输入作废原因" });
        const updated = touch(current, { status: "voided", voided: true, voidReason: payload.reason.trim() }, timestamp);
        replaceInTable(store.entities.events, updated);
        return { value: updated, entityType: "event", entityId: updated.id, summary: `作废运营事件 ${updated.title}` };
      }
      case "scope.update":
      case "scope.lock": {
        const values = payload.patch || payload.scope || payload;
        assertExpectedRevision(store.scope, payload.expectedRevision);
        if (type === "scope.update" && store.scope.lockedAt) throw domainError("TERMINAL_STATE", "已锁定范围不能原地修改，请创建新的范围版本");
        const dateFrom = values.dateFrom;
        const dateTo = values.dateTo;
        if (!dateFrom || !dateTo || dateFrom > dateTo) throw domainError("VALIDATION_FAILED", "采集开始日期必须早于结束日期", { dateFrom: "检查日期范围", dateTo: "检查日期范围" });
        const productId = values.selectedProductId || values.productId || store.scope.selectedProductId;
        if (productId && !store.entities.products.byId[productId]) throw domainError("NOT_FOUND", "范围产品不存在");
        store.scope = touch(store.scope, {
          selectedProductId: productId,
          dateFrom,
          dateTo,
          marketplace: values.marketplace || store.scope.marketplace || store.config.marketplace,
          attributionWindow: values.attributionWindow || values.attribution || store.scope.attributionWindow,
          attribution: values.attribution || values.attributionWindow || store.scope.attribution,
          batchId: type === "scope.lock" ? values.batchId || idFor(storeId, "batch") : store.scope.batchId,
          lockedAt: type === "scope.lock" ? timestamp : null,
          status: type === "scope.lock" ? "locked" : "draft",
        }, timestamp);
        return { value: store.scope, entityType: "scope", entityId: store.scope.id, summary: `${type === "scope.lock" ? "锁定" : "保存"}范围 ${dateFrom} 至 ${dateTo}` };
      }
      case "report.collect": {
        const ids = payload.reportIds?.length ? payload.reportIds : store.entities.reports.allIds;
        const collected = [];
        ids.forEach((id, index) => {
          const current = assertEntity(store.entities.reports.byId[id], "报表任务");
          const updated = touch(current, {
            status: "ready",
            rows: current.rows || 240 + index * 73,
            dateFrom: store.scope.dateFrom,
            dateTo: store.scope.dateTo,
            filename: current.filename || `${current.type}_${storeId}_${Date.now()}.xlsx`,
            errorCode: null,
            errorMessage: null,
          }, timestamp);
          replaceInTable(store.entities.reports, updated);
          collected.push(updated);
        });
        return { value: collected, entityType: "report", entityId: ids.join(","), summary: `采集 ${collected.length} 类领星报表` };
      }
      case "report.retry": {
        const current = assertEntity(store.entities.reports.byId[payload.reportId || payload.id], "报表任务");
        const updated = touch(current, {
          status: "ready",
          rows: current.rows || 318,
          dateFrom: store.scope.dateFrom,
          dateTo: store.scope.dateTo,
          filename: current.filename || `${current.type}_${storeId}_retry.xlsx`,
          retryCount: Number(current.retryCount || 0) + 1,
          errorCode: null,
          errorMessage: null,
        }, timestamp);
        replaceInTable(store.entities.reports, updated);
        return { value: updated, entityType: "report", entityId: updated.id, summary: `重试报表 ${updated.label}` };
      }
      case "report.cancel": {
        const current = assertEntity(store.entities.reports.byId[payload.reportId || payload.id], "报表任务");
        if (["imported", "cancelled"].includes(current.status)) throw domainError("TERMINAL_STATE", "该报表任务不能取消");
        const updated = touch(current, { status: "cancelled", errorCode: "OPERATOR_CANCELLED", errorMessage: payload.reason || "操作员取消" }, timestamp);
        replaceInTable(store.entities.reports, updated);
        return { value: updated, entityType: "report", entityId: updated.id, summary: `取消报表 ${updated.label}` };
      }
      case "report.cancelAll": {
        const affected = [];
        for (const current of tableValues(store.entities.reports)) {
          if (!['collecting', 'running'].includes(current.status)) continue;
          const updated = touch(current, { status: "cancelled", errorCode: "OPERATOR_CANCELLED", errorMessage: payload.reason || "操作员取消采集" }, timestamp);
          replaceInTable(store.entities.reports, updated);
          affected.push(updated);
        }
        return { value: affected, entityType: "report", entityId: affected.map((item) => item.id).join(","), summary: `取消 ${affected.length} 个采集任务` };
      }
      case "report.import": {
        const reports = tableValues(store.entities.reports);
        const blockers = reports.filter((item) => !["ready", "downloaded", "imported"].includes(item.status));
        if (blockers.length) throw domainError("NOT_ELIGIBLE", `仍有 ${blockers.length} 类报表未达到导入门槛`);
        const existing = tableValues(store.entities.imports).find((item) => item.batchId === store.scope.batchId && item.status === "validated");
        if (existing) return { value: existing, entityType: "import", entityId: existing.id, summary: `复用幂等导入批次 ${existing.id}` };
        let totalRows = 0;
        for (const current of reports) {
          totalRows += Number(current.rows || 0);
          replaceInTable(store.entities.reports, touch(current, { status: "imported", importedAt: timestamp }, timestamp));
        }
        const importRun = entity(storeId, idFor(storeId, "import"), {
          scopeId: store.scope.id,
          batchId: store.scope.batchId,
          reportIds: reports.map((item) => item.id),
          status: "validated",
          importedRows: totalRows,
          reconciliation: "passed",
          completedAt: timestamp,
        }, timestamp);
        addToTable(store.entities.imports, importRun);
        return { value: importRun, entityType: "import", entityId: importRun.id, summary: `导入 ${totalRows} 行事实数据` };
      }
      case "diagnosis.run": {
        const imported = tableValues(store.entities.reports).filter((item) => item.status === "imported");
        if (imported.length !== REPORT_TYPES.length) throw domainError("NOT_ELIGIBLE", `诊断需要 8/8 已导入报表，当前 ${imported.length}/8`);
        const product = assertEntity(store.entities.products.byId[store.scope.selectedProductId], "当前产品");
        const runId = idFor(storeId, "diagnosis");
        const created = [
          entity(storeId, `${runId}-1`, { productId: product.id, batchId: store.scope.batchId, objectType: "keyword", objectName: `${product.sku} 核心词`, severity: store.metrics.acos > store.metrics.targetAcos ? "high" : "medium", diagnosis: `ACOS ${(store.metrics.acos * 100).toFixed(1)}% / 目标 ${(store.metrics.targetAcos * 100).toFixed(1)}%`, suggestedAction: "bid_change", status: "active" }, timestamp),
          entity(storeId, `${runId}-2`, { productId: product.id, batchId: store.scope.batchId, objectType: "ad_group", objectName: `${product.sku} Exact`, severity: "medium", diagnosis: "预算消耗与高转化时段不匹配", suggestedAction: "budget_change", status: "active" }, timestamp),
        ];
        created.forEach((item) => addToTable(store.entities.diagnostics, item));
        return { value: created, entityType: "diagnostic", entityId: runId, summary: `生成 ${created.length} 条量化诊断` };
      }
      case "recommendation.generate": {
        const diagnosticIds = payload.diagnosticIds?.length ? payload.diagnosticIds : store.entities.diagnostics.allIds.slice(-2);
        if (!diagnosticIds.length) throw domainError("NOT_ELIGIBLE", "没有可生成建议的诊断");
        const created = diagnosticIds.map((diagnosticId, index) => {
          const diagnostic = assertEntity(store.entities.diagnostics.byId[diagnosticId], "诊断");
          const recommendationId = idFor(storeId, "recommendation");
          const revisionId = `${recommendationId}-r1`;
          const currentValue = index % 2 ? 100 : 1.2;
          const recommendedValue = index % 2 ? 118 : 1.08;
          const revision = entity(storeId, revisionId, {
            recommendationId,
            revisionNumber: 1,
            actionType: index % 2 ? "budget_change" : "bid_change",
            entityType: diagnostic.objectType,
            entityId: diagnostic.objectName,
            currentValue,
            recommendedValue,
            unit: "currency",
            risk: diagnostic.severity === "high" ? "high" : "medium",
            title: index % 2 ? "高转化时段预算调整" : "核心词竞价收紧",
            reason: diagnostic.diagnosis,
            evidenceIds: [diagnostic.id],
            diagnosticIds: [diagnostic.id],
            authorityBatchId: diagnostic.batchId,
            policySnapshot: { mode: store.autonomy.mode, eligible: diagnostic.severity !== "high", bidLimit: store.autonomy.bidChangeLimitPercent, budgetLimit: store.autonomy.budgetChangeLimitPercent },
          }, timestamp);
          const recommendation = entity(storeId, recommendationId, { productId: diagnostic.productId, status: "pending_review", currentRevisionId: revisionId, decisionId: null, executionId: null }, timestamp);
          addToTable(store.entities.recommendationRevisions, revision);
          addToTable(store.entities.recommendations, recommendation);
          return recommendation;
        });
        return { value: created, entityType: "recommendation", entityId: created.map((item) => item.id).join(","), summary: `生成 ${created.length} 条 AI 建议` };
      }
      case "recommendation.recalculate": {
        const { recommendation, revision } = recommendationWithRevision(store, payload.recommendationId || payload.id);
        assertExpectedRevision(recommendation, payload.expectedRevision);
        if (["approved", "rejected", "executed", "superseded"].includes(recommendation.status)) throw domainError("TERMINAL_STATE", "终态建议不能重算");
        const revisionNumber = Number(revision.revisionNumber || 0) + 1;
        const nextRevision = entity(storeId, `${recommendation.id}-r${revisionNumber}`, {
          ...clone(revision),
          id: `${recommendation.id}-r${revisionNumber}`,
          storeId,
          revision: 1,
          revisionNumber,
          recommendedValue: typeof revision.recommendedValue === "number" ? Number((revision.recommendedValue * 0.94).toFixed(2)) : revision.recommendedValue,
          reason: `${revision.reason}；已按“${payload.constraint || "降低影响"}”生成新版本。`,
        }, timestamp);
        addToTable(store.entities.recommendationRevisions, nextRevision);
        const updated = touch(recommendation, { status: "pending_review", currentRevisionId: nextRevision.id }, timestamp);
        replaceInTable(store.entities.recommendations, updated);
        return { value: { recommendation: updated, revision: nextRevision }, entityType: "recommendation", entityId: updated.id, summary: `重算建议 ${updated.id} rev ${revisionNumber}` };
      }
      case "recommendation.submit": {
        const ids = payload.recommendationIds?.length ? payload.recommendationIds : [payload.recommendationId || payload.id];
        const updated = ids.map((id) => {
          const current = assertEntity(store.entities.recommendations.byId[id], "建议");
          if (current.status !== "pending_review") throw domainError("TERMINAL_STATE", `建议 ${id} 当前不能送审`);
          const next = touch(current, { status: "pending_approval" }, timestamp);
          replaceInTable(store.entities.recommendations, next);
          return next;
        });
        return { value: updated, entityType: "recommendation", entityId: ids.join(","), summary: `送审 ${updated.length} 条建议` };
      }
      case "recommendation.approve":
      case "recommendation.reject": {
        const { recommendation, revision } = recommendationWithRevision(store, payload.recommendationId || payload.id);
        assertExpectedRevision(recommendation, payload.expectedRevision);
        if (recommendation.status !== "pending_approval") throw domainError("TERMINAL_STATE", "只有待审批建议可以决定");
        if (!payload.reason?.trim()) throw domainError("VALIDATION_FAILED", "审批或驳回原因必填", { reason: "请输入决定原因" });
        if (payload.recommendationRevisionId && payload.recommendationRevisionId !== revision.id) throw domainError("REVISION_CONFLICT", "审批绑定的建议 revision 已过期");
        const outcome = type.endsWith("approve") ? "approved" : "rejected";
        const result = addDecision(store, recommendation, revision, outcome, payload);
        return { value: result, entityType: "decision", entityId: result.decision.id, summary: `${outcome === "approved" ? "批准" : "驳回"}建议 ${recommendation.id}` };
      }
      case "execution.enqueue": {
        const { recommendation, revision } = recommendationWithRevision(store, payload.recommendationId || payload.id);
        if (recommendation.status !== "approved") throw domainError("NOT_ELIGIBLE", "建议未获得批准许可");
        const decision = assertEntity(store.entities.decisions.byId[recommendation.decisionId], "批准决定");
        if (decision.outcome !== "approved" || decision.recommendationRevisionId !== revision.id) throw domainError("REVISION_CONFLICT", "决定未绑定当前建议 revision");
        const duplicate = tableValues(store.entities.executions).find((item) => item.recommendationRevisionId === revision.id && item.status !== "cancelled");
        if (duplicate) throw domainError("REFERENCE_EXISTS", "当前建议 revision 已存在执行记录");
        const execution = entity(storeId, idFor(storeId, "execution"), {
          recommendationId: recommendation.id,
          recommendationRevisionId: revision.id,
          decisionId: decision.id,
          status: "queued",
          entityType: revision.entityType,
          entityId: revision.entityId,
          beforeValue: revision.currentValue,
          intendedValue: revision.recommendedValue,
          observedValue: null,
          browserProfileId: store.session.browserProfileId,
          identityVerifiedAt: null,
          queuedAt: timestamp,
          startedAt: null,
          savedAt: null,
          errorCode: null,
          errorMessage: null,
        }, timestamp);
        addToTable(store.entities.executions, execution);
        replaceInTable(store.entities.recommendations, touch(recommendation, { executionId: execution.id }, timestamp));
        return { value: execution, entityType: "execution", entityId: execution.id, summary: `执行入队 ${execution.id}` };
      }
      case "execution.simulate": {
        const current = assertEntity(store.entities.executions.byId[payload.executionId || payload.id], "执行");
        assertExpectedRevision(current, payload.expectedRevision);
        if (!store.session.status || store.session.status !== "ready") throw domainError("NOT_ELIGIBLE", "可见浏览器身份尚未就绪");
        if (store.autonomy.paused) throw domainError("NOT_ELIGIBLE", "本店执行已被 kill switch 暂停");
        if (current.status !== "queued") throw domainError("TERMINAL_STATE", "只有已排队动作可以模拟执行");
        const execution = touch(current, {
          status: "awaiting_readback",
          startedAt: timestamp,
          identityVerifiedAt: timestamp,
          savedAt: timestamp,
          observedValue: current.intendedValue,
        }, timestamp);
        replaceInTable(store.entities.executions, execution);
        const readback = entity(storeId, idFor(storeId, "readback"), {
          executionId: execution.id,
          recommendationId: execution.recommendationId,
          recommendationRevisionId: execution.recommendationRevisionId,
          status: "waiting",
          verificationMode: null,
          evidenceIds: [],
          beforeValue: execution.beforeValue,
          savedValue: execution.intendedValue,
          reloadValue: null,
          authorityBound: true,
          storeIdentityVerified: false,
          checkedAt: null,
          failureReasons: [],
        }, timestamp);
        addToTable(store.entities.readbacks, readback);
        return { value: { execution, readback }, entityType: "execution", entityId: execution.id, summary: `完成原型模拟写入，等待回读 ${readback.id}` };
      }
      case "execution.pause": {
        store.autonomy = touch(store.autonomy, { paused: true, killSwitchReason: payload.reason || "operator_pause" }, timestamp);
        const affected = [];
        for (const current of tableValues(store.entities.executions)) {
          if (!["queued", "running"].includes(current.status)) continue;
          const updated = touch(current, { status: "cancelled", errorCode: "KILL_SWITCH", errorMessage: store.autonomy.killSwitchReason }, timestamp);
          replaceInTable(store.entities.executions, updated);
          affected.push(updated);
        }
        return { value: affected, entityType: "execution", entityId: affected.map((item) => item.id).join(","), summary: `暂停执行队列，终止 ${affected.length} 个动作` };
      }
      case "evidence.attach": {
        const readback = assertEntity(store.entities.readbacks.byId[payload.readbackId], "回读任务");
        if (readback.status === "verified") throw domainError("TERMINAL_STATE", "已验证回读不能追加证据");
        if (!["before", "after", "reload"].includes(payload.evidenceType || payload.type)) throw domainError("VALIDATION_FAILED", "证据类型必须是 before、after 或 reload");
        if (payload.origin && payload.origin !== "prototype") throw domainError("VALIDATION_FAILED", "V2 原型只能附加 origin=prototype 的模拟证据");
        const evidenceType = payload.evidenceType || payload.type;
        const existing = readback.evidenceIds.map((id) => store.entities.evidence.byId[id]).find((item) => item?.type === evidenceType && item.status === "attached");
        if (existing) replaceInTable(store.entities.evidence, touch(existing, { status: "superseded" }, timestamp));
        const evidenceItem = entity(storeId, idFor(storeId, `evidence-${evidenceType}`), {
          readbackId: readback.id,
          type: evidenceType,
          origin: "prototype",
          filename: payload.filename || `${evidenceType}-${readback.id}.png`,
          mimeType: payload.mimeType || "image/png",
          sha256: payload.sha256 || `prototype-${Math.random().toString(36).slice(2, 12)}`,
          capturedAt: payload.capturedAt || timestamp,
          localRef: payload.localRef || null,
          status: "attached",
        }, timestamp);
        addToTable(store.entities.evidence, evidenceItem);
        const ids = readback.evidenceIds.filter((id) => id !== existing?.id).concat(evidenceItem.id);
        const updated = touch(readback, { evidenceIds: ids }, timestamp);
        replaceInTable(store.entities.readbacks, updated);
        return { value: evidenceItem, entityType: "evidence", entityId: evidenceItem.id, summary: `附加 ${evidenceType} 原型证据` };
      }
      case "readback.setReloadValue": {
        const current = assertEntity(store.entities.readbacks.byId[payload.readbackId || payload.id], "回读任务");
        if (current.status === "verified") throw domainError("TERMINAL_STATE", "已验证回读不能修改值");
        const updated = touch(current, { reloadValue: payload.reloadValue ?? payload.value, storeIdentityVerified: Boolean(payload.storeIdentityVerified) }, timestamp);
        replaceInTable(store.entities.readbacks, updated);
        return { value: updated, entityType: "readback", entityId: updated.id, summary: `记录 reload 值 ${String(updated.reloadValue)}` };
      }
      case "readback.verify": {
        const current = assertEntity(store.entities.readbacks.byId[payload.readbackId || payload.id], "回读任务");
        assertExpectedRevision(current, payload.expectedRevision);
        if (current.status === "verified") throw domainError("TERMINAL_STATE", "回读已经验证");
        const gate = readbackGateFor(store, current.id);
        if (!gate?.eligibleForSimulatedVerification) throw domainError("NOT_ELIGIBLE", gate?.blockers.join("；") || "回读证据不完整");
        const updated = touch(current, { status: "verified", verificationMode: "simulated", checkedAt: timestamp, failureReasons: [], productionVerified: false }, timestamp);
        replaceInTable(store.entities.readbacks, updated);
        const execution = assertEntity(store.entities.executions.byId[current.executionId], "执行");
        replaceInTable(store.entities.executions, touch(execution, { status: "verified", observedValue: updated.reloadValue }, timestamp));
        const recommendation = assertEntity(store.entities.recommendations.byId[current.recommendationId], "建议");
        if (recommendation.status === "approved") replaceInTable(store.entities.recommendations, touch(recommendation, { status: "executed" }, timestamp));
        return { value: { readback: updated, gate: { ...gate, eligibleForProductionVerification: false } }, entityType: "readback", entityId: updated.id, summary: `完成模拟回读验证 ${updated.id}` };
      }
      case "keyword.addToListing":
      case "keyword.removeFromListing": {
        const keyword = assertEntity(store.entities.keywords.byId[payload.keywordId || payload.id], "关键词");
        const draft = resolveDraft(store, payload.draftId, payload.productId);
        if (!draft) throw domainError("NOT_FOUND", "当前产品没有可编辑 Listing 草稿");
        const add = type.endsWith("addToListing");
        const keywordIds = add ? [...new Set([...draft.keywordIds, keyword.id])] : draft.keywordIds.filter((id) => id !== keyword.id);
        const updatedDraft = touch(draft, { keywordIds }, timestamp);
        replaceInTable(store.entities.listingDrafts, updatedDraft);
        replaceInTable(store.entities.keywords, touch(keyword, { state: add ? "included" : "candidate" }, timestamp));
        return { value: updatedDraft, entityType: "listingDraft", entityId: updatedDraft.id, summary: `${add ? "加入" : "移除"} Listing 关键词 ${keyword.keyword}` };
      }
      case "listing.createDraft": {
        const productId = payload.productId || store.scope.selectedProductId;
        const product = assertEntity(store.entities.products.byId[productId], "产品");
        const draft = entity(storeId, payload.id || idFor(storeId, "listing-draft"), {
          productId,
          status: "editing",
          title: payload.title || product.title,
          bullets: payload.bullets || ["", "", ""],
          backendTerms: payload.backendTerms || "",
          keywordIds: payload.keywordIds || [],
          baseVersionId: payload.baseVersionId || null,
        }, timestamp);
        addToTable(store.entities.listingDrafts, draft);
        return { value: draft, entityType: "listingDraft", entityId: draft.id, summary: `创建 Listing 草稿 ${product.asin}` };
      }
      case "listing.updateDraft": {
        const draft = resolveDraft(store, payload.draftId || payload.id, payload.productId);
        if (!draft) throw domainError("NOT_FOUND", "Listing 草稿不存在");
        assertExpectedRevision(draft, payload.expectedRevision);
        if (draft.status === "archived") throw domainError("TERMINAL_STATE", "已归档草稿不能编辑");
        const patch = payload.patch || payload.draft || payload;
        const updated = touch(draft, {
          title: patch.title ?? draft.title,
          bullets: patch.bullets ?? draft.bullets,
          backendTerms: patch.backendTerms ?? draft.backendTerms,
          keywordIds: patch.keywordIds ?? draft.keywordIds,
          status: "saved",
        }, timestamp);
        replaceInTable(store.entities.listingDrafts, updated);
        return { value: updated, entityType: "listingDraft", entityId: updated.id, summary: `保存 Listing 草稿 ${updated.id}` };
      }
      case "listing.saveVersion": {
        const draft = resolveDraft(store, payload.draftId || payload.id, payload.productId);
        if (!draft) throw domainError("NOT_FOUND", "Listing 草稿不存在");
        assertExpectedRevision(draft, payload.expectedRevision);
        const previous = tableValues(store.entities.listingVersions).filter((item) => item.productId === draft.productId);
        const version = entity(storeId, idFor(storeId, "listing-version"), {
          productId: draft.productId,
          sourceDraftId: draft.id,
          versionNumber: Math.max(0, ...previous.map((item) => Number(item.versionNumber || 0))) + 1,
          title: draft.title,
          bullets: clone(draft.bullets),
          backendTerms: draft.backendTerms,
          keywordIds: clone(draft.keywordIds),
          note: payload.note || "操作员保存版本",
        }, timestamp);
        addToTable(store.entities.listingVersions, version);
        replaceInTable(store.entities.listingDrafts, touch(draft, { status: "saved", baseVersionId: version.id }, timestamp));
        return { value: version, entityType: "listingVersion", entityId: version.id, summary: `保存 Listing v${version.versionNumber}` };
      }
      case "listing.restoreVersion": {
        const version = assertEntity(store.entities.listingVersions.byId[payload.versionId || payload.id], "Listing 版本");
        const draft = entity(storeId, idFor(storeId, "listing-draft"), {
          productId: version.productId,
          status: "editing",
          title: version.title,
          bullets: clone(version.bullets),
          backendTerms: version.backendTerms,
          keywordIds: clone(version.keywordIds),
          baseVersionId: version.id,
        }, timestamp);
        addToTable(store.entities.listingDrafts, draft);
        return { value: draft, entityType: "listingDraft", entityId: draft.id, summary: `从 Listing v${version.versionNumber} 创建恢复草稿` };
      }
      case "listing.archiveDraft": {
        const draft = resolveDraft(store, payload.draftId || payload.id, payload.productId);
        if (!draft) throw domainError("NOT_FOUND", "Listing 草稿不存在");
        const updated = touch(draft, { status: "archived", archiveReason: payload.reason || "operator_archive" }, timestamp);
        replaceInTable(store.entities.listingDrafts, updated);
        return { value: updated, entityType: "listingDraft", entityId: updated.id, summary: `归档 Listing 草稿 ${updated.id}` };
      }
      case "rules.update": {
        const patch = payload.rules || payload.settings || payload;
        store.config = touch(store.config, {
          aiProvider: patch.aiProvider ?? patch.provider ?? store.config.aiProvider,
          aiModel: patch.aiModel ?? patch.model ?? store.config.aiModel,
          temperature: patch.temperature == null ? store.config.temperature : Number(patch.temperature),
        }, timestamp);
        store.settings = touch(store.settings || clone(store.config), {
          aiProvider: store.config.aiProvider,
          aiModel: store.config.aiModel,
          temperature: store.config.temperature,
        }, timestamp);
        store.autonomy = touch(store.autonomy, {
          bidChangeLimitPercent: patch.bidChangeLimitPercent ?? patch.maxBidChange ?? store.autonomy.bidChangeLimitPercent,
          budgetChangeLimitPercent: patch.budgetChangeLimitPercent ?? patch.maxBudgetChange ?? store.autonomy.budgetChangeLimitPercent,
          pauseAlwaysNeedsApproval: patch.pauseAlwaysNeedsApproval ?? patch.pauseNeedsApproval ?? store.autonomy.pauseAlwaysNeedsApproval,
        }, timestamp);
        return { value: { config: store.config, settings: store.settings, autonomy: store.autonomy }, entityType: "rules", entityId: store.autonomy.id, summary: "更新 AI 与自动执行规则" };
      }
      case "schedule.create": {
        const values = payload.schedule || payload;
        if (!values.name?.trim() || !values.kind || !values.cron) throw domainError("VALIDATION_FAILED", "任务名称、类型与触发规则必填");
        const scheduleItem = entity(storeId, values.id || idFor(storeId, "schedule"), {
          name: values.name.trim(),
          kind: values.kind,
          cron: values.cron,
          timezone: values.timezone || store.config.timezone,
          status: values.status || "paused",
          config: values.config || {},
          lastRunId: null,
        }, timestamp);
        addToTable(store.entities.schedules, scheduleItem);
        return { value: scheduleItem, entityType: "schedule", entityId: scheduleItem.id, summary: `新增定时任务 ${scheduleItem.name}` };
      }
      case "schedule.update": {
        const current = assertEntity(store.entities.schedules.byId[payload.scheduleId || payload.id], "定时任务");
        assertExpectedRevision(current, payload.expectedRevision);
        if (current.status === "archived") throw domainError("TERMINAL_STATE", "已归档任务不能编辑");
        const updated = touch(current, { ...(payload.patch || payload.schedule || {}), id: current.id, storeId }, timestamp);
        replaceInTable(store.entities.schedules, updated);
        return { value: updated, entityType: "schedule", entityId: updated.id, summary: `编辑定时任务 ${updated.name}` };
      }
      case "schedule.archive": {
        const current = assertEntity(store.entities.schedules.byId[payload.scheduleId || payload.id], "定时任务");
        const updated = touch(current, { status: "archived", archiveReason: payload.reason || "operator_archive" }, timestamp);
        replaceInTable(store.entities.schedules, updated);
        return { value: updated, entityType: "schedule", entityId: updated.id, summary: `归档定时任务 ${updated.name}` };
      }
      case "schedule.toggle": {
        const current = assertEntity(store.entities.schedules.byId[payload.scheduleId || payload.id], "定时任务");
        if (current.status === "archived") throw domainError("TERMINAL_STATE", "已归档任务不能启停");
        const enabled = payload.enabled ?? current.status !== "enabled";
        const updated = touch(current, { status: enabled ? "enabled" : "paused" }, timestamp);
        replaceInTable(store.entities.schedules, updated);
        return { value: updated, entityType: "schedule", entityId: updated.id, summary: `${enabled ? "启用" : "暂停"}定时任务 ${updated.name}` };
      }
      case "schedule.runNow": {
        const current = assertEntity(store.entities.schedules.byId[payload.scheduleId || payload.id], "定时任务");
        if (current.status === "archived") throw domainError("TERMINAL_STATE", "已归档任务不能运行");
        const run = entity(storeId, idFor(storeId, "schedule-run"), {
          scheduleId: current.id,
          status: "success",
          startedAt: timestamp,
          completedAt: timestamp,
          summary: `${current.name} 原型运行完成`,
        }, timestamp);
        addToTable(store.entities.scheduleRuns, run);
        replaceInTable(store.entities.schedules, touch(current, { lastRunId: run.id }, timestamp));
        return { value: run, entityType: "scheduleRun", entityId: run.id, summary: `立即运行 ${current.name}` };
      }
      case "delivery.check": {
        const checks = store.delivery.checks.map((check) => check.gate === "真实 Ads 执行回读"
          ? { ...check, status: "blocked", evidence: "原型不提供真实 before / after / reload" }
          : { ...check, status: "passed" });
        store.delivery = touch(store.delivery, { checks, checkedAt: timestamp, status: "PROTOTYPE_ONLY", productionReady: false }, timestamp);
        return { value: store.delivery, entityType: "delivery", entityId: store.delivery.id, summary: "完成 V2 原型交付检查" };
      }
      case "delivery.exportPrototype": {
        if (payload.productionReady === true) throw domainError("NOT_ELIGIBLE", "原型包不能标记为生产 READY");
        store.delivery = touch(store.delivery, { lastExportAt: timestamp, status: "PROTOTYPE_ONLY", productionReady: false }, timestamp);
        const artifact = {
          label: payload.label || "PROTOTYPE_ONLY",
          filename: `${storeId}-interactive-prototype-${timestamp.slice(0, 10)}.json`,
          productionReady: false,
          simulated: true,
        };
        return { value: artifact, entityType: "delivery", entityId: store.delivery.id, summary: `模拟导出 ${artifact.filename}` };
      }
      case "autonomy.setMode": {
        if (!["auto", "review"].includes(payload.mode)) throw domainError("VALIDATION_FAILED", "执行模式必须是 auto 或 review");
        store.autonomy = touch(store.autonomy, { mode: payload.mode, paused: false, killSwitchReason: null }, timestamp);
        return { value: store.autonomy, entityType: "autonomy", entityId: store.autonomy.id, summary: `切换执行模式为 ${payload.mode}` };
      }
      case "autonomy.killSwitch": {
        const active = payload.active ?? true;
        store.autonomy = touch(store.autonomy, { paused: active, killSwitchReason: active ? payload.reason || "operator_kill_switch" : null }, timestamp);
        const affected = [];
        if (active) {
          for (const current of tableValues(store.entities.executions)) {
            if (!["queued", "running"].includes(current.status)) continue;
            const updated = touch(current, { status: "cancelled", errorCode: "KILL_SWITCH", errorMessage: store.autonomy.killSwitchReason }, timestamp);
            replaceInTable(store.entities.executions, updated);
            affected.push(updated.id);
          }
        }
        return { value: { autonomy: store.autonomy, affectedExecutionIds: affected }, entityType: "autonomy", entityId: store.autonomy.id, summary: `${active ? "启用" : "解除"} kill switch` };
      }
      default:
        throw domainError("NOT_FOUND", `未知命令：${typeInput}`);
    }
  });
}

function resetActiveStore() {
  const storeId = snapshot.manifest.activeStoreId;
  const current = snapshot.stores[storeId];
  const next = fixtureFor(storeId);
  next.revision = Number(current.revision || 0) + 1;
  next.updatedAt = now();
  appendAudit(next, "store.reset", { entityType: "store", entityId: storeId, summary: "重置当前店铺原型数据" });
  return saveStore(next, current.revision);
}

function handleStorageEvent(event) {
  if (!event?.key || !event.newValue) return;
  try {
    if (event.key === MANIFEST_KEY) {
      const manifest = JSON.parse(event.newValue);
      if (manifest?.schemaVersion !== SCHEMA_VERSION) return;
      snapshot = { manifest, stores: snapshot.stores };
      emit();
      return;
    }
    const prefix = "amazon-ai-ops:v2:store:";
    if (!event.key.startsWith(prefix)) return;
    const storeId = event.key.slice(prefix.length);
    const envelope = JSON.parse(event.newValue);
    if (!validStoreShape(envelope?.data, storeId)) return;
    if (Number(envelope.data.revision) <= Number(snapshot.stores[storeId]?.revision || 0)) return;
    snapshot = { manifest: snapshot.manifest, stores: { ...snapshot.stores, [storeId]: envelope.data } };
    emit();
  } catch {
    // Ignore malformed external writes rather than corrupting the live snapshot.
  }
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("storage", handleStorageEvent);
}

export const repository = {
  subscribe: (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot: () => snapshot,
  command: (type, payload = {}) => executeCommand(type, payload),
  resetActiveStore: () => resetActiveStore(),
};

export function selectStore(state, storeId = state.manifest.activeStoreId) {
  return state.stores[storeId] || null;
}

export function selectActiveStore(state) {
  return selectStore(state, state.manifest.activeStoreId);
}

export function selectRoute(state, storeId = state.manifest.activeStoreId) {
  return normalizeRoute(state.manifest.navigationByStore[storeId] || DEFAULT_ROUTE);
}

export function selectProducts(state, storeId = state.manifest.activeStoreId, options = {}) {
  const store = selectStore(state, storeId);
  if (!store) return [];
  return tableValues(store.entities.products).filter((item) => options.includeArchived || item.status !== "archived");
}

export function selectCurrentProduct(state, storeId = state.manifest.activeStoreId) {
  const store = selectStore(state, storeId);
  return store?.entities.products.byId[store.scope.selectedProductId] || null;
}

export function selectProductTargetHealth(state, storeId, productId) {
  const store = selectStore(state, storeId);
  const product = store?.entities.products.byId[productId];
  if (!product) return { configured: false, tone: "danger", reasons: ["产品不存在"] };
  const reasons = [];
  if (!product.target?.currentPrice) reasons.push("缺少当前售价");
  if (!product.target?.minPrice) reasons.push("缺少最低可接受价");
  if (!product.target?.targetAcos) reasons.push("缺少目标 ACOS");
  if (product.target?.minPrice > product.target?.currentPrice) reasons.push("最低价高于当前售价");
  const configured = reasons.length === 0;
  const tone = !configured ? "danger" : product.target.targetAcos > 0.35 ? "warning" : "success";
  return { configured, tone, reasons };
}

export function selectEvents(state, storeId = state.manifest.activeStoreId, options = {}) {
  const store = selectStore(state, storeId);
  if (!store) return [];
  return tableValues(store.entities.events)
    .filter((item) => options.includeVoided || item.status !== "voided")
    .filter((item) => !options.productId || item.productId == null || item.productId === options.productId)
    .sort((left, right) => String(right.occurredAt).localeCompare(String(left.occurredAt)));
}

export function selectReports(state, storeId = state.manifest.activeStoreId) {
  const store = selectStore(state, storeId);
  return store ? tableValues(store.entities.reports) : [];
}

export function selectReportCoverage(state, storeId = state.manifest.activeStoreId) {
  const reports = selectReports(state, storeId);
  const available = reports.filter((item) => ["ready", "downloaded", "imported"].includes(item.status));
  const imported = reports.filter((item) => item.status === "imported");
  return {
    expected: REPORT_TYPES.length,
    available: available.length,
    imported: imported.length,
    missingTypeIds: reports.filter((item) => !["ready", "downloaded", "imported"].includes(item.status)).map((item) => item.id),
    importedRows: imported.reduce((sum, item) => sum + Number(item.rows || 0), 0),
  };
}

export function selectImportEligibility(state, storeId = state.manifest.activeStoreId) {
  const coverage = selectReportCoverage(state, storeId);
  const blockers = coverage.available === coverage.expected ? [] : [`仍缺 ${coverage.expected - coverage.available} 类报表`];
  return { eligible: blockers.length === 0, blockers };
}

export function selectDiagnostics(state, storeId = state.manifest.activeStoreId) {
  const store = selectStore(state, storeId);
  return store ? tableValues(store.entities.diagnostics).filter((item) => item.status === "active") : [];
}

export function selectRecommendationRows(state, storeId = state.manifest.activeStoreId, view = "all") {
  const store = selectStore(state, storeId);
  if (!store) return [];
  const statusFilter = {
    recommendations: ["pending_review"],
    approval: ["pending_approval"],
    decided: ["approved", "rejected", "executed", "superseded"],
  }[view] || null;
  return tableValues(store.entities.recommendations)
    .filter((item) => !statusFilter || statusFilter.includes(item.status))
    .map((recommendation) => ({
      recommendation,
      revision: store.entities.recommendationRevisions.byId[recommendation.currentRevisionId],
      decision: recommendation.decisionId ? store.entities.decisions.byId[recommendation.decisionId] : null,
    }));
}

export function selectRecommendationCounts(state, storeId = state.manifest.activeStoreId) {
  return selectRecommendationRows(state, storeId).reduce((counts, row) => {
    counts.total += 1;
    counts[row.recommendation.status] = (counts[row.recommendation.status] || 0) + 1;
    return counts;
  }, { total: 0, pending_review: 0, pending_approval: 0, approved: 0, rejected: 0, executed: 0, superseded: 0 });
}

export function selectDecisionRows(state, storeId = state.manifest.activeStoreId) {
  const store = selectStore(state, storeId);
  if (!store) return [];
  return tableValues(store.entities.decisions).map((decision) => ({
    decision,
    recommendation: store.entities.recommendations.byId[decision.recommendationId],
    revision: store.entities.recommendationRevisions.byId[decision.recommendationRevisionId],
  }));
}

export function selectExecutionQueue(state, storeId = state.manifest.activeStoreId) {
  const store = selectStore(state, storeId);
  return store ? tableValues(store.entities.executions) : [];
}

export function selectExecutionEligibility(state, storeId, recommendationId) {
  const store = selectStore(state, storeId);
  const recommendation = store?.entities.recommendations.byId[recommendationId];
  const blockers = [];
  if (!recommendation) blockers.push("建议不存在");
  if (recommendation && recommendation.status !== "approved") blockers.push("建议尚未批准");
  if (store?.autonomy.paused) blockers.push("kill switch 已启用");
  if (store?.session.status !== "ready") blockers.push("可见浏览器身份未就绪");
  if (recommendation?.executionId) blockers.push("当前建议已有执行记录");
  return { eligible: blockers.length === 0, blockers };
}

export function selectReadbacks(state, storeId = state.manifest.activeStoreId) {
  const store = selectStore(state, storeId);
  return store ? tableValues(store.entities.readbacks) : [];
}

export function selectReadbackGate(state, storeId, readbackId) {
  const store = selectStore(state, storeId);
  return store ? readbackGateFor(store, readbackId) : null;
}

export function selectKeywords(state, storeId = state.manifest.activeStoreId) {
  const store = selectStore(state, storeId);
  return store ? tableValues(store.entities.keywords) : [];
}

export function selectListingDraft(state, storeId = state.manifest.activeStoreId, productId) {
  const store = selectStore(state, storeId);
  if (!store) return null;
  const targetProductId = productId || store.scope.selectedProductId;
  return tableValues(store.entities.listingDrafts).find((item) => item.productId === targetProductId && item.status !== "archived") || null;
}

export function selectListingCandidateKeywords(state, storeId = state.manifest.activeStoreId, draftId) {
  const store = selectStore(state, storeId);
  if (!store) return [];
  const draft = draftId ? store.entities.listingDrafts.byId[draftId] : selectListingDraft(state, storeId);
  return draft ? draft.keywordIds.map((id) => store.entities.keywords.byId[id]).filter(Boolean) : [];
}

export function selectListingVersions(state, storeId = state.manifest.activeStoreId, productId) {
  const store = selectStore(state, storeId);
  if (!store) return [];
  const targetProductId = productId || store.scope.selectedProductId;
  return tableValues(store.entities.listingVersions).filter((item) => item.productId === targetProductId).sort((left, right) => Number(right.versionNumber) - Number(left.versionNumber));
}

export function selectSchedules(state, storeId = state.manifest.activeStoreId, options = {}) {
  const store = selectStore(state, storeId);
  if (!store) return [];
  return tableValues(store.entities.schedules)
    .filter((item) => options.includeArchived || item.status !== "archived")
    .map((scheduleItem) => ({ schedule: scheduleItem, lastRun: scheduleItem.lastRunId ? store.entities.scheduleRuns.byId[scheduleItem.lastRunId] : null }));
}

export function selectAuditEntries(state, storeId = state.manifest.activeStoreId) {
  const store = selectStore(state, storeId);
  return store ? tableValues(store.entities.auditEntries).sort((left, right) => String(right.at).localeCompare(String(left.at))) : [];
}

export function selectWorkspaceBadges(state, storeId = state.manifest.activeStoreId) {
  const store = selectStore(state, storeId);
  if (!store) return {};
  const coverage = selectReportCoverage(state, storeId);
  const recommendations = selectRecommendationCounts(state, storeId);
  const readbacks = selectReadbacks(state, storeId);
  const products = selectProducts(state, storeId);
  return {
    today: store.metrics.anomalies + recommendations.pending_approval,
    product: products.filter((item) => !selectProductTargetHealth(state, storeId, item.id).configured).length,
    data: coverage.expected - coverage.available,
    diagnosis: selectDiagnostics(state, storeId).filter((item) => item.severity === "high").length,
    decisions: recommendations.pending_review + recommendations.pending_approval,
    readback: readbacks.filter((item) => item.status !== "verified").length,
    growth: selectKeywords(state, storeId).filter((item) => item.state === "candidate").length,
    system: store.session.status === "ready" ? 0 : 1,
  };
}

export function selectTodaySummary(state, storeId = state.manifest.activeStoreId) {
  const store = selectStore(state, storeId);
  if (!store) return null;
  return {
    storeId,
    product: selectCurrentProduct(state, storeId),
    metrics: store.metrics,
    reports: selectReportCoverage(state, storeId),
    recommendations: selectRecommendationCounts(state, storeId),
    pendingReadbacks: selectReadbacks(state, storeId).filter((item) => item.status !== "verified").length,
    killSwitch: store.autonomy.paused,
  };
}

export function selectEntityDeletePolicy(state, storeId, entityType, entityId) {
  const store = selectStore(state, storeId);
  if (!store) return { mode: "forbidden", reason: "店铺不存在" };
  if (["recommendation", "recommendationRevision", "decision", "execution", "readback", "evidence", "auditEntry", "listingVersion", "scheduleRun"].includes(entityType)) {
    return { mode: "forbidden", reason: "权威与审计对象不可物理删除" };
  }
  if (entityType === "product") return { mode: "archive", reason: "产品可能已被事实、建议或执行引用" };
  if (entityType === "event") return { mode: "void", reason: "运营上下文使用作废记录保留解释链" };
  if (entityType === "schedule") {
    const hasRuns = tableValues(store.entities.scheduleRuns).some((item) => item.scheduleId === entityId);
    return hasRuns ? { mode: "archive", reason: "任务已有运行历史" } : { mode: "hard-delete", reason: "尚无运行记录" };
  }
  if (entityType === "listingDraft") {
    const versioned = tableValues(store.entities.listingVersions).some((item) => item.sourceDraftId === entityId);
    return versioned ? { mode: "archive", reason: "草稿已生成版本" } : { mode: "hard-delete", reason: "未版本化本地草稿" };
  }
  return { mode: "archive", reason: "默认使用可恢复归档" };
}

export const selectors = {
  selectStore,
  selectActiveStore,
  selectRoute,
  selectProducts,
  selectCurrentProduct,
  selectProductTargetHealth,
  selectEvents,
  selectReports,
  selectReportCoverage,
  selectImportEligibility,
  selectDiagnostics,
  selectRecommendationRows,
  selectRecommendationCounts,
  selectDecisionRows,
  selectExecutionQueue,
  selectExecutionEligibility,
  selectReadbacks,
  selectReadbackGate,
  selectKeywords,
  selectListingDraft,
  selectListingCandidateKeywords,
  selectListingVersions,
  selectSchedules,
  selectAuditEntries,
  selectWorkspaceBadges,
  selectTodaySummary,
  selectEntityDeletePolicy,
};

export const repositoryKeys = {
  manifest: MANIFEST_KEY,
  store: STORE_KEY,
};

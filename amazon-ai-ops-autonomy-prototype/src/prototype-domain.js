/**
 * Standalone prototype domain model.
 *
 * This module intentionally contains no React, browser, persistence, credential,
 * or production execution code.  It keeps the prototype deterministic while the
 * UI demonstrates store-isolated analysis, approval, execution gates,
 * experiments, and causal memory.
 */

const MOCK_EPOCH_MS = Date.parse("2026-08-28T01:00:00.000Z");
const RUN_INTERVAL_MS = 4 * 60 * 1000;
const RUN_DURATION_MS = 92 * 1000;
const REQUIRED_REPORT_TYPES = [
  "campaign",
  "ad_group",
  "placement",
  "advertised_product",
  "auto_targeting",
  "keyword",
  "product_targeting",
  "user_search_term",
];

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function roundCurrency(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value ?? null);
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`)
    .join(",")}}`;
}

function stableHash(value) {
  const text = stableSerialize(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").toUpperCase();
}

function storeKey(store) {
  return String(store?.storeId || store?.id || store?.storeKey || "").trim();
}

function storeLabel(store) {
  return String(store?.storeName || store?.name || storeKey(store) || "当前店铺");
}

function selectedProduct(store) {
  const selectedId = firstDefined(store?.selectedProductId, store?.scope?.selectedProductId);
  const products = asArray(store?.products);
  return products.find((product) => product.id === selectedId)
    || products.find((product) => product.selected)
    || products[0]
    || null;
}

function reportCoverage(store) {
  const reports = asArray(store?.reports);
  const expected = Number(reports.length ? REQUIRED_REPORT_TYPES.length : firstDefined(
    store?.reportCoverage?.expected,
    store?.reportCoverage?.total,
    store?.importRun?.reportTypesExpected,
    8,
  ));
  const importedTypes = new Set(reports.filter((report) =>
    ["imported", "validated", "completed", "ready", "success"].includes(String(report?.status))
      && report?.realFileAvailable !== false,
  ).map((report) => String(report?.type || report?.reportType || "")));
  const importedFromReports = REQUIRED_REPORT_TYPES.filter((type) => importedTypes.has(type)).length;
  const imported = Number(reports.length ? importedFromReports : firstDefined(
    store?.reportCoverage?.imported,
    store?.reportCoverage?.completed,
    store?.importRun?.reportTypesImported,
    importedFromReports,
  ));
  return {
    imported: Number.isFinite(imported) ? imported : 0,
    expected: Number.isFinite(expected) ? expected : 8,
  };
}

function normalizedStatus(value) {
  if (value === true) return "ready";
  if (value === false) return "blocked";
  return String(value || "").toLowerCase();
}

function connectionTruth(store) {
  const erpStatus = normalizedStatus(
    firstDefined(
      store?.loginSession?.erpSessionReady,
      store?.currentConnectionSessionState?.erpSessionReady,
      store?.connections?.erp?.status,
      store?.connection?.erp?.status,
      store?.erpSession?.status,
      store?.erp?.status,
      store?.erpStatus,
      store?.session?.status === "ready" ? "ready" : undefined,
    ),
  );
  const adsStatus = normalizedStatus(
    firstDefined(
      store?.loginSession?.adsSessionReady,
      store?.currentConnectionSessionState?.adsSessionReady,
      store?.connections?.ads?.status,
      store?.connection?.ads?.status,
      store?.adsSession?.status,
      store?.ads?.status,
      store?.adsStatus,
    ),
  );
  const identityStatus = normalizedStatus(
    firstDefined(
      store?.loginSession?.adsStoreMatched,
      store?.currentConnectionSessionState?.adsStoreMatched,
      store?.connections?.ads?.storeMatched,
      store?.connection?.ads?.storeMatched,
      store?.adsIdentity?.storeMatched,
      store?.adsIdentity?.status,
      store?.executionAuthority?.storeIdentityVerified,
      store?.storeIdentityVerified,
    ),
  );
  return {
    erpReady: erpStatus === "ready" || erpStatus === "connected" || erpStatus === "verified",
    adsReady: adsStatus === "ready" || adsStatus === "connected" || adsStatus === "verified",
    storeIdentityReady:
      identityStatus === "ready" || identityStatus === "connected" || identityStatus === "verified",
  };
}

export function getConnectionState(store) {
  return cloneValue(connectionTruth(store));
}

function mockTime(sequence, offsetMs = 0) {
  return new Date(MOCK_EPOCH_MS + sequence * RUN_INTERVAL_MS + offsetMs).toISOString();
}

function runId(sequence) {
  return `ANALYSIS-${String(sequence).padStart(3, "0")}`;
}

function experimentId(sequence) {
  return `EXPERIMENT-${String(sequence).padStart(3, "0")}`;
}

function isKeywordBidAction(item) {
  const entityType = String(item?.entityType || item?.objectType || "").toLowerCase();
  const actionType = String(item?.actionType || item?.action || "").toLowerCase();
  const keywordEntity = entityType === "keyword" || entityType === "keyword_bid";
  const bidAction = [
    "bid_change",
    "keyword_bid",
    "keyword_bid_adjustment",
    "adjust_keyword_bid",
  ].includes(actionType);
  return keywordEntity && bidAction;
}

function adObjectProductAsin(item) {
  const explicit = firstDefined(
    item?.productAsin,
    item?.asin,
    item?.authority?.asin,
    item?.evidence?.asin,
  );
  if (explicit) return String(explicit);
  const objectKeyParts = String(item?.objectKey || "").split("|");
  return objectKeyParts.length >= 2 ? objectKeyParts[1] : "";
}

function adObjectBelongsToProduct(item, product) {
  if (!item || !product) return false;
  const explicitProductId = firstDefined(item?.productId, item?.productKey);
  if (explicitProductId && String(explicitProductId) === String(product.id)) return true;
  const asin = adObjectProductAsin(item);
  return Boolean(asin && String(asin) === String(product.asin));
}

function recommendationSource(store, product) {
  return asArray(store?.recommendations).find(
    (item) =>
      isKeywordBidAction(item) &&
      (!adObjectProductAsin(item) || adObjectBelongsToProduct(item, product)) &&
      !["rejected", "executed", "superseded"].includes(String(item?.status || "")),
  );
}

function productAdObjects(store, product = selectedProduct(store)) {
  return asArray(store?.diagnostics).filter((item) => adObjectBelongsToProduct(item, product));
}

function keywordDiagnostic(store, product, selectedObjectKey = null) {
  const candidates = productAdObjects(store, product).filter(
    (item) => String(item?.objectType) === "keyword",
  );
  if (selectedObjectKey) {
    return candidates.find((item) => String(item?.objectKey || item?.id) === String(selectedObjectKey)) || null;
  }
  return candidates[0] || null;
}

function effectivePolicyAuthority(store, runtime) {
  return runtime?.policyAuthority?.managedBySettings === true
    ? runtime.policyAuthority
    : store?.policyAuthority || runtime?.policyAuthority || {};
}

function buildRecommendations(store, run, runtime) {
  const product = selectedProduct(store);
  const policyAuthority = effectivePolicyAuthority(store, runtime);
  const diagnostic = keywordDiagnostic(store, product, runtime?.selectedAdObjectKey);
  if (!diagnostic) return [];
  const source = recommendationSource(store, product);
  const currentValue = roundCurrency(
    firstDefined(source?.currentValue, diagnostic?.cpc, diagnostic?.currentBid, 2.32),
  );
  const rawSuggestion = Number(firstDefined(source?.recommendedValue, diagnostic?.suggestedValue));
  const direction = String(diagnostic?.quantStatus || "").toLowerCase() === "opportunity" ? 1 : -1;
  const safeFloor = roundCurrency(currentValue * 0.9);
  const safeCeiling = roundCurrency(currentValue * 1.1);
  const recommendedValue = Number.isFinite(rawSuggestion)
    ? Math.min(safeCeiling, Math.max(safeFloor, roundCurrency(rawSuggestion)))
    : roundCurrency(currentValue * (direction > 0 ? 1.08 : 0.9));
  const keyword = String(
    firstDefined(
      source?.keyword,
      source?.objectName,
      diagnostic?.keyword,
      diagnostic?.objectName,
      "待复核关键词",
    ),
  ).replace(/^关键词\s*/, "");
  const campaign = String(firstDefined(source?.campaignName, diagnostic?.campaignName, "当前广告活动"));
  const adGroup = String(firstDefined(source?.adGroupName, diagnostic?.adGroupName, "当前广告组"));
  const matchType = String(firstDefined(source?.matchType, diagnostic?.matchType, ""));
  const spend = Number(firstDefined(diagnostic?.spend, 13.91));
  const orders = Number(firstDefined(diagnostic?.orders, 1));

  return [
    {
      id: `${run.id}-REC-01`,
      runId: run.id,
      runLabel: run.label,
      fingerprint: run.fingerprint,
      status: "waiting_approval",
      entityType: "keyword",
      actionType: "keyword_bid_adjustment",
      actionLabel: "调整关键词竞价",
      title: `${keyword} 竞价调整`,
      campaignName: campaign,
      adGroupName: adGroup,
      objectName: keyword,
      keyword,
      storeLabel: storeLabel(store),
      productLabel: String(product?.title || product?.asin || store?.scope?.productLabel || "当前产品"),
      productKey: String(product?.id || product?.asin || ""),
      productAsin: String(product?.asin || ""),
      storeKey: storeKey(store),
      adObjectKey: String(diagnostic?.objectKey || diagnostic?.id || ""),
      objectPath: `${campaign} > ${adGroup} > ${keyword} · ${matchType}`,
      objectCanonical: Boolean(diagnostic?.objectKey && campaign && adGroup && keyword && matchType),
      matchType,
      sourceRowCount: 1,
      proofHash: run.fingerprint,
      currentValue,
      recommendedValue,
      currency: String(store?.currencyCode || "USD"),
      changeLimit: "单次变更不超过 10%",
      risk: "low",
      policy: {
        boundary: "关键词竞价单次变更不超过 10%",
        versionLabel: String(policyAuthority.versionLabel || ""),
        eligible: policyAuthority.status === "enabled",
      },
      reason:
        source?.reason ||
        `该关键词当前花费 ${roundCurrency(spend)}，订单 ${orders}；建议在安全边界内小幅调整并继续观察。`,
      evidence: asArray(source?.evidence).length
        ? asArray(source.evidence).slice(0, 3).map(String)
        : [
            `当前花费 ${roundCurrency(spend)}，订单 ${orders}`,
            `当前竞价 ${currentValue}，建议竞价 ${recommendedValue}`,
            "建议变更幅度未超过 10%",
          ],
      provenance: {
        analysisRun: run.label,
        completedAt: run.completedAt,
        dataWindow: run.dataWindow,
        reportCoverage: run.reportCoverage,
        policyVersion: String(policyAuthority.versionLabel || ""),
        currentValueObservedAt: run.completedAt,
      },
      createdAt: run.completedAt,
    },
  ];
}

function runtimeForStore(runtime, store) {
  if (!runtime || typeof runtime !== "object") throw new TypeError("必须提供店铺运行状态");
  const expected = storeKey(store);
  if (!expected) throw new TypeError("店铺缺少可识别的名称或编号");
  if (runtime.storeKey !== expected) {
    throw new RangeError("运行状态与当前店铺不一致，已阻止跨店铺复用");
  }
}

export const MODULES = deepFreeze([
  {
    id: "today",
    label: "今日任务",
    description: "只显示现在要做什么、做到哪里以及下一步。",
    subviews: [
      { id: "overview", routeId: "today:overview", label: "任务总览", legacyRoute: "today:overview" },
    ],
  },
  {
    id: "assets",
    label: "运营资产",
    description: "集中管理产品、广告对象和八类报表。",
    subviews: [
      { id: "products", routeId: "assets:products", label: "产品" },
      { id: "ad-objects", routeId: "assets:ad-objects", label: "广告对象" },
      { id: "collection", routeId: "assets:collection", label: "数据采集" },
    ],
  },
  {
    id: "decisions",
    label: "决策中心",
    description: "查看每次分析、建议来源与人工审批。",
    subviews: [
      { id: "runs", routeId: "decisions:runs", label: "分析记录" },
      { id: "recommendations", routeId: "decisions:recommendations", label: "分析建议" },
      { id: "approval", routeId: "decisions:approval", label: "审批" },
    ],
  },
  {
    id: "execution",
    label: "执行与实验",
    description: "在安全门内执行，并用经营实验验证效果。",
    subviews: [
      { id: "live", routeId: "execution:live", label: "实时执行" },
      { id: "experiments", routeId: "execution:experiments", label: "经营实验" },
    ],
  },
  {
    id: "memory",
    label: "经营记忆",
    description: "沉淀可复用的因果线索和不可变操作记录。",
    subviews: [
      { id: "causal", routeId: "memory:causal", label: "因果记忆" },
      { id: "ledger", routeId: "memory:ledger", label: "操作记录" },
    ],
  },
  {
    id: "settings",
    label: "系统设置",
    description: "管理店铺、连接、策略和自动化边界。",
    subviews: [
      { id: "stores", routeId: "settings:stores", label: "店铺" },
      { id: "connections", routeId: "settings:connections", label: "连接" },
      { id: "policies", routeId: "settings:policies", label: "策略" },
      { id: "automation", routeId: "settings:automation", label: "自动化" },
    ],
  },
]);

export const AUTONOMY_MODES = deepFreeze([
  {
    id: "manual",
    label: "人工审批",
    shortLabel: "人工",
    summary: "AI 只分析和给建议，所有广告变更都由你确认。",
    executionRule: "每一项变更均需本店人工批准",
    storeScoped: true,
  },
  {
    id: "semi",
    label: "半自动",
    shortLabel: "半自动",
    summary: "AI 自动完成采集与分析，广告变更仍等待你批准。",
    executionRule: "自动准备建议，批准后才可执行",
    storeScoped: true,
  },
  {
    id: "auto",
    label: "策略内自动",
    shortLabel: "策略自动",
    summary: "只有已启用策略明确允许的低风险关键词竞价调整可自动执行。",
    executionRule: "超出策略、身份异常或证据不足立即阻断",
    storeScoped: true,
  },
]);

export const RUN_PHASES = deepFreeze([
  { id: "queued", label: "已创建", description: "已锁定当前店铺、产品和数据窗口。", progress: 0 },
  { id: "facts", label: "核验事实", description: "检查八类报表完整性与指标口径。", progress: 25 },
  { id: "analysis", label: "分析", description: "识别广告对象的风险与机会。", progress: 55 },
  { id: "recommend", label: "生成建议", description: "仅生成 V1 允许的关键词竞价建议。", progress: 80 },
  { id: "complete", label: "已完成", description: "发布结果摘要、来源和下一步。", progress: 100 },
]);

export const INTERNAL_CAPABILITIES = deepFreeze([
  { id: "connection.verify", label: "连接与店铺身份核验", ownerPhase: "facts", visibility: "diagnostics_only" },
  { id: "reports.collect", label: "八类报表采集", ownerPhase: "facts", visibility: "diagnostics_only" },
  { id: "reports.validate", label: "报表完整性与口径检查", ownerPhase: "facts", visibility: "diagnostics_only" },
  { id: "ads.quantify", label: "广告对象量化", ownerPhase: "analysis", visibility: "diagnostics_only" },
  { id: "ads.diagnose", label: "风险与机会诊断", ownerPhase: "analysis", visibility: "diagnostics_only" },
  { id: "recommendation.compose", label: "建议与证据编排", ownerPhase: "recommend", visibility: "diagnostics_only" },
  { id: "approval.bind", label: "本店审批绑定", ownerPhase: "recommend", visibility: "diagnostics_only" },
  { id: "execution.orchestrate", label: "可见广告页执行编排", ownerPhase: "complete", visibility: "diagnostics_only" },
  { id: "readback.verify", label: "前后值与刷新回读", ownerPhase: "complete", visibility: "diagnostics_only" },
  { id: "experiment.evaluate", label: "实验守护与效果评估", ownerPhase: "complete", visibility: "diagnostics_only" },
  { id: "memory.derive", label: "因果线索沉淀", ownerPhase: "complete", visibility: "diagnostics_only" },
]);

export function createAnalysisFingerprint(store) {
  const product = selectedProduct(store);
  const coverage = reportCoverage(store);
  const reportFacts = asArray(store?.reports)
    .map((report) => ({
      type: String(report?.type || report?.reportType || report?.label || ""),
      status: String(report?.status || ""),
      rows: Number(firstDefined(report?.importedRows, report?.rows, 0)),
    }))
    .sort((left, right) => left.type.localeCompare(right.type));
  const diagnosticFacts = asArray(store?.diagnostics)
    .map((item) => ({
      type: String(item?.objectType || ""),
      name: String(item?.objectName || ""),
      spend: Number(firstDefined(item?.spend, 0)),
      orders: Number(firstDefined(item?.orders, 0)),
      acos: firstDefined(item?.acos, null),
    }))
    .sort((left, right) => `${left.type}:${left.name}`.localeCompare(`${right.type}:${right.name}`));
  const payload = {
    store: storeKey(store),
    marketplace: String(store?.marketplaceCode || store?.marketplace || "US"),
    currency: String(store?.currencyCode || "USD"),
    product: String(product?.asin || product?.sku || store?.scope?.asin || "all-products"),
    dateFrom: String(store?.scope?.dateFrom || store?.dateFrom || ""),
    dateTo: String(store?.scope?.dateTo || store?.dateTo || ""),
    sourceBatch: String(store?.scope?.batchId || store?.importRun?.id || store?.dataBatchId || ""),
    coverage,
    reports: reportFacts,
    diagnostics: diagnosticFacts,
  };
  return `AN-${stableHash(payload)}`;
}

export function resolveCurrentRun(runtime) {
  const activeId = firstDefined(runtime?.activeRunId, runtime?.activeAnalysisRunId);
  if (!activeId) return null;
  return asArray(runtime?.analysisRuns).find(
    (run) => run.id === activeId && run.isActive === true && run.status !== "superseded",
  ) || null;
}

export function selectAdObject(runtime, store, objectKey) {
  runtimeForStore(runtime, store);
  const product = selectedProduct(store);
  const candidate = productAdObjects(store, product).find(
    (item) => String(item?.objectKey || item?.id) === String(objectKey || ""),
  );
  if (!candidate) {
    return {
      ...cloneValue(runtime),
      feedback: {
        tone: "danger",
        title: "广告对象不可用",
        message: "该对象不属于当前产品，已阻止跨产品选择。",
        nextAction: "重新选择当前产品对象",
        nextRouteId: "assets:ad-objects",
        at: mockTime(Number(runtime.runSequence || 0), RUN_DURATION_MS),
      },
    };
  }
  const key = String(candidate.objectKey || candidate.id);
  return {
    ...cloneValue(runtime),
    selectedAdObjectKey: key,
    verifiedAdObjectKey: runtime.verifiedAdObjectKey === key ? key : null,
    feedback: {
      tone: "info",
      title: "已选择广告对象",
      message: "对象已绑定当前产品；执行前仍需核验 Ads 页面身份与当前值。",
      nextAction: "核验当前对象",
      nextRouteId: "assets:ad-objects",
      at: mockTime(Number(runtime.runSequence || 0), RUN_DURATION_MS),
    },
  };
}

export function verifyAdObject(runtime, store, objectKey) {
  const selected = selectAdObject(runtime, store, objectKey);
  const connection = connectionTruth(store);
  if (
    selected.selectedAdObjectKey !== String(objectKey || "")
    || !connection.adsReady
    || !connection.storeIdentityReady
    || store?.adsIdentity?.canonicalObjectReady !== true
  ) {
    return {
      ...selected,
      verifiedAdObjectKey: null,
      feedback: {
        tone: "danger",
        title: "广告对象核验失败",
        message: "Ads 会话、当前店铺身份或页面对象尚未确认；真实执行继续阻断。",
        nextAction: "重新识别 Ads 并核验对象",
        nextRouteId: "settings:connections",
        at: mockTime(Number(runtime.runSequence || 0), RUN_DURATION_MS),
      },
    };
  }
  return {
    ...selected,
    verifiedAdObjectKey: selected.selectedAdObjectKey,
    feedback: {
      tone: "success",
      title: "广告对象已核验",
      message: "当前店铺、产品、广告对象与页面前值已绑定；提交执行时会再次复核。",
      nextAction: "查看本次建议",
      nextRouteId: "decisions:recommendations",
      at: mockTime(Number(runtime.runSequence || 0), RUN_DURATION_MS),
    },
  };
}

export function startAnalysisRun(runtime, store) {
  runtimeForStore(runtime, store);
  const sequence = Number(runtime.runSequence || 0) + 1;
  const fingerprint = createAnalysisFingerprint(store);
  const coverage = reportCoverage(store);
  const startedAt = mockTime(sequence);
  const isComplete = coverage.imported === 8 && coverage.expected === 8;
  const product = selectedProduct(store);
  const selectedDiagnostic = keywordDiagnostic(store, product, runtime.selectedAdObjectKey)
    || keywordDiagnostic(store, product);
  const nextSelectedAdObjectKey = selectedDiagnostic
    ? String(selectedDiagnostic.objectKey || selectedDiagnostic.id)
    : null;
  const nextRuns = asArray(runtime.analysisRuns).map((run) => {
    const sameFingerprint = run.fingerprint === fingerprint;
    return {
      ...cloneValue(run),
      isActive: false,
      status: sameFingerprint ? "superseded" : run.status,
      supersededBy: sameFingerprint ? runId(sequence) : run.supersededBy || null,
      recommendations: sameFingerprint
        ? asArray(run.recommendations).map((item) => ({ ...item, status: "superseded" }))
        : asArray(run.recommendations).map(cloneValue),
    };
  });
  const run = {
    id: runId(sequence),
    label: `第 ${sequence} 次分析`,
    sequence,
    fingerprint,
    status: isComplete ? "running" : "blocked",
    phaseId: isComplete ? "analysis" : "queued",
    phaseLabel: isComplete ? "分析" : "等待完整数据",
    progress: isComplete ? 55 : 0,
    isActive: true,
    storeLabel: storeLabel(store),
    productLabel: String(product?.title || store?.scope?.productLabel || "当前产品"),
    productKey: String(product?.id || product?.asin || ""),
    productAsin: String(product?.asin || ""),
    dataWindow: `${store?.scope?.dateFrom || "—"} 至 ${store?.scope?.dateTo || "—"}`,
    reportCoverage: `${coverage.imported}/${coverage.expected}`,
    startedAt,
    completedAt: null,
    result: null,
    recommendations: [],
    supersededBy: null,
  };
  return {
    ...cloneValue(runtime),
    runSequence: sequence,
    activeRunId: run.id,
    selectedAdObjectKey: nextSelectedAdObjectKey,
    verifiedAdObjectKey:
      runtime.verifiedAdObjectKey === nextSelectedAdObjectKey ? nextSelectedAdObjectKey : null,
    analysisRuns: [...nextRuns, run],
    activeRecommendations: [],
    feedback: isComplete
      ? {
          tone: "info",
          title: `${run.label}正在运行`,
          message: "正在核验 8/8 类报表，完成后会显示结果与建议入口。",
          nextRouteId: "decisions:runs",
          at: startedAt,
        }
      : {
          tone: "danger",
          title: `${run.label}未能开始`,
          message: `当前仅有 ${coverage.imported}/${coverage.expected} 类报表，补齐 8/8 后可重新运行。`,
          nextAction: "前往数据采集",
          nextRouteId: "assets:collection",
          at: startedAt,
        },
  };
}

export function completeAnalysisRun(runtime, store) {
  runtimeForStore(runtime, store);
  const activeRun = asArray(runtime.analysisRuns).find((run) => run.id === runtime.activeRunId);
  if (!activeRun) {
    return {
      ...cloneValue(runtime),
      feedback: {
        tone: "danger",
        title: "没有可完成的分析",
        message: "请先创建一次分析运行。",
        nextAction: "运行分析",
        nextRouteId: "today:overview",
        at: mockTime(Number(runtime.runSequence || 0)),
      },
    };
  }
  const coverage = reportCoverage(store);
  if (coverage.imported !== 8 || coverage.expected !== 8 || activeRun.status === "blocked") {
    const at = mockTime(activeRun.sequence, RUN_DURATION_MS);
    return {
      ...cloneValue(runtime),
      analysisRuns: asArray(runtime.analysisRuns).map((run) =>
        run.id === activeRun.id
          ? { ...cloneValue(run), status: "blocked", phaseId: "facts", phaseLabel: "数据不完整", progress: 25 }
          : cloneValue(run),
      ),
      activeRecommendations: [],
      feedback: {
        tone: "danger",
        title: `${activeRun.label}已阻断`,
        message: `八类报表未完整入库（${coverage.imported}/${coverage.expected}），没有发布分析建议。`,
        nextAction: "补齐报表",
        nextRouteId: "assets:collection",
        at,
      },
    };
  }
  if (activeRun.status === "completed") return cloneValue(runtime);

  const completedAt = mockTime(activeRun.sequence, RUN_DURATION_MS);
  const completedRun = {
    ...cloneValue(activeRun),
    status: "completed",
    phaseId: "complete",
    phaseLabel: "已完成",
    progress: 100,
    completedAt,
  };
  const generatedRecommendations = buildRecommendations(store, completedRun, runtime);
  const policyAuto = runtime.autonomyMode === "auto" && effectivePolicyAuthority(store, runtime).status === "enabled";
  const recommendations = generatedRecommendations.map((item) => policyAuto ? { ...item, status: "approved" } : item);
  completedRun.recommendations = recommendations.map(cloneValue);
  completedRun.result = {
    title: "分析完成",
    summary: `已核验 8/8 类报表并生成 ${recommendations.length} 条可复核建议。`,
    recommendationCount: recommendations.length,
    nextStep: "查看建议来源并决定是否批准",
    nextRouteId: "decisions:recommendations",
  };
  return {
    ...cloneValue(runtime),
    activeRunId: completedRun.id,
    latestCompletedRunId: completedRun.id,
    analysisRuns: asArray(runtime.analysisRuns).map((run) =>
      run.id === completedRun.id ? completedRun : cloneValue(run),
    ),
    activeRecommendations: recommendations.map(cloneValue),
    approvals: policyAuto
      ? [
          ...asArray(runtime.approvals).map(cloneValue),
          ...recommendations.map((item) => ({
            recommendationId: item.id,
            runId: completedRun.id,
            status: "approved",
            actor: "已启用策略",
            decidedAt: completedAt,
          })),
        ]
      : asArray(runtime.approvals).map(cloneValue),
    feedback: {
      tone: "success",
      title: `${completedRun.label}已完成`,
      message: recommendations.length
        ? `已核验 8/8 类报表，生成 ${recommendations.length} 条建议；旧版建议不会叠加${policyAuto ? "，策略内动作已签发许可" : ""}。`
        : "已核验 8/8 类报表，但没有找到当前产品的规范关键词广告对象；未借用其他产品数据生成建议。",
      nextAction: recommendations.length ? "查看本次建议" : "选择并核验广告对象",
      nextRouteId: recommendations.length ? "decisions:recommendations" : "assets:ad-objects",
      runId: completedRun.id,
      at: completedAt,
    },
  };
}

export function createStoreRuntime(store) {
  const key = storeKey(store);
  if (!key) throw new TypeError("店铺缺少可识别的名称或编号");
  const rawMode = String(firstDefined(store?.autonomy?.mode, store?.mode, "semi"));
  const autonomyMode = rawMode === "review" ? "manual" : ["manual", "semi", "auto"].includes(rawMode) ? rawMode : "semi";
  const initialProduct = selectedProduct(store);
  const initialDiagnostic = keywordDiagnostic(store, initialProduct);
  const initialObjectKey = initialDiagnostic ? String(initialDiagnostic.objectKey || initialDiagnostic.id) : null;
  const initialConnection = connectionTruth(store);
  const baseRuntime = {
    schemaVersion: 1,
    storeKey: key,
    storeLabel: storeLabel(store),
    autonomyMode,
    runSequence: 0,
    activeRunId: null,
    latestCompletedRunId: null,
    analysisRuns: [],
    activeRecommendations: [],
    selectedAdObjectKey: initialObjectKey,
    verifiedAdObjectKey:
      initialObjectKey
      && initialConnection.adsReady
      && initialConnection.storeIdentityReady
      && store?.adsIdentity?.canonicalObjectReady === true
        ? initialObjectKey
        : null,
    approvals: [],
    policyAuthority: cloneValue(store?.policyAuthority || {}),
    systemConfig: {
      killSwitch: false,
    },
    executionRecords: [],
    experiments: [],
    causalMemories: [],
    feedback: null,
  };
  const started = startAnalysisRun(baseRuntime, store);
  const completed = completeAnalysisRun(started, store);
  return {
    ...completed,
    causalMemories: deriveCausalMemories(store, completed),
  };
}

export function invalidateAnalysisScope(runtime, store, reason = "运营范围已变化") {
  runtimeForStore(runtime, store);
  return {
    ...cloneValue(runtime),
    storeLabel: storeLabel(store),
    activeRunId: null,
    activeRecommendations: [],
    selectedAdObjectKey: null,
    verifiedAdObjectKey: null,
    analysisRuns: asArray(runtime.analysisRuns).map((run) => ({
      ...cloneValue(run),
      isActive: false,
      recommendations: asArray(run.recommendations).map((item) =>
        ["waiting_approval", "pending_approval", "approved"].includes(item.status)
          ? { ...cloneValue(item), status: "superseded" }
          : cloneValue(item),
      ),
    })),
    feedback: {
      tone: "info",
      title: reason,
      message: "历史记录已保留；旧建议已退出当前待办，请基于新范围运行分析。",
      nextAction: "运行新分析",
      nextRouteId: "decisions:runs",
      at: mockTime(Number(runtime.runSequence || 0), RUN_DURATION_MS),
    },
  };
}

export function getExecutionGate(store, runtime) {
  runtimeForStore(runtime, store);
  const coverage = reportCoverage(store);
  const connection = connectionTruth(store);
  const activeRun = asArray(runtime.analysisRuns).find((run) => run.id === runtime.activeRunId);
  const recommendations = asArray(runtime.activeRecommendations).filter(
    (item) => item.runId === activeRun?.id && item.status !== "superseded",
  );
  const approvedIds = new Set(asArray(runtime.approvals)
    .filter((approval) => approval.status === "approved" && approval.runId === activeRun?.id)
    .map((approval) => approval.recommendationId));
  const executableRecommendations = recommendations.filter((item) => item.status === "approved" && approvedIds.has(item.id));
  const product = selectedProduct(store);
  const policy = effectivePolicyAuthority(store, runtime);
  const policyReady = policy.status === "enabled" && Boolean(policy.versionLabel);
  const killSwitchOpen = runtime?.systemConfig?.killSwitch !== true;
  const recommendationAuthorityReady = recommendations.length > 0 && recommendations.every((item) =>
    item.storeKey === storeKey(store)
      && item.productKey === String(product?.id || product?.asin || "")
      && item.productAsin === String(product?.asin || "")
      && item.adObjectKey === runtime.selectedAdObjectKey
      && item.adObjectKey === runtime.verifiedAdObjectKey
      && item.objectCanonical === true
      && Boolean(item.matchType)
      && item.sourceRowCount === 1
      && item.proofHash === activeRun?.fingerprint
      && item.provenance?.policyVersion === policy.versionLabel
      && Boolean(item.provenance?.currentValueObservedAt),
  );
  const changeWithinLimit = recommendations.length > 0 && recommendations.every((item) => {
    const before = Number(item.currentValue);
    const after = Number(item.recommendedValue);
    if (!Number.isFinite(before) || before <= 0 || !Number.isFinite(after)) return false;
    return Math.abs(after - before) / before <= 0.100001;
  });
  const checks = [
    {
      id: "reports",
      label: "八类报表完整",
      passed: coverage.imported === 8 && coverage.expected === 8,
      reason:
        coverage.imported === 8 && coverage.expected === 8
          ? "8/8 类报表已入库"
          : `仅有 ${coverage.imported}/${coverage.expected} 类报表`,
      nextAction: "前往数据采集补齐报表",
      nextRouteId: "assets:collection",
    },
    {
      id: "ads-session",
      label: "Ads 连接可用",
      passed: connection.adsReady,
      reason: connection.adsReady ? "Ads 会话当前可用" : "Ads 会话尚未确认或已失效",
      nextAction: "重新识别 Ads 连接",
      nextRouteId: "settings:connections",
    },
    {
      id: "store-identity",
      label: "当前店铺身份一致",
      passed: connection.storeIdentityReady,
      reason: connection.storeIdentityReady ? "广告账户与当前店铺一致" : "尚未确认广告账户属于当前店铺",
      nextAction: "在 Ads 页面确认当前店铺",
      nextRouteId: "settings:connections",
    },
    {
      id: "analysis",
      label: "本次分析有效",
      passed: Boolean(activeRun && activeRun.status === "completed"),
      reason: activeRun?.status === "completed" ? `${activeRun.label}已完成` : "没有已完成的当前分析",
      nextAction: "运行并完成分析",
      nextRouteId: "decisions:runs",
    },
    {
      id: "kill-switch",
      label: "执行总开关已打开",
      passed: killSwitchOpen,
      reason: killSwitchOpen ? "当前店铺执行总开关已打开" : "当前店铺执行总开关已关闭",
      nextAction: "检查当前店铺系统配置",
      nextRouteId: "settings:automation",
    },
    {
      id: "policy",
      label: "启用策略版本有效",
      passed: policyReady,
      reason: policyReady ? `${policy.versionLabel}已启用` : "没有可用于当前店铺的已启用策略版本",
      nextAction: "检查策略版本",
      nextRouteId: "settings:policies",
    },
    {
      id: "authority",
      label: "产品、对象与前值已绑定",
      passed: recommendationAuthorityReady && policy.currentValueFresh === true && store?.adsIdentity?.canonicalObjectReady === true,
      reason: recommendationAuthorityReady && policy.currentValueFresh === true && store?.adsIdentity?.canonicalObjectReady === true
        ? "当前产品、规范广告对象、策略版本和页面前值已绑定"
        : "当前产品的广告对象尚未明确选择并核验，或策略版本与页面前值已失效",
      nextAction: "重新核验广告对象",
      nextRouteId: "assets:ad-objects",
    },
    {
      id: "action-scope",
      label: "动作符合 V1 范围",
      passed: recommendations.length > 0 && recommendations.every(isKeywordBidAction),
      reason:
        recommendations.length > 0 && recommendations.every(isKeywordBidAction)
          ? "仅包含关键词竞价调整"
          : "V1 只允许调整关键词竞价",
      nextAction: "移除不支持的动作",
      nextRouteId: "decisions:recommendations",
    },
    {
      id: "approval",
      label: "已取得本店批准",
      passed: recommendations.length > 0 && recommendations.every((item) => approvedIds.has(item.id)),
      reason:
        recommendations.length > 0 && recommendations.every((item) => approvedIds.has(item.id))
          ? "本次建议均已批准"
          : "仍有建议等待当前店铺批准",
      nextAction: "前往审批",
      nextRouteId: "decisions:approval",
    },
    {
      id: "change-limit",
      label: "变更幅度符合上限",
      passed: changeWithinLimit,
      reason: changeWithinLimit ? "单次关键词竞价变更不超过 10%" : "建议竞价变更超过 10% 或缺少有效前值",
      nextAction: "返回建议调整幅度",
      nextRouteId: "decisions:recommendations",
    },
    {
      id: "action-ready",
      label: "存在待执行动作",
      passed: executableRecommendations.length > 0,
      reason: executableRecommendations.length > 0 ? "已批准动作正在等待执行" : "当前没有待执行的已批准建议",
      nextAction: "查看本次建议",
      nextRouteId: "decisions:recommendations",
    },
  ];
  const failed = checks.filter((check) => !check.passed);
  return {
    allowed: failed.length === 0,
    status: failed.length === 0 ? "ready" : "blocked",
    title: failed.length === 0 ? "可以进入实时执行" : "真实广告执行已阻断",
    reason: failed.length === 0 ? "所有安全条件均已满足。" : failed[0].reason,
    nextAction: failed.length === 0 ? "打开实时执行" : failed[0].nextAction,
    nextRouteId: failed.length === 0 ? "execution:live" : failed[0].nextRouteId,
    checks,
    blockedReasons: failed.map((check) => check.reason),
    actionLabel: "调整关键词竞价",
  };
}

function executionAuthoritySnapshot(store, runtime) {
  const run = resolveCurrentRun(runtime);
  const product = selectedProduct(store);
  const recommendationIds = asArray(runtime.activeRecommendations)
    .filter((item) => item.runId === run?.id && item.status === "approved")
    .map((item) => String(item.id))
    .sort();
  return {
    storeKey: storeKey(store),
    productKey: String(product?.id || product?.asin || ""),
    productAsin: String(product?.asin || ""),
    runId: String(run?.id || ""),
    runFingerprint: String(run?.fingerprint || ""),
    adObjectKey: String(runtime.verifiedAdObjectKey || ""),
    recommendationIds,
  };
}

export function captureExecutionAuthority(store, runtime) {
  const gate = getExecutionGate(store, runtime);
  return gate.allowed ? executionAuthoritySnapshot(store, runtime) : null;
}

export function commitExecution(store, runtime, expectedAuthority) {
  runtimeForStore(runtime, store);
  const unchangedRuntime = cloneValue(runtime);
  if (!expectedAuthority) {
    return { ok: false, runtime: unchangedRuntime, reason: "缺少本次执行的安全门快照，请重新核验后再试。" };
  }
  const gate = getExecutionGate(store, runtime);
  if (!gate.allowed) {
    const firstFailure = gate.checks.find((check) => !check.passed);
    return {
      ok: false,
      runtime: unchangedRuntime,
      reason: firstFailure?.id === "analysis"
        ? `分析运行已失效：${gate.reason}`
        : gate.reason || "提交时安全条件已变化，执行已停止。",
      nextAction: gate.nextAction,
      nextRouteId: gate.nextRouteId,
    };
  }
  const liveAuthority = executionAuthoritySnapshot(store, runtime);
  if (stableSerialize(liveAuthority) !== stableSerialize(expectedAuthority)) {
    return {
      ok: false,
      runtime: unchangedRuntime,
      reason: "分析范围、产品、广告对象或运行版本已变化，执行已停止。",
      nextAction: "重新核验当前分析与广告对象",
      nextRouteId: "decisions:runs",
    };
  }
  const existingIds = new Set(asArray(runtime.executionRecords).map((item) => item.recommendationId));
  const approvals = new Set(asArray(runtime.approvals)
    .filter((item) => item.runId === liveAuthority.runId && item.status === "approved")
    .map((item) => item.recommendationId));
  const approved = asArray(runtime.activeRecommendations).filter(
    (item) => item.runId === liveAuthority.runId
      && item.status === "approved"
      && approvals.has(item.id)
      && !existingIds.has(item.id),
  );
  if (!approved.length) {
    return { ok: false, runtime: unchangedRuntime, reason: "当前没有仍然有效且未执行的批准动作。" };
  }
  const executedAt = mockTime(Number(runtime.runSequence || 0), RUN_DURATION_MS + 4 * 60 * 1000);
  const executionRecords = approved.map((item) => ({
    recommendationId: item.id,
    runId: item.runId,
    storeKey: item.storeKey,
    productKey: item.productKey,
    productLabel: item.productLabel,
    productAsin: item.productAsin,
    adObjectKey: item.adObjectKey,
    authority: cloneValue(liveAuthority),
    status: "awaiting_readback",
    action: "调整关键词竞价",
    objectLabel: item.objectPath,
    beforeValue: item.currentValue,
    intendedValue: item.recommendedValue,
    savedValue: item.recommendedValue,
    reloadValue: null,
    executedAt,
  }));
  const approvedIds = new Set(approved.map((item) => item.id));
  const nextRuntime = {
    ...cloneValue(runtime),
    executionRecords: [...asArray(runtime.executionRecords).map(cloneValue), ...executionRecords],
    activeRecommendations: asArray(runtime.activeRecommendations).map((item) =>
      approvedIds.has(item.id) ? { ...cloneValue(item), status: "executed" } : cloneValue(item),
    ),
    analysisRuns: asArray(runtime.analysisRuns).map((run) => ({
      ...cloneValue(run),
      recommendations: asArray(run.recommendations).map((item) =>
        approvedIds.has(item.id) ? { ...cloneValue(item), status: "executed" } : cloneValue(item),
      ),
    })),
    feedback: {
      tone: "success",
      title: "模拟保存已完成",
      message: "动作已进入刷新回读；这仍是原型模拟，没有产生真实 Amazon Ads 写入。",
      nextAction: "刷新并回读",
      nextRouteId: "execution:live",
      at: executedAt,
    },
  };
  return { ok: true, runtime: nextRuntime, records: executionRecords };
}

export function verifyExecutionReadback(store, runtime, observedValues = {}) {
  runtimeForStore(runtime, store);
  const connection = connectionTruth(store);
  const product = selectedProduct(store);
  const awaiting = asArray(runtime.executionRecords).filter((record) => record.status === "awaiting_readback");
  if (!awaiting.length) {
    return { ok: false, runtime: cloneValue(runtime), reason: "当前没有等待刷新回读的动作。" };
  }
  if (!connection.adsReady || !connection.storeIdentityReady) {
    return {
      ok: false,
      runtime: cloneValue(runtime),
      reason: "刷新回读前 Ads 会话或店铺身份已变化，请重新识别 Ads。",
      nextAction: "重新识别 Ads",
      nextRouteId: "settings:connections",
    };
  }
  let mismatch = false;
  const readbackAt = mockTime(Number(runtime.runSequence || 0), RUN_DURATION_MS + 6 * 60 * 1000);
  const records = asArray(runtime.executionRecords).map((record) => {
    if (record.status !== "awaiting_readback") return cloneValue(record);
    const observed = Number(observedValues[record.recommendationId]);
    const sameAuthority = record.storeKey === storeKey(store)
      && record.productKey === String(product?.id || product?.asin || "")
      && record.adObjectKey === runtime.verifiedAdObjectKey;
    const valueMatches = Number.isFinite(observed)
      && Math.abs(observed - Number(record.savedValue)) < 0.005;
    if (!sameAuthority || !valueMatches) mismatch = true;
    return {
      ...cloneValue(record),
      status: sameAuthority && valueMatches ? "verified" : "readback_failed",
      reloadValue: Number.isFinite(observed) ? roundCurrency(observed) : null,
      readbackAt,
      readbackReason: sameAuthority && valueMatches
        ? "刷新值与保存值一致"
        : !sameAuthority
          ? "店铺、产品或广告对象身份发生变化"
          : "刷新值与保存值不一致",
    };
  });
  const next = {
    ...cloneValue(runtime),
    executionRecords: records,
    feedback: mismatch
      ? {
          tone: "danger",
          title: "刷新回读未通过",
          message: "刷新值与保存值不一致，后续执行已停止；请人工接管并重新核验对象。",
          nextAction: "重新核验广告对象",
          nextRouteId: "assets:ad-objects",
          at: readbackAt,
        }
      : {
          tone: "success",
          title: "刷新回读已通过",
          message: "页面保存值与独立刷新观察值一致，证据已进入当前店铺经营记忆。",
          nextAction: "查看因果记忆",
          nextRouteId: "memory:causal",
          at: readbackAt,
        },
  };
  next.causalMemories = deriveCausalMemories(store, next);
  return {
    ok: !mismatch,
    runtime: next,
    reason: mismatch ? "刷新值与保存值不一致，已停止后续执行。" : "刷新值与保存值一致。",
  };
}

export function createExperiment(runtime, draft = {}) {
  if (!runtime || typeof runtime !== "object") throw new TypeError("必须提供店铺运行状态");
  const sequence = asArray(runtime.experiments).length + 1;
  const activeRun = asArray(runtime.analysisRuns).find((run) => run.id === runtime.activeRunId);
  const createdAt = mockTime(Number(runtime.runSequence || 0), RUN_DURATION_MS + sequence * 60 * 1000);
  const experiment = {
    id: experimentId(sequence),
    label: `经营实验 ${sequence}`,
    name: String(draft.name || "关键词竞价调整效果验证"),
    status: "draft",
    storeLabel: runtime.storeLabel,
    analysisRunId: activeRun?.id || null,
    analysisRunLabel: activeRun?.label || "尚未关联分析",
    hypothesis: String(draft.hypothesis || "在不损害订单量的前提下降低无效广告花费。"),
    primaryMetric: String(draft.primaryMetric || "ACOS"),
    target: String(draft.target || "较基线改善至少 10%"),
    productKey: String(draft.productKey || activeRun?.productKey || ""),
    productLabel: String(draft.productLabel || "当前产品"),
    adObjectKey: String(draft.adObjectKey || runtime.selectedAdObjectKey || ""),
    adObjectLabel: String(draft.adObjectLabel || "待选择关键词"),
    recommendationId: draft.recommendationId || null,
    observationWindow: String(draft.observationWindow || "7 天"),
    guardrails: asArray(draft.guardrails).length
      ? asArray(draft.guardrails).map(String)
      : ["广告订单下降不超过 15%", "单次竞价变更不超过 10%"],
    createdAt,
    observationRound: 0,
    observationRounds: [],
  };
  return {
    ...cloneValue(runtime),
    experiments: [...asArray(runtime.experiments).map(cloneValue), experiment],
    feedback: {
      tone: "success",
      title: `${experiment.label}已创建`,
      message: "实验草稿已保存；启动前仍会检查批准、Ads 身份和守护指标。",
      nextAction: "完善实验并启动",
      nextRouteId: "execution:experiments",
      at: createdAt,
    },
  };
}

export function transitionExperiment(runtime, store, experimentIdValue, action, details = {}) {
  runtimeForStore(runtime, store);
  const experiment = asArray(runtime.experiments).find((item) => item.id === experimentIdValue);
  if (!experiment) {
    return { ok: false, runtime: cloneValue(runtime), reason: "未找到当前店铺的经营实验。" };
  }
  const product = selectedProduct(store);
  const now = mockTime(Number(runtime.runSequence || 0), RUN_DURATION_MS + 8 * 60 * 1000);
  const startRequested = action === "start" || action === "restart";
  if (startRequested) {
    const allowedStatus = action === "restart"
      ? ["completed", "stopped", "paused"]
      : ["draft", "paused"];
    if (!allowedStatus.includes(experiment.status)) {
      return { ok: false, runtime: cloneValue(runtime), reason: "当前实验状态不能开始新的观察轮次。" };
    }
    const run = resolveCurrentRun(runtime);
    if (!run || run.status !== "completed") {
      return { ok: false, runtime: cloneValue(runtime), reason: "当前产品没有有效的已完成分析。" };
    }
    const connection = connectionTruth(store);
    if (!connection.adsReady || !connection.storeIdentityReady) {
      return { ok: false, runtime: cloneValue(runtime), reason: "Ads 会话或当前店铺身份尚未确认。" };
    }
    if (!experiment.productKey || experiment.productKey !== String(product?.id || product?.asin || "")) {
      return { ok: false, runtime: cloneValue(runtime), reason: "实验产品与当前产品范围不一致。" };
    }
    if (!experiment.adObjectKey || experiment.adObjectKey !== runtime.verifiedAdObjectKey) {
      return { ok: false, runtime: cloneValue(runtime), reason: "实验广告对象尚未在当前 Ads 页面完成核验。" };
    }
    const baseline = asArray(runtime.executionRecords).find((record) =>
      record.status === "verified"
      && record.productKey === experiment.productKey
      && record.adObjectKey === experiment.adObjectKey
      && (!experiment.recommendationId || record.recommendationId === experiment.recommendationId),
    );
    if (!baseline) {
      return { ok: false, runtime: cloneValue(runtime), reason: "缺少该广告对象的已验证回读基线，不能开始实验。" };
    }
    if (!asArray(experiment.guardrails).length || asArray(experiment.guardrails).some((item) => !String(item).trim())) {
      return { ok: false, runtime: cloneValue(runtime), reason: "实验缺少可执行的守护指标。" };
    }
    const parallel = asArray(runtime.experiments).find((item) =>
      item.id !== experiment.id
      && item.status === "running"
      && item.adObjectKey === experiment.adObjectKey,
    );
    if (parallel) {
      return { ok: false, runtime: cloneValue(runtime), reason: "同一广告对象已有运行中实验，请先完成或停止它。" };
    }
    const nextRound = Number(experiment.observationRound || 0) + 1;
    const nextExperiment = {
      ...cloneValue(experiment),
      status: "running",
      observationRound: nextRound,
      baselineRecommendationId: baseline.recommendationId,
      baselineReadbackAt: baseline.readbackAt,
      result: null,
      completedAt: null,
      observationRounds: [
        ...asArray(experiment.observationRounds).map(cloneValue),
        { round: nextRound, status: "running", startedAt: now, completedAt: null, result: null },
      ],
    };
    return {
      ok: true,
      runtime: {
        ...cloneValue(runtime),
        experiments: asArray(runtime.experiments).map((item) =>
          item.id === experiment.id ? nextExperiment : cloneValue(item),
        ),
        feedback: {
          tone: "success",
          title: `${experiment.label}第 ${nextRound} 轮已开始`,
          message: "已绑定已验证回读基线、当前广告对象和守护指标。",
          nextRouteId: "execution:experiments",
          at: now,
        },
      },
      reason: "实验观察轮次已开始。",
    };
  }
  if (action !== "complete" && action !== "stop") {
    return { ok: false, runtime: cloneValue(runtime), reason: "不支持的实验状态操作。" };
  }
  if (experiment.status !== "running") {
    return { ok: false, runtime: cloneValue(runtime), reason: "只有观察中的实验可以完成或停止。" };
  }
  const stopped = action === "stop" || details.guardrailTriggered === true;
  const result = String(details.result || (stopped
    ? "守护指标已触发，实验自动停止。"
    : "观察窗口完成，主指标与守护指标已记录。"));
  const nextExperiment = {
    ...cloneValue(experiment),
    status: stopped ? "stopped" : "completed",
    result,
    completedAt: now,
    stopReason: stopped ? String(details.stopReason || "守护指标触发") : null,
    observationRounds: asArray(experiment.observationRounds).map((round) =>
      round.round === experiment.observationRound
        ? { ...cloneValue(round), status: stopped ? "stopped" : "completed", completedAt: now, result }
        : cloneValue(round),
    ),
  };
  const next = {
    ...cloneValue(runtime),
    experiments: asArray(runtime.experiments).map((item) =>
      item.id === experiment.id ? nextExperiment : cloneValue(item),
    ),
    feedback: {
      tone: stopped ? "danger" : "success",
      title: stopped ? `${experiment.label}已停止` : `${experiment.label}已完成`,
      message: result,
      nextAction: stopped ? "检查守护指标" : "查看因果记忆",
      nextRouteId: stopped ? "execution:experiments" : "memory:causal",
      at: now,
    },
  };
  next.causalMemories = deriveCausalMemories(store, next);
  return { ok: true, runtime: next, reason: result };
}

export function deriveCausalMemories(store, runtime) {
  runtimeForStore(runtime, store);
  const experimentMemories = asArray(runtime.experiments)
    .filter((experiment) => ["completed", "observed", "verified"].includes(String(experiment?.status)))
    .map((experiment, index) => ({
      id: `MEMORY-EXPERIMENT-${String(index + 1).padStart(3, "0")}`,
      title: `${experiment.name}的观察结论`,
      status: experiment.status === "verified" ? "可复用" : "待更多样本",
      storeLabel: runtime.storeLabel,
      productLabel: experiment.productLabel || "当前产品",
      productKey: experiment.productKey || null,
      observation: String(experiment.result || experiment.observation || "实验已完成，等待补充效果摘要。"),
      evidence: [
        `主指标：${experiment.primaryMetric || "未设置"}`,
        `观察窗口：${experiment.observationWindow || "未设置"}`,
      ],
      confidence: experiment.status === "verified" ? "较高" : "初步",
      causalClaim: "这是受守护指标约束的实验观察，仍需后续样本验证可迁移性。",
      sourceLabel: experiment.label || `经营实验 ${index + 1}`,
      observedAt: experiment.completedAt || experiment.updatedAt || experiment.createdAt,
    }));
  const outcomeMemories = asArray(store?.outcomes).map((outcome, index) => ({
    id: `MEMORY-OUTCOME-${String(index + 1).padStart(3, "0")}`,
    title: String(outcome?.title || `历史效果观察 ${index + 1}`),
    status: "待更多样本",
    storeLabel: runtime.storeLabel,
    productLabel: String(
      outcome?.productLabel
      || asArray(runtime.analysisRuns).find((run) => run.status === "completed")?.productLabel
      || selectedProduct(store)?.title
      || "当前产品",
    ),
    observation: String(outcome?.result || "已记录执行后的指标变化。"),
    evidence: [
      `调整前：${firstDefined(outcome?.before, "未记录")}`,
      `调整后：${firstDefined(outcome?.after, "未记录")}`,
    ],
    confidence: "初步",
    causalClaim: "当前只记录相关性，不把单次前后变化直接认定为因果。",
    sourceLabel: "执行回读",
    observedAt: outcome?.verifiedAt || mockTime(0),
  }));
  const readbackMemories = asArray(runtime.executionRecords)
    .filter((record) => record.status === "verified")
    .map((record, index) => ({
      id: `MEMORY-READBACK-${String(index + 1).padStart(3, "0")}`,
      title: `${record.objectLabel || "关键词"}竞价调整回读`,
      status: "待更多样本",
      storeLabel: runtime.storeLabel,
      productLabel: String(record.productLabel || "当前产品"),
      productKey: record.productKey || null,
      observation: `页面保存值与刷新回读值一致：${record.savedValue ?? "未记录"} → ${record.reloadValue ?? "未记录"}。`,
      evidence: [
        `调整前：${record.beforeValue ?? "未记录"}`,
        `刷新回读：${record.reloadValue ?? "未记录"}`,
      ],
      confidence: "初步",
      causalClaim: "已证明动作真实保存并可回读；业务效果仍需观察窗口验证。",
      sourceLabel: "实时执行与刷新回读",
      observedAt: record.readbackAt || record.executedAt || mockTime(0),
    }));
  return [...experimentMemories, ...readbackMemories, ...outcomeMemories];
}

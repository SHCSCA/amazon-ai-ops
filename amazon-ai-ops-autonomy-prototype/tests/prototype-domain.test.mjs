import test from "node:test";
import assert from "node:assert/strict";

import {
  AUTONOMY_MODES,
  INTERNAL_CAPABILITIES,
  MODULES,
  completeAnalysisRun,
  createAnalysisFingerprint,
  createExperiment,
  createStoreRuntime,
  deriveCausalMemories,
  getConnectionState,
  getExecutionGate,
  invalidateAnalysisScope,
  startAnalysisRun,
} from "../src/prototype-domain.js";
import { STORE_FIXTURES, STORE_SUMMARIES } from "../src/mockData.js";

function withReadyAds(store) {
  return {
    ...store,
    connections: {
      ...(store.connections || {}),
      ads: { status: "ready", storeMatched: true },
    },
  };
}

function approveActiveRecommendations(runtime) {
  return {
    ...runtime,
    activeRecommendations: runtime.activeRecommendations.map((recommendation) => ({
      ...recommendation,
      status: "approved",
    })),
    approvals: runtime.activeRecommendations.map((recommendation, index) => ({
      id: `approval-${index + 1}`,
      runId: runtime.activeRunId,
      recommendationId: recommendation.id,
      status: "approved",
    })),
  };
}

test("原型固定为 6 个业务模块，Skills 只作为诊断内置能力", () => {
  assert.equal(MODULES.length, 6);
  assert.deepEqual(
    MODULES.map((module) => module.id),
    ["today", "assets", "decisions", "execution", "memory", "settings"],
  );
  assert.ok(MODULES.every((module) => module.subviews.length > 0));
  assert.ok(INTERNAL_CAPABILITIES.length > 0);
  assert.ok(INTERNAL_CAPABILITIES.every((capability) => capability.visibility === "diagnostics_only"));
  assert.deepEqual(AUTONOMY_MODES.map((mode) => mode.id), ["manual", "semi", "auto"]);
  assert.ok(AUTONOMY_MODES.every((mode) => mode.storeScoped));
});

test("全部演示店铺严格限定 Amazon 美国站和 USD", () => {
  assert.equal(STORE_SUMMARIES.length, 3);
  for (const summary of STORE_SUMMARIES) {
    assert.equal(summary.marketplaceCode, "US", summary.storeName);
    assert.equal(summary.currencyCode, "USD", summary.storeName);
    assert.equal(STORE_FIXTURES[summary.id].marketplace, "美国站", summary.storeName);
    assert.equal(STORE_FIXTURES[summary.id].currencySymbol, "$", summary.storeName);
  }
});

test("8/8 报表可完成分析，7/8 必须阻断且不发布建议", () => {
  const completeRuntime = createStoreRuntime(STORE_FIXTURES.SHC001);
  assert.equal(completeRuntime.analysisRuns.at(-1).status, "completed");
  assert.equal(completeRuntime.analysisRuns.at(-1).reportCoverage, "8/8");
  assert.equal(completeRuntime.activeRecommendations.length, 1);

  const incompleteRuntime = createStoreRuntime(STORE_FIXTURES.NOC003);
  assert.equal(incompleteRuntime.analysisRuns.at(-1).status, "blocked");
  assert.equal(incompleteRuntime.analysisRuns.at(-1).reportCoverage, "7/8");
  assert.deepEqual(incompleteRuntime.activeRecommendations, []);
  assert.equal(incompleteRuntime.feedback.nextRouteId, "assets:collection");

  const duplicateTypeStore = {
    ...STORE_FIXTURES.SHC001,
    reports: STORE_FIXTURES.SHC001.reports.map((report, index) => index === 7 ? { ...report, type: "campaign" } : { ...report }),
  };
  const duplicateTypeRuntime = createStoreRuntime(duplicateTypeStore);
  assert.equal(duplicateTypeRuntime.analysisRuns.at(-1).status, "blocked");
  assert.equal(duplicateTypeRuntime.analysisRuns.at(-1).reportCoverage, "7/8");
});

test("同一输入重跑会替代旧分析和旧建议，不产生叠加冗余", () => {
  const store = STORE_FIXTURES.SHC001;
  const first = createStoreRuntime(store);
  const firstRun = first.analysisRuns.at(-1);
  const firstFingerprint = createAnalysisFingerprint(store);
  assert.equal(firstRun.fingerprint, firstFingerprint);

  const restarted = startAnalysisRun(first, store);
  assert.equal(restarted.analysisRuns.length, 2);
  assert.equal(restarted.analysisRuns[0].status, "superseded");
  assert.equal(restarted.analysisRuns[0].recommendations[0].status, "superseded");
  assert.equal(restarted.analysisRuns[1].fingerprint, firstFingerprint);
  assert.deepEqual(restarted.activeRecommendations, []);

  const completed = completeAnalysisRun(restarted, store);
  assert.equal(completed.analysisRuns.at(-1).status, "completed");
  assert.equal(completed.activeRecommendations.length, 1);
  assert.equal(completed.activeRecommendations[0].runId, completed.activeRunId);
  assert.equal(
    completed.analysisRuns.flatMap((run) => run.recommendations).filter((item) => item.status !== "superseded").length,
    1,
  );
});

test("分析、建议、实验和运行状态按店铺隔离", () => {
  const jfRuntime = createStoreRuntime(STORE_FIXTURES.SHC001);
  const hnRuntime = createStoreRuntime(STORE_FIXTURES.LMX002);

  assert.equal(jfRuntime.storeKey, "SHC001");
  assert.equal(hnRuntime.storeKey, "LMX002");
  assert.throws(
    () => startAnalysisRun(jfRuntime, STORE_FIXTURES.LMX002),
    /运行状态与当前店铺不一致/,
  );

  const jfWithExperiment = createExperiment(jfRuntime, { name: "JF-US 关键词实验" });
  assert.equal(jfWithExperiment.experiments.length, 1);
  assert.equal(jfWithExperiment.experiments[0].storeLabel, "JF-US");
  assert.equal(hnRuntime.experiments.length, 0);
});

test("执行安全门要求 Ads 会话、当前店铺身份、V1 关键词竞价和本店审批", () => {
  const readyStore = {
    ...withReadyAds(STORE_FIXTURES.SHC001),
    autonomy: { ...STORE_FIXTURES.SHC001.autonomy, mode: "review" },
  };
  const runtime = createStoreRuntime(readyStore);

  const waitingApproval = getExecutionGate(readyStore, runtime);
  assert.equal(waitingApproval.allowed, false);
  assert.equal(waitingApproval.checks.find((check) => check.id === "approval").passed, false);
  assert.equal(waitingApproval.checks.find((check) => check.id === "action-scope").passed, true);

  const approved = approveActiveRecommendations(runtime);
  assert.equal(getExecutionGate(readyStore, approved).allowed, true);

  const policyAutoRuntime = createStoreRuntime(withReadyAds(STORE_FIXTURES.SHC001));
  assert.equal(policyAutoRuntime.activeRecommendations[0].status, "approved");
  assert.equal(getExecutionGate(withReadyAds(STORE_FIXTURES.SHC001), policyAutoRuntime).allowed, true);

  const adsFailedStore = {
    ...readyStore,
    connections: { ads: { status: "failed", storeMatched: false } },
  };
  const adsFailedGate = getExecutionGate(adsFailedStore, approved);
  assert.equal(adsFailedGate.allowed, false);
  assert.equal(adsFailedGate.checks.find((check) => check.id === "ads-session").passed, false);
  assert.equal(adsFailedGate.checks.find((check) => check.id === "store-identity").passed, false);

  const unsupported = {
    ...approved,
    activeRecommendations: approved.activeRecommendations.map((recommendation) => ({
      ...recommendation,
      entityType: "ad_group",
      actionType: "budget_change",
    })),
  };
  const unsupportedGate = getExecutionGate(readyStore, unsupported);
  assert.equal(unsupportedGate.allowed, false);
  assert.equal(unsupportedGate.checks.find((check) => check.id === "action-scope").passed, false);
  assert.match(unsupportedGate.checks.find((check) => check.id === "action-scope").reason, /只允许调整关键词竞价/);
});

test("经营实验属于当前店铺，完成后只沉淀带限制说明的因果记忆", () => {
  const store = STORE_FIXTURES.SHC001;
  const runtime = createStoreRuntime(store);
  const withDraft = createExperiment(runtime, {
    name: "低效词竞价下调验证",
    primaryMetric: "ACOS",
    observationWindow: "7 天",
    guardrails: ["广告订单下降不超过 15%"],
  });

  assert.equal(withDraft.experiments[0].status, "draft");
  assert.equal(withDraft.experiments[0].storeLabel, "JF-US");
  assert.ok(deriveCausalMemories(store, withDraft).every((memory) => !memory.id.startsWith("MEMORY-EXPERIMENT")));

  const completed = {
    ...withDraft,
    experiments: withDraft.experiments.map((experiment) => ({
      ...experiment,
      status: "completed",
      result: "ACOS 较基线下降 8%，订单量保持稳定。",
      completedAt: "2026-08-28T03:00:00.000Z",
    })),
  };
  const memories = deriveCausalMemories(store, completed);
  const experimentMemory = memories.find((memory) => memory.id.startsWith("MEMORY-EXPERIMENT"));
  assert.ok(experimentMemory);
  assert.equal(experimentMemory.sourceLabel, "经营实验 1");
  assert.match(experimentMemory.observation, /ACOS 较基线下降 8%/);
  assert.match(experimentMemory.causalClaim, /仍需后续样本验证/);
});

test("切换产品或数据批次只作废当前建议，历史、实验与记忆继续保留", () => {
  const store = STORE_FIXTURES.SHC001;
  const runtime = createExperiment(createStoreRuntime(store), { name: "保留实验" });
  const nextStore = { ...store, selectedProductId: store.products[1].id, scope: { ...store.scope, selectedProductId: store.products[1].id } };
  const invalidated = invalidateAnalysisScope(runtime, nextStore, "产品范围已切换");

  assert.equal(invalidated.activeRunId, null);
  assert.deepEqual(invalidated.activeRecommendations, []);
  assert.equal(invalidated.analysisRuns.length, runtime.analysisRuns.length);
  assert.equal(invalidated.experiments.length, 1);
  assert.match(invalidated.feedback.message, /历史记录已保留/);
});

test("执行安全门拒绝伪审批、过期策略、非规范对象、超限变更和重复执行", () => {
  const store = withReadyAds(STORE_FIXTURES.SHC001);
  const autoRuntime = createStoreRuntime(store);

  const forgedApproval = { ...autoRuntime, approvals: [] };
  assert.equal(getExecutionGate(store, forgedApproval).checks.find((check) => check.id === "approval").passed, false);

  const noPolicy = { ...store, policyAuthority: { ...store.policyAuthority, status: "draft" } };
  assert.equal(getExecutionGate(noPolicy, autoRuntime).checks.find((check) => check.id === "policy").passed, false);

  const nonCanonical = { ...autoRuntime, activeRecommendations: autoRuntime.activeRecommendations.map((item) => ({ ...item, objectCanonical: false })) };
  assert.equal(getExecutionGate(store, nonCanonical).checks.find((check) => check.id === "authority").passed, false);

  const overLimit = { ...autoRuntime, activeRecommendations: autoRuntime.activeRecommendations.map((item) => ({ ...item, recommendedValue: item.currentValue * 1.2 })) };
  assert.equal(getExecutionGate(store, overLimit).checks.find((check) => check.id === "change-limit").passed, false);

  const executed = { ...autoRuntime, activeRecommendations: autoRuntime.activeRecommendations.map((item) => ({ ...item, status: "executed" })) };
  assert.equal(getExecutionGate(store, executed).checks.find((check) => check.id === "action-ready").passed, false);
});

test("连接真值分开表达 ERP 可读与 Ads 写入阻断", () => {
  const truth = getConnectionState(STORE_FIXTURES.LMX002);
  assert.equal(truth.erpReady, true);
  assert.equal(truth.adsReady, false);
  assert.equal(truth.storeIdentityReady, false);
});

test("刷新回读完成后生成谨慎记忆，不把保存成功冒充业务因果", () => {
  const store = STORE_FIXTURES.SHC001;
  const runtime = {
    ...createStoreRuntime(store),
    executionRecords: [{ status: "verified", objectLabel: "活动 > 广告组 > 关键词", beforeValue: 1.3, savedValue: 1.17, reloadValue: 1.17, readbackAt: "2026-08-28T03:00:00.000Z" }],
  };
  const memory = deriveCausalMemories(store, runtime).find((item) => item.id.startsWith("MEMORY-READBACK"));
  assert.ok(memory);
  assert.match(memory.causalClaim, /业务效果仍需观察窗口验证/);
});

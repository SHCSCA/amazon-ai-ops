import test from "node:test";
import assert from "node:assert/strict";

import {
  captureExecutionAuthority,
  commitExecution,
  completeAnalysisRun,
  createExperiment,
  createStoreRuntime,
  deriveCausalMemories,
  getExecutionGate,
  invalidateAnalysisScope,
  resolveCurrentRun,
  startAnalysisRun,
  transitionExperiment,
  verifyExecutionReadback,
} from "../src/prototype-domain.js";
import { STORE_FIXTURES } from "../src/mockData.js";

function readyStore(store = STORE_FIXTURES.SHC001) {
  return {
    ...store,
    connections: {
      ...(store.connections || {}),
      erp: { status: "ready" },
      ads: { status: "ready", storeMatched: true },
    },
    adsIdentity: {
      ...(store.adsIdentity || {}),
      status: "verified",
      storeMatched: true,
      canonicalObjectReady: true,
    },
  };
}

test("产品范围作废后旧完成分析只能留在历史，不能回退成当前运行", () => {
  const store = readyStore();
  const runtime = createStoreRuntime(store);
  const nextProduct = store.products[1];
  const nextStore = {
    ...store,
    selectedProductId: nextProduct.id,
    scope: {
      ...store.scope,
      selectedProductId: nextProduct.id,
      asin: nextProduct.asin,
      productLabel: `${store.storeName} / ${nextProduct.asin}`,
    },
  };

  const invalidated = invalidateAnalysisScope(runtime, nextStore, "产品范围已切换");

  assert.equal(resolveCurrentRun(invalidated), null);
  assert.equal(invalidated.analysisRuns.at(-1).status, "completed");
  assert.equal(invalidated.analysisRuns.at(-1).isActive, false);
});

test("当前产品没有规范广告对象时不得借用另一个产品的诊断生成建议", () => {
  const store = readyStore();
  const nextProduct = store.products[1];
  const nextStore = {
    ...store,
    selectedProductId: nextProduct.id,
    scope: {
      ...store.scope,
      selectedProductId: nextProduct.id,
      asin: nextProduct.asin,
      productLabel: `${store.storeName} / ${nextProduct.asin}`,
    },
  };
  const invalidated = invalidateAnalysisScope(createStoreRuntime(store), nextStore, "产品范围已切换");
  const completed = completeAnalysisRun(startAnalysisRun(invalidated, nextStore), nextStore);

  assert.equal(completed.activeRecommendations.length, 0);
  assert.match(completed.feedback.message, /没有找到当前产品.*广告对象/);
  assert.equal(getExecutionGate(nextStore, completed).allowed, false);
});

test("执行安全门要求当前产品广告对象已被明确选中并核验", () => {
  const store = readyStore();
  const runtime = createStoreRuntime(store);
  assert.equal(getExecutionGate(store, runtime).allowed, true);

  const unverified = {
    ...runtime,
    selectedAdObjectKey: runtime.activeRecommendations[0].adObjectKey,
    verifiedAdObjectKey: null,
  };
  const authority = getExecutionGate(store, unverified).checks.find((check) => check.id === "authority");
  assert.equal(authority.passed, false);
  assert.match(authority.reason, /广告对象.*核验/);
});

test("执行提交点重新核验运行、产品和 Ads 身份，漂移时保持零执行", () => {
  const store = readyStore();
  const runtime = createStoreRuntime(store);
  const expected = captureExecutionAuthority(store, runtime);
  assert.ok(expected);

  const driftedStore = {
    ...store,
    connections: { ...store.connections, ads: { status: "failed", storeMatched: false } },
    adsIdentity: { ...store.adsIdentity, status: "blocked", storeMatched: false },
  };
  const drifted = commitExecution(driftedStore, runtime, expected);
  assert.equal(drifted.ok, false);
  assert.equal(drifted.runtime.executionRecords.length, 0);
  assert.match(drifted.reason, /Ads|店铺身份/);

  const changedRun = commitExecution(store, { ...runtime, activeRunId: null }, expected);
  assert.equal(changedRun.ok, false);
  assert.equal(changedRun.runtime.executionRecords.length, 0);
  assert.match(changedRun.reason, /分析范围|运行/);
});

test("执行成功后回读必须使用独立观察值，不一致时失败关闭且不给因果记忆", () => {
  const store = readyStore();
  const runtime = createStoreRuntime(store);
  const expected = captureExecutionAuthority(store, runtime);
  const committed = commitExecution(store, runtime, expected);
  assert.equal(committed.ok, true);
  assert.equal(committed.runtime.executionRecords[0].status, "awaiting_readback");

  const record = committed.runtime.executionRecords[0];
  const mismatch = verifyExecutionReadback(store, committed.runtime, {
    [record.recommendationId]: Number(record.savedValue) + 0.01,
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.runtime.executionRecords[0].status, "readback_failed");
  assert.match(mismatch.reason, /刷新值与保存值不一致/);
  assert.equal(deriveCausalMemories(store, mismatch.runtime).some((item) => item.id.startsWith("MEMORY-READBACK")), false);

  const verified = verifyExecutionReadback(store, committed.runtime, {
    [record.recommendationId]: record.savedValue,
  });
  assert.equal(verified.ok, true);
  assert.equal(verified.runtime.executionRecords[0].status, "verified");
  assert.equal(deriveCausalMemories(store, verified.runtime).some((item) => item.id.startsWith("MEMORY-READBACK")), true);
});

test("历史分析的数据窗口与产品来源是不可漂移快照", () => {
  const store = readyStore();
  const runtime = createStoreRuntime(store);
  const run = resolveCurrentRun(runtime);
  const changedStore = {
    ...store,
    scope: { ...store.scope, dateFrom: "2026-08-01", dateTo: "2026-08-28" },
  };

  assert.equal(run.dataWindow, "2026-06-17 至 2026-07-20");
  assert.notEqual(run.dataWindow, `${changedStore.scope.dateFrom} 至 ${changedStore.scope.dateTo}`);
  assert.equal(run.productLabel, store.products[0].title);
});

test("经营实验必须绑定已验证回读，同对象不可并行且重开产生新观察轮次", () => {
  const store = readyStore();
  const initial = createStoreRuntime(store);
  const recommendation = initial.activeRecommendations[0];
  const draftRuntime = createExperiment(initial, {
    name: "核心词降价验证",
    productKey: recommendation.productKey,
    productLabel: recommendation.productLabel,
    adObjectKey: recommendation.adObjectKey,
    adObjectLabel: recommendation.objectPath,
    guardrails: ["广告订单下降不超过 15%"],
  });
  const draftId = draftRuntime.experiments[0].id;
  const blocked = transitionExperiment(draftRuntime, store, draftId, "start");
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason, /回读基线/);

  const authority = captureExecutionAuthority(store, initial);
  const committed = commitExecution(store, initial, authority);
  const record = committed.runtime.executionRecords[0];
  const readback = verifyExecutionReadback(store, committed.runtime, {
    [record.recommendationId]: record.savedValue,
  });
  const withExperiment = createExperiment(readback.runtime, {
    name: "核心词降价验证",
    productKey: recommendation.productKey,
    productLabel: recommendation.productLabel,
    adObjectKey: recommendation.adObjectKey,
    adObjectLabel: recommendation.objectPath,
    recommendationId: recommendation.id,
    guardrails: ["广告订单下降不超过 15%"],
  });
  const experimentId = withExperiment.experiments.at(-1).id;
  const running = transitionExperiment(withExperiment, store, experimentId, "start");
  assert.equal(running.ok, true);
  assert.equal(running.runtime.experiments.at(-1).status, "running");
  assert.equal(running.runtime.experiments.at(-1).observationRound, 1);

  const withParallelDraft = createExperiment(running.runtime, {
    name: "重复对象实验",
    productKey: recommendation.productKey,
    productLabel: recommendation.productLabel,
    adObjectKey: recommendation.adObjectKey,
    adObjectLabel: recommendation.objectPath,
    recommendationId: recommendation.id,
    guardrails: ["广告订单下降不超过 15%"],
  });
  const parallelId = withParallelDraft.experiments.at(-1).id;
  const parallel = transitionExperiment(withParallelDraft, store, parallelId, "start");
  assert.equal(parallel.ok, false);
  assert.match(parallel.reason, /同一广告对象.*运行中实验/);

  const completed = transitionExperiment(running.runtime, store, experimentId, "complete", {
    result: "ACOS 改善 11%，订单下降 3%，守护指标未触发。",
  });
  assert.equal(completed.ok, true);
  assert.equal(completed.runtime.experiments.at(-1).status, "completed");
  const reopened = transitionExperiment(completed.runtime, store, experimentId, "restart");
  assert.equal(reopened.ok, true);
  assert.equal(reopened.runtime.experiments.at(-1).status, "running");
  assert.equal(reopened.runtime.experiments.at(-1).observationRound, 2);
});

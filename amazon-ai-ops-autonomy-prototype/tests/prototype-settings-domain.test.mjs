import test from "node:test";
import assert from "node:assert/strict";

import {
  checkPolicyDraft,
  createPolicyDraft,
  createStoreSettings,
  enablePolicyDraft,
  runAutomationTask,
  toggleAutomationTask,
  updateStoreConfig,
} from "../src/prototype-settings-domain.js";
import { STORE_FIXTURES } from "../src/mockData.js";

test("策略必须按草稿、检查、启用推进，且 V1 只允许关键词竞价", () => {
  const initial = createStoreSettings(STORE_FIXTURES.SHC001);
  const drafted = createPolicyDraft(initial);
  assert.equal(drafted.policy.status, "draft");
  assert.equal(drafted.policy.rules[0].actionType, "keyword_bid_adjustment");
  assert.deepEqual(drafted.policy.rules.map((item) => item.priority), [10, 20]);

  const premature = enablePolicyDraft(drafted);
  assert.equal(premature.ok, false);
  assert.match(premature.reason, /先检查/);

  const checked = checkPolicyDraft(drafted);
  assert.equal(checked.ok, true);
  assert.equal(checked.state.policy.status, "checked");
  const enabled = enablePolicyDraft(checked.state);
  assert.equal(enabled.ok, true);
  assert.equal(enabled.state.policy.status, "enabled");
  assert.ok(enabled.state.policy.versionLabel);
});

test("系统配置按店铺 revision 保存，冲突和越界值失败关闭", () => {
  const initial = createStoreSettings(STORE_FIXTURES.SHC001);
  const saved = updateStoreConfig(initial, {
    expectedRevision: initial.revision,
    patch: { killSwitch: true, minConfidencePct: 92, collectionTime: "07:30" },
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.state.config.killSwitch, true);
  assert.equal(saved.state.revision, initial.revision + 1);

  const stale = updateStoreConfig(saved.state, {
    expectedRevision: initial.revision,
    patch: { killSwitch: false },
  });
  assert.equal(stale.ok, false);
  assert.match(stale.reason, /配置已变化/);

  const invalid = updateStoreConfig(saved.state, {
    expectedRevision: saved.state.revision,
    patch: { minConfidencePct: 120 },
  });
  assert.equal(invalid.ok, false);
  assert.match(invalid.reason, /置信度/);
});

test("自动任务可启停、立即运行、记录失败原因并从失败重试", () => {
  const initial = createStoreSettings(STORE_FIXTURES.LMX002);
  const task = initial.automationTasks[0];
  const disabled = toggleAutomationTask(initial, task.id);
  assert.equal(disabled.automationTasks[0].enabled, !task.enabled);

  const failed = runAutomationTask(disabled, task.id, {
    outcome: "failed",
    reason: "Ads 店铺身份尚未确认",
  });
  assert.equal(failed.ok, true);
  assert.equal(failed.state.automationTasks[0].lastStatus, "failed");
  assert.match(failed.state.automationTasks[0].lastReason, /Ads 店铺身份/);
  assert.equal(failed.state.automationTasks[0].nextAction, "修复连接后重试");

  const retried = runAutomationTask(failed.state, task.id, { outcome: "success" });
  assert.equal(retried.ok, true);
  assert.equal(retried.state.automationTasks[0].lastStatus, "success");
  assert.equal(retried.state.automationTasks[0].lastReason, null);
});

test("设置状态严格限定 Amazon US / USD 并拒绝跨店复用", () => {
  const initial = createStoreSettings(STORE_FIXTURES.SHC001);
  assert.equal(initial.marketplaceCode, "US");
  assert.equal(initial.currencyCode, "USD");
  assert.throws(
    () => createStoreSettings({ ...STORE_FIXTURES.SHC001, marketplaceCode: "CA", currencyCode: "CAD" }),
    /仅支持 Amazon 美国站和 USD/,
  );
});

const { insist } = require('./v16-performance-artifacts');

function seedSoftwareAnalysis(runtime, database, store, date, batchIds) {
  const repository = new runtime.MissionDomainRepository(database);
  const context = { storeId: store.storeId, browserProfileId: store.browserProfileId, marketplace: 'US', currency: 'USD',
    businessTimezone: 'America/Los_Angeles', businessDate: date, sessionGeneration: 0 };
  const actorId = 'software-test-operator', policyId = `software-readonly-policy-${store.storeId}`;
  const policy = repository.createPolicy(context, { id: policyId, name: '隔离软件只读分析规则', scope: 'store', priority: 100, actorId });
  const version = repository.createPolicyVersion(context, { id: `${policyId}-v1`, policyId, version: 1, actorId, rules: {
    allowedActionTypes: ['set_keyword_bid'], allowedAdEntityIds: [], maxChangePct: 1, totalImpactBudget: 0, maxDailyActionCount: 1,
    cooldownMinutes: 0, executionWindow: { timeZone: context.businessTimezone, daysOfWeek: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59' },
    requiredEvidence: ['page_identity', 'before_screenshot', 'after_screenshot', 'reload_screenshot', 'readback_value'],
    stopConditions: ['identity_drift', 'expected_before_mismatch', 'unknown_result', 'data_stale', 'impact_budget_exhausted', 'kill_switch']
      .map(code => ({ code, detail: '隔离软件验收禁止广告执行；触发后立即阻断。' })), killSwitch: true,
  } });
  repository.enablePolicyVersion(context, { policyId, versionId: version.id, expectedPolicyRevision: policy.revision,
    expectedVersionRevision: version.revision, actorId });
  const missionIds = batchIds.map((dataBatchId, index) => {
    const mission = repository.createMission(context, { id: `software-analysis-${store.storeId}-${index}`, dataBatchId,
      policyVersionId: version.id, title: `隔离软件规则分析 ${index + 1}`, objective: '测量真实规则分析链；不生成批准或执行授权。',
      observationStartsAt: `${date}T00:00:00.000Z`, observationEndsAt: `${date}T23:59:59.000Z`,
      successCriteria: ['实际八类报表入库后完成规则分析'], guardrails: ['仅隔离数据', '不得签发 Grant 或提交广告写入'], actorId });
    repository.transitionMission(context, { id: mission.id, expectedRevision: mission.revision, status: 'active', phase: 'analysis', actorId });
    return mission.id;
  });
  const current = repository.getPolicyRuntime(context);
  const locked = repository.updatePolicyRuntime(context, { expectedRevision: current.revision,
    patch: { autonomyMode: 'manual_approval', activePolicyVersionId: null, killSwitch: true, reason: '隔离软件规则分析；不武装自动执行。' }, actorId });
  insist(locked.autonomyMode === 'manual_approval' && !locked.activePolicyVersionId && locked.killSwitch, 'SOFTWARE_ANALYSIS_AUTHORITY_NOT_LOCKED');
  insist(repository.getPolicyVersion(context, version.id).rules.allowedAdEntityIds.length === 0, 'SOFTWARE_ANALYSIS_ADS_ENTITIES_FORBIDDEN');
  return { missionIds, policyId, policyVersionId: version.id, classification: 'isolated-software-fixture', formalCredit: false };
}
module.exports = { seedSoftwareAnalysis };

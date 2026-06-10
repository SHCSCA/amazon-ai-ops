const fs = require('fs');
const path = require('path');

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

let failures = 0;

function pass(message) {
  console.log(`[PASS] ${message}`);
}

function fail(message) {
  failures += 1;
  console.error(`[FAIL] ${message}`);
}

function mustContain(source, pattern, message) {
  if (source.includes(pattern)) {
    pass(message);
  } else {
    fail(message);
  }
}

function mustNotContain(source, pattern, message) {
  if (source.includes(pattern)) {
    fail(message);
  } else {
    pass(message);
  }
}

const mainIndex = read('apps/desktop/src/main/index.ts');
const policy = read('apps/desktop/src/main/recommendation-execution-policy.ts');
const renderer = read('apps/desktop/src/renderer/App.tsx');
const adActions = read('packages/action-executor/src/ad-actions.ts');
const recommendationRepo = read('packages/local-db/src/sqlite/repositories/recommendation-repo.ts');

mustContain(
  mainIndex,
  'buildAdExecutionUnavailableResult',
  'desktop execution handler uses fail-closed unavailable result',
);
mustContain(
  mainIndex,
  'buildActionLogForExecution',
  'desktop execution log is built through shared fail-closed policy',
);
mustContain(
  policy,
  'failureReason: outcome.executionStatus ===',
  'shared policy stores failure reason for unsuccessful execution',
);
mustContain(
  mainIndex,
  'if (executionOutcome.shouldMarkExecuted)',
  'recommendation is marked executed only through explicit outcome gate',
);
mustContain(
  mainIndex,
  "throw new Error(executionResult.error || '广告执行未通过回读确认，建议状态保持为 approved。')",
  'failed execution is surfaced to the operator',
);
mustContain(
  mainIndex,
  'function handleGetRecommendations',
  'recommendation listing uses normalized filter handler instead of date-only IPC',
);
mustContain(
  mainIndex,
  'findByFilter(normalizedFilter).items',
  'recommendation listing supports status/date/store/site/asin filters',
);
mustContain(
  mainIndex,
  'findForRecommendations(scope)',
  'recommendation generation uses scoped ad metrics when filters are provided',
);
mustContain(
  mainIndex,
  '不能使用登录账号名代替店铺范围',
  'operator-triggered recommendation generation requires explicit business scope',
);
mustContain(
  mainIndex,
  'marketplaceCode: scope.marketplaceCode || firstMetric?.marketplaceCode',
  'recommendation generation no longer hard-codes marketplace when metric scope is available',
);
mustContain(
  mainIndex,
  'insertIfNoDuplicate(rec)',
  'recommendation generation skips duplicate recommendations instead of repeated inserts',
);
mustContain(
  mainIndex,
  'tryCaptureExecutionScreenshot',
  'fail-closed execution writes audit even when screenshots are unavailable',
);
mustNotContain(
  mainIndex,
  "if (!state.browserController) {\n    throw new Error('Browser not initialized');\n  }\n\n  const executionResult = buildAdExecutionUnavailableResult",
  'fail-closed execution no longer requires browser initialization before audit result is built',
);
mustNotContain(
  mainIndex,
  'simplified - full implementation would use AdActionExecutor',
  'desktop handler no longer documents fake executor placeholder',
);
mustNotContain(
  mainIndex,
  'const executionResult = {\n    success: true',
  'desktop handler no longer constructs a hard-coded success result',
);

mustContain(policy, 'result.success && result.verified', 'policy requires success and verified before executed');
mustContain(policy, "executionStatus: 'failed'", 'policy has failed outcome for unverified execution');
mustContain(policy, "recommendationStatus: 'approved'", 'failed outcome keeps recommendation approved');

mustNotContain(adActions, 'success: toast || true', 'negative keyword executor cannot force success without toast');
mustContain(adActions, 'if (!toast)', 'negative keyword executor fails closed when success toast is missing');
mustContain(adActions, 'success: verified', 'bid/toggle executors tie success to readback verification');
mustContain(adActions, '回读校验失败', 'executor exposes readback failure reason');

mustContain(renderer, 'AD_READBACK_ACCEPTANCE_COMMANDS', 'renderer exposes ad readback acceptance commands');
mustContain(renderer, '广告执行 readback 验收证据', 'recommendations page shows ad readback evidence panel');
mustContain(renderer, '复制广告 readback 验收命令', 'recommendations page provides copy command affordance');
mustContain(renderer, '建议筛选与生成', 'recommendations page exposes filter/generate controls');
mustContain(renderer, '生成优化建议', 'recommendations page exposes generation action');
mustContain(renderer, 'generateRecommendations({', 'renderer sends recommendation generation scope to main process');
mustContain(renderer, '生成优化建议前请先填写开始日期、结束日期、店铺和站点', 'renderer requires explicit scope before generating recommendations');
mustContain(renderer, '不能用阻断审计冒充成功', 'recommendations workflow warns against treating blocked audit as success');
mustContain(renderer, 'verify:ad-readback', 'recommendations page references the readback verifier');
mustNotContain(renderer, 'setActionMessage(\'广告执行已通过可验证回读。', 'renderer no longer displays success/readback copy for fail-closed execution');

mustContain(
  recommendationRepo,
  "json_extract(evidence_json, '$.date')",
  'recommendation repository filters by metric evidence date when available',
);
mustContain(
  recommendationRepo,
  'insertIfNoDuplicate',
  'recommendation repository exposes duplicate-safe insert',
);

if (failures > 0) {
  console.error(`\nNEEDS_WORK: ${failures} ad execution fail-closed check(s) failed.`);
  process.exit(1);
}

console.log('\nAD_EXECUTION_FAIL_CLOSED verified.');

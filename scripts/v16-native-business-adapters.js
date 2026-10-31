const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { digest, same, hashEqual, insist, readArtifact, timeWithin } = require('./v16-native-artifacts');

function authorityContext(descriptor, context) {
  const snapshot = context.load(descriptor.authorityArtifactId, 'authority-snapshot');
  const record = context.descriptors.get(descriptor.authorityArtifactId);
  return {
    nowMs: Date.now(), packageIdentity: context.current.packageIdentity,
    authoritySnapshotPath: snapshot.snapshot.absolutePath,
    authoritySnapshotManifestSha256: record.sha256.toUpperCase(),
    canonicalStoresRoot: path.join(path.dirname(snapshot.source.absolutePath), 'stores'),
    Database: context.trustedNativeEnvironment?.Database,
  };
}
function verifyAuthority(raw, descriptor, context) {
  const production = require('./verify-mission-control-production-readiness');
  const { resolveAdReadbackAuthorityDbPath } = require('./ad-readback-authority-db');
  // 正式库路径必须由当前机器发现，不能由待验证报告自行指定另一份库。
  const environment = context.trustedNativeEnvironment;
  if (environment) insist(typeof environment.Database === 'function' && path.isAbsolute(environment.authorityDbPath ?? '') && path.isAbsolute(environment.authoritySnapshotRoot ?? ''), 'TRUSTED_AUTHORITY_ENVIRONMENT_REQUIRED');
  const canonical = environment ? environment.authorityDbPath : resolveAdReadbackAuthorityDbPath(undefined, { APPDATA: process.env.APPDATA, USERPROFILE: process.env.USERPROFILE });
  const selection = { evidence: raw, evidencePath: path.resolve(context.root, descriptor.path) };
  const result = production.validateAuthoritySnapshotManifest(selection, {
    authorityDbPath: canonical, authoritySnapshotRoot: environment?.authoritySnapshotRoot ?? path.join(context.root, 'output/codex-evidence/authority-snapshots'), Database: environment?.Database,
  }, { packageIdentity: context.current.packageIdentity });
  insist(result.ok, 'AUTHORITY_SNAPSHOT_RECHECK:' + result.reason);
  readArtifact(context.root, { ...raw.source.artifactAfter, path: raw.source.absolutePath }, path.dirname(canonical));
  readArtifact(context.root, { path: raw.snapshot.absolutePath, sha256: raw.snapshot.sha256, sizeBytes: raw.snapshot.sizeBytes });
  for (const suffix of ['-wal', '-shm']) {
    const file = canonical + suffix;
    if (fs.existsSync(file)) readArtifact(context.root, { path: file, sha256: digest(fs.readFileSync(file)) }, path.dirname(canonical));
  }
  timeWithin(raw.exportedAt, context.execution, 'authority-export');
  verifyAuthorityCurrentness(raw, 'v16-native-before-checks', context);
  return true;
}
function verifyAuthorityCurrentness(raw, captureLabel, context = {}) {
  const environment = context.trustedNativeEnvironment;
  if (environment) insist(typeof environment.currentnessContext?.spawnSync === 'function', 'TRUSTED_CURRENTNESS_CHILD_REQUIRED');
  return require('./sqlite-authority-currentness').captureAuthoritySnapshotCurrentness({
    sourceDatabasePath: raw.source.absolutePath,
    expectedSnapshotArtifact: { sha256: raw.snapshot.sha256, sizeBytes: raw.snapshot.sizeBytes }, captureLabel,
  }, environment?.currentnessContext);
}
function verifyContinuous(raw, descriptor, context) {
  const result = require('./verify-mission-control-production-readiness').validateContinuousOperation(raw, {
    ...authorityContext(descriptor, context), evidencePath: path.resolve(context.root, descriptor.path),
  });
  insist(result.ok, 'CONTINUOUS_OPERATION_RECHECK:' + result.reason);
  insist(hashEqual(raw.packageIdentity?.mainBundleSha256, context.current.packageIdentity.mainBundleSha256), 'CONTINUOUS_CURRENT_PACKAGE_MISMATCH');
  const completed = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(context.execution.finishedAt));
  insist(raw.window.businessDates.every(day => day < completed), 'CONTINUOUS_INCOMPLETE_US_DAY');
  return true;
}
function verifyCanary(raw, descriptor, context) {
  insist(['manual_approval', 'policy_auto'].includes(descriptor.mode), 'CANARY_MODE_REQUIRED');
  const result = require('./verify-mission-control-production-readiness').validateExecutionCanary(raw, descriptor.mode, authorityContext(descriptor, context));
  insist(result.ok, 'EXECUTION_CANARY_RECHECK:' + result.reason);
  insist(same(raw.packageIdentity, context.current.packageIdentity), 'CANARY_CURRENT_PACKAGE_MISMATCH');
  for (const record of raw.execution.evidence) {
    const captured = timeWithin(record.capturedAt, context.execution, 'canary-' + record.slot);
    insist(Date.now() - captured <= 72 * 60 * 60 * 1000, 'EXECUTION_CANARY_EXPIRED');
  }
  context.canaryValidations ??= new Map();
  context.canaryValidations.set(raw, result);
  return true;
}
function verifyOfflineMigration(raw, descriptor, context) {
  const file = path.resolve(context.root, descriptor.path);
  if (context.trustedNativeEnvironment) insist(context.trustedNativeEnvironment.offlineMigrationRuntime, 'TRUSTED_MIGRATION_RUNTIME_REQUIRED');
  const result = require('./verify-s7-migration-backup-restore').verifyS7MigrationBackupRestore(file, context.trustedNativeEnvironment?.offlineMigrationRuntime);
  insist(result.passed, 'OFFLINE_MIGRATION_RECHECK:' + result.checks.filter(x => !x.passed).map(x => x.code).join(','));
  return true;
}
function verifyLiveMigration(raw, descriptor, context) {
  const verifier = require('./verify-s7-live-migration-acceptance');
  let targetVersion;
  if (context.trustedNativeEnvironment) {
    const runtime = context.trustedNativeEnvironment.offlineMigrationRuntime;
    insist(runtime, 'TRUSTED_MIGRATION_RUNTIME_REQUIRED');
    const contract = runtime.migrationContract;
    insist(Array.isArray(contract) && contract.length > 0 && Array.from(contract).every((record, index) => record
      && record.version === index + 1 && typeof record.name === 'string' && record.name.length > 0
      && typeof record.checksum === 'string' && record.checksum.length > 0), 'TRUSTED_MIGRATION_CONTRACT_INVALID');
    // 仅使用 Main 注入的冻结合同；待验回执不能选择目标或触发开发源码读取。
    targetVersion = contract.length;
  }
  verifier.validateS7LiveMigrationAcceptanceReceipt(raw, targetVersion);
  const authority = context.load(descriptor.authorityArtifactId, 'authority-snapshot');
  insist(path.resolve(raw.inputs.database.path) === path.resolve(authority.source.absolutePath), 'LIVE_MIGRATION_AUTHORITY_PATH_MISMATCH');
  for (const key of ['authoritySelection', 'migrationManifest', 'migrationVerification']) readArtifact(context.root, raw.inputs[key]);
  context.load(descriptor.migrationArtifactId, 'offline-migration');
  insist(hashEqual(raw.inputs.migrationManifest.sha256, context.descriptors.get(descriptor.migrationArtifactId)?.sha256), 'LIVE_MIGRATION_MANIFEST_MISMATCH');
  readArtifact(context.root, raw.inputs.database, path.dirname(raw.inputs.database.path));
  insist(hashEqual(raw.inputs.database.logicalSnapshotSha256, authority.snapshot.sha256), 'LIVE_MIGRATION_LOGICAL_SNAPSHOT_MISMATCH');
  return true;
}
function withAuthorityDatabase(descriptor, context, inspect) {
  const binding = authorityContext(descriptor, context);
  const authority = context.load(descriptor.authorityArtifactId, 'authority-snapshot');
  const record = { path: binding.authoritySnapshotPath, sha256: authority.snapshot.sha256 };
  readArtifact(context.root, record);
  const Database = context.trustedNativeEnvironment?.Database ?? createRequire(path.join(context.root, 'packages/local-db/package.json'))('better-sqlite3');
  let db;
  try {
    db = new Database(binding.authoritySnapshotPath, { readonly: true, fileMustExist: true });
    db.pragma('query_only = ON');
    insist(db.pragma('integrity_check', { simple: true }) === 'ok' && db.pragma('foreign_key_check').length === 0, 'BUSINESS_SNAPSHOT_INTEGRITY_FAILED');
    return inspect(db, binding);
  } finally {
    if (db?.open) db.close();
    readArtifact(context.root, record);
  }
}
function verifyReconciliation(raw, descriptor, context) {
  insist(raw.kind === 'v16-unknown-reconciliation' && raw.schemaVersion === 1 && raw.cases?.length > 0, 'RECONCILIATION_SCHEMA_MISMATCH');
  withAuthorityDatabase(descriptor, context, (db, binding) => {
    for (const item of raw.cases) {
      const rows = db.prepare('SELECT * FROM ad_execution_reconciliation_cases WHERE store_id=? AND case_id=?').all(item.storeId, item.caseId);
      insist(rows.length === 1, 'RECONCILIATION_ROW_NOT_UNIQUE');
      const row = rows[0];
      insist(row.job_id === item.jobId && row.submit_intent_id === item.submitIntentId && row.outcome === item.outcome && row.completed_at && row.first_json && row.reload_json, 'RECONCILIATION_DATABASE_MISMATCH');
      const jobs = db.prepare('SELECT * FROM ad_execution_jobs WHERE store_id=? AND submit_intent_id=?').all(item.storeId, item.submitIntentId);
      insist(jobs.length === 1 && jobs[0].id === item.jobId && jobs[0].status === 'unknown', 'RECONCILIATION_DUPLICATE_OR_REOPENED_INTENT');
      const job = jobs[0], storedContext = JSON.parse(row.context_json);
      const events = db.prepare("SELECT event_type FROM ad_execution_events WHERE store_id=? AND job_id=? AND event_type IN ('submitted','submit_intent_recorded')").all(item.storeId, item.jobId);
      insist(events.filter(x => x.event_type === 'submit_intent_recorded').length === 1 && events.filter(x => x.event_type === 'submitted').length <= 1, 'RECONCILIATION_REPEATED_WRITE');
      const observations = [JSON.parse(row.first_json), JSON.parse(row.reload_json)];
      insist(same(observations, item.observations) && observations.length === 2, 'RECONCILIATION_OBSERVATION_MISMATCH');
      insist(Date.parse(row.started_at) <= Date.parse(observations[0].capturedAt) && Date.parse(observations[0].capturedAt) < Date.parse(observations[1].capturedAt) && Date.parse(observations[1].capturedAt) <= Date.parse(row.completed_at), 'RECONCILIATION_TIME_NOT_ORDERED');
      const outcome = observations[0].pageIdentityHash !== observations[1].pageIdentityHash || observations[0].observedBidCents !== observations[1].observedBidCents ? 'inconclusive_permanent'
        : observations[1].observedBidCents === job.target_bid_cents ? 'target_stably_observed'
          : observations[1].observedBidCents === job.expected_bid_cents ? 'original_stably_observed' : 'other_value_stably_observed';
      insist(outcome === row.outcome, 'RECONCILIATION_OUTCOME_NOT_RECOMPUTED');
      for (const [index, proof] of (item.artifacts ?? []).entries()) {
        const observation = observations[index], slot = index === 0 ? 'first' : 'reload';
        const referenceInput = { storeId: item.storeId, batchId: row.batch_id, jobId: item.jobId, observation: slot };
        const canonical = '{' + Object.keys(referenceInput).sort().map(key => JSON.stringify(key) + ':' + JSON.stringify(referenceInput[key])).join(',') + '}';
        insist(observation.artifactRef === 'artifact:execution:v1:' + digest(canonical), 'RECONCILIATION_OPAQUE_REFERENCE_MISMATCH');
        insist(observation && observation.canonicalKeywordId === job.canonical_keyword_id && observation.objectRevision === job.object_revision
          && observation.adsAccountId === job.ads_account_id && observation.campaignId === job.campaign_id && observation.adGroupId === job.ad_group_id && observation.keywordId === job.keyword_id, 'RECONCILIATION_OBJECT_MISMATCH');
        const directory = path.join(binding.canonicalStoresRoot, item.storeId, 'evidence/ad-execution-reconciliation', `batch-${digest(row.batch_id).slice(0, 24)}`, `job-${digest(item.jobId).slice(0, 24)}`);
        const expected = path.join(directory, `case-${digest(item.caseId).slice(0, 24)}-session-${storedContext.sessionGeneration}-${slot}.png`);
        insist(path.resolve(proof.path) === path.resolve(expected) && hashEqual(proof.sha256, observation.contentSha256), 'RECONCILIATION_ARTIFACT_NOT_BOUND');
        timeWithin(observation.capturedAt, context.execution, 'reconciliation-' + slot);
        const artifact = readArtifact(context.root, proof, binding.canonicalStoresRoot);
        require('./canary-png-evidence').inspectPngEvidenceBytes(artifact.bytes);
      }
      insist(item.artifacts?.length === 2 && item.artifacts[0].sha256 !== item.artifacts[1].sha256, 'RECONCILIATION_ORIGINALS_REQUIRED');
      timeWithin(row.completed_at, context.execution, 'reconciliation-completed');
    }
  });
  return true;
}
function verifyAiBudget(raw, descriptor, context) {
  insist(raw.kind === 'v16-ai-cost-budget' && raw.schemaVersion === 1 && raw.stores?.length > 0, 'AI_BUDGET_SCHEMA_MISMATCH');
  withAuthorityDatabase(descriptor, context, db => {
    for (const store of raw.stores) {
      const row = db.prepare('SELECT policy_json FROM ai_spend_policies WHERE store_id=? AND revision=?').get(store.storeId, store.policyRevision);
      insist(row, 'AI_POLICY_NOT_FOUND');
      const policy = JSON.parse(row.policy_json);
      insist(policy.owner === 'operator' && policy.enabled === true && policy.currency === 'USD' && Number.isSafeInteger(policy.budgetMicrousd) && policy.budgetMicrousd > 0 && policy.approvedAt, 'AI_POLICY_NOT_APPROVED');
      const latest = db.prepare('SELECT MAX(revision) AS revision FROM ai_spend_policies WHERE store_id=?').get(store.storeId);
      insist(latest.revision === store.policyRevision, 'AI_POLICY_IS_NOT_CURRENT');
      const costs = db.prepare("SELECT record_json FROM ai_cost_records WHERE store_id=? AND started_at>=? AND started_at<? AND status<>'blocked' ORDER BY started_at,id").all(store.storeId, policy.windowStartsAt, policy.windowEndsAt).map(x => JSON.parse(x.record_json));
      insist(costs.length > 0 && same(costs.map(x => x.id), store.recordIds), 'AI_COST_RECORD_SET_MISMATCH');
      let committed = 0, reserved = 0, accepted = 0;
      for (const cost of costs) {
        const costPolicyRow = db.prepare('SELECT policy_json FROM ai_spend_policies WHERE store_id=? AND revision=?').get(store.storeId, cost.policyRevision);
        insist(costPolicyRow, 'AI_COST_POLICY_NOT_FOUND');
        const costPolicy = JSON.parse(costPolicyRow.policy_json);
        insist(cost.storeContext?.storeId === store.storeId && cost.providerBaseUrl === costPolicy.providerBaseUrl && cost.model === costPolicy.model, 'AI_COST_AUTHORITY_MISMATCH');
        timeWithin(cost.startedAt, context.execution, 'ai-call');
        insist(cost.startedAt >= policy.windowStartsAt && cost.startedAt <= policy.windowEndsAt, 'AI_COST_OUTSIDE_POLICY_WINDOW');
        if (cost.status === 'started') { insist(Number.isSafeInteger(cost.reservedMicrousd) && cost.reservedMicrousd >= 0, 'AI_RESERVATION_MISSING'); reserved += cost.reservedMicrousd; }
        else if (cost.status !== 'blocked') {
          insist(cost.costStatus !== 'unknown' && cost.reasonCode !== 'AI_BILLING_BOUND_EXCEEDED' && Number.isSafeInteger(cost.costMicrousd) && cost.costMicrousd >= 0, 'AI_COST_UNKNOWN');
          const usage = cost.usage;
          insist(usage && [usage.promptTokens, usage.completionTokens, usage.totalTokens].every(x => Number.isSafeInteger(x) && x >= 0) && usage.totalTokens === usage.promptTokens + usage.completionTokens, 'AI_USAGE_INVALID');
          const recomputed = (BigInt(usage.promptTokens) * BigInt(costPolicy.inputMicrousdPerMillion) + BigInt(usage.completionTokens) * BigInt(costPolicy.outputMicrousdPerMillion) + 999999n) / 1000000n;
          insist(recomputed === BigInt(cost.costMicrousd), 'AI_COST_NOT_RECOMPUTED');
          committed += cost.costMicrousd;
        }
        const audit = db.prepare("SELECT output_json FROM ai_call_logs WHERE store_id=? AND prompt_key='paid-ai-output' AND input_hash=?").all(store.storeId, digest(`paid-ai-output:${cost.id}`));
        if (audit.length === 1) {
          const output = JSON.parse(audit[0].output_json);
          if (cost.status === 'succeeded' && output.schemaVersion === 'paid-ai-output/v16' && output.output?.costRecordId === cost.id && output.output.status === 'accepted') accepted += 1;
        }
      }
      insist(accepted > 0 && committed + reserved <= policy.budgetMicrousd && committed === store.committedMicrousd && reserved === store.reservedMicrousd, 'AI_BUDGET_EXCEEDED_OR_UNVALIDATED');
    }
  });
  return true;
}
module.exports = { authorityContext, verifyAuthority, verifyAuthorityCurrentness, verifyContinuous, verifyCanary, verifyOfflineMigration, verifyLiveMigration, withAuthorityDatabase, verifyReconciliation, verifyAiBudget };

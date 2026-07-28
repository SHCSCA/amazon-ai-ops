const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const {
  EXECUTION_CANARY_AUTHORITY_QUERY_CONTRACT,
  EXECUTION_CANARY_KIND,
  EXECUTION_CANARY_SCHEMA_VERSION,
  deterministicExecutionArtifactPath,
  deterministicExecutionArtifactRef,
  validateExecutionCanary,
} = require('./verify-mission-control-production-readiness');
const {
  loadAuthoritySnapshotManifest,
} = require('./verify-s7-continuous-operation');
const {
  computeCanonicalPackageIdentity,
} = require('./export-mission-control-authority-snapshot');
const {
  assertMatchingAuthorityCurrentnessProofs,
  captureAuthoritySnapshotCurrentness,
} = require('./sqlite-authority-currentness');

const ROOT = path.resolve(__dirname, '..');
const requireFromLocalDb = createRequire(path.join(ROOT, 'packages', 'local-db', 'package.json'));
const AUTHORITY_SNAPSHOT_SCHEMA_VERSION = 'mission-control-authority-database-snapshot/v2';
const BACKUP_METHOD = 'sqlite-online-backup';
const CANARY_MAX_AGE_MS = 72 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const AUTHORITY_DATABASE_NAME = 'amazon-ai-ops.db';
const EXECUTION_CANARY_OUTPUT_DIRECTORY_NAME = 'execution-canaries';
const PNG_SIGNATURE_HEX = '89504E470D0A1A0A';
const PNG_IHDR_LENGTH = 13;
const PACKAGE_IDENTITY_FIELDS = Object.freeze([
  'executableSha256',
  'appContentSha256',
  'mainBundleSha256',
]);
const EXECUTION_SLOTS = Object.freeze(['before', 'after', 'reload']);
const MODES = new Set(['manual_approval', 'policy_auto']);
const OPTION_NAMES = new Set([
  'authority-snapshot-manifest',
  'mode',
  'store-id',
  'authority-id',
  'mission-grant-id',
  'batch-id',
  'job-id',
  'stores-root',
  'before-artifact',
  'after-artifact',
  'reload-artifact',
  'out',
]);

function fail(message) {
  throw new Error(message);
}

function defaultContext() {
  const releaseRoot = path.join(ROOT, 'apps', 'desktop', 'release');
  const executablePath = path.join(releaseRoot, 'win-unpacked', 'AmazonAIOpsAgent.exe');
  const appContentPath = path.join(releaseRoot, 'win-unpacked', 'resources', 'app');
  const mainBundlePath = path.join(appContentPath, 'dist', 'main', 'index.js');
  const canonicalEvidenceRoot = path.join(ROOT, 'output', 'codex-evidence');
  return {
    Database: requireFromLocalDb('better-sqlite3'),
    authoritySnapshotRoot: path.join(ROOT, 'output', 'codex-evidence', 'authority-snapshots'),
    canonicalEvidenceRoot,
    executionCanaryOutputRoot: path.join(
      canonicalEvidenceRoot,
      EXECUTION_CANARY_OUTPUT_DIRECTORY_NAME,
    ),
    executablePath,
    appContentPath,
    mainBundlePath,
    releaseRoot,
    now: () => new Date(),
    randomUUID: () => crypto.randomUUID(),
    afterOutputWritten: null,
    inspectCanonicalPackage: () => ({
      packageIdentity: computeCanonicalPackageIdentity({
        executablePath,
        appContentPath,
        mainBundlePath,
        releaseRoot,
      }),
      builtAtMs: Math.max(
        fs.statSync(executablePath).mtimeMs,
        fs.statSync(mainBundlePath).mtimeMs,
        latestTreeMtimeMs(appContentPath),
      ),
    }),
  };
}

function latestTreeMtimeMs(rootPath) {
  const rootStat = fs.lstatSync(rootPath);
  if (rootStat.isSymbolicLink()) fail(`Canonical package contains a filesystem link: ${rootPath}`);
  let latest = rootStat.mtimeMs;
  if (!rootStat.isDirectory()) return latest;
  for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
    latest = Math.max(latest, latestTreeMtimeMs(path.join(rootPath, entry.name)));
  }
  return latest;
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function isSha256(value) {
  return typeof value === 'string' && /^[A-F0-9]{64}$/i.test(value);
}

function normalizeSha256(value, label) {
  if (!isSha256(value)) fail(`${label} must be a SHA-256 digest.`);
  return String(value).toUpperCase();
}

function validTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function samePath(left, right) {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

function isPathContained(rootPath, candidatePath) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === ''
    || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function assertCleanAbsolutePath(candidate, label) {
  if (typeof candidate !== 'string'
    || candidate !== candidate.trim()
    || candidate.includes('\0')
    || !path.isAbsolute(candidate)) {
    fail(`${label} must be a clean absolute path.`);
  }
  return path.resolve(candidate);
}

function assertDirectDirectory(candidate, label) {
  const resolved = assertCleanAbsolutePath(candidate, label);
  if (!fs.existsSync(resolved)) fail(`${label} does not exist: ${resolved}`);
  const linkStat = fs.lstatSync(resolved);
  const realPath = fs.realpathSync.native(resolved);
  const stat = fs.statSync(realPath);
  if (linkStat.isSymbolicLink() || !stat.isDirectory() || !samePath(resolved, realPath)) {
    fail(`${label} must be a direct real directory without symlink, junction, or reparse traversal.`);
  }
  return realPath;
}

function assertUniqueRegularFile(candidate, label) {
  const resolved = assertCleanAbsolutePath(candidate, label);
  if (!fs.existsSync(resolved)) fail(`${label} does not exist: ${resolved}`);
  const linkStat = fs.lstatSync(resolved);
  const realPath = fs.realpathSync.native(resolved);
  const stat = fs.statSync(realPath);
  if (linkStat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1 || !samePath(resolved, realPath)) {
    fail(`${label} must be one unique regular file without symlink, junction, reparse, or hardlink traversal.`);
  }
  return { path: realPath, stat };
}

function normalizePackageIdentity(value, label = 'packageIdentity') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} is missing.`);
  }
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = [...PACKAGE_IDENTITY_FIELDS].sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    fail(`${label} must contain exactly ${PACKAGE_IDENTITY_FIELDS.join(', ')}.`);
  }
  return Object.fromEntries(PACKAGE_IDENTITY_FIELDS.map((field) => [
    field,
    normalizeSha256(value[field], `${label}.${field}`),
  ]));
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function stableEqual(left, right) {
  return stableJson(left) === stableJson(right);
}

function cleanIdentifier(value, label, { normalized = false } = {}) {
  if (typeof value !== 'string'
    || value !== value.trim()
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/.test(value)) {
    fail(`${label} is invalid.`);
  }
  if (normalized && (value !== value.toLowerCase() || value.length > 128)) {
    fail(`${label} must be a normalized lowercase logical id.`);
  }
  return value;
}

function parseJsonArray(value, label) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    fail(`${label} is not valid JSON.`);
  }
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string' || item.length === 0)) {
    fail(`${label} must be an array of non-empty strings.`);
  }
  if (new Set(parsed).size !== parsed.length) fail(`${label} contains duplicates.`);
  return parsed;
}

function parseJsonObject(value, label) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    fail(`${label} is not valid JSON.`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail(`${label} must be an object.`);
  }
  return parsed;
}

function parseStopConditionCodes(value, label) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    fail(`${label} is not valid JSON.`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    fail(`${label} must be a non-empty array.`);
  }
  const codes = parsed.map((item) => {
    if (typeof item === 'string' && item.length > 0) return item;
    if (item && typeof item === 'object' && !Array.isArray(item)
      && typeof item.code === 'string' && item.code.length > 0) {
      return item.code;
    }
    fail(`${label} contains an invalid stop condition.`);
    return null;
  });
  if (new Set(codes).size !== codes.length) fail(`${label} contains duplicate stop-condition codes.`);
  return codes;
}

function requireRow(database, sql, parameters, label) {
  const row = database.prepare(sql).get(...parameters);
  if (!row) fail(`${label} is missing from the authority snapshot.`);
  return row;
}

function assertCondition(condition, message) {
  if (!condition) fail(message);
}

function assertArtifactDescriptor(value, label) {
  assertCondition(value && typeof value === 'object' && !Array.isArray(value), `${label} is missing.`);
  normalizeSha256(value.sha256, `${label}.sha256`);
  assertCondition(Number.isInteger(value.sizeBytes) && value.sizeBytes >= 0, `${label}.sizeBytes is invalid.`);
  assertCondition(Number.isFinite(value.mtimeMs) && value.mtimeMs >= 0, `${label}.mtimeMs is invalid.`);
}

function validateAuthoritySnapshotV2(authoritySnapshot, nowMs) {
  const { manifest } = authoritySnapshot;
  assertCondition(
    manifest.schemaVersion === AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
    `Authority snapshot must use ${AUTHORITY_SNAPSHOT_SCHEMA_VERSION}.`,
  );
  const startedAtMs = Date.parse(manifest.backup?.startedAt);
  const completedAtMs = Date.parse(manifest.backup?.completedAt);
  const exportedAtMs = Date.parse(manifest.exportedAt);
  assertCondition(
    manifest.backup?.method === BACKUP_METHOD
      && manifest.backup.completed === true
      && Number.isInteger(manifest.backup.totalPages)
      && manifest.backup.totalPages > 0
      && manifest.backup.remainingPages === 0
      && Number.isFinite(startedAtMs)
      && Number.isFinite(completedAtMs)
      && startedAtMs <= completedAtMs
      && completedAtMs === exportedAtMs,
    'Authority snapshot does not prove one ordered, completed SQLite online backup.',
  );
  assertCondition(
    exportedAtMs <= nowMs + MAX_FUTURE_SKEW_MS && nowMs - exportedAtMs <= CANARY_MAX_AGE_MS,
    'Authority snapshot is future-dated or stale and cannot be replayed for a current canary.',
  );
  assertCondition(
    manifest.source?.openedReadOnly === true
      && manifest.source.queryOnly === true
      && stableEqual(manifest.source.integrityCheck, ['ok'])
      && stableEqual(manifest.source.foreignKeyCheck, []),
    'Authority snapshot source does not carry the read-only integrity contract.',
  );
  const sourceAbsolutePath = assertCleanAbsolutePath(
    manifest.source?.absolutePath,
    'Authority snapshot source.absolutePath',
  );
  const sourceRealPath = assertCleanAbsolutePath(
    manifest.source?.realPath,
    'Authority snapshot source.realPath',
  );
  assertCondition(
    samePath(sourceAbsolutePath, sourceRealPath),
    'Authority snapshot source absolutePath/realPath binding is invalid.',
  );
  assertArtifactDescriptor(manifest.source.artifactBefore, 'Authority snapshot source.artifactBefore');
  assertArtifactDescriptor(manifest.source.artifactAfter, 'Authority snapshot source.artifactAfter');
  assertCondition(
    manifest.snapshot?.openedReadOnly === true
      && manifest.snapshot.queryOnly === true
      && stableEqual(manifest.snapshot.integrityCheck, ['ok'])
      && stableEqual(manifest.snapshot.foreignKeyCheck, []),
    'Authority snapshot database does not carry the read-only integrity contract.',
  );
  assertCondition(
    !samePath(sourceAbsolutePath, authoritySnapshot.databasePath),
    'Authority snapshot may not alias the live source database.',
  );
  normalizePackageIdentity(manifest.packageIdentity, 'Authority snapshot packageIdentity');
}

function deriveCanonicalUserDataBoundary(authoritySnapshot) {
  const sourcePath = assertCleanAbsolutePath(
    authoritySnapshot.manifest.source.absolutePath,
    'Authority snapshot source database',
  );
  assertCondition(
    path.basename(sourcePath).toLowerCase() === AUTHORITY_DATABASE_NAME,
    `Authority snapshot source must be the canonical ${AUTHORITY_DATABASE_NAME} USER_DATA_DIR database.`,
  );
  const sourceArtifact = assertUniqueRegularFile(sourcePath, 'Live USER_DATA_DIR authority database');
  const userDataDir = assertDirectDirectory(
    path.dirname(sourceArtifact.path),
    'Authority snapshot source USER_DATA_DIR',
  );
  assertCondition(
    samePath(sourceArtifact.path, path.join(userDataDir, AUTHORITY_DATABASE_NAME)),
    'Authority snapshot source is not the canonical USER_DATA_DIR database location.',
  );
  const storesRoot = assertDirectDirectory(
    path.join(userDataDir, 'stores'),
    'Canonical USER_DATA_DIR stores root',
  );
  assertCondition(
    isPathContained(userDataDir, storesRoot) && samePath(path.dirname(storesRoot), userDataDir),
    'Canonical stores root is not a direct USER_DATA_DIR child.',
  );
  return {
    sourceDatabasePath: sourceArtifact.path,
    storesRoot,
    userDataDir,
  };
}

function captureLiveAuthorityCurrentness(
  authoritySnapshot,
  context,
  captureLabel,
) {
  const capture = context.captureAuthoritySnapshotCurrentness
    ?? captureAuthoritySnapshotCurrentness;
  assertCondition(
    typeof capture === 'function',
    'Authority currentness capture implementation is invalid.',
  );
  return capture({
    sourceDatabasePath: authoritySnapshot.manifest.source.absolutePath,
    expectedSnapshotArtifact: authoritySnapshot.snapshotArtifact,
    captureLabel,
  }, {
    ...(context.authorityCurrentnessContext ?? {}),
    now: context.now,
  });
}

function inspectCurrentPackage(context) {
  const inspected = context.inspectCanonicalPackage();
  const packageIdentity = normalizePackageIdentity(
    inspected?.packageIdentity,
    'Current canonical package identity',
  );
  assertCondition(
    Number.isFinite(inspected?.builtAtMs) && inspected.builtAtMs > 0,
    'Current canonical package build timestamp is invalid.',
  );
  return { packageIdentity, builtAtMs: inspected.builtAtMs };
}

function validatePngArtifact(filePath, label) {
  const handle = fs.openSync(filePath, 'r');
  const header = Buffer.alloc(33);
  let bytesRead;
  try {
    bytesRead = fs.readSync(handle, header, 0, header.length, 0);
  } finally {
    fs.closeSync(handle);
  }
  assertCondition(bytesRead === header.length, `${label} is too short to contain PNG signature and IHDR.`);
  assertCondition(
    header.subarray(0, 8).toString('hex').toUpperCase() === PNG_SIGNATURE_HEX,
    `${label} does not have the PNG file signature.`,
  );
  assertCondition(
    header.readUInt32BE(8) === PNG_IHDR_LENGTH
      && header.subarray(12, 16).toString('ascii') === 'IHDR'
      && header.readUInt32BE(16) > 0
      && header.readUInt32BE(20) > 0,
    `${label} does not contain a valid first IHDR chunk.`,
  );
}

function validateStoreCapsulePaths(options, authority, canonicalStoresRoot) {
  const requestedStoresRoot = assertCleanAbsolutePath(options.storesRoot, 'Store Capsule root');
  assertCondition(
    samePath(requestedStoresRoot, canonicalStoresRoot),
    'CLI storesRoot must equal the canonical stores directory derived from the snapshot source USER_DATA_DIR.',
  );
  const storesRoot = assertDirectDirectory(canonicalStoresRoot, 'Store Capsule root');
  const storeRoot = path.join(storesRoot, options.storeId);
  const resolvedStoreRoot = assertDirectDirectory(storeRoot, 'Selected Store Capsule');
  assertCondition(
    isPathContained(storesRoot, resolvedStoreRoot),
    'Selected Store Capsule escapes the Store Capsule root.',
  );
  const artifactPaths = {};
  for (const slot of EXECUTION_SLOTS) {
    const requested = assertCleanAbsolutePath(options.artifactPaths[slot], `${slot} artifact`);
    const expected = deterministicExecutionArtifactPath(
      storesRoot,
      options.storeId,
      authority.batchId,
      authority.jobId,
      slot,
    );
    assertCondition(
      samePath(requested, expected),
      `${slot} artifact is not the deterministic Store Capsule path for the selected store/batch/job.`,
    );
    const artifact = assertUniqueRegularFile(requested, `${slot} Store Capsule artifact`);
    assertCondition(
      isPathContained(resolvedStoreRoot, artifact.path),
      `${slot} Store Capsule artifact escapes the selected store boundary.`,
    );
    validatePngArtifact(artifact.path, `${slot} Store Capsule artifact`);
    artifactPaths[slot] = artifact;
  }
  return { storesRoot, artifactPaths };
}

function readAuthorityRows(database, options) {
  const store = requireRow(database, `
    SELECT store_id AS storeId, browser_profile_id AS browserProfileId,
           marketplace, currency, status
    FROM stores WHERE store_id = ?
  `, [options.storeId], 'Selected store');

  const grant = requireRow(database, `
    SELECT id, store_id AS storeId, marketplace, currency,
           mission_id AS missionId, mission_revision AS missionRevision,
           decision_ids_json AS decisionIdsJson,
           action_revision AS actionRevision,
           allowed_action_types_json AS allowedActionTypesJson,
           allowed_ad_entity_ids_json AS allowedAdEntityIdsJson,
           max_change_pct AS maxChangePct, total_impact_budget AS totalImpactBudget,
           expires_at AS expiresAt, policy_version_id AS policyVersionId,
           policy_revision AS policyRevision, required_evidence_json AS requiredEvidenceJson,
           stop_conditions_json AS stopConditionsJson, issuer_type AS issuerType,
           issued_at AS issuedAt, created_session_generation AS createdSessionGeneration
    FROM mission_grants WHERE store_id = ? AND id = ?
  `, [options.storeId, options.missionGrantId], 'Selected MissionGrant');

  const batch = requireRow(database, `
    SELECT id, store_id AS storeId, marketplace, currency,
           mission_id AS missionId, mission_revision AS missionRevision,
           grant_id AS grantId, action_revision AS actionRevision,
           status, created_session_generation AS createdSessionGeneration,
           created_at AS createdAt, updated_at AS updatedAt,
           terminal_at AS terminalAt
    FROM ad_execution_batches WHERE store_id = ? AND id = ?
  `, [options.storeId, options.batchId], 'Selected execution batch');

  const job = requireRow(database, `
    SELECT id, store_id AS storeId, batch_id AS batchId,
           mission_id AS missionId, grant_id AS grantId,
           proposal_id AS proposalId, decision_id AS decisionId,
           decision_revision AS decisionRevision,
           action_revision AS actionRevision, action_type AS actionType,
           canonical_keyword_id AS canonicalKeywordId,
           ad_entity_id AS adEntityId, entity_revision AS entityRevision,
           ads_account_id AS adsAccountId, campaign_id AS campaignId,
           ad_group_id AS adGroupId, keyword_id AS keywordId,
           object_revision AS objectRevision, page_identity_hash AS pageIdentityHash,
           expected_bid_cents AS expectedBidCents,
           target_bid_cents AS targetBidCents, change_pct AS changePct,
           status, created_session_generation AS createdSessionGeneration,
           created_at AS createdAt, updated_at AS updatedAt,
           submitted_at AS submittedAt,
           terminal_at AS terminalAt
    FROM ad_execution_jobs WHERE store_id = ? AND id = ?
  `, [options.storeId, options.jobId], 'Selected execution job');

  const sourceAuthority = requireRow(database, `
    SELECT authority_id AS authorityId, store_id AS storeId,
           ad_entity_id AS adEntityId, entity_revision AS entityRevision,
           entity_type AS entityType, proof_sha256 AS proofSha256
    FROM verified_ad_entity_authority
    WHERE store_id = ? AND authority_id = ?
  `, [options.storeId, options.authorityId], 'Selected verified ad-entity authority');

  const identity = requireRow(database, `
    SELECT identity_version_id AS identityVersionId, store_id AS storeId,
           marketplace, currency, canonical_keyword_id AS canonicalKeywordId,
           ad_entity_id AS adEntityId, entity_revision AS entityRevision,
           ads_account_id AS adsAccountId, campaign_id AS campaignId,
           ad_group_id AS adGroupId, keyword_id AS keywordId,
           object_revision AS objectRevision, observed_bid_cents AS observedBidCents,
           page_identity_hash AS pageIdentityHash,
           source_authority_id AS sourceAuthorityId,
           source_authority_proof_sha256 AS sourceAuthorityProofSha256,
           resolved_session_generation AS resolvedSessionGeneration,
           resolved_at AS resolvedAt, created_at AS createdAt
    FROM ad_keyword_identity_versions
    WHERE store_id = ? AND canonical_keyword_id = ? AND object_revision = ?
  `, [options.storeId, job.canonicalKeywordId, job.objectRevision], 'Canonical keyword identity');

  const mission = requireRow(database, `
    SELECT id, store_id AS storeId, marketplace, currency,
           policy_version_id AS policyVersionId, status, revision
    FROM missions WHERE store_id = ? AND id = ?
  `, [options.storeId, job.missionId], 'Bound Mission');

  const policy = requireRow(database, `
    SELECT id, store_id AS storeId, status, rules_json AS rulesJson, revision
    FROM policy_versions WHERE store_id = ? AND id = ?
  `, [options.storeId, grant.policyVersionId], 'Bound policy version');

  const runtime = requireRow(database, `
    SELECT store_id AS storeId, autonomy_mode AS autonomyMode,
           kill_switch AS killSwitch, circuit_breaker_state AS circuitBreakerState,
           active_policy_version_id AS activePolicyVersionId
    FROM policy_runtime WHERE store_id = ?
  `, [options.storeId], 'Policy runtime');

  const decision = requireRow(database, `
    SELECT id, store_id AS storeId, mission_id AS missionId,
           policy_version_id AS policyVersionId, policy_revision AS policyRevision,
           action_revision AS actionRevision, action_type AS actionType,
           ad_entity_id AS adEntityId, status, revision, valid_until AS validUntil,
           created_at AS createdAt, updated_at AS updatedAt
    FROM decisions WHERE store_id = ? AND id = ?
  `, [options.storeId, job.decisionId], 'Bound decision');

  const proposal = requireRow(database, `
    SELECT proposal.id, proposal.store_id AS storeId,
           proposal.marketplace, proposal.currency,
           proposal.mission_id AS missionId, proposal.mission_revision AS missionRevision,
           proposal.policy_version_id AS policyVersionId,
           proposal.policy_revision AS policyRevision,
           proposal.action_revision AS actionRevision,
           proposal.action_type AS actionType, proposal.entity_type AS entityType,
           proposal.ad_entity_authority_id AS adEntityAuthorityId,
           proposal.ad_entity_id AS adEntityId,
           proposal.ad_entity_revision AS adEntityRevision,
           proposal.current_bid_cents AS currentBidCents,
           proposal.proposed_bid_cents AS proposedBidCents,
           proposal.change_pct AS changePct,
           proposal.authorization_json AS authorizationJson,
           proposal.valid_until AS validUntil,
           proposal.created_session_generation AS createdSessionGeneration,
           proposal.created_at AS createdAt,
           link.decision_id AS linkedDecisionId
    FROM analysis_proposal_decision_links link
    JOIN analysis_proposal_snapshots proposal
      ON proposal.store_id = link.store_id AND proposal.id = link.proposal_id
    WHERE link.store_id = ? AND link.proposal_id = ? AND link.decision_id = ?
  `, [options.storeId, job.proposalId, job.decisionId], 'Bound proposal/decision link');

  const grantEvents = database.prepare(`
    SELECT event_type AS eventType, created_at AS createdAt
    FROM mission_grant_events
    WHERE store_id = ? AND grant_id = ?
    ORDER BY created_at, id
  `).all(options.storeId, grant.id);

  const decisionApproval = requireRow(database, `
    SELECT decision_id AS decisionId, decision_revision AS decisionRevision,
           event_type AS eventType, created_at AS createdAt
    FROM decision_history
    WHERE store_id = ? AND decision_id = ?
      AND decision_revision = ? AND event_type = 'approved'
  `, [options.storeId, job.decisionId, job.decisionRevision], 'Bound decision approval history');

  const evidence = database.prepare(`
    SELECT id, store_id AS storeId, batch_id AS batchId, job_id AS jobId,
           slot, artifact_ref AS artifactRef, content_sha256 AS contentSha256,
           page_identity_hash AS pageIdentityHash,
           canonical_keyword_id AS canonicalKeywordId,
           object_revision AS objectRevision,
           observed_bid_cents AS observedBidCents,
           captured_session_generation AS capturedSessionGeneration,
           captured_at AS capturedAt, created_at AS createdAt
    FROM ad_execution_evidence
    WHERE store_id = ? AND job_id = ?
    ORDER BY CASE slot WHEN 'before' THEN 1 WHEN 'after' THEN 2 ELSE 3 END
  `).all(options.storeId, job.id);

  const batchJobCount = Number(database.prepare(`
    SELECT COUNT(*) AS count
    FROM ad_execution_jobs WHERE store_id = ? AND batch_id = ?
  `).get(options.storeId, batch.id)?.count);

  return {
    batch,
    batchJobCount,
    decision,
    decisionApproval,
    evidence,
    grant,
    grantEvents,
    identity,
    job,
    mission,
    policy,
    proposal,
    runtime,
    sourceAuthority,
    store,
  };
}

function timestampMs(value, label) {
  if (!validTimestamp(value)) fail(`${label} is missing or invalid.`);
  return Date.parse(value);
}

function assertFreshTimestamp(value, label, nowMs) {
  const valueMs = timestampMs(value, label);
  assertCondition(
    valueMs <= nowMs + MAX_FUTURE_SKEW_MS && nowMs - valueMs <= CANARY_MAX_AGE_MS,
    `${label} is future-dated or older than the 72-hour execution-canary window.`,
  );
  return valueMs;
}

function validateAuthorityRows(
  rows,
  options,
  snapshotExportedAtMs,
  packageBuiltAtMs,
  exporterNowMs,
) {
  const {
    batch,
    batchJobCount,
    decision,
    decisionApproval,
    evidence,
    grant,
    grantEvents,
    identity,
    job,
    mission,
    policy,
    proposal,
    runtime,
    sourceAuthority,
    store,
  } = rows;
  const expectedIssuer = options.mode === 'manual_approval' ? 'human' : 'policy';

  assertCondition(
    store.storeId === options.storeId
      && cleanIdentifier(store.browserProfileId, 'Store browserProfileId', { normalized: true })
      && store.marketplace === 'US'
      && store.currency === 'USD'
      && store.status === 'active',
    'Selected store/Profile is not active US/USD authority.',
  );
  assertCondition(
    grant.id === options.missionGrantId
      && grant.storeId === store.storeId
      && grant.marketplace === 'US'
      && grant.currency === 'USD'
      && grant.issuerType === expectedIssuer,
    `MissionGrant does not belong to ${options.mode} authority.`,
  );
  assertCondition(
    batch.id === options.batchId
      && batch.storeId === store.storeId
      && batch.grantId === grant.id
      && batch.missionId === grant.missionId
      && batch.missionRevision === grant.missionRevision
      && batch.actionRevision === grant.actionRevision
      && batch.marketplace === 'US'
      && batch.currency === 'USD'
      && batch.status === 'succeeded'
      && validTimestamp(batch.terminalAt),
    'Execution batch is not the selected terminal succeeded MissionGrant execution.',
  );
  assertCondition(batchJobCount === 1, 'A production canary batch must contain exactly one execution job.');
  assertCondition(
    job.id === options.jobId
      && job.storeId === store.storeId
      && job.batchId === batch.id
      && job.grantId === grant.id
      && job.missionId === grant.missionId
      && job.actionRevision === grant.actionRevision
      && job.actionType === 'set_keyword_bid'
      && job.status === 'succeeded'
      && validTimestamp(job.terminalAt),
    'Execution job is not the selected terminal succeeded canary action.',
  );

  const signedChangePct = ((job.targetBidCents - job.expectedBidCents) / job.expectedBidCents) * 100;
  assertCondition(
    Number.isInteger(job.expectedBidCents)
      && Number.isInteger(job.targetBidCents)
      && job.expectedBidCents > 0
      && job.targetBidCents > 0
      && job.targetBidCents < job.expectedBidCents
      && signedChangePct >= -10
      && Math.abs(Number(job.changePct) - signedChangePct) < 0.000001,
    'Execution job is not one exact down-bid within the 10% canary boundary.',
  );

  const decisionIds = parseJsonArray(grant.decisionIdsJson, 'MissionGrant decision_ids_json');
  const allowedActions = parseJsonArray(grant.allowedActionTypesJson, 'MissionGrant allowed_action_types_json');
  const allowedEntities = parseJsonArray(grant.allowedAdEntityIdsJson, 'MissionGrant allowed_ad_entity_ids_json');
  assertCondition(
    stableEqual(decisionIds, [job.decisionId])
      && stableEqual(allowedActions, ['set_keyword_bid'])
      && stableEqual(allowedEntities, [job.adEntityId])
      && Number(grant.maxChangePct) >= Math.abs(signedChangePct)
      && Number(grant.totalImpactBudget) >= Math.abs(job.expectedBidCents - job.targetBidCents) / 100,
    'MissionGrant is not an exact single-action canary authority for this job.',
  );
  const requiredEvidence = parseJsonArray(grant.requiredEvidenceJson, 'MissionGrant required_evidence_json');
  for (const required of [
    'before_screenshot',
    'after_screenshot',
    'reload_screenshot',
    'page_identity',
    'readback_value',
  ]) {
    assertCondition(requiredEvidence.includes(required), `MissionGrant does not require ${required}.`);
  }
  const stopConditions = parseStopConditionCodes(
    grant.stopConditionsJson,
    'MissionGrant stop_conditions_json',
  );
  for (const required of [
    'identity_drift',
    'expected_before_mismatch',
    'unknown_result',
    'data_stale',
    'impact_budget_exhausted',
    'kill_switch',
  ]) {
    assertCondition(stopConditions.includes(required), `MissionGrant does not stop on ${required}.`);
  }
  const issuedEvents = grantEvents.filter((event) => event.eventType === 'issued');
  const consumedEvents = grantEvents.filter((event) => event.eventType === 'consumed');
  assertCondition(
    issuedEvents.length === 1
      && consumedEvents.length === 1
      && !grantEvents.some((event) => event.eventType === 'revoked' || event.eventType === 'expired')
      && validTimestamp(issuedEvents[0].createdAt)
      && validTimestamp(consumedEvents[0].createdAt)
      && Date.parse(issuedEvents[0].createdAt) < Date.parse(consumedEvents[0].createdAt),
    'MissionGrant is not one issued then consumed terminal authority.',
  );

  assertCondition(
    mission.id === job.missionId
      && mission.storeId === store.storeId
      && mission.marketplace === 'US'
      && mission.currency === 'USD'
      && mission.revision === grant.missionRevision
      && mission.policyVersionId === grant.policyVersionId
      && ['active', 'completed'].includes(mission.status),
    'Mission revision/policy binding does not match the canary execution.',
  );
  const policyRules = parseJsonObject(policy.rulesJson, 'Policy rules');
  assertCondition(
    policy.id === grant.policyVersionId
      && policy.storeId === store.storeId
      && policy.status === 'enabled'
      && policy.revision === grant.policyRevision
      && policyRules.killSwitch !== true,
    'Enabled policy version does not match the immutable MissionGrant policy binding.',
  );
  assertCondition(
    runtime.storeId === store.storeId
      && ['manual_approval', 'policy_auto'].includes(runtime.autonomyMode)
      && runtime.killSwitch === 0
      && runtime.circuitBreakerState === 'closed'
      && runtime.activePolicyVersionId === policy.id
      && (expectedIssuer !== 'policy' || runtime.autonomyMode === 'policy_auto'),
    `Policy runtime is not safe and exact for ${options.mode}.`,
  );
  assertCondition(
    decision.id === job.decisionId
      && decision.storeId === store.storeId
      && decision.missionId === mission.id
      && decision.policyVersionId === policy.id
      && decision.policyRevision === policy.revision
      && decision.actionRevision === grant.actionRevision
      && decision.actionType === 'set_keyword_bid'
      && decision.adEntityId === job.adEntityId
      && decision.revision === job.decisionRevision
      && ['approved', 'executed', 'verified'].includes(decision.status),
    'Decision revision/action/entity/policy binding does not match the execution job.',
  );
  const proposalAuthorization = parseJsonObject(proposal.authorizationJson, 'Proposal authorization');
  const authorizationLane = proposalAuthorization[expectedIssuer];
  assertCondition(
    proposal.id === job.proposalId
      && proposal.linkedDecisionId === decision.id
      && proposal.storeId === store.storeId
      && proposal.marketplace === 'US'
      && proposal.currency === 'USD'
      && proposal.missionId === mission.id
      && proposal.missionRevision === mission.revision
      && proposal.policyVersionId === policy.id
      && proposal.policyRevision === policy.revision
      && proposal.actionRevision === grant.actionRevision
      && proposal.actionType === 'set_keyword_bid'
      && proposal.entityType === 'keyword'
      && proposal.adEntityAuthorityId === sourceAuthority.authorityId
      && proposal.adEntityId === job.adEntityId
      && proposal.adEntityRevision === job.entityRevision
      && proposal.currentBidCents === job.expectedBidCents
      && proposal.proposedBidCents === job.targetBidCents
      && Math.abs(Number(proposal.changePct) - signedChangePct) < 0.000001
      && proposal.createdSessionGeneration === job.createdSessionGeneration
      && authorizationLane?.eligible === true
      && Array.isArray(authorizationLane.blockers)
      && authorizationLane.blockers.length === 0,
    'Immutable proposal/decision/policy authorization binding does not match the execution job.',
  );

  assertCondition(
    sourceAuthority.authorityId === options.authorityId
      && sourceAuthority.storeId === store.storeId
      && sourceAuthority.adEntityId === job.adEntityId
      && sourceAuthority.entityRevision === job.entityRevision
      && sourceAuthority.entityType === 'keyword'
      && isSha256(sourceAuthority.proofSha256),
    'Verified ad-entity authority does not match the selected job.',
  );
  assertCondition(
    identity.storeId === store.storeId
      && identity.marketplace === 'US'
      && identity.currency === 'USD'
      && identity.canonicalKeywordId === job.canonicalKeywordId
      && identity.adEntityId === job.adEntityId
      && identity.entityRevision === job.entityRevision
      && identity.adsAccountId === job.adsAccountId
      && identity.campaignId === job.campaignId
      && identity.adGroupId === job.adGroupId
      && identity.keywordId === job.keywordId
      && identity.objectRevision === job.objectRevision
      && identity.observedBidCents === job.expectedBidCents
      && normalizeSha256(identity.pageIdentityHash, 'Identity pageIdentityHash')
        === normalizeSha256(job.pageIdentityHash, 'Job pageIdentityHash')
      && identity.sourceAuthorityId === sourceAuthority.authorityId
      && normalizeSha256(identity.sourceAuthorityProofSha256, 'Identity source authority proof')
        === normalizeSha256(sourceAuthority.proofSha256, 'Authority proof'),
    'Canonical keyword identity does not match the job and verified authority.',
  );

  const authorityGeneration = job.createdSessionGeneration;
  assertCondition(
    Number.isInteger(authorityGeneration)
      && authorityGeneration > 0
      && batch.createdSessionGeneration === authorityGeneration
      && grant.createdSessionGeneration === authorityGeneration
      && proposal.createdSessionGeneration === authorityGeneration
      && identity.resolvedSessionGeneration === authorityGeneration,
    'Job, batch, MissionGrant, proposal, and canonical identity session generations do not match exactly.',
  );

  assertCondition(
    evidence.length === 3
      && new Set(evidence.map((record) => record.slot)).size === 3
      && EXECUTION_SLOTS.every((slot) => evidence.some((record) => record.slot === slot)),
    'Authority DB must contain exactly before/after/reload evidence for the selected job.',
  );
  const bySlot = new Map(evidence.map((record) => [record.slot, record]));
  const sessionGenerations = new Set();
  const artifactRefs = new Set();
  const contentHashes = new Set();
  for (const slot of EXECUTION_SLOTS) {
    const record = bySlot.get(slot);
    assertCondition(
      record.storeId === store.storeId
        && record.batchId === batch.id
        && record.jobId === job.id
        && record.canonicalKeywordId === job.canonicalKeywordId
        && record.objectRevision === job.objectRevision
        && normalizeSha256(record.pageIdentityHash, `${slot} pageIdentityHash`)
          === normalizeSha256(job.pageIdentityHash, 'Job pageIdentityHash')
        && record.artifactRef === deterministicExecutionArtifactRef(
          store.storeId,
          batch.id,
          job.id,
          slot,
        )
        && isSha256(record.contentSha256)
        && Number.isInteger(record.capturedSessionGeneration)
        && record.capturedSessionGeneration === authorityGeneration
        && validTimestamp(record.capturedAt)
        && validTimestamp(record.createdAt)
        && Date.parse(record.createdAt) >= Date.parse(record.capturedAt),
      `${slot} authority evidence is not an exact job/object/session record.`,
    );
    sessionGenerations.add(record.capturedSessionGeneration);
    artifactRefs.add(record.artifactRef);
    contentHashes.add(normalizeSha256(record.contentSha256, `${slot} content SHA`));
  }
  assertCondition(
    sessionGenerations.size === 1 && artifactRefs.size === 3 && contentHashes.size === 3,
    'Before/after/reload must be distinct artifacts from one session generation.',
  );
  const before = bySlot.get('before');
  const after = bySlot.get('after');
  const reload = bySlot.get('reload');
  assertCondition(
    before.observedBidCents === job.expectedBidCents
      && after.observedBidCents === job.targetBidCents
      && reload.observedBidCents === job.targetBidCents,
    'Before/after/reload bid values do not prove the exact requested change and reload persistence.',
  );
  assertCondition(
    Date.parse(before.capturedAt) < Date.parse(after.capturedAt)
      && Date.parse(after.capturedAt) < Date.parse(reload.capturedAt),
    'Before/after/reload capture timestamps are not strictly ordered.',
  );
  const latestEvidenceMs = Math.max(
    ...evidence.flatMap((record) => [Date.parse(record.capturedAt), Date.parse(record.createdAt)]),
  );
  const identityResolvedAtMs = assertFreshTimestamp(
    identity.resolvedAt,
    'Canonical identity resolvedAt',
    exporterNowMs,
  );
  const identityCreatedAtMs = assertFreshTimestamp(
    identity.createdAt,
    'Canonical identity createdAt',
    exporterNowMs,
  );
  const proposalCreatedAtMs = assertFreshTimestamp(
    proposal.createdAt,
    'Immutable proposal createdAt',
    exporterNowMs,
  );
  const decisionCreatedAtMs = assertFreshTimestamp(
    decision.createdAt,
    'Decision createdAt',
    exporterNowMs,
  );
  const decisionUpdatedAtMs = assertFreshTimestamp(
    decision.updatedAt,
    'Decision updatedAt',
    exporterNowMs,
  );
  const decisionApprovedAtMs = assertFreshTimestamp(
    decisionApproval.createdAt,
    'Decision approval timestamp',
    exporterNowMs,
  );
  const grantIssuedAtMs = assertFreshTimestamp(
    grant.issuedAt,
    'MissionGrant issuedAt',
    exporterNowMs,
  );
  const issuedEventAtMs = assertFreshTimestamp(
    issuedEvents[0].createdAt,
    'MissionGrant issued event timestamp',
    exporterNowMs,
  );
  const jobCreatedAtMs = assertFreshTimestamp(job.createdAt, 'Execution job createdAt', exporterNowMs);
  const batchCreatedAtMs = assertFreshTimestamp(
    batch.createdAt,
    'Execution batch createdAt',
    exporterNowMs,
  );
  const submittedAtMs = assertFreshTimestamp(
    job.submittedAt,
    'Execution job submittedAt',
    exporterNowMs,
  );
  const jobTerminalAtMs = assertFreshTimestamp(
    job.terminalAt,
    'Execution job terminalAt',
    exporterNowMs,
  );
  const batchTerminalAtMs = assertFreshTimestamp(
    batch.terminalAt,
    'Execution batch terminalAt',
    exporterNowMs,
  );
  const jobUpdatedAtMs = assertFreshTimestamp(
    job.updatedAt,
    'Execution job updatedAt',
    exporterNowMs,
  );
  const batchUpdatedAtMs = assertFreshTimestamp(
    batch.updatedAt,
    'Execution batch updatedAt',
    exporterNowMs,
  );
  const consumedAtMs = assertFreshTimestamp(
    consumedEvents[0].createdAt,
    'MissionGrant consumed event timestamp',
    exporterNowMs,
  );
  for (const record of evidence) {
    assertFreshTimestamp(record.capturedAt, `${record.slot} evidence capturedAt`, exporterNowMs);
    assertFreshTimestamp(record.createdAt, `${record.slot} evidence createdAt`, exporterNowMs);
  }
  const beforeCapturedAtMs = Date.parse(before.capturedAt);
  const afterCapturedAtMs = Date.parse(after.capturedAt);
  const reloadCapturedAtMs = Date.parse(reload.capturedAt);
  const beforeCreatedAtMs = Date.parse(before.createdAt);
  const afterCreatedAtMs = Date.parse(after.createdAt);
  assertCondition(
    identityResolvedAtMs >= packageBuiltAtMs
      && identityResolvedAtMs <= identityCreatedAtMs
      && identityCreatedAtMs <= jobCreatedAtMs
      && proposalCreatedAtMs <= decisionCreatedAtMs
      && decisionCreatedAtMs <= decisionApprovedAtMs
      && decisionApprovedAtMs <= decisionUpdatedAtMs
      && decisionApprovedAtMs <= grantIssuedAtMs
      && grantIssuedAtMs === issuedEventAtMs
      && Math.max(grantIssuedAtMs, identityResolvedAtMs) <= jobCreatedAtMs
      && batchCreatedAtMs <= jobCreatedAtMs
      && jobCreatedAtMs <= beforeCapturedAtMs
      && beforeCreatedAtMs <= submittedAtMs
      && submittedAtMs < afterCapturedAtMs
      && afterCreatedAtMs <= reloadCapturedAtMs
      && afterCapturedAtMs < reloadCapturedAtMs
      && latestEvidenceMs <= jobTerminalAtMs
      && jobTerminalAtMs <= jobUpdatedAtMs
      && jobTerminalAtMs <= batchTerminalAtMs
      && batchTerminalAtMs <= batchUpdatedAtMs
      && Math.max(jobUpdatedAtMs, batchUpdatedAtMs) <= consumedAtMs
      && consumedAtMs <= snapshotExportedAtMs
      && decisionUpdatedAtMs <= snapshotExportedAtMs
      && snapshotExportedAtMs <= exporterNowMs + MAX_FUTURE_SKEW_MS
      && timestampMs(grant.expiresAt, 'MissionGrant expiresAt') >= reloadCapturedAtMs
      && (!decision.validUntil
        || timestampMs(decision.validUntil, 'Decision validUntil') >= reloadCapturedAtMs)
      && timestampMs(proposal.validUntil, 'Proposal validUntil') >= reloadCapturedAtMs,
    'Package/identity/proposal/decision/grant/job/capture/terminal/snapshot timestamps are stale or not causally closed.',
  );
}

function attachArtifactProof(rows, pathProof) {
  const bySlot = new Map(rows.evidence.map((record) => [record.slot, record]));
  return EXECUTION_SLOTS.map((slot) => {
    const record = bySlot.get(slot);
    const artifact = pathProof.artifactPaths[slot];
    const currentSha256 = sha256File(artifact.path);
    assertCondition(
      currentSha256 === normalizeSha256(record.contentSha256, `${slot} database content SHA`),
      `${slot} Store Capsule artifact SHA-256 does not match the authority DB.`,
    );
    return {
      id: record.id,
      storeId: record.storeId,
      batchId: record.batchId,
      jobId: record.jobId,
      slot: record.slot,
      artifactPath: artifact.path,
      artifactRef: record.artifactRef,
      contentSha256: currentSha256,
      sizeBytes: artifact.stat.size,
      pageIdentityHash: normalizeSha256(record.pageIdentityHash, `${slot} page identity hash`),
      canonicalKeywordId: record.canonicalKeywordId,
      objectRevision: record.objectRevision,
      observedBidCents: record.observedBidCents,
      capturedSessionGeneration: record.capturedSessionGeneration,
      capturedAt: record.capturedAt,
      createdAt: record.createdAt,
    };
  });
}

function parseOptions(argv) {
  const values = {};
  let help = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help') {
      help = true;
      continue;
    }
    if (!token.startsWith('--')) fail(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    if (!OPTION_NAMES.has(key)) fail(`Unexpected argument: ${token}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) fail(`Missing value for ${token}`);
    if (Object.prototype.hasOwnProperty.call(values, key)) fail(`Duplicate argument: ${token}`);
    values[key] = value;
    index += 1;
  }
  if (help) return { help: true };
  for (const key of OPTION_NAMES) {
    if (!Object.prototype.hasOwnProperty.call(values, key)) fail(`--${key} is required.`);
  }
  if (!MODES.has(values.mode)) fail('--mode must be manual_approval or policy_auto.');
  return {
    authoritySnapshotManifestPath: assertCleanAbsolutePath(
      values['authority-snapshot-manifest'],
      '--authority-snapshot-manifest',
    ),
    mode: values.mode,
    storeId: cleanIdentifier(values['store-id'], '--store-id', { normalized: true }),
    authorityId: cleanIdentifier(values['authority-id'], '--authority-id'),
    missionGrantId: cleanIdentifier(values['mission-grant-id'], '--mission-grant-id'),
    batchId: cleanIdentifier(values['batch-id'], '--batch-id'),
    jobId: cleanIdentifier(values['job-id'], '--job-id'),
    storesRoot: assertCleanAbsolutePath(values['stores-root'], '--stores-root'),
    artifactPaths: {
      before: assertCleanAbsolutePath(values['before-artifact'], '--before-artifact'),
      after: assertCleanAbsolutePath(values['after-artifact'], '--after-artifact'),
      reload: assertCleanAbsolutePath(values['reload-artifact'], '--reload-artifact'),
    },
    outputPath: assertCleanAbsolutePath(values.out, '--out'),
  };
}

function normalizeProgrammaticOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) fail('Exporter options are missing.');
  if (!MODES.has(options.mode)) fail('mode must be manual_approval or policy_auto.');
  const artifactPaths = options.artifactPaths || {};
  return {
    authoritySnapshotManifestPath: assertCleanAbsolutePath(
      options.authoritySnapshotManifestPath,
      'authoritySnapshotManifestPath',
    ),
    mode: options.mode,
    storeId: cleanIdentifier(options.storeId, 'storeId', { normalized: true }),
    authorityId: cleanIdentifier(options.authorityId, 'authorityId'),
    missionGrantId: cleanIdentifier(options.missionGrantId, 'missionGrantId'),
    batchId: cleanIdentifier(options.batchId, 'batchId'),
    jobId: cleanIdentifier(options.jobId, 'jobId'),
    storesRoot: assertCleanAbsolutePath(options.storesRoot, 'storesRoot'),
    artifactPaths: Object.fromEntries(EXECUTION_SLOTS.map((slot) => [
      slot,
      assertCleanAbsolutePath(artifactPaths[slot], `${slot} artifactPath`),
    ])),
    outputPath: options.outputPath
      ? assertCleanAbsolutePath(options.outputPath, 'outputPath')
      : null,
  };
}

function validateCanonicalOutputBoundary(options, context, authoritySnapshot, userDataBoundary) {
  const canonicalEvidenceRoot = assertDirectDirectory(
    context.canonicalEvidenceRoot,
    'Canonical codex-evidence root',
  );
  const configuredOutputRoot = assertCleanAbsolutePath(
    context.executionCanaryOutputRoot,
    'Canonical execution-canary output root',
  );
  const expectedOutputRoot = path.join(
    canonicalEvidenceRoot,
    EXECUTION_CANARY_OUTPUT_DIRECTORY_NAME,
  );
  assertCondition(
    samePath(configuredOutputRoot, expectedOutputRoot),
    `Execution-canary output root must be the direct ${EXECUTION_CANARY_OUTPUT_DIRECTORY_NAME} child of codex-evidence.`,
  );
  assertCondition(
    samePath(path.dirname(configuredOutputRoot), canonicalEvidenceRoot),
    'Execution-canary output root is not a direct codex-evidence child.',
  );
  if (fs.existsSync(configuredOutputRoot)) {
    assertDirectDirectory(configuredOutputRoot, 'Canonical execution-canary output root');
  }

  const outputPath = assertCleanAbsolutePath(options.outputPath, 'Canary evidence output');
  assertCondition(
    samePath(path.dirname(outputPath), configuredOutputRoot),
    'Canary evidence output must be a direct file under output/codex-evidence/execution-canaries.',
  );
  assertCondition(
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,238}\.json$/i.test(path.basename(outputPath)),
    'Canary evidence output must use one safe, non-hidden .json filename.',
  );
  if (fs.existsSync(outputPath)) {
    fail(`Canary evidence output already exists and will not be overwritten: ${outputPath}`);
  }

  const forbiddenDirectories = [
    context.releaseRoot,
    context.authoritySnapshotRoot,
    userDataBoundary.userDataDir,
    userDataBoundary.storesRoot,
  ].map((candidate) => assertCleanAbsolutePath(candidate, 'Forbidden canary output boundary'));
  const forbiddenFiles = [
    authoritySnapshot.manifestPath,
    authoritySnapshot.databasePath,
    userDataBoundary.sourceDatabasePath,
  ].map((candidate) => assertCleanAbsolutePath(candidate, 'Forbidden canary output file'));
  for (const forbiddenDirectory of forbiddenDirectories) {
    assertCondition(
      !isPathContained(forbiddenDirectory, configuredOutputRoot)
        && !isPathContained(forbiddenDirectory, outputPath),
      `Canary evidence output may not be written under release, snapshot, live AppData, or Store Capsule paths: ${forbiddenDirectory}`,
    );
  }
  for (const forbiddenFile of forbiddenFiles) {
    assertCondition(
      !samePath(forbiddenFile, configuredOutputRoot) && !samePath(forbiddenFile, outputPath),
      `Canary evidence output may not alias a snapshot or live authority database file: ${forbiddenFile}`,
    );
  }
  return {
    canonicalEvidenceRoot,
    outputPath,
    outputRoot: configuredOutputRoot,
  };
}

function ensureCanonicalOutputDirectory(outputBoundary) {
  if (!fs.existsSync(outputBoundary.outputRoot)) {
    try {
      fs.mkdirSync(outputBoundary.outputRoot, { recursive: false });
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
  }
  const outputRoot = assertDirectDirectory(
    outputBoundary.outputRoot,
    'Canonical execution-canary output root',
  );
  assertCondition(
    samePath(path.dirname(outputRoot), outputBoundary.canonicalEvidenceRoot),
    'Execution-canary output root changed outside its canonical parent.',
  );
  return outputRoot;
}

function buildExecutionCanaryEvidence(rawOptions, injectedContext = {}) {
  const options = normalizeProgrammaticOptions(rawOptions);
  const context = { ...defaultContext(), ...injectedContext };
  const nowBeforeMs = context.now().getTime();
  assertCondition(Number.isFinite(nowBeforeMs), 'Exporter clock is invalid.');
  const authoritySnapshot = loadAuthoritySnapshotManifest(
    options.authoritySnapshotManifestPath,
    { authoritySnapshotRoot: context.authoritySnapshotRoot },
  );
  validateAuthoritySnapshotV2(authoritySnapshot, nowBeforeMs);
  const userDataBoundary = deriveCanonicalUserDataBoundary(authoritySnapshot);
  const snapshotIdentity = normalizePackageIdentity(
    authoritySnapshot.packageIdentity,
    'Authority snapshot packageIdentity',
  );
  const packageBefore = inspectCurrentPackage(context);
  assertCondition(
    stableEqual(snapshotIdentity, packageBefore.packageIdentity),
    'Authority snapshot packageIdentity does not match the current canonical package; package replay is rejected.',
  );
  const snapshotExportedAtMs = Date.parse(authoritySnapshot.manifest.exportedAt);
  assertCondition(
    snapshotExportedAtMs >= packageBefore.builtAtMs,
    'Authority snapshot predates the current canonical package build; package replay is rejected.',
  );

  const databaseArtifact = assertUniqueRegularFile(
    authoritySnapshot.databasePath,
    'Authority database snapshot',
  );
  const databaseSha256Before = sha256File(databaseArtifact.path);
  assertCondition(
    databaseSha256Before === normalizeSha256(
      authoritySnapshot.manifest.snapshot.sha256,
      'Authority snapshot SHA-256',
    ),
    'Authority database snapshot no longer matches its manifest.',
  );
  const currentnessBeforeWork = captureLiveAuthorityCurrentness(
    authoritySnapshot,
    context,
    `canary-${options.mode}-before-work`,
  );

  let database;
  let rows;
  let integrityCheck;
  let foreignKeyCheck;
  let queryExecutedAt;
  try {
    database = new context.Database(databaseArtifact.path, { readonly: true, fileMustExist: true });
    database.pragma('query_only = ON');
    assertCondition(
      Number(database.pragma('query_only', { simple: true })) === 1,
      'Authority database snapshot did not enter SQLite query_only mode.',
    );
    integrityCheck = database.pragma('integrity_check')
      .map((row) => String(row.integrity_check ?? row[Object.keys(row)[0]]));
    foreignKeyCheck = database.pragma('foreign_key_check');
    assertCondition(
      stableEqual(integrityCheck, ['ok']) && stableEqual(foreignKeyCheck, []),
      'Authority database snapshot failed live integrity or foreign-key verification.',
    );
    rows = readAuthorityRows(database, options);
    validateAuthorityRows(
      rows,
      options,
      snapshotExportedAtMs,
      packageBefore.builtAtMs,
      nowBeforeMs,
    );
    queryExecutedAt = context.now().toISOString();
    assertCondition(
      Date.parse(queryExecutedAt) >= snapshotExportedAtMs,
      'Authority query timestamp predates the selected snapshot.',
    );
  } finally {
    if (database) database.close();
  }
  assertCondition(
    sha256File(databaseArtifact.path) === databaseSha256Before,
    'Authority database snapshot changed during the read-only authority query.',
  );

  const pathProof = validateStoreCapsulePaths(options, {
    batchId: rows.batch.id,
    jobId: rows.job.id,
  }, userDataBoundary.storesRoot);
  const executionEvidence = attachArtifactProof(rows, pathProof);
  const packageAfter = inspectCurrentPackage(context);
  assertCondition(
    stableEqual(packageBefore, packageAfter),
    'Canonical package identity or build timestamp changed during canary evidence export.',
  );
  assertCondition(
    sha256File(databaseArtifact.path) === databaseSha256Before,
    'Authority database snapshot changed while Store Capsule artifacts were verified.',
  );
  const currentnessBeforeFinalOutput = captureLiveAuthorityCurrentness(
    authoritySnapshot,
    context,
    `canary-${options.mode}-before-final-output`,
  );
  const currentnessValidation = assertMatchingAuthorityCurrentnessProofs(
    [currentnessBeforeWork, currentnessBeforeFinalOutput],
    authoritySnapshot.snapshotArtifact,
    'Execution-canary authority currentness',
  );

  const generatedAt = context.now().toISOString();
  assertCondition(
    Date.parse(generatedAt) >= Date.parse(queryExecutedAt),
    'Canary evidence generatedAt predates the authority query.',
  );
  const recordIdentity = {
    storeId: rows.store.storeId,
    browserProfileId: rows.store.browserProfileId,
    authorityId: rows.sourceAuthority.authorityId,
    identityVersionId: rows.identity.identityVersionId,
    missionGrantId: rows.grant.id,
    batchId: rows.batch.id,
    jobId: rows.job.id,
    canonicalKeywordId: rows.identity.canonicalKeywordId,
    objectRevision: rows.identity.objectRevision,
    evidenceIds: executionEvidence.map((record) => record.id),
  };
  const evidence = {
    kind: EXECUTION_CANARY_KIND,
    schemaVersion: EXECUTION_CANARY_SCHEMA_VERSION,
    generatedAt,
    status: 'PASSED',
    passed: true,
    mode: options.mode,
    storesRoot: pathProof.storesRoot,
    packageIdentity: snapshotIdentity,
    authorityCurrentness: {
      method: currentnessValidation.method,
      expectedSnapshot: currentnessValidation.expectedSnapshot,
      captures: [currentnessBeforeWork, currentnessBeforeFinalOutput],
      passed: true,
    },
    scope: {
      storeId: rows.store.storeId,
      browserProfileId: rows.store.browserProfileId,
      marketplace: rows.store.marketplace,
      currency: rows.store.currency,
    },
    authority: {
      storeId: rows.store.storeId,
      browserProfileId: rows.store.browserProfileId,
      issuerType: rows.grant.issuerType,
      authorityId: rows.sourceAuthority.authorityId,
      missionId: rows.grant.missionId,
      missionRevision: rows.grant.missionRevision,
      missionGrantId: rows.grant.id,
      batchId: rows.batch.id,
      jobId: rows.job.id,
      proposalId: rows.job.proposalId,
      decisionId: rows.job.decisionId,
      decisionRevision: rows.job.decisionRevision,
      actionRevision: rows.job.actionRevision,
      policyVersionId: rows.grant.policyVersionId,
      policyRevision: rows.grant.policyRevision,
    },
    object: {
      storeId: rows.store.storeId,
      actionType: rows.job.actionType,
      identityVersionId: rows.identity.identityVersionId,
      canonicalKeywordId: rows.identity.canonicalKeywordId,
      adEntityId: rows.identity.adEntityId,
      entityRevision: rows.identity.entityRevision,
      objectRevision: rows.identity.objectRevision,
      adsAccountId: rows.identity.adsAccountId,
      campaignId: rows.identity.campaignId,
      adGroupId: rows.identity.adGroupId,
      keywordId: rows.identity.keywordId,
      pageIdentityHash: normalizeSha256(rows.identity.pageIdentityHash, 'Identity pageIdentityHash'),
      sourceAuthorityProofSha256: normalizeSha256(
        rows.identity.sourceAuthorityProofSha256,
        'Identity sourceAuthorityProofSha256',
      ),
      expectedBidCents: rows.job.expectedBidCents,
      targetBidCents: rows.job.targetBidCents,
    },
    execution: {
      status: rows.job.status,
      evidence: executionEvidence,
    },
    database: {
      absolutePath: databaseArtifact.path,
      sha256: databaseSha256Before,
      sizeBytes: databaseArtifact.stat.size,
      integrityCheck,
      openedReadOnly: true,
      packageIdentity: snapshotIdentity,
      snapshotManifestSha256: authoritySnapshot.snapshotManifestSha256,
      authorityProof: {
        queryContract: EXECUTION_CANARY_AUTHORITY_QUERY_CONTRACT,
        queryExecutedAt,
        databaseSha256: databaseSha256Before,
        passed: true,
        recordIdentity,
      },
    },
  };
  const formalValidation = validateExecutionCanary(evidence, options.mode, {
    authoritySnapshotPath: databaseArtifact.path,
    authoritySnapshotManifestSha256: authoritySnapshot.snapshotManifestSha256,
    authoritySnapshotExportedAt: authoritySnapshot.manifest.exportedAt,
    canonicalStoresRoot: pathProof.storesRoot,
    nowMs: nowBeforeMs,
    packageBuiltAtMs: packageBefore.builtAtMs,
    packageIdentity: snapshotIdentity,
  });
  assertCondition(
    formalValidation.ok,
    `Generated canary evidence does not satisfy the formal verifier: ${formalValidation.reason}`,
  );
  return evidence;
}

function writeExclusiveAtomic(outputBoundary, serialized, context) {
  const outputRoot = ensureCanonicalOutputDirectory(outputBoundary);
  const resolved = outputBoundary.outputPath;
  assertCondition(
    samePath(path.dirname(resolved), outputRoot),
    'Canary evidence output escaped its canonical execution-canary directory.',
  );
  if (fs.existsSync(resolved)) fail(`Canary evidence output already exists and will not be overwritten: ${resolved}`);
  const tempPath = path.join(
    outputRoot,
    `.${path.basename(resolved)}.${context.randomUUID()}.tmp`,
  );
  let finalLinked = false;
  try {
    fs.writeFileSync(tempPath, serialized, { encoding: 'utf8', flag: 'wx' });
    // Windows requires a writable handle for fsync on a freshly written file.
    const handle = fs.openSync(tempPath, 'r+');
    try {
      fs.fsyncSync(handle);
    } finally {
      fs.closeSync(handle);
    }
    fs.linkSync(tempPath, resolved);
    finalLinked = true;
    fs.unlinkSync(tempPath);
    assertUniqueRegularFile(resolved, 'Canary evidence output');
  } catch (error) {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    if (finalLinked && fs.existsSync(resolved)) fs.unlinkSync(resolved);
    throw error;
  }
}

function removeOwnedOutput(outputBoundary) {
  const outputPath = outputBoundary.outputPath;
  if (!samePath(path.dirname(outputPath), outputBoundary.outputRoot) || !fs.existsSync(outputPath)) {
    return;
  }
  const linkStat = fs.lstatSync(outputPath);
  if (linkStat.isDirectory()) {
    fail(`Owned canary output unexpectedly became a directory and was not removed: ${outputPath}`);
  }
  fs.unlinkSync(outputPath);
}

function verifyPostWriteProvenance(
  options,
  context,
  outputBoundary,
  evidence,
  serialized,
) {
  const output = assertUniqueRegularFile(outputBoundary.outputPath, 'Canary evidence output');
  assertCondition(
    output.stat.size === Buffer.byteLength(serialized)
      && fs.readFileSync(output.path, 'utf8') === serialized,
    'Canary evidence output bytes changed after the exclusive atomic write.',
  );

  const packageAfterWrite = inspectCurrentPackage(context);
  assertCondition(
    stableEqual(packageAfterWrite.packageIdentity, evidence.packageIdentity),
    'Canonical package hashes changed after the canary evidence write.',
  );

  const authoritySnapshot = loadAuthoritySnapshotManifest(
    options.authoritySnapshotManifestPath,
    { authoritySnapshotRoot: context.authoritySnapshotRoot },
  );
  assertCondition(
    authoritySnapshot.snapshotManifestSha256 === evidence.database.snapshotManifestSha256,
    'Authority snapshot manifest hash changed after the canary evidence write.',
  );
  const databaseArtifact = assertUniqueRegularFile(
    authoritySnapshot.databasePath,
    'Authority database snapshot',
  );
  assertCondition(
    samePath(databaseArtifact.path, evidence.database.absolutePath)
      && databaseArtifact.stat.size === evidence.database.sizeBytes
      && sha256File(databaseArtifact.path) === evidence.database.sha256,
    'Authority database snapshot hash, size, or path changed after the canary evidence write.',
  );
  const userDataBoundary = deriveCanonicalUserDataBoundary(authoritySnapshot);
  assertCondition(
    samePath(userDataBoundary.storesRoot, evidence.storesRoot),
    'Canonical live USER_DATA_DIR stores root changed after the canary evidence write.',
  );
  const currentnessAfterFinalOutput = captureLiveAuthorityCurrentness(
    authoritySnapshot,
    context,
    `canary-${evidence.mode}-after-final-output`,
  );
  assertMatchingAuthorityCurrentnessProofs(
    [...evidence.authorityCurrentness.captures, currentnessAfterFinalOutput],
    authoritySnapshot.snapshotArtifact,
    'Execution-canary final authority currentness',
  );
  for (const record of evidence.execution.evidence) {
    const artifact = assertUniqueRegularFile(
      record.artifactPath,
      `${record.slot} Store Capsule artifact`,
    );
    validatePngArtifact(artifact.path, `${record.slot} Store Capsule artifact`);
    assertCondition(
      artifact.stat.size === record.sizeBytes
        && sha256File(artifact.path) === record.contentSha256,
      `${record.slot} Store Capsule artifact changed after the canary evidence write.`,
    );
  }
}

function exportExecutionCanaryEvidence(rawOptions, injectedContext = {}) {
  const options = normalizeProgrammaticOptions(rawOptions);
  if (!options.outputPath) fail('outputPath is required for export.');
  const context = { ...defaultContext(), ...injectedContext };
  assertCondition(
    context.afterOutputWritten === null || typeof context.afterOutputWritten === 'function',
    'afterOutputWritten must be null or a function.',
  );
  const authoritySnapshot = loadAuthoritySnapshotManifest(
    options.authoritySnapshotManifestPath,
    { authoritySnapshotRoot: context.authoritySnapshotRoot },
  );
  const userDataBoundary = deriveCanonicalUserDataBoundary(authoritySnapshot);
  const outputBoundary = validateCanonicalOutputBoundary(
    options,
    context,
    authoritySnapshot,
    userDataBoundary,
  );
  const evidence = buildExecutionCanaryEvidence(options, context);
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  let outputOwned = false;
  try {
    writeExclusiveAtomic(outputBoundary, serialized, context);
    outputOwned = true;
    if (context.afterOutputWritten) {
      context.afterOutputWritten({ evidence, outputPath: outputBoundary.outputPath });
    }
    verifyPostWriteProvenance(options, context, outputBoundary, evidence, serialized);
    return { evidence, outputPath: outputBoundary.outputPath };
  } catch (error) {
    if (outputOwned) removeOwnedOutput(outputBoundary);
    throw error;
  }
}

function usage() {
  return [
    'Usage: node scripts/export-mission-control-execution-canary-evidence.js',
    '  --authority-snapshot-manifest <snapshot-manifest.json>',
    '  --mode <manual_approval|policy_auto>',
    '  --store-id <normalized-store-id>',
    '  --authority-id <verified-authority-id>',
    '  --mission-grant-id <mission-grant-id>',
    '  --batch-id <execution-batch-id>',
    '  --job-id <execution-job-id>',
    '  --stores-root <absolute-store-capsule-root>',
    '  --before-artifact <absolute-before.png>',
    '  --after-artifact <absolute-after.png>',
    '  --reload-artifact <absolute-reload.png>',
    '  --out <new-evidence.json>',
    '',
    'The exporter only reads the selected snapshot and Store Capsule artifacts.',
    'It never executes Ads, mutates SQLite, or accepts user-authored canary business facts.',
  ].join('\n');
}

function run(argv = process.argv.slice(2), injectedContext = {}) {
  const options = parseOptions(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return { exitCode: 0, result: null };
  }
  const result = exportExecutionCanaryEvidence(options, injectedContext);
  process.stdout.write(`Execution canary evidence: ${result.outputPath}\n`);
  return { exitCode: 0, result };
}

if (require.main === module) {
  try {
    const result = run();
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  BACKUP_METHOD,
  CANARY_MAX_AGE_MS,
  EXECUTION_SLOTS,
  buildExecutionCanaryEvidence,
  exportExecutionCanaryEvidence,
  parseOptions,
  run,
};

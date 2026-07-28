import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const requireFromLocalDb = createRequire(path.join(root, 'packages', 'local-db', 'package.json'));
const Database = requireFromLocalDb('better-sqlite3');
const exporter = createRequire(import.meta.url)('./export-mission-control-execution-canary-evidence.js');
const readiness = createRequire(import.meta.url)('./verify-mission-control-production-readiness.js');
const {
  runReadonlySqliteOnlineBackupSync,
} = createRequire(import.meta.url)('./sqlite-authority-currentness.js');
const tempRoot = path.join(root, 'output', 'codex-temp');
const ownedTempDirs = [];
const MINIMAL_PNGS = [
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Xw5Z1QAAAABJRU5ErkJggg==',
    'base64',
  ),
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=',
    'base64',
  ),
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP4DwQACfsD/QHH2F8AAAAASUVORK5CYII=',
    'base64',
  ),
];

fs.mkdirSync(tempRoot, { recursive: true });

afterEach(() => {
  while (ownedTempDirs.length > 0) {
    const candidate = ownedTempDirs.pop();
    const resolved = path.resolve(candidate);
    if (path.dirname(resolved) === path.resolve(tempRoot) && fs.existsSync(resolved)) {
      fs.rmSync(resolved, { recursive: true, force: false });
    }
  }
});

function makeTempDir(prefix) {
  const directory = fs.mkdtempSync(path.join(tempRoot, prefix));
  ownedTempDirs.push(directory);
  return directory;
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function fileArtifact(filePath) {
  const stat = fs.statSync(filePath);
  return {
    sha256: sha256File(filePath),
    sizeBytes: stat.size,
    mtimeMs: stat.mtimeMs,
  };
}

function installSchema(database) {
  database.exec(`
    CREATE TABLE stores (
      store_id TEXT PRIMARY KEY, browser_profile_id TEXT NOT NULL,
      marketplace TEXT NOT NULL, currency TEXT NOT NULL, status TEXT NOT NULL
    );
    CREATE TABLE verified_ad_entity_authority (
      authority_id TEXT PRIMARY KEY, store_id TEXT NOT NULL,
      ad_entity_id TEXT NOT NULL, entity_revision INTEGER NOT NULL,
      entity_type TEXT NOT NULL, proof_sha256 TEXT NOT NULL
    );
    CREATE TABLE ad_keyword_identity_versions (
      identity_version_id TEXT PRIMARY KEY, store_id TEXT NOT NULL,
      marketplace TEXT NOT NULL, currency TEXT NOT NULL,
      canonical_keyword_id TEXT NOT NULL, ad_entity_id TEXT NOT NULL,
      entity_revision INTEGER NOT NULL, ads_account_id TEXT NOT NULL,
      campaign_id TEXT NOT NULL, ad_group_id TEXT NOT NULL,
      keyword_id TEXT NOT NULL, object_revision INTEGER NOT NULL,
      observed_bid_cents INTEGER NOT NULL, page_identity_hash TEXT NOT NULL,
      source_authority_id TEXT NOT NULL,
      source_authority_proof_sha256 TEXT NOT NULL,
      resolved_session_generation INTEGER NOT NULL,
      resolved_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE missions (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL,
      marketplace TEXT NOT NULL, currency TEXT NOT NULL,
      policy_version_id TEXT NOT NULL, status TEXT NOT NULL, revision INTEGER NOT NULL
    );
    CREATE TABLE policy_versions (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL, status TEXT NOT NULL,
      rules_json TEXT NOT NULL, revision INTEGER NOT NULL
    );
    CREATE TABLE policy_runtime (
      store_id TEXT PRIMARY KEY, autonomy_mode TEXT NOT NULL,
      kill_switch INTEGER NOT NULL, circuit_breaker_state TEXT NOT NULL,
      active_policy_version_id TEXT NOT NULL
    );
    CREATE TABLE decisions (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL, mission_id TEXT NOT NULL,
      policy_version_id TEXT NOT NULL, policy_revision INTEGER NOT NULL,
      action_revision INTEGER NOT NULL, action_type TEXT NOT NULL,
      ad_entity_id TEXT NOT NULL, status TEXT NOT NULL, revision INTEGER NOT NULL,
      valid_until TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE analysis_proposal_snapshots (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL, marketplace TEXT NOT NULL,
      currency TEXT NOT NULL, mission_id TEXT NOT NULL, mission_revision INTEGER NOT NULL,
      policy_version_id TEXT NOT NULL, policy_revision INTEGER NOT NULL,
      action_revision INTEGER NOT NULL, action_type TEXT NOT NULL,
      entity_type TEXT NOT NULL, ad_entity_authority_id TEXT NOT NULL,
      ad_entity_id TEXT NOT NULL, ad_entity_revision INTEGER NOT NULL,
      current_bid_cents INTEGER NOT NULL, proposed_bid_cents INTEGER NOT NULL,
      change_pct REAL NOT NULL, authorization_json TEXT NOT NULL,
      valid_until TEXT NOT NULL, created_session_generation INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE analysis_proposal_decision_links (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL,
      proposal_id TEXT NOT NULL, decision_id TEXT NOT NULL
    );
    CREATE TABLE decision_history (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL, decision_id TEXT NOT NULL,
      decision_revision INTEGER NOT NULL, event_type TEXT NOT NULL,
      actor_id TEXT NOT NULL, reason TEXT, snapshot_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE mission_grants (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL,
      marketplace TEXT NOT NULL, currency TEXT NOT NULL,
      mission_id TEXT NOT NULL, mission_revision INTEGER NOT NULL,
      decision_ids_json TEXT NOT NULL, action_revision INTEGER NOT NULL,
      allowed_action_types_json TEXT NOT NULL, allowed_ad_entity_ids_json TEXT NOT NULL,
      max_change_pct REAL NOT NULL, total_impact_budget REAL NOT NULL,
      expires_at TEXT NOT NULL, policy_version_id TEXT NOT NULL,
      policy_revision INTEGER NOT NULL, required_evidence_json TEXT NOT NULL,
      stop_conditions_json TEXT NOT NULL, issuer_type TEXT NOT NULL,
      issued_at TEXT NOT NULL, created_session_generation INTEGER NOT NULL
    );
    CREATE TABLE mission_grant_events (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL,
      grant_id TEXT NOT NULL, event_type TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE ad_execution_batches (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL,
      marketplace TEXT NOT NULL, currency TEXT NOT NULL,
      mission_id TEXT NOT NULL, mission_revision INTEGER NOT NULL,
      grant_id TEXT NOT NULL, action_revision INTEGER NOT NULL,
      status TEXT NOT NULL, created_session_generation INTEGER NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, terminal_at TEXT
    );
    CREATE TABLE ad_execution_jobs (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL, batch_id TEXT NOT NULL,
      mission_id TEXT NOT NULL, grant_id TEXT NOT NULL,
      proposal_id TEXT NOT NULL, decision_id TEXT NOT NULL,
      decision_revision INTEGER NOT NULL, action_revision INTEGER NOT NULL,
      action_type TEXT NOT NULL, canonical_keyword_id TEXT NOT NULL,
      ad_entity_id TEXT NOT NULL, entity_revision INTEGER NOT NULL,
      ads_account_id TEXT NOT NULL, campaign_id TEXT NOT NULL,
      ad_group_id TEXT NOT NULL, keyword_id TEXT NOT NULL,
      object_revision INTEGER NOT NULL, page_identity_hash TEXT NOT NULL,
      expected_bid_cents INTEGER NOT NULL, target_bid_cents INTEGER NOT NULL,
      change_pct REAL NOT NULL, status TEXT NOT NULL,
      created_session_generation INTEGER NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      submitted_at TEXT, terminal_at TEXT
    );
    CREATE TABLE ad_execution_evidence (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL,
      batch_id TEXT NOT NULL, job_id TEXT NOT NULL, slot TEXT NOT NULL,
      artifact_ref TEXT NOT NULL, content_sha256 TEXT NOT NULL,
      page_identity_hash TEXT NOT NULL, canonical_keyword_id TEXT NOT NULL,
      object_revision INTEGER NOT NULL, observed_bid_cents INTEGER NOT NULL,
      captured_session_generation INTEGER NOT NULL,
      captured_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
  `);
}

function refreshSnapshotManifest(fixture) {
  const manifest = JSON.parse(fs.readFileSync(fixture.manifestPath, 'utf8'));
  const source = fileArtifact(fixture.sourcePath);
  const snapshot = fileArtifact(fixture.databasePath);
  manifest.source.artifactBefore = source;
  manifest.source.artifactAfter = source;
  manifest.snapshot.sha256 = snapshot.sha256;
  manifest.snapshot.sizeBytes = snapshot.sizeBytes;
  fs.writeFileSync(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function mutateSnapshot(fixture, callback) {
  const database = new Database(fixture.sourcePath);
  try {
    callback(database);
  } finally {
    database.close();
  }
  fs.rmSync(fixture.databasePath);
  runReadonlySqliteOnlineBackupSync({
    sourceDatabasePath: fixture.sourcePath,
    destinationPath: fixture.databasePath,
    ownedTempRoot: path.dirname(fixture.databasePath),
  });
  refreshSnapshotManifest(fixture);
}

function bindArtifactBytes(fixture, slot, bytes) {
  fs.writeFileSync(fixture.artifactPaths[slot], bytes);
  const contentSha256 = sha256File(fixture.artifactPaths[slot]);
  mutateSnapshot(fixture, (database) => {
    database.prepare(`
      UPDATE ad_execution_evidence SET content_sha256 = ?
      WHERE store_id = ? AND job_id = ? AND slot = ?
    `).run(contentSha256, fixture.ids.storeId, fixture.ids.jobId, slot);
  });
}

function temporaryOutputFiles(fixture) {
  const outputDirectory = path.dirname(fixture.outputPath);
  if (!fs.existsSync(outputDirectory)) return [];
  return fs.readdirSync(outputDirectory)
    .filter((name) => name.includes(path.basename(fixture.outputPath)) && name.endsWith('.tmp'));
}

function createFixture(mode) {
  const suffix = mode === 'manual_approval' ? 'manual' : 'policy';
  const issuerType = mode === 'manual_approval' ? 'human' : 'policy';
  const tempDir = makeTempDir(`execution-canary-${suffix}-`);
  const snapshotRoot = path.join(tempDir, 'authority-snapshots');
  const snapshotDirectory = path.join(snapshotRoot, 'current');
  const databasePath = path.join(snapshotDirectory, 'authority-snapshot.db');
  const userDataDir = path.join(tempDir, 'live-appdata');
  const sourcePath = path.join(userDataDir, 'amazon-ai-ops.db');
  const manifestPath = path.join(snapshotDirectory, 'snapshot-manifest.json');
  const storesRoot = path.join(userDataDir, 'stores');
  const canonicalEvidenceRoot = path.join(tempDir, 'output', 'codex-evidence');
  const executionCanaryOutputRoot = path.join(canonicalEvidenceRoot, 'execution-canaries');
  const outputPath = path.join(executionCanaryOutputRoot, `${suffix}-canary.json`);
  const packageIdentity = {
    executableSha256: 'A'.repeat(64),
    appContentSha256: 'B'.repeat(64),
    mainBundleSha256: 'C'.repeat(64),
  };
  const ids = {
    storeId: `store-${suffix}`,
    browserProfileId: `profile-${suffix}`,
    authorityId: `authority-${suffix}`,
    identityVersionId: `identity-${suffix}`,
    canonicalKeywordId: `canonical-keyword-${suffix}`,
    adEntityId: `ad-entity-${suffix}`,
    missionId: `mission-${suffix}`,
    policyVersionId: `policy-version-${suffix}`,
    decisionId: `decision-${suffix}`,
    proposalId: `proposal-${suffix}`,
    missionGrantId: `grant-${suffix}`,
    batchId: `batch-${suffix}`,
    jobId: `job-${suffix}`,
  };
  const sessionGeneration = mode === 'manual_approval' ? 9 : 10;
  const pageIdentityHash = 'D'.repeat(64);
  const sourceAuthorityProofSha256 = 'E'.repeat(64);
  const expectedBidCents = mode === 'manual_approval' ? 100 : 95;
  const targetBidCents = mode === 'manual_approval' ? 95 : 90;
  const signedChangePct = ((targetBidCents - expectedBidCents) / expectedBidCents) * 100;
  const artifactPaths = {};
  const artifactRows = [];

  fs.mkdirSync(snapshotDirectory, { recursive: true });
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.mkdirSync(storesRoot, { recursive: true });
  fs.mkdirSync(canonicalEvidenceRoot, { recursive: true });
  for (const [index, slot] of ['before', 'after', 'reload'].entries()) {
    const artifactPath = readiness.deterministicExecutionArtifactPath(
      storesRoot,
      ids.storeId,
      ids.batchId,
      ids.jobId,
      slot,
    );
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    fs.writeFileSync(artifactPath, MINIMAL_PNGS[index]);
    artifactPaths[slot] = artifactPath;
    artifactRows.push({
      id: `${suffix}-${slot}`,
      slot,
      artifactRef: readiness.deterministicExecutionArtifactRef(
        ids.storeId,
        ids.batchId,
        ids.jobId,
        slot,
      ),
      contentSha256: sha256File(artifactPath),
      observedBidCents: slot === 'before' ? expectedBidCents : targetBidCents,
      capturedAt: `2026-07-27T11:${40 + index}:00.000Z`,
      createdAt: `2026-07-27T11:${40 + index}:01.000Z`,
    });
  }

  const database = new Database(databasePath);
  try {
    installSchema(database);
    database.prepare(`
      INSERT INTO stores VALUES (?, ?, 'US', 'USD', 'active')
    `).run(ids.storeId, ids.browserProfileId);
    database.prepare(`
      INSERT INTO verified_ad_entity_authority
      VALUES (?, ?, ?, 1, 'keyword', ?)
    `).run(ids.authorityId, ids.storeId, ids.adEntityId, sourceAuthorityProofSha256);
    database.prepare(`
      INSERT INTO ad_keyword_identity_versions VALUES (
        ?, ?, 'US', 'USD', ?, ?, 1, ?, ?, ?, ?, 4, ?, ?, ?, ?, ?,
        '2026-07-27T11:10:00.000Z', '2026-07-27T11:10:01.000Z'
      )
    `).run(
      ids.identityVersionId,
      ids.storeId,
      ids.canonicalKeywordId,
      ids.adEntityId,
      `ads-account-${suffix}`,
      `campaign-${suffix}`,
      `ad-group-${suffix}`,
      `keyword-${suffix}`,
      expectedBidCents,
      pageIdentityHash,
      ids.authorityId,
      sourceAuthorityProofSha256,
      sessionGeneration,
    );
    database.prepare(`
      INSERT INTO missions VALUES (?, ?, 'US', 'USD', ?, 'active', 1)
    `).run(ids.missionId, ids.storeId, ids.policyVersionId);
    database.prepare(`
      INSERT INTO policy_versions VALUES (?, ?, 'enabled', ?, 1)
    `).run(ids.policyVersionId, ids.storeId, JSON.stringify({ killSwitch: false }));
    database.prepare(`
      INSERT INTO policy_runtime VALUES (?, ?, 0, 'closed', ?)
    `).run(ids.storeId, mode, ids.policyVersionId);
    database.prepare(`
      INSERT INTO decisions VALUES (
        ?, ?, ?, ?, 1, 1, 'set_keyword_bid', ?, 'approved', 2,
        '2026-07-27T13:00:00.000Z',
        '2026-07-27T11:21:00.000Z', '2026-07-27T11:25:00.000Z'
      )
    `).run(ids.decisionId, ids.storeId, ids.missionId, ids.policyVersionId, ids.adEntityId);
    database.prepare(`
      INSERT INTO decision_history VALUES (
        ?, ?, ?, 2, 'approved', 'operator', NULL, ?,
        '2026-07-27T11:25:00.000Z'
      )
    `).run(
      `decision-history-${suffix}`,
      ids.storeId,
      ids.decisionId,
      JSON.stringify({ id: ids.decisionId, revision: 2, status: 'approved' }),
    );
    database.prepare(`
      INSERT INTO analysis_proposal_snapshots VALUES (
        ?, ?, 'US', 'USD', ?, 1, ?, 1, 1, 'set_keyword_bid',
        'keyword', ?, ?, 1, ?, ?, ?, ?, '2026-07-27T13:00:00.000Z', ?
        , '2026-07-27T11:20:00.000Z'
      )
    `).run(
      ids.proposalId,
      ids.storeId,
      ids.missionId,
      ids.policyVersionId,
      ids.authorityId,
      ids.adEntityId,
      expectedBidCents,
      targetBidCents,
      signedChangePct,
      JSON.stringify({
        human: { eligible: true, blockers: [] },
        policy: { eligible: true, blockers: [] },
      }),
      sessionGeneration,
    );
    database.prepare(`
      INSERT INTO analysis_proposal_decision_links VALUES (?, ?, ?, ?)
    `).run(`link-${suffix}`, ids.storeId, ids.proposalId, ids.decisionId);
    database.prepare(`
      INSERT INTO mission_grants VALUES (
        ?, ?, 'US', 'USD', ?, 1, ?, 1, ?, ?, 10, 10,
        '2026-07-27T13:00:00.000Z', ?, 1, ?, ?, ?,
        '2026-07-27T11:30:00.000Z', ?
      )
    `).run(
      ids.missionGrantId,
      ids.storeId,
      ids.missionId,
      JSON.stringify([ids.decisionId]),
      JSON.stringify(['set_keyword_bid']),
      JSON.stringify([ids.adEntityId]),
      ids.policyVersionId,
      JSON.stringify([
        'before_screenshot',
        'after_screenshot',
        'reload_screenshot',
        'page_identity',
        'readback_value',
      ]),
      JSON.stringify([
        { code: 'identity_drift', detail: 'stop' },
        { code: 'expected_before_mismatch', detail: 'stop' },
        { code: 'unknown_result', detail: 'stop' },
        { code: 'data_stale', detail: 'stop' },
        { code: 'impact_budget_exhausted', detail: 'stop' },
        { code: 'kill_switch', detail: 'stop' },
      ]),
      issuerType,
      sessionGeneration,
    );
    const grantEvent = database.prepare(`
      INSERT INTO mission_grant_events VALUES (?, ?, ?, ?, ?)
    `);
    grantEvent.run(
      `${ids.missionGrantId}-issued`,
      ids.storeId,
      ids.missionGrantId,
      'issued',
      '2026-07-27T11:30:00.000Z',
    );
    grantEvent.run(
      `${ids.missionGrantId}-consumed`,
      ids.storeId,
      ids.missionGrantId,
      'consumed',
      '2026-07-27T11:43:30.000Z',
    );
    database.prepare(`
      INSERT INTO ad_execution_batches VALUES (
        ?, ?, 'US', 'USD', ?, 1, ?, 1, 'succeeded', ?,
        '2026-07-27T11:35:00.000Z', '2026-07-27T11:43:20.000Z',
        '2026-07-27T11:43:20.000Z'
      )
    `).run(ids.batchId, ids.storeId, ids.missionId, ids.missionGrantId, sessionGeneration);
    database.prepare(`
      INSERT INTO ad_execution_jobs VALUES (
        ?, ?, ?, ?, ?, ?, ?, 2, 1, 'set_keyword_bid',
        ?, ?, 1, ?, ?, ?, ?, 4, ?, ?, ?, ?, 'succeeded', ?,
        '2026-07-27T11:35:00.000Z', '2026-07-27T11:43:10.000Z',
        '2026-07-27T11:40:30.000Z', '2026-07-27T11:43:10.000Z'
      )
    `).run(
      ids.jobId,
      ids.storeId,
      ids.batchId,
      ids.missionId,
      ids.missionGrantId,
      ids.proposalId,
      ids.decisionId,
      ids.canonicalKeywordId,
      ids.adEntityId,
      `ads-account-${suffix}`,
      `campaign-${suffix}`,
      `ad-group-${suffix}`,
      `keyword-${suffix}`,
      pageIdentityHash,
      expectedBidCents,
      targetBidCents,
      signedChangePct,
      sessionGeneration,
    );
    const insertEvidence = database.prepare(`
      INSERT INTO ad_execution_evidence VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, 4, ?, ?, ?, ?
      )
    `);
    for (const record of artifactRows) {
      insertEvidence.run(
        record.id,
        ids.storeId,
        ids.batchId,
        ids.jobId,
        record.slot,
        record.artifactRef,
        record.contentSha256,
        pageIdentityHash,
        ids.canonicalKeywordId,
        record.observedBidCents,
        sessionGeneration,
        record.capturedAt,
        record.createdAt,
      );
    }
  } finally {
    database.close();
  }

  fs.copyFileSync(databasePath, sourcePath);
  fs.rmSync(databasePath);
  const onlineBackup = runReadonlySqliteOnlineBackupSync({
    sourceDatabasePath: sourcePath,
    destinationPath: databasePath,
    ownedTempRoot: snapshotDirectory,
  });
  const sourceArtifact = fileArtifact(sourcePath);
  const snapshotArtifact = fileArtifact(databasePath);
  const manifest = {
    kind: 'mission-control-authority-database-snapshot',
    schemaVersion: 'mission-control-authority-database-snapshot/v2',
    exportedAt: '2026-07-27T11:50:00.000Z',
    backup: {
      method: 'sqlite-online-backup',
      startedAt: '2026-07-27T11:49:00.000Z',
      completedAt: '2026-07-27T11:50:00.000Z',
      completed: true,
      totalPages: onlineBackup.observedBackup.totalPages,
      remainingPages: onlineBackup.observedBackup.remainingPages,
    },
    source: {
      absolutePath: sourcePath,
      realPath: sourcePath,
      openedReadOnly: true,
      queryOnly: true,
      integrityCheck: ['ok'],
      foreignKeyCheck: [],
      artifactBefore: sourceArtifact,
      artifactAfter: sourceArtifact,
    },
    snapshot: {
      absolutePath: databasePath,
      realPath: databasePath,
      openedReadOnly: true,
      queryOnly: true,
      integrityCheck: ['ok'],
      foreignKeyCheck: [],
      sha256: snapshotArtifact.sha256,
      sizeBytes: snapshotArtifact.sizeBytes,
    },
    packageIdentity,
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const builtAtMs = Date.parse('2026-07-27T11:00:00.000Z');
  const context = {
    Database,
    authoritySnapshotRoot: snapshotRoot,
    canonicalEvidenceRoot,
    executionCanaryOutputRoot,
    releaseRoot: path.join(tempDir, 'release'),
    now: () => new Date('2026-07-27T12:00:00.000Z'),
    randomUUID: () => '11111111-2222-4333-8444-555555555555',
    inspectCanonicalPackage: () => ({ packageIdentity: { ...packageIdentity }, builtAtMs }),
  };
  const options = {
    authoritySnapshotManifestPath: manifestPath,
    mode,
    storeId: ids.storeId,
    authorityId: ids.authorityId,
    missionGrantId: ids.missionGrantId,
    batchId: ids.batchId,
    jobId: ids.jobId,
    storesRoot,
    artifactPaths,
    outputPath,
  };
  return {
    artifactPaths,
    canonicalEvidenceRoot,
    context,
    databasePath,
    executionCanaryOutputRoot,
    ids,
    manifestPath,
    mode,
    options,
    outputPath,
    packageIdentity,
    sourcePath,
    snapshotRoot,
    storesRoot,
    tempDir,
    userDataDir,
  };
}

function expectFormalCanaryPass(fixture, evidence) {
  const validation = readiness.validateExecutionCanary(evidence, fixture.mode, {
    authoritySnapshotPath: fixture.databasePath,
    authoritySnapshotManifestSha256: sha256File(fixture.manifestPath),
    authoritySnapshotExportedAt: '2026-07-27T11:50:00.000Z',
    canonicalStoresRoot: fixture.storesRoot,
    nowMs: Date.parse('2026-07-27T12:00:00.000Z'),
    packageBuiltAtMs: Date.parse('2026-07-27T11:00:00.000Z'),
    packageIdentity: fixture.packageIdentity,
  });
  expect(validation).toMatchObject({ ok: true });
}

describe('Mission Control execution canary evidence exporter', () => {
  it('exports manual-approval authority facts directly accepted by the formal verifier', () => {
    const fixture = createFixture('manual_approval');
    const databaseSha256Before = sha256File(fixture.databasePath);
    const result = exporter.exportExecutionCanaryEvidence(fixture.options, fixture.context);
    const evidence = JSON.parse(fs.readFileSync(result.outputPath, 'utf8'));

    expect(evidence).toMatchObject({
      kind: 'mission-control-execution-canary-evidence',
      schemaVersion: 'mission-control-execution-canary-evidence/v1',
      status: 'PASSED',
      passed: true,
      mode: 'manual_approval',
      packageIdentity: fixture.packageIdentity,
      scope: {
        storeId: fixture.ids.storeId,
        marketplace: 'US',
        currency: 'USD',
      },
      authority: {
        issuerType: 'human',
        missionGrantId: fixture.ids.missionGrantId,
        batchId: fixture.ids.batchId,
        jobId: fixture.ids.jobId,
      },
      database: {
        openedReadOnly: true,
        packageIdentity: fixture.packageIdentity,
        snapshotManifestSha256: sha256File(fixture.manifestPath),
        authorityProof: {
          queryContract: 'mission-control-execution-canary-authority/v1',
          passed: true,
        },
      },
    });
    expect(evidence.execution.evidence.map((record) => record.slot)).toEqual([
      'before',
      'after',
      'reload',
    ]);
    expect(path.dirname(fixture.storesRoot)).toBe(fixture.userDataDir);
    for (const record of evidence.execution.evidence) {
      expect(fs.readFileSync(record.artifactPath).subarray(0, 8).toString('hex'))
        .toBe('89504e470d0a1a0a');
    }
    expect(sha256File(fixture.databasePath)).toBe(databaseSha256Before);
    expectFormalCanaryPass(fixture, evidence);
  });

  it('exports policy-auto authority facts directly accepted by the formal verifier', () => {
    const fixture = createFixture('policy_auto');
    const { evidence } = exporter.exportExecutionCanaryEvidence(fixture.options, fixture.context);

    expect(evidence.mode).toBe('policy_auto');
    expect(evidence.authority.issuerType).toBe('policy');
    expect(evidence.object.expectedBidCents).toBe(95);
    expect(evidence.object.targetBidCents).toBe(90);
    expectFormalCanaryPass(fixture, evidence);
  });

  it('fails closed when the selected authority job row is missing', () => {
    const fixture = createFixture('manual_approval');
    mutateSnapshot(fixture, (database) => {
      database.prepare('DELETE FROM ad_execution_jobs WHERE id = ?').run(fixture.ids.jobId);
    });

    expect(() => exporter.exportExecutionCanaryEvidence(fixture.options, fixture.context))
      .toThrow(/execution job.*missing/i);
    expect(fs.existsSync(fixture.outputPath)).toBe(false);
  });

  it('rejects a mode that does not match the MissionGrant issuer and policy runtime', () => {
    const fixture = createFixture('manual_approval');
    const options = { ...fixture.options, mode: 'policy_auto' };

    expect(() => exporter.exportExecutionCanaryEvidence(options, fixture.context))
      .toThrow(/MissionGrant does not belong to policy_auto authority/i);
    expect(fs.existsSync(fixture.outputPath)).toBe(false);
  });

  it('rejects a missing before artifact', () => {
    const fixture = createFixture('manual_approval');
    fs.unlinkSync(fixture.artifactPaths.before);

    expect(() => exporter.exportExecutionCanaryEvidence(fixture.options, fixture.context))
      .toThrow(/before Store Capsule artifact does not exist/i);
  });

  it('rejects an artifact tampered after the authority snapshot', () => {
    const fixture = createFixture('policy_auto');
    fs.appendFileSync(fixture.artifactPaths.after, Buffer.from('tampered'));

    expect(() => exporter.exportExecutionCanaryEvidence(fixture.options, fixture.context))
      .toThrow(/after Store Capsule artifact SHA-256 does not match/i);
  });

  it('rejects an artifact path redirected to another store capsule', () => {
    const fixture = createFixture('manual_approval');
    const crossStorePath = path.join(
      fixture.storesRoot,
      'store-foreign',
      'evidence',
      'ad-execution',
      'reload.png',
    );
    fs.mkdirSync(path.dirname(crossStorePath), { recursive: true });
    fs.copyFileSync(fixture.artifactPaths.reload, crossStorePath);
    const options = {
      ...fixture.options,
      artifactPaths: { ...fixture.artifactPaths, reload: crossStorePath },
    };

    expect(() => exporter.exportExecutionCanaryEvidence(options, fixture.context))
      .toThrow(/reload artifact is not the deterministic Store Capsule path/i);
  });

  it('rejects a stale authority snapshot replay', () => {
    const fixture = createFixture('manual_approval');
    const manifest = JSON.parse(fs.readFileSync(fixture.manifestPath, 'utf8'));
    manifest.exportedAt = '2026-07-23T11:50:00.000Z';
    manifest.backup.startedAt = '2026-07-23T11:49:00.000Z';
    manifest.backup.completedAt = '2026-07-23T11:50:00.000Z';
    fs.writeFileSync(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    expect(() => exporter.exportExecutionCanaryEvidence(fixture.options, fixture.context))
      .toThrow(/future-dated or stale.*replayed/i);
  });

  it('rejects a snapshot bound to a different canonical package', () => {
    const fixture = createFixture('policy_auto');
    const replayContext = {
      ...fixture.context,
      inspectCanonicalPackage: () => ({
        packageIdentity: {
          ...fixture.packageIdentity,
          mainBundleSha256: 'F'.repeat(64),
        },
        builtAtMs: Date.parse('2026-07-27T11:00:00.000Z'),
      }),
    };

    expect(() => exporter.exportExecutionCanaryEvidence(fixture.options, replayContext))
      .toThrow(/packageIdentity does not match.*package replay/i);
  });

  it('refuses to overwrite an existing evidence output', () => {
    const fixture = createFixture('manual_approval');
    fs.mkdirSync(path.dirname(fixture.outputPath), { recursive: false });
    fs.writeFileSync(fixture.outputPath, 'operator-owned');

    expect(() => exporter.exportExecutionCanaryEvidence(fixture.options, fixture.context))
      .toThrow(/already exists and will not be overwritten/i);
    expect(fs.readFileSync(fixture.outputPath, 'utf8')).toBe('operator-owned');
  });

  it('leaves no final or temporary output when validation fails', () => {
    const fixture = createFixture('policy_auto');
    fs.unlinkSync(fixture.artifactPaths.reload);

    expect(() => exporter.exportExecutionCanaryEvidence(fixture.options, fixture.context))
      .toThrow(/reload Store Capsule artifact does not exist/i);
    expect(fs.existsSync(fixture.outputPath)).toBe(false);
    expect(temporaryOutputFiles(fixture)).toEqual([]);
  });

  it('rejects a stale true execution-job terminal time even when snapshot and generatedAt are current', () => {
    const fixture = createFixture('manual_approval');
    mutateSnapshot(fixture, (database) => {
      database.prepare(`
        UPDATE ad_execution_jobs
        SET terminal_at = '2026-07-23T11:43:10.000Z',
            updated_at = '2026-07-23T11:43:10.000Z'
        WHERE id = ?
      `).run(fixture.ids.jobId);
    });

    expect(() => exporter.exportExecutionCanaryEvidence(fixture.options, fixture.context))
      .toThrow(/job terminalAt.*older than the 72-hour/i);
    expect(fs.existsSync(fixture.outputPath)).toBe(false);
  });

  it('rejects a stale screenshot capturedAt even when its database row and snapshot are current', () => {
    const fixture = createFixture('policy_auto');
    mutateSnapshot(fixture, (database) => {
      database.prepare(`
        UPDATE ad_execution_evidence
        SET captured_at = '2026-07-23T11:40:00.000Z',
            created_at = '2026-07-23T11:40:01.000Z'
        WHERE store_id = ? AND job_id = ? AND slot = 'before'
      `).run(fixture.ids.storeId, fixture.ids.jobId);
    });

    expect(() => exporter.exportExecutionCanaryEvidence(fixture.options, fixture.context))
      .toThrow(/before evidence capturedAt.*older than the 72-hour/i);
  });

  it('rejects fresh authority timestamps that are not causally ordered', () => {
    const fixture = createFixture('manual_approval');
    mutateSnapshot(fixture, (database) => {
      database.prepare(`
        UPDATE analysis_proposal_snapshots
        SET created_at = '2026-07-27T11:29:00.000Z'
        WHERE id = ?
      `).run(fixture.ids.proposalId);
    });

    expect(() => exporter.exportExecutionCanaryEvidence(fixture.options, fixture.context))
      .toThrow(/timestamps are stale or not causally closed/i);
  });

  it('rejects a CLI stores root outside the USER_DATA_DIR sibling derived from the live DB', () => {
    const fixture = createFixture('manual_approval');
    const foreignStoresRoot = path.join(fixture.tempDir, 'foreign-stores');
    fs.mkdirSync(foreignStoresRoot);
    const options = { ...fixture.options, storesRoot: foreignStoresRoot };

    expect(() => exporter.exportExecutionCanaryEvidence(options, fixture.context))
      .toThrow(/CLI storesRoot must equal the canonical stores directory/i);
  });

  it('rejects a junction or symlink substituted for the canonical USER_DATA_DIR stores root', () => {
    const fixture = createFixture('policy_auto');
    const junctionTarget = path.join(fixture.tempDir, 'junction-target-stores');
    fs.renameSync(fixture.storesRoot, junctionTarget);
    fs.symlinkSync(junctionTarget, fixture.storesRoot, 'junction');

    expect(() => exporter.exportExecutionCanaryEvidence(fixture.options, fixture.context))
      .toThrow(/stores root must be a direct real directory without symlink, junction, or reparse/i);
  });

  it('rejects evidence captured under a different session generation from authority records', () => {
    const fixture = createFixture('manual_approval');
    mutateSnapshot(fixture, (database) => {
      database.prepare(`
        UPDATE ad_execution_evidence
        SET captured_session_generation = captured_session_generation + 1
        WHERE store_id = ? AND job_id = ? AND slot = 'reload'
      `).run(fixture.ids.storeId, fixture.ids.jobId);
    });

    expect(() => exporter.exportExecutionCanaryEvidence(fixture.options, fixture.context))
      .toThrow(/reload authority evidence is not an exact job\/object\/session record/i);
  });

  it('rejects mismatched job, batch, grant, proposal, and identity session generations', () => {
    const fixture = createFixture('policy_auto');
    mutateSnapshot(fixture, (database) => {
      database.prepare(`
        UPDATE ad_keyword_identity_versions
        SET resolved_session_generation = resolved_session_generation + 1
        WHERE identity_version_id = ?
      `).run(fixture.ids.identityVersionId);
    });

    expect(() => exporter.exportExecutionCanaryEvidence(fixture.options, fixture.context))
      .toThrow(/session generations do not match exactly/i);
  });

  it('rejects bytes that match the authority DB hash but are not a PNG with first IHDR', () => {
    const fixture = createFixture('manual_approval');
    bindArtifactBytes(
      fixture,
      'after',
      Buffer.from('not-a-png-authority-bound-artifact-with-more-than-thirty-three-bytes'),
    );

    expect(() => exporter.exportExecutionCanaryEvidence(fixture.options, fixture.context))
      .toThrow(/after Store Capsule artifact does not have the PNG file signature/i);
  });

  it('rejects output outside the canonical execution-canaries directory', () => {
    const fixture = createFixture('policy_auto');
    const options = {
      ...fixture.options,
      outputPath: path.join(fixture.tempDir, 'outside-canary.json'),
    };

    expect(() => exporter.exportExecutionCanaryEvidence(options, fixture.context))
      .toThrow(/must be a direct file under output\/codex-evidence\/execution-canaries/i);
  });

  it.each([
    ['release', (fixture) => fixture.context.releaseRoot],
    ['snapshot', (fixture) => fixture.snapshotRoot],
    ['live AppData', (fixture) => fixture.userDataDir],
    ['Store Capsule', (fixture) => fixture.storesRoot],
  ])('explicitly rejects a canonical output root nested under %s paths', (_label, selectRoot) => {
    const fixture = createFixture('manual_approval');
    const forbiddenRoot = selectRoot(fixture);
    fs.mkdirSync(forbiddenRoot, { recursive: true });
    const executionCanaryOutputRoot = path.join(forbiddenRoot, 'execution-canaries');
    const options = {
      ...fixture.options,
      outputPath: path.join(executionCanaryOutputRoot, 'forbidden-canary.json'),
    };
    const context = {
      ...fixture.context,
      canonicalEvidenceRoot: forbiddenRoot,
      executionCanaryOutputRoot,
    };

    expect(() => exporter.exportExecutionCanaryEvidence(options, context))
      .toThrow(/may not be written under release, snapshot, live AppData, or Store Capsule paths/i);
    expect(fs.existsSync(options.outputPath)).toBe(false);
  });

  it('removes the final output if the canonical package hashes drift after writing', () => {
    const fixture = createFixture('policy_auto');
    let packageDrifted = false;
    const context = {
      ...fixture.context,
      afterOutputWritten: () => {
        packageDrifted = true;
      },
      inspectCanonicalPackage: () => ({
        packageIdentity: {
          ...fixture.packageIdentity,
          ...(packageDrifted ? { mainBundleSha256: 'F'.repeat(64) } : {}),
        },
        builtAtMs: Date.parse('2026-07-27T11:00:00.000Z'),
      }),
    };

    expect(() => exporter.exportExecutionCanaryEvidence(fixture.options, context))
      .toThrow(/package hashes changed after the canary evidence write/i);
    expect(fs.existsSync(fixture.outputPath)).toBe(false);
    expect(temporaryOutputFiles(fixture)).toEqual([]);
  });

  it('removes the final output if the authority snapshot manifest hash drifts after writing', () => {
    const fixture = createFixture('manual_approval');
    const context = {
      ...fixture.context,
      afterOutputWritten: () => {
        fs.appendFileSync(fixture.manifestPath, '\n');
      },
    };

    expect(() => exporter.exportExecutionCanaryEvidence(fixture.options, context))
      .toThrow(/snapshot manifest hash changed after the canary evidence write/i);
    expect(fs.existsSync(fixture.outputPath)).toBe(false);
    expect(temporaryOutputFiles(fixture)).toEqual([]);
  });

  it('removes the final output if the authority snapshot database hash drifts after writing', () => {
    const fixture = createFixture('policy_auto');
    const context = {
      ...fixture.context,
      afterOutputWritten: () => {
        fs.appendFileSync(fixture.databasePath, Buffer.from('post-write-drift'));
      },
    };

    expect(() => exporter.exportExecutionCanaryEvidence(fixture.options, context))
      .toThrow(/snapshot bytes do not match the manifest/i);
    expect(fs.existsSync(fixture.outputPath)).toBe(false);
    expect(temporaryOutputFiles(fixture)).toEqual([]);
  });

  it('rejects a committed WAL-only live authority change after the selected snapshot', () => {
    const fixture = createFixture('manual_approval');
    const database = new Database(fixture.sourcePath);
    try {
      database.pragma('journal_mode = WAL');
      database.pragma('wal_autocheckpoint = 0');
      database.pragma('wal_checkpoint(TRUNCATE)');
      fs.rmSync(fixture.databasePath);
      const onlineBackup = runReadonlySqliteOnlineBackupSync({
        sourceDatabasePath: fixture.sourcePath,
        destinationPath: fixture.databasePath,
        ownedTempRoot: path.dirname(fixture.databasePath),
      });
      const manifest = refreshSnapshotManifest(fixture);
      manifest.backup.totalPages = onlineBackup.observedBackup.totalPages;
      manifest.backup.remainingPages = onlineBackup.observedBackup.remainingPages;
      fs.writeFileSync(
        fixture.manifestPath,
        `${JSON.stringify(manifest, null, 2)}\n`,
      );

      const mainBefore = fileArtifact(fixture.sourcePath);
      database.exec(`
        CREATE TABLE authority_currentness_drift (
          id TEXT PRIMARY KEY,
          revoked INTEGER NOT NULL
        );
        INSERT INTO authority_currentness_drift VALUES ('grant-1', 1);
      `);
      expect(fs.statSync(`${fixture.sourcePath}-wal`).size).toBeGreaterThan(0);
      expect(fileArtifact(fixture.sourcePath)).toEqual(mainBefore);

      expect(() => exporter.exportExecutionCanaryEvidence(
        fixture.options,
        fixture.context,
      )).toThrow(/online backup does not match the selected authority snapshot/i);
      expect(fs.existsSync(fixture.outputPath)).toBe(false);
      expect(temporaryOutputFiles(fixture)).toEqual([]);
    } finally {
      database.close();
    }
  });
});

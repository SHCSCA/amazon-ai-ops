// 按证据职责拆分夹具与验收断言，测试仍归属原有入口。
import { Database, MINIMAL_PNGS, addCurrentCanaryLineage, expect, fs, path, readiness, runReadonlySqliteOnlineBackupSync } from './execution-canary-export-test-environment.mjs';
import { fileArtifact, makeTempDir, sha256File } from './execution-canary-export-test-artifacts.mjs';
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
    }
    finally {
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
        const artifactPath = readiness.deterministicExecutionArtifactPath(storesRoot, ids.storeId, ids.batchId, ids.jobId, slot);
        fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
        fs.writeFileSync(artifactPath, MINIMAL_PNGS[index]);
        artifactPaths[slot] = artifactPath;
        artifactRows.push({
            id: `${suffix}-${slot}`,
            slot,
            artifactRef: readiness.deterministicExecutionArtifactRef(ids.storeId, ids.batchId, ids.jobId, slot),
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
    `).run(ids.identityVersionId, ids.storeId, ids.canonicalKeywordId, ids.adEntityId, `ads-account-${suffix}`, `campaign-${suffix}`, `ad-group-${suffix}`, `keyword-${suffix}`, expectedBidCents, pageIdentityHash, ids.authorityId, sourceAuthorityProofSha256, sessionGeneration);
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
    `).run(`decision-history-${suffix}`, ids.storeId, ids.decisionId, JSON.stringify({ id: ids.decisionId, revision: 2, status: 'approved' }));
        database.prepare(`
      INSERT INTO analysis_proposal_snapshots VALUES (
        ?, ?, 'US', 'USD', ?, 1, ?, 1, 1, 'set_keyword_bid',
        'keyword', ?, ?, 1, ?, ?, ?, ?, '2026-07-27T13:00:00.000Z', ?
        , '2026-07-27T11:20:00.000Z'
      )
    `).run(ids.proposalId, ids.storeId, ids.missionId, ids.policyVersionId, ids.authorityId, ids.adEntityId, expectedBidCents, targetBidCents, signedChangePct, JSON.stringify({
            human: { eligible: true, blockers: [] },
            policy: { eligible: true, blockers: [] },
        }), sessionGeneration);
        database.prepare(`
      INSERT INTO analysis_proposal_decision_links VALUES (?, ?, ?, ?)
    `).run(`link-${suffix}`, ids.storeId, ids.proposalId, ids.decisionId);
        database.prepare(`
      INSERT INTO mission_grants VALUES (
        ?, ?, 'US', 'USD', ?, 1, ?, 1, ?, ?, 10, 10,
        '2026-07-27T13:00:00.000Z', ?, 1, ?, ?, ?,
        '2026-07-27T11:30:00.000Z', ?
      )
    `).run(ids.missionGrantId, ids.storeId, ids.missionId, JSON.stringify([ids.decisionId]), JSON.stringify(['set_keyword_bid']), JSON.stringify([ids.adEntityId]), ids.policyVersionId, JSON.stringify([
            'before_screenshot',
            'after_screenshot',
            'reload_screenshot',
            'page_identity',
            'readback_value',
        ]), JSON.stringify([
            { code: 'identity_drift', detail: 'stop' },
            { code: 'expected_before_mismatch', detail: 'stop' },
            { code: 'unknown_result', detail: 'stop' },
            { code: 'data_stale', detail: 'stop' },
            { code: 'impact_budget_exhausted', detail: 'stop' },
            { code: 'kill_switch', detail: 'stop' },
        ]), issuerType, sessionGeneration);
        const grantEvent = database.prepare(`
      INSERT INTO mission_grant_events VALUES (?, ?, ?, ?, ?)
    `);
        grantEvent.run(`${ids.missionGrantId}-issued`, ids.storeId, ids.missionGrantId, 'issued', '2026-07-27T11:30:00.000Z');
        grantEvent.run(`${ids.missionGrantId}-consumed`, ids.storeId, ids.missionGrantId, 'consumed', '2026-07-27T11:43:30.000Z');
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
    `).run(ids.jobId, ids.storeId, ids.batchId, ids.missionId, ids.missionGrantId, ids.proposalId, ids.decisionId, ids.canonicalKeywordId, ids.adEntityId, `ads-account-${suffix}`, `campaign-${suffix}`, `ad-group-${suffix}`, `keyword-${suffix}`, pageIdentityHash, expectedBidCents, targetBidCents, signedChangePct, sessionGeneration);
        const insertEvidence = database.prepare(`
      INSERT INTO ad_execution_evidence VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, 4, ?, ?, ?, ?
      )
    `);
        for (const record of artifactRows) {
            insertEvidence.run(record.id, ids.storeId, ids.batchId, ids.jobId, record.slot, record.artifactRef, record.contentSha256, pageIdentityHash, ids.canonicalKeywordId, record.observedBidCents, sessionGeneration, record.capturedAt, record.createdAt);
        }
    }
    finally {
        database.close();
    }
    const currentDatabase = new Database(databasePath);
    try {
        addCurrentCanaryLineage(currentDatabase);
    }
    finally {
        currentDatabase.close();
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
    return validation;
}
export { installSchema, refreshSnapshotManifest, mutateSnapshot, bindArtifactBytes, createFixture, expectFormalCanaryPass };

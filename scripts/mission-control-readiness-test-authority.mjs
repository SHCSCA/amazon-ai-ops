// 按证据职责拆分夹具与验收断言，测试仍归属原有入口。
import { Database, EXPECTED_REPORT_TYPES, addCurrentCanaryLineage, path, storeFixtures } from './mission-control-readiness-test-environment.mjs';
import { canaryScreenshotBytes, sha256Text, stableJson, writeArtifact } from './mission-control-readiness-test-artifacts.mjs';
function businessDates() {
    return ['2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17', '2026-07-20', '2026-07-21'];
}

function canaryDefinition(mode) {
    const manual = mode === 'manual_approval';
    const suffix = manual ? 'manual' : 'policy';
    const store = manual ? storeFixtures[0] : storeFixtures[1];
    const beforeBid = manual ? 100 : 95;
    const targetBid = manual ? 95 : 90;
    const authority = {
        storeId: store.storeId,
        browserProfileId: store.browserProfileId,
        issuerType: manual ? 'human' : 'policy',
        authorityId: `authority-${suffix}`,
        missionId: `mission-${suffix}`,
        missionRevision: 1,
        missionGrantId: `grant-${suffix}`,
        batchId: `batch-${suffix}`,
        jobId: `job-${suffix}`,
        proposalId: `proposal-${suffix}`,
        decisionId: `decision-${suffix}`,
        decisionRevision: 1,
        actionRevision: 1,
        policyVersionId: `policy-version-${suffix}-1`,
        policyRevision: 1,
    };
    const sourceAuthorityProofSha256 = sha256Text(`source-authority-proof:${suffix}`).toUpperCase();
    const object = {
        storeId: store.storeId,
        actionType: 'set_keyword_bid',
        identityVersionId: `identity-${suffix}`,
        canonicalKeywordId: `keyword-canonical-${suffix}`,
        adEntityId: `ad-entity-${suffix}`,
        entityRevision: 1,
        objectRevision: manual ? 4 : 5,
        adsAccountId: `ads-account-${suffix}`,
        campaignId: `campaign-${suffix}`,
        adGroupId: `ad-group-${suffix}`,
        keywordId: `keyword-${suffix}`,
        pageIdentityHash: sha256Text(`page-identity:${suffix}`).toUpperCase(),
        sourceAuthorityProofSha256,
        expectedBidCents: beforeBid,
        targetBidCents: targetBid,
    };
    return {
        authority,
        beforeBid,
        mode,
        object,
        scope: {
            storeId: store.storeId,
            browserProfileId: store.browserProfileId,
            marketplace: 'US',
            currency: 'USD',
        },
        suffix,
        targetBid,
    };
}

function executionArtifactPath(storesRoot, { storeId, batchId, jobId, slot }) {
    return path.join(storesRoot, storeId.trim().toLowerCase(), 'evidence', 'ad-execution', `batch-${sha256Text(batchId.trim().toLowerCase()).slice(0, 24)}`, `job-${sha256Text(jobId.trim().toLowerCase()).slice(0, 24)}`, `${slot}.png`);
}

function executionArtifactRef(binding) {
    return `artifact:execution:v1:${sha256Text(stableJson({
        batchId: binding.batchId,
        jobId: binding.jobId,
        slot: binding.slot,
        storeId: binding.storeId,
    }))}`;
}

function buildExecutionCanary(mode, storesRoot) {
    const definition = canaryDefinition(mode);
    const { authority, beforeBid, object, scope, suffix, targetBid } = definition;
    const minuteBase = mode === 'manual_approval' ? 4 : 14;
    const evidence = ['before', 'after', 'reload'].map((slot, index) => {
        const binding = { storeId: scope.storeId, batchId: authority.batchId, jobId: authority.jobId, slot };
        const artifactPath = executionArtifactPath(storesRoot, binding);
        const artifactRecord = writeArtifact(artifactPath, canaryScreenshotBytes((mode === 'manual_approval' ? 40 : 140) + (index * 20)));
        return {
            id: `${suffix}-${slot}`,
            ...binding,
            artifactPath,
            artifactRef: executionArtifactRef(binding),
            contentSha256: artifactRecord.sha256,
            sizeBytes: artifactRecord.sizeBytes,
            pageIdentityHash: object.pageIdentityHash,
            canonicalKeywordId: object.canonicalKeywordId,
            objectRevision: object.objectRevision,
            observedBidCents: slot === 'before' ? beforeBid : targetBid,
            capturedSessionGeneration: mode === 'manual_approval' ? 9 : 10,
            capturedAt: `2026-07-23T01:${String(minuteBase + index).padStart(2, '0')}:00.000Z`,
            createdAt: `2026-07-23T01:${String(minuteBase + index).padStart(2, '0')}:01.000Z`,
        };
    });
    return {
        kind: 'mission-control-execution-canary-evidence',
        schemaVersion: 'mission-control-execution-canary-evidence/v2',
        generatedAt: `2026-07-23T01:${mode === 'manual_approval' ? '21' : '23'}:00.000Z`,
        status: 'PASSED',
        passed: true,
        mode,
        storesRoot,
        scope,
        authority,
        object,
        execution: { status: 'succeeded', evidence },
    };
}

function installAuthoritySchema(database) {
    database.exec(`
    CREATE TABLE stores (
      store_id TEXT PRIMARY KEY, browser_profile_id TEXT NOT NULL,
      marketplace TEXT NOT NULL, currency TEXT NOT NULL, display_name TEXT NOT NULL,
      status TEXT NOT NULL, business_timezone TEXT NOT NULL,
      legacy_store_name_normalized TEXT, legacy_marketplace_code_normalized TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT
    );
    CREATE TABLE lingxing_collection_jobs (
      store_id TEXT NOT NULL, job_id TEXT NOT NULL, request_id TEXT NOT NULL,
      browser_profile_id TEXT NOT NULL, marketplace TEXT NOT NULL, currency TEXT NOT NULL,
      business_timezone TEXT NOT NULL, business_date TEXT NOT NULL,
      session_generation INTEGER NOT NULL, date_start TEXT NOT NULL, date_end TEXT NOT NULL,
      mode TEXT NOT NULL, report_types_json TEXT NOT NULL, state TEXT NOT NULL,
      snapshot_json TEXT NOT NULL, last_event_id TEXT, last_event_emitted_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT,
      blocker_code TEXT, detail TEXT, PRIMARY KEY (store_id, job_id)
    );
    CREATE TABLE lingxing_collection_report_checkpoints (
      store_id TEXT NOT NULL, job_id TEXT NOT NULL, report_type TEXT NOT NULL,
      state TEXT NOT NULL, file_size_bytes INTEGER NOT NULL,
      error_code TEXT, detail TEXT, updated_at TEXT NOT NULL
    );
    CREATE TABLE lingxing_report_batches (
      id TEXT NOT NULL, store_id TEXT NOT NULL, business_date TEXT NOT NULL,
      request_id TEXT NOT NULL, browser_profile_id TEXT NOT NULL,
      session_generation INTEGER NOT NULL, status TEXT NOT NULL,
      created_at TEXT NOT NULL, completed_at TEXT NOT NULL,
      PRIMARY KEY (store_id, id)
    );
    CREATE TABLE report_import_runs (
      store_id TEXT NOT NULL, run_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
      input_fingerprint TEXT NOT NULL, batch_id TEXT NOT NULL, status TEXT NOT NULL,
      source_file_count INTEGER NOT NULL, metric_row_count INTEGER NOT NULL,
      reconciliation_count INTEGER NOT NULL, started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE report_import_file_snapshots (
      store_id TEXT NOT NULL, run_id TEXT NOT NULL, report_type TEXT NOT NULL,
      batch_id TEXT NOT NULL, file_hash TEXT NOT NULL, file_path TEXT NOT NULL,
      file_name TEXT NOT NULL, file_size_bytes INTEGER NOT NULL,
      imported_rows INTEGER NOT NULL, captured_at TEXT NOT NULL
    );
    CREATE TABLE report_import_reconciliations (
      store_id TEXT NOT NULL, run_id TEXT NOT NULL, report_type TEXT NOT NULL,
      batch_id TEXT NOT NULL, status TEXT NOT NULL,
      within_tolerance INTEGER NOT NULL, reconciled_at TEXT NOT NULL
    );
    CREATE TABLE verified_ad_entity_authority (
      authority_id TEXT PRIMARY KEY, store_id TEXT NOT NULL, ad_entity_id TEXT NOT NULL,
      entity_revision INTEGER NOT NULL, entity_type TEXT NOT NULL, entity_name TEXT NOT NULL,
      campaign_name TEXT NOT NULL, ad_group_name TEXT NOT NULL, evidence_package_id TEXT NOT NULL,
      source_report_type TEXT NOT NULL, source_file_hash TEXT NOT NULL, source_row INTEGER NOT NULL,
      identity_source TEXT NOT NULL, proof_sha256 TEXT NOT NULL, verified_by TEXT NOT NULL,
      verified_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE ad_keyword_identity_versions (
      identity_version_id TEXT PRIMARY KEY, store_id TEXT NOT NULL, marketplace TEXT NOT NULL,
      currency TEXT NOT NULL, canonical_keyword_id TEXT NOT NULL, ad_entity_id TEXT NOT NULL,
      entity_revision INTEGER NOT NULL, ads_account_id TEXT NOT NULL, campaign_id TEXT NOT NULL,
      ad_group_id TEXT NOT NULL, keyword_id TEXT NOT NULL, object_revision INTEGER NOT NULL,
      observed_bid_cents INTEGER NOT NULL, page_identity_hash TEXT NOT NULL,
      source_authority_id TEXT NOT NULL, source_authority_proof_sha256 TEXT NOT NULL,
      resolution_proof_sha256 TEXT NOT NULL, resolved_session_generation INTEGER NOT NULL,
      resolved_at TEXT NOT NULL, resolved_by TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE missions (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL, marketplace TEXT NOT NULL,
      currency TEXT NOT NULL, policy_version_id TEXT NOT NULL,
      status TEXT NOT NULL, revision INTEGER NOT NULL
    );
    CREATE TABLE policy_versions (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL, status TEXT NOT NULL,
      rules_json TEXT NOT NULL, revision INTEGER NOT NULL
    );
    CREATE TABLE policy_runtime (
      store_id TEXT NOT NULL, autonomy_mode TEXT NOT NULL, kill_switch INTEGER NOT NULL,
      circuit_breaker_state TEXT NOT NULL, active_policy_version_id TEXT NOT NULL
    );
    CREATE TABLE decisions (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL, mission_id TEXT NOT NULL,
      policy_version_id TEXT NOT NULL, policy_revision INTEGER NOT NULL,
      action_revision INTEGER NOT NULL, action_type TEXT NOT NULL,
      ad_entity_id TEXT NOT NULL, status TEXT NOT NULL, revision INTEGER NOT NULL,
      valid_until TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE decision_history (
      id TEXT NOT NULL, store_id TEXT NOT NULL, decision_id TEXT NOT NULL,
      decision_revision INTEGER NOT NULL, event_type TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE analysis_proposal_snapshots (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL, marketplace TEXT NOT NULL,
      currency TEXT NOT NULL, mission_id TEXT NOT NULL, mission_revision INTEGER NOT NULL,
      policy_version_id TEXT NOT NULL, policy_revision INTEGER NOT NULL,
      action_revision INTEGER NOT NULL, action_type TEXT NOT NULL, entity_type TEXT NOT NULL,
      ad_entity_authority_id TEXT NOT NULL, ad_entity_id TEXT NOT NULL,
      ad_entity_revision INTEGER NOT NULL, current_bid_cents INTEGER NOT NULL,
      proposed_bid_cents INTEGER NOT NULL, change_pct REAL NOT NULL,
      authorization_json TEXT NOT NULL, valid_until TEXT NOT NULL,
      created_session_generation INTEGER NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE analysis_proposal_decision_links (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL, proposal_id TEXT NOT NULL,
      decision_id TEXT NOT NULL
    );
    CREATE TABLE mission_grants (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL, marketplace TEXT NOT NULL, currency TEXT NOT NULL,
      mission_id TEXT NOT NULL, mission_revision INTEGER NOT NULL, decision_ids_json TEXT NOT NULL,
      action_revision INTEGER NOT NULL, allowed_action_types_json TEXT NOT NULL,
      allowed_ad_entity_ids_json TEXT NOT NULL, max_change_pct REAL NOT NULL,
      total_impact_budget REAL NOT NULL, expires_at TEXT NOT NULL, policy_version_id TEXT NOT NULL,
      policy_revision INTEGER NOT NULL, required_evidence_json TEXT NOT NULL,
      stop_conditions_json TEXT NOT NULL, issuer_type TEXT NOT NULL, issuer_actor_id TEXT NOT NULL,
      issued_at TEXT NOT NULL, created_session_generation INTEGER NOT NULL
    );
    CREATE TABLE mission_grant_events (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL, grant_id TEXT NOT NULL,
      event_type TEXT NOT NULL, actor_id TEXT NOT NULL, reason TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE ad_execution_batches (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL, marketplace TEXT NOT NULL, currency TEXT NOT NULL,
      mission_id TEXT NOT NULL, mission_revision INTEGER NOT NULL, grant_id TEXT NOT NULL,
      action_revision INTEGER NOT NULL, status TEXT NOT NULL, revision INTEGER NOT NULL,
      created_session_generation INTEGER NOT NULL, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, terminal_at TEXT
    );
    CREATE TABLE ad_execution_jobs (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL, batch_id TEXT NOT NULL, ordinal INTEGER NOT NULL,
      mission_id TEXT NOT NULL, grant_id TEXT NOT NULL, proposal_id TEXT NOT NULL,
      decision_id TEXT NOT NULL, decision_revision INTEGER NOT NULL, action_revision INTEGER NOT NULL,
      action_type TEXT NOT NULL, canonical_keyword_id TEXT NOT NULL, ad_entity_id TEXT NOT NULL,
      entity_revision INTEGER NOT NULL, ads_account_id TEXT NOT NULL, campaign_id TEXT NOT NULL,
      ad_group_id TEXT NOT NULL, keyword_id TEXT NOT NULL, object_revision INTEGER NOT NULL,
      page_identity_hash TEXT NOT NULL, expected_bid_cents INTEGER NOT NULL,
      target_bid_cents INTEGER NOT NULL, change_pct REAL NOT NULL, idempotency_key TEXT NOT NULL,
      status TEXT NOT NULL, revision INTEGER NOT NULL, created_session_generation INTEGER NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, submit_intent_id TEXT,
      command_fingerprint TEXT, intent_written_at TEXT, submitted_at TEXT, terminal_at TEXT
    );
    CREATE TABLE ad_execution_evidence (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL, batch_id TEXT NOT NULL, job_id TEXT NOT NULL,
      slot TEXT NOT NULL, artifact_ref TEXT NOT NULL, content_sha256 TEXT NOT NULL,
      page_identity_hash TEXT NOT NULL, canonical_keyword_id TEXT NOT NULL,
      object_revision INTEGER NOT NULL, observed_bid_cents INTEGER NOT NULL,
      captured_session_generation INTEGER NOT NULL, captured_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
  `);
}

function insertCanaryAuthority(database, canary) {
    const { authority, object, scope } = canary;
    const evidence = canary.execution.evidence;
    const sessionGeneration = evidence[0].capturedSessionGeneration;
    database.prepare(`
    INSERT INTO verified_ad_entity_authority (
      authority_id, store_id, ad_entity_id, entity_revision, entity_type, entity_name,
      campaign_name, ad_group_name, evidence_package_id, source_report_type, source_file_hash,
      source_row, identity_source, proof_sha256, verified_by, verified_at, created_at
    ) VALUES (?, ?, ?, ?, 'keyword', ?, ?, ?, ?, 'keyword', ?, 1, 'ads_ui', ?, 'operator', ?, ?)
  `).run(authority.authorityId, scope.storeId, object.adEntityId, object.entityRevision, `keyword-${canary.mode}`, object.campaignId, object.adGroupId, `evidence-package-${canary.mode}`, sha256Text(`source-file:${canary.mode}`).toUpperCase(), object.sourceAuthorityProofSha256, '2026-07-23T01:00:00.000Z', '2026-07-23T01:00:00.000Z');
    database.prepare(`
    INSERT INTO ad_keyword_identity_versions (
      identity_version_id, store_id, marketplace, currency, canonical_keyword_id, ad_entity_id,
      entity_revision, ads_account_id, campaign_id, ad_group_id, keyword_id, object_revision,
      observed_bid_cents, page_identity_hash, source_authority_id, source_authority_proof_sha256,
      resolution_proof_sha256, resolved_session_generation, resolved_at, resolved_by, created_at
    ) VALUES (?, ?, 'US', 'USD', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'operator', ?)
  `).run(object.identityVersionId, scope.storeId, object.canonicalKeywordId, object.adEntityId, object.entityRevision, object.adsAccountId, object.campaignId, object.adGroupId, object.keywordId, object.objectRevision, object.expectedBidCents, object.pageIdentityHash, authority.authorityId, object.sourceAuthorityProofSha256, sha256Text(`resolution:${canary.mode}`).toUpperCase(), sessionGeneration, '2026-07-23T01:01:00.000Z', '2026-07-23T01:01:00.000Z');
    database.prepare(`
    INSERT INTO missions (
      id, store_id, marketplace, currency, policy_version_id, status, revision
    ) VALUES (?, ?, 'US', 'USD', ?, 'active', ?)
  `).run(authority.missionId, scope.storeId, authority.policyVersionId, authority.missionRevision);
    database.prepare(`
    INSERT INTO policy_versions (id, store_id, status, rules_json, revision)
    VALUES (?, ?, 'enabled', ?, ?)
  `).run(authority.policyVersionId, scope.storeId, JSON.stringify({ killSwitch: false }), authority.policyRevision);
    database.prepare(`
    INSERT INTO policy_runtime (
      store_id, autonomy_mode, kill_switch, circuit_breaker_state, active_policy_version_id
    ) VALUES (?, ?, 0, 'closed', ?)
  `).run(scope.storeId, canary.mode, authority.policyVersionId);
    database.prepare(`
    INSERT INTO decisions (
      id, store_id, mission_id, policy_version_id, policy_revision, action_revision,
      action_type, ad_entity_id, status, revision, valid_until, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'set_keyword_bid', ?, 'approved', ?, ?, ?, ?)
  `).run(authority.decisionId, scope.storeId, authority.missionId, authority.policyVersionId, authority.policyRevision, authority.actionRevision, object.adEntityId, authority.decisionRevision, '2026-07-24T00:00:00.000Z', '2026-07-23T01:01:20.000Z', '2026-07-23T01:01:40.000Z');
    database.prepare(`
    INSERT INTO decision_history (
      id, store_id, decision_id, decision_revision, event_type, created_at
    ) VALUES (?, ?, ?, ?, 'approved', ?)
  `).run(`decision-approved-${canary.mode}`, scope.storeId, authority.decisionId, authority.decisionRevision, '2026-07-23T01:01:30.000Z');
    database.prepare(`
    INSERT INTO analysis_proposal_snapshots (
      id, store_id, marketplace, currency, mission_id, mission_revision,
      policy_version_id, policy_revision, action_revision, action_type, entity_type,
      ad_entity_authority_id, ad_entity_id, ad_entity_revision, current_bid_cents,
      proposed_bid_cents, change_pct, authorization_json, valid_until,
      created_session_generation, created_at
    ) VALUES (?, ?, 'US', 'USD', ?, ?, ?, ?, ?, 'set_keyword_bid', 'keyword',
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(authority.proposalId, scope.storeId, authority.missionId, authority.missionRevision, authority.policyVersionId, authority.policyRevision, authority.actionRevision, authority.authorityId, object.adEntityId, object.entityRevision, object.expectedBidCents, object.targetBidCents, ((object.targetBidCents - object.expectedBidCents) / object.expectedBidCents) * 100, JSON.stringify({
        human: { eligible: true, blockers: [] },
        policy: { eligible: true, blockers: [] },
    }), '2026-07-24T00:00:00.000Z', sessionGeneration, '2026-07-23T01:01:10.000Z');
    database.prepare(`
    INSERT INTO analysis_proposal_decision_links (
      id, store_id, proposal_id, decision_id
    ) VALUES (?, ?, ?, ?)
  `).run(`proposal-decision-link-${canary.mode}`, scope.storeId, authority.proposalId, authority.decisionId);
    database.prepare(`
    INSERT INTO mission_grants (
      id, store_id, marketplace, currency, mission_id, mission_revision, decision_ids_json,
      action_revision, allowed_action_types_json, allowed_ad_entity_ids_json, max_change_pct,
      total_impact_budget, expires_at, policy_version_id, policy_revision, required_evidence_json,
      stop_conditions_json, issuer_type, issuer_actor_id, issued_at, created_session_generation
    ) VALUES (?, ?, 'US', 'USD', ?, ?, ?, ?, ?, ?, 10, 10, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(authority.missionGrantId, scope.storeId, authority.missionId, authority.missionRevision, JSON.stringify([authority.decisionId]), authority.actionRevision, JSON.stringify(['set_keyword_bid']), JSON.stringify([object.adEntityId]), '2026-07-24T00:00:00.000Z', authority.policyVersionId, authority.policyRevision, JSON.stringify(['before_screenshot', 'after_screenshot', 'reload_screenshot', 'page_identity', 'readback_value']), JSON.stringify(['identity_drift', 'expected_before_mismatch', 'unknown_result', 'data_stale', 'impact_budget_exhausted', 'kill_switch']), authority.issuerType, `${authority.issuerType}-actor`, '2026-07-23T01:02:00.000Z', sessionGeneration);
    const eventInsert = database.prepare(`
    INSERT INTO mission_grant_events (id, store_id, grant_id, event_type, actor_id, reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
    eventInsert.run(`${authority.missionGrantId}-issued`, scope.storeId, authority.missionGrantId, 'issued', `${authority.issuerType}-actor`, 'canary grant issued', '2026-07-23T01:02:00.000Z');
    eventInsert.run(`${authority.missionGrantId}-consumed`, scope.storeId, authority.missionGrantId, 'consumed', 'executor', 'canary execution succeeded', '2026-07-23T01:17:30.000Z');
    database.prepare(`
    INSERT INTO ad_execution_batches (
      id, store_id, marketplace, currency, mission_id, mission_revision, grant_id, action_revision,
      status, revision, created_session_generation, created_at, updated_at, terminal_at
    ) VALUES (?, ?, 'US', 'USD', ?, ?, ?, ?, 'succeeded', 4, ?, ?, ?, ?)
  `).run(authority.batchId, scope.storeId, authority.missionId, authority.missionRevision, authority.missionGrantId, authority.actionRevision, sessionGeneration, '2026-07-23T01:03:00.000Z', '2026-07-23T01:17:00.000Z', '2026-07-23T01:17:00.000Z');
    database.prepare(`
    INSERT INTO ad_execution_jobs (
      id, store_id, batch_id, ordinal, mission_id, grant_id, proposal_id, decision_id,
      decision_revision, action_revision, action_type, canonical_keyword_id, ad_entity_id,
      entity_revision, ads_account_id, campaign_id, ad_group_id, keyword_id, object_revision,
      page_identity_hash, expected_bid_cents, target_bid_cents, change_pct, idempotency_key,
      status, revision, created_session_generation, created_at, updated_at, submit_intent_id,
      command_fingerprint, intent_written_at, submitted_at, terminal_at
    ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 'set_keyword_bid', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'succeeded', 7, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(authority.jobId, scope.storeId, authority.batchId, authority.missionId, authority.missionGrantId, authority.proposalId, authority.decisionId, authority.decisionRevision, authority.actionRevision, object.canonicalKeywordId, object.adEntityId, object.entityRevision, object.adsAccountId, object.campaignId, object.adGroupId, object.keywordId, object.objectRevision, object.pageIdentityHash, object.expectedBidCents, object.targetBidCents, ((object.targetBidCents - object.expectedBidCents) / object.expectedBidCents) * 100, sha256Text(`idempotency:${canary.mode}`).toUpperCase(), sessionGeneration, '2026-07-23T01:03:00.000Z', '2026-07-23T01:17:00.000Z', `intent-${canary.mode}`, sha256Text(`command:${canary.mode}`).toUpperCase(), '2026-07-23T01:03:30.000Z', canary.mode === 'manual_approval'
        ? '2026-07-23T01:04:30.000Z'
        : '2026-07-23T01:14:30.000Z', '2026-07-23T01:17:00.000Z');
    const evidenceInsert = database.prepare(`
    INSERT INTO ad_execution_evidence (
      id, store_id, batch_id, job_id, slot, artifact_ref, content_sha256, page_identity_hash,
      canonical_keyword_id, object_revision, observed_bid_cents, captured_session_generation,
      captured_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
    for (const record of evidence) {
        evidenceInsert.run(record.id, record.storeId, record.batchId, record.jobId, record.slot, record.artifactRef, record.contentSha256, record.pageIdentityHash, record.canonicalKeywordId, record.objectRevision, record.observedBidCents, record.capturedSessionGeneration, record.capturedAt, record.createdAt);
    }
}

function createAuthorityDatabase(databasePath, canaries) {
    const database = new Database(databasePath);
    try {
        installAuthoritySchema(database);
        const insertStore = database.prepare(`
      INSERT INTO stores (
        store_id, browser_profile_id, marketplace, currency, display_name, status,
        business_timezone, created_at, updated_at
      ) VALUES (?, ?, 'US', 'USD', ?, 'active', 'America/Los_Angeles', ?, ?)
    `);
        for (const store of storeFixtures) {
            insertStore.run(store.storeId, store.browserProfileId, store.storeId, '2026-07-13T00:00:00.000Z', '2026-07-23T00:00:00.000Z');
        }
        const insertJob = database.prepare(`
      INSERT INTO lingxing_collection_jobs (
        store_id, job_id, request_id, browser_profile_id, marketplace, currency,
        business_timezone, business_date, session_generation, date_start, date_end, mode,
        report_types_json, state, snapshot_json, created_at, updated_at, completed_at,
        blocker_code, detail
      ) VALUES (?, ?, ?, ?, 'US', 'USD', 'America/Los_Angeles', ?, 9, ?, ?,
        'create-and-download', ?, 'completed', '{}', ?, ?, ?, NULL, NULL)
    `);
        const insertCheckpoint = database.prepare(`
      INSERT INTO lingxing_collection_report_checkpoints
        (store_id, job_id, report_type, state, file_size_bytes, error_code, detail, updated_at)
      VALUES (?, ?, ?, 'downloaded', ?, NULL, 'downloaded', ?)
    `);
        const insertBatch = database.prepare(`
      INSERT INTO lingxing_report_batches (
        id, store_id, business_date, request_id, browser_profile_id,
        session_generation, status, created_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, 9, 'completed', ?, ?)
    `);
        const insertRun = database.prepare(`
      INSERT INTO report_import_runs
        (store_id, run_id, idempotency_key, input_fingerprint, batch_id, status,
         source_file_count, metric_row_count, reconciliation_count,
         started_at, completed_at, created_at)
      VALUES (?, ?, ?, ?, ?, 'completed', 8, 80, 8, ?, ?, ?)
    `);
        const insertFile = database.prepare(`
      INSERT INTO report_import_file_snapshots (
        store_id, run_id, report_type, batch_id, file_hash, file_path,
        file_name, file_size_bytes, imported_rows, captured_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 10, ?)
    `);
        const insertReconciliation = database.prepare(`
      INSERT INTO report_import_reconciliations (
        store_id, run_id, report_type, batch_id, status, within_tolerance, reconciled_at
      ) VALUES (?, ?, ?, ?, 'matched', 1, ?)
    `);
        for (const store of storeFixtures) {
            for (const [index, businessDate] of businessDates().entries()) {
                const timestamp = `${businessDate}T16:00:00.000Z`;
                const jobId = `${store.storeId}-job-${index}`;
                const runId = `${store.storeId}-run-${index}`;
                insertJob.run(store.storeId, jobId, `${store.storeId}-request-${index}`, store.browserProfileId, businessDate, businessDate, businessDate, JSON.stringify(EXPECTED_REPORT_TYPES), timestamp, timestamp, timestamp);
                insertBatch.run(jobId, store.storeId, businessDate, `${store.storeId}-request-${index}`, store.browserProfileId, timestamp, timestamp);
                insertRun.run(store.storeId, runId, `${store.storeId}-idem-${index}`, sha256Text(`${store.storeId}:${businessDate}:fingerprint`).toUpperCase(), jobId, timestamp, timestamp, timestamp);
                for (const reportType of EXPECTED_REPORT_TYPES) {
                    const reportPath = path.join(path.dirname(databasePath), 'stores', store.storeId, 'reports', businessDate, `${reportType}.csv`);
                    const reportArtifact = writeArtifact(reportPath, `${store.storeId},${businessDate},${reportType},${runId}\n`);
                    insertCheckpoint.run(store.storeId, jobId, reportType, reportArtifact.sizeBytes, timestamp);
                    insertFile.run(store.storeId, runId, reportType, jobId, reportArtifact.sha256, reportPath, path.basename(reportPath), reportArtifact.sizeBytes, timestamp);
                    insertReconciliation.run(store.storeId, runId, reportType, jobId, timestamp);
                }
            }
        }
        for (const canary of canaries)
            insertCanaryAuthority(database, canary);
        addCurrentCanaryLineage(database);
    }
    finally {
        database.close();
    }
}
export { businessDates, canaryDefinition, executionArtifactPath, executionArtifactRef, buildExecutionCanary, installAuthoritySchema, insertCanaryAuthority, createAuthorityDatabase };

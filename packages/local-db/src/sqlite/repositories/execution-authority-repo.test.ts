import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  normalizeStoreContextEnvelope,
  type RegisterAdKeywordIdentityInput,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import { initSqlite } from '../db';
import { ExecutionAuthorityRepository } from './execution-authority-repo';

const NOW = '2026-07-23T02:00:00.000Z';
const PAGE_HASH = 'a'.repeat(64);
const PROOF_HASH = 'b'.repeat(64);
const COMMAND_HASH = 'c'.repeat(64);
const tempDirs: string[] = [];
const databases: Database.Database[] = [];

afterEach(() => {
  while (databases.length > 0) {
    const database = databases.pop();
    if (database?.open) database.close();
  }
  while (tempDirs.length > 0) {
    const directory = tempDirs.pop();
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  }
});

interface Harness {
  database: Database.Database;
  databasePath: string;
  context: StoreContextEnvelope;
  repository: ExecutionAuthorityRepository;
}

function createHarness(
  maxChangePct = 10,
  totalImpactBudget = 10,
  actionCount = 1,
  issuerType: 'human' | 'policy' = 'human',
): Harness {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-execution-repo-'));
  tempDirs.push(directory);
  const databasePath = path.join(directory, 'app.db');
  const database = initSqlite(databasePath);
  databases.push(database);
  seedStage5Authority(database, maxChangePct, totalImpactBudget, actionCount, issuerType);
  const context = normalizeStoreContextEnvelope({
    storeId: 'store-one',
    browserProfileId: 'profile-one',
    marketplace: 'US',
    currency: 'USD',
    businessTimezone: 'America/Los_Angeles',
    businessDate: '2026-07-22',
    sessionGeneration: 4,
  });
  return {
    database,
    databasePath,
    context,
    repository: new ExecutionAuthorityRepository(database, { now: () => new Date(NOW) }),
  };
}

function seedStage5Authority(
  database: Database.Database,
  maxChangePct: number,
  totalImpactBudget: number,
  actionCount: number,
  issuerType: 'human' | 'policy',
): void {
  database.prepare(`
    INSERT INTO stores (
      store_id, browser_profile_id, marketplace, currency, display_name,
      status, business_timezone, created_at, updated_at
    ) VALUES ('store-one', 'profile-one', 'US', 'USD', 'US Store One',
      'active', 'America/Los_Angeles', ?, ?)
  `).run(NOW, NOW);
  database.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES ('store_session_generation:store-one', '4', ?)
  `).run(NOW);
  database.prepare(`
    INSERT INTO store_connections (
      id, store_id, provider, status, account_label, external_account_id,
      last_verified_at, created_at, updated_at
    ) VALUES ('conn-ads-one', 'store-one', 'amazon_ads', 'ready', 'Ads One',
      'ads-account-1', ?, ?, ?)
  `).run(NOW, NOW, NOW);
  database.prepare(`
    INSERT INTO store_session_metadata (
      store_id, provider, browser_profile_id, status, session_generation,
      observed_at, external_account_id, verified_at, updated_at
    ) VALUES ('store-one', 'amazon_ads', 'profile-one', 'ready', 4,
      ?, 'ads-account-1', ?, ?)
  `).run(NOW, NOW, NOW);
  database.prepare(`
    INSERT INTO lingxing_report_batches (
      id, date_start, date_end, store_name, marketplace_code, status,
      download_dir, created_at, completed_at, store_id, request_id,
      browser_profile_id, business_date, session_generation
    ) VALUES ('data-batch-1', '2026-07-01', '2026-07-22', 'US Store One', 'US',
      'completed', 'artifact:data-batch-1', ?, ?, 'store-one', 'request-1',
      'profile-one', '2026-07-22', 4)
  `).run(NOW, NOW);
  database.prepare(`
    INSERT INTO policies (
      id, store_id, name, scope, status, priority, active_version_id,
      revision, created_at, updated_at
    ) VALUES ('policy-1', 'store-one', 'Keyword safety', 'store', 'active', 1,
      NULL, 2, ?, ?)
  `).run(NOW, NOW);
  const rules = {
    allowedActionTypes: ['set_keyword_bid'],
    allowedAdEntityIds: ['opaque-keyword-1'],
    maxChangePct: 10,
    totalImpactBudget: 10,
    maxDailyActionCount: 10,
    cooldownMinutes: 0,
    executionWindow: {
      timeZone: 'America/Los_Angeles', daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      start: '00:00', end: '23:59',
    },
    requiredEvidence: [
      'page_identity', 'before_screenshot', 'after_screenshot',
      'reload_screenshot', 'readback_value',
    ],
    stopConditions: [
      { code: 'identity_drift', detail: 'stop' },
      { code: 'expected_before_mismatch', detail: 'stop' },
      { code: 'unknown_result', detail: 'stop' },
      { code: 'data_stale', detail: 'stop' },
      { code: 'impact_budget_exhausted', detail: 'stop' },
      { code: 'kill_switch', detail: 'stop' },
    ],
    killSwitch: false,
  };
  database.prepare(`
    INSERT INTO policy_versions (
      id, store_id, policy_id, version, status, rules_json, revision,
      created_at, updated_at, enabled_at
    ) VALUES ('policy-version-1', 'store-one', 'policy-1', 1, 'enabled', ?, 1, ?, ?, ?)
  `).run(JSON.stringify(rules), NOW, NOW, NOW);
  database.prepare(`
    UPDATE policies SET active_version_id = 'policy-version-1' WHERE id = 'policy-1'
  `).run();
  database.prepare(`
    UPDATE policy_runtime SET active_policy_version_id = 'policy-version-1',
      autonomy_mode = ?, updated_at = ?
    WHERE store_id = 'store-one'
  `).run(issuerType === 'policy' ? 'policy_auto' : 'manual_approval', NOW);
  database.prepare(`
    INSERT INTO missions (
      id, store_id, marketplace, currency, business_date,
      created_session_generation, data_batch_id, policy_version_id,
      title, objective, status, phase, priority, observation_starts_at,
      observation_ends_at, success_criteria_json, guardrails_json, revision,
      created_at, updated_at
    ) VALUES ('mission-1', 'store-one', 'US', 'USD', '2026-07-22', 4,
      'data-batch-1', 'policy-version-1', 'Lower keyword bid', 'Lower ACOS',
      'active', 'decision', 'P1', '2026-07-22T00:00:00.000Z',
      '2026-07-30T00:00:00.000Z', '["ACOS improves"]', '["UNKNOWN stops"]',
      1, ?, ?)
  `).run(NOW, NOW);
  database.prepare(`
    INSERT INTO report_import_runs (
      store_id, run_id, idempotency_key, input_fingerprint, batch_id, status,
      source_file_count, metric_row_count, reconciliation_count,
      started_at, completed_at, created_at
    ) VALUES ('store-one', 'import-run-1', 'import-idem-1', ?, 'data-batch-1',
      'completed', 8, 8, 8, ?, ?, ?)
  `).run('c'.repeat(64), NOW, NOW, NOW);
  database.prepare(`
    INSERT INTO analysis_evidence_packages (
      id, store_id, marketplace, currency, mission_id, data_batch_id, import_run_id,
      date_from, date_to, report_types_json, sources_json, metric_row_count,
      reconciliation_hash, rule_revision, model_revision, package_hash,
      imported_at, fresh_until, sealed_at, created_session_generation
    ) VALUES ('evidence-1', 'store-one', 'US', 'USD', 'mission-1', 'data-batch-1',
      'import-run-1', '2026-07-01', '2026-07-22', '[]', '[]', 8, ?, ?,
      'model-1', ?, ?, '2026-07-24T00:00:00.000Z', ?, 4)
  `).run('d'.repeat(64), 'e'.repeat(64), 'f'.repeat(64), NOW, NOW);
  database.prepare(`
    INSERT INTO verified_ad_entity_authority (
      authority_id, store_id, ad_entity_id, entity_revision, entity_type,
      entity_name, campaign_name, ad_group_name, evidence_package_id,
      source_report_type, source_file_hash, source_row, identity_source,
      proof_sha256, verified_by, verified_at, created_at
    ) VALUES ('stage5-authority-1', 'store-one', 'opaque-keyword-1', 1, 'keyword',
      'door lock', 'Campaign A', 'Ad Group A', 'evidence-1', 'keyword', ?, 7,
      'ads_ui', ?, 'operator', ?, ?)
  `).run('1'.repeat(64), PROOF_HASH, NOW, NOW);
  database.prepare(`
    INSERT INTO analysis_action_batches (
      id, store_id, mission_id, mission_revision, evidence_package_id,
      rule_revision, model_revision, action_revision, created_at,
      created_session_generation
    ) VALUES ('analysis-batch-1', 'store-one', 'mission-1', 1, 'evidence-1', ?,
      'model-1', 1, ?, 4)
  `).run('e'.repeat(64), NOW);
  database.prepare(`
    INSERT INTO analysis_proposal_snapshots (
      id, store_id, marketplace, currency, mission_id, mission_revision,
      evidence_package_id, evidence_package_hash, data_batch_id,
      policy_version_id, policy_revision, rule_revision, model_revision,
      action_batch_id, action_revision, legacy_recommendation_id, action_type,
      entity_type, entity_name, campaign_name, ad_group_name,
      ad_entity_authority_id, ad_entity_id, ad_entity_revision,
      current_bid_cents, proposed_bid_cents, change_pct, confidence, source,
      explanation, authorization_json, valid_until, created_at,
      created_session_generation
    ) VALUES ('proposal-1', 'store-one', 'US', 'USD', 'mission-1', 1,
      'evidence-1', ?, 'data-batch-1', 'policy-version-1', 1, ?, 'model-1',
      'analysis-batch-1', 1, 1, 'set_keyword_bid', 'keyword', 'door lock',
      'Campaign A', 'Ad Group A', 'stage5-authority-1', 'opaque-keyword-1', 1,
      149, 139, -6.7114093959731544, 0.9, 'rule_ai', 'lower inefficient bid',
      ?, '2026-07-24T00:00:00.000Z', ?, 4)
  `).run(
    'f'.repeat(64),
    'e'.repeat(64),
    JSON.stringify({ human: { eligible: true, blockers: [] }, policy: { eligible: true, blockers: [] } }),
    NOW,
  );
  database.prepare(`
    INSERT INTO decisions (
      id, store_id, mission_id, data_batch_id, policy_version_id, policy_revision,
      action_revision, title, rationale, recommendation, facts_json,
      alternatives_json, valid_until, action_type, ad_entity_id,
      current_value_json, recommended_value_json, confidence, status, revision,
      created_at, updated_at
    ) VALUES ('decision-1', 'store-one', 'mission-1', 'data-batch-1',
      'policy-version-1', 1, 1, 'Lower door lock bid', 'High ACOS', 'Lower bid',
      '["fact"]', '["keep"]', '2026-07-24T00:00:00.000Z', 'set_keyword_bid',
      'opaque-keyword-1', '1.49', '1.39', 0.9, 'approved', 2, ?, ?)
  `).run(NOW, NOW);
  database.prepare(`
    INSERT INTO analysis_proposal_decision_links (
      id, store_id, proposal_id, decision_id, created_at
    ) VALUES ('proposal-link-1', 'store-one', 'proposal-1', 'decision-1', ?)
  `).run(NOW);
  for (let actionIndex = 2; actionIndex <= actionCount; actionIndex += 1) {
    const authorityId = `stage5-authority-${actionIndex}`;
    const adEntityId = `opaque-keyword-${actionIndex}`;
    const proposalId = `proposal-${actionIndex}`;
    const decisionId = `decision-${actionIndex}`;
    const entityName = `keyword ${actionIndex}`;
    const adGroupName = `Ad Group ${actionIndex}`;
    database.prepare(`
      INSERT INTO verified_ad_entity_authority (
        authority_id, store_id, ad_entity_id, entity_revision, entity_type,
        entity_name, campaign_name, ad_group_name, evidence_package_id,
        source_report_type, source_file_hash, source_row, identity_source,
        proof_sha256, verified_by, verified_at, created_at
      ) VALUES (?, 'store-one', ?, 1, 'keyword',
        ?, 'Campaign A', ?, 'evidence-1', 'keyword', ?, ?,
        'ads_ui', ?, 'operator', ?, ?)
    `).run(
      authorityId,
      adEntityId,
      entityName,
      adGroupName,
      `${actionIndex}`.repeat(64).slice(0, 64),
      actionIndex + 6,
      `${actionIndex + 1}`.repeat(64).slice(0, 64),
      NOW,
      NOW,
    );
    database.prepare(`
      INSERT INTO analysis_proposal_snapshots (
        id, store_id, marketplace, currency, mission_id, mission_revision,
        evidence_package_id, evidence_package_hash, data_batch_id,
        policy_version_id, policy_revision, rule_revision, model_revision,
        action_batch_id, action_revision, legacy_recommendation_id, action_type,
        entity_type, entity_name, campaign_name, ad_group_name,
        ad_entity_authority_id, ad_entity_id, ad_entity_revision,
        current_bid_cents, proposed_bid_cents, change_pct, confidence, source,
        explanation, authorization_json, valid_until, created_at,
        created_session_generation
      ) VALUES (?, 'store-one', 'US', 'USD', 'mission-1', 1,
        'evidence-1', ?, 'data-batch-1', 'policy-version-1', 1, ?, 'model-1',
        'analysis-batch-1', 1, ?, 'set_keyword_bid', 'keyword', ?,
        'Campaign A', ?, ?, ?, 1,
        200, 190, -5, 0.9, 'rule_ai', 'lower inefficient bid',
        ?, '2026-07-24T00:00:00.000Z', ?, 4)
    `).run(
      proposalId,
      'f'.repeat(64),
      'e'.repeat(64),
      actionIndex,
      entityName,
      adGroupName,
      authorityId,
      adEntityId,
      JSON.stringify({ human: { eligible: true, blockers: [] }, policy: { eligible: true, blockers: [] } }),
      NOW,
    );
    database.prepare(`
      INSERT INTO decisions (
        id, store_id, mission_id, data_batch_id, policy_version_id, policy_revision,
        action_revision, title, rationale, recommendation, facts_json,
        alternatives_json, valid_until, action_type, ad_entity_id,
        current_value_json, recommended_value_json, confidence, status, revision,
        created_at, updated_at
      ) VALUES (?, 'store-one', 'mission-1', 'data-batch-1',
        'policy-version-1', 1, 1, ?, 'High ACOS', 'Lower bid',
        '["fact"]', '["keep"]', '2026-07-24T00:00:00.000Z', 'set_keyword_bid',
        ?, '2.00', '1.90', 0.9, 'approved', 2, ?, ?)
    `).run(decisionId, `Lower ${entityName} bid`, adEntityId, NOW, NOW);
    database.prepare(`
      INSERT INTO analysis_proposal_decision_links (
        id, store_id, proposal_id, decision_id, created_at
      ) VALUES (?, 'store-one', ?, ?, ?)
    `).run(`proposal-link-${actionIndex}`, proposalId, decisionId, NOW);
  }
  const decisionIds = JSON.stringify(Array.from(
    { length: actionCount },
    (_, index) => `decision-${index + 1}`,
  ));
  const adEntityIds = JSON.stringify(Array.from(
    { length: actionCount },
    (_, index) => `opaque-keyword-${index + 1}`,
  ));
  database.prepare(`
    INSERT INTO mission_grants (
      id, store_id, marketplace, currency, mission_id, mission_revision,
      decision_ids_json, action_revision, allowed_action_types_json,
      allowed_ad_entity_ids_json, max_change_pct, total_impact_budget,
      expires_at, policy_version_id, policy_revision, required_evidence_json,
      stop_conditions_json, issuer_type, issuer_actor_id, issued_at,
      created_session_generation
    ) VALUES ('grant-1', 'store-one', 'US', 'USD', 'mission-1', 1,
      ?, 1, '["set_keyword_bid"]', ?,
       ?, ?, '2026-07-24T00:00:00.000Z', 'policy-version-1', 1, ?, ?,
      ?, ?, ?, 4)
  `).run(
    decisionIds,
    adEntityIds,
    maxChangePct,
    totalImpactBudget,
    JSON.stringify(rules.requiredEvidence),
    JSON.stringify(rules.stopConditions),
    issuerType,
    issuerType === 'policy' ? 'policy-engine' : 'operator',
    NOW,
  );
  database.prepare(`
    INSERT INTO mission_grant_events (
      id, store_id, grant_id, event_type, actor_id, created_at
    ) VALUES ('grant-event-1', 'store-one', 'grant-1', 'issued', 'operator', ?)
  `).run(NOW);
}

describe('ExecutionAuthorityRepository', () => {
  it('promotes only the latest Stage 5 keyword authority into an exact canonical revision', () => {
    const harness = createHarness();
    const identity = harness.repository.registerCanonicalKeywordIdentity(harness.context, {
      adEntityId: 'opaque-keyword-1',
      entityRevision: 1,
      adsAccountId: 'ads-account-1',
      campaignId: 'campaign-1',
      adGroupId: 'ad-group-1',
      keywordId: 'keyword-1',
      observedBidCents: 149,
      pageIdentityHash: PAGE_HASH,
      resolutionProofSha256: '8'.repeat(64),
      resolvedAt: NOW,
      resolvedBy: 'operator',
    });

    expect(identity).toMatchObject({
      storeId: harness.context.storeId,
      marketplace: 'US',
      currency: 'USD',
      adsAccountId: 'ads-account-1',
      campaignId: 'campaign-1',
      adGroupId: 'ad-group-1',
      keywordId: 'keyword-1',
      objectRevision: 1,
      adEntityId: 'opaque-keyword-1',
      entityRevision: 1,
      sourceAuthorityId: 'stage5-authority-1',
      sourceAuthorityProofSha256: PROOF_HASH,
      resolutionProofSha256: '8'.repeat(64),
    });
    expect(harness.repository.resolveCanonicalKeyword(harness.context, {
      adsAccountId: 'ads-account-1',
      campaignId: 'campaign-1',
      adGroupId: 'ad-group-1',
      keywordId: 'keyword-1',
      expectedObjectRevision: 1,
    })).toEqual(identity);
  });

  it('appends a fresh identity object revision after reconnect while rejecting identity drift', () => {
    const harness = createHarness();
    const first = registerIdentity(harness);
    harness.database.prepare(`
      UPDATE app_settings SET value = '5', updated_at = ?
      WHERE key = 'store_session_generation:store-one'
    `).run(NOW);
    harness.database.prepare(`
      UPDATE store_session_metadata SET session_generation = 5, updated_at = ?
      WHERE store_id = 'store-one' AND provider = 'amazon_ads'
    `).run(NOW);
    const reconnected = normalizeStoreContextEnvelope({ ...harness.context, sessionGeneration: 5 });

    const second = registerIdentity(harness, {}, reconnected);
    expect(second).toMatchObject({
      canonicalKeywordId: first.canonicalKeywordId,
      objectRevision: 2,
      resolvedSessionGeneration: 5,
      resolutionProofSha256: '8'.repeat(64),
    });
    const third = registerIdentity(harness, { resolutionProofSha256: '7'.repeat(64) }, reconnected);
    expect(third.objectRevision).toBe(3);
    const fourth = registerIdentity(harness, {
      resolutionProofSha256: '7'.repeat(64),
      observedBidCents: 148,
    }, reconnected);
    expect(fourth.objectRevision).toBe(4);
    expect(registerIdentity(harness, {
      resolutionProofSha256: '7'.repeat(64),
      observedBidCents: 148,
    }, reconnected)).toEqual(fourth);
    expect(harness.repository.listCanonicalKeywordIdentities(reconnected)).toEqual([fourth]);
    expect(() => registerIdentity(harness, {
      pageIdentityHash: '6'.repeat(64),
      resolutionProofSha256: '5'.repeat(64),
    }, reconnected)).toThrow(/drifted/i);
  });

  it('materializes one exact idempotent downbid batch from an unexpired approved grant', () => {
    const harness = createHarness();
    registerIdentity(harness);

    const first = harness.repository.createExactExecutionBatch(harness.context, 'grant-1');
    expect(first.created).toBe(true);
    expect(first.projection.batch).toMatchObject({
      grantId: 'grant-1',
      missionId: 'mission-1',
      actionRevision: 1,
      status: 'queued',
    });
    expect(first.projection.jobs).toHaveLength(1);
    expect(first.projection.jobs[0]).toMatchObject({
      proposalId: 'proposal-1',
      decisionId: 'decision-1',
      actionType: 'set_keyword_bid',
      expectedBidCents: 149,
      targetBidCents: 139,
      status: 'queued',
      identity: {
        adsAccountId: 'ads-account-1',
        campaignId: 'campaign-1',
        adGroupId: 'ad-group-1',
        keywordId: 'keyword-1',
        objectRevision: 1,
      },
    });
    expect(first.projection.jobs[0]?.events.map((event) => event.eventType)).toEqual(['queued']);
    expect(() => harness.database.prepare(`
      UPDATE ad_execution_jobs SET campaign_id = 'cross-identity-campaign'
      WHERE store_id = 'store-one' AND id = ?
    `).run(first.projection.jobs[0]!.id)).toThrow(/foreign key/i);
    expect(harness.database.prepare(`
      SELECT event_type AS eventType FROM mission_grant_events
      WHERE store_id = 'store-one' AND grant_id = 'grant-1'
      ORDER BY created_at DESC, id DESC LIMIT 1
    `).get()).toEqual({ eventType: 'issued' });

    harness.database.prepare(`
      INSERT INTO mission_grant_events (
        id, store_id, grant_id, event_type, actor_id, reason, created_at
      ) VALUES ('grant-consumed-after-readback', 'store-one', 'grant-1', 'consumed',
        'main-test', 'full batch verified', '2026-07-23T02:00:01.000Z')
    `).run();

    const replay = harness.repository.createExactExecutionBatch(harness.context, 'grant-1');
    expect(replay.created).toBe(false);
    expect(replay.projection).toEqual(first.projection);
    expect(() => harness.repository.startJob(harness.context, {
      jobId: replay.projection.jobs[0]!.id,
      expectedRevision: replay.projection.jobs[0]!.revision,
    })).toThrow(/terminal/i);
  });

  it('requires before evidence before intent and seals after/reload proof before success', () => {
    const harness = createHarness();
    const identity = registerIdentity(harness);
    const created = harness.repository.createExactExecutionBatch(harness.context, 'grant-1');
    const jobId = created.projection.jobs[0]!.id;

    const started = harness.repository.startJob(harness.context, {
      jobId,
      expectedRevision: 1,
    });
    expect(started.job.status).toBe('preflight');
    const preflight = harness.repository.recordPreflight(harness.context, {
      jobId,
      expectedRevision: started.job.revision,
      observedBidCents: 149,
      pageIdentityHash: PAGE_HASH,
      canonicalKeywordId: identity.canonicalKeywordId,
      objectRevision: identity.objectRevision,
    });
    const intent = harness.repository.recordSubmitIntent(harness.context, {
      jobId,
      expectedRevision: preflight.job.revision,
      submitIntentId: 'submit-intent-1',
      commandFingerprint: COMMAND_HASH,
      before: evidence(identity.canonicalKeywordId, 149, 'before-proof'),
    });
    expect(intent.job.status).toBe('intent_written');
    expect(intent.job).toMatchObject({
      submitIntentId: 'submit-intent-1',
      commandFingerprint: COMMAND_HASH,
    });
    expect(intent.job.evidence.map((item) => item.slot)).toEqual(['before']);
    const submitted = harness.repository.recordSubmitted(harness.context, {
      jobId,
      expectedRevision: intent.job.revision,
    });
    const after = harness.repository.recordAfterEvidence(harness.context, {
      jobId,
      expectedRevision: submitted.job.revision,
      evidence: evidence(identity.canonicalKeywordId, 139, 'after-proof'),
    });
    const succeeded = harness.repository.recordReloadVerified(harness.context, {
      jobId,
      expectedRevision: after.job.revision,
      evidence: evidence(identity.canonicalKeywordId, 139, 'reload-proof'),
    });

    expect(succeeded.job.status).toBe('succeeded');
    expect(succeeded.batch.status).toBe('succeeded');
    expect(succeeded.job.evidence.map((item) => item.slot)).toEqual(['before', 'after', 'reload']);
    expect(succeeded.job.events.map((event) => event.eventType)).toEqual([
      'queued', 'started', 'preflight_verified', 'submit_intent_recorded',
      'submitted', 'after_recorded', 'reload_verified',
    ]);
    expect(() => harness.repository.startJob(harness.context, {
      jobId,
      expectedRevision: succeeded.job.revision,
    })).toThrow(/terminal/i);
  });

  it('enforces the grant total-impact budget in USD, not percentage points', () => {
    const allowed = createHarness(10, 0.10);
    registerIdentity(allowed);
    expect(() => allowed.repository.createExactExecutionBatch(allowed.context, 'grant-1'))
      .not.toThrow();

    const blocked = createHarness(10, 0.09);
    registerIdentity(blocked);
    expect(() => blocked.repository.createExactExecutionBatch(blocked.context, 'grant-1'))
      .toThrow(/impact budget/i);
  });

  it('recovers any post-intent interruption to terminal UNKNOWN without requeue', () => {
    const harness = createHarness();
    const identity = registerIdentity(harness);
    const created = harness.repository.createExactExecutionBatch(harness.context, 'grant-1');
    const jobId = created.projection.jobs[0]!.id;
    const started = harness.repository.startJob(harness.context, { jobId, expectedRevision: 1 });
    const preflight = harness.repository.recordPreflight(harness.context, {
      jobId,
      expectedRevision: started.job.revision,
      observedBidCents: 149,
      pageIdentityHash: PAGE_HASH,
      canonicalKeywordId: identity.canonicalKeywordId,
      objectRevision: identity.objectRevision,
    });
    harness.repository.recordSubmitIntent(harness.context, {
      jobId,
      expectedRevision: preflight.job.revision,
      submitIntentId: 'submit-intent-recovery',
      commandFingerprint: COMMAND_HASH,
      before: evidence(identity.canonicalKeywordId, 149, 'before-recovery'),
    });

    const recovery = harness.repository.recoverInterruptedExecutions();
    expect(recovery.markedUnknown).toEqual([expect.objectContaining({
      jobId,
      missionId: 'mission-1',
      grantId: 'grant-1',
      previousStatus: 'intent_written',
      status: 'unknown',
    })]);
    expect(recovery.revokedGrantIds).toEqual(['grant-1']);
    expect(recovery.missionsRequiringStop).toEqual(['mission-1']);
    expect(harness.database.prepare(`
      SELECT event_type AS eventType FROM mission_grant_events
      WHERE store_id = 'store-one' AND grant_id = 'grant-1'
      ORDER BY created_at DESC, id DESC LIMIT 1
    `).get()).toEqual({ eventType: 'revoked' });
    expect(harness.repository.getExecutionBatch(harness.context, created.projection.batch.id))
      .toMatchObject({ batch: { status: 'unknown' }, jobs: [{ status: 'unknown' }] });
    expect(() => harness.database.prepare(`
      UPDATE ad_execution_jobs SET status = 'queued' WHERE store_id = 'store-one' AND id = ?
    `).run(jobId)).toThrow(/terminal|invalid/i);
    const repeatedRecovery = harness.repository.recoverInterruptedExecutions();
    expect(repeatedRecovery.markedUnknown).toEqual([]);
    expect(repeatedRecovery.domainReconciliations).toEqual([
      expect.objectContaining({
        batchId: created.projection.batch.id,
        missionId: 'mission-1',
        grantId: 'grant-1',
        status: 'unknown',
      }),
    ]);
    expect(repeatedRecovery.missionsRequiringStop).toEqual(['mission-1']);
  });

  it('atomically backfills causal evidence and durably suppresses completed startup reconciliation', () => {
    const harness = createHarness();
    const succeeded = driveSingleJobToSuccess(harness);

    expect(harness.repository.recoverInterruptedExecutions().domainReconciliations)
      .toEqual([expect.objectContaining({ batchId: succeeded.batch.id, status: 'succeeded' })]);

    const completed = harness.repository.completeDomainReconciliation(
      harness.context,
      succeeded.batch.id,
    );
    expect(completed).toMatchObject({
      created: true,
      reconciliation: {
        storeId: 'store-one',
        batchId: succeeded.batch.id,
        batchStatus: 'succeeded',
        evidenceRefCount: 3,
        completedSessionGeneration: 4,
      },
    });
    expect(harness.database.prepare(`
      SELECT evidence_type AS evidenceType, evidence_ref AS evidenceRef, sha256
      FROM evidence_refs
      WHERE store_id = 'store-one' AND event_id = 'causal:grant:grant-1:consumed'
      ORDER BY evidence_type
    `).all()).toEqual([
      { evidenceType: 'ad_execution_after', evidenceRef: 'after-proof', sha256: '9'.repeat(64) },
      { evidenceType: 'ad_execution_before', evidenceRef: 'before-proof', sha256: '9'.repeat(64) },
      { evidenceType: 'ad_execution_reload', evidenceRef: 'reload-proof', sha256: '9'.repeat(64) },
    ]);
    expect(harness.repository.completeDomainReconciliation(harness.context, succeeded.batch.id))
      .toEqual({ ...completed, created: false });
    expect(harness.repository.recoverInterruptedExecutions()).toMatchObject({
      domainReconciliations: [],
      missionsRequiringStop: [],
    });

    harness.database.close();
    const reopened = initSqlite(harness.databasePath);
    databases.push(reopened);
    const reopenedRepository = new ExecutionAuthorityRepository(reopened, { now: () => new Date(NOW) });
    expect(reopenedRepository.recoverInterruptedExecutions()).toMatchObject({
      domainReconciliations: [],
      missionsRequiringStop: [],
    });
  });

  it('rolls back partial evidence backfill when an existing causal reference conflicts', () => {
    const harness = createHarness();
    const succeeded = driveSingleJobToSuccess(harness);
    harness.database.prepare(`
      INSERT INTO evidence_refs (
        id, store_id, event_id, evidence_type, evidence_ref, sha256, created_at
      ) VALUES (
        'conflicting-after-ref', 'store-one', 'causal:grant:grant-1:consumed',
        'ad_execution_after', 'after-proof', ?, ?
      )
    `).run('7'.repeat(64), NOW);

    expect(() => harness.repository.completeDomainReconciliation(
      harness.context,
      succeeded.batch.id,
    )).toThrow(/conflict/i);
    expect(harness.database.prepare(`
      SELECT evidence_type AS evidenceType FROM evidence_refs
      WHERE store_id = 'store-one' AND event_id = 'causal:grant:grant-1:consumed'
      ORDER BY evidence_type
    `).all()).toEqual([{ evidenceType: 'ad_execution_after' }]);
    expect(harness.database.prepare(`
      SELECT COUNT(*) AS count FROM ad_execution_domain_reconciliations
      WHERE store_id = 'store-one' AND batch_id = ?
    `).get(succeeded.batch.id)).toEqual({ count: 0 });
    expect(harness.repository.recoverInterruptedExecutions().domainReconciliations)
      .toEqual([expect.objectContaining({ batchId: succeeded.batch.id })]);
  });

  it('keeps durable reconciliation completion isolated between two stores in one database', () => {
    const harness = createHarness();
    const secondContext = seedSecondStoreAuthority(harness.database);
    registerIdentity(harness);
    harness.repository.registerCanonicalKeywordIdentity(secondContext, {
      adEntityId: 'opaque-keyword-1',
      entityRevision: 1,
      adsAccountId: 'ads-account-2',
      campaignId: 'campaign-2',
      adGroupId: 'ad-group-2',
      keywordId: 'keyword-2',
      observedBidCents: 149,
      pageIdentityHash: PAGE_HASH,
      resolutionProofSha256: '8'.repeat(64),
      resolvedAt: NOW,
      resolvedBy: 'operator',
    });
    const first = harness.repository.createExactExecutionBatch(harness.context, 'grant-1').projection;
    const second = harness.repository.createExactExecutionBatch(secondContext, 'grant-2').projection;
    harness.repository.cancelJob(harness.context, {
      jobId: first.jobs[0]!.id,
      expectedRevision: first.jobs[0]!.revision,
      reasonCode: 'two_store_test_cancel',
    });
    harness.repository.cancelJob(secondContext, {
      jobId: second.jobs[0]!.id,
      expectedRevision: second.jobs[0]!.revision,
      reasonCode: 'two_store_test_cancel',
    });

    harness.repository.completeDomainReconciliation(secondContext, second.batch.id);
    expect(harness.repository.recoverInterruptedExecutions().domainReconciliations).toEqual([
      expect.objectContaining({
        storeId: harness.context.storeId,
        batchId: first.batch.id,
        status: 'cancelled',
      }),
    ]);
    harness.repository.completeDomainReconciliation(harness.context, first.batch.id);
    expect(harness.repository.recoverInterruptedExecutions().domainReconciliations).toEqual([]);
    expect(harness.database.prepare(`
      SELECT store_id AS storeId, batch_id AS batchId
      FROM ad_execution_domain_reconciliations ORDER BY store_id
    `).all()).toEqual([
      { storeId: 'store-one', batchId: first.batch.id },
      { storeId: 'store-two', batchId: second.batch.id },
    ]);
  });

  it('atomically marks the submitted action UNKNOWN and cancels untouched siblings', () => {
    const harness = createHarness(10, 10, 2);
    const identity = registerIdentity(harness);
    registerIdentity(harness, {
      adEntityId: 'opaque-keyword-2',
      adsAccountId: 'ads-account-1',
      campaignId: 'campaign-1',
      adGroupId: 'ad-group-2',
      keywordId: 'keyword-2',
      observedBidCents: 200,
      pageIdentityHash: '4'.repeat(64),
      resolutionProofSha256: '5'.repeat(64),
    });
    const created = harness.repository.createExactExecutionBatch(harness.context, 'grant-1');
    expect(created.projection.jobs).toHaveLength(2);
    const [first, second] = created.projection.jobs;
    const started = harness.repository.startJob(harness.context, {
      jobId: first!.id,
      expectedRevision: first!.revision,
    });
    const preflight = harness.repository.recordPreflight(harness.context, {
      jobId: first!.id,
      expectedRevision: started.job.revision,
      observedBidCents: 149,
      pageIdentityHash: PAGE_HASH,
      canonicalKeywordId: identity.canonicalKeywordId,
      objectRevision: identity.objectRevision,
    });
    const intent = harness.repository.recordSubmitIntent(harness.context, {
      jobId: first!.id,
      expectedRevision: preflight.job.revision,
      submitIntentId: 'submit-intent-multi-unknown',
      commandFingerprint: COMMAND_HASH,
      before: evidence(identity.canonicalKeywordId, 149, 'before-multi-unknown'),
    });

    const unknown = harness.repository.markUnknown(harness.context, {
      jobId: first!.id,
      expectedRevision: intent.job.revision,
      reasonCode: 'submit_result_ambiguous',
      detail: 'Submission result requires operator reconciliation',
    });

    expect(unknown.batch.status).toBe('unknown');
    expect(harness.repository.getExecutionBatch(harness.context, created.projection.batch.id)?.jobs)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ id: first!.id, status: 'unknown' }),
        expect.objectContaining({ id: second!.id, status: 'cancelled' }),
      ]));
    expect(harness.database.prepare(`
      SELECT event_type AS eventType FROM mission_grant_events
      WHERE store_id = 'store-one' AND grant_id = 'grant-1'
      ORDER BY created_at DESC, id DESC LIMIT 1
    `).get()).toEqual({ eventType: 'revoked' });
  });

  it('rejects a grant that expands the V1 execution batch above ten actions', () => {
    const harness = createHarness(10, 100, 11);

    expect(() => harness.repository.createExactExecutionBatch(harness.context, 'grant-1'))
      .toThrow(/at most 10 actions/i);
  });

  it('cancels queued or preflight work but never cancels after submit intent', () => {
    const queuedHarness = createHarness();
    registerIdentity(queuedHarness);
    const queued = queuedHarness.repository.createExactExecutionBatch(queuedHarness.context, 'grant-1')
      .projection.jobs[0]!;
    const cancelled = queuedHarness.repository.cancelJob(queuedHarness.context, {
      jobId: queued.id,
      expectedRevision: queued.revision,
      reasonCode: 'operator_cancelled',
      detail: 'Operator cancelled before submission',
    });
    expect(cancelled.job.status).toBe('cancelled');
    expect(cancelled.job.events.at(-1)?.eventType).toBe('cancelled');
    expect(() => queuedHarness.repository.startJob(queuedHarness.context, {
      jobId: queued.id,
      expectedRevision: cancelled.job.revision,
    })).toThrow(/terminal/i);

    const intentHarness = createHarness();
    const identity = registerIdentity(intentHarness);
    const job = intentHarness.repository.createExactExecutionBatch(intentHarness.context, 'grant-1')
      .projection.jobs[0]!;
    const started = intentHarness.repository.startJob(intentHarness.context, {
      jobId: job.id,
      expectedRevision: job.revision,
    });
    const preflight = intentHarness.repository.recordPreflight(intentHarness.context, {
      jobId: job.id,
      expectedRevision: started.job.revision,
      observedBidCents: 149,
      pageIdentityHash: PAGE_HASH,
      canonicalKeywordId: identity.canonicalKeywordId,
      objectRevision: identity.objectRevision,
    });
    const intent = intentHarness.repository.recordSubmitIntent(intentHarness.context, {
      jobId: job.id,
      expectedRevision: preflight.job.revision,
      submitIntentId: 'submit-intent-no-cancel',
      commandFingerprint: COMMAND_HASH,
      before: evidence(identity.canonicalKeywordId, 149, 'before-no-cancel'),
    });
    expect(() => intentHarness.repository.cancelJob(intentHarness.context, {
      jobId: job.id,
      expectedRevision: intent.job.revision,
      reasonCode: 'too_late',
    })).toThrow(/cannot transition/i);
    expect(() => intentHarness.repository.markBlocked(intentHarness.context, {
      jobId: job.id,
      expectedRevision: intent.job.revision,
      reasonCode: 'generic_block_is_too_broad',
    })).toThrow(/cannot transition/i);
    const notSubmitted = intentHarness.repository.markNotSubmittedAfterIntent(intentHarness.context, {
      jobId: job.id,
      expectedRevision: intent.job.revision,
      reasonCode: 'save_control_not_resolved',
      detail: 'Adapter proved submit was not attempted',
    });
    expect(notSubmitted.job.status).toBe('blocked');
    expect(notSubmitted.job.events.at(-1)).toMatchObject({
      eventType: 'blocked',
      fromStatus: 'intent_written',
      toStatus: 'blocked',
    });
  });

  it('allows BLOCKED only before intent and UNKNOWN only after intent', () => {
    const beforeHarness = createHarness();
    registerIdentity(beforeHarness);
    const beforeCreated = beforeHarness.repository.createExactExecutionBatch(beforeHarness.context, 'grant-1');
    const beforeJob = beforeCreated.projection.jobs[0]!;
    expect(() => beforeHarness.repository.markUnknown(beforeHarness.context, {
      jobId: beforeJob.id,
      expectedRevision: beforeJob.revision,
      reasonCode: 'not_submitted',
    })).toThrow(/cannot transition/i);
    expect(() => beforeHarness.repository.markBlocked(beforeHarness.context, {
      jobId: beforeJob.id,
      expectedRevision: beforeJob.revision,
      reasonCode: 'unsafe_detail',
      detail: 'C:\\secret\\before.png',
    })).toThrow(/must not contain paths/i);
    const blocked = beforeHarness.repository.markBlocked(beforeHarness.context, {
      jobId: beforeJob.id,
      expectedRevision: beforeJob.revision,
      reasonCode: 'preflight_mismatch',
      detail: 'Observed bid did not match expected value',
    });
    expect(blocked.job.status).toBe('blocked');

    const afterHarness = createHarness();
    const identity = registerIdentity(afterHarness);
    const afterCreated = afterHarness.repository.createExactExecutionBatch(afterHarness.context, 'grant-1');
    const afterJobId = afterCreated.projection.jobs[0]!.id;
    const started = afterHarness.repository.startJob(afterHarness.context, {
      jobId: afterJobId,
      expectedRevision: 1,
    });
    const preflight = afterHarness.repository.recordPreflight(afterHarness.context, {
      jobId: afterJobId,
      expectedRevision: started.job.revision,
      observedBidCents: 149,
      pageIdentityHash: PAGE_HASH,
      canonicalKeywordId: identity.canonicalKeywordId,
      objectRevision: identity.objectRevision,
    });
    const intent = afterHarness.repository.recordSubmitIntent(afterHarness.context, {
      jobId: afterJobId,
      expectedRevision: preflight.job.revision,
      submitIntentId: 'submit-intent-unknown',
      commandFingerprint: COMMAND_HASH,
      before: evidence(identity.canonicalKeywordId, 149, 'before-unknown'),
    });
    afterHarness.database.prepare(`
      UPDATE app_settings SET value = '5', updated_at = ?
      WHERE key = 'store_session_generation:store-one'
    `).run(NOW);
    afterHarness.database.prepare(`
      UPDATE store_session_metadata SET session_generation = 5, updated_at = ?
      WHERE store_id = 'store-one' AND provider = 'amazon_ads'
    `).run(NOW);
    const reconnected = normalizeStoreContextEnvelope({
      ...afterHarness.context,
      sessionGeneration: 5,
    });
    expect(() => afterHarness.repository.recordSubmitted(reconnected, {
      jobId: afterJobId,
      expectedRevision: intent.job.revision,
    })).toThrow(/earlier Amazon Ads session/i);
    expect(() => afterHarness.repository.markBlocked(reconnected, {
      jobId: afterJobId,
      expectedRevision: intent.job.revision,
      reasonCode: 'too_late',
    })).toThrow(/cannot transition/i);
    const unknown = afterHarness.repository.markUnknown(reconnected, {
      jobId: afterJobId,
      expectedRevision: intent.job.revision,
      reasonCode: 'submit_result_ambiguous',
      detail: 'Submission result requires operator reconciliation',
    });
    expect(unknown).toMatchObject({
      missionId: 'mission-1',
      grantId: 'grant-1',
      batch: { status: 'unknown' },
      job: { status: 'unknown' },
    });
  });

  it('rejects a stale context and a proposal above the grant change cap', () => {
    const harness = createHarness(5);
    const staleContext = normalizeStoreContextEnvelope({ ...harness.context, sessionGeneration: 3 });
    expect(() => harness.repository.listCanonicalKeywordIdentities(staleContext)).toThrow(/stale/i);

    registerIdentity(harness);
    expect(() => harness.repository.createExactExecutionBatch(harness.context, 'grant-1'))
      .toThrow(/within 5%/i);
  });

  it('recovers the policy callback crash window and an interrupted pre-batch attempt exactly once', () => {
    const harness = createHarness(10, 10, 1, 'policy');

    const first = harness.repository.recoverPolicyGrantDispatchesOnStartup();
    expect(first.discoveredPending).toEqual(['grant-1']);
    expect(harness.repository.listPolicyGrantDispatches(harness.context)).toEqual([
      expect.objectContaining({
        grantId: 'grant-1',
        status: 'pending',
        attemptCount: 0,
        batchJobCount: 0,
        code: 'DISPATCH_PENDING',
      }),
    ]);
    expect(harness.repository.recoverPolicyGrantDispatchesOnStartup().discoveredPending).toEqual([]);

    harness.repository.appendPolicyGrantDispatchEvent(harness.context, {
      grantId: 'grant-1',
      status: 'attempting',
      trigger: 'grant_issued',
      attempt: 1,
      code: 'DISPATCH_ATTEMPT_STARTED',
      detail: 'browser failed at C:\\private\\profile Bearer secret-value '
        + 'cookie=user@example.test account=private-account profile_id=private-profile '
        + 'https://example.test/path?q=1',
    });
    const interrupted = harness.repository.recoverPolicyGrantDispatchesOnStartup();
    expect(interrupted.interruptedToWaiting).toEqual(['grant-1']);
    const recovered = harness.repository.listPolicyGrantDispatches(harness.context)[0]!;
    expect(recovered).toMatchObject({
      status: 'waiting_runtime',
      attemptCount: 1,
      code: 'STARTUP_ATTEMPT_INTERRUPTED',
    });
    const signals = harness.database.prepare(`
      SELECT signal FROM causal_events
      WHERE store_id = 'store-one'
        AND entity_type = 'policy_grant_dispatch_v1'
        AND source = 'policy-grant-dispatch-v1'
    `).all() as Array<{ signal: string }>;
    expect(signals.every((item) => (
      !item.signal.includes('C:\\private')
      && !item.signal.includes('secret-value')
      && !item.signal.includes('user@example.test')
      && !item.signal.includes('private-account')
      && !item.signal.includes('private-profile')
      && !item.signal.includes('example.test')
    ))).toBe(true);
    expect(harness.repository.recoverPolicyGrantDispatchesOnStartup().interruptedToWaiting).toEqual([]);
  });

  it('enforces monotonic policy dispatch attempts, terminality, and code/status pairs', () => {
    const harness = createHarness(10, 10, 1, 'policy');
    harness.repository.recoverPolicyGrantDispatchesOnStartup();

    expect(() => harness.repository.appendPolicyGrantDispatchEvent(harness.context, {
      grantId: 'grant-1',
      status: 'attempting',
      trigger: 'grant_issued',
      attempt: 2,
      code: 'DISPATCH_ATTEMPT_STARTED',
      detail: 'attempt jump',
    })).toThrow(/exactly one|attempt/i);

    harness.repository.appendPolicyGrantDispatchEvent(harness.context, {
      grantId: 'grant-1',
      status: 'attempting',
      trigger: 'grant_issued',
      attempt: 1,
      code: 'DISPATCH_ATTEMPT_STARTED',
      detail: 'first attempt',
    });
    expect(() => harness.repository.appendPolicyGrantDispatchEvent(harness.context, {
      grantId: 'grant-1',
      status: 'waiting_runtime',
      trigger: 'timer_retry',
      attempt: 0,
      code: 'RUNTIME_UNAVAILABLE',
      detail: 'attempt regression',
    })).toThrow(/cannot move backward|attempt/i);
    expect(() => harness.repository.appendPolicyGrantDispatchEvent(harness.context, {
      grantId: 'grant-1',
      status: 'completed',
      trigger: 'grant_issued',
      attempt: 1,
      code: 'RUNTIME_UNAVAILABLE',
      detail: 'status code mismatch',
    })).toThrow(/code.*status/i);

    harness.repository.appendPolicyGrantDispatchEvent(harness.context, {
      grantId: 'grant-1',
      status: 'attention_required',
      trigger: 'grant_issued',
      attempt: 1,
      code: 'UNSAFE_DISPATCH_FAILURE',
      detail: 'terminal',
    });
    expect(() => harness.repository.appendPolicyGrantDispatchEvent(harness.context, {
      grantId: 'grant-1',
      status: 'pending',
      trigger: 'grant_issued',
      attempt: 1,
      code: 'DISPATCH_PENDING',
      detail: 'terminal regression',
    })).toThrow(/terminal/i);
  });

  it('keeps policy dispatch discovery and journal reads isolated by store', () => {
    const harness = createHarness(10, 10, 1, 'policy');
    const secondContext = seedSecondStoreAuthority(harness.database);

    const recovery = harness.repository.recoverPolicyGrantDispatchesOnStartup();
    expect(recovery.discoveredPending).toEqual(expect.arrayContaining(['grant-1', 'grant-2']));
    expect(harness.repository.listPolicyGrantDispatches(harness.context)
      .map((dispatch) => dispatch.grantId)).toEqual(['grant-1']);
    expect(harness.repository.listPolicyGrantDispatches(secondContext)
      .map((dispatch) => dispatch.grantId)).toEqual(['grant-2']);
    expect(() => harness.repository.appendPolicyGrantDispatchEvent(secondContext, {
      grantId: 'grant-1',
      status: 'pending',
      trigger: 'grant_issued',
      attempt: 0,
      code: 'DISPATCH_PENDING',
      detail: 'cross-store attempt',
    })).toThrow(/grant|store|not found/i);
  });

  it('queues an existing pre-intent batch for durable serial execution without duplicate creation', () => {
    const harness = createHarness(10, 10, 1, 'policy');
    registerIdentity(harness);
    const created = harness.repository.createExactExecutionBatch(harness.context, 'grant-1');

    const first = harness.repository.recoverPolicyGrantDispatchesOnStartup();
    expect(first.queuedExistingBatch).toEqual(['grant-1']);
    expect(harness.repository.listPolicyGrantDispatches(harness.context)[0]).toMatchObject({
      status: 'queued_for_execution',
      batchId: created.projection.batch.id,
      batchStatus: 'queued',
      batchJobCount: 1,
      code: 'BATCH_QUEUED_FOR_EXECUTION',
    });
    expect(harness.repository.recoverPolicyGrantDispatchesOnStartup().queuedExistingBatch).toEqual([]);
    expect(harness.database.prepare(`
      SELECT COUNT(*) AS count FROM ad_execution_batches
      WHERE store_id = 'store-one' AND grant_id = 'grant-1'
    `).get()).toEqual({ count: 1 });
    expect(harness.database.prepare(`
      SELECT COUNT(*) AS count FROM causal_events
      WHERE store_id = 'store-one'
        AND event_type = 'policy_grant_dispatch_queued_for_execution_v1'
        AND entity_id = 'grant-1'
    `).get()).toEqual({ count: 1 });
  });

  it('queues a partially succeeded batch when only the untouched suffix remains pre-intent', () => {
    const harness = createHarness(10, 10, 2, 'policy');
    registerIdentity(harness);
    registerIdentity(harness, {
      adEntityId: 'opaque-keyword-2',
      campaignId: 'campaign-2',
      adGroupId: 'ad-group-2',
      keywordId: 'keyword-2',
      observedBidCents: 200,
      pageIdentityHash: '4'.repeat(64),
      resolutionProofSha256: '5'.repeat(64),
    });
    const created = harness.repository.createExactExecutionBatch(harness.context, 'grant-1');
    driveFirstJobToSuccessInBatch(harness, created.projection.batch.id);
    expect(harness.repository.getExecutionBatch(harness.context, created.projection.batch.id)?.jobs
      .map((job) => job.status)).toEqual(['succeeded', 'queued']);

    const recovery = harness.repository.recoverPolicyGrantDispatchesOnStartup();

    expect(recovery.queuedExistingBatch).toEqual(['grant-1']);
    expect(harness.repository.listPolicyGrantDispatches(harness.context)[0]).toMatchObject({
      status: 'queued_for_execution',
      batchId: created.projection.batch.id,
      batchStatus: 'queued',
      batchJobStatuses: ['succeeded', 'queued'],
      batchHasPersistedIntent: true,
      code: 'BATCH_QUEUED_FOR_EXECUTION',
    });
    expect(harness.repository.recoverPolicyGrantDispatchesOnStartup().queuedExistingBatch)
      .toEqual([]);
    expect(harness.database.prepare(`
      SELECT event_type AS eventType FROM mission_grant_events
      WHERE store_id = 'store-one' AND grant_id = 'grant-1'
      ORDER BY created_at DESC, id DESC LIMIT 1
    `).get()).toEqual({ eventType: 'issued' });
  });

  it('marks a prior-session policy grant attention-required instead of rebinding it', () => {
    const harness = createHarness(10, 10, 1, 'policy');
    harness.database.prepare(`
      UPDATE app_settings SET value = '5', updated_at = ?
      WHERE key = 'store_session_generation:store-one'
    `).run(NOW);
    harness.database.prepare(`
      UPDATE store_session_metadata SET session_generation = 5, updated_at = ?
      WHERE store_id = 'store-one' AND provider = 'amazon_ads'
    `).run(NOW);
    const currentContext = normalizeStoreContextEnvelope({
      ...harness.context,
      sessionGeneration: 5,
    });

    const recovery = harness.repository.recoverPolicyGrantDispatchesOnStartup();
    expect(recovery.attentionRequired).toEqual(['grant-1']);
    expect(harness.repository.listPolicyGrantDispatches(currentContext)[0]).toMatchObject({
      status: 'attention_required',
      code: 'SESSION_REAUTHORIZATION_REQUIRED',
      batchJobCount: 0,
    });
    expect(harness.database.prepare(`
      SELECT COUNT(*) AS count FROM ad_execution_batches
      WHERE store_id = 'store-one' AND grant_id = 'grant-1'
    `).get()).toEqual({ count: 0 });
  });
});

function seedSecondStoreAuthority(database: Database.Database): StoreContextEnvelope {
  database.prepare(`INSERT INTO stores (
    store_id, browser_profile_id, marketplace, currency, display_name, status,
    business_timezone, created_at, updated_at
  ) SELECT 'store-two', 'profile-two', marketplace, currency, 'US Store Two', status,
    business_timezone, created_at, updated_at FROM stores WHERE store_id = 'store-one'`
  ).run();
  database.prepare(`INSERT INTO app_settings (key, value, updated_at)
    VALUES ('store_session_generation:store-two', '4', ?)`
  ).run(NOW);
  database.prepare(`INSERT INTO store_connections (
    id, store_id, provider, status, account_label, external_account_id,
    last_verified_at, created_at, updated_at
  ) SELECT 'conn-ads-two', 'store-two', provider, status, 'Ads Two', 'ads-account-2',
    last_verified_at, created_at, updated_at FROM store_connections
    WHERE store_id = 'store-one' AND provider = 'amazon_ads'`
  ).run();
  database.prepare(`INSERT INTO store_session_metadata (
    store_id, provider, browser_profile_id, status, session_generation,
    observed_at, external_account_id, verified_at, updated_at
  ) SELECT 'store-two', provider, 'profile-two', status, session_generation,
    observed_at, 'ads-account-2', verified_at, updated_at FROM store_session_metadata
    WHERE store_id = 'store-one' AND provider = 'amazon_ads'`
  ).run();
  database.prepare(`INSERT INTO lingxing_report_batches (
    id, date_start, date_end, store_name, marketplace_code, status, download_dir,
    created_at, completed_at, store_id, request_id, browser_profile_id,
    business_date, session_generation
  ) SELECT 'data-batch-2', date_start, date_end, 'US Store Two', marketplace_code,
    status, 'artifact:data-batch-2', created_at, completed_at, 'store-two',
    'request-2', 'profile-two', business_date, session_generation
    FROM lingxing_report_batches WHERE store_id = 'store-one' AND id = 'data-batch-1'`
  ).run();
  database.prepare(`INSERT INTO policies (
    id, store_id, name, scope, status, priority, active_version_id, revision,
    created_at, updated_at
  ) SELECT 'policy-2', 'store-two', name, scope, status, priority, NULL, revision,
    created_at, updated_at FROM policies WHERE store_id = 'store-one' AND id = 'policy-1'`
  ).run();
  database.prepare(`INSERT INTO policy_versions (
    id, store_id, policy_id, version, status, rules_json, revision,
    created_at, updated_at, enabled_at
  ) SELECT 'policy-version-2', 'store-two', 'policy-2', version, status, rules_json,
    revision, created_at, updated_at, enabled_at FROM policy_versions
    WHERE store_id = 'store-one' AND id = 'policy-version-1'`
  ).run();
  database.prepare(`UPDATE policies SET active_version_id = 'policy-version-2'
    WHERE store_id = 'store-two' AND id = 'policy-2'`
  ).run();
  database.prepare(`UPDATE policy_runtime SET active_policy_version_id = 'policy-version-2',
    updated_at = ? WHERE store_id = 'store-two'`
  ).run(NOW);
  database.prepare(`INSERT INTO missions (
    id, store_id, marketplace, currency, business_date, created_session_generation,
    data_batch_id, policy_version_id, title, objective, status, phase, priority,
    observation_starts_at, observation_ends_at, success_criteria_json,
    guardrails_json, revision, created_at, updated_at
  ) SELECT 'mission-2', 'store-two', marketplace, currency, business_date,
    created_session_generation, 'data-batch-2', 'policy-version-2', title, objective,
    status, phase, priority, observation_starts_at, observation_ends_at,
    success_criteria_json, guardrails_json, revision, created_at, updated_at
    FROM missions WHERE store_id = 'store-one' AND id = 'mission-1'`
  ).run();
  database.prepare(`INSERT INTO report_import_runs (
    store_id, run_id, idempotency_key, input_fingerprint, batch_id, status,
    source_file_count, metric_row_count, reconciliation_count, started_at,
    completed_at, created_at
  ) SELECT 'store-two', 'import-run-2', 'import-idem-2', input_fingerprint,
    'data-batch-2', status, source_file_count, metric_row_count, reconciliation_count,
    started_at, completed_at, created_at FROM report_import_runs
    WHERE store_id = 'store-one' AND run_id = 'import-run-1'`
  ).run();
  database.prepare(`INSERT INTO analysis_evidence_packages (
    id, store_id, marketplace, currency, mission_id, data_batch_id, import_run_id,
    date_from, date_to, report_types_json, sources_json, metric_row_count,
    reconciliation_hash, rule_revision, model_revision, package_hash, imported_at,
    fresh_until, sealed_at, created_session_generation
  ) SELECT 'evidence-2', 'store-two', marketplace, currency, 'mission-2',
    'data-batch-2', 'import-run-2', date_from, date_to, report_types_json,
    sources_json, metric_row_count, reconciliation_hash, rule_revision,
    model_revision, package_hash, imported_at, fresh_until, sealed_at,
    created_session_generation FROM analysis_evidence_packages
    WHERE store_id = 'store-one' AND id = 'evidence-1'`
  ).run();
  database.prepare(`INSERT INTO verified_ad_entity_authority (
    authority_id, store_id, ad_entity_id, entity_revision, entity_type,
    entity_name, campaign_name, ad_group_name, evidence_package_id,
    source_report_type, source_file_hash, source_row, identity_source,
    proof_sha256, verified_by, verified_at, created_at
  ) SELECT 'stage5-authority-2', 'store-two', ad_entity_id, entity_revision,
    entity_type, entity_name, campaign_name, ad_group_name, 'evidence-2',
    source_report_type, source_file_hash, source_row, identity_source,
    proof_sha256, verified_by, verified_at, created_at
    FROM verified_ad_entity_authority
    WHERE store_id = 'store-one' AND authority_id = 'stage5-authority-1'`
  ).run();
  database.prepare(`INSERT INTO analysis_action_batches (
    id, store_id, mission_id, mission_revision, evidence_package_id,
    rule_revision, model_revision, action_revision, created_at,
    created_session_generation
  ) SELECT 'analysis-batch-2', 'store-two', 'mission-2', mission_revision,
    'evidence-2', rule_revision, model_revision, action_revision, created_at,
    created_session_generation FROM analysis_action_batches
    WHERE store_id = 'store-one' AND id = 'analysis-batch-1'`
  ).run();
  database.prepare(`INSERT INTO analysis_proposal_snapshots (
    id, store_id, marketplace, currency, mission_id, mission_revision,
    evidence_package_id, evidence_package_hash, data_batch_id, policy_version_id,
    policy_revision, rule_revision, model_revision, action_batch_id, action_revision,
    legacy_recommendation_id, action_type, entity_type, entity_name, campaign_name,
    ad_group_name, ad_entity_authority_id, ad_entity_id, ad_entity_revision,
    current_bid_cents, proposed_bid_cents, change_pct, confidence, source,
    explanation, authorization_json, valid_until, created_at, created_session_generation
  ) SELECT 'proposal-2', 'store-two', marketplace, currency, 'mission-2',
    mission_revision, 'evidence-2', evidence_package_hash, 'data-batch-2',
    'policy-version-2', policy_revision, rule_revision, model_revision,
    'analysis-batch-2', action_revision, legacy_recommendation_id, action_type,
    entity_type, entity_name, campaign_name, ad_group_name, 'stage5-authority-2',
    ad_entity_id, ad_entity_revision, current_bid_cents, proposed_bid_cents,
    change_pct, confidence, source, explanation, authorization_json, valid_until,
    created_at, created_session_generation FROM analysis_proposal_snapshots
    WHERE store_id = 'store-one' AND id = 'proposal-1'`
  ).run();
  database.prepare(`INSERT INTO decisions (
    id, store_id, mission_id, data_batch_id, policy_version_id, policy_revision,
    action_revision, title, rationale, recommendation, facts_json, alternatives_json,
    valid_until, action_type, ad_entity_id, current_value_json,
    recommended_value_json, confidence, status, revision, created_at, updated_at
  ) SELECT 'decision-2', 'store-two', 'mission-2', 'data-batch-2',
    'policy-version-2', policy_revision, action_revision, title, rationale,
    recommendation, facts_json, alternatives_json, valid_until, action_type,
    ad_entity_id, current_value_json, recommended_value_json, confidence,
    status, revision, created_at, updated_at FROM decisions
    WHERE store_id = 'store-one' AND id = 'decision-1'`
  ).run();
  database.prepare(`INSERT INTO analysis_proposal_decision_links (
    id, store_id, proposal_id, decision_id, created_at
  ) SELECT 'proposal-link-2', 'store-two', 'proposal-2', 'decision-2', created_at
    FROM analysis_proposal_decision_links
    WHERE store_id = 'store-one' AND id = 'proposal-link-1'`
  ).run();
  database.prepare(`INSERT INTO mission_grants (
    id, store_id, marketplace, currency, mission_id, mission_revision,
    decision_ids_json, action_revision, allowed_action_types_json,
    allowed_ad_entity_ids_json, max_change_pct, total_impact_budget, expires_at,
    policy_version_id, policy_revision, required_evidence_json, stop_conditions_json,
    issuer_type, issuer_actor_id, issued_at, created_session_generation
  ) SELECT 'grant-2', 'store-two', marketplace, currency, 'mission-2',
    mission_revision, '["decision-2"]', action_revision, allowed_action_types_json,
    allowed_ad_entity_ids_json, max_change_pct, total_impact_budget, expires_at,
    'policy-version-2', policy_revision, required_evidence_json, stop_conditions_json,
    issuer_type, issuer_actor_id, issued_at, created_session_generation
    FROM mission_grants WHERE store_id = 'store-one' AND id = 'grant-1'`
  ).run();
  database.prepare(`INSERT INTO mission_grant_events (
    id, store_id, grant_id, event_type, actor_id, reason, created_at
  ) SELECT 'grant-event-2', 'store-two', 'grant-2', event_type, actor_id, reason,
    created_at FROM mission_grant_events
    WHERE store_id = 'store-one' AND id = 'grant-event-1'`
  ).run();
  return normalizeStoreContextEnvelope({
    storeId: 'store-two',
    browserProfileId: 'profile-two',
    marketplace: 'US',
    currency: 'USD',
    businessTimezone: 'America/Los_Angeles',
    businessDate: '2026-07-22',
    sessionGeneration: 4,
  });
}

function driveSingleJobToSuccess(harness: Harness) {
  const identity = registerIdentity(harness);
  const created = harness.repository.createExactExecutionBatch(harness.context, 'grant-1');
  const job = created.projection.jobs[0]!;
  const started = harness.repository.startJob(harness.context, {
    jobId: job.id,
    expectedRevision: job.revision,
  });
  const preflight = harness.repository.recordPreflight(harness.context, {
    jobId: job.id,
    expectedRevision: started.job.revision,
    observedBidCents: 149,
    pageIdentityHash: PAGE_HASH,
    canonicalKeywordId: identity.canonicalKeywordId,
    objectRevision: identity.objectRevision,
  });
  const intent = harness.repository.recordSubmitIntent(harness.context, {
    jobId: job.id,
    expectedRevision: preflight.job.revision,
    submitIntentId: 'submit-intent-success-helper',
    commandFingerprint: COMMAND_HASH,
    before: evidence(identity.canonicalKeywordId, 149, 'before-proof'),
  });
  const submitted = harness.repository.recordSubmitted(harness.context, {
    jobId: job.id,
    expectedRevision: intent.job.revision,
  });
  const after = harness.repository.recordAfterEvidence(harness.context, {
    jobId: job.id,
    expectedRevision: submitted.job.revision,
    evidence: evidence(identity.canonicalKeywordId, 139, 'after-proof'),
  });
  return harness.repository.recordReloadVerified(harness.context, {
    jobId: job.id,
    expectedRevision: after.job.revision,
    evidence: evidence(identity.canonicalKeywordId, 139, 'reload-proof'),
  });
}

function driveFirstJobToSuccessInBatch(harness: Harness, batchId: string): void {
  const job = harness.repository.getExecutionBatch(harness.context, batchId)!.jobs[0]!;
  const started = harness.repository.startJob(harness.context, {
    jobId: job.id,
    expectedRevision: job.revision,
  });
  const preflight = harness.repository.recordPreflight(harness.context, {
    jobId: job.id,
    expectedRevision: started.job.revision,
    observedBidCents: job.expectedBidCents,
    pageIdentityHash: job.pageIdentityHash,
    canonicalKeywordId: job.canonicalKeywordId,
    objectRevision: job.identity.objectRevision,
  });
  const intent = harness.repository.recordSubmitIntent(harness.context, {
    jobId: job.id,
    expectedRevision: preflight.job.revision,
    submitIntentId: 'submit-intent-partial-recovery',
    commandFingerprint: COMMAND_HASH,
    before: evidence(job.canonicalKeywordId, job.expectedBidCents, 'partial-before-proof'),
  });
  const submitted = harness.repository.recordSubmitted(harness.context, {
    jobId: job.id,
    expectedRevision: intent.job.revision,
  });
  const after = harness.repository.recordAfterEvidence(harness.context, {
    jobId: job.id,
    expectedRevision: submitted.job.revision,
    evidence: evidence(job.canonicalKeywordId, job.targetBidCents, 'partial-after-proof'),
  });
  harness.repository.recordReloadVerified(harness.context, {
    jobId: job.id,
    expectedRevision: after.job.revision,
    evidence: evidence(job.canonicalKeywordId, job.targetBidCents, 'partial-reload-proof'),
  });
}

function registerIdentity(
  harness: Harness,
  overrides: Partial<RegisterAdKeywordIdentityInput> = {},
  context: StoreContextEnvelope = harness.context,
) {
  return harness.repository.registerCanonicalKeywordIdentity(context, {
    adEntityId: 'opaque-keyword-1',
    entityRevision: 1,
    adsAccountId: 'ads-account-1',
    campaignId: 'campaign-1',
    adGroupId: 'ad-group-1',
    keywordId: 'keyword-1',
    observedBidCents: 149,
    pageIdentityHash: PAGE_HASH,
    resolutionProofSha256: '8'.repeat(64),
    resolvedAt: NOW,
    resolvedBy: 'operator',
    ...overrides,
  });
}

function evidence(canonicalKeywordId: string, observedBidCents: number, artifactRef: string) {
  return {
    artifactRef,
    contentSha256: '9'.repeat(64),
    pageIdentityHash: PAGE_HASH,
    canonicalKeywordId,
    objectRevision: 1,
    observedBidCents,
    capturedAt: NOW,
  };
}

import type Database from 'better-sqlite3';
import { normalizeStoreContextEnvelope, type PolicyVersionRules, type StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { MissionDomainRepository } from './mission-domain-repo';
import { NOW, PROOF_HASH } from './execution-authority-repo.test-harness';
export function seedStage5Authority(
  database: Database.Database,
  maxChangePct: number,
  totalImpactBudget: number,
  actionCount: number,
  issuerType: 'human' | 'policy',
  rateLimits: Partial<PolicyVersionRules>,
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
      normalized_external_account_id, last_verified_at, created_at, updated_at
    ) VALUES ('conn-ads-one', 'store-one', 'amazon_ads', 'ready', 'Ads One',
      'ads-account-1', 'ads-account-1', ?, ?, ?)
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
    allowedAdEntityIds: Array.from(
      { length: actionCount },
      (_, index) => `opaque-keyword-${index + 1}`,
    ),
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
    ...rateLimits,
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
  seedExactPolicyScopeEvidence(database, {
    index: 1,
    fileHash: '1'.repeat(64),
    sourceRow: 7,
    entityName: 'door lock',
    campaignName: 'Campaign A',
    adGroupName: 'Ad Group A',
  });
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
    seedExactPolicyScopeEvidence(database, {
      index: actionIndex,
      fileHash: `${actionIndex}`.repeat(64).slice(0, 64),
      sourceRow: actionIndex + 6,
      entityName,
      campaignName: 'Campaign A',
      adGroupName,
    });
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
      created_session_generation, authority_json
    ) VALUES ('grant-1', 'store-one', 'US', 'USD', 'mission-1', 1,
      ?, 1, '["set_keyword_bid"]', ?,
       ?, ?, '2026-07-24T00:00:00.000Z', 'policy-version-1', 1, ?, ?,
      ?, ?, ?, 4, ?)
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
    JSON.stringify(new MissionDomainRepository(database).captureWriteAuthority(normalizeStoreContextEnvelope({
      storeId: 'store-one', browserProfileId: 'profile-one', marketplace: 'US', currency: 'USD',
      businessTimezone: 'America/Los_Angeles', businessDate: '2026-07-22', sessionGeneration: 4,
    }))),
  );
  database.prepare(`
    INSERT INTO mission_grant_events (
      id, store_id, grant_id, event_type, actor_id, created_at
    ) VALUES ('grant-event-1', 'store-one', 'grant-1', 'issued', 'operator', ?)
  `).run(NOW);
}

export function enableLowerNumberMatchingPolicy(database: Database.Database): void {
  const source = database.prepare(`
    SELECT rules_json AS rulesJson FROM policy_versions
    WHERE store_id = 'store-one' AND id = 'policy-version-1'
  `).get() as { rulesJson: string };
  database.prepare(`
    INSERT INTO policies (
      id, store_id, name, scope, status, priority, active_version_id, revision,
      created_at, updated_at
    ) VALUES (
      'policy-lower-number', 'store-one', 'Lower number wins', 'store', 'active', 0,
      NULL, 2, ?, ?
    )
  `).run(NOW, NOW);
  database.prepare(`
    INSERT INTO policy_versions (
      id, store_id, policy_id, version, status, rules_json, revision,
      created_at, updated_at, enabled_at
    ) VALUES (
      'policy-lower-number-v1', 'store-one', 'policy-lower-number', 1, 'enabled', ?, 1,
      ?, ?, ?
    )
  `).run(source.rulesJson, NOW, NOW, NOW);
  database.prepare(`
    UPDATE policies SET active_version_id = 'policy-lower-number-v1'
    WHERE store_id = 'store-one' AND id = 'policy-lower-number'
  `).run();
}

export function seedExactPolicyScopeEvidence(
  database: Database.Database,
  input: {
    index: number;
    fileHash: string;
    sourceRow: number;
    entityName: string;
    campaignName: string;
    adGroupName: string;
    storeId?: string;
    batchId?: string;
    runId?: string;
  },
): void {
  const storeId = input.storeId ?? 'store-one';
  const batchId = input.batchId ?? 'data-batch-1';
  const runId = input.runId ?? 'import-run-1';
  const filePath = `C:/reports/${storeId}/keyword-${input.index}.xlsx`;
  const reportFileId = Number(database.prepare(`
    INSERT INTO report_files (
      store_id, batch_id, report_type, file_path, file_name, file_size,
      status, imported_rows, file_hash, last_imported_at
    ) VALUES (?, ?, 'keyword', ?, ?, 1024,
      'imported', 1, ?, ?)
  `).run(storeId, batchId, filePath, `keyword-${input.index}.xlsx`, input.fileHash, NOW).lastInsertRowid);
  database.prepare(`
    INSERT INTO report_import_file_snapshots (
      store_id, snapshot_id, run_id, batch_id, report_file_id, report_type,
      file_path, file_name, file_size_bytes, file_hash, imported_rows, captured_at
    ) VALUES (?, ?, ?, ?, ?, 'keyword',
      ?, ?, 1024, ?, 1, ?)
  `).run(
    storeId,
    `execution-scope-snapshot-${input.index}`,
    runId,
    batchId,
    reportFileId,
    filePath,
    `keyword-${input.index}.xlsx`,
    input.fileHash,
    NOW,
  );
  database.prepare(`
    INSERT INTO ad_daily_metrics (
      batch_id, report_type, date, store_name, marketplace_code, asin,
      campaign_name, ad_group_name, targeting, source_file, source_row,
      store_id, store_authority_quarantined
    ) VALUES (?, 'keyword', '2026-07-22', ?, 'US', 'B0EXECUTION',
      ?, ?, ?, ?, ?, ?, 0)
  `).run(
    batchId,
    storeId === 'store-one' ? 'US Store One' : 'US Store Two',
    input.campaignName,
    input.adGroupName,
    input.entityName,
    filePath,
    input.sourceRow,
    storeId,
  );
}

export function seedSecondStoreAuthority(database: Database.Database): StoreContextEnvelope {
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
    normalized_external_account_id, last_verified_at, created_at, updated_at
  ) SELECT 'conn-ads-two', 'store-two', provider, status, 'Ads Two', 'ads-account-2',
    'ads-account-2', last_verified_at, created_at, updated_at FROM store_connections
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
  seedExactPolicyScopeEvidence(database, {
    index: 1,
    fileHash: '1'.repeat(64),
    sourceRow: 7,
    entityName: 'door lock',
    campaignName: 'Campaign A',
    adGroupName: 'Ad Group A',
    storeId: 'store-two',
    batchId: 'data-batch-2',
    runId: 'import-run-2',
  });
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
    issuer_type, issuer_actor_id, issued_at, created_session_generation, authority_json
  ) SELECT 'grant-2', 'store-two', marketplace, currency, 'mission-2',
    mission_revision, '["decision-2"]', action_revision, allowed_action_types_json,
    allowed_ad_entity_ids_json, max_change_pct, total_impact_budget, expires_at,
    'policy-version-2', policy_revision, required_evidence_json, stop_conditions_json,
    issuer_type, issuer_actor_id, issued_at, created_session_generation,
    json_set(authority_json, '$.context.storeId', 'store-two', '$.context.browserProfileId', 'profile-two',
      '$.issuerRef', CASE issuer_type WHEN 'policy' THEN 'policy-runtime:store-two:1' ELSE 'operator' END)
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

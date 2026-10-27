import { createHash } from 'node:crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { afterEach, expect } from 'vitest';
import  {
  normalizeStoreContextEnvelope,
  type DecisionRecord,
  type MissionRecord,
  type PolicyVersionRecord,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import { initSqlite } from '../db';
import { MissionDomainRepository, MissionDomainRepositoryError, type MissionDomainRepositoryErrorCode } from './mission-domain-repo';
import { NOW, policyRules } from './mission-domain-repo.test-data';
import { seedDefaultPolicyScopeAuthority } from './mission-domain-repo.test-authority';
export const tempDirs: string[] = [];

export const databases: Database.Database[] = [];

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

export interface Harness {
  databasePath: string;
  database: Database.Database;
  repository: MissionDomainRepository;
  contextOne: StoreContextEnvelope;
  contextTwo: StoreContextEnvelope;
}

export function createHarness(now: () => Date = () => new Date(NOW)): Harness {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-mission-repo-'));
  tempDirs.push(directory);
  const databasePath = path.join(directory, 'app.db');
  const database = initSqlite(databasePath);
  databases.push(database);

  for (const [storeId, profileId, displayName] of [
    ['store-one', 'profile-one', 'US Store One'],
    ['store-two', 'profile-two', 'US Store Two'],
  ] as const) {
    database.prepare(`
      INSERT INTO stores (
        store_id, browser_profile_id, marketplace, currency, display_name,
        status, business_timezone, created_at, updated_at
      ) VALUES (?, ?, 'US', 'USD', ?, 'active', 'America/Los_Angeles', ?, ?)
    `).run(storeId, profileId, displayName, NOW, NOW);
    for (const provider of ['lingxing', 'amazon_ads']) {
      database.prepare(`
        INSERT INTO store_session_metadata (
          store_id, provider, browser_profile_id, status, session_generation,
          observed_at, verified_at, updated_at
        ) VALUES (?, ?, ?, 'ready', 4, ?, ?, ?)
      `).run(storeId, provider, profileId, NOW, NOW, NOW);
    }
    database.prepare(`
      INSERT INTO lingxing_report_batches (
        id, date_start, date_end, store_name, marketplace_code, status,
        download_dir, created_at, completed_at, store_id, request_id,
        browser_profile_id, business_date, session_generation
      ) VALUES (?, '2026-07-21', '2026-07-21', ?, 'US', 'completed',
        ?, ?, ?, ?, ?, ?, '2026-07-21', 4)
    `).run(
      `batch-${storeId}`,
      displayName,
      `logical-download:${storeId}`,
      NOW,
      NOW,
      storeId,
      `request-${storeId}`,
      profileId,
    );
  }

  const contextOne = normalizeStoreContextEnvelope({
    storeId: 'store-one',
    browserProfileId: 'profile-one',
    marketplace: 'US',
    currency: 'USD',
    businessTimezone: 'America/Los_Angeles',
    businessDate: '2026-07-22',
    sessionGeneration: 4,
  });
  const contextTwo = normalizeStoreContextEnvelope({
    storeId: 'store-two',
    browserProfileId: 'profile-two',
    marketplace: 'US',
    currency: 'USD',
    businessTimezone: 'America/Los_Angeles',
    businessDate: '2026-07-22',
    sessionGeneration: 4,
  });
  seedDefaultPolicyScopeAuthority(database, contextOne);
  seedDefaultPolicyScopeAuthority(database, contextTwo);
  const repository = new MissionDomainRepository(database, {
    now,
    references: {
      productBelongsToStore: (context, productId) => productId.startsWith(`${context.storeId}-product-`),
      adEntityBelongsToStore: (context, adEntityId) => adEntityId.startsWith(`${context.storeId}-keyword-`),
      adEntitySupportsKeywordBid: (context, adEntityId) => adEntityId.startsWith(`${context.storeId}-keyword-`),
    },
  });
  return { databasePath, database, repository, contextOne, contextTwo };
}

export function seedEnabledPolicy(
  repository: MissionDomainRepository,
  context: StoreContextEnvelope,
  rules = policyRules(context.storeId),
) {
  const policy = repository.createPolicy(context, {
    id: `policy-${context.storeId}`,
    name: 'Keyword bid policy',
    scope: 'sponsored-products-keywords',
    priority: 100,
    actorId: 'operator',
  });
  const draftVersion = repository.createPolicyVersion(context, {
    id: `policy-version-${context.storeId}-1`,
    policyId: policy.id,
    version: 1,
    rules,
    validUntil: '2026-08-01T00:00:00.000Z',
    actorId: 'operator',
  });
  const version = repository.enablePolicyVersion(context, {
    policyId: policy.id,
    versionId: draftVersion.id,
    expectedPolicyRevision: policy.revision,
    expectedVersionRevision: draftVersion.revision,
    actorId: 'operator',
  });
  return {
    policy: repository.getPolicy(context, policy.id)!,
    version,
  };
}

export function seedActiveMission(repository: MissionDomainRepository, context: StoreContextEnvelope) {
  const authority = seedEnabledPolicy(repository, context);
  const draft = repository.createMission(context, {
    id: `mission-${context.storeId}`,
    dataBatchId: `batch-${context.storeId}`,
    policyVersionId: authority.version.id,
    title: 'Reduce inefficient keyword spend',
    objective: 'Reduce ACOS without losing attributed sales.',
    priority: 'P1',
    productId: `${context.storeId}-product-1`,
    observationStartsAt: '2026-07-22T00:00:00.000Z',
    observationEndsAt: '2026-07-29T00:00:00.000Z',
    successCriteria: ['ACOS improves by at least 2 points'],
    guardrails: ['Attributed sales decline stays below 5%'],
    actorId: 'operator',
  });
  const mission = repository.transitionMission(context, {
    id: draft.id,
    expectedRevision: draft.revision,
    status: 'active',
    phase: 'analysis',
    actorId: 'operator',
    reason: 'Facts reviewed.',
  });
  return { ...authority, mission };
}

export function seedDecisionAnalysis(database: Database.Database, decision: DecisionRecord, mission: MissionRecord): void {
  const evidenceId = `grant-test-evidence:${mission.id}`;
  if (!database.prepare('SELECT id FROM analysis_evidence_packages WHERE id=?').get(evidenceId)) {
    const source = database.prepare('SELECT * FROM analysis_evidence_packages WHERE store_id=? LIMIT 1').get(decision.storeId) as Record<string, unknown>;
    const row = { ...source, id: evidenceId, mission_id: mission.id, data_batch_id: mission.dataBatchId,
      package_hash: createHash('sha256').update(evidenceId).digest('hex') };
    const columns = Object.keys(row);
    database.prepare(`INSERT INTO analysis_evidence_packages (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...Object.values(row));
  }
  const evidence = database.prepare('SELECT * FROM analysis_evidence_packages WHERE id=?').get(evidenceId) as Record<string, unknown>;
  const batchId = `grant-test-batch:${mission.id}:${decision.actionRevision}`;
  if (!database.prepare('SELECT id FROM analysis_action_batches WHERE id=?').get(batchId)) {
    database.prepare(`INSERT INTO analysis_action_batches(id,store_id,mission_id,mission_revision,evidence_package_id,
      rule_revision,model_revision,action_revision,created_at,created_session_generation,authority_json)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(batchId, decision.storeId, mission.id, mission.revision, evidenceId,
        evidence.rule_revision, evidence.model_revision, decision.actionRevision, NOW, mission.createdSessionGeneration, JSON.stringify(decision.authority));
  }
  const proposalId = `grant-test-proposal:${decision.id}`;
  const authority = database.prepare('SELECT authority_id FROM verified_ad_entity_authority WHERE store_id=? AND ad_entity_id=? AND entity_revision=1')
    .get(decision.storeId, decision.adEntityId) as { authority_id: string };
  const proposal = {
    id: proposalId, store_id: decision.storeId, marketplace: 'US', currency: 'USD', mission_id: mission.id,
    mission_revision: mission.revision, evidence_package_id: evidenceId, evidence_package_hash: evidence.package_hash,
    data_batch_id: mission.dataBatchId, policy_version_id: decision.policyVersionId, policy_revision: decision.policyRevision,
    rule_revision: evidence.rule_revision, model_revision: evidence.model_revision, action_batch_id: batchId,
    action_revision: decision.actionRevision, legacy_recommendation_id: parseInt(createHash('sha256').update(decision.id).digest('hex').slice(0, 8), 16) + 1, action_type: decision.actionType,
    entity_type: 'keyword', entity_name: decision.title, campaign_name: 'Fixture campaign', ad_group_name: 'Fixture ad group',
    ad_entity_id: decision.adEntityId, ad_entity_authority_id: authority.authority_id, ad_entity_revision: 1, current_bid_cents: Math.round(Number(decision.currentValue) * 100),
    proposed_bid_cents: Math.round(Number(decision.recommendedValue) * 100), change_pct: -6, confidence: decision.confidence,
    source: 'rule_ai', explanation: decision.rationale, authorization_json: JSON.stringify({ human: { eligible: true, blockers: [] }, policy: { eligible: true, blockers: [] } }),
    valid_until: decision.validUntil, created_at: NOW, created_session_generation: mission.createdSessionGeneration,
  };
  const columns = Object.keys(proposal);
  database.prepare(`INSERT INTO analysis_proposal_snapshots (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...Object.values(proposal));
  database.prepare(`INSERT INTO analysis_proposal_decision_links(id,store_id,proposal_id,decision_id,created_at)
    VALUES(?,?,?,?,?)`).run(`link:${proposalId}`, decision.storeId, proposalId, decision.id, NOW);
}

export function createApprovedDecision(
  database: Database.Database,
  repository: MissionDomainRepository,
  context: StoreContextEnvelope,
  mission: MissionRecord,
  version: PolicyVersionRecord,
  actionRevision: number,
  validUntil = '2026-07-23T00:00:00.000Z',
  entityOrdinal = '1',
) {
  const decisionId = entityOrdinal === '1'
    ? `decision-${context.storeId}-${actionRevision}`
    : `decision-${context.storeId}-${actionRevision}-${entityOrdinal}`;
  const decision = repository.createDecision(context, {
    id: decisionId,
    missionId: mission.id,
    dataBatchId: mission.dataBatchId,
    policyVersionId: version.id,
    policyRevision: version.revision,
    actionRevision,
    title: `Approved keyword action ${actionRevision}`,
    rationale: 'The observed facts support a bounded keyword bid change.',
    recommendation: 'Apply the bounded bid change and verify by reload.',
    facts: ['Completed store-scoped report batch is available.'],
    alternatives: ['Keep the current bid and continue observing.'],
    expectedEffect: 'Reduce inefficient spend.',
    validUntil,
    actionType: 'set_keyword_bid',
    adEntityId: `${context.storeId}-keyword-${entityOrdinal}`,
    currentValue: 1,
    recommendedValue: 0.94,
    confidence: 0.8,
    status: 'needs_approval',
    actorId: 'ai-analyst',
  });
  expect(decision.productId).toBe(mission.productId);
  seedDecisionAnalysis(database, decision, mission);
  return repository.resolveDecision(context, {
    id: decision.id,
    expectedRevision: decision.revision,
    status: 'approved',
    actorId: decision.authority!.authorizationPath === 'human' ? 'operator' : 'policy-engine',
    reason: 'Approved within the immutable policy envelope.',
  });
}

export function seedVerifiedReadbackDecision(
  database: Database.Database,
  repository: MissionDomainRepository,
  context: StoreContextEnvelope,
  mission: MissionRecord,
  version: PolicyVersionRecord,
  options: { withEvidenceCheckpoint?: boolean } = {},
) {
  const approved = createApprovedDecision(database, repository, context, mission, version, 1);
  const executed = repository.resolveDecision(context, {
    id: approved.id,
    expectedRevision: approved.revision,
    status: 'executed',
    actorId: 'executor-one',
    reason: 'Durable submit intent and after evidence recorded.',
  });
  const verified = repository.resolveDecision(context, {
    id: executed.id,
    expectedRevision: executed.revision,
    status: 'verified',
    actorId: 'executor-one',
    reason: 'Independent reload readback matched the target bid.',
  });
  const readbackMission = repository.transitionMission(context, {
    id: mission.id,
    expectedRevision: mission.revision,
    status: 'active',
    phase: 'readback',
    actorId: 'executor-one',
    reason: 'Execution completed with independent reload readback.',
  });
  if (options.withEvidenceCheckpoint !== false) {
    repository.appendMissionCheckpoint(context, {
      id: `readback-checkpoint-${mission.id}`,
      missionId: mission.id,
      stage: 'READBACK',
      title: '广告执行回读',
      status: 'verified',
      evidenceCount: 3,
      actorId: 'executor-one',
    });
  }
  return { decision: verified, mission: readbackMission };
}

export function expectRepositoryError(
  action: () => unknown,
  code: MissionDomainRepositoryErrorCode,
): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(MissionDomainRepositoryError);
    expect((error as MissionDomainRepositoryError).code).toBe(code);
    return;
  }
  throw new Error(`Expected MissionDomainRepositoryError ${code}.`);
}

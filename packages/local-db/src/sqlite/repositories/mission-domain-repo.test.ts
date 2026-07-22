import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  normalizeStoreContextEnvelope,
  type MissionRecord,
  type PolicyVersionRules,
  type PolicyVersionRecord,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import { initSqlite } from '../db';
import {
  MissionDomainRepository,
  MissionDomainRepositoryError,
  type MissionDomainRepositoryErrorCode,
} from './mission-domain-repo';

const NOW = '2026-07-22T12:00:00.000Z';
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
  databasePath: string;
  database: Database.Database;
  repository: MissionDomainRepository;
  contextOne: StoreContextEnvelope;
  contextTwo: StoreContextEnvelope;
}

function createHarness(): Harness {
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
  const repository = new MissionDomainRepository(database, {
    now: () => new Date(NOW),
    references: {
      productBelongsToStore: (context, productId) => productId.startsWith(`${context.storeId}-product-`),
      adEntityBelongsToStore: (context, adEntityId) => adEntityId.startsWith(`${context.storeId}-keyword-`),
    },
  });
  return { databasePath, database, repository, contextOne, contextTwo };
}

const policyRules = (storeId: string): PolicyVersionRules => ({
  allowedActionTypes: ['set_keyword_bid'],
  allowedAdEntityIds: [`${storeId}-keyword-1`],
  maxChangePct: 10,
  totalImpactBudget: 50,
  maxDailyActionCount: 100,
  cooldownMinutes: 0,
  executionWindow: {
    timeZone: 'America/Los_Angeles',
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    start: '00:00',
    end: '23:59',
  },
  requiredEvidence: [
    'page_identity',
    'before_screenshot',
    'after_screenshot',
    'reload_screenshot',
    'readback_value',
  ],
  stopConditions: [
    { code: 'identity_drift', detail: 'Stop when store or entity identity drifts.' },
    { code: 'expected_before_mismatch', detail: 'Stop when the before value changed.' },
    { code: 'unknown_result', detail: 'Stop when the write outcome is unknown.' },
    { code: 'data_stale', detail: 'Stop when source data is stale.' },
    { code: 'impact_budget_exhausted', detail: 'Stop when the batch budget is exhausted.' },
    { code: 'kill_switch', detail: 'Stop when the store kill switch is enabled.' },
  ],
  killSwitch: false,
});

function seedEnabledPolicy(
  repository: MissionDomainRepository,
  context: StoreContextEnvelope,
  rules = policyRules(context.storeId),
) {
  const policy = repository.createPolicy(context, {
    id: `policy-${context.storeId}`,
    name: 'Keyword bid policy',
    scope: 'sponsored-products-keywords',
    priority: 100,
    actorId: 'operator-one',
  });
  const draftVersion = repository.createPolicyVersion(context, {
    id: `policy-version-${context.storeId}-1`,
    policyId: policy.id,
    version: 1,
    rules,
    validUntil: '2026-08-01T00:00:00.000Z',
    actorId: 'operator-one',
  });
  const version = repository.enablePolicyVersion(context, {
    policyId: policy.id,
    versionId: draftVersion.id,
    expectedPolicyRevision: policy.revision,
    expectedVersionRevision: draftVersion.revision,
    actorId: 'operator-one',
  });
  return {
    policy: repository.getPolicy(context, policy.id)!,
    version,
  };
}

function seedActiveMission(repository: MissionDomainRepository, context: StoreContextEnvelope) {
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
    actorId: 'operator-one',
  });
  const mission = repository.transitionMission(context, {
    id: draft.id,
    expectedRevision: draft.revision,
    status: 'active',
    phase: 'analysis',
    actorId: 'operator-one',
    reason: 'Facts reviewed.',
  });
  return { ...authority, mission };
}

function createApprovedDecision(
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
  return repository.resolveDecision(context, {
    id: decision.id,
    expectedRevision: decision.revision,
    status: 'approved',
    actorId: 'operator-one',
    reason: 'Approved within the immutable policy envelope.',
  });
}

function expectRepositoryError(
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

describe('MissionDomainRepository policy and context authority', () => {
  it('refuses to enable a legacy draft without rate limits and an execution window', () => {
    const { database, repository, contextOne } = createHarness();
    const policy = repository.createPolicy(contextOne, {
      id: 'legacy-incomplete-policy',
      name: 'Legacy incomplete policy',
      scope: 'store',
      priority: 5,
      actorId: 'operator-one',
    });
    const draft = repository.createPolicyVersion(contextOne, {
      id: 'legacy-incomplete-policy-v1',
      policyId: policy.id,
      version: 1,
      rules: policyRules(contextOne.storeId),
      actorId: 'operator-one',
    });
    const incomplete = { ...policyRules(contextOne.storeId) } as Record<string, unknown>;
    delete incomplete.maxDailyActionCount;
    delete incomplete.cooldownMinutes;
    delete incomplete.executionWindow;
    database.prepare('UPDATE policy_versions SET rules_json = ? WHERE store_id = ? AND id = ?')
      .run(JSON.stringify(incomplete), contextOne.storeId, draft.id);
    expectRepositoryError(() => repository.enablePolicyVersion(contextOne, {
      policyId: policy.id,
      versionId: draft.id,
      expectedPolicyRevision: policy.revision,
      expectedVersionRevision: draft.revision,
      actorId: 'operator-one',
    }), 'INVALID_INPUT');
    expect(repository.getPolicyVersion(contextOne, draft.id)?.status).toBe('draft');
  });

  it('isolates stores, rejects stale context/CAS, and keeps policy/runtime changes audited', () => {
    const { database, repository, contextOne, contextTwo } = createHarness();
    const { policy, version } = seedEnabledPolicy(repository, contextOne);

    expect(repository.listPolicies(contextOne)).toHaveLength(1);
    expect(repository.listPolicies(contextTwo)).toEqual([]);
    expect(repository.getPolicy(contextTwo, policy.id)).toBeUndefined();
    expectRepositoryError(
      () => repository.listPolicies({ ...contextOne, sessionGeneration: 3 }),
      'STALE_CONTEXT',
    );
    expectRepositoryError(
      () => repository.updatePolicy(contextOne, {
        id: policy.id,
        expectedRevision: 1,
        actorId: 'operator-one',
        patch: { priority: 90 },
      }),
      'REVISION_CONFLICT',
    );
    expectRepositoryError(
      () => repository.updateDraftPolicyVersion(contextOne, {
        id: version.id,
        expectedRevision: version.revision,
        actorId: 'operator-one',
        rules: policyRules(contextOne.storeId),
      }),
      'IMMUTABLE_RECORD',
    );
    expect(() => database.prepare(`
      UPDATE policy_versions SET rules_json = '{}' WHERE id = ?
    `).run(version.id)).toThrow(/immutable/i);

    const runtime = repository.getPolicyRuntime(contextOne);
    const automatic = repository.updatePolicyRuntime(contextOne, {
      expectedRevision: runtime.revision,
      actorId: 'operator-one',
      patch: {
        autonomyMode: 'policy_auto',
        activePolicyVersionId: version.id,
        reason: 'Operator enabled policy automation.',
      },
    });
    expect(automatic).toMatchObject({
      autonomyMode: 'policy_auto',
      killSwitch: false,
      circuitBreakerState: 'closed',
      activePolicyVersionId: version.id,
    });
    expectRepositoryError(
      () => repository.updatePolicyRuntime(contextOne, {
        expectedRevision: runtime.revision,
        actorId: 'operator-one',
        patch: { autonomyMode: 'manual_approval' },
      }),
      'REVISION_CONFLICT',
    );

    const audits = repository.listCausalEvents(contextOne);
    expect(audits.map((event) => event.eventType)).toEqual(expect.arrayContaining([
      'policy_created',
      'policy_version_created',
      'policy_version_enabled',
      'policy_runtime_updated',
    ]));
    expect(repository.listCausalEvents(contextTwo)).toEqual([]);
    expect(() => database.prepare(`
      UPDATE causal_events SET title = 'tampered' WHERE id = ?
    `).run(audits[0]!.id)).toThrow(/append-only/i);
    expect(() => database.prepare(`
      DELETE FROM policy_versions WHERE id = ?
    `).run(version.id)).toThrow(/cannot be deleted/i);
  });

  it('allows an empty policy entity allowlist but cannot mint a grant from it', () => {
    const { repository, contextTwo } = createHarness();
    const policy = repository.createPolicy(contextTwo, {
      id: 'policy-no-objects',
      name: 'Policy awaiting stable objects',
      scope: 'sponsored-products-keywords',
      priority: 100,
      actorId: 'operator-one',
    });
    const draftVersion = repository.createPolicyVersion(contextTwo, {
      id: 'policy-version-no-objects',
      policyId: policy.id,
      version: 1,
      rules: { ...policyRules(contextTwo.storeId), allowedAdEntityIds: [] },
      actorId: 'operator-one',
    });
    const version = repository.enablePolicyVersion(contextTwo, {
      policyId: policy.id,
      versionId: draftVersion.id,
      expectedPolicyRevision: policy.revision,
      expectedVersionRevision: draftVersion.revision,
      actorId: 'operator-one',
    });
    const draftMission = repository.createMission(contextTwo, {
      id: 'mission-no-objects',
      dataBatchId: `batch-${contextTwo.storeId}`,
      policyVersionId: version.id,
      title: 'Wait for stable advertising objects',
      objective: 'Preserve analysis lineage before entity authority is available.',
      observationStartsAt: '2026-07-22T00:00:00.000Z',
      observationEndsAt: '2026-07-29T00:00:00.000Z',
      successCriteria: ['Stable entity authority becomes available'],
      guardrails: ['No advertising mutation before entity selection'],
      actorId: 'operator-one',
    });
    const mission = repository.transitionMission(contextTwo, {
      id: draftMission.id,
      expectedRevision: draftMission.revision,
      status: 'active',
      actorId: 'operator-one',
    });
    const decision = createApprovedDecision(repository, contextTwo, mission, version, 1);
    const runtime = repository.getPolicyRuntime(contextTwo);
    repository.updatePolicyRuntime(contextTwo, {
      expectedRevision: runtime.revision,
      actorId: 'operator-one',
      patch: { autonomyMode: 'policy_auto', activePolicyVersionId: version.id },
    });

    expectRepositoryError(
      () => repository.issueMissionGrant(contextTwo, {
        id: 'grant-must-not-exist',
        missionId: mission.id,
        missionRevision: mission.revision,
        decisionIds: [decision.id],
        actionRevision: 1,
        allowedActionTypes: ['set_keyword_bid'],
        allowedAdEntityIds: [`${contextTwo.storeId}-keyword-1`],
        maxChangePct: 5,
        totalImpactBudget: 10,
        expiresAt: '2026-07-23T00:00:00.000Z',
        policyVersionId: version.id,
        policyRevision: version.revision,
        requiredEvidence: policyRules(contextTwo.storeId).requiredEvidence,
        stopConditions: policyRules(contextTwo.storeId).stopConditions,
        issuer: { type: 'policy', actorId: 'policy-engine' },
      }),
      'STATE_CONFLICT',
    );
    expect(repository.listMissionGrants(contextTwo, mission.id)).toEqual([]);
  });
});

describe('MissionDomainRepository mission lineage and grants', () => {
  it('holds an IMMEDIATE write lock while re-reading grant authority', () => {
    const { database, databasePath, repository, contextOne } = createHarness();
    const { version, mission } = seedActiveMission(repository, contextOne);
    const decision = createApprovedDecision(repository, contextOne, mission, version, 9);
    const runtime = repository.getPolicyRuntime(contextOne);
    repository.updatePolicyRuntime(contextOne, {
      expectedRevision: runtime.revision,
      actorId: 'operator-one',
      patch: { autonomyMode: 'policy_auto', activePolicyVersionId: version.id },
    });

    const competing = new Database(databasePath);
    databases.push(competing);
    competing.pragma('busy_timeout = 0');
    let probePending = true;
    let lockProbeRan = false;
    const lockedRepository = new MissionDomainRepository(database, {
      now: () => {
        if (probePending) {
          probePending = false;
          lockProbeRan = true;
          expect(() => competing.prepare(`
            UPDATE missions SET status = 'paused', revision = revision + 1
            WHERE store_id = ? AND id = ?
          `).run(contextOne.storeId, mission.id)).toThrow(/locked/i);
        }
        return new Date(NOW);
      },
      references: {
        productBelongsToStore: (context, productId) => productId.startsWith(`${context.storeId}-product-`),
        adEntityBelongsToStore: (context, adEntityId) => adEntityId.startsWith(`${context.storeId}-keyword-`),
      },
    });

    const grant = lockedRepository.issueMissionGrant(contextOne, {
      id: 'grant-race-proof',
      missionId: mission.id,
      missionRevision: mission.revision,
      decisionIds: [decision.id],
      actionRevision: decision.actionRevision,
      allowedActionTypes: ['set_keyword_bid'],
      allowedAdEntityIds: [decision.adEntityId!],
      maxChangePct: 10,
      totalImpactBudget: 25,
      expiresAt: '2026-07-23T00:00:00.000Z',
      policyVersionId: version.id,
      policyRevision: version.revision,
      requiredEvidence: policyRules(contextOne.storeId).requiredEvidence,
      stopConditions: policyRules(contextOne.storeId).stopConditions,
      issuer: { type: 'policy', actorId: 'policy-engine' },
    });

    expect(lockProbeRan).toBe(true);
    expect(grant.missionRevision).toBe(mission.revision);
    expect(repository.getMission(contextOne, mission.id)?.status).toBe('active');
  });

  it('binds Mission lineage and applies policy-auto and human grant rules fail closed', () => {
    const { database, repository, contextOne, contextTwo } = createHarness();
    const { policy, version, mission } = seedActiveMission(repository, contextOne);
    const decisionOne = createApprovedDecision(repository, contextOne, mission, version, 1);

    expect(repository.listMissions(contextTwo)).toEqual([]);
    expect(repository.getMission(contextTwo, mission.id)).toBeUndefined();
    expectRepositoryError(
      () => repository.updateMission(contextOne, {
        id: mission.id,
        expectedRevision: mission.revision,
        actorId: 'operator-one',
        patch: { productId: `${contextTwo.storeId}-product-1` },
      }),
      'REFERENCE_CONFLICT',
    );
    const checkpoint = repository.appendMissionCheckpoint(contextOne, {
      id: 'checkpoint-one',
      missionId: mission.id,
      stage: 'ANALYSIS',
      title: 'Diagnosis reviewed',
      status: 'complete',
      evidenceCount: 2,
      actorId: 'operator-one',
    });
    const lineage = repository.getMissionLineage(contextOne, mission.id);
    expect(lineage.links.map((link) => link.linkType)).toEqual(expect.arrayContaining([
      'data_batch',
      'policy_version',
    ]));
    expect(lineage.checkpoints).toEqual([checkpoint]);
    expect(() => database.prepare(`
      DELETE FROM mission_checkpoints WHERE id = ?
    `).run(checkpoint.id)).toThrow(/append-only/i);

    const grantInput = {
      id: 'grant-policy-one',
      missionId: mission.id,
      missionRevision: mission.revision,
      decisionIds: [decisionOne.id],
      actionRevision: 1,
      allowedActionTypes: ['set_keyword_bid'] as const,
      allowedAdEntityIds: [`${contextOne.storeId}-keyword-1`],
      maxChangePct: 10,
      totalImpactBudget: 25,
      expiresAt: '2026-07-23T00:00:00.000Z',
      policyVersionId: version.id,
      policyRevision: version.revision,
      requiredEvidence: policyRules(contextOne.storeId).requiredEvidence,
      stopConditions: policyRules(contextOne.storeId).stopConditions,
      issuer: { type: 'policy' as const, actorId: 'policy-engine' },
    };
    expectRepositoryError(
      () => repository.issueMissionGrant(contextOne, grantInput),
      'STATE_CONFLICT',
    );
    const runtime = repository.getPolicyRuntime(contextOne);
    repository.updatePolicyRuntime(contextOne, {
      expectedRevision: runtime.revision,
      actorId: 'operator-one',
      patch: { autonomyMode: 'policy_auto', activePolicyVersionId: version.id },
    });
    const policyGrant = repository.issueMissionGrant(contextOne, grantInput);
    expect(policyGrant).toMatchObject({
      storeId: contextOne.storeId,
      marketplace: 'US',
      currency: 'USD',
      createdSessionGeneration: contextOne.sessionGeneration,
      issuer: { type: 'policy', actorId: 'policy-engine' },
    });
    expect(() => database.prepare(`
      UPDATE mission_grants SET max_change_pct = 20 WHERE id = ?
    `).run(policyGrant.id)).toThrow(/append-only/i);
    const revoked = repository.appendMissionGrantEvent(contextOne, {
      id: 'grant-event-policy-one-revoked',
      grantId: policyGrant.id,
      eventType: 'revoked',
      actorId: 'operator-one',
      reason: 'Operator stopped the remaining batch.',
    });
    expect(repository.getMissionGrantTerminalEvent(contextOne, policyGrant.id)).toEqual(revoked);
    expect(repository.listMissionGrantEvents(contextOne, mission.id)).toEqual([
      revoked,
      expect.objectContaining({
        grantId: policyGrant.id,
        eventType: 'issued',
      }),
    ]);
    expectRepositoryError(
      () => repository.getMissionGrantTerminalEvent(contextTwo, policyGrant.id),
      'NOT_FOUND',
    );
    expectRepositoryError(
      () => repository.listMissionGrantEvents(contextTwo, mission.id),
      'NOT_FOUND',
    );

    expectRepositoryError(
      () => repository.issueMissionGrant(contextOne, {
        ...grantInput,
        id: 'grant-without-decision',
        decisionIds: [decisionOne.id],
        actionRevision: 3,
      }),
      'REFERENCE_CONFLICT',
    );
    expect(repository.listMissionGrants(contextOne, mission.id)).toHaveLength(1);

    const decisionFour = createApprovedDecision(
      repository,
      contextOne,
      mission,
      version,
      4,
      '2026-07-22T13:00:00.000Z',
    );
    expectRepositoryError(
      () => repository.issueMissionGrant(contextOne, {
        ...grantInput,
        id: 'grant-outlives-decision',
        decisionIds: [decisionFour.id],
        actionRevision: 4,
        expiresAt: '2026-07-22T14:00:00.000Z',
      }),
      'STATE_CONFLICT',
    );

    const decisionTwo = createApprovedDecision(repository, contextOne, mission, version, 2);

    const draftV2 = repository.createPolicyVersion(contextOne, {
      id: 'policy-version-store-one-2',
      policyId: policy.id,
      version: 2,
      rules: policyRules(contextOne.storeId),
      actorId: 'operator-one',
    });
    repository.enablePolicyVersion(contextOne, {
      policyId: policy.id,
      versionId: draftV2.id,
      expectedPolicyRevision: policy.revision,
      expectedVersionRevision: draftV2.revision,
      actorId: 'operator-one',
    });
    const retiredAttempt = {
      ...grantInput,
      id: 'grant-retired-policy',
      decisionIds: [decisionTwo.id],
      actionRevision: 2,
    };
    expectRepositoryError(
      () => repository.issueMissionGrant(contextOne, retiredAttempt),
      'STATE_CONFLICT',
    );
    const humanGrant = repository.issueMissionGrant(contextOne, {
      ...retiredAttempt,
      id: 'grant-human-retired-snapshot',
      issuer: { type: 'human', actorId: 'operator-one' },
    });
    expect(humanGrant.issuer.type).toBe('human');
    expect(repository.getMissionLineage(contextOne, mission.id).grants).toHaveLength(2);

    const decisionFive = createApprovedDecision(repository, contextOne, mission, version, 5);
    const pausedMission = repository.transitionMission(contextOne, {
      id: mission.id,
      expectedRevision: mission.revision,
      status: 'paused',
      actorId: 'operator-one',
      reason: 'Operator paused further execution.',
    });
    expectRepositoryError(
      () => repository.issueMissionGrant(contextOne, {
        ...grantInput,
        id: 'grant-while-paused',
        missionRevision: pausedMission.revision,
        decisionIds: [decisionFive.id],
        actionRevision: 5,
        issuer: { type: 'human', actorId: 'operator-one' },
      }),
      'STATE_CONFLICT',
    );
  });

  it('issues one immutable grant for an exact batch of approved decisions', () => {
    const { database, repository, contextOne } = createHarness();
    const rules = {
      ...policyRules(contextOne.storeId),
      allowedAdEntityIds: [
        `${contextOne.storeId}-keyword-1`,
        `${contextOne.storeId}-keyword-2`,
      ],
    };
    const policy = repository.createPolicy(contextOne, {
      id: 'policy-store-one-batch',
      name: 'Two-keyword batch policy',
      scope: 'sponsored-products-keywords',
      priority: 100,
      actorId: 'operator-one',
    });
    const draftVersion = repository.createPolicyVersion(contextOne, {
      id: 'policy-version-store-one-batch-1',
      policyId: policy.id,
      version: 1,
      rules,
      actorId: 'operator-one',
    });
    const version = repository.enablePolicyVersion(contextOne, {
      policyId: policy.id,
      versionId: draftVersion.id,
      expectedPolicyRevision: policy.revision,
      expectedVersionRevision: draftVersion.revision,
      actorId: 'operator-one',
    });
    const draftMission = repository.createMission(contextOne, {
      id: 'mission-store-one-batch',
      dataBatchId: `batch-${contextOne.storeId}`,
      policyVersionId: version.id,
      title: 'Authorize one bounded keyword batch',
      objective: 'Approve once and execute the exact keyword set serially.',
      observationStartsAt: '2026-07-22T00:00:00.000Z',
      observationEndsAt: '2026-07-29T00:00:00.000Z',
      successCriteria: ['Both keyword changes retain verified readback evidence'],
      guardrails: ['UNKNOWN stops the remaining batch'],
      actorId: 'operator-one',
    });
    const mission = repository.transitionMission(contextOne, {
      id: draftMission.id,
      expectedRevision: draftMission.revision,
      status: 'active',
      phase: 'analysis',
      actorId: 'operator-one',
    });
    const first = createApprovedDecision(repository, contextOne, mission, version, 6);
    const second = createApprovedDecision(
      repository,
      contextOne,
      mission,
      version,
      6,
      '2026-07-23T00:00:00.000Z',
      '2',
    );
    const runtime = repository.getPolicyRuntime(contextOne);
    repository.updatePolicyRuntime(contextOne, {
      expectedRevision: runtime.revision,
      actorId: 'operator-one',
      patch: { autonomyMode: 'policy_auto', activePolicyVersionId: version.id },
    });

    const batchGrant = repository.issueMissionGrant(contextOne, {
      id: 'grant-store-one-batch-6',
      missionId: mission.id,
      missionRevision: mission.revision,
      decisionIds: [first.id, second.id],
      actionRevision: 6,
      allowedActionTypes: ['set_keyword_bid'],
      allowedAdEntityIds: [first.adEntityId!, second.adEntityId!],
      maxChangePct: 10,
      totalImpactBudget: 40,
      expiresAt: '2026-07-23T00:00:00.000Z',
      policyVersionId: version.id,
      policyRevision: version.revision,
      requiredEvidence: rules.requiredEvidence,
      stopConditions: rules.stopConditions,
      issuer: { type: 'policy', actorId: 'policy-engine' },
    });

    expect(batchGrant.decisionIds).toEqual([first.id, second.id]);
    expect(batchGrant.allowedAdEntityIds).toEqual([first.adEntityId, second.adEntityId]);
    expect(() => database.prepare(`
      UPDATE mission_grants SET decision_ids_json = '[]' WHERE id = ?
    `).run(batchGrant.id)).toThrow(/append-only/i);
    expectRepositoryError(
      () => repository.issueMissionGrant(contextOne, {
        ...batchGrant,
        id: 'grant-store-one-batch-duplicate',
        issuer: { type: 'human', actorId: 'operator-one' },
      }),
      'DUPLICATE_IDENTITY',
    );
    expectRepositoryError(
      () => repository.issueMissionGrant(contextOne, {
        ...batchGrant,
        id: 'grant-store-one-batch-mismatch',
        decisionIds: [first.id, second.id],
        allowedAdEntityIds: [first.adEntityId!],
        issuer: { type: 'human', actorId: 'operator-one' },
      }),
      'REFERENCE_CONFLICT',
    );
  });
});

describe('MissionDomainRepository decisions, experiments, and causal ledger', () => {
  it('retains decision history, experiment observations, evidence, and causal corrections', () => {
    const { database, repository, contextOne } = createHarness();
    const { version, mission } = seedActiveMission(repository, contextOne);
    const decision = repository.createDecision(contextOne, {
      id: 'decision-one',
      missionId: mission.id,
      dataBatchId: mission.dataBatchId,
      policyVersionId: version.id,
      policyRevision: version.revision,
      actionRevision: 1,
      title: 'Lower one keyword bid',
      rationale: 'Spend rose while attributed sales stayed flat.',
      recommendation: 'Lower keyword bid from 1.00 to 0.92 USD.',
      facts: ['Seven-day spend increased 18%.'],
      alternatives: ['Keep bid unchanged and observe three more days.'],
      expectedEffect: 'Reduce inefficient spend with limited traffic loss.',
      validUntil: '2026-07-23T00:00:00.000Z',
      actionType: 'set_keyword_bid',
      adEntityId: `${contextOne.storeId}-keyword-1`,
      productId: `${contextOne.storeId}-product-1`,
      currentValue: 1,
      recommendedValue: 0.92,
      confidence: 0.82,
      status: 'needs_approval',
      actorId: 'ai-analyst',
    });
    const revised = repository.reviseDecision(contextOne, {
      id: decision.id,
      expectedRevision: decision.revision,
      recommendation: 'Lower keyword bid from 1.00 to 0.94 USD.',
      recommendedValue: 0.94,
      actorId: 'operator-one',
    });
    const approved = repository.resolveDecision(contextOne, {
      id: revised.id,
      expectedRevision: revised.revision,
      status: 'approved',
      actorId: 'operator-one',
      reason: 'Within the configured policy envelope.',
    });
    const executed = repository.resolveDecision(contextOne, {
      id: approved.id,
      expectedRevision: approved.revision,
      status: 'executed',
      actorId: 'executor-one',
      reason: 'Amazon Ads write submitted with verified identity.',
    });
    const verified = repository.resolveDecision(contextOne, {
      id: executed.id,
      expectedRevision: executed.revision,
      status: 'verified',
      actorId: 'executor-one',
      reason: 'Reload readback matched 0.94 USD.',
    });
    expect(verified.status).toBe('verified');
    expect(repository.listDecisionHistory(contextOne, decision.id).map((item) => item.eventType))
      .toEqual(['created', 'revised', 'approved', 'executed', 'verified']);
    expect(() => database.prepare(`
      UPDATE decision_history SET reason = 'tampered' WHERE decision_id = ?
    `).run(decision.id)).toThrow(/append-only/i);

    const experiment = repository.createExperiment(contextOne, {
      id: 'experiment-one',
      missionId: mission.id,
      name: 'Bid reduction observation',
      hypothesis: 'A six-percent bid reduction lowers ACOS without material sales loss.',
      primaryMetric: 'acos',
      guardrailMetrics: ['sales', 'orders'],
      guardrailCriteria: ['sales decline < 5%', 'orders decline < 5%'],
      productId: `${contextOne.storeId}-product-1`,
      adEntityId: `${contextOne.storeId}-keyword-1`,
      baseline: { bid: 1, acos: 0.41 },
      variant: { bid: 0.94 },
      observationStartsAt: '2026-07-22T12:00:00.000Z',
      observationEndsAt: '2026-07-29T12:00:00.000Z',
    });
    const updated = repository.updateExperiment(contextOne, {
      id: experiment.id,
      expectedRevision: experiment.revision,
      patch: { guardrailCriteria: ['sales decline < 4%', 'orders decline < 5%'] },
      actorId: 'operator-one',
    });
    repository.transitionExperiment(contextOne, {
      id: updated.id,
      expectedRevision: updated.revision,
      status: 'running',
      actorId: 'operator-one',
    });
    const observation = repository.appendExperimentObservation(contextOne, {
      id: 'experiment-observation-one',
      experimentId: experiment.id,
      observationType: 'observation',
      title: 'Day-one observation',
      observation: 'Sales are stable and ACOS is down one point.',
      observedAt: '2026-07-23T12:00:00.000Z',
      actorId: 'ai-analyst',
    });
    expectRepositoryError(
      () => repository.appendExperimentObservation(contextOne, {
        id: 'experiment-observation-invalid-reference',
        experimentId: experiment.id,
        observationType: 'observation',
        title: 'Invalid implicit correction',
        observation: 'A non-correction record cannot rewrite another observation.',
        observedAt: '2026-07-23T12:03:00.000Z',
        actorId: 'operator-one',
        correctsRecordId: observation.id,
      }),
      'INVALID_INPUT',
    );
    const correctedObservation = repository.appendExperimentObservation(contextOne, {
      id: 'experiment-observation-correction',
      experimentId: experiment.id,
      observationType: 'correction',
      title: 'Corrected day-one observation',
      observation: 'Sales are stable and ACOS is down 0.8 points.',
      observedAt: '2026-07-23T12:05:00.000Z',
      actorId: 'operator-one',
      correctsRecordId: observation.id,
    });
    expect(repository.listExperimentObservations(contextOne, experiment.id))
      .toEqual([correctedObservation, observation]);
    const metricSnapshot = repository.appendExperimentMetricSnapshot(contextOne, {
      id: 'metric-snapshot-one',
      experimentId: experiment.id,
      metric: 'acos',
      value: 0.402,
      currency: 'USD',
      observedAt: '2026-07-23T12:00:00.000Z',
      dataBatchId: mission.dataBatchId,
    });
    expect(repository.listExperimentMetricSnapshots(contextOne, experiment.id))
      .toEqual([metricSnapshot]);

    const fact = repository.appendCausalEvent(contextOne, {
      id: 'causal-manual-fact',
      stage: 'FACT',
      eventType: 'operator_fact',
      entityType: 'product',
      entityId: `${contextOne.storeId}-product-1`,
      missionId: mission.id,
      title: 'Prime Day promotion ended',
      signal: 'Promotion no longer affects the comparison window.',
      status: 'recorded',
      source: 'operator-event',
      actorId: 'operator-one',
    });
    const correction = repository.appendCausalEvent(contextOne, {
      id: 'causal-manual-fact-correction',
      stage: 'FACT',
      eventType: 'operator_fact_correction',
      entityType: 'product',
      entityId: `${contextOne.storeId}-product-1`,
      missionId: mission.id,
      title: 'Promotion end date corrected',
      signal: 'Promotion ended one day later than first recorded.',
      status: 'corrected',
      source: 'operator-event',
      actorId: 'operator-one',
      correctsEventId: fact.id,
    });
    const storeFact = repository.appendCausalEvent(contextOne, {
      id: 'causal-store-fact',
      stage: 'FACT',
      eventType: 'store_fact',
      entityType: 'store',
      entityId: contextOne.storeId,
      title: 'Store-level fact without a Mission',
      signal: 'A store-wide promotion was observed.',
      status: 'recorded',
      source: 'operator-event',
      actorId: 'operator-one',
    });
    const storeCorrection = repository.appendCausalEvent(contextOne, {
      id: 'causal-store-fact-correction',
      stage: 'FACT',
      eventType: 'store_fact_correction',
      entityType: 'store',
      entityId: contextOne.storeId,
      title: 'Store-level fact corrected',
      signal: 'The promotion applied one day later.',
      status: 'corrected',
      source: 'operator-event',
      actorId: 'operator-one',
      correctsEventId: storeFact.id,
    });
    expect(storeCorrection.correctsEventId).toBe(storeFact.id);
    expectRepositoryError(
      () => repository.appendCausalEvent(contextOne, {
        id: 'causal-invalid-cross-entity-correction',
        stage: 'FACT',
        eventType: 'operator_fact_correction',
        entityType: 'product',
        entityId: `${contextOne.storeId}-product-2`,
        missionId: mission.id,
        title: 'Invalid cross-entity correction',
        status: 'corrected',
        source: 'operator-event',
        actorId: 'operator-one',
        correctsEventId: fact.id,
      }),
      'REFERENCE_CONFLICT',
    );
    expectRepositoryError(
      () => repository.appendCausalEvent(contextOne, {
        id: 'causal-invalid-cross-stage-correction',
        stage: 'ANALYSIS',
        eventType: 'operator_analysis_correction',
        entityType: 'product',
        entityId: `${contextOne.storeId}-product-1`,
        missionId: mission.id,
        title: 'Invalid cross-stage correction',
        status: 'corrected',
        source: 'operator-event',
        actorId: 'operator-one',
        correctsEventId: fact.id,
      }),
      'REFERENCE_CONFLICT',
    );
    repository.appendEvidenceRef(contextOne, {
      id: 'evidence-one',
      eventId: correction.id,
      evidenceType: 'readback_bundle',
      evidenceRef: 'artifact:readback:sha256:abc123',
    });
    expectRepositoryError(
      () => repository.appendEvidenceRef(contextOne, {
        id: 'evidence-path',
        eventId: correction.id,
        evidenceType: 'screenshot',
        evidenceRef: 'C:\\evidence\\readback.png',
      }),
      'INVALID_INPUT',
    );

    const lineage = repository.getMissionLineage(contextOne, mission.id);
    expect(lineage.decisions).toHaveLength(1);
    expect(lineage.experiments).toHaveLength(1);
    expect(lineage.causalEvents.map((event) => event.stage)).toEqual(expect.arrayContaining([
      'FACT', 'ANALYSIS', 'DECISION', 'ACTION', 'READBACK',
    ]));
    expect(() => database.prepare(`
      DELETE FROM causal_events WHERE id = ?
    `).run(correction.id)).toThrow(/append-only/i);
    expect(() => database.prepare(`
      DELETE FROM missions WHERE id = ?
    `).run(mission.id)).toThrow(/FOREIGN KEY constraint/i);
  });
});

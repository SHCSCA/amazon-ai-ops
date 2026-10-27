import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { normalizeStoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { MissionDomainRepository } from './mission-domain-repo';
import { NOW, policyRules, seedCanonicalPolicyIdentity } from './mission-domain-repo.test-data';
import { seedProductScopeAuthorityWithOnlyUnrelatedMetric, seedExactPolicyAuthorityMetric } from './mission-domain-repo.test-authority';
import  {
  databases,
  createHarness,
  seedEnabledPolicy,
  seedActiveMission,
  createApprovedDecision,
  expectRepositoryError,
} from './mission-domain-repo.test-harness';
describe("MissionDomainRepository mission lineage and grants", () => {
it('issues a grant from the lower-number matching policy even when another policy was enabled later', () => {
    const { database, repository, contextOne } = createHarness();
    const lowPolicy = repository.createPolicy(contextOne, {
      id: 'grant-priority-low-policy',
      name: 'Exact object first-match policy',
      scope: 'store',
      priority: 10,
      actorId: 'operator',
    });
    const lowDraft = repository.createPolicyVersion(contextOne, {
      id: 'grant-priority-low-policy-v1',
      policyId: lowPolicy.id,
      version: 1,
      rules: policyRules(contextOne.storeId),
      validUntil: '2026-08-01T00:00:00.000Z',
      actorId: 'operator',
    });
    const lowVersion = repository.enablePolicyVersion(contextOne, {
      policyId: lowPolicy.id,
      versionId: lowDraft.id,
      expectedPolicyRevision: lowPolicy.revision,
      expectedVersionRevision: lowDraft.revision,
      actorId: 'operator',
    });
    const laterEnabled = seedEnabledPolicy(repository, contextOne);
    expect(repository.getPolicyRuntime(contextOne).activePolicyVersionId).toBe(laterEnabled.version.id);

    const draftMission = repository.createMission(contextOne, {
      id: 'mission-priority-first-match',
      dataBatchId: `batch-${contextOne.storeId}`,
      policyVersionId: lowVersion.id,
      title: 'Use the first matching strategy',
      objective: 'Prove numeric priority instead of last-enabled ordering.',
      productId: `${contextOne.storeId}-product-1`,
      observationStartsAt: '2026-07-22T00:00:00.000Z',
      observationEndsAt: '2026-07-29T00:00:00.000Z',
      successCriteria: ['Lower numeric policy wins'],
      guardrails: ['No last-enabled override'],
      actorId: 'operator',
    });
    const mission = repository.transitionMission(contextOne, {
      id: draftMission.id,
      expectedRevision: draftMission.revision,
      status: 'active',
      phase: 'decision',
      actorId: 'operator',
    });
    const runtime = repository.getPolicyRuntime(contextOne);
    repository.updatePolicyRuntime(contextOne, {
      expectedRevision: runtime.revision,
      actorId: 'operator',
      patch: {
        autonomyMode: 'policy_auto',
        activePolicyVersionId: laterEnabled.version.id,
      },
    });
    const decision = createApprovedDecision(database, repository, contextOne, mission, lowVersion, 71);


    const grant = repository.issueMissionGrant(contextOne, {
      id: 'grant-priority-first-match',
      missionId: mission.id,
      missionRevision: mission.revision,
      decisionIds: [decision.id],
      actionRevision: decision.actionRevision,
      allowedActionTypes: ['set_keyword_bid'],
      allowedAdEntityIds: [decision.adEntityId!],
      maxChangePct: 10,
      totalImpactBudget: 25,
      expiresAt: '2026-07-23T00:00:00.000Z',
      policyVersionId: lowVersion.id,
      policyRevision: lowVersion.revision,
      requiredEvidence: policyRules(contextOne.storeId).requiredEvidence,
      stopConditions: policyRules(contextOne.storeId).stopConditions,
      issuer: { type: 'policy', actorId: 'policy-engine' },
    });

    expect(grant.policyVersionId).toBe(lowVersion.id);
    expect(grant.allowedAdEntityIds).toEqual([decision.adEntityId]);
  });

it('refuses grant issuance when an enabled campaign scope loses current session authority', () => {
    const { database, repository, contextOne } = createHarness();
    const adsAccountId = `ads-account-${contextOne.storeId}`;
    const campaignId = 'campaign-grant-session';
    const authority = seedProductScopeAuthorityWithOnlyUnrelatedMetric(database, contextOne, {
      entityName: 'grant session keyword',
      campaignName: 'Grant Session Campaign',
      adGroupName: 'Grant Session Ad Group',
    });
    seedExactPolicyAuthorityMetric(database, contextOne, {
      sourceFile: authority.exactFile,
      sourceRow: authority.sourceRow,
      entityName: 'grant session keyword',
      campaignName: 'Grant Session Campaign',
      adGroupName: 'Grant Session Ad Group',
    });
    seedCanonicalPolicyIdentity(database, contextOne, authority, {
      adsAccountId,
      campaignId,
      adGroupId: 'ad-group-grant-session',
      canonicalKeywordId: 'canonical-grant-session',
    });
    const policy = repository.createPolicy(contextOne, {
      id: 'policy-grant-session-scope',
      name: 'Grant current session scope',
      scope: `campaign:${encodeURIComponent(adsAccountId)}/${encodeURIComponent(campaignId)}`,
      priority: 5,
      actorId: 'operator',
    });
    const draftVersion = repository.createPolicyVersion(contextOne, {
      id: 'policy-grant-session-scope-v1',
      policyId: policy.id,
      version: 1,
      rules: { ...policyRules(contextOne.storeId), allowedAdEntityIds: [authority.entityId] },
      actorId: 'operator',
    });
    const version = repository.enablePolicyVersion(contextOne, {
      policyId: policy.id,
      versionId: draftVersion.id,
      expectedPolicyRevision: policy.revision,
      expectedVersionRevision: draftVersion.revision,
      actorId: 'operator',
    });
    const draftMission = repository.createMission(contextOne, {
      id: 'mission-grant-session-scope',
      dataBatchId: `batch-${contextOne.storeId}`,
      policyVersionId: version.id,
      title: 'Current-session grant authority',
      objective: 'Block grants after canonical identity session drift.',
      observationStartsAt: '2026-07-22T00:00:00.000Z',
      observationEndsAt: '2026-07-29T00:00:00.000Z',
      successCriteria: ['No stale-session grant is issued'],
      guardrails: ['Campaign scope remains bound to the current Ads session'],
      actorId: 'operator',
    });
    const mission = repository.transitionMission(contextOne, {
      id: draftMission.id,
      expectedRevision: draftMission.revision,
      status: 'active',
      actorId: 'operator',
    });
    const decision = createApprovedDecision(database, repository, contextOne, mission, version, 21, undefined, 'scope');
    const runtime = repository.getPolicyRuntime(contextOne);
    repository.updatePolicyRuntime(contextOne, {
      expectedRevision: runtime.revision,
      actorId: 'operator',
      patch: { autonomyMode: 'policy_auto', activePolicyVersionId: version.id },
    });
    const nextContext = normalizeStoreContextEnvelope({ ...contextOne, sessionGeneration: 5 });
    database.prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, '5', ?)
      ON CONFLICT(key) DO UPDATE SET value = '5', updated_at = excluded.updated_at
    `).run(`store_session_generation:${contextOne.storeId}`, NOW);

    expectRepositoryError(() => repository.issueMissionGrant(nextContext, {
      id: 'grant-stale-session-scope',
      missionId: mission.id,
      missionRevision: mission.revision,
      decisionIds: [decision.id],
      actionRevision: decision.actionRevision,
      allowedActionTypes: ['set_keyword_bid'],
      allowedAdEntityIds: [authority.entityId],
      maxChangePct: 10,
      totalImpactBudget: 25,
      expiresAt: '2026-07-23T00:00:00.000Z',
      policyVersionId: version.id,
      policyRevision: version.revision,
      requiredEvidence: policyRules(contextOne.storeId).requiredEvidence,
      stopConditions: policyRules(contextOne.storeId).stopConditions,
      issuer: { type: 'policy', actorId: 'policy-engine' },
    }), 'REFERENCE_CONFLICT');
    expect(repository.listMissionGrants(nextContext, mission.id)).toEqual([]);
  });

it('refuses to issue a grant from a legacy enabled policy above the V1 ten-percent boundary', () => {
    const { database, repository, contextOne } = createHarness();
    const policy = repository.createPolicy(contextOne, {
      id: 'legacy-over-limit-policy',
      name: 'Legacy over-limit policy',
      scope: 'store',
      priority: 5,
      actorId: 'operator',
    });
    const versionId = 'legacy-over-limit-policy-v1';
    const legacyRules = { ...policyRules(contextOne.storeId), maxChangePct: 20 };
    database.prepare(`
      INSERT INTO policy_versions (
        id, store_id, policy_id, version, status, rules_json, revision,
        created_at, updated_at, enabled_at
      ) VALUES (?, ?, ?, 1, 'enabled', ?, 1, ?, ?, ?)
    `).run(versionId, contextOne.storeId, policy.id, JSON.stringify(legacyRules), NOW, NOW, NOW);
    database.prepare(`
      UPDATE policies
      SET status = 'active', active_version_id = ?, revision = revision + 1, updated_at = ?
      WHERE store_id = ? AND id = ?
    `).run(versionId, NOW, contextOne.storeId, policy.id);
    const version = repository.getPolicyVersion(contextOne, versionId)!;
    const draftMission = repository.createMission(contextOne, {
      id: 'mission-legacy-over-limit',
      dataBatchId: `batch-${contextOne.storeId}`,
      policyVersionId: version.id,
      title: 'Legacy policy grant check',
      objective: 'Do not authorize an over-limit historical policy.',
      observationStartsAt: '2026-07-22T00:00:00.000Z',
      observationEndsAt: '2026-07-29T00:00:00.000Z',
      successCriteria: ['No over-limit grant is issued'],
      guardrails: ['V1 change remains at or below ten percent'],
      actorId: 'operator',
    });
    const mission = repository.transitionMission(contextOne, {
      id: draftMission.id,
      expectedRevision: draftMission.revision,
      status: 'active',
      actorId: 'operator',
    });
    const decision = createApprovedDecision(database, repository, contextOne, mission, version, 20);
    const runtime = repository.getPolicyRuntime(contextOne);
    repository.updatePolicyRuntime(contextOne, {
      expectedRevision: runtime.revision,
      actorId: 'operator',
      patch: { autonomyMode: 'policy_auto', activePolicyVersionId: version.id },
    });

    expectRepositoryError(() => repository.issueMissionGrant(contextOne, {
      id: 'grant-legacy-over-limit',
      missionId: mission.id,
      missionRevision: mission.revision,
      decisionIds: [decision.id],
      actionRevision: decision.actionRevision,
      allowedActionTypes: ['set_keyword_bid'],
      allowedAdEntityIds: [decision.adEntityId!],
      maxChangePct: 15,
      totalImpactBudget: 25,
      expiresAt: '2026-07-23T00:00:00.000Z',
      policyVersionId: version.id,
      policyRevision: version.revision,
      requiredEvidence: policyRules(contextOne.storeId).requiredEvidence,
      stopConditions: policyRules(contextOne.storeId).stopConditions,
      issuer: { type: 'policy', actorId: 'policy-engine' },
    }), 'INVALID_INPUT');
    expect(repository.listMissionGrants(contextOne, mission.id)).toEqual([]);
  });

it('holds an IMMEDIATE write lock while re-reading grant authority', () => {
    const { database, databasePath, repository, contextOne } = createHarness();
    const { version, mission } = seedActiveMission(repository, contextOne);
    const runtime = repository.getPolicyRuntime(contextOne);
    repository.updatePolicyRuntime(contextOne, {
      expectedRevision: runtime.revision,
      actorId: 'operator',
      patch: { autonomyMode: 'policy_auto', activePolicyVersionId: version.id },
    });
    const decision = createApprovedDecision(database, repository, contextOne, mission, version, 9);


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
        adEntitySupportsKeywordBid: (context, adEntityId) => adEntityId.startsWith(`${context.storeId}-keyword-`),
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
    const decisionOne = createApprovedDecision(database, repository, contextOne, mission, version, 1);

    expect(repository.listMissions(contextTwo)).toEqual([]);
    expect(repository.getMission(contextTwo, mission.id)).toBeUndefined();
    expectRepositoryError(
      () => repository.updateMission(contextOne, {
        id: mission.id,
        expectedRevision: mission.revision,
        actorId: 'operator',
        patch: { productId: `${contextTwo.storeId}-product-1` },
      }),
      'STATE_CONFLICT',
    );
    const checkpoint = repository.appendMissionCheckpoint(contextOne, {
      id: 'checkpoint-one',
      missionId: mission.id,
      stage: 'ANALYSIS',
      title: 'Diagnosis reviewed',
      status: 'complete',
      evidenceCount: 2,
      actorId: 'operator',
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
    const initialRuntime = repository.getPolicyRuntime(contextOne);
    const inactiveRuntime = repository.updatePolicyRuntime(contextOne, {
      expectedRevision: initialRuntime.revision,
      actorId: 'operator',
      patch: { activePolicyVersionId: null },
    });
    expectRepositoryError(
      () => repository.issueMissionGrant(contextOne, {
        ...grantInput,
        id: 'grant-human-inactive-policy',
        issuer: { type: 'human', actorId: 'operator' },
      }),
      'STATE_CONFLICT',
    );
    repository.updatePolicyRuntime(contextOne, {
      expectedRevision: inactiveRuntime.revision,
      actorId: 'operator',
      patch: { activePolicyVersionId: version.id },
    });
    expectRepositoryError(
      () => repository.issueMissionGrant(contextOne, grantInput),
      'STATE_CONFLICT',
    );
    const runtime = repository.getPolicyRuntime(contextOne);
    repository.updatePolicyRuntime(contextOne, {
      expectedRevision: runtime.revision,
      actorId: 'operator',
      patch: { autonomyMode: 'policy_auto', activePolicyVersionId: version.id },
    });
    
    const policyDecision = createApprovedDecision(database, repository, contextOne, mission, version, 2);
    grantInput.decisionIds = [policyDecision.id]; grantInput.actionRevision = 2;
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
      actorId: 'operator',
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
      database, repository,
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

    const decisionTwo = createApprovedDecision(database, repository, contextOne, mission, version, 7);

    const draftV2 = repository.createPolicyVersion(contextOne, {
      id: 'policy-version-store-one-2',
      policyId: policy.id,
      version: 2,
      rules: policyRules(contextOne.storeId),
      actorId: 'operator',
    });
    repository.enablePolicyVersion(contextOne, {
      policyId: policy.id,
      versionId: draftV2.id,
      expectedPolicyRevision: policy.revision,
      expectedVersionRevision: draftV2.revision,
      actorId: 'operator',
    });
    const retiredAttempt = {
      ...grantInput,
      id: 'grant-retired-policy',
      decisionIds: [decisionTwo.id],
      actionRevision: 7,
    };
    expectRepositoryError(
      () => repository.issueMissionGrant(contextOne, retiredAttempt),
      'STATE_CONFLICT',
    );
    expectRepositoryError(
      () => repository.issueMissionGrant(contextOne, {
        ...retiredAttempt,
        id: 'grant-human-retired-snapshot',
        issuer: { type: 'human', actorId: 'operator' },
      }),
      'STATE_CONFLICT',
    );
    expect(repository.getMissionLineage(contextOne, mission.id).grants).toHaveLength(1);

    const decisionFive = createApprovedDecision(database, repository, contextOne, mission, version, 5);
    const pausedMission = repository.transitionMission(contextOne, {
      id: mission.id,
      expectedRevision: mission.revision,
      status: 'paused',
      actorId: 'operator',
      reason: 'Operator paused further execution.',
    });
    expectRepositoryError(
      () => repository.issueMissionGrant(contextOne, {
        ...grantInput,
        id: 'grant-while-paused',
        missionRevision: pausedMission.revision,
        decisionIds: [decisionFive.id],
        actionRevision: 5,
        issuer: { type: 'human', actorId: 'operator' },
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
      actorId: 'operator',
    });
    const draftVersion = repository.createPolicyVersion(contextOne, {
      id: 'policy-version-store-one-batch-1',
      policyId: policy.id,
      version: 1,
      rules,
      actorId: 'operator',
    });
    const version = repository.enablePolicyVersion(contextOne, {
      policyId: policy.id,
      versionId: draftVersion.id,
      expectedPolicyRevision: policy.revision,
      expectedVersionRevision: draftVersion.revision,
      actorId: 'operator',
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
      actorId: 'operator',
    });
    const mission = repository.transitionMission(contextOne, {
      id: draftMission.id,
      expectedRevision: draftMission.revision,
      status: 'active',
      phase: 'analysis',
      actorId: 'operator',
    });
    const runtime = repository.getPolicyRuntime(contextOne);
    repository.updatePolicyRuntime(contextOne, {
      expectedRevision: runtime.revision,
      actorId: 'operator',
      patch: { autonomyMode: 'policy_auto', activePolicyVersionId: version.id },
    });
    const first = createApprovedDecision(database, repository, contextOne, mission, version, 6);
    const second = createApprovedDecision(
      database, repository,
      contextOne,
      mission,
      version,
      6,
      '2026-07-23T00:00:00.000Z',
      '2',
    );


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
        issuer: { type: 'policy', actorId: 'policy-engine' },
      }),
      'DUPLICATE_IDENTITY',
    );
    expectRepositoryError(
      () => repository.issueMissionGrant(contextOne, {
        ...batchGrant,
        id: 'grant-store-one-batch-mismatch',
        decisionIds: [first.id, second.id],
        allowedAdEntityIds: [first.adEntityId!],
        issuer: { type: 'policy', actorId: 'policy-engine' },
      }),
      'REFERENCE_CONFLICT',
    );
  });
});

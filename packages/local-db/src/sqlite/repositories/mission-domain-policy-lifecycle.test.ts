import { describe, expect, it } from 'vitest';
import { NOW, policyRules } from './mission-domain-repo.test-data';
import  {
  createHarness,
  seedEnabledPolicy,
  createApprovedDecision,
  expectRepositoryError,
} from './mission-domain-repo.test-harness';
describe("MissionDomainRepository policy and context authority", () => {
it('resolves the lowest numeric matching policy independent of enable order and fails closed on a tie', () => {
    const { database, repository, contextOne } = createHarness();
    const enable = (id: string, priority: number) => {
      const policy = repository.createPolicy(contextOne, {
        id: `priority-policy-${id}`,
        name: `Priority policy ${id}`,
        scope: 'store',
        priority,
        actorId: 'operator',
      });
      const draft = repository.createPolicyVersion(contextOne, {
        id: `priority-policy-${id}-v1`,
        policyId: policy.id,
        version: 1,
        rules: policyRules(contextOne.storeId),
        validUntil: '2026-08-01T00:00:00.000Z',
        actorId: 'operator',
      });
      return repository.enablePolicyVersion(contextOne, {
        policyId: policy.id,
        versionId: draft.id,
        expectedPolicyRevision: policy.revision,
        expectedVersionRevision: draft.revision,
        actorId: 'operator',
      });
    };

    const lowerPriority = enable('first-enabled-low-number', 10);
    enable('last-enabled-high-number', 100);
    expect(repository.getPolicyRuntime(contextOne).activePolicyVersionId)
      .toBe('priority-policy-last-enabled-high-number-v1');
    expect(repository.resolveEffectivePolicyVersion(contextOne, {
      allowedActionTypes: ['set_keyword_bid'],
      allowedAdEntityIds: [`${contextOne.storeId}-keyword-1`],
      at: NOW,
    }).id).toBe(lowerPriority.id);

    enable('same-low-number', 10);
    expectRepositoryError(() => repository.resolveEffectivePolicyVersion(contextOne, {
      allowedActionTypes: ['set_keyword_bid'],
      allowedAdEntityIds: [`${contextOne.storeId}-keyword-1`],
      at: NOW,
    }), 'STATE_CONFLICT');
  });

it('rejects a V1 policy version whose persisted bid-change boundary exceeds ten percent', () => {
    const { database, repository, contextOne } = createHarness();
    const policy = repository.createPolicy(contextOne, {
      id: 'policy-ten-percent',
      name: 'Ten percent hard boundary',
      scope: 'store',
      priority: 5,
      actorId: 'operator',
    });

    expectRepositoryError(() => repository.createPolicyVersion(contextOne, {
      id: 'policy-ten-percent-v1-invalid',
      policyId: policy.id,
      version: 1,
      rules: { ...policyRules(contextOne.storeId), maxChangePct: 11 },
      actorId: 'operator',
    }), 'INVALID_INPUT');
    const valid = repository.createPolicyVersion(contextOne, {
      id: 'policy-ten-percent-v1',
      policyId: policy.id,
      version: 1,
      rules: { ...policyRules(contextOne.storeId), maxChangePct: 10 },
      actorId: 'operator',
    });
    expect(valid.rules.maxChangePct).toBe(10);
  });

it('freezes policy scope after any version exists while keeping metadata editable', () => {
    const { database, repository, contextOne } = createHarness();
    const policy = repository.createPolicy(contextOne, {
      id: 'policy-frozen-scope',
      name: 'Frozen scope policy',
      scope: 'store',
      priority: 5,
      actorId: 'operator',
    });
    repository.createPolicyVersion(contextOne, {
      id: 'policy-frozen-scope-v1',
      policyId: policy.id,
      version: 1,
      rules: policyRules(contextOne.storeId),
      actorId: 'operator',
    });

    expectRepositoryError(() => repository.updatePolicy(contextOne, {
      id: policy.id,
      expectedRevision: policy.revision,
      actorId: 'operator',
      patch: { scope: `keyword:${contextOne.storeId}-keyword-1` },
    }), 'STATE_CONFLICT');
    const renamed = repository.updatePolicy(contextOne, {
      id: policy.id,
      expectedRevision: policy.revision,
      actorId: 'operator',
      patch: { name: 'Renamed without scope drift', scope: policy.scope, priority: 4 },
    });
    expect(renamed).toMatchObject({ name: 'Renamed without scope drift', scope: 'store', priority: 4 });
  });

it('fails closed for an unknown unstructured policy scope instead of widening it to the store', () => {
    const { database, repository, contextOne } = createHarness();
    const policy = repository.createPolicy(contextOne, {
      id: 'policy-unknown-legacy-scope',
      name: 'Unknown legacy scope',
      scope: 'unexpected-legacy-scope',
      priority: 5,
      actorId: 'operator',
    });

    expectRepositoryError(() => repository.createPolicyVersion(contextOne, {
      id: 'policy-unknown-legacy-scope-v1',
      policyId: policy.id,
      version: 1,
      rules: policyRules(contextOne.storeId),
      actorId: 'operator',
    }), 'REFERENCE_CONFLICT');
  });

it('refuses to enable a legacy draft without rate limits and an execution window', () => {
    const { database, repository, contextOne } = createHarness();
    const policy = repository.createPolicy(contextOne, {
      id: 'legacy-incomplete-policy',
      name: 'Legacy incomplete policy',
      scope: 'store',
      priority: 5,
      actorId: 'operator',
    });
    const draft = repository.createPolicyVersion(contextOne, {
      id: 'legacy-incomplete-policy-v1',
      policyId: policy.id,
      version: 1,
      rules: policyRules(contextOne.storeId),
      actorId: 'operator',
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
      actorId: 'operator',
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
        actorId: 'operator',
        patch: { priority: 90 },
      }),
      'REVISION_CONFLICT',
    );
    expectRepositoryError(
      () => repository.updateDraftPolicyVersion(contextOne, {
        id: version.id,
        expectedRevision: version.revision,
        actorId: 'operator',
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
      actorId: 'operator',
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
        actorId: 'operator',
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
    const { database, repository, contextTwo } = createHarness();
    const policy = repository.createPolicy(contextTwo, {
      id: 'policy-no-objects',
      name: 'Policy awaiting stable objects',
      scope: 'sponsored-products-keywords',
      priority: 100,
      actorId: 'operator',
    });
    const draftVersion = repository.createPolicyVersion(contextTwo, {
      id: 'policy-version-no-objects',
      policyId: policy.id,
      version: 1,
      rules: { ...policyRules(contextTwo.storeId), allowedAdEntityIds: [] },
      actorId: 'operator',
    });
    const version = repository.enablePolicyVersion(contextTwo, {
      policyId: policy.id,
      versionId: draftVersion.id,
      expectedPolicyRevision: policy.revision,
      expectedVersionRevision: draftVersion.revision,
      actorId: 'operator',
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
      actorId: 'operator',
    });
    const mission = repository.transitionMission(contextTwo, {
      id: draftMission.id,
      expectedRevision: draftMission.revision,
      status: 'active',
      actorId: 'operator',
    });
    const decision = createApprovedDecision(database, repository, contextTwo, mission, version, 1);
    const runtime = repository.getPolicyRuntime(contextTwo);
    repository.updatePolicyRuntime(contextTwo, {
      expectedRevision: runtime.revision,
      actorId: 'operator',
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

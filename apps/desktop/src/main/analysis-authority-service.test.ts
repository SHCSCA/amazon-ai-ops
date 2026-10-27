import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AnalysisAuthorityRepository,
  MissionDomainRepository,
  RecommendationRepository,
  initSqlite,
} from '@amazon-ai-ops/local-db';
import {
  ANALYSIS_REQUIRED_REPORT_TYPES,
  normalizeStoreContextEnvelope,
  type ActionRecommendation,
  type PolicyVersionRules,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import {
  AnalysisAuthorityService,
  DEFAULT_ANALYSIS_GENERATION_TIMEOUT_MS,
  type AnalysisAuthorityServiceOptions,
  type AnalysisRecommendationGenerationScope,
  type CapturedAnalysisGenerationAuthority,
} from './analysis-authority-service';
import { approveHumanDecisions, NOW, RULE_REVISION, tempDirs, databases, Harness, createHarness, seedImportAuthority, seedBootstrapPolicyAuthorities, recommendation, runRequest, seedTrustedCausalMemory, seedPriorGrant } from './analysis-authority.test-support';

describe('AnalysisAuthorityService', () => {
  it.each(['manual_approval', 'policy_auto'] as const)('caps %s grant expiry at the temporary policy deadline', async (autonomyMode) => {
    const policyValidUntil = '2026-07-22T13:00:00.000Z';
    const h = createHarness({ autonomyMode, policyValidUntil });
    const analysis = await runRequest(h);
    if (autonomyMode === 'manual_approval') approveHumanDecisions(h);
    const result = h.service.authorizeProposalBatch({ context: h.context, missionId: h.missionId, proposalIds: analysis.proposals.map(p => p.id) });
    expect(result.authorized).toBe(true);
    expect(result.grant?.expiresAt).toBe(policyValidUntil);
    expect(h.missionRepository.getMissionGrant(h.context, result.grant!.id)?.expiresAt).toBe(policyValidUntil);
  });

  it('upgrades legacy judgments without backfilling authority and retains readable approval history', async () => {
    const h = createHarness();
    seedTrustedCausalMemory(h, 1);
    expect(h.missionRepository.listAnalysisCausalMemory(h.context, { productId: 'B0TEST' })).toHaveLength(1);
    const analysis = await runRequest(h); approveHumanDecisions(h);
    const original = h.service.authorizeProposalBatch({ context: h.context, missionId: h.missionId, proposalIds: analysis.proposals.map(p => p.id) }).grant!;
    const history = h.missionRepository.listDecisionHistory(h.context, original.decisionIds[0]);
    const legacyPath = path.join(h.directory, 'legacy-no-authority.db');
    await h.database.backup(legacyPath);
    const legacy = new Database(legacyPath);
    legacy.exec(`DROP TABLE ai_cost_records; DROP TABLE ai_spend_policies; DROP TABLE legacy_record_classifications;
      DROP TRIGGER trg_decision_write_authority_immutable;
      ALTER TABLE analysis_action_batches DROP COLUMN authority_json;
      ALTER TABLE decisions DROP COLUMN authority_json;
      ALTER TABLE mission_grants DROP COLUMN authority_json;
      DELETE FROM schema_migrations WHERE version>=17;`);
    legacy.close();
    const upgraded = initSqlite(legacyPath); databases.push(upgraded);
    const repository = new MissionDomainRepository(upgraded, { now: () => new Date(NOW) });
    const historical = repository.getMissionGrant(h.context, original.id)!;
    expect(historical.authority).toBeUndefined();
    expect(repository.getDecision(h.context, original.decisionIds[0])?.authority).toBeUndefined();
    expect(upgraded.prepare("SELECT classification,source_schema,reason FROM legacy_record_classifications WHERE source_table='mission_grants' AND record_id=?").get(original.id))
      .toMatchObject({ classification: 'historical-read-only', source_schema: 16, reason: expect.any(String) });
    expect(repository.listDecisionHistory(h.context, original.decisionIds[0])).toEqual(history);
    expect(repository.listCausalEvents(h.context, { missionId: h.missionId }).some(event => event.id === 'trusted-analysis-memory-1')).toBe(true);
    expect(repository.listAnalysisCausalMemory(h.context, { productId: 'B0TEST' })).toEqual([]);
    expect(() => repository.assertWriteAuthority(h.context, historical.authority)).toThrow(/历史/);
    expect(() => repository.issueMissionGrant(h.context, { ...original, id: 'cannot-reissue-legacy' })).toThrow(/历史/);
    const before = upgraded.prepare('SELECT manifest_json FROM schema_migrations WHERE version=17').get();
    upgraded.close();
    const reopened = initSqlite(legacyPath); databases.push(reopened);
    expect(reopened.prepare('SELECT manifest_json FROM schema_migrations WHERE version=17').get()).toEqual(before);
    expect(reopened.pragma('foreign_key_check')).toEqual([]);
  });

  it('preserves prior human Decisions but refuses them after mode A-to-B-to-A before any grant exists', async () => {
    const h = createHarness();
    const analysis = await runRequest(h);
    approveHumanDecisions(h);
    const decisions = h.missionRepository.listDecisions(h.context, { missionId: h.missionId });
    const history = h.missionRepository.listDecisionHistory(h.context, decisions[0].id);
    for (const autonomyMode of ['policy_auto', 'manual_approval'] as const) {
      const runtime = h.missionRepository.getPolicyRuntime(h.context);
      h.missionRepository.updatePolicyRuntime(h.context, { expectedRevision: runtime.revision, actorId: 'operator',
        patch: { autonomyMode, reason: '隔离模式变更样本：调整后重新核验授权。' } });
      const result = h.service.authorizeProposalBatch({ context: h.context, missionId: h.missionId, proposalIds: analysis.proposals.map(p => p.id) });
      expect(result.authorized).toBe(false);
      expect(result.blockers).toContainEqual({ code: 'AUTONOMY_MODE_CHANGED', message: expect.stringMatching(/授权模式版本/) });
    }
    expect(h.missionRepository.listMissionGrants(h.context, h.missionId)).toHaveLength(0);
    expect(h.missionRepository.listDecisionHistory(h.context, decisions[0].id)).toEqual(history);
  });

  it('binds complete context and issuer to immutable batch, Decision and Grant records', async () => {
    const h = createHarness();
    const analysis = await runRequest(h);
    const batch = h.analysisRepository.getLatestActionBatch(h.context, h.missionId)!;
    const decision = h.missionRepository.listDecisions(h.context, { missionId: h.missionId })[0];
    expect(batch.authority).toMatchObject({ context: h.context, authorityMode: 'manual_approval',
      authorizationPath: 'human', issuerType: 'human_operator', issuerRef: 'operator' });
    expect(decision.authority).toEqual(batch.authority);
    expect(() => h.missionRepository.resolveDecision(h.context, { id: decision.id, expectedRevision: decision.revision,
      status: 'approved', actorId: 'policy-engine', reason: '策略不能替代人工判断。' })).toThrow(/判断来源/);
    expect(() => h.missionRepository.resolveDecision(h.context, { id: decision.id, expectedRevision: decision.revision,
      status: 'approved', actorId: 'operator', reason: '   ' })).toThrow();
    expect(() => h.database.prepare("UPDATE decisions SET authority_json='{}' WHERE id=?").run(decision.id)).toThrow(/immutable/);
    approveHumanDecisions(h);
    const result = h.service.authorizeProposalBatch({ context: h.context, missionId: h.missionId, proposalIds: analysis.proposals.map(p => p.id) });
    expect(result.grant?.authority).toEqual(batch.authority);
    expect(() => h.missionRepository.assertWriteAuthority({ ...h.context, businessDate: '2026-07-23' as never }, result.grant!.authority)).toThrow(/店铺、会话或授权模式版本/);
    expect(() => h.missionRepository.assertWriteAuthority(h.context, undefined)).toThrow(/历史/);
  });

  it('will not issue a partial grant through the canonical repository after all human Decisions exist', async () => {
    const h = createHarness({ recommendationCount: 2 });
    const analysis = await runRequest(h); approveHumanDecisions(h);
    const result = h.service.authorizeProposalBatch({ context: h.context, missionId: h.missionId, proposalIds: analysis.proposals.map(p => p.id) });
    const grant = result.grant!;
    expect(() => h.missionRepository.issueMissionGrant(h.context, { ...grant, id: 'partial-direct-grant',
      decisionIds: [grant.decisionIds[0]], allowedAdEntityIds: [grant.allowedAdEntityIds[0]] })).toThrow(/全部判断/);
    expect(() => h.missionRepository.issueMissionGrant(h.context, { ...grant, id: 'mixed-issuer-grant',
      issuer: { type: 'policy', actorId: 'policy-engine' } })).toThrow(/禁止混合/);
    expect(h.missionRepository.listMissionGrants(h.context, h.missionId)).toHaveLength(1);
  });

  it('requires each human Decision and its reason before the explicit complete-batch grant', async () => {
    const h = createHarness({ recommendationCount: 2 });
    const analysis = await runRequest(h);
    const request = { context: h.context, missionId: h.missionId, proposalIds: analysis.proposals.map(p => p.id) };
    const links = h.service.getMissionAnalysisProjection(h.context, h.missionId).decisionLinks;
    expect(h.service.authorizeProposalBatch(request).authorized).toBe(false);
    expect(h.missionRepository.listMissionGrants(h.context, h.missionId)).toHaveLength(0);
    for (const [index, link] of links.entries()) {
      const decision = h.missionRepository.getDecision(h.context, link.decisionId)!;
      expect(decision.status).toBe('needs_approval');
      h.missionRepository.resolveDecision(h.context, {
        id: decision.id, expectedRevision: decision.revision, status: 'approved',
        reason: `人工样本判断 ${index + 1}：当前花费超限，核对证据后接受本条降价。`, actorId: 'operator',
      });
      if (index === 0) expect(h.service.authorizeProposalBatch(request).authorized).toBe(false);
    }
    const history = links.map(link => h.missionRepository.listDecisionHistory(h.context, link.decisionId));
    expect(h.service.authorizeProposalBatch(request)).toMatchObject({ authorized: true, mode: 'manual_approval' });
    expect(links.map(link => h.missionRepository.listDecisionHistory(h.context, link.decisionId))).toEqual(history);
    expect(history.every(events => events.some(event => event.eventType === 'approved' && event.reason?.includes('核对证据后')))).toBe(true);
  });

  it('issues one exact grant after explicit individual human Decisions', async () => {
    const harness = createHarness({ recommendationCount: 2 });
    const result = await runRequest(harness);
    expect(result.proposals).toHaveLength(2);
    approveHumanDecisions(harness);
    const authorized = harness.service.authorizeProposalBatch({
      context: harness.context,
      missionId: harness.missionId,
      proposalIds: result.proposals.map((proposal) => proposal.id),
    });
    expect(authorized).toMatchObject({
      authorized: true,
      mode: 'manual_approval',
      proposalIds: expect.arrayContaining(result.proposals.map((proposal) => proposal.id)),
    });
    expect(authorized.grant?.issuer.type).toBe('human');
    expect(authorized.grant?.decisionIds).toHaveLength(2);
    for (const decisionId of authorized.decisionIds) {
      expect(harness.missionRepository.getDecision(harness.context, decisionId)?.status).toBe('approved');
    }
    expect(harness.service.authorizeProposalBatch({
      context: harness.context,
      missionId: harness.missionId,
      proposalIds: [result.proposals[0].id],
    }).blockers).toContainEqual({ code: 'INCOMPLETE_BATCH', message: '必须整批授权，不能只批准动作批次的一部分。' });
    expect(harness.service.authorizeProposalBatch({
      context: harness.context,
      missionId: harness.missionId,
      proposalIds: result.proposals.map((proposal) => proposal.id),
    })).toMatchObject({ authorized: true, mode: 'manual_approval', grant: { id: authorized.grant?.id } });
  });

  it('policy-auto approves aligned Decisions and issues the same durable MissionGrant model', async () => {
    const harness = createHarness({ autonomyMode: 'policy_auto' });
    const result = await runRequest(harness);
    expect(result.proposals[0].authorization.policy.eligible).toBe(true);
    expect(result.automaticAuthorization).toMatchObject({ authorized: true, mode: 'policy_auto' });
    expect(result.automaticAuthorization?.grant?.issuer.type).toBe('policy');
    const authorized = harness.service.authorizeProposalBatch({
      context: harness.context,
      missionId: harness.missionId,
      proposalIds: result.proposals.map((proposal) => proposal.id),
    });
    expect(authorized).toMatchObject({ authorized: true, mode: 'policy_auto' });
    expect(authorized.grant?.issuer.type).toBe('policy');
    expect(authorized.grant?.id).toBe(result.automaticAuthorization?.grant?.id);
    const decision = harness.missionRepository.getDecision(harness.context, authorized.decisionIds[0]);
    expect(decision?.status).toBe('approved');
  });

  it('uses the lowest numeric matching policy instead of the most recently enabled policy', async () => {
    const harness = createHarness({ autonomyMode: 'policy_auto' });
    const missionPolicy = harness.missionRepository.getPolicyVersion(
      harness.context,
      harness.policyVersionId,
    )!;
    const laterPolicy = harness.missionRepository.createPolicy(harness.context, {
      id: 'policy-later-high-priority-number',
      name: 'Later broad fallback policy',
      scope: 'store',
      priority: 100,
      actorId: 'operator',
    });
    const laterDraft = harness.missionRepository.createPolicyVersion(harness.context, {
      id: 'policy-later-high-priority-number-v1',
      policyId: laterPolicy.id,
      version: 1,
      rules: missionPolicy.rules,
      actorId: 'operator',
    });
    const laterVersion = harness.missionRepository.enablePolicyVersion(harness.context, {
      policyId: laterPolicy.id,
      versionId: laterDraft.id,
      expectedPolicyRevision: laterPolicy.revision,
      expectedVersionRevision: laterDraft.revision,
      actorId: 'operator',
    });
    const runtime = harness.missionRepository.getPolicyRuntime(harness.context);
    harness.missionRepository.updatePolicyRuntime(harness.context, {
      expectedRevision: runtime.revision,
      actorId: 'operator',
      patch: {
        autonomyMode: 'policy_auto',
        activePolicyVersionId: laterVersion.id,
      },
    });

    const result = await runRequest(harness);

    expect(result.proposals[0].authorization.policy).toEqual({ eligible: true, blockers: [] });
    expect(result.automaticAuthorization).toMatchObject({
      authorized: true,
      mode: 'policy_auto',
      grant: { policyVersionId: harness.policyVersionId },
    });
  });

  it('blocks a Mission policy when a newly enabled lower-number policy now matches the same Ads object', async () => {
    const harness = createHarness({ autonomyMode: 'policy_auto' });
    const missionPolicy = harness.missionRepository.getPolicyVersion(
      harness.context,
      harness.policyVersionId,
    )!;
    const lowerPolicy = harness.missionRepository.createPolicy(harness.context, {
      id: 'policy-new-lower-number',
      name: 'New first-match policy',
      scope: 'store',
      priority: 0,
      actorId: 'operator',
    });
    const lowerDraft = harness.missionRepository.createPolicyVersion(harness.context, {
      id: 'policy-new-lower-number-v1',
      policyId: lowerPolicy.id,
      version: 1,
      rules: missionPolicy.rules,
      actorId: 'operator',
    });
    harness.missionRepository.enablePolicyVersion(harness.context, {
      policyId: lowerPolicy.id,
      versionId: lowerDraft.id,
      expectedPolicyRevision: lowerPolicy.revision,
      expectedVersionRevision: lowerDraft.revision,
      actorId: 'operator',
    });

    const result = await runRequest(harness);

    expect(result.proposals[0].authorization.policy.blockers).toContain('POLICY_PRIORITY_MISMATCH');
    expect(result.automaticAuthorization).toMatchObject({
      authorized: false,
      mode: 'policy_auto',
    });
    expect(harness.missionRepository.listMissionGrants(harness.context, harness.missionId)).toEqual([]);
  });

  it('does not issue or dispatch a policy grant for legacy metadata without an explicit aligned rule-AI decision', async () => {
    const onAutomaticGrantIssued = vi.fn();
    const harness = createHarness({
      autonomyMode: 'policy_auto',
      onAutomaticGrantIssued,
      recommendationEvidencePatch: {
        decisionSource: undefined,
        decisionAgreement: undefined,
        decisionRequiresReview: undefined,
        aiStrategySource: 'ai',
        explanationSource: 'ai',
      },
    });

    const result = await runRequest(harness);
    expect(result.proposals[0]).toMatchObject({
      source: 'rule',
      authorization: {
        policy: {
          eligible: false,
          blockers: expect.arrayContaining(['POLICY_REQUIRES_RULE_AI_ALIGNMENT']),
        },
      },
    });
    expect(result.automaticAuthorization).toMatchObject({
      authorized: false,
      mode: 'policy_auto',
    });
    expect(onAutomaticGrantIssued).not.toHaveBeenCalled();
    expect(harness.missionRepository.listMissionGrants(harness.context, harness.missionId)).toEqual([]);
  });

  it('notifies execution exactly once for a policy-auto grant and never for manual authorization', async () => {
    const onAutomaticGrantIssued = vi.fn();
    const automaticHarness = createHarness({
      autonomyMode: 'policy_auto',
      onAutomaticGrantIssued,
    });

    const automatic = await runRequest(automaticHarness);
    expect(onAutomaticGrantIssued).toHaveBeenCalledTimes(1);
    expect(onAutomaticGrantIssued).toHaveBeenCalledWith(
      automaticHarness.context,
      automatic.automaticAuthorization?.grant,
    );
    automaticHarness.service.authorizeProposalBatch({
      context: automaticHarness.context,
      missionId: automaticHarness.missionId,
      proposalIds: automatic.proposals.map((proposal) => proposal.id),
    });
    expect(onAutomaticGrantIssued).toHaveBeenCalledTimes(1);

    const manualHarness = createHarness({ onAutomaticGrantIssued });
    const manual = await runRequest(manualHarness);
    manualHarness.service.authorizeProposalBatch({
      context: manualHarness.context,
      missionId: manualHarness.missionId,
      proposalIds: manual.proposals.map((proposal) => proposal.id),
    });
    expect(onAutomaticGrantIssued).toHaveBeenCalledTimes(1);
  });

  it('never downgrades an automatic authorization attempt into a human grant when mode changes', async () => {
    const harness = createHarness({ autonomyMode: 'policy_auto' });
    const readRuntime = harness.missionRepository.getPolicyRuntime.bind(harness.missionRepository);
    let reads = 0;
    vi.spyOn(harness.missionRepository, 'getPolicyRuntime').mockImplementation((context) => {
      const runtime = readRuntime(context);
      reads += 1;
      return reads === 1 ? runtime : { ...runtime, autonomyMode: 'manual_approval' };
    });
    const result = await runRequest(harness);
    expect(result.automaticAuthorization).toMatchObject({
      authorized: false,
      mode: 'policy_auto',
      blockers: [{ code: 'AUTONOMY_MODE_CHANGED', message: expect.stringMatching(/未降级为人工授权/) }],
    });
    expect(harness.missionRepository.listMissionGrants(harness.context, harness.missionId)).toEqual([]);
    const projection = harness.service.getMissionAnalysisProjection(harness.context, harness.missionId);
    expect(harness.missionRepository.getDecision(
      harness.context,
      projection.decisionLinks[0].decisionId,
    )?.status).toBe('needs_approval');
  });

  it('keeps rule fallback and missing opaque Ads identity visible but non-authorizable', async () => {
    const harness = createHarness({ withWritableTarget: false, fallback: true });
    const result = await runRequest(harness);
    expect(result.proposals[0]).toMatchObject({
      source: 'rule_fallback',
      authorization: {
        human: { eligible: false },
        policy: { eligible: false },
      },
    });
    expect(result.proposals[0].authorization.human.blockers).toEqual(expect.arrayContaining([
      'MISSING_STABLE_AD_ENTITY',
      'RULE_FALLBACK_NOT_AUTHORIZABLE',
    ]));
    const projection = harness.service.getMissionAnalysisProjection(harness.context, harness.missionId);
    expect(harness.missionRepository.getDecision(
      harness.context,
      projection.decisionLinks[0].decisionId,
    )?.status).toBe('blocked');
  });

  it('derives product scope and proof authority in Main instead of trusting Renderer fields or arbitrary files', async () => {
    const harness = createHarness({ proofAllowed: false });
    const result = await runRequest(harness);
    expect(result.evidencePackage.asin).toBe('B0TEST');
    expect(result.proposals[0].adEntityId).toBeUndefined();
    expect(result.proposals[0].authorization.human.blockers).toContain('MISSING_STABLE_AD_ENTITY');
    expect(result.ai.detail).not.toMatch(/provider unavailable|AI and rules aligned/i);
  });

  it('rolls back batch Decision approvals when immutable grant issuance fails', async () => {
    const harness = createHarness({ recommendationCount: 2, autonomyMode: 'policy_auto' });
    vi.spyOn(harness.missionRepository, 'issueMissionGrant').mockImplementation(() => {
      throw new Error('simulated grant insert failure');
    });
    await expect(runRequest(harness)).rejects.toThrow(/simulated grant insert failure/);
    const projection = harness.service.getMissionAnalysisProjection(harness.context, harness.missionId);
    expect(projection.decisionLinks.map((link) => (
      harness.missionRepository.getDecision(harness.context, link.decisionId)?.status
    ))).toEqual(['needs_approval', 'needs_approval']);
    expect(harness.missionRepository.listMissionGrants(harness.context, harness.missionId)).toEqual([]);
  });

  it('does not resurrect a revoked grant for the same action revision', async () => {
    const harness = createHarness();
    const result = await runRequest(harness);
    approveHumanDecisions(harness);
    const authorized = harness.service.authorizeProposalBatch({
      context: harness.context,
      missionId: harness.missionId,
      proposalIds: result.proposals.map((proposal) => proposal.id),
    });
    harness.missionRepository.appendMissionGrantEvent(harness.context, {
      id: 'grant-event-revoked-test',
      grantId: authorized.grant!.id,
      eventType: 'revoked',
      actorId: 'operator',
      reason: 'facts changed',
    });
    const repeated = harness.service.authorizeProposalBatch({
      context: harness.context,
      missionId: harness.missionId,
      proposalIds: result.proposals.map((proposal) => proposal.id),
    });
    expect(repeated).toMatchObject({ authorized: false, mode: 'manual_approval' });
    expect(repeated.blockers).toContainEqual({ code: 'GRANT_TERMINAL', message: expect.stringMatching(/revoked/) });
  });

  it('fails closed outside the immutable policy execution window', async () => {
    const harness = createHarness({
      executionWindow: {
        timeZone: 'America/Los_Angeles',
        daysOfWeek: [3],
        start: '06:00',
        end: '07:00',
      },
    });
    const result = await runRequest(harness);
    approveHumanDecisions(harness);
    const blocked = harness.service.authorizeProposalBatch({
      context: harness.context,
      missionId: harness.missionId,
      proposalIds: result.proposals.map((proposal) => proposal.id),
    });
    expect(blocked).toMatchObject({ authorized: false });
    expect(blocked.blockers).toContainEqual({ code: 'OUTSIDE_EXECUTION_WINDOW', message: expect.stringMatching(/执行窗口/) });
  });

  it('does not charge daily action capacity for a previously issued but unused grant', async () => {
    const harness = createHarness({ maxDailyActionCount: 1 });
    const result = await runRequest(harness);
    const projection = harness.service.getMissionAnalysisProjection(harness.context, harness.missionId);
    seedPriorGrant(harness, projection.decisionLinks[0].decisionId, result.proposals[0].adEntityId!);
    approveHumanDecisions(harness);
    const blocked = harness.service.authorizeProposalBatch({
      context: harness.context,
      missionId: harness.missionId,
      proposalIds: result.proposals.map((proposal) => proposal.id),
    });
    expect(blocked).toMatchObject({ authorized: true, blockers: [] });
    expect(harness.missionRepository.getDecision(
      harness.context,
      projection.decisionLinks[0].decisionId,
    )?.status).toBe('approved');
  });

  it('does not start entity cooldown from grant issuance without a submit intent', async () => {
    const harness = createHarness({ cooldownMinutes: 90 });
    const result = await runRequest(harness);
    const projection = harness.service.getMissionAnalysisProjection(harness.context, harness.missionId);
    seedPriorGrant(harness, projection.decisionLinks[0].decisionId, result.proposals[0].adEntityId!);
    approveHumanDecisions(harness);
    const blocked = harness.service.authorizeProposalBatch({
      context: harness.context,
      missionId: harness.missionId,
      proposalIds: result.proposals.map((proposal) => proposal.id),
    });
    expect(blocked).toMatchObject({ authorized: true, blockers: [] });
    expect(harness.missionRepository.getDecision(
      harness.context,
      projection.decisionLinks[0].decisionId,
    )?.status).toBe('approved');
  });
});

it('rejects analysis finalization after a durable authority mode round trip', async () => {
  let harness: Harness;
  harness = createHarness({ generationAuthorityFactory: captured => ({ ...captured, generateRecommendations: async scope => {
    const generated = await captured.generateRecommendations(scope);
    for (const autonomyMode of ['policy_auto', 'manual_approval'] as const) {
      const runtime = harness.missionRepository.getPolicyRuntime(harness.context);
      harness.missionRepository.updatePolicyRuntime(harness.context, { expectedRevision: runtime.revision, actorId: 'operator', patch: { autonomyMode, reason: 'mode drift regression' } });
    }
    return generated;
  } }) });
  await expect(runRequest(harness)).rejects.toThrow(/模式或策略在分析期间已变化/);
  expect(harness.service.getMissionAnalysisProjection(harness.context, harness.missionId).actionBatches).toHaveLength(0);
  expect(harness.missionRepository.listMissionGrants(harness.context, harness.missionId)).toHaveLength(0);
});

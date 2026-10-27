// 按职责复用原有严格校验，公共入口继续保持兼容。
const { EXECUTION_CANARY_AUTHORITY_QUERY_CONTRACT, EXECUTION_CANARY_KIND, EXECUTION_CANARY_SCHEMA_VERSION, deterministicExecutionArtifactPath, deterministicExecutionArtifactRef, validateExecutionCanary, verifyExecutionCanaryLineage, } = require('./verify-mission-control-production-readiness');
const { EXECUTION_SLOTS, MAX_FUTURE_SKEW_MS, assertCondition, assertFreshTimestamp, cleanIdentifier, isSha256, normalizeSha256, parseJsonArray, parseJsonObject, parseStopConditionCodes, requireRow, stableEqual, timestampMs, validTimestamp } = require('./execution-canary-export-contracts.js');

function readAuthorityRows(database, options) {
    const store = requireRow(database, `
    SELECT store_id AS storeId, browser_profile_id AS browserProfileId,
           marketplace, currency, status
    FROM stores WHERE store_id = ?
  `, [options.storeId], 'Selected store');
    const grant = requireRow(database, `
    SELECT id, store_id AS storeId, marketplace, currency,
           mission_id AS missionId, mission_revision AS missionRevision,
           decision_ids_json AS decisionIdsJson,
           action_revision AS actionRevision,
           allowed_action_types_json AS allowedActionTypesJson,
           allowed_ad_entity_ids_json AS allowedAdEntityIdsJson,
           max_change_pct AS maxChangePct, total_impact_budget AS totalImpactBudget,
           expires_at AS expiresAt, policy_version_id AS policyVersionId,
           policy_revision AS policyRevision, required_evidence_json AS requiredEvidenceJson,
           stop_conditions_json AS stopConditionsJson, issuer_type AS issuerType,
           issued_at AS issuedAt, created_session_generation AS createdSessionGeneration
    FROM mission_grants WHERE store_id = ? AND id = ?
  `, [options.storeId, options.missionGrantId], 'Selected MissionGrant');
    const batch = requireRow(database, `
    SELECT id, store_id AS storeId, marketplace, currency,
           mission_id AS missionId, mission_revision AS missionRevision,
           grant_id AS grantId, action_revision AS actionRevision,
           status, created_session_generation AS createdSessionGeneration,
           created_at AS createdAt, updated_at AS updatedAt,
           terminal_at AS terminalAt
    FROM ad_execution_batches WHERE store_id = ? AND id = ?
  `, [options.storeId, options.batchId], 'Selected execution batch');
    const job = requireRow(database, `
    SELECT id, store_id AS storeId, batch_id AS batchId,
           mission_id AS missionId, grant_id AS grantId,
           proposal_id AS proposalId, decision_id AS decisionId,
           decision_revision AS decisionRevision,
           action_revision AS actionRevision, action_type AS actionType,
           canonical_keyword_id AS canonicalKeywordId,
           ad_entity_id AS adEntityId, entity_revision AS entityRevision,
           ads_account_id AS adsAccountId, campaign_id AS campaignId,
           ad_group_id AS adGroupId, keyword_id AS keywordId,
           object_revision AS objectRevision, page_identity_hash AS pageIdentityHash,
           expected_bid_cents AS expectedBidCents,
           target_bid_cents AS targetBidCents, change_pct AS changePct,
           status, created_session_generation AS createdSessionGeneration,
           created_at AS createdAt, updated_at AS updatedAt,
           submitted_at AS submittedAt,
           terminal_at AS terminalAt
    FROM ad_execution_jobs WHERE store_id = ? AND id = ?
  `, [options.storeId, options.jobId], 'Selected execution job');
    const sourceAuthority = requireRow(database, `
    SELECT authority_id AS authorityId, store_id AS storeId,
           ad_entity_id AS adEntityId, entity_revision AS entityRevision,
           entity_type AS entityType, proof_sha256 AS proofSha256
    FROM verified_ad_entity_authority
    WHERE store_id = ? AND authority_id = ?
  `, [options.storeId, options.authorityId], 'Selected verified ad-entity authority');
    const identity = requireRow(database, `
    SELECT identity_version_id AS identityVersionId, store_id AS storeId,
           marketplace, currency, canonical_keyword_id AS canonicalKeywordId,
           ad_entity_id AS adEntityId, entity_revision AS entityRevision,
           ads_account_id AS adsAccountId, campaign_id AS campaignId,
           ad_group_id AS adGroupId, keyword_id AS keywordId,
           object_revision AS objectRevision, observed_bid_cents AS observedBidCents,
           page_identity_hash AS pageIdentityHash,
           source_authority_id AS sourceAuthorityId,
           source_authority_proof_sha256 AS sourceAuthorityProofSha256,
           resolved_session_generation AS resolvedSessionGeneration,
           resolved_at AS resolvedAt, created_at AS createdAt
    FROM ad_keyword_identity_versions
    WHERE store_id = ? AND canonical_keyword_id = ? AND object_revision = ?
  `, [options.storeId, job.canonicalKeywordId, job.objectRevision], 'Canonical keyword identity');
    const mission = requireRow(database, `
    SELECT id, store_id AS storeId, marketplace, currency,
           policy_version_id AS policyVersionId, status, revision
    FROM missions WHERE store_id = ? AND id = ?
  `, [options.storeId, job.missionId], 'Bound Mission');
    const policy = requireRow(database, `
    SELECT id, store_id AS storeId, status, rules_json AS rulesJson, revision
    FROM policy_versions WHERE store_id = ? AND id = ?
  `, [options.storeId, grant.policyVersionId], 'Bound policy version');
    const runtime = requireRow(database, `
    SELECT store_id AS storeId, autonomy_mode AS autonomyMode,
           kill_switch AS killSwitch, circuit_breaker_state AS circuitBreakerState,
           active_policy_version_id AS activePolicyVersionId
    FROM policy_runtime WHERE store_id = ?
  `, [options.storeId], 'Policy runtime');
    const decision = requireRow(database, `
    SELECT id, store_id AS storeId, mission_id AS missionId,
           policy_version_id AS policyVersionId, policy_revision AS policyRevision,
           action_revision AS actionRevision, action_type AS actionType,
           ad_entity_id AS adEntityId, status, revision, valid_until AS validUntil,
           created_at AS createdAt, updated_at AS updatedAt
    FROM decisions WHERE store_id = ? AND id = ?
  `, [options.storeId, job.decisionId], 'Bound decision');
    const proposal = requireRow(database, `
    SELECT proposal.id, proposal.store_id AS storeId,
           proposal.marketplace, proposal.currency,
           proposal.mission_id AS missionId, proposal.mission_revision AS missionRevision,
           proposal.policy_version_id AS policyVersionId,
           proposal.policy_revision AS policyRevision,
           proposal.action_revision AS actionRevision,
           proposal.action_type AS actionType, proposal.entity_type AS entityType,
           proposal.ad_entity_authority_id AS adEntityAuthorityId,
           proposal.ad_entity_id AS adEntityId,
           proposal.ad_entity_revision AS adEntityRevision,
           proposal.current_bid_cents AS currentBidCents,
           proposal.proposed_bid_cents AS proposedBidCents,
           proposal.change_pct AS changePct,
           proposal.authorization_json AS authorizationJson,
           proposal.valid_until AS validUntil,
           proposal.created_session_generation AS createdSessionGeneration,
           proposal.created_at AS createdAt,
           link.decision_id AS linkedDecisionId
    FROM analysis_proposal_decision_links link
    JOIN analysis_proposal_snapshots proposal
      ON proposal.store_id = link.store_id AND proposal.id = link.proposal_id
    WHERE link.store_id = ? AND link.proposal_id = ? AND link.decision_id = ?
  `, [options.storeId, job.proposalId, job.decisionId], 'Bound proposal/decision link');
    const grantEvents = database.prepare(`
    SELECT event_type AS eventType, created_at AS createdAt
    FROM mission_grant_events
    WHERE store_id = ? AND grant_id = ?
    ORDER BY created_at, id
  `).all(options.storeId, grant.id);
    const decisionApproval = requireRow(database, `
    SELECT decision_id AS decisionId, decision_revision AS decisionRevision,
           event_type AS eventType, created_at AS createdAt
    FROM decision_history
    WHERE store_id = ? AND decision_id = ?
      AND decision_revision = ? AND event_type = 'approved'
  `, [options.storeId, job.decisionId, job.decisionRevision], 'Bound decision approval history');
    const evidence = database.prepare(`
    SELECT id, store_id AS storeId, batch_id AS batchId, job_id AS jobId,
           slot, artifact_ref AS artifactRef, content_sha256 AS contentSha256,
           page_identity_hash AS pageIdentityHash,
           canonical_keyword_id AS canonicalKeywordId,
           object_revision AS objectRevision,
           observed_bid_cents AS observedBidCents,
           captured_session_generation AS capturedSessionGeneration,
           captured_at AS capturedAt, created_at AS createdAt
    FROM ad_execution_evidence
    WHERE store_id = ? AND job_id = ?
    ORDER BY CASE slot WHEN 'before' THEN 1 WHEN 'after' THEN 2 ELSE 3 END
  `).all(options.storeId, job.id);
    const batchJobCount = Number(database.prepare(`
    SELECT COUNT(*) AS count
    FROM ad_execution_jobs WHERE store_id = ? AND batch_id = ?
  `).get(options.storeId, batch.id)?.count);
    return {
        batch,
        batchJobCount,
        decision,
        decisionApproval,
        evidence,
        grant,
        grantEvents,
        identity,
        job,
        mission,
        policy,
        proposal,
        runtime,
        sourceAuthority,
        store,
    };
}

function validateAuthorityRows(rows, options, snapshotExportedAtMs, packageBuiltAtMs, exporterNowMs) {
    const { batch, batchJobCount, decision, decisionApproval, evidence, grant, grantEvents, identity, job, mission, policy, proposal, runtime, sourceAuthority, store, } = rows;
    const expectedIssuer = options.mode === 'manual_approval' ? 'human' : 'policy';
    assertCondition(store.storeId === options.storeId
        && cleanIdentifier(store.browserProfileId, 'Store browserProfileId', { normalized: true })
        && store.marketplace === 'US'
        && store.currency === 'USD'
        && store.status === 'active', 'Selected store/Profile is not active US/USD authority.');
    assertCondition(grant.id === options.missionGrantId
        && grant.storeId === store.storeId
        && grant.marketplace === 'US'
        && grant.currency === 'USD'
        && grant.issuerType === expectedIssuer, `MissionGrant does not belong to ${options.mode} authority.`);
    assertCondition(batch.id === options.batchId
        && batch.storeId === store.storeId
        && batch.grantId === grant.id
        && batch.missionId === grant.missionId
        && batch.missionRevision === grant.missionRevision
        && batch.actionRevision === grant.actionRevision
        && batch.marketplace === 'US'
        && batch.currency === 'USD'
        && batch.status === 'succeeded'
        && validTimestamp(batch.terminalAt), 'Execution batch is not the selected terminal succeeded MissionGrant execution.');
    assertCondition(batchJobCount === 1, 'A production canary batch must contain exactly one execution job.');
    assertCondition(job.id === options.jobId
        && job.storeId === store.storeId
        && job.batchId === batch.id
        && job.grantId === grant.id
        && job.missionId === grant.missionId
        && job.actionRevision === grant.actionRevision
        && job.actionType === 'set_keyword_bid'
        && job.status === 'succeeded'
        && validTimestamp(job.terminalAt), 'Execution job is not the selected terminal succeeded canary action.');
    const signedChangePct = ((job.targetBidCents - job.expectedBidCents) / job.expectedBidCents) * 100;
    assertCondition(Number.isInteger(job.expectedBidCents)
        && Number.isInteger(job.targetBidCents)
        && job.expectedBidCents > 0
        && job.targetBidCents > 0
        && job.targetBidCents < job.expectedBidCents
        && signedChangePct >= -10
        && Math.abs(Number(job.changePct) - signedChangePct) < 0.000001, 'Execution job is not one exact down-bid within the 10% canary boundary.');
    const decisionIds = parseJsonArray(grant.decisionIdsJson, 'MissionGrant decision_ids_json');
    const allowedActions = parseJsonArray(grant.allowedActionTypesJson, 'MissionGrant allowed_action_types_json');
    const allowedEntities = parseJsonArray(grant.allowedAdEntityIdsJson, 'MissionGrant allowed_ad_entity_ids_json');
    assertCondition(stableEqual(decisionIds, [job.decisionId])
        && stableEqual(allowedActions, ['set_keyword_bid'])
        && stableEqual(allowedEntities, [job.adEntityId])
        && Number(grant.maxChangePct) >= Math.abs(signedChangePct)
        && Number(grant.totalImpactBudget) >= Math.abs(job.expectedBidCents - job.targetBidCents) / 100, 'MissionGrant is not an exact single-action canary authority for this job.');
    const requiredEvidence = parseJsonArray(grant.requiredEvidenceJson, 'MissionGrant required_evidence_json');
    for (const required of [
        'before_screenshot',
        'after_screenshot',
        'reload_screenshot',
        'page_identity',
        'readback_value',
    ]) {
        assertCondition(requiredEvidence.includes(required), `MissionGrant does not require ${required}.`);
    }
    const stopConditions = parseStopConditionCodes(grant.stopConditionsJson, 'MissionGrant stop_conditions_json');
    for (const required of [
        'identity_drift',
        'expected_before_mismatch',
        'unknown_result',
        'data_stale',
        'impact_budget_exhausted',
        'kill_switch',
    ]) {
        assertCondition(stopConditions.includes(required), `MissionGrant does not stop on ${required}.`);
    }
    const issuedEvents = grantEvents.filter((event) => event.eventType === 'issued');
    const consumedEvents = grantEvents.filter((event) => event.eventType === 'consumed');
    assertCondition(issuedEvents.length === 1
        && consumedEvents.length === 1
        && !grantEvents.some((event) => ['invalidated', 'revoked', 'expired'].includes(event.eventType))
        && validTimestamp(issuedEvents[0].createdAt)
        && validTimestamp(consumedEvents[0].createdAt)
        && Date.parse(issuedEvents[0].createdAt) < Date.parse(consumedEvents[0].createdAt), 'MissionGrant is not one issued then consumed terminal authority.');
    assertCondition(mission.id === job.missionId
        && mission.storeId === store.storeId
        && mission.marketplace === 'US'
        && mission.currency === 'USD'
        && mission.revision >= grant.missionRevision
        && mission.policyVersionId === grant.policyVersionId
        && ['active', 'completed'].includes(mission.status), 'Mission revision/policy binding does not match the canary execution.');
    const policyRules = parseJsonObject(policy.rulesJson, 'Policy rules');
    assertCondition(policy.id === grant.policyVersionId
        && policy.storeId === store.storeId
        && policy.status === 'enabled'
        && policy.revision === grant.policyRevision
        && policyRules.killSwitch !== true, 'Enabled policy version does not match the immutable MissionGrant policy binding.');
    assertCondition(runtime.storeId === store.storeId
        && ['manual_approval', 'policy_auto'].includes(runtime.autonomyMode)
        && runtime.killSwitch === 0
        && runtime.circuitBreakerState === 'closed'
        && runtime.activePolicyVersionId === policy.id
        && (expectedIssuer !== 'policy' || runtime.autonomyMode === 'policy_auto'), `Policy runtime is not safe and exact for ${options.mode}.`);
    assertCondition(decision.id === job.decisionId
        && decision.storeId === store.storeId
        && decision.missionId === mission.id
        && decision.policyVersionId === policy.id
        && decision.policyRevision === policy.revision
        && decision.actionRevision === grant.actionRevision
        && decision.actionType === 'set_keyword_bid'
        && decision.adEntityId === job.adEntityId
        && decision.revision === job.decisionRevision + 2
        && decision.status === 'verified', 'Decision revision/action/entity/policy binding does not match the execution job.');
    const proposalAuthorization = parseJsonObject(proposal.authorizationJson, 'Proposal authorization');
    const authorizationLane = proposalAuthorization[expectedIssuer];
    assertCondition(proposal.id === job.proposalId
        && proposal.linkedDecisionId === decision.id
        && proposal.storeId === store.storeId
        && proposal.marketplace === 'US'
        && proposal.currency === 'USD'
        && proposal.missionId === mission.id
        && proposal.missionRevision === grant.missionRevision
        && proposal.policyVersionId === policy.id
        && proposal.policyRevision === policy.revision
        && proposal.actionRevision === grant.actionRevision
        && proposal.actionType === 'set_keyword_bid'
        && proposal.entityType === 'keyword'
        && proposal.adEntityAuthorityId === sourceAuthority.authorityId
        && proposal.adEntityId === job.adEntityId
        && proposal.adEntityRevision === job.entityRevision
        && proposal.currentBidCents === job.expectedBidCents
        && proposal.proposedBidCents === job.targetBidCents
        && Math.abs(Number(proposal.changePct) - signedChangePct) < 0.000001
        && proposal.createdSessionGeneration === job.createdSessionGeneration
        && authorizationLane?.eligible === true
        && Array.isArray(authorizationLane.blockers)
        && authorizationLane.blockers.length === 0, 'Immutable proposal/decision/policy authorization binding does not match the execution job.');
    assertCondition(sourceAuthority.authorityId === options.authorityId
        && sourceAuthority.storeId === store.storeId
        && sourceAuthority.adEntityId === job.adEntityId
        && sourceAuthority.entityRevision === job.entityRevision
        && sourceAuthority.entityType === 'keyword'
        && isSha256(sourceAuthority.proofSha256), 'Verified ad-entity authority does not match the selected job.');
    assertCondition(identity.storeId === store.storeId
        && identity.marketplace === 'US'
        && identity.currency === 'USD'
        && identity.canonicalKeywordId === job.canonicalKeywordId
        && identity.adEntityId === job.adEntityId
        && identity.entityRevision === job.entityRevision
        && identity.adsAccountId === job.adsAccountId
        && identity.campaignId === job.campaignId
        && identity.adGroupId === job.adGroupId
        && identity.keywordId === job.keywordId
        && identity.objectRevision === job.objectRevision
        && identity.observedBidCents === job.expectedBidCents
        && normalizeSha256(identity.pageIdentityHash, 'Identity pageIdentityHash')
            === normalizeSha256(job.pageIdentityHash, 'Job pageIdentityHash')
        && identity.sourceAuthorityId === sourceAuthority.authorityId
        && normalizeSha256(identity.sourceAuthorityProofSha256, 'Identity source authority proof')
            === normalizeSha256(sourceAuthority.proofSha256, 'Authority proof'), 'Canonical keyword identity does not match the job and verified authority.');
    const authorityGeneration = job.createdSessionGeneration;
    assertCondition(Number.isInteger(authorityGeneration)
        && authorityGeneration > 0
        && batch.createdSessionGeneration === authorityGeneration
        && grant.createdSessionGeneration === authorityGeneration
        && proposal.createdSessionGeneration === authorityGeneration
        && identity.resolvedSessionGeneration === authorityGeneration, 'Job, batch, MissionGrant, proposal, and canonical identity session generations do not match exactly.');
    assertCondition(evidence.length === 3
        && new Set(evidence.map((record) => record.slot)).size === 3
        && EXECUTION_SLOTS.every((slot) => evidence.some((record) => record.slot === slot)), 'Authority DB must contain exactly before/after/reload evidence for the selected job.');
    const bySlot = new Map(evidence.map((record) => [record.slot, record]));
    const sessionGenerations = new Set();
    const artifactRefs = new Set();
    const contentHashes = new Set();
    for (const slot of EXECUTION_SLOTS) {
        const record = bySlot.get(slot);
        assertCondition(record.storeId === store.storeId
            && record.batchId === batch.id
            && record.jobId === job.id
            && record.canonicalKeywordId === job.canonicalKeywordId
            && record.objectRevision === job.objectRevision
            && normalizeSha256(record.pageIdentityHash, `${slot} pageIdentityHash`)
                === normalizeSha256(job.pageIdentityHash, 'Job pageIdentityHash')
            && record.artifactRef === deterministicExecutionArtifactRef(store.storeId, batch.id, job.id, slot)
            && isSha256(record.contentSha256)
            && Number.isInteger(record.capturedSessionGeneration)
            && record.capturedSessionGeneration === authorityGeneration
            && validTimestamp(record.capturedAt)
            && validTimestamp(record.createdAt)
            && Date.parse(record.createdAt) >= Date.parse(record.capturedAt), `${slot} authority evidence is not an exact job/object/session record.`);
        sessionGenerations.add(record.capturedSessionGeneration);
        artifactRefs.add(record.artifactRef);
        contentHashes.add(normalizeSha256(record.contentSha256, `${slot} content SHA`));
    }
    assertCondition(sessionGenerations.size === 1 && artifactRefs.size === 3 && contentHashes.size === 3, 'Before/after/reload must be distinct artifacts from one session generation.');
    const before = bySlot.get('before');
    const after = bySlot.get('after');
    const reload = bySlot.get('reload');
    assertCondition(before.observedBidCents === job.expectedBidCents
        && after.observedBidCents === job.targetBidCents
        && reload.observedBidCents === job.targetBidCents, 'Before/after/reload bid values do not prove the exact requested change and reload persistence.');
    assertCondition(Date.parse(before.capturedAt) < Date.parse(after.capturedAt)
        && Date.parse(after.capturedAt) < Date.parse(reload.capturedAt), 'Before/after/reload capture timestamps are not strictly ordered.');
    const latestEvidenceMs = Math.max(...evidence.flatMap((record) => [Date.parse(record.capturedAt), Date.parse(record.createdAt)]));
    const identityResolvedAtMs = assertFreshTimestamp(identity.resolvedAt, 'Canonical identity resolvedAt', exporterNowMs);
    const identityCreatedAtMs = assertFreshTimestamp(identity.createdAt, 'Canonical identity createdAt', exporterNowMs);
    const proposalCreatedAtMs = assertFreshTimestamp(proposal.createdAt, 'Immutable proposal createdAt', exporterNowMs);
    const decisionCreatedAtMs = assertFreshTimestamp(decision.createdAt, 'Decision createdAt', exporterNowMs);
    const decisionUpdatedAtMs = assertFreshTimestamp(decision.updatedAt, 'Decision updatedAt', exporterNowMs);
    const decisionApprovedAtMs = assertFreshTimestamp(decisionApproval.createdAt, 'Decision approval timestamp', exporterNowMs);
    const grantIssuedAtMs = assertFreshTimestamp(grant.issuedAt, 'MissionGrant issuedAt', exporterNowMs);
    const issuedEventAtMs = assertFreshTimestamp(issuedEvents[0].createdAt, 'MissionGrant issued event timestamp', exporterNowMs);
    const jobCreatedAtMs = assertFreshTimestamp(job.createdAt, 'Execution job createdAt', exporterNowMs);
    const batchCreatedAtMs = assertFreshTimestamp(batch.createdAt, 'Execution batch createdAt', exporterNowMs);
    const submittedAtMs = assertFreshTimestamp(job.submittedAt, 'Execution job submittedAt', exporterNowMs);
    const jobTerminalAtMs = assertFreshTimestamp(job.terminalAt, 'Execution job terminalAt', exporterNowMs);
    const batchTerminalAtMs = assertFreshTimestamp(batch.terminalAt, 'Execution batch terminalAt', exporterNowMs);
    const jobUpdatedAtMs = assertFreshTimestamp(job.updatedAt, 'Execution job updatedAt', exporterNowMs);
    const batchUpdatedAtMs = assertFreshTimestamp(batch.updatedAt, 'Execution batch updatedAt', exporterNowMs);
    const consumedAtMs = assertFreshTimestamp(consumedEvents[0].createdAt, 'MissionGrant consumed event timestamp', exporterNowMs);
    for (const record of evidence) {
        assertFreshTimestamp(record.capturedAt, `${record.slot} evidence capturedAt`, exporterNowMs);
        assertFreshTimestamp(record.createdAt, `${record.slot} evidence createdAt`, exporterNowMs);
    }
    const beforeCapturedAtMs = Date.parse(before.capturedAt);
    const afterCapturedAtMs = Date.parse(after.capturedAt);
    const reloadCapturedAtMs = Date.parse(reload.capturedAt);
    const beforeCreatedAtMs = Date.parse(before.createdAt);
    const afterCreatedAtMs = Date.parse(after.createdAt);
    assertCondition(identityResolvedAtMs >= packageBuiltAtMs
        && identityResolvedAtMs <= identityCreatedAtMs
        && identityCreatedAtMs <= jobCreatedAtMs
        && proposalCreatedAtMs <= decisionCreatedAtMs
        && decisionCreatedAtMs <= decisionApprovedAtMs
        && decisionApprovedAtMs <= decisionUpdatedAtMs
        && decisionApprovedAtMs <= grantIssuedAtMs
        && grantIssuedAtMs === issuedEventAtMs
        && Math.max(grantIssuedAtMs, identityResolvedAtMs) <= jobCreatedAtMs
        && batchCreatedAtMs <= jobCreatedAtMs
        && jobCreatedAtMs <= beforeCapturedAtMs
        && beforeCreatedAtMs <= submittedAtMs
        && submittedAtMs < afterCapturedAtMs
        && afterCreatedAtMs <= reloadCapturedAtMs
        && afterCapturedAtMs < reloadCapturedAtMs
        && latestEvidenceMs <= jobTerminalAtMs
        && jobTerminalAtMs <= jobUpdatedAtMs
        && jobTerminalAtMs <= batchTerminalAtMs
        && batchTerminalAtMs <= batchUpdatedAtMs
        && submittedAtMs <= consumedAtMs
        && consumedAtMs <= afterCapturedAtMs
        && Math.max(jobUpdatedAtMs, batchUpdatedAtMs) <= snapshotExportedAtMs
        && consumedAtMs <= snapshotExportedAtMs
        && decisionUpdatedAtMs <= snapshotExportedAtMs
        && snapshotExportedAtMs <= exporterNowMs + MAX_FUTURE_SKEW_MS
        && timestampMs(grant.expiresAt, 'MissionGrant expiresAt') > submittedAtMs
        && (!decision.validUntil
            || timestampMs(decision.validUntil, 'Decision validUntil') > submittedAtMs)
        && timestampMs(proposal.validUntil, 'Proposal validUntil') > submittedAtMs, 'Package/identity/proposal/decision/grant/job/capture/terminal/snapshot timestamps are stale or not causally closed.');
}

module.exports = { readAuthorityRows, validateAuthorityRows };

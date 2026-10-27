// 按职责复用原有严格校验，公共入口继续保持兼容。

const { exactDatabaseRow, parseJsonArray, parseJsonObject, parseStopConditionCodes, validateExecutionArtifact, verifyExecutionCanaryLineage } = require('./mission-control-production-canary-artifacts.js');
const { MAX_CANARY_EVIDENCE_AGE_MS, MAX_FUTURE_SKEW_MS, isPositiveInteger, normalizeSha256, pushReason, stableEqual, uniqueExactStrings, validTimestamp } = require('./mission-control-production-contracts.js');

function validateCanaryAuthorityDatabase(database, evidence, expectedMode, label, reasons, context = {}) {
    const scope = evidence.scope;
    const authority = evidence.authority;
    const object = evidence.object;
    reasons.push(...verifyExecutionCanaryLineage(database, {
        storeId: scope?.storeId, missionGrantId: authority?.missionGrantId,
        batchId: authority?.batchId, jobId: authority?.jobId, mode: expectedMode,
    }).reasons);
    const records = Array.isArray(evidence.execution?.evidence) ? evidence.execution.evidence : [];
    const bySlot = new Map(records.map((item) => [item?.slot, item]));
    const proof = evidence.database?.authorityProof;
    const recordIdentity = proof?.recordIdentity;
    const expectedIssuer = expectedMode === 'manual_approval' ? 'human' : 'policy';
    const verifiedPngArtifacts = [];
    const store = exactDatabaseRow(database, `
    SELECT store_id AS storeId, browser_profile_id AS browserProfileId,
           marketplace, currency, status
    FROM stores WHERE store_id = ? OR browser_profile_id = ?
  `, [scope?.storeId, scope?.browserProfileId], `${label} store/Profile`, reasons);
    pushReason(reasons, store?.storeId === scope?.storeId
        && store?.browserProfileId === scope?.browserProfileId
        && store?.marketplace === 'US'
        && store?.currency === 'USD'
        && store?.status === 'active', `${label} store/Profile is not active US/USD authority in the database`);
    const sourceAuthority = exactDatabaseRow(database, `
    SELECT authority_id AS authorityId, store_id AS storeId,
           ad_entity_id AS adEntityId, entity_revision AS entityRevision,
           entity_type AS entityType, proof_sha256 AS proofSha256
    FROM verified_ad_entity_authority
    WHERE store_id = ? AND authority_id = ?
  `, [scope?.storeId, authority?.authorityId], `${label} verified ad-entity authority`, reasons);
    pushReason(reasons, sourceAuthority?.authorityId === authority?.authorityId
        && sourceAuthority?.storeId === scope?.storeId
        && sourceAuthority?.adEntityId === object?.adEntityId
        && sourceAuthority?.entityRevision === object?.entityRevision
        && sourceAuthority?.entityType === 'keyword'
        && normalizeSha256(sourceAuthority?.proofSha256) === normalizeSha256(object?.sourceAuthorityProofSha256), `${label} verified ad-entity authority row does not match the canary object`);
    const identity = exactDatabaseRow(database, `
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
  `, [
        scope?.storeId,
        object?.canonicalKeywordId,
        object?.objectRevision,
    ], `${label} canonical keyword identity`, reasons);
    pushReason(reasons, identity?.identityVersionId === object?.identityVersionId
        && identity?.storeId === scope?.storeId
        && identity?.marketplace === 'US'
        && identity?.currency === 'USD'
        && identity?.canonicalKeywordId === object?.canonicalKeywordId
        && identity?.adEntityId === object?.adEntityId
        && identity?.entityRevision === object?.entityRevision
        && identity?.adsAccountId === object?.adsAccountId
        && identity?.campaignId === object?.campaignId
        && identity?.adGroupId === object?.adGroupId
        && identity?.keywordId === object?.keywordId
        && identity?.objectRevision === object?.objectRevision
        && identity?.observedBidCents === object?.expectedBidCents
        && normalizeSha256(identity?.pageIdentityHash) === normalizeSha256(object?.pageIdentityHash)
        && identity?.sourceAuthorityId === authority?.authorityId
        && normalizeSha256(identity?.sourceAuthorityProofSha256) === normalizeSha256(object?.sourceAuthorityProofSha256), `${label} canonical keyword identity row does not match the canary object/authority`);
    const grant = exactDatabaseRow(database, `
    SELECT id, store_id AS storeId, marketplace, currency,
           mission_id AS missionId, mission_revision AS missionRevision,
           decision_ids_json AS decisionIdsJson,
           action_revision AS actionRevision,
           allowed_action_types_json AS allowedActionTypesJson,
           allowed_ad_entity_ids_json AS allowedAdEntityIdsJson,
           max_change_pct AS maxChangePct, total_impact_budget AS totalImpactBudget,
           expires_at AS expiresAt,
           policy_version_id AS policyVersionId, policy_revision AS policyRevision,
           required_evidence_json AS requiredEvidenceJson,
           stop_conditions_json AS stopConditionsJson,
           issuer_type AS issuerType, issued_at AS issuedAt,
           created_session_generation AS createdSessionGeneration
    FROM mission_grants WHERE store_id = ? AND id = ?
  `, [scope?.storeId, authority?.missionGrantId], `${label} MissionGrant`, reasons);
    const decisionIds = parseJsonArray(grant?.decisionIdsJson);
    const allowedActions = parseJsonArray(grant?.allowedActionTypesJson);
    const allowedEntities = parseJsonArray(grant?.allowedAdEntityIdsJson);
    const requiredEvidence = parseJsonArray(grant?.requiredEvidenceJson);
    const stopConditions = parseStopConditionCodes(grant?.stopConditionsJson);
    const changePct = Number.isInteger(object?.expectedBidCents) && object.expectedBidCents > 0
        ? ((object.expectedBidCents - object.targetBidCents) / object.expectedBidCents) * 100
        : Number.POSITIVE_INFINITY;
    pushReason(reasons, grant?.id === authority?.missionGrantId
        && grant?.storeId === scope?.storeId
        && grant?.marketplace === 'US'
        && grant?.currency === 'USD'
        && grant?.missionId === authority?.missionId
        && grant?.missionRevision === authority?.missionRevision
        && grant?.actionRevision === authority?.actionRevision
        && grant?.policyVersionId === authority?.policyVersionId
        && grant?.policyRevision === authority?.policyRevision
        && grant?.issuerType === expectedIssuer
        && stableEqual(decisionIds, [authority?.decisionId])
        && stableEqual(allowedActions, ['set_keyword_bid'])
        && stableEqual(allowedEntities, [object?.adEntityId])
        && Number(grant?.maxChangePct) >= changePct
        && Number(grant?.totalImpactBudget) >= Math.abs(object?.expectedBidCents - object?.targetBidCents) / 100
        && ['before_screenshot', 'after_screenshot', 'reload_screenshot', 'page_identity', 'readback_value']
            .every((item) => requiredEvidence?.includes(item))
        && ['identity_drift', 'expected_before_mismatch', 'unknown_result', 'data_stale', 'impact_budget_exhausted', 'kill_switch']
            .every((item) => stopConditions?.includes(item))
        && validTimestamp(grant?.issuedAt)
        && validTimestamp(grant?.expiresAt), `${label} MissionGrant issuer/policy/scope does not authorize this exact execution`);
    const grantEvents = database.prepare(`
    SELECT event_type AS eventType, created_at AS createdAt FROM mission_grant_events
    WHERE store_id = ? AND grant_id = ? ORDER BY created_at, id
  `).all(scope?.storeId, authority?.missionGrantId);
    const issuedEvents = grantEvents.filter((event) => event.eventType === 'issued');
    const consumedEvents = grantEvents.filter((event) => event.eventType === 'consumed');
    pushReason(reasons, issuedEvents.length === 1
        && consumedEvents.length === 1
        && issuedEvents[0].createdAt === grant?.issuedAt
        && validTimestamp(issuedEvents[0].createdAt)
        && validTimestamp(consumedEvents[0].createdAt)
        && Date.parse(issuedEvents[0].createdAt) < Date.parse(consumedEvents[0].createdAt)
        && !grantEvents.some((event) => ['invalidated', 'revoked', 'expired'].includes(event.eventType)), `${label} MissionGrant is not one exact issued then consumed terminal authority`);
    const batch = exactDatabaseRow(database, `
    SELECT id, store_id AS storeId, marketplace, currency,
           mission_id AS missionId, mission_revision AS missionRevision,
           grant_id AS grantId, action_revision AS actionRevision,
           status, created_session_generation AS createdSessionGeneration,
           created_at AS createdAt, updated_at AS updatedAt,
           terminal_at AS terminalAt
    FROM ad_execution_batches WHERE store_id = ? AND id = ?
  `, [scope?.storeId, authority?.batchId], `${label} execution batch`, reasons);
    pushReason(reasons, batch?.id === authority?.batchId
        && batch?.storeId === scope?.storeId
        && batch?.marketplace === 'US'
        && batch?.currency === 'USD'
        && batch?.missionId === authority?.missionId
        && batch?.missionRevision === authority?.missionRevision
        && batch?.grantId === authority?.missionGrantId
        && batch?.actionRevision === authority?.actionRevision
        && batch?.status === 'succeeded'
        && validTimestamp(batch?.terminalAt), `${label} authority DB batch is not this terminal succeeded execution`);
    const job = exactDatabaseRow(database, `
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
           submitted_at AS submittedAt, terminal_at AS terminalAt
    FROM ad_execution_jobs WHERE store_id = ? AND batch_id = ?
  `, [scope?.storeId, authority?.batchId], `${label} single execution job`, reasons);
    const expectedSignedChangePct = Number.isFinite(changePct) ? -changePct : Number.NaN;
    pushReason(reasons, job?.id === authority?.jobId
        && job?.storeId === scope?.storeId
        && job?.batchId === authority?.batchId
        && job?.missionId === authority?.missionId
        && job?.grantId === authority?.missionGrantId
        && job?.proposalId === authority?.proposalId
        && job?.decisionId === authority?.decisionId
        && job?.decisionRevision === authority?.decisionRevision
        && job?.actionRevision === authority?.actionRevision
        && job?.actionType === 'set_keyword_bid'
        && job?.canonicalKeywordId === object?.canonicalKeywordId
        && job?.adEntityId === object?.adEntityId
        && job?.entityRevision === object?.entityRevision
        && job?.adsAccountId === object?.adsAccountId
        && job?.campaignId === object?.campaignId
        && job?.adGroupId === object?.adGroupId
        && job?.keywordId === object?.keywordId
        && job?.objectRevision === object?.objectRevision
        && normalizeSha256(job?.pageIdentityHash) === normalizeSha256(object?.pageIdentityHash)
        && job?.expectedBidCents === object?.expectedBidCents
        && job?.targetBidCents === object?.targetBidCents
        && Number.isFinite(Number(job?.changePct))
        && Math.abs(Number(job.changePct) - expectedSignedChangePct) < 0.000001
        && job?.status === 'succeeded'
        && validTimestamp(job?.terminalAt), `${label} authority DB job/object is not this terminal succeeded execution`);
    const mission = exactDatabaseRow(database, `
    SELECT id, store_id AS storeId, marketplace, currency,
           policy_version_id AS policyVersionId, status, revision
    FROM missions WHERE store_id = ? AND id = ?
  `, [scope?.storeId, authority?.missionId], `${label} Mission`, reasons);
    pushReason(reasons, mission?.id === authority?.missionId
        && mission?.storeId === scope?.storeId
        && mission?.marketplace === 'US'
        && mission?.currency === 'USD'
        && mission?.policyVersionId === authority?.policyVersionId
        && mission?.revision >= authority?.missionRevision
        && ['active', 'completed'].includes(mission?.status), `${label} Mission revision/policy binding does not match the execution`);
    const policy = exactDatabaseRow(database, `
    SELECT id, store_id AS storeId, status, rules_json AS rulesJson, revision
    FROM policy_versions WHERE store_id = ? AND id = ?
  `, [scope?.storeId, authority?.policyVersionId], `${label} immutable policy version`, reasons);
    const policyRules = parseJsonObject(policy?.rulesJson);
    pushReason(reasons, policy?.id === authority?.policyVersionId
        && policy?.storeId === scope?.storeId
        && policy?.status === 'enabled'
        && policy?.revision === authority?.policyRevision
        && policyRules?.killSwitch !== true, `${label} enabled policy version is not the immutable MissionGrant policy`);
    const runtime = exactDatabaseRow(database, `
    SELECT store_id AS storeId, autonomy_mode AS autonomyMode,
           kill_switch AS killSwitch, circuit_breaker_state AS circuitBreakerState,
           active_policy_version_id AS activePolicyVersionId
    FROM policy_runtime WHERE store_id = ?
  `, [scope?.storeId], `${label} policy runtime`, reasons);
    pushReason(reasons, runtime?.storeId === scope?.storeId
        && ['manual_approval', 'policy_auto'].includes(runtime?.autonomyMode)
        && runtime?.killSwitch === 0
        && runtime?.circuitBreakerState === 'closed'
        && runtime?.activePolicyVersionId === authority?.policyVersionId
        && (expectedIssuer !== 'policy' || runtime?.autonomyMode === 'policy_auto'), `${label} policy runtime is not enabled, safe, and exact for the issuer`);
    const decision = exactDatabaseRow(database, `
    SELECT id, store_id AS storeId, mission_id AS missionId,
           policy_version_id AS policyVersionId, policy_revision AS policyRevision,
           action_revision AS actionRevision, action_type AS actionType,
           ad_entity_id AS adEntityId, status, revision, valid_until AS validUntil,
           created_at AS createdAt, updated_at AS updatedAt
    FROM decisions WHERE store_id = ? AND id = ?
  `, [scope?.storeId, authority?.decisionId], `${label} decision`, reasons);
    pushReason(reasons, decision?.id === authority?.decisionId
        && decision?.storeId === scope?.storeId
        && decision?.missionId === authority?.missionId
        && decision?.policyVersionId === authority?.policyVersionId
        && decision?.policyRevision === authority?.policyRevision
        && decision?.actionRevision === authority?.actionRevision
        && decision?.actionType === 'set_keyword_bid'
        && decision?.adEntityId === object?.adEntityId
        && decision?.revision === authority?.decisionRevision + 2
        && decision?.status === 'verified', `${label} decision revision/action/entity/policy binding is not exact`);
    const decisionApproval = exactDatabaseRow(database, `
    SELECT decision_id AS decisionId, decision_revision AS decisionRevision,
           event_type AS eventType, created_at AS createdAt
    FROM decision_history
    WHERE store_id = ? AND decision_id = ?
      AND decision_revision = ? AND event_type = 'approved'
  `, [
        scope?.storeId,
        authority?.decisionId,
        authority?.decisionRevision,
    ], `${label} decision approval history`, reasons);
    pushReason(reasons, decisionApproval?.decisionId === authority?.decisionId
        && decisionApproval?.decisionRevision === authority?.decisionRevision
        && decisionApproval?.eventType === 'approved'
        && validTimestamp(decisionApproval?.createdAt), `${label} decision approval history is missing, duplicated, or not exact`);
    const proposal = exactDatabaseRow(database, `
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
  `, [
        scope?.storeId,
        authority?.proposalId,
        authority?.decisionId,
    ], `${label} proposal/decision link`, reasons);
    const proposalAuthorization = parseJsonObject(proposal?.authorizationJson);
    const authorizationLane = proposalAuthorization?.[expectedIssuer];
    pushReason(reasons, proposal?.id === authority?.proposalId
        && proposal?.linkedDecisionId === authority?.decisionId
        && proposal?.storeId === scope?.storeId
        && proposal?.marketplace === 'US'
        && proposal?.currency === 'USD'
        && proposal?.missionId === authority?.missionId
        && proposal?.missionRevision === authority?.missionRevision
        && proposal?.policyVersionId === authority?.policyVersionId
        && proposal?.policyRevision === authority?.policyRevision
        && proposal?.actionRevision === authority?.actionRevision
        && proposal?.actionType === 'set_keyword_bid'
        && proposal?.entityType === 'keyword'
        && proposal?.adEntityAuthorityId === authority?.authorityId
        && proposal?.adEntityId === object?.adEntityId
        && proposal?.adEntityRevision === object?.entityRevision
        && proposal?.currentBidCents === object?.expectedBidCents
        && proposal?.proposedBidCents === object?.targetBidCents
        && Math.abs(Number(proposal?.changePct) - expectedSignedChangePct) < 0.000001
        && authorizationLane?.eligible === true
        && Array.isArray(authorizationLane?.blockers)
        && authorizationLane.blockers.length === 0, `${label} immutable proposal/action/decision/policy authorization binding is not exact`);
    const capturedSessionGenerations = new Set(records.map((record) => record?.capturedSessionGeneration));
    const capturedSessionGeneration = capturedSessionGenerations.size === 1
        ? [...capturedSessionGenerations][0]
        : null;
    pushReason(reasons, isPositiveInteger(capturedSessionGeneration)
        && identity?.resolvedSessionGeneration === capturedSessionGeneration
        && grant?.createdSessionGeneration === capturedSessionGeneration
        && batch?.createdSessionGeneration === capturedSessionGeneration
        && job?.createdSessionGeneration === capturedSessionGeneration
        && proposal?.createdSessionGeneration === capturedSessionGeneration, `${label} job/grant/batch/proposal/identity session generation is not bound to capturedSessionGeneration`);
    const snapshotExportedAtMs = Date.parse(context.authoritySnapshotExportedAt);
    const queryExecutedAtMs = Date.parse(evidence.database?.authorityProof?.queryExecutedAt);
    const generatedAtMs = Date.parse(evidence.generatedAt);
    const nowMs = Number(context.nowMs);
    const identityResolvedAtMs = Date.parse(identity?.resolvedAt);
    const identityCreatedAtMs = Date.parse(identity?.createdAt);
    const proposalCreatedAtMs = Date.parse(proposal?.createdAt);
    const decisionCreatedAtMs = Date.parse(decision?.createdAt);
    const decisionApprovedAtMs = Date.parse(decisionApproval?.createdAt);
    const decisionUpdatedAtMs = Date.parse(decision?.updatedAt);
    const issuedAtMs = Date.parse(grant?.issuedAt);
    const issuedEventAtMs = Date.parse(issuedEvents[0]?.createdAt);
    const consumedAtMs = Date.parse(consumedEvents[0]?.createdAt);
    const batchCreatedAtMs = Date.parse(batch?.createdAt);
    const batchUpdatedAtMs = Date.parse(batch?.updatedAt);
    const jobCreatedAtMs = Date.parse(job?.createdAt);
    const jobSubmittedAtMs = Date.parse(job?.submittedAt);
    const jobUpdatedAtMs = Date.parse(job?.updatedAt);
    const recordTimes = records.flatMap((record) => [Date.parse(record?.capturedAt), Date.parse(record?.createdAt)]);
    const beforeCapturedAtMs = Date.parse(bySlot.get('before')?.capturedAt);
    const beforeCreatedAtMs = Date.parse(bySlot.get('before')?.createdAt);
    const afterCapturedAtMs = Date.parse(bySlot.get('after')?.capturedAt);
    const afterCreatedAtMs = Date.parse(bySlot.get('after')?.createdAt);
    const reloadCapturedAtMs = Date.parse(bySlot.get('reload')?.capturedAt);
    const latestRecordAtMs = Math.max(...recordTimes);
    const batchTerminalAtMs = Date.parse(batch?.terminalAt);
    const jobTerminalAtMs = Date.parse(job?.terminalAt);
    const terminalTimes = [batchTerminalAtMs, jobTerminalAtMs];
    const terminalAtMs = Math.max(...terminalTimes);
    const executionFreshnessFloorMs = nowMs - MAX_CANARY_EVIDENCE_AGE_MS;
    const executionTimes = [
        identityResolvedAtMs,
        identityCreatedAtMs,
        proposalCreatedAtMs,
        decisionCreatedAtMs,
        decisionApprovedAtMs,
        decisionUpdatedAtMs,
        issuedAtMs,
        issuedEventAtMs,
        batchCreatedAtMs,
        batchUpdatedAtMs,
        jobCreatedAtMs,
        jobSubmittedAtMs,
        jobUpdatedAtMs,
        ...recordTimes,
        ...terminalTimes,
        consumedAtMs,
    ];
    const publicationTimes = [snapshotExportedAtMs, queryExecutedAtMs, generatedAtMs];
    pushReason(reasons, executionTimes.every((value) => Number.isFinite(value)
        && value >= context.packageBuiltAtMs
        && value >= executionFreshnessFloorMs
        && value <= nowMs + MAX_FUTURE_SKEW_MS)
        && publicationTimes.every((value) => Number.isFinite(value)
            && value <= nowMs + MAX_FUTURE_SKEW_MS)
        && records.every((record) => Date.parse(record?.createdAt) >= Date.parse(record?.capturedAt))
        && identityResolvedAtMs <= identityCreatedAtMs
        && identityCreatedAtMs <= jobCreatedAtMs
        && proposalCreatedAtMs <= decisionCreatedAtMs
        && decisionCreatedAtMs <= decisionApprovedAtMs
        && decisionApprovedAtMs <= decisionUpdatedAtMs
        && decisionApprovedAtMs <= issuedAtMs
        && issuedAtMs === issuedEventAtMs
        && Math.max(issuedAtMs, identityResolvedAtMs) <= jobCreatedAtMs
        && batchCreatedAtMs <= jobCreatedAtMs
        && jobCreatedAtMs <= beforeCapturedAtMs
        && beforeCreatedAtMs <= jobSubmittedAtMs
        && jobSubmittedAtMs < afterCapturedAtMs
        && afterCreatedAtMs <= reloadCapturedAtMs
        && latestRecordAtMs <= jobTerminalAtMs
        && jobTerminalAtMs <= jobUpdatedAtMs
        && jobTerminalAtMs <= batchTerminalAtMs
        && batchTerminalAtMs <= batchUpdatedAtMs
        && jobSubmittedAtMs <= consumedAtMs
        && consumedAtMs <= afterCapturedAtMs
        && Math.max(jobUpdatedAtMs, batchUpdatedAtMs) <= snapshotExportedAtMs
        && snapshotExportedAtMs >= consumedAtMs
        && decisionUpdatedAtMs <= snapshotExportedAtMs
        && queryExecutedAtMs >= snapshotExportedAtMs
        && queryExecutedAtMs >= terminalAtMs
        && generatedAtMs >= queryExecutedAtMs
        && Date.parse(grant?.expiresAt) > jobSubmittedAtMs
        && (!decision?.validUntil || Date.parse(decision.validUntil) > jobSubmittedAtMs)
        && Date.parse(proposal?.validUntil) > jobSubmittedAtMs, `${label} authorization/captured/terminal/snapshot/query/generated timestamps are stale, replayed, or out of order`);
    const databaseEvidence = database.prepare(`
    SELECT id, store_id AS storeId, batch_id AS batchId, job_id AS jobId,
           slot, artifact_ref AS artifactRef, content_sha256 AS contentSha256,
           page_identity_hash AS pageIdentityHash,
           canonical_keyword_id AS canonicalKeywordId,
           object_revision AS objectRevision,
           observed_bid_cents AS observedBidCents,
           captured_session_generation AS capturedSessionGeneration,
           captured_at AS capturedAt, created_at AS createdAt
    FROM ad_execution_evidence WHERE store_id = ? AND job_id = ?
    ORDER BY CASE slot WHEN 'before' THEN 1 WHEN 'after' THEN 2 ELSE 3 END
  `).all(scope?.storeId, authority?.jobId);
    pushReason(reasons, uniqueExactStrings(databaseEvidence.map((item) => item.slot), ['before', 'after', 'reload']), `${label} authority DB does not contain exactly before/after/reload records`);
    const databaseBySlot = new Map(databaseEvidence.map((item) => [item.slot, item]));
    for (const slot of ['before', 'after', 'reload']) {
        const record = bySlot.get(slot);
        const databaseRecord = databaseBySlot.get(slot);
        pushReason(reasons, databaseRecord?.id === record?.id
            && databaseRecord?.storeId === record?.storeId
            && databaseRecord?.batchId === record?.batchId
            && databaseRecord?.jobId === record?.jobId
            && databaseRecord?.slot === record?.slot
            && databaseRecord?.artifactRef === record?.artifactRef
            && normalizeSha256(databaseRecord?.contentSha256) === normalizeSha256(record?.contentSha256)
            && normalizeSha256(databaseRecord?.pageIdentityHash) === normalizeSha256(record?.pageIdentityHash)
            && databaseRecord?.canonicalKeywordId === record?.canonicalKeywordId
            && databaseRecord?.objectRevision === record?.objectRevision
            && databaseRecord?.observedBidCents === record?.observedBidCents
            && databaseRecord?.capturedSessionGeneration === record?.capturedSessionGeneration
            && databaseRecord?.capturedAt === record?.capturedAt
            && databaseRecord?.createdAt === record?.createdAt, `${label} ${slot} JSON evidence does not match the authority DB record`);
        const verifiedPngArtifact = validateExecutionArtifact(record, databaseRecord, {
            storesRoot: context.canonicalStoresRoot,
            storeId: store?.storeId,
            batchId: batch?.id,
            jobId: job?.id,
        }, label, slot, reasons);
        if (verifiedPngArtifact)
            verifiedPngArtifacts.push(verifiedPngArtifact);
    }
    pushReason(reasons, recordIdentity?.storeId === store?.storeId
        && recordIdentity?.browserProfileId === store?.browserProfileId
        && recordIdentity?.authorityId === sourceAuthority?.authorityId
        && recordIdentity?.identityVersionId === identity?.identityVersionId
        && recordIdentity?.missionGrantId === grant?.id
        && recordIdentity?.batchId === batch?.id
        && recordIdentity?.jobId === job?.id
        && recordIdentity?.canonicalKeywordId === identity?.canonicalKeywordId
        && recordIdentity?.objectRevision === identity?.objectRevision
        && uniqueExactStrings(recordIdentity?.evidenceIds, databaseEvidence.map((item) => item.id)), `${label} authorityProof recordIdentity does not match the queried DB record set`);
    return Object.freeze(verifiedPngArtifacts);
}

module.exports = { validateCanaryAuthorityDatabase };

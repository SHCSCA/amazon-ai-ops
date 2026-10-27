// 按职责复用原有严格校验，公共入口继续保持兼容。
const fs = require('node:fs');
const path = require('node:path');
const { validateCanaryAuthorityDatabase } = require('./mission-control-production-canary-authority.js');
const { EXECUTION_CANARY_AUTHORITY_QUERY_CONTRACT, EXECUTION_CANARY_KIND, EXECUTION_CANARY_SCHEMA_VERSION, isPositiveInteger, isRecord, isSha256, nonEmpty, normalizeLogicalId, normalizeSha256, pushReason, realpathEquals, requestedPathEqualsRealpath, samePath, uniqueExactStrings, validTimestamp, validationResult, withVerifiedReadOnlyDatabase } = require('./mission-control-production-contracts.js');

function validateExecutionCanary(evidence, expectedMode, context = {}) {
    const reasons = [];
    const label = expectedMode === 'manual_approval' ? 'manual canary' : 'policy-auto canary';
    pushReason(reasons, isRecord(evidence), `${label} evidence must be an object`);
    if (!isRecord(evidence))
        return validationResult(reasons);
    pushReason(reasons, evidence.kind === EXECUTION_CANARY_KIND, `${label} kind is invalid`);
    pushReason(reasons, evidence.schemaVersion === EXECUTION_CANARY_SCHEMA_VERSION, `${label} schema version is invalid`);
    pushReason(reasons, validTimestamp(evidence.generatedAt), `${label} generatedAt is invalid`);
    pushReason(reasons, evidence.passed === true && evidence.status === 'PASSED', `${label} did not pass`);
    pushReason(reasons, evidence.mode === expectedMode, `${label} mode must be ${expectedMode}`);
    const scope = evidence.scope;
    pushReason(reasons, nonEmpty(scope?.storeId) && nonEmpty(scope?.browserProfileId), `${label} store/Profile scope binding is incomplete`);
    pushReason(reasons, scope?.marketplace === 'US' && scope?.currency === 'USD', `${label} must be US/USD`);
    const authority = evidence.authority;
    const expectedIssuer = expectedMode === 'manual_approval' ? 'human' : 'policy';
    pushReason(reasons, authority?.storeId === scope?.storeId && authority?.browserProfileId === scope?.browserProfileId, `${label} authority is not bound to the same store/Profile`);
    pushReason(reasons, authority?.issuerType === expectedIssuer, `${label} authority issuer must be ${expectedIssuer}`);
    for (const field of ['authorityId', 'missionId', 'missionGrantId', 'batchId', 'jobId', 'proposalId', 'decisionId']) {
        pushReason(reasons, nonEmpty(authority?.[field]), `${label} authority.${field} is missing`);
    }
    pushReason(reasons, isPositiveInteger(authority?.actionRevision), `${label} authority actionRevision is invalid`);
    pushReason(reasons, isPositiveInteger(authority?.missionRevision), `${label} authority missionRevision is invalid`);
    pushReason(reasons, isPositiveInteger(authority?.decisionRevision), `${label} authority decisionRevision is invalid`);
    pushReason(reasons, nonEmpty(authority?.policyVersionId), `${label} immutable policyVersionId binding is missing`);
    pushReason(reasons, isPositiveInteger(authority?.policyRevision), `${label} immutable policyRevision binding is missing`);
    const object = evidence.object;
    pushReason(reasons, object?.storeId === scope?.storeId, `${label} object is bound to another store`);
    pushReason(reasons, object?.actionType === 'set_keyword_bid', `${label} actionType is not the Stage 6 keyword-bid action`);
    for (const field of ['identityVersionId', 'canonicalKeywordId', 'adEntityId', 'adsAccountId', 'campaignId', 'adGroupId', 'keywordId']) {
        pushReason(reasons, nonEmpty(object?.[field]), `${label} object.${field} is missing`);
    }
    pushReason(reasons, isPositiveInteger(object?.entityRevision), `${label} entityRevision is invalid`);
    pushReason(reasons, isPositiveInteger(object?.objectRevision), `${label} objectRevision is invalid`);
    pushReason(reasons, isSha256(object?.pageIdentityHash), `${label} page identity hash is invalid`);
    pushReason(reasons, isSha256(object?.sourceAuthorityProofSha256), `${label} source authority proof hash is invalid`);
    const beforeBid = object?.expectedBidCents;
    const targetBid = object?.targetBidCents;
    const changePct = Number.isInteger(beforeBid) && beforeBid > 0 && Number.isInteger(targetBid)
        ? ((beforeBid - targetBid) / beforeBid) * 100
        : Number.POSITIVE_INFINITY;
    pushReason(reasons, Number.isInteger(beforeBid) && Number.isInteger(targetBid) && targetBid > 0 && targetBid < beforeBid && changePct <= 10, `${label} bid change is not a positive decrease within 10%`);
    pushReason(reasons, evidence.execution?.status === 'succeeded', `${label} execution is not succeeded`);
    const records = Array.isArray(evidence.execution?.evidence) ? evidence.execution.evidence : [];
    pushReason(reasons, uniqueExactStrings(records.map((item) => item?.slot), ['before', 'after', 'reload']), `${label} must contain exactly before/after/reload evidence`);
    const bySlot = new Map(records.map((item) => [item?.slot, item]));
    const sessionGenerations = new Set();
    const artifactRefs = new Set();
    const contentHashes = new Set();
    for (const slot of ['before', 'after', 'reload']) {
        const record = bySlot.get(slot);
        pushReason(reasons, record?.storeId === scope?.storeId
            && record?.batchId === authority?.batchId
            && record?.jobId === authority?.jobId
            && record?.canonicalKeywordId === object?.canonicalKeywordId
            && record?.objectRevision === object?.objectRevision
            && normalizeSha256(record?.pageIdentityHash) === normalizeSha256(object?.pageIdentityHash), `${label} ${slot} evidence is not bound to the same store/object/authority`);
        pushReason(reasons, nonEmpty(record?.artifactRef)
            && nonEmpty(record?.artifactPath)
            && path.isAbsolute(record.artifactPath)
            && isSha256(record?.contentSha256), `${label} ${slot} artifact reference/path/hash is invalid`);
        pushReason(reasons, isPositiveInteger(record?.capturedSessionGeneration), `${label} ${slot} session generation is invalid`);
        pushReason(reasons, validTimestamp(record?.capturedAt), `${label} ${slot} capturedAt is invalid`);
        pushReason(reasons, validTimestamp(record?.createdAt), `${label} ${slot} createdAt is invalid`);
        if (record) {
            sessionGenerations.add(record.capturedSessionGeneration);
            artifactRefs.add(record.artifactRef);
            contentHashes.add(normalizeSha256(record.contentSha256));
        }
    }
    pushReason(reasons, records.length === 3 && artifactRefs.size === 3 && contentHashes.size === 3, `${label} before/after/reload artifacts must be distinct`);
    pushReason(reasons, records.length === 3 && sessionGenerations.size === 1, `${label} before/after/reload are not from one session generation`);
    const before = bySlot.get('before');
    const after = bySlot.get('after');
    const reload = bySlot.get('reload');
    pushReason(reasons, before?.observedBidCents === beforeBid
        && after?.observedBidCents === targetBid
        && reload?.observedBidCents === targetBid, `${label} before/after/reload values are inconsistent`);
    pushReason(reasons, validTimestamp(before?.capturedAt)
        && validTimestamp(after?.capturedAt)
        && validTimestamp(reload?.capturedAt)
        && Date.parse(before.capturedAt) < Date.parse(after.capturedAt)
        && Date.parse(after.capturedAt) < Date.parse(reload.capturedAt), `${label} before/after/reload timestamps are not strictly ordered`);
    const storesRoot = evidence.storesRoot;
    const canonicalStoresRoot = context.canonicalStoresRoot;
    const normalizedStoreId = normalizeLogicalId(scope?.storeId);
    const normalizedProfileId = normalizeLogicalId(scope?.browserProfileId);
    pushReason(reasons, nonEmpty(storesRoot)
        && path.isAbsolute(storesRoot)
        && nonEmpty(canonicalStoresRoot)
        && samePath(storesRoot, canonicalStoresRoot)
        && realpathEquals(storesRoot, canonicalStoresRoot)
        && requestedPathEqualsRealpath(canonicalStoresRoot)
        && fs.existsSync(canonicalStoresRoot)
        && fs.statSync(canonicalStoresRoot).isDirectory(), `${label} storesRoot is not the canonical USER_DATA_DIR/stores directory derived from the snapshot source`);
    pushReason(reasons, normalizedStoreId === scope?.storeId && normalizedProfileId === scope?.browserProfileId, `${label} store/Profile ids are not normalized logical ids`);
    const authorityProof = evidence.database?.authorityProof;
    pushReason(reasons, authorityProof?.queryContract === EXECUTION_CANARY_AUTHORITY_QUERY_CONTRACT, `${label} authority query contract is missing or invalid`);
    pushReason(reasons, authorityProof?.passed === true, `${label} authority query did not pass`);
    pushReason(reasons, validTimestamp(authorityProof?.queryExecutedAt), `${label} authority query timestamp is invalid`);
    pushReason(reasons, normalizeSha256(authorityProof?.databaseSha256) === normalizeSha256(evidence.database?.sha256), `${label} authority query is not bound to the selected database SHA-256`);
    pushReason(reasons, validTimestamp(authorityProof?.queryExecutedAt)
        && validTimestamp(evidence.generatedAt)
        && Date.parse(authorityProof.queryExecutedAt) <= Date.parse(evidence.generatedAt), `${label} authority query timestamp is later than the canary manifest`);
    let submitIntentId = null;
    const verifiedPngArtifacts = withVerifiedReadOnlyDatabase(evidence.database, label, reasons, (database) => {
        const artifacts = validateCanaryAuthorityDatabase(database, evidence, expectedMode, label, reasons, context);
        // 提交意图直接读取已核验的正式快照，不能由报告补写一个不同的标识。
        const jobs = database.prepare('SELECT submit_intent_id FROM ad_execution_jobs WHERE store_id=? AND id=?').all(scope?.storeId, authority?.jobId);
        pushReason(reasons, jobs.length === 1 && nonEmpty(jobs[0]?.submit_intent_id), `${label} exact durable submit intent is missing`);
        submitIntentId = jobs.length === 1 ? jobs[0].submit_intent_id : null;
        return artifacts;
    }, context);
    pushReason(reasons, Array.isArray(verifiedPngArtifacts)
        && verifiedPngArtifacts.length === 3
        && uniqueExactStrings(verifiedPngArtifacts.map((artifact) => artifact.slot), ['before', 'after', 'reload']), `${label} did not retain exactly three immutable PNG artifact proofs`);
    return validationResult(reasons, {
        packageIdentity: evidence.packageIdentity,
        canaryBinding: {
            authorityId: authority?.authorityId || null,
            batchId: authority?.batchId || null,
            jobId: authority?.jobId || null,
            missionGrantId: authority?.missionGrantId || null,
            proposalId: authority?.proposalId || null,
            decisionId: authority?.decisionId || null,
            submitIntentId,
        },
        verifiedPngArtifacts: Object.freeze(Array.isArray(verifiedPngArtifacts)
            ? verifiedPngArtifacts
            : []),
    });
}

module.exports = { validateExecutionCanary };

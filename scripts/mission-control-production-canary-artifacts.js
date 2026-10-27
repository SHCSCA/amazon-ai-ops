// 按职责复用原有严格校验，公共入口继续保持兼容。
const fs = require('node:fs');
const path = require('node:path');
const { inspectPngEvidenceFile, } = require('./canary-png-evidence');
const { isUsBusinessDate } = require('./mission-control-production-continuous.js');
const { hasUnsafeFilesystemLink, isPathContained, isPositiveInteger, isRecord, nonEmpty, normalizeSha256, pushReason, samePath, sha256Text, stableEqual, validTimestamp } = require('./mission-control-production-contracts.js');

function parseJsonArray(value) {
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : null;
    }
    catch {
        return null;
    }
}

function parseJsonObject(value) {
    try {
        const parsed = JSON.parse(value);
        return isRecord(parsed) ? parsed : null;
    }
    catch {
        return null;
    }
}

function parseStopConditionCodes(value) {
    const parsed = parseJsonArray(value);
    if (!parsed || parsed.length === 0)
        return null;
    const codes = parsed.map((item) => {
        if (nonEmpty(item))
            return item;
        if (isRecord(item) && nonEmpty(item.code))
            return item.code;
        return null;
    });
    return codes.every(nonEmpty) && new Set(codes).size === codes.length ? codes : null;
}

function exactDatabaseRow(database, sql, parameters, label, reasons) {
    const rows = database.prepare(sql).all(...parameters);
    pushReason(reasons, rows.length === 1, `${label} must resolve to exactly one authority DB row`);
    return rows.length === 1 ? rows[0] : null;
}

function validatePngArtifact(filePath, label, reasons) {
    try {
        return inspectPngEvidenceFile(filePath);
    }
    catch (error) {
        reasons.push(`${label} is not complete, decodable production PNG evidence: ${error instanceof Error ? error.message : String(error)}`);
        return null;
    }
}

function deterministicExecutionArtifactRef(storeId, batchId, jobId, slot) {
    const payload = JSON.stringify(Object.fromEntries(Object.entries({
        storeId,
        batchId,
        jobId,
        slot,
    }).sort(([left], [right]) => left.localeCompare(right))));
    return `artifact:execution:v1:${sha256Text(payload)}`;
}

function deterministicExecutionArtifactPath(storesRoot, storeId, batchId, jobId, slot) {
    return path.resolve(storesRoot, storeId, 'evidence', 'ad-execution', `batch-${sha256Text(batchId).slice(0, 24)}`, `job-${sha256Text(jobId).slice(0, 24)}`, `${slot}.png`);
}

function validateExecutionArtifact(record, databaseRecord, artifactContext, label, slot, reasons) {
    const expectedPath = deterministicExecutionArtifactPath(artifactContext.storesRoot, artifactContext.storeId, artifactContext.batchId, artifactContext.jobId, slot);
    pushReason(reasons, nonEmpty(record?.artifactPath) && path.isAbsolute(record.artifactPath) && samePath(record.artifactPath, expectedPath), `${label} ${slot} artifact path is not the deterministic Store Capsule path`);
    pushReason(reasons, record?.artifactRef === deterministicExecutionArtifactRef(artifactContext.storeId, artifactContext.batchId, artifactContext.jobId, slot), `${label} ${slot} artifact reference is not the deterministic opaque reference`);
    let currentInspection = null;
    try {
        const root = path.resolve(artifactContext.storesRoot);
        const storeRoot = path.resolve(root, artifactContext.storeId);
        const rootReal = fs.realpathSync(root);
        const storeReal = fs.realpathSync(storeRoot);
        const artifactReal = fs.realpathSync(expectedPath);
        const physicallyContained = samePath(root, rootReal)
            && isPathContained(rootReal, storeReal)
            && isPathContained(storeReal, artifactReal)
            && !hasUnsafeFilesystemLink(root, expectedPath);
        pushReason(reasons, physicallyContained, `${label} ${slot} artifact escapes or links through the Store Capsule boundary`);
        currentInspection = validatePngArtifact(expectedPath, `${label} ${slot} Store Capsule artifact`, reasons);
    }
    catch (error) {
        reasons.push(`${label} ${slot} Store Capsule artifact cannot be read: ${error instanceof Error ? error.message : String(error)}`);
    }
    pushReason(reasons, currentInspection !== null
        && currentInspection.sha256 === normalizeSha256(record?.contentSha256)
        && currentInspection.sha256 === normalizeSha256(databaseRecord?.contentSha256), `${label} ${slot} current artifact SHA-256 does not match both JSON and authority DB`);
    pushReason(reasons, Number.isSafeInteger(record?.sizeBytes)
        && record.sizeBytes > 0
        && record.sizeBytes === currentInspection?.sizeBytes, `${label} ${slot} current artifact size does not match the JSON evidence`);
    if (!currentInspection)
        return null;
    return Object.freeze({
        slot,
        filePath: expectedPath,
        sha256: currentInspection.sha256,
        sizeBytes: currentInspection.sizeBytes,
        width: currentInspection.width,
        height: currentInspection.height,
        bitDepth: currentInspection.bitDepth,
        colorType: currentInspection.colorType,
        idatChunks: currentInspection.idatChunks,
        fileIdentity: Object.freeze({ ...currentInspection.fileIdentity }),
        mtimeNs: currentInspection.mtimeNs,
        ctimeNs: currentInspection.ctimeNs,
    });
}

function verifyExecutionCanaryLineage(database, { storeId, missionGrantId, batchId, jobId, mode }) {
    const reasons = [];
    const check = (condition, message) => { if (!condition)
        throw new Error(message); };
    const one = (sql, ...args) => {
        const rows = database.prepare(sql).all(...args);
        check(rows.length === 1, 'Current execution lineage requires exactly one bound record.');
        return rows[0];
    };
    const parse = value => { const result = parseJsonObject(value); check(result, 'Current execution lineage has no immutable snapshot.'); return result; };
    const time = value => { check(validTimestamp(value), 'Current execution lineage has an invalid timestamp.'); return Date.parse(value); };
    try {
        check(['manual_approval', 'policy_auto'].includes(mode), 'Canary authorization mode is invalid.');
        const job = one('SELECT * FROM ad_execution_jobs WHERE store_id=? AND id=?', storeId, jobId);
        const grant = one('SELECT * FROM mission_grants WHERE store_id=? AND id=?', storeId, missionGrantId);
        const store = one('SELECT * FROM stores WHERE store_id=?', storeId);
        const mission = one('SELECT * FROM missions WHERE store_id=? AND id=?', storeId, job.mission_id);
        const decision = one('SELECT * FROM decisions WHERE store_id=? AND id=?', storeId, job.decision_id);
        check(job.batch_id === batchId && job.grant_id === grant.id && job.mission_id === grant.mission_id
            && job.status === 'succeeded', 'Canary job is not the bound succeeded execution.');
        const authority = parse(grant.authority_json);
        const ctx = authority.context;
        const human = mode === 'manual_approval';
        const actor = human ? 'operator' : 'policy-engine';
        check(ctx && stableEqual(Object.keys(ctx).sort(), ['storeId', 'browserProfileId', 'marketplace', 'currency', 'businessTimezone', 'businessDate', 'sessionGeneration'].sort())
            && ctx.storeId === storeId && ctx.browserProfileId === store.browser_profile_id && ctx.marketplace === 'US' && ctx.currency === 'USD'
            && ctx.businessTimezone === store.business_timezone && isUsBusinessDate(ctx.businessDate)
            && isPositiveInteger(ctx.sessionGeneration) && ctx.sessionGeneration === job.created_session_generation
            && ctx.sessionGeneration === grant.created_session_generation
            && authority.authorityMode === mode && isPositiveInteger(authority.authorityModeRevision)
            && authority.authorizationPath === (human ? 'human' : 'policy')
            && authority.issuerType === (human ? 'human_operator' : 'policy_runtime')
            && authority.issuerRef === (human ? 'operator' : `policy-runtime:${storeId}:${authority.authorityModeRevision}`)
            && grant.issuer_type === authority.authorizationPath && grant.issuer_actor_id === actor
            && stableEqual(authority, parse(decision.authority_json)), 'Grant/Decision full context, authority mode revision or single issuer is not exact.');
        const proposal = one('SELECT * FROM analysis_proposal_snapshots WHERE store_id=? AND id=?', storeId, job.proposal_id);
        const actionBatch = one('SELECT * FROM analysis_action_batches WHERE store_id=? AND id=?', storeId, proposal.action_batch_id);
        const proposals = database.prepare('SELECT id FROM analysis_proposal_snapshots WHERE store_id=? AND action_batch_id=?').all(storeId, actionBatch.id);
        check(actionBatch.mission_id === grant.mission_id && actionBatch.mission_revision === grant.mission_revision
            && actionBatch.action_revision === job.action_revision && actionBatch.created_session_generation === ctx.sessionGeneration
            && stableEqual(authority, parse(actionBatch.authority_json)) && proposals.length === 1 && proposals[0].id === job.proposal_id, 'Canary must cover the entire immutable action batch with the same write authority.');
        const missionHistory = database.prepare(`SELECT * FROM mission_events WHERE store_id=? AND mission_id=?
      AND mission_revision>=? ORDER BY mission_revision,created_at,id`).all(storeId, mission.id, grant.mission_revision);
        check(isPositiveInteger(mission.revision) && mission.revision >= grant.mission_revision
            && missionHistory.length === mission.revision - grant.mission_revision + 1, 'Mission revision history is missing or duplicated.');
        let previousMissionTime = 0;
        for (const [index, event] of missionHistory.entries()) {
            const snapshot = parse(event.snapshot_json);
            const stamp = time(event.created_at);
            check(event.mission_revision === grant.mission_revision + index && snapshot.revision === event.mission_revision
                && snapshot.id === mission.id && snapshot.storeId === storeId && snapshot.marketplace === 'US' && snapshot.currency === 'USD'
                && snapshot.policyVersionId === grant.policy_version_id && ['active', 'completed'].includes(snapshot.status)
                && stamp >= previousMissionTime && (index !== 0 || (snapshot.status === 'active' && stamp <= time(grant.issued_at))), 'Mission immutable granted revision does not match the execution history.');
            if (index === missionHistory.length - 1)
                check(snapshot.status === mission.status && snapshot.phase === mission.phase, 'Current Mission does not match its final immutable snapshot.');
            previousMissionTime = stamp;
        }
        const history = database.prepare(`SELECT * FROM decision_history WHERE store_id=? AND decision_id=?
      AND decision_revision>=? ORDER BY decision_revision,created_at,id`).all(storeId, decision.id, job.decision_revision);
        check(history.length === 3 && decision.status === 'verified' && decision.revision === job.decision_revision + 2, 'Succeeded canary requires exact approved, executed and verified Decision history.');
        let approved;
        let previousDecisionTime = 0;
        const immutableDecision = ({ status, revision, updatedAt, ...rest }) => rest;
        for (const [index, event] of history.entries()) {
            const snapshot = parse(event.snapshot_json);
            const status = ['approved', 'executed', 'verified'][index];
            const stamp = time(event.created_at);
            if (!index)
                approved = snapshot;
            check(event.decision_revision === job.decision_revision + index && snapshot.revision === event.decision_revision
                && event.event_type === status && snapshot.status === status && snapshot.id === decision.id && snapshot.storeId === storeId
                && snapshot.missionId === mission.id && snapshot.policyVersionId === grant.policy_version_id && snapshot.policyRevision === grant.policy_revision
                && snapshot.actionRevision === job.action_revision && snapshot.actionType === 'set_keyword_bid' && snapshot.adEntityId === job.ad_entity_id
                && snapshot.currentValue === job.expected_bid_cents / 100 && snapshot.recommendedValue === job.target_bid_cents / 100
                && stableEqual(snapshot.authority, authority) && stableEqual(immutableDecision(snapshot), immutableDecision(approved))
                && event.actor_id === (index ? 'execution-authority' : actor) && typeof event.reason === 'string' && event.reason.trim().length > 0
                && stamp >= previousDecisionTime && (index ? stamp >= time(job.terminal_at) : stamp <= time(grant.issued_at)), 'Decision approval issuer, immutable values or verified revision history is not exact.');
            previousDecisionTime = stamp;
        }
        check(previousDecisionTime === time(decision.updated_at), 'Decision current timestamp differs from verified history.');
        check(typeof job.submit_intent_id === 'string' && job.submit_intent_id.trim().length > 0 && /^[a-f0-9]{64}$/i.test(job.command_fingerprint), 'Succeeded canary has no durable submit intent or command fingerprint.');
        one('SELECT id FROM ad_execution_jobs WHERE submit_intent_id=?', job.submit_intent_id);
        const events = database.prepare('SELECT * FROM mission_grant_events WHERE store_id=? AND grant_id=?').all(storeId, grant.id);
        const slot = type => { const items = events.filter(event => event.event_type === type); check(items.length === 1, `Grant requires one ${type} event.`); return items[0]; };
        check(!events.some(event => ['invalidated', 'revoked', 'expired'].includes(event.event_type)), 'Grant was invalidated, revoked or expired.');
        const issued = slot('issued');
        const consumed = slot('consumed');
        const reserved = slot('reserved');
        const spent = slot('spent');
        check(issued.actor_id === actor && time(issued.created_at) === time(grant.issued_at), 'Grant issued event has the wrong authority actor.');
        for (const event of [reserved, spent])
            check(event.job_id === job.id && event.submit_intent_id === job.submit_intent_id
                && event.impact_cents === job.expected_bid_cents - job.target_bid_cents && event.impact_cents > 0 && event.actor_id === 'execution-ledger', 'Grant slot is not bound to the exact job, submit intent and impact.');
        const intent = one("SELECT * FROM ad_execution_events WHERE store_id=? AND job_id=? AND event_type='submit_intent_recorded'", storeId, job.id);
        const submitted = one("SELECT * FROM ad_execution_events WHERE store_id=? AND job_id=? AND event_type='submitted'", storeId, job.id);
        check(intent.batch_id === batchId && submitted.batch_id === batchId && intent.to_status === 'intent_written'
            && submitted.from_status === 'intent_written' && submitted.to_status === 'submitted' && submitted.sequence === intent.sequence + 1
            && intent.session_generation === ctx.sessionGeneration && submitted.session_generation === ctx.sessionGeneration, 'Canary submission event order or session is not exact.');
        const before = one("SELECT * FROM ad_execution_evidence WHERE store_id=? AND job_id=? AND slot='before'", storeId, job.id);
        const after = one("SELECT * FROM ad_execution_evidence WHERE store_id=? AND job_id=? AND slot='after'", storeId, job.id);
        const intentAt = time(job.intent_written_at);
        const submittedAt = time(job.submitted_at);
        check(time(before.created_at) <= intentAt && intentAt <= time(intent.created_at) && time(intent.created_at) === time(reserved.created_at)
            && time(reserved.created_at) <= submittedAt && submittedAt <= time(submitted.created_at)
            && time(submitted.created_at) === time(spent.created_at) && time(spent.created_at) === time(consumed.created_at)
            && time(spent.created_at) <= time(after.captured_at) && submittedAt < time(grant.expires_at)
            && submittedAt < time(proposal.valid_until) && submittedAt < time(approved.validUntil), 'Submit intent, reserved/spent/consumed or authority expiry timestamps do not match the submit boundary.');
    }
    catch (error) {
        reasons.push(`Current execution lineage: ${error instanceof Error ? error.message : String(error)}`);
    }
    return { passed: reasons.length === 0, reasons };
}

module.exports = { parseJsonArray, parseJsonObject, parseStopConditionCodes, exactDatabaseRow, validatePngArtifact, deterministicExecutionArtifactRef, deterministicExecutionArtifactPath, validateExecutionArtifact, verifyExecutionCanaryLineage };

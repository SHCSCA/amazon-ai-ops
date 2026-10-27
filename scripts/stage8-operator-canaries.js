// 按职责复用原有严格校验，公共入口继续保持兼容。
const fs = require('node:fs');
const { deterministicExecutionArtifactPath, } = require('./verify-mission-control-production-readiness');
const { normalizedId, stableRef } = require('./stage8-operator-contracts.js');
const { tableSet } = require('./stage8-operator-schema.js');

function rawCanaryCandidates(database, stores, aliases, storesRoot) {
    const tables = tableSet(database);
    const required = [
        'mission_grants',
        'ad_execution_batches',
        'ad_execution_jobs',
        'analysis_proposal_snapshots',
        'verified_ad_entity_authority',
        'ad_execution_evidence',
    ];
    if (required.some((name) => !tables.has(name))) {
        return { manual_approval: [], policy_auto: [] };
    }
    const storeIds = stores.map((store) => normalizedId(store.storeId));
    if (storeIds.length === 0)
        return { manual_approval: [], policy_auto: [] };
    const placeholders = storeIds.map(() => '?').join(', ');
    const rows = database.prepare(`
    SELECT job.store_id AS storeId, grant.issuer_type AS issuerType,
           grant.id AS grantId, batch.id AS batchId, job.id AS jobId,
           proposal.ad_entity_authority_id AS authorityId,
           job.terminal_at AS terminalAt,
           (SELECT COUNT(*) FROM ad_execution_jobs sibling
             WHERE sibling.store_id = job.store_id
               AND sibling.batch_id = job.batch_id) AS batchJobCount,
           (SELECT COUNT(*) FROM ad_execution_evidence evidence
             WHERE evidence.store_id = job.store_id
               AND evidence.job_id = job.id) AS evidenceCount
    FROM ad_execution_jobs job
    JOIN ad_execution_batches batch
      ON batch.store_id = job.store_id AND batch.id = job.batch_id
    JOIN mission_grants grant
      ON grant.store_id = job.store_id AND grant.id = job.grant_id
    JOIN analysis_proposal_snapshots proposal
      ON proposal.store_id = job.store_id AND proposal.id = job.proposal_id
    WHERE job.store_id IN (${placeholders})
      AND job.status = 'succeeded'
      AND batch.status = 'succeeded'
      AND proposal.ad_entity_authority_id IS NOT NULL
    ORDER BY job.terminal_at DESC, job.id
  `).all(...storeIds);
    const result = { manual_approval: [], policy_auto: [] };
    for (const row of rows) {
        const mode = row.issuerType === 'human'
            ? 'manual_approval'
            : row.issuerType === 'policy'
                ? 'policy_auto'
                : null;
        if (!mode)
            continue;
        const artifactPaths = Object.fromEntries(['before', 'after', 'reload'].map((slot) => [
            slot,
            deterministicExecutionArtifactPath(storesRoot, normalizedId(row.storeId), row.batchId, row.jobId, slot),
        ]));
        const artifactsPresent = Object.values(artifactPaths).every((filePath) => (fs.existsSync(filePath) && fs.statSync(filePath).isFile()));
        result[mode].push({
            artifactPaths,
            artifactsPresent,
            authorityId: row.authorityId,
            batchId: row.batchId,
            batchJobCount: Number(row.batchJobCount),
            evidenceCount: Number(row.evidenceCount),
            grantId: row.grantId,
            jobId: row.jobId,
            precheckPassed: Number(row.batchJobCount) === 1
                && Number(row.evidenceCount) === 3
                && artifactsPresent,
            storeAlias: aliases.get(normalizedId(row.storeId)),
            storeId: normalizedId(row.storeId),
            terminalAt: row.terminalAt,
        });
    }
    return result;
}

function publicCanaryCandidates(raw) {
    const project = (mode, rows) => ({
        candidateCount: rows.length,
        candidates: rows.map((row) => ({
            artifactsPresent: row.artifactsPresent,
            authorityRef: stableRef('authority', row.authorityId),
            batchRef: stableRef('batch', row.batchId),
            evidenceCount: row.evidenceCount,
            formalValidation: 'REQUIRED_BEFORE_EXPORT',
            grantRef: stableRef('grant', row.grantId),
            jobRef: stableRef('job', row.jobId),
            mode,
            precheckPassed: row.precheckPassed,
            storeAlias: row.storeAlias,
            terminalAt: row.terminalAt,
        })),
        precheckedCount: rows.filter((row) => row.precheckPassed).length,
    });
    return {
        manualApproval: project('manual_approval', raw.manual_approval),
        policyAuto: project('policy_auto', raw.policy_auto),
    };
}

module.exports = { rawCanaryCandidates, publicCanaryCandidates };

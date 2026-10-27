// 按职责复用原有严格校验，公共入口继续保持兼容。
const path = require('node:path');
const { EXECUTION_CANARY_AUTHORITY_QUERY_CONTRACT, EXECUTION_CANARY_KIND, EXECUTION_CANARY_SCHEMA_VERSION, deterministicExecutionArtifactPath, deterministicExecutionArtifactRef, validateExecutionCanary, verifyExecutionCanaryLineage, } = require('./verify-mission-control-production-readiness');
const { PNG_EVIDENCE_MAX_FILE_BYTES, PNG_EVIDENCE_MIN_HEIGHT, PNG_EVIDENCE_MIN_WIDTH, inspectPngEvidenceFile, } = require('./canary-png-evidence');
const { EXECUTION_SLOTS, assertCleanAbsolutePath, assertCondition, assertDirectDirectory, assertUniqueRegularFile, fail, isPathContained, normalizeSha256, samePath } = require('./execution-canary-export-contracts.js');

function validatePngArtifact(filePath, label) {
    try {
        return inspectPngEvidenceFile(filePath);
    }
    catch (error) {
        fail(`${label} is not complete, decodable production PNG evidence: ${error instanceof Error ? error.message : String(error)}`);
    }
}

function validateStoreCapsulePaths(options, authority, canonicalStoresRoot) {
    const requestedStoresRoot = assertCleanAbsolutePath(options.storesRoot, 'Store Capsule root');
    assertCondition(samePath(requestedStoresRoot, canonicalStoresRoot), 'CLI storesRoot must equal the canonical stores directory derived from the snapshot source USER_DATA_DIR.');
    const storesRoot = assertDirectDirectory(canonicalStoresRoot, 'Store Capsule root');
    const storeRoot = path.join(storesRoot, options.storeId);
    const resolvedStoreRoot = assertDirectDirectory(storeRoot, 'Selected Store Capsule');
    assertCondition(isPathContained(storesRoot, resolvedStoreRoot), 'Selected Store Capsule escapes the Store Capsule root.');
    const artifactPaths = {};
    for (const slot of EXECUTION_SLOTS) {
        const requested = assertCleanAbsolutePath(options.artifactPaths[slot], `${slot} artifact`);
        const expected = deterministicExecutionArtifactPath(storesRoot, options.storeId, authority.batchId, authority.jobId, slot);
        assertCondition(samePath(requested, expected), `${slot} artifact is not the deterministic Store Capsule path for the selected store/batch/job.`);
        const artifact = assertUniqueRegularFile(requested, `${slot} Store Capsule artifact`);
        assertCondition(isPathContained(resolvedStoreRoot, artifact.path), `${slot} Store Capsule artifact escapes the selected store boundary.`);
        const inspection = validatePngArtifact(artifact.path, `${slot} Store Capsule artifact`);
        artifactPaths[slot] = { ...artifact, inspection };
    }
    return { storesRoot, artifactPaths };
}

function attachArtifactProof(rows, pathProof) {
    const bySlot = new Map(rows.evidence.map((record) => [record.slot, record]));
    return EXECUTION_SLOTS.map((slot) => {
        const record = bySlot.get(slot);
        const artifact = pathProof.artifactPaths[slot];
        const currentSha256 = artifact.inspection.sha256;
        assertCondition(currentSha256 === normalizeSha256(record.contentSha256, `${slot} database content SHA`), `${slot} Store Capsule artifact SHA-256 does not match the authority DB.`);
        return {
            id: record.id,
            storeId: record.storeId,
            batchId: record.batchId,
            jobId: record.jobId,
            slot: record.slot,
            artifactPath: artifact.path,
            artifactRef: record.artifactRef,
            contentSha256: currentSha256,
            sizeBytes: artifact.inspection.sizeBytes,
            pageIdentityHash: normalizeSha256(record.pageIdentityHash, `${slot} page identity hash`),
            canonicalKeywordId: record.canonicalKeywordId,
            objectRevision: record.objectRevision,
            observedBidCents: record.observedBidCents,
            capturedSessionGeneration: record.capturedSessionGeneration,
            capturedAt: record.capturedAt,
            createdAt: record.createdAt,
        };
    });
}

module.exports = { validatePngArtifact, validateStoreCapsulePaths, attachArtifactProof };

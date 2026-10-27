// 按职责复用原有严格校验，公共入口继续保持兼容。
const { EXECUTION_CANARY_AUTHORITY_QUERY_CONTRACT, EXECUTION_CANARY_KIND, EXECUTION_CANARY_SCHEMA_VERSION, deterministicExecutionArtifactPath, deterministicExecutionArtifactRef, validateExecutionCanary, verifyExecutionCanaryLineage, } = require('./verify-mission-control-production-readiness');
const { loadAuthoritySnapshotManifest, } = require('./verify-s7-continuous-operation');
const { assertMatchingAuthorityCurrentnessProofs, captureAuthoritySnapshotCurrentness, } = require('./sqlite-authority-currentness');
const { attachArtifactProof, validateStoreCapsulePaths } = require('./execution-canary-export-artifacts.js');
const { captureLiveAuthorityCurrentness, deriveCanonicalUserDataBoundary, inspectCurrentPackage, validateAuthoritySnapshotV2 } = require('./execution-canary-export-authority.js');
const { assertCondition, assertUniqueRegularFile, defaultContext, normalizePackageIdentity, normalizeSha256, sha256File, stableEqual } = require('./execution-canary-export-contracts.js');
const { normalizeProgrammaticOptions } = require('./execution-canary-export-options.js');
const { readAuthorityRows, validateAuthorityRows } = require('./execution-canary-export-rows.js');

function buildExecutionCanaryEvidence(rawOptions, injectedContext = {}) {
    const options = normalizeProgrammaticOptions(rawOptions);
    const context = { ...defaultContext(), ...injectedContext };
    const nowBeforeMs = context.now().getTime();
    assertCondition(Number.isFinite(nowBeforeMs), 'Exporter clock is invalid.');
    const authoritySnapshot = loadAuthoritySnapshotManifest(options.authoritySnapshotManifestPath, { authoritySnapshotRoot: context.authoritySnapshotRoot });
    validateAuthoritySnapshotV2(authoritySnapshot, nowBeforeMs);
    const userDataBoundary = deriveCanonicalUserDataBoundary(authoritySnapshot);
    const snapshotIdentity = normalizePackageIdentity(authoritySnapshot.packageIdentity, 'Authority snapshot packageIdentity');
    const packageBefore = inspectCurrentPackage(context);
    assertCondition(stableEqual(snapshotIdentity, packageBefore.packageIdentity), 'Authority snapshot packageIdentity does not match the current canonical package; package replay is rejected.');
    const snapshotExportedAtMs = Date.parse(authoritySnapshot.manifest.exportedAt);
    assertCondition(snapshotExportedAtMs >= packageBefore.builtAtMs, 'Authority snapshot predates the current canonical package build; package replay is rejected.');
    const databaseArtifact = assertUniqueRegularFile(authoritySnapshot.databasePath, 'Authority database snapshot');
    const databaseSha256Before = sha256File(databaseArtifact.path);
    assertCondition(databaseSha256Before === normalizeSha256(authoritySnapshot.manifest.snapshot.sha256, 'Authority snapshot SHA-256'), 'Authority database snapshot no longer matches its manifest.');
    const currentnessBeforeWork = captureLiveAuthorityCurrentness(authoritySnapshot, context, `canary-${options.mode}-before-work`);
    let database;
    let rows;
    let integrityCheck;
    let foreignKeyCheck;
    let queryExecutedAt;
    try {
        database = new context.Database(databaseArtifact.path, { readonly: true, fileMustExist: true });
        database.pragma('query_only = ON');
        assertCondition(Number(database.pragma('query_only', { simple: true })) === 1, 'Authority database snapshot did not enter SQLite query_only mode.');
        integrityCheck = database.pragma('integrity_check')
            .map((row) => String(row.integrity_check ?? row[Object.keys(row)[0]]));
        foreignKeyCheck = database.pragma('foreign_key_check');
        assertCondition(stableEqual(integrityCheck, ['ok']) && stableEqual(foreignKeyCheck, []), 'Authority database snapshot failed live integrity or foreign-key verification.');
        rows = readAuthorityRows(database, options);
        validateAuthorityRows(rows, options, snapshotExportedAtMs, packageBefore.builtAtMs, nowBeforeMs);
        const lineage = verifyExecutionCanaryLineage(database, options);
        assertCondition(lineage.passed, lineage.reasons.join(' '));
        queryExecutedAt = context.now().toISOString();
        assertCondition(Date.parse(queryExecutedAt) >= snapshotExportedAtMs, 'Authority query timestamp predates the selected snapshot.');
    }
    finally {
        if (database)
            database.close();
    }
    assertCondition(sha256File(databaseArtifact.path) === databaseSha256Before, 'Authority database snapshot changed during the read-only authority query.');
    const pathProof = validateStoreCapsulePaths(options, {
        batchId: rows.batch.id,
        jobId: rows.job.id,
    }, userDataBoundary.storesRoot);
    const executionEvidence = attachArtifactProof(rows, pathProof);
    const packageAfter = inspectCurrentPackage(context);
    assertCondition(stableEqual(packageBefore, packageAfter), 'Canonical package identity or build timestamp changed during canary evidence export.');
    assertCondition(sha256File(databaseArtifact.path) === databaseSha256Before, 'Authority database snapshot changed while Store Capsule artifacts were verified.');
    const currentnessBeforeFinalOutput = captureLiveAuthorityCurrentness(authoritySnapshot, context, `canary-${options.mode}-before-final-output`);
    const currentnessValidation = assertMatchingAuthorityCurrentnessProofs([currentnessBeforeWork, currentnessBeforeFinalOutput], authoritySnapshot.snapshotArtifact, 'Execution-canary authority currentness');
    const generatedAt = context.now().toISOString();
    assertCondition(Date.parse(generatedAt) >= Date.parse(queryExecutedAt), 'Canary evidence generatedAt predates the authority query.');
    const recordIdentity = {
        storeId: rows.store.storeId,
        browserProfileId: rows.store.browserProfileId,
        authorityId: rows.sourceAuthority.authorityId,
        identityVersionId: rows.identity.identityVersionId,
        missionGrantId: rows.grant.id,
        batchId: rows.batch.id,
        jobId: rows.job.id,
        canonicalKeywordId: rows.identity.canonicalKeywordId,
        objectRevision: rows.identity.objectRevision,
        evidenceIds: executionEvidence.map((record) => record.id),
    };
    const evidence = {
        kind: EXECUTION_CANARY_KIND,
        schemaVersion: EXECUTION_CANARY_SCHEMA_VERSION,
        generatedAt,
        status: 'PASSED',
        passed: true,
        mode: options.mode,
        storesRoot: pathProof.storesRoot,
        packageIdentity: snapshotIdentity,
        authorityCurrentness: {
            method: currentnessValidation.method,
            expectedSnapshot: currentnessValidation.expectedSnapshot,
            captures: [currentnessBeforeWork, currentnessBeforeFinalOutput],
            passed: true,
        },
        scope: {
            storeId: rows.store.storeId,
            browserProfileId: rows.store.browserProfileId,
            marketplace: rows.store.marketplace,
            currency: rows.store.currency,
        },
        authority: {
            storeId: rows.store.storeId,
            browserProfileId: rows.store.browserProfileId,
            issuerType: rows.grant.issuerType,
            authorityId: rows.sourceAuthority.authorityId,
            missionId: rows.grant.missionId,
            missionRevision: rows.grant.missionRevision,
            missionGrantId: rows.grant.id,
            batchId: rows.batch.id,
            jobId: rows.job.id,
            proposalId: rows.job.proposalId,
            decisionId: rows.job.decisionId,
            decisionRevision: rows.job.decisionRevision,
            actionRevision: rows.job.actionRevision,
            policyVersionId: rows.grant.policyVersionId,
            policyRevision: rows.grant.policyRevision,
        },
        object: {
            storeId: rows.store.storeId,
            actionType: rows.job.actionType,
            identityVersionId: rows.identity.identityVersionId,
            canonicalKeywordId: rows.identity.canonicalKeywordId,
            adEntityId: rows.identity.adEntityId,
            entityRevision: rows.identity.entityRevision,
            objectRevision: rows.identity.objectRevision,
            adsAccountId: rows.identity.adsAccountId,
            campaignId: rows.identity.campaignId,
            adGroupId: rows.identity.adGroupId,
            keywordId: rows.identity.keywordId,
            pageIdentityHash: normalizeSha256(rows.identity.pageIdentityHash, 'Identity pageIdentityHash'),
            sourceAuthorityProofSha256: normalizeSha256(rows.identity.sourceAuthorityProofSha256, 'Identity sourceAuthorityProofSha256'),
            expectedBidCents: rows.job.expectedBidCents,
            targetBidCents: rows.job.targetBidCents,
        },
        execution: {
            status: rows.job.status,
            evidence: executionEvidence,
        },
        database: {
            absolutePath: databaseArtifact.path,
            sha256: databaseSha256Before,
            sizeBytes: databaseArtifact.stat.size,
            integrityCheck,
            openedReadOnly: true,
            packageIdentity: snapshotIdentity,
            snapshotManifestSha256: authoritySnapshot.snapshotManifestSha256,
            authorityProof: {
                queryContract: EXECUTION_CANARY_AUTHORITY_QUERY_CONTRACT,
                queryExecutedAt,
                databaseSha256: databaseSha256Before,
                passed: true,
                recordIdentity,
            },
        },
    };
    const formalValidation = validateExecutionCanary(evidence, options.mode, {
        authoritySnapshotPath: databaseArtifact.path,
        authoritySnapshotManifestSha256: authoritySnapshot.snapshotManifestSha256,
        authoritySnapshotExportedAt: authoritySnapshot.manifest.exportedAt,
        canonicalStoresRoot: pathProof.storesRoot,
        nowMs: nowBeforeMs,
        packageBuiltAtMs: packageBefore.builtAtMs,
        packageIdentity: snapshotIdentity,
    });
    assertCondition(formalValidation.ok, `Generated canary evidence does not satisfy the formal verifier: ${formalValidation.reason}`);
    return evidence;
}

module.exports = { buildExecutionCanaryEvidence };

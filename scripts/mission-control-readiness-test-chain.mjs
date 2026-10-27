// 按证据职责拆分夹具与验收断言，测试仍归属原有入口。
import { buildExecutionCanary, businessDates, createAuthorityDatabase } from './mission-control-readiness-test-authority.mjs';
import { artifact, createCanonicalPackageFixture, packageIndexArtifact, readJson, sha256File, writeJson } from './mission-control-readiness-test-artifacts.mjs';
import { Database, EXECUTION_CANARY_AUTHORITY_QUERY_CONTRACT, V15_GATE_IDS, buildContinuousOperationManifest, evaluateContinuousOperationSnapshot, fs, path, readContinuousOperationSnapshot, runReadonlySqliteOnlineBackupSync, storeFixtures, writeValidPackageLaunchSmoke } from './mission-control-readiness-test-environment.mjs';
import { validAdversarialEvidence, validPackageUiManifest, validSecurityEvidence } from './mission-control-readiness-test-ui.mjs';
function validContinuousOperationEvidence(databasePath, authoritySnapshot, outputPath) {
    const dates = businessDates();
    const snapshotArtifact = artifact(databasePath);
    const currentnessCaptures = [
        'continuous-before-work',
        'continuous-before-final-output',
        'continuous-after-staging-output',
    ].map((captureLabel) => ({
        schemaVersion: 'sqlite-authority-currentness-proof/v1',
        method: 'readonly-sqlite-online-backup',
        captureLabel,
        capturedAt: '2026-07-23T01:19:00.000Z',
        source: {
            openedReadOnly: true,
            queryOnly: true,
        },
        expectedSnapshot: {
            sha256: snapshotArtifact.sha256,
            sizeBytes: snapshotArtifact.sizeBytes,
        },
        observedBackup: {
            sha256: snapshotArtifact.sha256,
            sizeBytes: snapshotArtifact.sizeBytes,
            totalPages: 1,
            remainingPages: 0,
        },
        matchesSelectedSnapshot: true,
    }));
    const input = {
        stores: storeFixtures.map((store) => store.storeId),
        dates,
        dateFrom: dates[0],
        dateTo: dates.at(-1),
        generatedAt: '2026-07-23T01:19:00.000Z',
        storesRoot: authoritySnapshot.storesRoot,
        authorityCurrentness: {
            method: 'readonly-sqlite-online-backup',
            expectedSnapshot: {
                sha256: snapshotArtifact.sha256,
                sizeBytes: snapshotArtifact.sizeBytes,
            },
            captures: currentnessCaptures,
            passed: true,
        },
        publication: {
            state: 'atomic-published',
            outputPath,
            stagedVerificationCaptureLabel: 'continuous-after-staging-output',
        },
    };
    const database = new Database(databasePath, { readonly: true, fileMustExist: true });
    try {
        const integrityCheck = database.pragma('integrity_check').map((row) => String(row.integrity_check));
        const result = evaluateContinuousOperationSnapshot(readContinuousOperationSnapshot(database, input), input);
        if (!result.passed)
            throw new Error(`continuous fixture is invalid: ${JSON.stringify(result.violations)}`);
        return buildContinuousOperationManifest(databasePath, input, result, integrityCheck, authoritySnapshot);
    }
    finally {
        database.close();
    }
}

function attachCanaryDatabaseProof(canary, databasePath) {
    const databaseArtifact = artifact(databasePath);
    const evidenceIds = canary.execution.evidence.map((record) => record.id);
    const queryExecutedAt = canary.mode === 'manual_approval'
        ? '2026-07-23T01:20:00.000Z'
        : '2026-07-23T01:22:00.000Z';
    canary.database = {
        absolutePath: databasePath,
        sha256: databaseArtifact.sha256,
        sizeBytes: databaseArtifact.sizeBytes,
        integrityCheck: ['ok'],
        openedReadOnly: true,
        authorityProof: {
            queryContract: EXECUTION_CANARY_AUTHORITY_QUERY_CONTRACT,
            queryExecutedAt,
            databaseSha256: databaseArtifact.sha256,
            passed: true,
            recordIdentity: {
                storeId: canary.scope.storeId,
                browserProfileId: canary.scope.browserProfileId,
                authorityId: canary.authority.authorityId,
                identityVersionId: canary.object.identityVersionId,
                missionGrantId: canary.authority.missionGrantId,
                batchId: canary.authority.batchId,
                jobId: canary.authority.jobId,
                canonicalKeywordId: canary.object.canonicalKeywordId,
                objectRevision: canary.object.objectRevision,
                evidenceIds,
            },
        },
    };
    return canary;
}

function passingEvidenceChain(tempDir) {
    const canonicalPackage = createCanonicalPackageFixture(tempDir);
    const { executablePath: unpackedPath, portablePath, installerPath, packageIdentity, } = canonicalPackage;
    const sourceDatabasePath = path.join(tempDir, 'live-appdata', 'amazon-ai-ops.db');
    const authoritySnapshotRoot = path.join(tempDir, 'authority-snapshots');
    const databasePath = path.join(authoritySnapshotRoot, 'authority-snapshot.db');
    const storesRoot = path.join(path.dirname(sourceDatabasePath), 'stores');
    const packageUiScreenshotRoot = path.join(tempDir, 'package-ui-screenshots');
    const manualCanary = buildExecutionCanary('manual_approval', storesRoot);
    const policyCanary = buildExecutionCanary('policy_auto', storesRoot);
    fs.mkdirSync(path.dirname(sourceDatabasePath), { recursive: true });
    fs.mkdirSync(authoritySnapshotRoot, { recursive: true });
    createAuthorityDatabase(sourceDatabasePath, [manualCanary, policyCanary]);
    const sourceWriter = new Database(sourceDatabasePath);
    sourceWriter.pragma('journal_mode = WAL');
    sourceWriter.pragma('wal_autocheckpoint = 0');
    sourceWriter.pragma('wal_checkpoint(TRUNCATE)');
    sourceWriter.close();
    const onlineBackup = runReadonlySqliteOnlineBackupSync({
        sourceDatabasePath,
        destinationPath: databasePath,
        ownedTempRoot: authoritySnapshotRoot,
    });
    const snapshotWriter = new Database(databasePath, { readonly: true, fileMustExist: true });
    const snapshotTotalPages = Number(snapshotWriter.pragma('page_count', { simple: true }));
    snapshotWriter.close();
    attachCanaryDatabaseProof(manualCanary, databasePath);
    attachCanaryDatabaseProof(policyCanary, databasePath);
    const paths = {
        finalReadiness: path.join(tempDir, 'final-readiness.json'),
        packageLaunch: path.join(tempDir, 'package-launch.json'),
        packageUi: path.join(tempDir, 'package-ui.json'),
        packageSecurity: path.join(tempDir, 'package-security.json'),
        packageAdversarial: path.join(tempDir, 'package-adversarial.json'),
        continuousOperation: path.join(tempDir, 'continuous-operation.json'),
        manualCanary: path.join(tempDir, 'manual-canary.json'),
        policyCanary: path.join(tempDir, 'policy-canary.json'),
        evidenceManifest: path.join(tempDir, 'v15-evidence-manifest.json'),
        authoritySnapshotManifest: path.join(authoritySnapshotRoot, 'snapshot-manifest.json'),
        sourceDatabase: sourceDatabasePath,
        database: databasePath,
        storesRoot,
    };
    const sourceArtifact = artifact(sourceDatabasePath);
    const sourceStat = fs.statSync(sourceDatabasePath);
    const snapshotArtifact = artifact(databasePath);
    writeJson(paths.authoritySnapshotManifest, {
        kind: 'mission-control-authority-database-snapshot',
        schemaVersion: 'mission-control-authority-database-snapshot/v2',
        exportedAt: '2026-07-23T01:18:00.000Z',
        backup: {
            method: 'sqlite-online-backup',
            startedAt: '2026-07-23T01:17:59.000Z',
            completedAt: '2026-07-23T01:18:00.000Z',
            completed: true,
            totalPages: onlineBackup.observedBackup.totalPages || snapshotTotalPages,
            remainingPages: onlineBackup.observedBackup.remainingPages,
        },
        source: {
            absolutePath: sourceDatabasePath,
            realPath: fs.realpathSync.native(sourceDatabasePath),
            openedReadOnly: true,
            queryOnly: true,
            integrityCheck: ['ok'],
            foreignKeyCheck: [],
            artifactBefore: {
                sha256: sourceArtifact.sha256,
                sizeBytes: sourceArtifact.sizeBytes,
                mtimeMs: sourceStat.mtimeMs,
            },
            artifactAfter: {
                sha256: sourceArtifact.sha256,
                sizeBytes: sourceArtifact.sizeBytes,
                mtimeMs: sourceStat.mtimeMs,
            },
        },
        snapshot: {
            absolutePath: databasePath,
            realPath: fs.realpathSync.native(databasePath),
            openedReadOnly: true,
            queryOnly: true,
            integrityCheck: ['ok'],
            foreignKeyCheck: [],
            sha256: snapshotArtifact.sha256,
            sizeBytes: snapshotArtifact.sizeBytes,
        },
        packageIdentity,
    });
    const snapshotManifestSha256 = sha256File(paths.authoritySnapshotManifest);
    for (const canary of [manualCanary, policyCanary]) {
        canary.packageIdentity = { ...packageIdentity };
        canary.database.packageIdentity = { ...packageIdentity };
        canary.database.snapshotManifestSha256 = snapshotManifestSha256;
    }
    writeJson(paths.evidenceManifest, { kind: 'v15-final-readiness-evidence-manifest' });
    const packageLaunch = writeValidPackageLaunchSmoke(tempDir, {
        evidencePath: paths.packageLaunch,
        generatedAt: '2026-07-23T01:00:00.000Z',
        portablePath,
        releaseDir: canonicalPackage.releaseRoot,
        unpackedPath,
    });
    writeJson(paths.packageUi, validPackageUiManifest(packageIdentity, packageUiScreenshotRoot));
    writeJson(paths.packageSecurity, validSecurityEvidence(packageIdentity));
    writeJson(paths.packageAdversarial, validAdversarialEvidence(packageIdentity));
    const continuousEvidence = validContinuousOperationEvidence(databasePath, {
        manifestPath: paths.authoritySnapshotManifest,
        packageIdentity,
        snapshotManifestSha256,
        storesRoot,
    }, paths.continuousOperation);
    continuousEvidence.generatedAt = '2026-07-23T01:19:00.000Z';
    continuousEvidence.packageIdentity = { ...packageIdentity };
    continuousEvidence.database.packageIdentity = { ...packageIdentity };
    continuousEvidence.database.snapshotManifestSha256 = snapshotManifestSha256;
    writeJson(paths.continuousOperation, continuousEvidence);
    writeJson(paths.manualCanary, manualCanary);
    writeJson(paths.policyCanary, policyCanary);
    const packages = [
        packageIndexArtifact('installer', installerPath),
        packageIndexArtifact('portable', portablePath),
    ];
    const finalReadiness = {
        generatedAt: '2026-07-23T01:08:00.000Z',
        evidenceSelection: { mode: 'manifest', manifestPath: paths.evidenceManifest },
        manifestDriven: true,
        status: 'APP_NEEDS_WORK',
        appReady: false,
        allGatesPass: false,
        formalAllGatesPass: false,
        missing: ['Legacy manual Ads UI readback is not credited for the Stage 7 app executor.'],
        actionItems: ['Use the explicit manual and policy-auto Stage 7 canaries for the production decision.'],
        failures: [{
                gateId: 'real-ad-execution-readback',
                code: 'GATE_FAILED',
                message: 'Legacy manual Ads UI readback is not credited for the Stage 7 app executor.',
                evidencePath: path.join(tempDir, 'real-ad-execution-readback.json'),
            }],
        packageIndex: {
            present: true,
            count: 2,
            existingCount: 2,
            missingCount: 0,
            releaseDir: canonicalPackage.releaseRoot,
            error: null,
            packages,
        },
        currentPortablePackage: packages[1],
        packageLaunchSmoke: {
            present: true,
            evidencePath: paths.packageLaunch,
            selectedBy: 'explicit-arg',
            generatedAt: packageLaunch.generatedAt,
            passed: true,
            artifacts: packageLaunch.artifacts,
            checks: packageLaunch.checks,
        },
        packageAdversarialNodeEnv: {
            contractVersion: 'package-adversarial-node-env/v1',
            present: true,
            evidencePath: paths.packageAdversarial,
            selectedBy: 'explicit-arg',
            requiredForDeliverySafety: true,
            passed: true,
            evidenceSha256: sha256File(paths.packageAdversarial),
            package: { ...packageIdentity },
        },
        gates: V15_GATE_IDS.map((id) => ({
            id,
            name: id,
            status: id === 'real-ad-execution-readback' ? 'needs_work' : 'passed',
            ok: id !== 'real-ad-execution-readback',
            evidencePath: id === 'package-launch-smoke' ? paths.packageLaunch : path.join(tempDir, `${id}.json`),
            message: id === 'real-ad-execution-readback'
                ? 'Legacy manual Ads UI readback is superseded by the two Stage 7 execution canaries.'
                : 'passed',
        })),
    };
    writeJson(paths.finalReadiness, finalReadiness);
    paths.verificationContext = {
        nowMs: Date.parse('2026-07-23T02:00:00.000Z'),
        releaseRoot: canonicalPackage.releaseRoot,
        executablePath: canonicalPackage.executablePath,
        appContentPath: canonicalPackage.appContentPath,
        mainBundlePath: canonicalPackage.mainBundlePath,
        authorityDbPath: sourceDatabasePath,
        authorityDbError: null,
        authoritySnapshotRoot,
    };
    return { packageIdentity, paths, manualCanary, policyCanary };
}

function refreshAuthoritySnapshotBindings(paths) {
    const snapshotArtifact = artifact(paths.database);
    const snapshotManifest = readJson(paths.authoritySnapshotManifest);
    snapshotManifest.snapshot.sha256 = snapshotArtifact.sha256;
    snapshotManifest.snapshot.sizeBytes = snapshotArtifact.sizeBytes;
    snapshotManifest.snapshot.realPath = fs.realpathSync.native(paths.database);
    writeJson(paths.authoritySnapshotManifest, snapshotManifest);
    const snapshotManifestSha256 = sha256File(paths.authoritySnapshotManifest);
    for (const evidencePath of [paths.continuousOperation, paths.manualCanary, paths.policyCanary]) {
        const evidence = readJson(evidencePath);
        evidence.database.sha256 = snapshotArtifact.sha256;
        evidence.database.sizeBytes = snapshotArtifact.sizeBytes;
        evidence.database.snapshotManifestSha256 = snapshotManifestSha256;
        if (evidence.database.authorityProof) {
            evidence.database.authorityProof.databaseSha256 = snapshotArtifact.sha256;
        }
        if (evidence.authoritySnapshotManifest) {
            evidence.authoritySnapshotManifest.sha256 = snapshotManifestSha256;
        }
        writeJson(evidencePath, evidence);
    }
    return { snapshotArtifact, snapshotManifestSha256 };
}

function mutateAuthoritySnapshot(paths, mutateDatabase) {
    const database = new Database(paths.database);
    try {
        mutateDatabase(database);
    }
    finally {
        database.close();
    }
    return refreshAuthoritySnapshotBindings(paths);
}

function replaceCanaryArtifact(paths, canaryPath, slot, bytes) {
    const canary = readJson(canaryPath);
    const record = canary.execution.evidence.find((item) => item.slot === slot);
    fs.writeFileSync(record.artifactPath, bytes);
    record.contentSha256 = sha256File(record.artifactPath);
    record.sizeBytes = fs.statSync(record.artifactPath).size;
    writeJson(canaryPath, canary);
    mutateAuthoritySnapshot(paths, (database) => {
        database.prepare(`
      UPDATE ad_execution_evidence SET content_sha256 = ? WHERE id = ?
    `).run(record.contentSha256, record.id);
    });
    return record;
}

function writeFullyReadyV15Baseline(paths) {
    const readiness = readJson(paths.finalReadiness);
    readiness.status = 'APP_READY';
    readiness.appReady = true;
    readiness.allGatesPass = true;
    readiness.formalAllGatesPass = true;
    readiness.missing = [];
    readiness.actionItems = [];
    readiness.failures = [];
    readiness.gates = readiness.gates.map((gate) => ({
        ...gate,
        status: 'passed',
        ok: true,
        message: 'passed',
    }));
    writeJson(paths.finalReadiness, readiness);
}

function writeInvalidV15FailureSet(paths, failedGateIds) {
    const readiness = readJson(paths.finalReadiness);
    const failures = failedGateIds.map((gateId) => ({
        gateId,
        code: 'GATE_FAILED',
        message: `Legacy gate ${gateId} failed.`,
        evidencePath: readiness.gates.find((gate) => gate.id === gateId)?.evidencePath ?? null,
    }));
    readiness.status = 'APP_NEEDS_WORK';
    readiness.appReady = false;
    readiness.allGatesPass = false;
    readiness.formalAllGatesPass = false;
    readiness.missing = failures.map((failure) => failure.message);
    readiness.failures = failures;
    readiness.gates = readiness.gates.map((gate) => {
        const failed = failedGateIds.includes(gate.id);
        return {
            ...gate,
            status: failed ? 'needs_work' : 'passed',
            ok: !failed,
            message: failed ? `Legacy gate ${gate.id} failed.` : 'passed',
        };
    });
    writeJson(paths.finalReadiness, readiness);
}

function verifierArgs(paths, outputPath) {
    const args = [
        '--v15-final-readiness', paths.finalReadiness,
        '--package-launch-smoke', paths.packageLaunch,
        '--package-ui-manifest', paths.packageUi,
        '--package-security-evidence', paths.packageSecurity,
        '--package-adversarial-node-env-evidence', paths.packageAdversarial,
        '--s7-continuous-operation-evidence', paths.continuousOperation,
        '--manual-canary-evidence', paths.manualCanary,
        '--policy-auto-canary-evidence', paths.policyCanary,
        '--authority-snapshot-manifest', paths.authoritySnapshotManifest,
        '--authority-db', paths.sourceDatabase,
        '--out', outputPath,
    ];
    args.verificationContext = paths.verificationContext;
    return args;
}
export { validContinuousOperationEvidence, attachCanaryDatabaseProof, passingEvidenceChain, refreshAuthoritySnapshotBindings, mutateAuthoritySnapshot, replaceCanaryArtifact, writeFullyReadyV15Baseline, writeInvalidV15FailureSet, verifierArgs };

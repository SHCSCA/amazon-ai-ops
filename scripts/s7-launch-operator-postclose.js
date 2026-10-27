// 按职责复用原有严格校验，公共入口继续保持兼容。

const { samePackageIdentity } = require('./s7-launch-operator-authority.js');
const { receiptPackageIdentity, receiptProcessState } = require('./s7-launch-operator-bindings.js');
const { KIND, SCHEMA_VERSION, SIDECARS, boundedError, exists, fail, normalizePackageLaunchState, nowIso, publicArtifact, sameArtifact } = require('./s7-launch-operator-contracts.js');
const { fileArtifact } = require('./s7-launch-operator-filesystem.js');
const { validateProcessState } = require('./s7-launch-operator-processes.js');

function boundedUntrustedCandidate(error, exclusiveWindow, launch) {
    const errorProof = error?.proof && typeof error.proof === 'object'
        ? error.proof
        : launch?.result?.errorProof && typeof launch.result.errorProof === 'object'
            ? launch.result.errorProof
            : null;
    const numberOrNull = (value) => (Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null);
    const booleanOrNull = (value) => (typeof value === 'boolean' ? value : null);
    const textOrNull = (value, limit = 120) => (typeof value === 'string' && value.trim() ? value.slice(0, limit) : null);
    const localPid = numberOrNull(launch?.pid);
    const proofPid = numberOrNull(errorProof?.pid);
    const helperPid = numberOrNull(errorProof?.helperPid)
        ?? numberOrNull(exclusiveWindow?.helperPid);
    if (!errorProof && !localPid && !helperPid)
        return null;
    return {
        trust: 'UNTRUSTED_CANDIDATE_ONLY',
        trustedForDecision: false,
        source: errorProof ? 'HELPER_ERROR_PROOF' : 'LOCAL_HANDOFF_STATE',
        protocol: textOrNull(errorProof?.protocol),
        status: textOrNull(errorProof?.status),
        candidatePid: proofPid ?? localPid,
        helperPid,
        phase: textOrNull(errorProof?.phase),
        processCreated: booleanOrNull(errorProof?.processCreated)
            ?? (['SPAWNED', 'RESUMED', 'CLOSED'].includes(errorProof?.status)
                ? true
                : launch?.createdSuspended === true
                    ? true
                    : null),
        processResumed: booleanOrNull(errorProof?.processResumed)
            ?? (['RESUMED', 'CLOSED'].includes(errorProof?.status)
                ? true
                : launch?.resumed === true
                    ? true
                    : null),
        databaseHandleExclusive: booleanOrNull(errorProof?.databaseHandleExclusive),
        databaseHandleAcquired: booleanOrNull(errorProof?.databaseHandleAcquired),
        databaseHandleReleased: booleanOrNull(errorProof?.databaseHandleReleased),
        releaseState: textOrNull(errorProof?.releaseState, 40),
        errorType: textOrNull(errorProof?.errorType),
        exitCode: Number.isInteger(errorProof?.exitCode) && errorProof.exitCode >= 0
            && errorProof.exitCode <= 0xffffffff ? errorProof.exitCode : null,
        observedAt: textOrNull(errorProof?.observedAt, 40),
        scriptSha256: /^[A-F0-9]{64}$/.test(String(errorProof?.scriptSha256 || ''))
            ? String(errorProof.scriptSha256)
            : null,
        lateProofBuffer: errorProof?.lateProofBuffer
            && typeof errorProof.lateProofBuffer === 'object'
            ? {
                queuedProofs: Array.isArray(errorProof.lateProofBuffer.queuedProofs)
                    ? errorProof.lateProofBuffer.queuedProofs.slice(-4).map((proof) => ({
                        protocol: textOrNull(proof?.protocol),
                        status: textOrNull(proof?.status),
                        helperPid: numberOrNull(proof?.helperPid),
                        candidatePid: numberOrNull(proof?.pid),
                        phase: textOrNull(proof?.phase),
                    }))
                    : [],
                partialText: textOrNull(errorProof.lateProofBuffer.partialText, 1024),
                partialBytes: Number.isInteger(Number(errorProof.lateProofBuffer.partialBytes))
                    ? Math.max(0, Number(errorProof.lateProofBuffer.partialBytes))
                    : null,
                terminalCode: textOrNull(errorProof.lateProofBuffer.terminalCode, 80),
                closeOutcome: errorProof.lateProofBuffer.closeOutcome
                    && typeof errorProof.lateProofBuffer.closeOutcome === 'object'
                    ? {
                        outcome: textOrNull(errorProof.lateProofBuffer.closeOutcome.outcome, 40),
                        code: Number.isInteger(Number(errorProof.lateProofBuffer.closeOutcome.code))
                            ? Number(errorProof.lateProofBuffer.closeOutcome.code)
                            : null,
                        signal: textOrNull(errorProof.lateProofBuffer.closeOutcome.signal, 40),
                    }
                    : null,
            }
            : null,
        helperInputState: textOrNull(errorProof?.helperInputState, 40),
        helperInputCloseError: errorProof?.helperInputCloseError
            && typeof errorProof.helperInputCloseError === 'object'
            ? {
                name: textOrNull(errorProof.helperInputCloseError.name, 80),
                message: textOrNull(errorProof.helperInputCloseError.message, 300),
            }
            : null,
        helperProcessUnrefRequested: booleanOrNull(errorProof?.helperProcessUnrefRequested),
        helperStdinUnrefRequested: booleanOrNull(errorProof?.helperStdinUnrefRequested),
        helperStdoutUnrefRequested: booleanOrNull(errorProof?.helperStdoutUnrefRequested),
        knownErrorProofFieldsPreserved: Boolean(errorProof),
    };
}

function collectSidecarState(dbPath) {
    const records = SIDECARS.map((suffix) => ({
        suffix,
        path: `${dbPath}${suffix}`,
        exists: exists(`${dbPath}${suffix}`),
    }));
    return {
        passed: records.every((record) => record.exists === false),
        records,
    };
}

function collectStablePostExitDatabase(context, databasePath) {
    const result = {
        passed: false,
        method: 'bracketed-stable-main-file-and-readonly-schema',
        before: null,
        after: null,
        sidecarsBefore: null,
        sidecarsAfter: null,
        schemaVersion: null,
        snapshot: null,
        error: null,
    };
    try {
        result.sidecarsBefore = collectSidecarState(databasePath);
        if (!result.sidecarsBefore.passed) {
            fail('Post-close authority database has SQLite sidecars before snapshot.');
        }
        const before = fileArtifact(databasePath, 'Post-close live authority database');
        result.before = publicArtifact(before);
        const schemaVersion = context.readSchemaVersion(before.realPath);
        const after = fileArtifact(databasePath, 'Post-close live authority database');
        result.after = publicArtifact(after);
        result.sidecarsAfter = collectSidecarState(databasePath);
        if (!sameArtifact(before, after) || !result.sidecarsAfter.passed) {
            fail('Post-close authority database was not stable across schema inspection.');
        }
        result.schemaVersion = schemaVersion;
        result.snapshot = {
            database: publicArtifact(after),
            schemaVersion,
        };
        result.passed = true;
    }
    catch (error) {
        result.error = boundedError(error);
        result.snapshot = null;
        result.schemaVersion = null;
    }
    return result;
}

function collectPostCloseEvidence(context, preSpawnPackage, databasePath) {
    let postExitPackage = null;
    let packageError = null;
    let processState = null;
    let processError = null;
    try {
        postExitPackage = context.packageIdentity();
    }
    catch (error) {
        packageError = boundedError(error);
    }
    try {
        processState = context.listProcesses();
        validateProcessState(processState, 'AmazonAIOpsAgent post-exit process check');
    }
    catch (error) {
        processError = boundedError(error);
    }
    const database = collectStablePostExitDatabase(context, databasePath);
    const packageMatches = postExitPackage
        ? samePackageIdentity(preSpawnPackage, postExitPackage)
        : false;
    return {
        receipt: {
            status: 'COLLECTED_AFTER_OBSERVED_CLOSE',
            collectedAt: nowIso(context.now),
            package: {
                passed: Boolean(postExitPackage && packageMatches && !packageError),
                identity: postExitPackage ? receiptPackageIdentity(postExitPackage) : null,
                matchesPreSpawn: packageMatches,
                error: packageError,
            },
            processes: {
                passed: Boolean(processState && !processError),
                state: processState ? receiptProcessState(processState) : null,
                error: processError,
            },
            database,
        },
        packageIdentity: postExitPackage,
        processState,
        databaseSnapshot: database.snapshot,
    };
}

function holdReceipt(packetArtifact, packetHash, reason, fields, context) {
    const attempted = fields.packageLaunchAttempted === true;
    const packageLaunchState = normalizePackageLaunchState(fields.packageLaunched, attempted);
    return {
        kind: KIND,
        schemaVersion: SCHEMA_VERSION,
        generatedAt: nowIso(context.now),
        status: 'HOLD',
        passed: false,
        formalAcceptance: false,
        authorityDatabaseMutated: attempted ? null : false,
        authorityDatabaseMutationState: attempted
            ? 'UNKNOWN_AFTER_CONSUMED_LAUNCH_ATTEMPT'
            : 'NOT_LAUNCHED',
        packageLaunchAttempted: attempted,
        packageLaunched: packageLaunchState,
        operatorDirectAdsExecutionInvoked: false,
        adsExecutionInvoked: attempted ? null : false,
        packageAdsExecutionState: attempted ? 'UNKNOWN' : 'NOT_LAUNCHED',
        approvalPacket: publicArtifact(packetArtifact),
        approvalPayloadSha256: packetHash,
        launchIntent: fields.launchIntent || null,
        startupGate: fields.startupGate || null,
        recoveryOutputSecurity: fields.recoveryOutputSecurity || null,
        launchExclusiveWindow: fields.launchExclusiveWindow || null,
        launch: fields.launch || null,
        untrustedCandidate: fields.untrustedCandidate || null,
        postCloseEvidence: fields.postCloseEvidence || null,
        reason: String(reason).slice(0, 500),
        requiredNextStep: 'If a complete launch intent exists, do not reuse this packet. Preserve DB, sidecars, package diagnostics, intent, exclusive-window proof, and this HOLD receipt. Deleting or rolling back intent evidence is an integrity failure and requires HOLD plus a new packet and approval; local administrator deletion cannot be detected absolutely.',
    };
}

module.exports = { boundedUntrustedCandidate, collectSidecarState, collectStablePostExitDatabase, collectPostCloseEvidence, holdReceipt };

// 按职责复用原有严格校验，公共入口继续保持兼容。
const fs = require('node:fs');
const path = require('node:path');
const { readJsonArtifact, validateS7LiveMigrationAcceptanceReceipt, } = require('./verify-s7-live-migration-acceptance');
const { TARGET_VERSION, requireSqlite, readAppliedVersion, collectRowCounts, } = require('./migrate-current-user-db');
const { assertPacketPackageIdentity, loadMainStartupGateRuntime, postMigrationAuthorityContract, resolveCanonicalPaths, validateAuthoritySelection, validateExclusiveDbPreflight, validateMigrationInputs, validatePackageUi, validatePackageUpgradeSmoke } = require('./s7-launch-operator-authority.js');
const { startupGateArtifactBinding, startupGatePackageBinding, startupGateTrustedShellBinding } = require('./s7-launch-operator-bindings.js');
const { FINALIZATION_PACKET_KIND, FINALIZATION_PACKET_SCHEMA, KIND, PACKET_KIND, PACKET_SCHEMA_VERSION, SCHEMA_VERSION, STARTUP_GATE_ACTIVE_FILE, STARTUP_GATE_ACTIVE_KIND, STARTUP_GATE_ACTIVE_SCHEMA, STARTUP_GATE_ADMISSION_FILE, STARTUP_GATE_BOUND_FILE, STARTUP_GATE_CLOSED_FILE, STARTUP_GATE_CLOSED_KIND, STARTUP_GATE_CLOSED_SCHEMA, STARTUP_GATE_DIRECTORY_NAME, STARTUP_GATE_FINALIZED_FILE, STARTUP_GATE_HANDOFF_READY_FILE, STARTUP_GATE_HANDOFF_RELEASED_FILE, STARTUP_GATE_POST_MIGRATION_ADMITTED_FILE, SUPPORTED_SOURCE_VERSIONS, cleanAbsolute, exactKeys, exists, fail, normalizeSha, nowIso, publicArtifact, sameArtifact, samePath, sha256, stableJson } = require('./s7-launch-operator-contracts.js');
const { directPath, fileArtifact, noSidecars, readJsonStable, startupGateFileArtifact } = require('./s7-launch-operator-filesystem.js');
const { validateProcessState } = require('./s7-launch-operator-processes.js');
const { validateAuthorityDatabaseSecurity } = require('./s7-launch-operator-security.js');

function validateStage2Inputs(input, context) {
    const canonical = resolveCanonicalPaths(context);
    const requestedDb = cleanAbsolute(input.db, '--db');
    if (!samePath(requestedDb, canonical.databasePath)) {
        fail(`--db must be the canonical packaged AppData authority DB: ${canonical.databasePath}`);
    }
    const db = fileArtifact(requestedDb, 'Live authority database');
    const databaseWindowsSecurity = validateAuthorityDatabaseSecurity(context, db.realPath, 'Live authority database');
    noSidecars(db.realPath, 'Live authority database');
    const version = context.readSchemaVersion(db.realPath);
    if (!SUPPORTED_SOURCE_VERSIONS.includes(version)) {
        fail('Live authority schema must be exactly v0 or v11; other versions require recovery.');
    }
    const selection = readJsonStable(input.authoritySelection, 'Authority selection receipt');
    const currentSelection = context.inspectAuthority({
        dbPath: db.realPath,
        userDataDir: canonical.userDataDir,
        sha256: db.sha256,
        roamingAppData: canonical.roamingAppData,
        userProfile: canonical.userProfile,
    });
    validateAuthoritySelection(selection.value, currentSelection, db, canonical, context.now);
    const migration = readJsonStable(input.migrationManifest, 'Offline migration manifest');
    const verification = readJsonStable(input.migrationVerification, 'Migration verification receipt');
    const migrationVerificationRerun = validateMigrationInputs(migration, verification, db, context);
    if (Boolean(input.packageUiManifest) === Boolean(input.packageUpgradeSmoke)) {
        fail('Exactly one package UI manifest or package upgrade smoke receipt is required.');
    }
    const packageUiRead = readJsonStable(input.packageUiManifest || input.packageUpgradeSmoke, 'Package migration prerequisite');
    const packageIdentity = context.packageIdentity();
    const packageUi = (input.packageUpgradeSmoke ? validatePackageUpgradeSmoke : validatePackageUi)(packageUiRead.value, packageUiRead.artifact, packageIdentity, db, context);
    const processState = context.listProcesses();
    validateProcessState(processState, 'AmazonAIOpsAgent process preflight');
    const exclusive = validateExclusiveDbPreflight(context.exclusiveDbPreflight(db.realPath), 'Live authority DB preflight');
    const dbAfter = fileArtifact(db.realPath, 'Live authority database');
    if (!sameArtifact(db, dbAfter)) {
        fail('Live authority database drifted during Stage 2 preflight.');
    }
    noSidecars(dbAfter.realPath, 'Live authority database');
    return {
        canonical,
        db: publicArtifact(db),
        databaseWindowsSecurity,
        schemaVersion: version,
        authoritySelection: publicArtifact(selection.artifact),
        migrationManifest: publicArtifact(migration.artifact),
        migrationVerification: publicArtifact(verification.artifact),
        migrationVerificationRerun,
        package: packageIdentity,
        packageUi,
        processPreflight: {
            query: 'all-AmazonAIOpsAgent.exe-processes',
            passed: true,
            matchingCount: 0,
            unresolvedCount: 0,
        },
        offlineProof: exclusive,
    };
}

function packetSafety() {
    return {
        authorityDatabaseMutated: false,
        packageLaunched: 'NOT_LAUNCHED',
        operatorDirectAdsExecutionInvoked: false,
        packageAdsExecutionState: 'NOT_LAUNCHED',
        requiresExplicitUserApproval: true,
        migrationOnly: false,
        secretsIncluded: false,
        replayGuard: 'COMPLETE_INTENT_FILE_PRESENT',
        absoluteAdministratorReplayPrevention: false,
        intentLossRequiresHoldAndNewApproval: true,
    };
}

function packetInstructions() {
    return {
        userMustBePresent: true,
        noProductionStoreOrSession: true,
        consumedBeforeSpawn: true,
        suspendedLaunchHandoffRequired: true,
        administratorIntentDeletionDetectable: false,
        requiredNextStepAfterExit: 'pnpm run verify:s7-live-migration-acceptance -- --db <live-db> --authority-selection <authority-selection> --migration-manifest <offline-manifest> --migration-verification <migration-verification> --out <new-acceptance-receipt.json>',
    };
}

function approvalPayload(bindings, generatedAt) {
    return {
        kind: PACKET_KIND,
        schemaVersion: PACKET_SCHEMA_VERSION,
        generatedAt,
        bindings,
        safety: packetSafety(),
        instructions: packetInstructions(),
    };
}

function createPacket(input, context) {
    const bindings = validateStage2Inputs(input, context);
    const payload = approvalPayload(bindings, nowIso(context.now));
    const approvalPayloadSha256 = sha256(stableJson(payload));
    return {
        ...payload,
        confirmation: {
            approvalPayloadSha256,
            token: `LIVE-MIGRATION-${approvalPayloadSha256}`,
            exactMatchRequired: true,
        },
    };
}

function validatePacket(packet, artifact, context, confirmation) {
    if (!exactKeys(packet, [
        'kind',
        'schemaVersion',
        'generatedAt',
        'bindings',
        'safety',
        'instructions',
        'confirmation',
    ])
        || packet.kind !== PACKET_KIND
        || packet.schemaVersion !== PACKET_SCHEMA_VERSION
        || !exactKeys(packet?.confirmation, [
            'approvalPayloadSha256',
            'token',
            'exactMatchRequired',
        ])
        || stableJson(packet.safety) !== stableJson(packetSafety())
        || stableJson(packet.instructions) !== stableJson(packetInstructions())
        || packet.confirmation.exactMatchRequired !== true) {
        fail('Approval packet schema or immutable approval boundary is invalid.');
    }
    const payload = {
        kind: packet.kind,
        schemaVersion: packet.schemaVersion,
        generatedAt: packet.generatedAt,
        bindings: packet.bindings,
        safety: packet.safety,
        instructions: packet.instructions,
    };
    const hash = sha256(stableJson(payload));
    if (packet.confirmation.approvalPayloadSha256 !== hash
        || packet.confirmation.token !== `LIVE-MIGRATION-${hash}`
        || confirmation !== packet.confirmation.token) {
        fail('Live migration confirmation token does not exactly match the full approval payload.');
    }
    const generatedAt = Date.parse(packet.generatedAt || '');
    if (!Number.isFinite(generatedAt) || generatedAt > context.now().valueOf() + 60000) {
        fail('Approval packet timestamp is invalid or future-dated.');
    }
    return { payload, hash, artifact };
}

function finalizationSafety() {
    return {
        authorityDatabaseMutated: false,
        packageLaunched: false,
        adsExecutionInvoked: false,
        formalAppReadiness: false,
        explicitConfirmationRequired: true,
        finalizedReceiptCreatesStartupEligibilityOnly: true,
    };
}

function validateBoundGateArtifact(value, expectedPath, label, context) {
    const expected = startupGateArtifactBinding(value, `${label} receipt binding`);
    const actual = startupGateFileArtifact(expectedPath, label);
    const security = context.inspectWindowsPathSecurity(actual.realPath, {
        label,
        type: 'file',
        requireProtected: true,
    });
    if (security?.passed !== true
        || stableJson(startupGateArtifactBinding(actual, label)) !== stableJson(expected)) {
        fail(`${label} drifted or lost its protected Windows boundary.`);
    }
    return { artifact: actual, binding: expected };
}

function readGateJson(artifact, label) {
    try {
        return JSON.parse(fs.readFileSync(artifact.realPath, 'utf8').replace(/^\uFEFF/, ''));
    }
    catch {
        fail(`${label} is not valid JSON.`);
    }
}

function collectFinalizationEvidence(input, context) {
    const recovering = Boolean(input.recoverySnapshot);
    const approvalRead = readJsonStable(input.approvalPacket, 'Finalization approval packet');
    const packetIdentity = validatePacket(approvalRead.value, approvalRead.artifact, context, approvalRead.value?.confirmation?.token);
    const bindings = packetIdentity.payload.bindings;
    const canonical = resolveCanonicalPaths(context);
    if (!samePath(bindings?.canonical?.userDataDir, canonical.userDataDir)
        || !samePath(bindings?.db?.realPath, canonical.databasePath)) {
        fail('Finalization approval packet is not bound to the current canonical authority.');
    }
    const launchRead = readJsonStable(input.launchReceipt, 'Finalization launch receipt');
    const acceptanceRead = readJsonStable(input.acceptanceReceipt, 'Finalization readonly acceptance receipt');
    const launch = launchRead.value;
    if (recovering) {
        try {
            const security = context.inspectWindowsPathSecurity(launchRead.artifact.realPath, {
                label: 'Recovery original HOLD', type: 'file', requireProtected: true,
            });
            if (security?.passed !== true || security.inheritanceProtected !== true
                || security.ownerSid !== security.currentUserSid) {
                throw new Error('Recovery HOLD protected owner/ACL mismatch.');
            }
        }
        catch {
            fail('Recovery original HOLD requires its own current-user-owned, inheritance-protected ACL. '
                + 'Protect this existing HOLD file separately with defaultProtectWindowsFile, preserving its contents and file identity, then prepare recovery again.');
        }
    }
    const acceptance = validateS7LiveMigrationAcceptanceReceipt(acceptanceRead.value);
    if (!recovering && (launch?.kind !== KIND
        || launch?.schemaVersion !== SCHEMA_VERSION
        || launch?.status !== 'LAUNCHED_AWAITING_READONLY_ACCEPTANCE'
        || launch?.passed !== false
        || launch?.formalAcceptance !== false
        || launch?.authorityDatabaseMutated !== true
        || launch?.packageLaunched !== 'CONFIRMED_LAUNCHED'
        || launch?.operatorDirectAdsExecutionInvoked !== false
        || launch?.approvalPayloadSha256 !== packetIdentity.hash
        || stableJson(startupGateArtifactBinding(launch?.approvalPacket, 'Launch receipt approval packet')) !== stableJson(startupGateArtifactBinding(approvalRead.artifact, 'Current approval packet'))
        || launch?.startupGate?.admissionVerified !== true
        || launch?.startupGate?.windowsSecurityPassed !== true
        || Number(launch?.postLaunch?.schemaVersion) !== TARGET_VERSION
        || launch?.postCloseEvidence?.package?.passed !== true
        || launch?.postCloseEvidence?.processes?.passed !== true
        || launch?.postCloseEvidence?.database?.passed !== true
        || launch?.remainingAcceptanceDependencies?.separateReadonlyAcceptanceRequired !== true)) {
        fail('Launch receipt is not the exact successful migration handoff awaiting acceptance.');
    }
    const currentPackage = context.packageIdentity();
    if (!recovering)
        assertPacketPackageIdentity(approvalRead.value, currentPackage);
    const packageAtMigration = startupGatePackageBinding(recovering ? bindings.package : currentPackage);
    const shellAtMigration = startupGateTrustedShellBinding(context.trustedPowerShellIdentity());
    const database = startupGateFileArtifact(canonical.databasePath, 'Finalization authority database');
    noSidecars(database.realPath, 'Finalization authority database');
    const databaseSecurity = validateAuthorityDatabaseSecurity(context, database.realPath, 'Finalization authority database');
    if (Number(context.readSchemaVersion(database.realPath)) !== TARGET_VERSION
        || !samePath(acceptance?.inputs?.database?.realPath, database.realPath)
        || normalizeSha(acceptance?.inputs?.database?.sha256, 'Acceptance live database') !== database.sha256
        || Number(acceptance?.inputs?.database?.sizeBytes) !== database.sizeBytes) {
        fail(`Readonly acceptance does not bind the current v${TARGET_VERSION} authority database.`);
    }
    for (const [label, acceptanceArtifact, approvedArtifact] of [
        [
            'authority selection',
            acceptance?.inputs?.authoritySelection,
            bindings.authoritySelection,
        ],
        [
            'migration manifest',
            acceptance?.inputs?.migrationManifest,
            bindings.migrationManifest,
        ],
        [
            'migration verification',
            acceptance?.inputs?.migrationVerification,
            bindings.migrationVerification,
        ],
    ]) {
        if (!samePath(acceptanceArtifact?.realPath, approvedArtifact?.realPath)
            || normalizeSha(acceptanceArtifact?.sha256, `Acceptance ${label}`)
                !== normalizeSha(approvedArtifact?.sha256, `Approved ${label}`)
            || Number(acceptanceArtifact?.sizeBytes) !== Number(approvedArtifact?.sizeBytes)) {
            fail(`Readonly acceptance ${label} binding differs from approval.`);
        }
    }
    const processState = context.listProcesses();
    validateProcessState(processState, 'Finalization AmazonAIOpsAgent process preflight');
    const authority = context.inspectPostMigrationAuthority(database.realPath);
    if (authority?.targetVersion !== TARGET_VERSION
        || authority?.integrityCheck !== 'ok'
        || Number(authority?.foreignKeyViolationCount) !== 0
        || !Array.isArray(authority?.migrationRows)
        || authority.migrationRows.length !== TARGET_VERSION
        || !Array.isArray(authority?.requiredTables)
        || stableJson(authority)
            !== stableJson(postMigrationAuthorityContract(authority.migrationRows))) {
        fail(`Finalization authority contract is not the exact production v${TARGET_VERSION} contract.`);
    }
    let recovery = null;
    let admittedChain = null;
    let startupGate = launch.startupGate;
    if (recovering) {
        const runtime = loadMainStartupGateRuntime();
        admittedChain = runtime.inspectS7AdmittedRecoveryChain({
            canonicalUserDataDir: canonical.userDataDir,
            io: {
                inspectTrustedPowerShell: () => shellAtMigration,
                inspectWindowsPathSecurity: (filePath, type, label) => {
                    const security = context.inspectWindowsPathSecurity(filePath, { type, label, requireProtected: true });
                    return { ...security, unauthorizedRules: security.passed ? [] : ['untrusted'] };
                },
            },
        });
        const exitCode = runtime.requireS7PostWriteHold(launch, admittedChain, packetIdentity.hash);
        context.assertProcessAbsent(admittedChain.pid);
        context.assertProcessAbsent(admittedChain.helperPid);
        if (context.exclusiveDbPreflight(database.realPath)?.passed !== true)
            fail('Recovery database is still in use.');
        if (stableJson(startupGateArtifactBinding(launch.approvalPacket, 'HOLD approval'))
            !== stableJson(startupGateArtifactBinding(approvalRead.artifact, 'Original approval'))) {
            fail('Recovery HOLD does not bind the original approval packet.');
        }
        const originalIntent = validateBoundGateArtifact(admittedChain.active.bindings.intent, admittedChain.active.bindings.intent.realPath, 'Recovery original consumed intent', context);
        const intentDocument = readGateJson(originalIntent.artifact, 'Recovery original consumed intent');
        if (intentDocument.kind !== 's7-live-migration-launch-intent'
            || intentDocument.status !== 'CONSUMED_BEFORE_SPAWN'
            || intentDocument.approvalPayloadSha256 !== packetIdentity.hash
            || stableJson(startupGateArtifactBinding(launch.launchIntent, 'HOLD intent')) !== stableJson(originalIntent.binding)
            || stableJson(startupGateArtifactBinding(intentDocument.packet, 'Intent approval'))
                !== stableJson(startupGateArtifactBinding(approvalRead.artifact, 'Original approval'))
            || stableJson(startupGatePackageBinding(intentDocument.package)) !== stableJson(packageAtMigration)
            || stableJson(startupGateArtifactBinding(intentDocument.database, 'Intent database'))
                !== stableJson(admittedChain.active.bindings.database)) {
            fail('Recovery original intent/approval binding drifted.');
        }
        const snapshot = startupGateFileArtifact(input.recoverySnapshot, 'Recovery WAL-safe snapshot');
        if (samePath(snapshot.realPath, database.realPath))
            fail('Recovery backup must be distinct from live authority.');
        context.captureAuthorityCurrentness({ sourceDatabasePath: database.realPath, expectedSnapshotArtifact: snapshot });
        recovery = {
            failurePhase: 'child-exit-failed-before-closed-receipt', exitCode,
            backup: startupGateArtifactBinding(snapshot, 'Recovery WAL-safe snapshot'),
            intent: originalIntent.binding, package: startupGatePackageBinding(currentPackage),
        };
        startupGate = Object.fromEntries([
            ['active', admittedChain.activeRead], ['bound', admittedChain.boundRead],
            ['handoffReady', admittedChain.readyRead], ['handoffReleased', admittedChain.releasedRead],
            ['admission', admittedChain.admissionRead],
        ].map(([key, value]) => [key, value.artifact]));
    }
    const gateDirectory = path.join(canonical.userDataDir, STARTUP_GATE_DIRECTORY_NAME);
    const expectedPaths = {
        active: path.join(gateDirectory, STARTUP_GATE_ACTIVE_FILE),
        bound: path.join(gateDirectory, STARTUP_GATE_BOUND_FILE),
        handoffReady: path.join(gateDirectory, STARTUP_GATE_HANDOFF_READY_FILE),
        handoffReleased: path.join(gateDirectory, STARTUP_GATE_HANDOFF_RELEASED_FILE),
        admission: path.join(gateDirectory, STARTUP_GATE_ADMISSION_FILE),
        closed: path.join(gateDirectory, STARTUP_GATE_CLOSED_FILE),
        finalized: path.join(gateDirectory, STARTUP_GATE_FINALIZED_FILE),
        completion: path.join(gateDirectory, STARTUP_GATE_POST_MIGRATION_ADMITTED_FILE),
    };
    const gateDirectoryState = directPath(gateDirectory, 'Finalization startup gate directory', 'directory');
    const gateDirectorySecurity = context.inspectWindowsPathSecurity(gateDirectoryState.realPath, {
        label: 'Finalization startup gate directory',
        type: 'directory',
        requireProtected: true,
    });
    if (gateDirectorySecurity?.passed !== true) {
        fail('Finalization startup gate directory ACL proof failed.');
    }
    if (exists(expectedPaths.finalized) || exists(expectedPaths.completion)) {
        fail('FINALIZED or POST_MIGRATION_ADMITTED already exists; finalization is one-time.');
    }
    const chain = {};
    for (const [name, expectedPath] of Object.entries(expectedPaths)) {
        if (name === 'finalized' || name === 'completion')
            continue;
        if (recovering && name === 'closed') {
            if (exists(expectedPath))
                fail('Recovery cannot replace an existing CLOSED receipt.');
            continue;
        }
        chain[name] = validateBoundGateArtifact(startupGate?.[name], expectedPath, `Finalization ${name}`, context);
    }
    const activeDocument = readGateJson(chain.active.artifact, 'Finalization ACTIVE');
    const closedDocument = recovering ? null : readGateJson(chain.closed.artifact, 'Finalization CLOSED');
    if (activeDocument?.kind !== STARTUP_GATE_ACTIVE_KIND
        || activeDocument?.schemaVersion !== STARTUP_GATE_ACTIVE_SCHEMA
        || activeDocument?.status !== 'ACTIVE_AWAITING_BOUND_CHILD'
        || !samePath(activeDocument?.canonicalUserDataDir, canonical.userDataDir)
        || !samePath(activeDocument?.paths?.active, expectedPaths.active)
        || !samePath(activeDocument?.paths?.bound, expectedPaths.bound)
        || !samePath(activeDocument?.paths?.handoffReady, expectedPaths.handoffReady)
        || !samePath(activeDocument?.paths?.handoffReleased, expectedPaths.handoffReleased)
        || !samePath(activeDocument?.paths?.admission, expectedPaths.admission)
        || !samePath(activeDocument?.paths?.closed, expectedPaths.closed)
        || !samePath(activeDocument?.paths?.finalized, expectedPaths.finalized)
        || stableJson(startupGatePackageBinding(activeDocument?.bindings?.package))
            !== stableJson(packageAtMigration)
        || stableJson(startupGateTrustedShellBinding(activeDocument?.bindings?.shell))
            !== stableJson(shellAtMigration)
        || (!recovering && (closedDocument?.kind !== STARTUP_GATE_CLOSED_KIND
            || closedDocument?.schemaVersion !== STARTUP_GATE_CLOSED_SCHEMA
            || closedDocument?.status !== 'CLOSED_AFTER_GUARDED_MIGRATION'
            || closedDocument?.gateId !== activeDocument?.gateId
            || closedDocument?.invocationId !== activeDocument?.invocationId
            || Number(closedDocument?.exitCode) !== 0))) {
        fail('Finalization ACTIVE/CLOSED chain is invalid.');
    }
    const closedDatabase = recovering ? null : startupGateArtifactBinding(closedDocument.databaseAfterClose, 'CLOSED database after migration');
    const currentDatabaseBinding = startupGateArtifactBinding(database, 'Current database after migration');
    if (!recovering && (stableJson(closedDatabase) !== stableJson(currentDatabaseBinding)
        || stableJson(startupGateArtifactBinding(startupGate.databaseAfterClose, 'Launch receipt database after close')) !== stableJson(currentDatabaseBinding))) {
        fail('Finalization database differs from CLOSED and launch receipt bindings.');
    }
    for (const [label, actual, expected] of recovering ? [] : [
        ['ACTIVE', closedDocument.activeGate, chain.active.binding],
        ['BOUND', closedDocument.boundGate, chain.bound.binding],
        ['HANDOFF_READY', closedDocument.handoffReady, chain.handoffReady.binding],
        ['HANDOFF_RELEASED', closedDocument.handoffReleased, chain.handoffReleased.binding],
        ['ADMISSION', closedDocument.admission, chain.admission.binding],
    ]) {
        if (stableJson(startupGateArtifactBinding(actual, `CLOSED ${label}`))
            !== stableJson(expected)) {
            fail(`Finalization CLOSED ${label} chain binding drifted.`);
        }
    }
    const computerName = String(context.env.COMPUTERNAME || '').trim();
    if (!computerName || computerName.includes('\0')) {
        fail('Finalization Windows machine name is unavailable.');
    }
    if (recovering) {
        noSidecars(database.realPath, 'Recovery authority after backup');
        if (!sameArtifact(database, startupGateFileArtifact(database.realPath, 'Recovery stable authority'))
            || context.exclusiveDbPreflight(database.realPath)?.passed !== true) {
            fail('Recovery database drifted during validation.');
        }
        validateProcessState(context.listProcesses(), 'Recovery final process preflight');
        context.assertProcessAbsent(admittedChain.pid);
        context.assertProcessAbsent(admittedChain.helperPid);
    }
    return {
        canonical: {
            userDataDir: canonical.userDataDir,
            databasePath: canonical.databasePath,
            gateDirectory: gateDirectoryState.realPath,
            finalizedPath: expectedPaths.finalized,
            completionPath: expectedPaths.completion,
        },
        gate: {
            gateId: String(activeDocument.gateId),
            invocationId: String(activeDocument.invocationId),
            active: chain.active.binding,
            bound: chain.bound.binding,
            handoffReady: chain.handoffReady.binding,
            handoffReleased: chain.handoffReleased.binding,
            admission: chain.admission.binding,
            closed: chain.closed?.binding ?? null,
        },
        approvalPayloadSha256: packetIdentity.hash,
        approvalPacket: startupGateArtifactBinding(approvalRead.artifact, 'Finalization approval packet'),
        launchReceipt: startupGateArtifactBinding(launchRead.artifact, 'Finalization launch receipt'),
        acceptanceReceipt: startupGateArtifactBinding(acceptanceRead.artifact, 'Finalization acceptance receipt'),
        databaseAfterMigration: currentDatabaseBinding,
        packageAtMigration,
        shellAtMigration,
        machine: {
            computerName,
            currentUserSid: String(databaseSecurity.currentUserSid),
            databaseDeviceId: currentDatabaseBinding.identity.deviceId,
            databaseFileId: currentDatabaseBinding.identity.fileId,
        },
        authority,
        ...(recovery ? { recovery } : {}),
    };
}

function finalizationPayload(bindings, generatedAt) {
    return {
        kind: FINALIZATION_PACKET_KIND,
        schemaVersion: FINALIZATION_PACKET_SCHEMA,
        status: bindings.recovery ? 'AWAITING_POST_WRITE_RECOVERY_CONFIRMATION' : 'AWAITING_EXPLICIT_FINALIZATION_CONFIRMATION',
        generatedAt,
        bindings,
        safety: finalizationSafety(),
    };
}

function createFinalizationPacket(input, context) {
    const bindings = collectFinalizationEvidence(input, context);
    const payload = finalizationPayload(bindings, nowIso(context.now));
    const finalizationPayloadSha256 = sha256(stableJson(payload));
    return {
        ...payload,
        confirmation: {
            finalizationPayloadSha256,
            token: `FINALIZE-S7-${finalizationPayloadSha256}`,
            exactMatchRequired: true,
        },
    };
}

function validateFinalizationPacket(packet, confirmation) {
    if (!exactKeys(packet, [
        'kind',
        'schemaVersion',
        'status',
        'generatedAt',
        'bindings',
        'safety',
        'confirmation',
    ])
        || packet?.kind !== FINALIZATION_PACKET_KIND
        || packet?.schemaVersion !== FINALIZATION_PACKET_SCHEMA
        || packet?.status !== (packet?.bindings?.recovery ? 'AWAITING_POST_WRITE_RECOVERY_CONFIRMATION' : 'AWAITING_EXPLICIT_FINALIZATION_CONFIRMATION')
        || stableJson(packet?.safety) !== stableJson(finalizationSafety())
        || !exactKeys(packet?.confirmation, [
            'finalizationPayloadSha256',
            'token',
            'exactMatchRequired',
        ])
        || packet?.confirmation?.exactMatchRequired !== true) {
        fail('Finalization packet schema or immutable safety boundary is invalid.');
    }
    const payload = finalizationPayload(packet.bindings, packet.generatedAt);
    const hash = sha256(stableJson(payload));
    if (packet.confirmation.finalizationPayloadSha256 !== hash
        || packet.confirmation.token !== `FINALIZE-S7-${hash}`
        || confirmation !== packet.confirmation.token) {
        fail('Finalization confirmation token does not exactly match the full payload.');
    }
    return { payload, hash };
}

function parseArgs(argv) {
    if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
        if (argv.length > 1 && (argv.includes('--help') || argv.includes('-h'))) {
            fail('--help cannot be combined with other arguments.');
        }
        return { mode: 'help' };
    }
    const values = {};
    let mode = null;
    const allowed = new Set([
        'db',
        'authority-selection',
        'migration-manifest',
        'migration-verification',
        'package-ui-manifest',
        'package-upgrade-smoke',
        'approval-packet',
        'confirm-live-migration',
        'launch-receipt',
        'acceptance-receipt',
        'finalization-packet',
        'confirm-finalization',
        'recovery-snapshot',
        'recovery-root',
        'out',
    ]);
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if ([
            '--prepare',
            '--execute-approved',
            '--prepare-finalization',
            '--prepare-recovery',
            '--finalize-approved',
        ].includes(token)) {
            if (mode)
                fail('Exactly one mode is required.');
            mode = token.slice(2);
            continue;
        }
        if (!token.startsWith('--'))
            fail(`Unexpected positional argument: ${token}`);
        const name = token.slice(2);
        if (!allowed.has(name))
            fail(`Unknown argument: --${name}.`);
        if (Object.prototype.hasOwnProperty.call(values, name)) {
            fail(`Duplicate argument: --${name}.`);
        }
        const value = argv[index + 1];
        if (!value || value.startsWith('--'))
            fail(`--${name} requires a value.`);
        values[name] = value;
        index += 1;
    }
    if (!mode)
        fail('Exactly one mode is required.');
    const permittedByMode = {
        prepare: [
            'db',
            'authority-selection',
            'migration-manifest',
            'migration-verification',
            'package-ui-manifest',
            'package-upgrade-smoke',
            'recovery-root',
            'out',
        ],
        'execute-approved': [
            'approval-packet',
            'confirm-live-migration',
            'recovery-root',
            'out',
        ],
        'prepare-finalization': [
            'approval-packet',
            'launch-receipt',
            'acceptance-receipt',
            'recovery-root',
            'out',
        ],
        'prepare-recovery': [
            'approval-packet', 'launch-receipt', 'acceptance-receipt',
            'recovery-snapshot', 'recovery-root', 'out',
        ],
        'finalize-approved': [
            'finalization-packet',
            'confirm-finalization',
        ],
    };
    const required = permittedByMode[mode];
    if (!required)
        fail(`Unsupported mode: --${mode}.`);
    for (const key of required) {
        if (mode === 'prepare' && ['package-ui-manifest', 'package-upgrade-smoke'].includes(key))
            continue;
        if (!values[key])
            fail(`--${key} is required for --${mode}.`);
    }
    if (mode === 'prepare' && Boolean(values['package-ui-manifest']) === Boolean(values['package-upgrade-smoke'])) {
        fail('Exactly one of --package-ui-manifest or --package-upgrade-smoke is required.');
    }
    for (const key of Object.keys(values)) {
        if (!required.includes(key))
            fail(`--${key} is not permitted for --${mode}.`);
    }
    return { mode, values };
}

module.exports = { validateStage2Inputs, packetSafety, packetInstructions, approvalPayload, createPacket, validatePacket, finalizationSafety, validateBoundGateArtifact, readGateJson, collectFinalizationEvidence, finalizationPayload, createFinalizationPacket, validateFinalizationPacket, parseArgs };

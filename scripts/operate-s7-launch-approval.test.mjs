// 按证据职责拆分夹具与验收断言，测试仍归属原有入口。
import { EXCLUSIVE_WINDOW_HELPER_SCRIPT, REQUIRED_MIGRATION_VERIFICATION_CODES, describe, evaluatePackageUiEvidenceCompleteness, expect, fs, it, os, parseArgs, path, require, roots, run, validatePackageUpgradeSmoke } from './s7-launch-operator-test-environment.mjs';
import { setup } from './s7-launch-operator-test-setup.mjs';
import { clone, gateArtifact, passingVerification, sha, write } from './s7-launch-operator-test-artifacts.mjs';
import { executeArgs, prepare, prepareArgs } from './s7-launch-operator-test-workflow.mjs';
describe('operate-s7-live-migration-launch', () => {
it('validates the isolated upgrade startup/reopen proof without claiming package UI acceptance', () => {
    const s = setup(11);
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-upgrade-smoke-test-'));
    roots.push(profile);
    const Database = require('./migrate-current-user-db.js').requireSqlite();
    const sourcePath = path.join(s.root, 'source-snapshot.db');
    const isolatedPath = path.join(profile, 'amazon-ai-ops.db');
    const sourceDb = new Database(sourcePath);
    sourceDb.exec("CREATE TABLE payload (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO payload VALUES (1, 'preserved')");
    sourceDb.close();
    fs.copyFileSync(sourcePath, isolatedPath);
    const binding = (filePath) => ({ path: filePath, sha256: sha(fs.readFileSync(filePath)), sizeBytes: fs.statSync(filePath).size });
    const source = { ...binding(sourcePath), tableRowCounts: { payload: 1 } };
    const rehearsal = JSON.parse(fs.readFileSync(s.manifest, 'utf8'));
    rehearsal.source = { ...source, version: 11 };
    rehearsal.workingDatabase = { path: isolatedPath, upgradedSha256: binding(isolatedPath).sha256.toLowerCase() };
    write(s.manifest, rehearsal);
    const launches = [1, 2].map((index) => {
        const startedAt = `2026-07-29T00:${40 + index}:00.000Z`;
        const generatedAt = `2026-07-29T00:${40 + index}:02.000Z`;
        const runtimePath = path.join(s.root, `runtime-${index}.json`);
        const windowPath = path.join(s.root, `window-${index}.json`);
        const pid = 9000 + index;
        write(runtimePath, { pid, mode: 'package-launch-smoke', userDataDir: profile, generatedAt });
        write(windowPath, { kind: 'package-launch-window-ready', schemaVersion: 1, pid, browserWindowId: 1,
            evidenceMode: 'package-launch-smoke', userDataDir: profile, generatedAt,
            rendererUrl: new URL(`file:///${path.join(s.identity.appContent.realPath, 'dist', 'renderer', 'index.html').replaceAll('\\', '/')}`).href });
        return { startedAt, closedAt: `2026-07-29T00:${40 + index}:05.000Z`, pid, exitCode: 0,
            runtimeMarker: binding(runtimePath), windowReadyMarker: binding(windowPath),
            processObservation: { ProcessId: pid, ExecutablePath: s.identity.exe.realPath, MainWindowHandle: 123,
                WindowVisible: true, CreationDate: startedAt } };
    });
    const receipt = { kind: 's7-package-upgrade-smoke', schemaVersion: 1, generatedAt: '2026-07-29T00:50:00.000Z',
        formalAppReadiness: false, package: s.identity, sourceSnapshot: source, rehearsalManifestPath: s.manifest,
        isolatedUserDataDir: profile, isolatedGenesisSha256: binding(isolatedPath).sha256,
        isolatedDatabase: binding(isolatedPath), launches };
    const authorityPath = path.join(s.root, 'original-authority-snapshot.db');
    fs.copyFileSync(sourcePath, authorityPath);
    const authorityDb = new Database(authorityPath);
    authorityDb.pragma('journal_mode = WAL');
    authorityDb.close();
    receipt.authoritySnapshot = binding(authorityPath);
    const receiptPath = path.join(s.root, 'upgrade-smoke.json');
    write(receiptPath, receipt);
    const context = { ...s.context, verifyMigration: () => passingVerification(s.manifest),
        captureAuthorityCurrentness: ({ sourceDatabasePath, expectedSnapshotArtifact }) => {
            expect(sourceDatabasePath).toBe(s.db);
            expect(expectedSnapshotArtifact.sha256).toBe(receipt.authoritySnapshot.sha256);
        } };
    const artifact = gateArtifact(receiptPath);
    expect(validatePackageUpgradeSmoke(receipt, artifact, s.identity, gateArtifact(s.db), context)).toMatchObject({
        mode: 'package-upgrade-smoke', formalAppReadiness: false, launchCount: 2,
    });
    const changedPath = path.join(s.root, 'changed-authority-snapshot.db');
    fs.copyFileSync(sourcePath, changedPath);
    const changedDb = new Database(changedPath);
    changedDb.exec("UPDATE payload SET value = 'changed'");
    changedDb.close();
    const changed = clone(receipt);
    changed.authoritySnapshot = binding(changedPath);
    expect(() => validatePackageUpgradeSmoke(changed, artifact, s.identity, gateArtifact(s.db), {
        ...context, captureAuthorityCurrentness: () => { },
    })).toThrow(/logical contents/);
    const bad = clone(receipt);
    bad.launches[1].windowReadyMarker = bad.launches[0].windowReadyMarker;
    expect(() => validatePackageUpgradeSmoke(bad, artifact, s.identity, gateArtifact(s.db), context)).toThrow(/startup\/reopen/);
    const wrongPackage = clone(receipt);
    wrongPackage.package.main.sha256 = sha('old-main');
    expect(() => validatePackageUpgradeSmoke(wrongPackage, artifact, s.identity, gateArtifact(s.db), context)).toThrow(/current package/);
    expect(() => parseArgs([...prepareArgs(s, path.join(s.approvalOutputRoot, 'bad.json')), '--package-upgrade-smoke', receiptPath])).toThrow(/Exactly one/);
});

it('binds v11 rehearsal to the approved source and accepts its guarded child receipt', async () => {
    const s = setup(11);
    const prepared = await prepare(s);
    expect(prepared.packet.bindings.schemaVersion).toBe(11);
    const receipt = await run(executeArgs(prepared.packetPath, prepared.token, path.join(s.launchOutputRoot, 'v11-launch.json')), s.context);
    expect(receipt.exitCode).toBe(0);
    const bad = setup(11);
    const manifest = JSON.parse(fs.readFileSync(bad.manifest, 'utf8'));
    manifest.source.version = 0;
    write(bad.manifest, manifest);
    await expect(prepare(bad)).rejects.toThrow(/rehearsal for this DB/);
});

it('keeps help side-effect free and prepares a full-payload, v0-only approval packet', async () => {
    const s = setup();
    const before = fs.readdirSync(s.root, { recursive: true });
    await expect(run([], { ...s.context, platform: 'linux' })).resolves.toMatchObject({
        exitCode: 0,
        outputPath: null,
    });
    expect(fs.readdirSync(s.root, { recursive: true })).toEqual(before);
    const { packet } = await prepare(s);
    expect(packet.schemaVersion).toBe('s7-live-migration-approval-packet/v2');
    expect(packet.confirmation.token).toMatch(/^LIVE-MIGRATION-[A-F0-9]{64}$/);
    expect(packet.safety).toMatchObject({
        packageLaunched: 'NOT_LAUNCHED',
        requiresExplicitUserApproval: true,
        replayGuard: 'COMPLETE_INTENT_FILE_PRESENT',
        absoluteAdministratorReplayPrevention: false,
        intentLossRequiresHoldAndNewApproval: true,
        packageAdsExecutionState: 'NOT_LAUNCHED',
    });
    expect(packet.bindings.schemaVersion).toBe(0);
    expect(packet.bindings.offlineProof).toEqual({
        method: 'windows-fileshare-none',
        passed: true,
    });
    expect(packet.bindings.migrationVerificationRerun).toMatchObject({
        verifier: 'verifyS7MigrationBackupRestore',
        passed: true,
        checkCodes: REQUIRED_MIGRATION_VERIFICATION_CODES,
        summary: { total: 19, passed: 19, failed: 0 },
    });
    expect(packet.bindings.packageUi).toMatchObject({
        formalEvaluation: {
            evaluator: 'evaluatePackageUiEvidenceCompleteness',
            passed: true,
            violationCount: 0,
        },
        protectedDatabaseBinding: {
            path: fs.realpathSync.native(s.db),
            sha256: sha('v0-db'),
            beforeMatches: true,
            afterMatches: true,
        },
    });
    expect(packet.bindings.processPreflight).toEqual({
        query: 'all-AmazonAIOpsAgent.exe-processes',
        passed: true,
        matchingCount: 0,
        unresolvedCount: 0,
    });
    expect(fs.existsSync(path.join(s.userData, '.s7-live-migration-launch-intents'))).toBe(false);
});

it('requires an isolated recovery root outside package, userData, and every input artifact tree', async () => {
    const packageCase = setup();
    await expect(run(prepareArgs(packageCase, path.join(path.dirname(packageCase.exe), 'forbidden-package-output.json')), packageCase.context)).rejects.toThrow(/isolated from package root/i);
    const userDataCase = setup();
    await expect(run(prepareArgs(userDataCase, path.join(userDataCase.userData, 'forbidden-user-data-output.json')), userDataCase.context)).rejects.toThrow(/canonical packaged userData/i);
    const inputTreeCase = setup();
    await expect(run(prepareArgs(inputTreeCase, path.join(path.dirname(inputTreeCase.selection), 'forbidden-input-output.json')), inputTreeCase.context)).rejects.toThrow(/input artifact tree/i);
    const executeCase = setup();
    const prepared = await prepare(executeCase);
    await expect(run(executeArgs(prepared.packetPath, prepared.token, path.join(executeCase.approvalOutputRoot, 'forbidden-launch-receipt.json')), executeCase.context)).rejects.toThrow(/input artifact tree/i);
    expect(executeCase.getSpawns()).toBe(0);
});

it('rejects a self-asserted Package UI manifest that fails the formal v8 evaluator', async () => {
    const s = setup();
    s.context.evaluatePackageUiEvidence = evaluatePackageUiEvidenceCompleteness;
    await expect(run(prepareArgs(s, path.join(s.approvalOutputRoot, 'invalid-package-ui.json')), s.context)).rejects.toThrow(/formal Package UI/i);
});

it('binds Package UI before and after evidence to the exact current live DB', async () => {
    const s = setup();
    const ui = clone(s.uiValue);
    ui.protectedDatabase.after.sha256 = sha('another-db');
    write(s.ui, ui);
    await expect(run(prepareArgs(s, path.join(s.approvalOutputRoot, 'wrong-protected-db.json')), s.context)).rejects.toThrow(/live authority DB/i);
});

it('requires the exact 19-code receipt and an independent passing rerun', async () => {
    const s = setup();
    const receipt = clone(s.verificationValue);
    receipt.checks = [{ code: 'X', passed: true }];
    receipt.summary = { total: 1, passed: 1, failed: 0 };
    write(s.verification, receipt);
    await expect(run(prepareArgs(s, path.join(s.approvalOutputRoot, 'truncated.json')), s.context)).rejects.toThrow(/exact 19/i);
    const s2 = setup();
    s2.context.verifyMigration = () => ({
        ...clone(s2.verificationValue),
        passed: false,
    });
    await expect(run(prepareArgs(s2, path.join(s2.approvalOutputRoot, 'rerun-failed.json')), s2.context)).rejects.toThrow(/independently recomputed/i);
});

it('requires Windows, the Known-Folder canonical DB, exact v0, and current authority inventory', async () => {
    const s = setup();
    await expect(run(prepareArgs(s, path.join(s.approvalOutputRoot, 'linux.json')), {
        ...s.context,
        platform: 'linux',
    })).rejects.toThrow(/only on Windows/i);
    const alternate = path.join(s.root, 'alternate', 'amazon-ai-ops.db');
    write(alternate, 'v0-db');
    await expect(run(prepareArgs(s, path.join(s.approvalOutputRoot, 'alternate.json'), alternate), s.context)).rejects.toThrow(/canonical packaged AppData/i);
    const s2 = setup();
    s2.setSchema(1);
    await expect(run(prepareArgs(s2, path.join(s2.approvalOutputRoot, 'v1.json')), s2.context)).rejects.toThrow(/exactly v0/i);
    const s3 = setup();
    s3.context.inspectAuthority = () => {
        const current = clone(s3.selectionValue);
        current.selection.existingCandidateCount = 2;
        return current;
    };
    await expect(run(prepareArgs(s3, path.join(s3.approvalOutputRoot, 'stale-authority.json')), s3.context)).rejects.toThrow(/current strict canonical/i);
});

it('fails closed for any same-name process, unresolved process, or FileShare.None failure', async () => {
    const s = setup();
    s.context.listProcesses = () => ({
        passed: true,
        matching: [{ pid: 1, executablePath: 'C:\\installed\\AmazonAIOpsAgent.exe' }],
        unresolved: [],
    });
    await expect(run(prepareArgs(s, path.join(s.approvalOutputRoot, 'process.json')), s.context)).rejects.toThrow(/existing or unresolved/i);
    const s2 = setup();
    s2.context.listProcesses = () => ({
        passed: true,
        matching: [],
        unresolved: ['path-unresolved'],
    });
    await expect(run(prepareArgs(s2, path.join(s2.approvalOutputRoot, 'unresolved.json')), s2.context)).rejects.toThrow(/existing or unresolved/i);
    const s3 = setup();
    s3.context.exclusiveDbPreflight = () => ({
        method: 'windows-fileshare-none',
        passed: false,
    });
    await expect(run(prepareArgs(s3, path.join(s3.approvalOutputRoot, 'shared-db.json')), s3.context)).rejects.toThrow(/FileShare.None/i);
});

it.runIf(process.platform === 'win32')('obtains the real Windows FileShare.None proof against only a synthetic DB file', async () => {
    const s = setup();
    const { exclusiveDbPreflight: _syntheticExclusiveDbPreflight, ...contextWithRealExclusiveDbPreflight } = s.context;
    await expect(run(prepareArgs(s, path.join(s.approvalOutputRoot, 'real-fileshare-none.json')), contextWithRealExclusiveDbPreflight)).resolves.toMatchObject({ exitCode: 0 });
});

it('binds instructions into the confirmation token and rejects packet edits before spawn', async () => {
    const s = setup();
    const { packet, token } = await prepare(s);
    const originalPacket = clone(packet);
    packet.instructions.requiredNextStepAfterExit = 'claim READY';
    const edited = path.join(s.approvalOutputRoot, 'edited-approval.json');
    write(edited, packet);
    const result = await run(executeArgs(edited, token, path.join(s.launchOutputRoot, 'edited-hold.json')), s.context);
    expect(result.exitCode).toBe(1);
    expect(s.getSpawns()).toBe(0);
    expect(result.receipt.reason).toMatch(/immutable approval|full approval payload/i);
    const wrongKind = clone(originalPacket);
    wrongKind.kind = 'lookalike-live-migration-packet';
    const wrongKindPath = path.join(s.approvalOutputRoot, 'wrong-kind-approval.json');
    write(wrongKindPath, wrongKind);
    const wrongKindResult = await run(executeArgs(wrongKindPath, token, path.join(s.launchOutputRoot, 'wrong-kind-hold.json')), s.context);
    expect(wrongKindResult.exitCode).toBe(1);
    expect(s.getSpawns()).toBe(0);
    expect(wrongKindResult.receipt.reason).toMatch(/schema|immutable approval/i);
});

it('persists an untrusted READY-acquisition container even when no helper handle reaches the caller', async () => {
    const s = setup();
    const { packetPath, token } = await prepare(s);
    s.context.acquireLaunchExclusiveWindow = async () => {
        const error = new Error('synthetic READY timeout');
        error.code = 'PROTOCOL_TIMEOUT';
        error.proof = {
            protocol: 's7-live-migration-exclusive-window/v1',
            status: 'ACQUISITION_UNTRUSTED',
            helperPid: 7331,
            phase: 'await-ready',
            scriptSha256: sha(EXCLUSIVE_WINDOW_HELPER_SCRIPT),
            lateProofBuffer: {
                queuedProofs: [],
                partialText: '',
                partialBytes: 0,
                terminalCode: 'PROTOCOL_TIMEOUT',
                closeOutcome: { outcome: 'close', code: 1, signal: null },
            },
            helperInputState: 'CLOSE_REQUESTED',
            helperInputCloseError: null,
            helperProcessUnrefRequested: true,
            helperStdinUnrefRequested: true,
            helperStdoutUnrefRequested: true,
        };
        throw error;
    };
    const result = await run(executeArgs(packetPath, token, path.join(s.launchOutputRoot, 'ready-acquisition-hold.json')), s.context);
    expect(result.exitCode).toBe(1);
    expect(result.receipt.packageLaunched).toBe('NOT_LAUNCHED');
    expect(result.receipt.untrustedCandidate).toMatchObject({
        trust: 'UNTRUSTED_CANDIDATE_ONLY',
        source: 'HELPER_ERROR_PROOF',
        helperPid: 7331,
        phase: 'await-ready',
        scriptSha256: sha(EXCLUSIVE_WINDOW_HELPER_SCRIPT),
        helperInputState: 'CLOSE_REQUESTED',
        helperProcessUnrefRequested: true,
        lateProofBuffer: {
            queuedProofs: [],
            partialBytes: 0,
            terminalCode: 'PROTOCOL_TIMEOUT',
            closeOutcome: { outcome: 'close', code: 1, signal: null },
        },
    });
});

it('records CLOSE_FAILED instead of claiming helper input closed during pre-handoff abort', async () => {
    const s = setup();
    const { packetPath, token } = await prepare(s);
    s.context.ensureIntentDirectory = () => {
        throw new Error('synthetic intent directory failure');
    };
    s.context.abortUnlaunchedExclusiveWindow = () => ({
        helperInputState: 'CLOSE_FAILED',
        helperInputCloseError: {
            name: 'SyntheticCloseError',
            message: 'stdin close failed',
        },
        helperProcessUnrefRequested: true,
        helperStdinUnrefRequested: true,
        helperStdoutUnrefRequested: true,
        processKillInvoked: false,
        packageProcessCreated: false,
    });
    const result = await run(executeArgs(packetPath, token, path.join(s.launchOutputRoot, 'abort-close-failed-hold.json')), s.context);
    expect(result.exitCode).toBe(1);
    expect(result.receipt.packageLaunched).toBe('NOT_LAUNCHED');
    expect(result.receipt.launchExclusiveWindow.abort).toMatchObject({
        helperInputState: 'CLOSE_FAILED',
        helperInputCloseError: {
            name: 'SyntheticCloseError',
            message: 'stdin close failed',
        },
        processKillInvoked: false,
        packageProcessCreated: false,
    });
});

it('consumes the packet before spawn, blocks replay, and preserves a durable intent', async () => {
    const s = setup();
    const { packetPath, token } = await prepare(s);
    s.context.createSuspendedPackage = () => {
        throw new Error('synthetic spawn failure');
    };
    const first = await run(executeArgs(packetPath, token, path.join(s.launchOutputRoot, 'first-hold.json')), s.context);
    expect(first.exitCode).toBe(1);
    expect(first.receipt.launchIntent).not.toBeNull();
    expect(first.receipt.packageLaunchAttempted).toBe(true);
    expect(first.receipt.packageLaunched).toBe('UNKNOWN_AFTER_HANDOFF');
    const intentPath = first.receipt.launchIntent.realPath;
    expect(fs.existsSync(intentPath)).toBe(true);
    let replaySpawned = false;
    s.context.createSuspendedPackage = () => {
        replaySpawned = true;
        throw new Error('must not run');
    };
    const replay = await run(executeArgs(packetPath, token, path.join(s.launchOutputRoot, 'replay-hold.json')), s.context);
    expect(replay.exitCode).toBe(1);
    expect(replaySpawned).toBe(false);
    expect(replay.receipt.reason).toMatch(/already exists|overwritten/i);
});

it('keeps launch state UNKNOWN after a lost RESUMED proof and retains only bounded untrusted candidate facts', async () => {
    const s = setup();
    const { packetPath, token } = await prepare(s);
    const fixture = s.getProtocolFixture();
    s.context.releaseAndResumePackage = async () => {
        const error = new Error('synthetic helper release failure');
        error.code = 'PROTOCOL_SEQUENCE_MISMATCH';
        error.proof = {
            protocol: fixture.protocol,
            status: 'ERROR',
            helperPid: fixture.helperPid,
            pid: fixture.packagePid,
            phase: 'release-database-and-resume',
            processCreated: true,
            processResumed: false,
            databaseHandleExclusive: true,
            databaseHandleAcquired: true,
            databaseHandleReleased: false,
            releaseState: 'NOT_RELEASED',
            errorType: 'SyntheticFailure',
            observedAt: fixture.releasedAt,
            ignoredUnboundedField: 'must-not-be-copied',
        };
        throw error;
    };
    const result = await run(executeArgs(packetPath, token, path.join(s.launchOutputRoot, 'release-proof-hold.json')), s.context);
    expect(result.exitCode).toBe(1);
    expect(result.receipt.packageLaunched).toBe('UNKNOWN_AFTER_HANDOFF');
    expect(result.receipt.launch.resumed).toBe(false);
    expect(result.receipt.untrustedCandidate).toMatchObject({
        trust: 'UNTRUSTED_CANDIDATE_ONLY',
        trustedForDecision: false,
        source: 'HELPER_ERROR_PROOF',
        protocol: fixture.protocol,
        status: 'ERROR',
        candidatePid: fixture.packagePid,
        helperPid: fixture.helperPid,
        phase: 'release-database-and-resume',
        processCreated: true,
        processResumed: false,
        databaseHandleExclusive: true,
        databaseHandleAcquired: true,
        databaseHandleReleased: false,
        releaseState: 'NOT_RELEASED',
        errorType: 'SyntheticFailure',
        observedAt: fixture.releasedAt,
        knownErrorProofFieldsPreserved: true,
    });
    expect(result.receipt.untrustedCandidate).not.toHaveProperty('ignoredUnboundedField');
    const timeoutCase = setup();
    const timeoutPacket = await prepare(timeoutCase);
    timeoutCase.context.releaseAndResumePackage = async () => {
        const error = new Error('synthetic RESUMED proof timeout');
        error.code = 'PROTOCOL_TIMEOUT';
        throw error;
    };
    const timedOut = await run(executeArgs(timeoutPacket.packetPath, timeoutPacket.token, path.join(timeoutCase.launchOutputRoot, 'resume-timeout-hold.json')), timeoutCase.context);
    expect(timedOut.exitCode).toBe(1);
    expect(timedOut.receipt.packageLaunched).toBe('UNKNOWN_AFTER_HANDOFF');
    expect(timedOut.receipt.untrustedCandidate).toMatchObject({
        trust: 'UNTRUSTED_CANDIDATE_ONLY',
        trustedForDecision: false,
        source: 'LOCAL_HANDOFF_STATE',
        candidatePid: timeoutCase.getProtocolFixture().packagePid,
        processCreated: true,
        processResumed: null,
    });
});

it('requires ResumeThread == 1 and rejects out-of-order or future helper protocol timestamps', async () => {
    const resumeCountCase = setup();
    const resumeCountPacket = await prepare(resumeCountCase);
    const resumeFixture = resumeCountCase.getProtocolFixture();
    resumeCountCase.context.releaseAndResumePackage = async () => ({
        protocol: resumeFixture.protocol,
        status: 'RESUMED',
        helperPid: resumeFixture.helperPid,
        pid: resumeFixture.packagePid,
        finalSameNameInventoryPassed: true,
        finalSameNameProcessCount: 1,
        finalSameNameInventoryAt: resumeFixture.finalSameNameInventoryAt,
        finalQueriedExecutablePath: resumeCountCase.identity.exe.realPath,
        finalProcessImageQueryPassed: true,
        releasedAt: resumeFixture.releasedAt,
        resumedAt: resumeFixture.resumedAt,
        databaseHandleExclusive: false,
        resumeResult: 2,
    });
    const invalidCount = await run(executeArgs(resumeCountPacket.packetPath, resumeCountPacket.token, path.join(resumeCountCase.launchOutputRoot, 'resume-count-hold.json')), resumeCountCase.context);
    expect(invalidCount.exitCode).toBe(1);
    expect(invalidCount.receipt.packageLaunched).toBe('UNKNOWN_AFTER_HANDOFF');
    expect(invalidCount.receipt.reason).toMatch(/resume-under-lock|process resume/i);
    const futureCase = setup();
    const futurePacket = await prepare(futureCase);
    const futureFixture = futureCase.getProtocolFixture();
    futureCase.context.releaseAndResumePackage = async () => ({
        protocol: futureFixture.protocol,
        status: 'RESUMED',
        helperPid: futureFixture.helperPid,
        pid: futureFixture.packagePid,
        finalSameNameInventoryPassed: true,
        finalSameNameProcessCount: 1,
        finalSameNameInventoryAt: futureFixture.finalSameNameInventoryAt,
        finalQueriedExecutablePath: futureCase.identity.exe.realPath,
        finalProcessImageQueryPassed: true,
        releasedAt: futureFixture.releasedAt,
        resumedAt: '2026-07-29T01:02:00.000Z',
        databaseHandleExclusive: false,
        resumeResult: 1,
    });
    const future = await run(executeArgs(futurePacket.packetPath, futurePacket.token, path.join(futureCase.launchOutputRoot, 'future-proof-hold.json')), futureCase.context);
    expect(future.exitCode).toBe(1);
    expect(future.receipt.packageLaunched).toBe('UNKNOWN_AFTER_HANDOFF');
    expect(future.receipt.reason).toMatch(/future-dated/i);
    const orderCase = setup();
    const orderPacket = await prepare(orderCase);
    const orderFixture = orderCase.getProtocolFixture();
    orderCase.context.releaseAndResumePackage = async () => ({
        protocol: orderFixture.protocol,
        status: 'RESUMED',
        helperPid: orderFixture.helperPid,
        pid: orderFixture.packagePid,
        finalSameNameInventoryPassed: true,
        finalSameNameProcessCount: 1,
        finalSameNameInventoryAt: '2026-07-29T01:00:03.500Z',
        finalQueriedExecutablePath: orderCase.identity.exe.realPath,
        finalProcessImageQueryPassed: true,
        releasedAt: orderFixture.releasedAt,
        resumedAt: orderFixture.resumedAt,
        databaseHandleExclusive: false,
        resumeResult: 1,
    });
    const outOfOrder = await run(executeArgs(orderPacket.packetPath, orderPacket.token, path.join(orderCase.launchOutputRoot, 'out-of-order-proof-hold.json')), orderCase.context);
    expect(outOfOrder.exitCode).toBe(1);
    expect(outOfOrder.receipt.packageLaunched).toBe('UNKNOWN_AFTER_HANDOFF');
    expect(outOfOrder.receipt.reason).toMatch(/out of order/i);
});
});

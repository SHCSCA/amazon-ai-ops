// 按证据职责拆分夹具与验收断言，测试仍归属原有入口。
import { EXCLUSIVE_WINDOW_HELPER_SCRIPT, describe, enforceS7MainStartupGate, expect, fs, it, legacyV1Checksum, path, postMigrationAuthorityContract, run, vi } from './s7-launch-operator-test-environment.mjs';
import { executeArgs, finalizeArgs, prepare, prepareFinalizationArgs, preparePostWriteRecoveryFixture, writePassingAcceptance } from './s7-launch-operator-test-workflow.mjs';
import { clone, gateArtifact, gateBinding, sha, write } from './s7-launch-operator-test-artifacts.mjs';
import { setup } from './s7-launch-operator-test-setup.mjs';
describe('operate-s7-live-migration-launch', () => {
it('post-write recovery admits the new package without inventing CLOSED or altering the failed chain', async () => {
    const { s, packetPath, prepared, holdPath } = await preparePostWriteRecoveryFixture();
    const gate = s.getStartupGatePlan();
    const preserved = [gate.activePath, gate.boundPath, gate.handoffReadyPath, gate.handoffReleasedPath,
        gate.admissionPath, holdPath, s.db].map((file) => [file, fs.readFileSync(file)]);
    const finalized = await run(finalizeArgs(packetPath, prepared.receipt.confirmation.token), s.context);
    expect(finalized.receipt).toMatchObject({ status: 'RECOVERED_AFTER_FAILED_MIGRATION_PROCESS', closed: null,
        formalAppReadiness: false, adsExecutionAuthorized: false, recovery: { exitCode: 1 } });
    const app = { requestSingleInstanceLock: vi.fn(() => true) };
    const io = {
        inspectTrustedPowerShell: s.context.trustedPowerShellIdentity,
        inspectPostMigrationAuthority: s.context.inspectPostMigrationAuthority,
        inspectWindowsPathSecurity: (filePath, type) => ({ passed: true, path: filePath, type,
            ownerSid: 'S-1-5-21-synthetic', currentUserSid: 'S-1-5-21-synthetic', inheritanceProtected: true, unauthorizedRules: [] }),
        buildAppContentManifest: () => ({ realPath: s.identity.appContent.realPath,
            sha256: s.identity.appContent.sha256, sizeBytes: s.identity.appContent.sizeBytes,
            fileCount: s.identity.appContent.fileCount }),
        writeProtectedExclusiveJson: write,
    };
    const options = { app, currentUserDataDir: s.userData, canonicalUserDataDir: s.userData,
        evidenceUserDataIdentity: { mode: null, overridden: false, userDataDir: null }, isPackaged: true,
        executablePath: s.exe, mainModulePath: s.identity.main.realPath, pid: 9321, platform: 'win32',
        env: { COMPUTERNAME: 'SYNTHETIC-S7-HOST' }, io };
    expect(enforceS7MainStartupGate(options).mode).toBe('NORMAL_POST_MIGRATION');
    expect(enforceS7MainStartupGate(options).mode).toBe('NORMAL_POST_MIGRATION');
    expect(fs.existsSync(gate.closedPath)).toBe(false);
    for (const [file, bytes] of preserved)
        expect(fs.readFileSync(file)).toEqual(bytes);
    expect(s.context.captureAuthorityCurrentness).toHaveBeenCalledTimes(2);
    expect(EXCLUSIVE_WINDOW_HELPER_SCRIPT).toContain('exitCode=$observedExitCode');
});

it('post-write recovery rejects admission drift before publishing startup eligibility', async () => {
    const { s, packetPath, prepared, holdPath, args } = await preparePostWriteRecoveryFixture();
    const gate = s.getStartupGatePlan();
    const inspectSecurity = s.context.inspectWindowsPathSecurity;
    const deniedOutput = path.join(s.finalizationOutputRoot, 'inherited-hold-recovery.json');
    s.context.inspectWindowsPathSecurity = (filePath, options) => {
        const security = inspectSecurity(filePath, options);
        return path.resolve(filePath) === path.resolve(holdPath)
            ? { ...security, passed: true, inheritanceProtected: false } : security;
    };
    await expect(run(args.map((value) => value === packetPath ? deniedOutput : value), s.context))
        .rejects.toThrow(/Recovery original HOLD.*defaultProtectWindowsFile/);
    expect(fs.existsSync(deniedOutput)).toBe(false);
    s.context.inspectWindowsPathSecurity = inspectSecurity;
    const admission = JSON.parse(fs.readFileSync(gate.admissionPath, 'utf8'));
    admission.pid += 1;
    write(gate.admissionPath, admission);
    await expect(run(finalizeArgs(packetPath, prepared.receipt.confirmation.token), s.context))
        .rejects.toThrow(/ADMISSION binding is invalid/);
    expect(fs.existsSync(gate.closedPath)).toBe(false);
    expect(fs.existsSync(gate.finalizedPath)).toBe(false);
});

it('requires a second explicit confirmation and atomically publishes FINALIZED exactly once', async () => {
    const s = setup();
    const approved = await prepare(s);
    const launchReceipt = path.join(s.launchOutputRoot, 'launch.json');
    const launched = await run(executeArgs(approved.packetPath, approved.token, launchReceipt), s.context);
    expect(launched.exitCode).toBe(0);
    const currentDatabaseBinding = gateBinding(gateArtifact(s.db));
    const closedDocument = JSON.parse(fs.readFileSync(s.getStartupGatePlan().closedPath, 'utf8'));
    expect(closedDocument.databaseAfterClose).toEqual(currentDatabaseBinding);
    expect(gateBinding(launched.receipt.startupGate.databaseAfterClose)).toEqual(currentDatabaseBinding);
    const acceptanceReceipt = writePassingAcceptance(s, approved.packet);
    const finalizationPacket = path.join(s.finalizationOutputRoot, 'finalization.json');
    const prepared = await run(prepareFinalizationArgs(s, approved.packetPath, launchReceipt, acceptanceReceipt, finalizationPacket), s.context);
    expect(prepared.exitCode).toBe(0);
    expect(prepared.receipt).toMatchObject({
        kind: 's7-live-migration-finalization-packet',
        schemaVersion: 's7-live-migration-finalization-packet/v1',
        status: 'AWAITING_EXPLICIT_FINALIZATION_CONFIRMATION',
        safety: {
            authorityDatabaseMutated: false,
            packageLaunched: false,
            adsExecutionInvoked: false,
            formalAppReadiness: false,
            explicitConfirmationRequired: true,
            finalizedReceiptCreatesStartupEligibilityOnly: true,
        },
    });
    const gate = s.getStartupGatePlan();
    expect(fs.existsSync(gate.finalizedPath)).toBe(false);
    await expect(run(finalizeArgs(finalizationPacket, 'FINALIZE-S7-WRONG'), s.context)).rejects.toThrow(/confirmation token/i);
    expect(fs.existsSync(gate.finalizedPath)).toBe(false);
    const finalized = await run(finalizeArgs(finalizationPacket, prepared.receipt.confirmation.token), s.context);
    expect(finalized.exitCode).toBe(0);
    expect(finalized.outputPath).toBe(fs.realpathSync.native(gate.finalizedPath));
    expect(finalized.receipt).toMatchObject({
        kind: 's7-main-startup-gate-finalized',
        schemaVersion: 's7-main-startup-gate-finalized/v1',
        status: 'FINALIZED_FOR_POST_MIGRATION_STARTUP',
        gateId: gate.gateId,
        invocationId: gate.invocationId,
        formalAppReadiness: false,
        adsExecutionAuthorized: false,
    });
    expect(finalized.receipt.finalizationPayloadSha256).toMatch(/^[A-F0-9]{64}$/);
    expect(fs.existsSync(gate.finalizedPath)).toBe(true);
    expect(fs.existsSync(path.join(path.dirname(gate.finalizedPath), 'POST_MIGRATION_ADMITTED.json'))).toBe(false);
    await expect(run(finalizeArgs(finalizationPacket, prepared.receipt.confirmation.token), s.context)).rejects.toThrow(/FINALIZED|one-time|replay/i);
});

it('blocks finalization when the current authority no longer matches the exact v11 schema contract', async () => {
    const s = setup();
    const approved = await prepare(s);
    const launchReceipt = path.join(s.launchOutputRoot, 'launch.json');
    await run(executeArgs(approved.packetPath, approved.token, launchReceipt), s.context);
    const acceptanceReceipt = writePassingAcceptance(s, approved.packet);
    s.context.inspectPostMigrationAuthority = () => {
        const contract = clone(postMigrationAuthorityContract());
        contract.requiredTables.pop();
        return contract;
    };
    const finalizationPacket = path.join(s.finalizationOutputRoot, 'invalid-v11-schema-finalization.json');
    await expect(run(prepareFinalizationArgs(s, approved.packetPath, launchReceipt, acceptanceReceipt, finalizationPacket), s.context)).rejects.toThrow(/exact production v20 contract/i);
    expect(fs.existsSync(finalizationPacket)).toBe(false);
    expect(fs.existsSync(s.getStartupGatePlan().finalizedPath)).toBe(false);
});

it('allows the explicit legacy v1 checksum through finalization while rejecting unknown v1', async () => {
    const s = setup();
    const legacyRows = clone(postMigrationAuthorityContract().migrationRows);
    legacyRows[0].checksum = legacyV1Checksum();
    const legacyAuthority = postMigrationAuthorityContract(legacyRows);
    s.context.inspectPostMigrationAuthority = () => clone(legacyAuthority);
    const approved = await prepare(s);
    const launchReceipt = path.join(s.launchOutputRoot, 'legacy-v1-launch.json');
    await run(executeArgs(approved.packetPath, approved.token, launchReceipt), s.context);
    const acceptanceReceipt = writePassingAcceptance(s, approved.packet, 'legacy-v1.json');
    const finalizationPacket = path.join(s.finalizationOutputRoot, 'legacy-v1.json');
    const prepared = await run(prepareFinalizationArgs(s, approved.packetPath, launchReceipt, acceptanceReceipt, finalizationPacket), s.context);
    const finalized = await run(finalizeArgs(finalizationPacket, prepared.receipt.confirmation.token), s.context);
    expect(finalized.exitCode).toBe(0);
    expect(finalized.receipt.authority.migrationRows[0].checksum).toBe(legacyV1Checksum());
    const unknownRows = clone(postMigrationAuthorityContract().migrationRows);
    unknownRows[0].checksum = 'unknown-v1-checksum';
    expect(() => postMigrationAuthorityContract(unknownRows))
        .toThrow(/exact allowed v1/i);
});

it('blocks finalization when the authority contract hash is not self-bound to its rows', async () => {
    const s = setup();
    const approved = await prepare(s);
    const launchReceipt = path.join(s.launchOutputRoot, 'hash-drift-launch.json');
    await run(executeArgs(approved.packetPath, approved.token, launchReceipt), s.context);
    const acceptanceReceipt = writePassingAcceptance(s, approved.packet, 'hash-drift.json');
    s.context.inspectPostMigrationAuthority = () => ({
        ...clone(postMigrationAuthorityContract()),
        contractSha256: 'A'.repeat(64),
    });
    const finalizationPacket = path.join(s.finalizationOutputRoot, 'hash-drift.json');
    await expect(run(prepareFinalizationArgs(s, approved.packetPath, launchReceipt, acceptanceReceipt, finalizationPacket), s.context)).rejects.toThrow(/exact production v20 contract/i);
    expect(fs.existsSync(finalizationPacket)).toBe(false);
});

it('rejects incomplete or internally inconsistent acceptance receipts before finalization', async () => {
    const s = setup();
    const approved = await prepare(s);
    const launchReceipt = path.join(s.launchOutputRoot, 'launch.json');
    await run(executeArgs(approved.packetPath, approved.token, launchReceipt), s.context);
    const cases = [
        ['missing', (receipt) => {
                receipt.checks.pop();
                receipt.summary.total -= 1;
                receipt.summary.passed -= 1;
            }, /exact complete.*check/i],
        ['duplicate', (receipt) => {
                receipt.checks[1] = structuredClone(receipt.checks[0]);
            }, /exact complete.*check/i],
        ['extra', (receipt) => {
                receipt.checks.push({
                    code: 'UNRECOGNIZED_ACCEPTANCE_CHECK',
                    passed: true,
                    detail: 'must be rejected',
                });
                receipt.summary.total += 1;
                receipt.summary.passed += 1;
            }, /exact complete.*check/i],
        ['failed', (receipt) => {
                receipt.checks[0].passed = false;
                receipt.summary.passed -= 1;
                receipt.summary.failed = 1;
            }, /all-passed check/i],
        ['summary', (receipt) => {
                receipt.summary.total -= 1;
            }, /summary.*complete passed proof/i],
        ['safety', (receipt) => {
                receipt.safety.liveDatabaseQueryOnly = false;
            }, /safety proof/i],
        ['offline-proof', (receipt) => {
                receipt.summary.offlineArtifacts.restore.sourceBaselineRowsMatch = false;
            }, /restore artifact.*proof/i],
        ['recovery', (receipt) => {
                receipt.summary.recovery.canRestore = false;
            }, /recovery proof/i],
    ];
    for (const [label, mutate, message] of cases) {
        const acceptanceReceipt = writePassingAcceptance(s, approved.packet, `acceptance-${label}.json`);
        const receipt = JSON.parse(fs.readFileSync(acceptanceReceipt, 'utf8'));
        mutate(receipt);
        write(acceptanceReceipt, receipt);
        await expect(run(prepareFinalizationArgs(s, approved.packetPath, launchReceipt, acceptanceReceipt, path.join(s.finalizationOutputRoot, `finalization-${label}.json`)), s.context), label).rejects.toThrow(message);
    }
    expect(fs.existsSync(s.getStartupGatePlan().finalizedPath)).toBe(false);
}, 30000);

it('blocks finalization when readonly acceptance or immutable packet bindings drift', async () => {
    const acceptanceDrift = setup();
    const approved = await prepare(acceptanceDrift);
    const launchReceipt = path.join(acceptanceDrift.launchOutputRoot, 'launch.json');
    await run(executeArgs(approved.packetPath, approved.token, launchReceipt), acceptanceDrift.context);
    const acceptanceReceipt = writePassingAcceptance(acceptanceDrift, approved.packet);
    const acceptance = JSON.parse(fs.readFileSync(acceptanceReceipt, 'utf8'));
    acceptance.inputs.database.sha256 = sha('different-database');
    write(acceptanceReceipt, acceptance);
    await expect(run(prepareFinalizationArgs(acceptanceDrift, approved.packetPath, launchReceipt, acceptanceReceipt, path.join(acceptanceDrift.finalizationOutputRoot, 'acceptance-drift.json')), acceptanceDrift.context)).rejects.toThrow(/acceptance.*database|bind.*database/i);
    expect(fs.existsSync(acceptanceDrift.getStartupGatePlan().finalizedPath)).toBe(false);
    const packetDrift = setup();
    const secondApproval = await prepare(packetDrift);
    const secondLaunch = path.join(packetDrift.launchOutputRoot, 'launch.json');
    await run(executeArgs(secondApproval.packetPath, secondApproval.token, secondLaunch), packetDrift.context);
    const secondAcceptance = writePassingAcceptance(packetDrift, secondApproval.packet);
    const finalizationPacket = path.join(packetDrift.finalizationOutputRoot, 'packet-drift.json');
    const prepared = await run(prepareFinalizationArgs(packetDrift, secondApproval.packetPath, secondLaunch, secondAcceptance, finalizationPacket), packetDrift.context);
    const packet = JSON.parse(fs.readFileSync(finalizationPacket, 'utf8'));
    packet.bindings.machine.computerName = 'DIFFERENT-HOST';
    write(finalizationPacket, packet);
    await expect(run(finalizeArgs(finalizationPacket, prepared.receipt.confirmation.token), packetDrift.context)).rejects.toThrow(/confirmation token|full payload/i);
    expect(fs.existsSync(packetDrift.getStartupGatePlan().finalizedPath)).toBe(false);
});
});

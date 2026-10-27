// 按证据职责拆分夹具与验收断言，测试仍归属原有入口。
import { REQUIRED_LIVE_MIGRATION_ACCEPTANCE_CHECK_CODES, REQUIRED_TABLES, TARGET_VERSION, expect, fileArtifact, fs, path, run, validateS7LiveMigrationAcceptanceReceipt, vi } from './s7-launch-operator-test-environment.mjs';
import { gateArtifact, sha, write } from './s7-launch-operator-test-artifacts.mjs';
import { setup } from './s7-launch-operator-test-setup.mjs';
function prepareArgs(s, out, db = s.db) {
    return [
        '--prepare',
        '--db',
        db,
        '--authority-selection',
        s.selection,
        '--migration-manifest',
        s.manifest,
        '--migration-verification',
        s.verification,
        '--package-ui-manifest',
        s.ui,
        '--recovery-root',
        path.dirname(out),
        '--out',
        out,
    ];
}

async function prepare(s, name = 'approval.json') {
    const packetPath = path.join(s.approvalOutputRoot, name);
    await run(prepareArgs(s, packetPath), s.context);
    const packet = JSON.parse(fs.readFileSync(packetPath, 'utf8'));
    return { packet, packetPath, token: packet.confirmation.token };
}

function executeArgs(packetPath, token, out) {
    return [
        '--execute-approved',
        '--approval-packet',
        packetPath,
        '--confirm-live-migration',
        token,
        '--recovery-root',
        path.dirname(out),
        '--out',
        out,
    ];
}

function writePassingAcceptance(s, packet, name = 'acceptance.json') {
    const database = gateArtifact(s.db);
    const inputArtifact = (value) => ({
        path: value.realPath,
        realPath: value.realPath,
        sha256: value.sha256,
        sizeBytes: value.sizeBytes,
    });
    const offlineArtifact = (kind) => ({
        path: path.join(s.root, `${kind}.db`),
        identity: {
            realPath: path.join(s.root, `${kind}.db`),
            dev: kind === 'offline-working' ? 101 : 102,
            ino: kind === 'offline-working' ? 201 : 202,
            birthtimeMs: 1785307800000,
            nlink: 1,
        },
        sha256: sha(`${kind}-sha`),
        sizeBytes: 8192,
        openedReadOnly: true,
        queryOnly: true,
        integrityCheck: 'ok',
        ...(kind === 'offline-working'
            ? {
                foreignKeyViolationCount: 0,
                migrationCount: TARGET_VERSION,
                businessRowPreservationPassed: true,
                recoveryCanRestore: true,
            }
            : {
                version: 0,
                sourceBaselineRowsMatch: true,
            }),
        mtimeMs: 1785307800000,
        sidecarsAbsentBeforeAndAfter: true,
    });
    const acceptancePath = path.join(s.acceptanceOutputRoot, name);
    const receipt = {
        kind: 's7-live-migration-acceptance',
        schemaVersion: 's7-live-migration-acceptance/v1',
        generatedAt: '2026-07-29T01:10:00.000Z',
        status: 'PASSED',
        passed: true,
        formalEvidence: true,
        authorityDatabaseMutated: false,
        adsExecutionInvoked: false,
        inputs: {
            database: {
                path: database.realPath,
                realPath: database.realPath,
                sha256: database.sha256,
                sizeBytes: database.sizeBytes,
                logicalSnapshotSha256: sha(`synthetic-logical-v${TARGET_VERSION}`),
                logicalSnapshotSizeBytes: database.sizeBytes,
            },
            authoritySelection: inputArtifact(packet.bindings.authoritySelection),
            migrationManifest: inputArtifact(packet.bindings.migrationManifest),
            migrationVerification: inputArtifact(packet.bindings.migrationVerification),
        },
        checks: REQUIRED_LIVE_MIGRATION_ACCEPTANCE_CHECK_CODES.map((code) => ({
            code,
            passed: true,
            detail: 'production acceptance contract fixture',
        })),
        summary: {
            total: REQUIRED_LIVE_MIGRATION_ACCEPTANCE_CHECK_CODES.length,
            passed: REQUIRED_LIVE_MIGRATION_ACCEPTANCE_CHECK_CODES.length,
            failed: 0,
            integrityCheck: 'ok',
            foreignKeyViolationCount: 0,
            migrationCount: TARGET_VERSION,
            requiredTableCount: REQUIRED_TABLES.length,
            offlineArtifacts: {
                pathsDistinct: true,
                working: offlineArtifact('offline-working'),
                restore: offlineArtifact('offline-restore'),
            },
            businessRowPreservation: {
                passed: true,
                failureCount: 0,
                listingCurrentToHistoryTransferApplied: true,
                listingCurrentToHistoryTransferPassed: true,
            },
            recovery: {
                sourceVersion: 0,
                targetVersion: TARGET_VERSION,
                backupPath: path.join(s.root, `accepted-v${TARGET_VERSION}-backup.db`),
                backupSha256: sha(`accepted-v${TARGET_VERSION}-backup`),
                backupSizeBytes: 8192,
                manifestPath: path.join(s.root, `accepted-v${TARGET_VERSION}-backup.manifest.json`),
                manifestSha256: sha(`accepted-v${TARGET_VERSION}-backup-manifest`),
                backupIntegrityCheck: 'ok',
                schemaFingerprintMatches: true,
                tableRowCountsMatch: true,
                embeddedManifestMatchesAdjacentFile: true,
                canRestore: true,
                blockerCount: 0,
            },
        },
        safety: {
            liveDatabaseAccess: 'readonly-sqlite-online-backup',
            liveDatabaseOpenedReadOnly: true,
            liveDatabaseQueryOnly: true,
            logicalSnapshotInspectedReadOnly: true,
            walAwareSnapshotProofCount: 2,
            authorityDatabaseMutated: false,
            adsExecutionInvoked: false,
            businessRowContentIncluded: false,
            rawSecretsIncluded: false,
        },
    };
    expect(validateS7LiveMigrationAcceptanceReceipt(receipt)).toEqual(receipt);
    write(acceptancePath, receipt);
    return acceptancePath;
}

function prepareFinalizationArgs(s, approvalPacket, launchReceipt, acceptanceReceipt, out) {
    return [
        '--prepare-finalization',
        '--approval-packet',
        approvalPacket,
        '--launch-receipt',
        launchReceipt,
        '--acceptance-receipt',
        acceptanceReceipt,
        '--recovery-root',
        s.finalizationOutputRoot,
        '--out',
        out,
    ];
}

function finalizeArgs(finalizationPacket, token) {
    return [
        '--finalize-approved',
        '--finalization-packet',
        finalizationPacket,
        '--confirm-finalization',
        token,
    ];
}

async function preparePostWriteRecoveryFixture() {
    const s = setup(11);
    const fixtureMtime = fileArtifact(s.db, 'Recovery fixture authority').mtimeMs;
    s.uiValue.protectedDatabase.before.mtimeMs = fixtureMtime;
    s.uiValue.protectedDatabase.after.mtimeMs = fixtureMtime;
    write(s.ui, s.uiValue);
    const approved = await prepare(s);
    const originalWait = s.context.waitForManagedPackageClose;
    s.context.waitForManagedPackageClose = async () => {
        await originalWait();
        fs.unlinkSync(s.getStartupGatePlan().closedPath);
        const ids = s.getProtocolFixture();
        return { outcome: 'process-monitor-error', errorCode: 'PROTOCOL_SEQUENCE_MISMATCH', errorProof: {
                protocol: ids.protocol, status: 'ERROR', pid: ids.packagePid, helperPid: ids.helperPid,
                phase: 'child-exit-failed-before-closed-receipt', processCreated: true, processResumed: true,
                databaseHandleAcquired: true, databaseHandleReleased: true, databaseHandleExclusive: false,
                releaseState: 'RELEASED', errorType: 'RuntimeException', exitCode: 1,
            } };
    };
    const holdPath = path.join(s.launchOutputRoot, 'post-write-hold.json');
    const held = await run(executeArgs(approved.packetPath, approved.token, holdPath), s.context);
    expect(held.receipt.status).toBe('HOLD');
    expect(held.receipt.untrustedCandidate.exitCode).toBe(1);
    const acceptance = writePassingAcceptance(s, approved.packet);
    const snapshot = path.join(s.evidence ?? path.dirname(s.manifest), 'post-write-backup.db');
    fs.copyFileSync(s.db, snapshot);
    s.context.assertProcessAbsent = vi.fn();
    s.context.captureAuthorityCurrentness = vi.fn(({ sourceDatabasePath, expectedSnapshotArtifact }) => {
        expect(fileArtifact(sourceDatabasePath, 'fixture source').sha256).toBe(expectedSnapshotArtifact.sha256);
    });
    write(s.identity.main.realPath, 'new-recovery-main');
    s.identity.main = fileArtifact(s.identity.main.realPath, 'fixture recovery Main');
    s.identity.appContent = { ...s.identity.appContent, sha256: sha('new-recovery-app'), sizeBytes: 17 };
    const packetPath = path.join(s.finalizationOutputRoot, 'recovery.json');
    const args = ['--prepare-recovery', '--approval-packet', approved.packetPath,
        '--launch-receipt', holdPath, '--acceptance-receipt', acceptance,
        '--recovery-snapshot', snapshot, '--recovery-root', s.finalizationOutputRoot, '--out', packetPath];
    const prepared = await run(args, s.context);
    return { s, approved, held, holdPath, snapshot, packetPath, prepared, args };
}
export { prepareArgs, prepare, executeArgs, writePassingAcceptance, prepareFinalizationArgs, finalizeArgs, preparePostWriteRecoveryFixture };

// 按职责复用原有严格校验，公共入口继续保持兼容。
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { fail, pathDescriptor, requireFromLocalDb } = require('./stage8-operator-contracts.js');
const { normalizedCanaryOptions, readinessArgs, runtimeOverrides } = require('./stage8-operator-preflight.js');
const { inspectStores } = require('./stage8-operator-stores.js');

function formalOutputPaths(exportRoot, context = {}) {
    const now = context.now ? context.now() : new Date();
    const stamp = now.toISOString().replace(/[:.]/g, '-');
    const nonce = String(context.randomUUID ? context.randomUUID() : crypto.randomUUID()).replace(/[^A-Za-z0-9-]/g, '').slice(0, 36);
    const suffix = `${stamp}-${nonce}`;
    return {
        authoritySnapshotDirectory: path.join(exportRoot, 'authority-snapshots', `stage8-${suffix}`),
        continuousPath: path.join(exportRoot, 'continuous-operation', `stage8-continuous-${suffix}.json`),
        manualCanaryPath: path.join(exportRoot, 'execution-canaries', `stage8-manual-${suffix}.json`),
        policyCanaryPath: path.join(exportRoot, 'execution-canaries', `stage8-policy-${suffix}.json`),
        readinessPath: path.join(exportRoot, `mission-control-production-readiness-stage8-${suffix}.json`),
    };
}

function ensureFormalOutputsAbsent(paths) {
    for (const candidate of Object.values(paths)) {
        if (fs.existsSync(candidate)) {
            fail('A planned Stage 8 formal output already exists; no export was started.');
        }
    }
}

function captureSynchronousStdout(callback) {
    const original = process.stdout.write;
    let captured = '';
    process.stdout.write = function patchedWrite(value, ...rest) {
        captured += String(value);
        const callbackArg = rest.find((item) => typeof item === 'function');
        if (callbackArg)
            callbackArg();
        return true;
    };
    try {
        return { captured, result: callback() };
    }
    finally {
        process.stdout.write = original;
    }
}

function inspectImmutableSnapshotStoreGate(databasePath, selectedIds, context = {}) {
    const Database = context.Database || requireFromLocalDb('better-sqlite3');
    const database = new Database(databasePath, { fileMustExist: true, readonly: true });
    try {
        database.pragma('query_only = ON');
        const generatedAt = (context.now ? context.now() : new Date()).toISOString();
        const stores = inspectStores(database, selectedIds, generatedAt);
        return {
            activeUsUsdCount: stores.activeUsUsdCount,
            authorityStatus: stores.authorityStatus,
            operationalStatus: stores.operationalStatus,
            requiredCount: 2,
            selectedCount: stores.selectedCount,
            status: stores.status,
        };
    }
    finally {
        database.close();
    }
}

async function executeFormalExports(ledger, options, preflight, context = {}) {
    const written = [];
    try {
        const exportAuthoritySnapshot = context.exportAuthoritySnapshot
            || require('./export-mission-control-authority-snapshot').exportAuthoritySnapshot;
        const continuousVerifier = context.continuousVerifier
            || require('./verify-s7-continuous-operation');
        const exportExecutionCanaryEvidence = context.exportExecutionCanaryEvidence
            || require('./export-mission-control-execution-canary-evidence')
                .exportExecutionCanaryEvidence;
        const readinessVerifier = context.readinessVerifier
            || require('./verify-mission-control-production-readiness');
        const paths = formalOutputPaths(options.exportRoot, context);
        ensureFormalOutputsAbsent(paths);
        const snapshot = await exportAuthoritySnapshot({
            dbPath: ledger._internal.dbPath,
            outputDirectory: paths.authoritySnapshotDirectory,
        }, runtimeOverrides(context, path.dirname(paths.authoritySnapshotDirectory)));
        written.push(snapshot.manifestPath, snapshot.snapshotPath);
        const formalStoreGate = inspectImmutableSnapshotStoreGate(snapshot.snapshotPath, ledger._internal.rawStoreIds, context);
        ledger.executeExports.formalAuthorityStoreGate = formalStoreGate;
        if (formalStoreGate.authorityStatus !== 'READY'
            || formalStoreGate.operationalStatus.status !== 'READY'
            || formalStoreGate.status !== 'READY') {
            fail('Immutable formal authority snapshot store gate did not pass.');
        }
        fs.mkdirSync(path.dirname(paths.continuousPath), { recursive: true });
        let continuousText = '';
        const dates = ledger.continuous.businessDates;
        const continuousExit = continuousVerifier.run([
            '--authority-snapshot-manifest', snapshot.manifestPath,
            '--store', ledger._internal.rawStoreIds[0],
            '--store', ledger._internal.rawStoreIds[1],
            '--date-from', dates[0],
            '--date-to', dates.at(-1),
            '--output', paths.continuousPath,
        ], {
            ...runtimeOverrides(context, path.dirname(paths.authoritySnapshotDirectory)),
            continuousOperationOutputRoot: path.dirname(paths.continuousPath),
            writeStdout: (value) => {
                continuousText += value;
            },
        });
        if (continuousExit !== 0 || !fs.existsSync(paths.continuousPath)) {
            fail('Formal continuous-operation export did not pass.');
        }
        written.push(paths.continuousPath);
        fs.mkdirSync(path.dirname(paths.manualCanaryPath), { recursive: true });
        const manual = exportExecutionCanaryEvidence(normalizedCanaryOptions(preflight.selectedCandidates.manual, 'manual_approval', snapshot.manifestPath, paths.manualCanaryPath), runtimeOverrides(context, path.dirname(paths.authoritySnapshotDirectory)));
        written.push(manual.outputPath);
        const policy = exportExecutionCanaryEvidence(normalizedCanaryOptions(preflight.selectedCandidates.policy, 'policy_auto', snapshot.manifestPath, paths.policyCanaryPath), runtimeOverrides(context, path.dirname(paths.authoritySnapshotDirectory)));
        written.push(policy.outputPath);
        const formalReadinessArgs = readinessArgs({
            authoritySnapshotManifestPath: snapshot.manifestPath,
            continuousPath: paths.continuousPath,
            dbPath: ledger._internal.dbPath,
            manualCanaryPath: paths.manualCanaryPath,
            outputPath: paths.readinessPath,
            packageEvidence: options.packageEvidence,
            policyCanaryPath: paths.policyCanaryPath,
        });
        const readinessRun = captureSynchronousStdout(() => readinessVerifier.run(formalReadinessArgs)).result;
        if (readinessRun.exitCode !== 0
            || readinessRun.report?.appReady !== true
            || readinessRun.report?.summary?.passed !== 8) {
            fail('Final Mission Control readiness export did not pass all eight gates.');
        }
        written.push(readinessRun.outputPath);
        return {
            formalArtifacts: written.map(pathDescriptor),
            passed: true,
            status: 'COMPLETED',
        };
    }
    catch {
        return {
            formalArtifacts: written.map(pathDescriptor),
            passed: false,
            status: 'INTERRUPTED_FAIL_CLOSED',
        };
    }
}

module.exports = { formalOutputPaths, ensureFormalOutputsAbsent, captureSynchronousStdout, inspectImmutableSnapshotStoreGate, executeFormalExports };

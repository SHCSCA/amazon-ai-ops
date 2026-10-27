// 按职责复用原有严格校验，公共入口继续保持兼容。
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PACKAGE_EVIDENCE_OPTIONS, ROOT, fail } = require('./stage8-operator-contracts.js');

function validateExecuteInputs(ledger, options, context = {}) {
    const blockers = [];
    const canonicalEvidenceRoot = path.resolve(context.canonicalEvidenceRoot
        || path.join(ROOT, 'output', 'codex-evidence'));
    if (path.resolve(options.exportRoot || '').toLowerCase()
        !== canonicalEvidenceRoot.toLowerCase()) {
        blockers.push('EXPORT_ROOT_NOT_CANONICAL');
    }
    if (ledger.database.live.schema.status !== 'READY') {
        blockers.push('LIVE_SCHEMA_NOT_READY');
    }
    if ((ledger.stores.authorityStatus ?? ledger.stores.status) !== 'READY') {
        blockers.push('TWO_STORE_SCOPE_NOT_READY');
    }
    if ((ledger.stores.operationalStatus?.status ?? ledger.stores.status) !== 'READY') {
        blockers.push('STORE_OPERATIONAL_NOT_READY');
    }
    if (ledger.continuous.passed !== true)
        blockers.push('CONTINUOUS_OPERATION_NOT_PASSED');
    if (ledger.canaryCandidates.manualApproval.precheckedCount < 1) {
        blockers.push('MANUAL_CANARY_CANDIDATE_MISSING');
    }
    if (ledger.canaryCandidates.policyAuto.precheckedCount < 1) {
        blockers.push('POLICY_CANARY_CANDIDATE_MISSING');
    }
    for (const option of PACKAGE_EVIDENCE_OPTIONS) {
        const selected = options.packageEvidence[option];
        if (!selected || !fs.existsSync(selected) || !fs.statSync(selected).isFile()) {
            blockers.push(`PACKAGE_INPUT_MISSING_${option.toUpperCase().replace(/-/g, '_')}`);
        }
    }
    if (!fs.existsSync(canonicalEvidenceRoot)
        || !fs.statSync(canonicalEvidenceRoot).isDirectory()) {
        blockers.push('CANONICAL_EVIDENCE_ROOT_MISSING');
    }
    else {
        try {
            if (fs.lstatSync(canonicalEvidenceRoot).isSymbolicLink()
                || fs.realpathSync.native(canonicalEvidenceRoot).toLowerCase()
                    !== canonicalEvidenceRoot.toLowerCase()) {
                blockers.push('CANONICAL_EVIDENCE_ROOT_UNSAFE');
            }
            for (const childName of [
                'authority-snapshots',
                'continuous-operation',
                'execution-canaries',
            ]) {
                const child = path.join(canonicalEvidenceRoot, childName);
                if (fs.existsSync(child) && (fs.lstatSync(child).isSymbolicLink()
                    || !fs.statSync(child).isDirectory()
                    || fs.realpathSync.native(child).toLowerCase() !== child.toLowerCase())) {
                    blockers.push(`CANONICAL_${childName.toUpperCase().replace(/-/g, '_')}_ROOT_UNSAFE`);
                }
            }
        }
        catch {
            blockers.push('CANONICAL_EVIDENCE_ROOT_UNSAFE');
        }
    }
    return {
        blockers: [...new Set(blockers)],
        canonicalEvidenceRoot,
        passed: blockers.length === 0,
    };
}

function createOwnedPreflightRoot(context = {}) {
    const baseRoot = path.resolve(context.preflightTempRoot
        || path.join(os.tmpdir(), 'amazon-ai-ops-stage8-export-preflight'));
    fs.mkdirSync(baseRoot, { recursive: true });
    const baseReal = fs.realpathSync.native(baseRoot);
    if (path.resolve(baseRoot).toLowerCase() !== path.resolve(baseReal).toLowerCase()) {
        fail('Stage 8 preflight temporary root may not traverse a link or reparse point.');
    }
    return fs.mkdtempSync(path.join(baseReal, 'preflight-'));
}

function cleanupOwnedPreflightRoot(tempRoot, context = {}) {
    const baseRoot = path.resolve(context.preflightTempRoot
        || path.join(os.tmpdir(), 'amazon-ai-ops-stage8-export-preflight'));
    const resolved = path.resolve(tempRoot);
    const relative = path.relative(baseRoot, resolved);
    if (!path.basename(resolved).startsWith('preflight-')
        || relative === ''
        || relative === '..'
        || relative.startsWith(`..${path.sep}`)
        || path.isAbsolute(relative)) {
        fail('Refusing to clean an unowned Stage 8 preflight directory.');
    }
    if (fs.existsSync(resolved))
        fs.rmSync(resolved, { recursive: true, force: false });
}

function writeTemporaryJson(tempRoot, name, value) {
    const outputPath = path.join(tempRoot, name);
    if (path.dirname(outputPath) !== path.resolve(tempRoot) || fs.existsSync(outputPath)) {
        fail('Temporary Stage 8 preflight JSON path is unsafe or already exists.');
    }
    fs.writeFileSync(outputPath, `${JSON.stringify(value, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
    });
    return outputPath;
}

function runtimeOverrides(context, authoritySnapshotRoot) {
    return {
        ...(context.Database ? { Database: context.Database } : {}),
        ...(context.appContentPath ? { appContentPath: context.appContentPath } : {}),
        ...(context.executablePath ? { executablePath: context.executablePath } : {}),
        ...(context.mainBundlePath ? { mainBundlePath: context.mainBundlePath } : {}),
        ...(context.releaseRoot ? { releaseRoot: context.releaseRoot } : {}),
        authoritySnapshotRoot,
        env: context.env || process.env,
        now: context.now || (() => new Date()),
        nowMs: (context.now ? context.now() : new Date()).getTime(),
        randomUUID: context.randomUUID || (() => crypto.randomUUID()),
    };
}

function canaryOptionsForCandidate(candidate, mode, authoritySnapshotManifestPath, outputPath) {
    return {
        artifactPaths: candidate.artifactPaths,
        authorityId: candidate.authorityId,
        authoritySnapshotManifestPath,
        batchId: candidate.batchId,
        jobId: candidate.jobId,
        missionGrantId: candidate.grantId,
        mode,
        outputPath: outputPath || null,
        storeId: candidate.storeId,
    };
}

function canonicalStoresRootForCandidate(candidate) {
    const marker = `${path.sep}${candidate.storeId}${path.sep}evidence${path.sep}ad-execution${path.sep}`;
    const before = path.resolve(candidate.artifactPaths.before);
    const index = before.toLowerCase().indexOf(marker.toLowerCase());
    if (index <= 0)
        fail('Canary candidate artifact path does not bind a Store Capsule root.');
    return before.slice(0, index);
}

function normalizedCanaryOptions(candidate, mode, authoritySnapshotManifestPath, outputPath) {
    return {
        ...canaryOptionsForCandidate(candidate, mode, authoritySnapshotManifestPath, outputPath),
        storesRoot: canonicalStoresRootForCandidate(candidate),
    };
}

function readinessArgs(input) {
    return [
        '--v15-final-readiness', input.packageEvidence['v15-final-readiness'],
        '--package-launch-smoke', input.packageEvidence['package-launch-smoke'],
        '--package-ui-manifest', input.packageEvidence['package-ui-manifest'],
        '--package-security-evidence', input.packageEvidence['package-security-evidence'],
        '--package-adversarial-node-env-evidence',
        input.packageEvidence['package-adversarial-node-env-evidence'],
        '--s7-continuous-operation-evidence', input.continuousPath,
        '--manual-canary-evidence', input.manualCanaryPath,
        '--policy-auto-canary-evidence', input.policyCanaryPath,
        '--authority-db', input.dbPath,
        '--authority-snapshot-manifest', input.authoritySnapshotManifestPath,
        '--out', input.outputPath,
    ];
}

async function deepFormalPreflight(ledger, options, context = {}) {
    let tempRoot = null;
    let outcome = null;
    try {
        tempRoot = createOwnedPreflightRoot(context);
        const { exportAuthoritySnapshot, } = require('./export-mission-control-authority-snapshot');
        const continuousVerifier = require('./verify-s7-continuous-operation');
        const { buildExecutionCanaryEvidence, } = require('./export-mission-control-execution-canary-evidence');
        const readinessVerifier = require('./verify-mission-control-production-readiness');
        const overrides = runtimeOverrides(context, tempRoot);
        const snapshotResult = await exportAuthoritySnapshot({
            dbPath: ledger._internal.dbPath,
            outputDirectory: path.join(tempRoot, 'authority-snapshot-preflight'),
        }, overrides);
        let continuousText = '';
        const dates = ledger.continuous.businessDates;
        const continuousExit = continuousVerifier.run([
            '--authority-snapshot-manifest', snapshotResult.manifestPath,
            '--store', ledger._internal.rawStoreIds[0],
            '--store', ledger._internal.rawStoreIds[1],
            '--date-from', dates[0],
            '--date-to', dates.at(-1),
        ], {
            ...overrides,
            writeStdout: (value) => {
                continuousText += value;
            },
        });
        if (continuousExit !== 0)
            fail('Continuous-operation formal preflight did not pass.');
        const continuousEvidence = JSON.parse(continuousText);
        const selectedCandidates = {};
        const canaryEvidence = {};
        for (const [mode, key] of [
            ['manual_approval', 'manual'],
            ['policy_auto', 'policy'],
        ]) {
            const candidates = ledger._internal.rawCandidates[mode]
                .filter((candidate) => candidate.precheckPassed);
            let selected = null;
            let evidence = null;
            for (const candidate of candidates) {
                try {
                    evidence = buildExecutionCanaryEvidence(normalizedCanaryOptions(candidate, mode, snapshotResult.manifestPath, null), overrides);
                    selected = candidate;
                    break;
                }
                catch {
                }
            }
            if (!selected || !evidence) {
                fail(`${mode} has no candidate accepted by the formal canary verifier.`);
            }
            selectedCandidates[key] = selected;
            canaryEvidence[key] = evidence;
        }
        const continuousPath = writeTemporaryJson(tempRoot, 'continuous-operation-preflight.json', continuousEvidence);
        const manualCanaryPath = writeTemporaryJson(tempRoot, 'manual-canary-preflight.json', canaryEvidence.manual);
        const policyCanaryPath = writeTemporaryJson(tempRoot, 'policy-canary-preflight.json', canaryEvidence.policy);
        const readinessOutputPath = path.join(tempRoot, 'readiness-preflight.json');
        const parsedReadiness = readinessVerifier.parseArgs(readinessArgs({
            authoritySnapshotManifestPath: snapshotResult.manifestPath,
            continuousPath,
            dbPath: ledger._internal.dbPath,
            manualCanaryPath,
            outputPath: readinessOutputPath,
            packageEvidence: options.packageEvidence,
            policyCanaryPath,
        }));
        const readinessReport = readinessVerifier.buildReport(parsedReadiness, {
            ...overrides,
            authoritySnapshotRoot: tempRoot,
        });
        if (readinessReport.appReady !== true || readinessReport.summary?.passed !== 8) {
            fail('Mission Control readiness formal preflight did not pass all eight gates.');
        }
        outcome = {
            blockers: [],
            passed: true,
            selectedCandidates,
        };
    }
    catch {
        outcome = {
            blockers: ['DEEP_FORMAL_PREFLIGHT_FAILED'],
            passed: false,
            selectedCandidates: null,
        };
    }
    finally {
        if (tempRoot && fs.existsSync(tempRoot)) {
            try {
                cleanupOwnedPreflightRoot(tempRoot, context);
            }
            catch {
                outcome = {
                    blockers: ['DEEP_FORMAL_PREFLIGHT_TEMP_CLEANUP_FAILED'],
                    passed: false,
                    selectedCandidates: null,
                };
            }
        }
    }
    return outcome;
}

module.exports = { validateExecuteInputs, createOwnedPreflightRoot, cleanupOwnedPreflightRoot, writeTemporaryJson, runtimeOverrides, canaryOptionsForCandidate, canonicalStoresRootForCandidate, normalizedCanaryOptions, readinessArgs, deepFormalPreflight };

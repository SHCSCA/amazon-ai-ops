// 按职责复用原有严格校验，公共入口继续保持兼容。
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS, evaluatePackageUiEvidenceCompleteness, validatePackageUiReadOnlyRuntimeEvidence, validateSchedulerSubviewEvidence, } = require('./package-ui-evidence');
const { appDataStorageRoot, evidenceDir, packageListsMatch, readJson, root, sha256 } = require('./v15-delivery-export-contracts.js');

function latestEvidence(pattern, predicate = () => true) {
    if (!fs.existsSync(evidenceDir))
        return null;
    const files = fs.readdirSync(evidenceDir)
        .filter((name) => pattern.test(name) && predicate(name))
        .map((name) => {
        const filePath = path.join(evidenceDir, name);
        return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
    return files[0]?.filePath || null;
}

function latestFinalReadinessEvidence() {
    return latestEvidence(/^final-readiness-(?:\d{4}-\d{2}-\d{2}|\d{10,})\.json$/i);
}

function latestFileInDir(dir, pattern, predicate = () => true) {
    if (!dir || !fs.existsSync(dir))
        return null;
    const files = fs.readdirSync(dir)
        .filter((name) => pattern.test(name) && predicate(name))
        .map((name) => {
        const filePath = path.join(dir, name);
        return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
        .filter((entry) => fs.statSync(entry.filePath).isFile())
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
    return files[0]?.filePath || null;
}

function latestAppDataExport(pattern, predicate) {
    return latestFileInDir(appDataStorageRoot ? path.join(appDataStorageRoot, 'exports') : '', pattern, predicate);
}

function runNode(script, args = []) {
    const result = spawnSync(process.execPath, [path.join(root, script), ...args], {
        cwd: root,
        encoding: 'utf8',
    });
    return {
        ok: result.status === 0,
        output: `${result.stdout || ''}${result.stderr || ''}`,
    };
}

function assertManifestDrivenFinalReadiness(finalReadiness, finalReadinessPath) {
    if (finalReadiness.evidenceSelection?.mode !== 'manifest') {
        throw new Error(`Refusing to export delivery bundle from non-manifest final readiness evidence: ${finalReadinessPath}. `
            + 'Run write:v15-evidence-manifest, then verify:v15-final-readiness with --evidence-manifest.');
    }
    const manifestPath = finalReadiness.evidenceSelection?.manifestPath;
    if (!manifestPath || !fs.existsSync(path.resolve(manifestPath))) {
        throw new Error(`Refusing to export delivery bundle because evidence manifest is missing: ${manifestPath || '<none>'}`);
    }
}

function assertSelectedReadbackPassesVerifier(finalReadiness, dbPath) {
    if (finalReadiness.status !== 'APP_READY' && finalReadiness.appReady !== true)
        return;
    const manifestPath = path.resolve(finalReadiness.evidenceSelection?.manifestPath || '');
    const evidenceManifest = readJson(manifestPath);
    const readbackPath = evidenceManifest.evidence?.adReadback?.absolutePath;
    if (!readbackPath || !fs.existsSync(path.resolve(readbackPath))) {
        throw new Error('Refusing to export APP_READY delivery bundle because manifest-selected ad readback evidence is missing.');
    }
    const verifierArgs = [path.resolve(readbackPath)];
    if (dbPath)
        verifierArgs.push('--db', dbPath);
    const verification = runNode('scripts/verify-ad-readback-evidence.js', verifierArgs);
    if (!verification.ok) {
        throw new Error('Refusing to export APP_READY delivery bundle because manifest-selected ad readback evidence failed verify:ad-readback.\n'
            + verification.output.split(/\r?\n/).slice(-8).join('\n'));
    }
}

function assertAppReadyReadmeState(finalReadiness, readmePath) {
    if (finalReadiness.status !== 'APP_READY' && finalReadiness.appReady !== true)
        return;
    const resolved = path.resolve(readmePath || path.join(root, 'README.md'));
    if (!fs.existsSync(resolved)) {
        throw new Error(`Refusing to export APP_READY delivery bundle because README is missing: ${resolved}`);
    }
    const text = fs.readFileSync(resolved, 'utf8');
    if (!/^\*\*DELIVERY:\s*APP_READY\b/im.test(text)) {
        throw new Error('Refusing to export APP_READY delivery bundle because README delivery line is not APP_READY. '
            + 'Update the top-level README DELIVERY line before exporting the final handoff bundle.');
    }
}

function assertCurrentHashBoundEvidenceFile(record, label) {
    const filePath = record?.path;
    if (!filePath || !path.isAbsolute(filePath) || !fs.existsSync(filePath)) {
        throw new Error(`Refusing to export package UI evidence because ${label} is missing.`);
    }
    const lstat = fs.lstatSync(filePath);
    const stat = fs.statSync(filePath);
    if (!lstat.isFile()
        || lstat.isSymbolicLink()
        || Number(record?.sizeBytes) !== stat.size
        || !/^[A-F0-9]{64}$/.test(String(record?.sha256 || ''))
        || sha256(filePath) !== String(record.sha256).toUpperCase()) {
        throw new Error(`Refusing to export package UI evidence because ${label} current SHA-256/size is missing or stale.`);
    }
    return path.resolve(filePath);
}

function assertCurrentPackageUiEvidence(packageUi) {
    if (packageUi?.kind !== 'package-ui-evidence' || packageUi?.schemaVersion !== 9) {
        throw new Error('Refusing to export package UI evidence unless it uses current two-phase scheduler-read-only and interactive-login-attestation schema v9; schemas v5/v6/v7/v8 are historical and cannot be used for current export.');
    }
    const completeness = evaluatePackageUiEvidenceCompleteness(packageUi);
    if (completeness.passed !== true) {
        throw new Error(`Refusing to export incomplete package UI evidence: ${completeness.violations
            .map((item) => item.code || item.message)
            .join(', ')}.`);
    }
    const runs = Array.isArray(packageUi.runs) ? packageUi.runs : [];
    const scales = runs.map((run) => run?.scalePercent).sort((left, right) => left - right);
    if (JSON.stringify(scales) !== JSON.stringify([100, 125])) {
        throw new Error('Refusing to export package UI evidence without exact 100% and 125% v9 runs.');
    }
    for (const run of runs) {
        const subviews = Array.isArray(run?.subviewChecks) ? run.subviewChecks : [];
        const scheduler = subviews.filter((item) => (item?.workspace === 'settings' && item?.subview === 'scheduler'));
        if (scheduler.length !== 1
            || scheduler[0]?.passed !== true
            || validateSchedulerSubviewEvidence(scheduler[0]?.identityCapabilityEvidence, EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS[0]).passed !== true) {
            throw new Error(`Refusing to export package UI evidence because ${run?.scalePercent || 'unknown'}% settings/scheduler evidence is missing or failed.`);
        }
        assertCurrentHashBoundEvidenceFile(scheduler[0].screenshot, `${run.scalePercent}% settings/scheduler screenshot`);
        const runtimeValidation = validatePackageUiReadOnlyRuntimeEvidence(run?.schedulerReadOnlyRuntime, { requireSchedulerReads: true });
        if (runtimeValidation.passed !== true) {
            throw new Error(`Refusing to export package UI evidence because ${run?.scalePercent || 'unknown'}% Main scheduler read-only runtime evidence failed.`);
        }
        assertCurrentHashBoundEvidenceFile(run.schedulerReadOnlyRuntime.artifact, `${run.scalePercent}% Main scheduler read-only runtime attestation`);
    }
    if (validatePackageUiReadOnlyRuntimeEvidence(packageUi.wideProfile?.schedulerReadOnlyRuntime, { requireSchedulerReads: false }).passed !== true) {
        throw new Error('Refusing to export package UI evidence because the wide Main scheduler read-only runtime evidence failed.');
    }
    assertCurrentHashBoundEvidenceFile(packageUi.wideProfile.schedulerReadOnlyRuntime.artifact, 'wide Main scheduler read-only runtime attestation');
}

function assertAppReadyFinalReadinessHasPackageEvidence(finalReadiness, packageIndex) {
    if (!finalReadiness.appReady && finalReadiness.status !== 'APP_READY')
        return;
    const packageGate = (finalReadiness.gates || []).find((gate) => gate.name === 'Release package hash');
    if (!packageGate || packageGate.ok !== true || packageGate.status !== 'passed') {
        throw new Error('Refusing to export APP_READY delivery bundle because final readiness package hash gate evidence is missing.');
    }
    const readinessIndex = finalReadiness.packageIndex;
    if (!readinessIndex?.present || Number(readinessIndex.count || 0) <= 0) {
        throw new Error('Refusing to export APP_READY delivery bundle because final readiness package index is missing.');
    }
    if (!Array.isArray(readinessIndex.packages) || !packageListsMatch(readinessIndex.packages, packageIndex.packages)) {
        throw new Error('Refusing to export APP_READY delivery bundle because final readiness package index does not match current release package index.');
    }
}

module.exports = { latestEvidence, latestFinalReadinessEvidence, latestFileInDir, latestAppDataExport, runNode, assertManifestDrivenFinalReadiness, assertSelectedReadbackPassesVerifier, assertAppReadyReadmeState, assertCurrentHashBoundEvidenceFile, assertCurrentPackageUiEvidence, assertAppReadyFinalReadinessHasPackageEvidence };

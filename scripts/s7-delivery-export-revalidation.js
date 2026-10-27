// 按职责复用原有严格校验，公共入口继续保持兼容。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { CURRENT_REVALIDATION_KIND, GATE_IDS, GATE_OPTIONS, ROOT, normalizedPackageIdentity, readJson, sameOptionalPath, samePath, stableEqual } = require('./s7-delivery-export-contracts.js');
const { validateReadinessReport } = require('./s7-delivery-export-identity.js');

function readinessRevalidationArgs(report, outputPath) {
    const args = [];
    for (const id of GATE_IDS) {
        const selectedPath = report.evidenceSelection.selectedPaths[id];
        if (selectedPath)
            args.push(`--${GATE_OPTIONS[id]}`, selectedPath);
    }
    args.push('--authority-db', report.evidenceSelection.authorityDb);
    args.push('--authority-snapshot-manifest', report.evidenceSelection.authoritySnapshotManifest);
    args.push('--out', outputPath);
    return args;
}

function runReadyRevalidation(report, { rootDir = ROOT, readinessRunner = null, } = {}) {
    if (typeof readinessRunner === 'function') {
        return readinessRunner(report);
    }
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-s7-ready-'));
    const outputPath = path.join(tempDir, 'readiness.json');
    try {
        const result = spawnSync(process.execPath, [
            path.join(rootDir, 'scripts', 'verify-mission-control-production-readiness.js'),
            ...readinessRevalidationArgs(report, outputPath),
        ], {
            cwd: rootDir,
            encoding: 'utf8',
            windowsHide: true,
        });
        const refreshed = fs.existsSync(outputPath) ? readJson(outputPath) : null;
        return {
            exitCode: result.status,
            report: refreshed,
            stderr: String(result.stderr || ''),
            stdout: String(result.stdout || ''),
        };
    }
    finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

function assertCurrentRevalidation(original, result, expectedMode) {
    const validation = validateReadinessReport(result?.report, { expectedMode });
    const expectedExitCode = expectedMode === 'ready' ? 0 : 1;
    if (result?.exitCode !== expectedExitCode
        || !validation.ok
        || !stableEqual(normalizedPackageIdentity(result.report.packageIdentity), normalizedPackageIdentity(original.packageIdentity))
        || !GATE_IDS.every((id) => (sameOptionalPath(result.report.evidenceSelection.selectedPaths[id], original.evidenceSelection.selectedPaths[id])))
        || !samePath(result.report.evidenceSelection.authoritySnapshotManifest, original.evidenceSelection.authoritySnapshotManifest)
        || !samePath(result.report.evidenceSelection.authorityDb, original.evidenceSelection.authorityDb)
        || !GATE_IDS.every((id) => {
            const originalGate = original.gates.find((gate) => gate.id === id);
            const refreshedGate = result.report.gates.find((gate) => gate.id === id);
            return originalGate?.ok === refreshedGate?.ok
                && originalGate?.status === refreshedGate?.status;
        })) {
        const detail = [
            ...(validation.errors || []),
            result?.stderr,
            result?.stdout,
        ].filter(Boolean).join('; ');
        throw new Error(`Current Mission readiness revalidation rejected ${expectedMode}: ${detail}`);
    }
    return {
        kind: CURRENT_REVALIDATION_KIND,
        checkedAt: new Date().toISOString(),
        passed: true,
        readyCredit: expectedMode === 'ready',
        status: result.report.status,
        summary: { ...result.report.summary },
        packageIdentity: normalizedPackageIdentity(result.report.packageIdentity),
        selectedPathsSha256: crypto
            .createHash('sha256')
            .update(JSON.stringify(result.report.evidenceSelection.selectedPaths))
            .digest('hex')
            .toUpperCase(),
    };
}

module.exports = { readinessRevalidationArgs, runReadyRevalidation, assertCurrentRevalidation };

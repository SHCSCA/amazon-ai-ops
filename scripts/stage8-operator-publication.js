// 按职责复用原有严格校验，公共入口继续保持兼容。
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { PACKAGE_EVIDENCE_OPTIONS, fail, parseArgs } = require('./stage8-operator-contracts.js');
const { executeFormalExports } = require('./stage8-operator-execution.js');
const { diagnose } = require('./stage8-operator-inspection.js');
const { deepFormalPreflight, validateExecuteInputs } = require('./stage8-operator-preflight.js');

function assertSafeOutputPath(outputPath) {
    if (!path.isAbsolute(outputPath) || outputPath.includes('\0')) {
        fail('--out must be a clean absolute path.');
    }
    const resolved = path.resolve(outputPath);
    if (path.extname(resolved).toLowerCase() !== '.json') {
        fail('--out must be a .json file.');
    }
    if (fs.existsSync(resolved)) {
        fail(`Monitoring ledger output already exists: ${resolved}`);
    }
    const parent = path.dirname(resolved);
    if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
        fail('--out parent directory must already exist.');
    }
    const parentReal = fs.realpathSync.native(parent);
    if (path.resolve(parent).toLowerCase() !== path.resolve(parentReal).toLowerCase()) {
        fail('--out parent may not traverse a link or reparse point.');
    }
    return resolved;
}

function writeAtomicLedger(outputPath, ledger, context = {}) {
    const resolved = assertSafeOutputPath(outputPath);
    const tempPath = path.join(path.dirname(resolved), `.${path.basename(resolved)}.${process.pid}.${(context.randomUUID ? context.randomUUID() : crypto.randomUUID())}.tmp`);
    let linked = false;
    try {
        fs.writeFileSync(tempPath, `${JSON.stringify(ledger, null, 2)}\n`, {
            encoding: 'utf8',
            flag: 'wx',
        });
        const handle = fs.openSync(tempPath, 'r+');
        try {
            fs.fsyncSync(handle);
        }
        finally {
            fs.closeSync(handle);
        }
        fs.linkSync(tempPath, resolved);
        linked = true;
        fs.unlinkSync(tempPath);
    }
    catch (error) {
        if (fs.existsSync(tempPath))
            fs.unlinkSync(tempPath);
        if (linked && fs.existsSync(resolved))
            fs.unlinkSync(resolved);
        throw error;
    }
    return resolved;
}

function usage() {
    return [
        'Usage: node scripts/stage8-gate-operator.js [options]',
        '  [--db <absolute live amazon-ai-ops.db>]',
        '  [--snapshot-manifest <snapshot-manifest.json>]',
        '  [--store <normalized-id> --store <normalized-id>]',
        '  [--export --out <new-monitoring-ledger.json>]',
        '  [--execute-exports --export-root <output/codex-evidence> --out <new-ledger.json>',
        ...PACKAGE_EVIDENCE_OPTIONS.map((option) => `    --${option} <evidence.json>`),
        '  ]',
        '',
        'Default mode is read-only diagnosis and writes no artifact.',
        '--export writes only the non-formal atomic monitoring ledger and ordered plan.',
        '--execute-exports is separately gated and never executes Ads or migrates SQLite.',
    ].join('\n');
}

async function run(argv = process.argv.slice(2), injectedContext = {}) {
    const parsed = parseArgs(argv);
    if (parsed.help) {
        (injectedContext.writeStdout || process.stdout.write.bind(process.stdout))(`${usage()}\n`);
        return { exitCode: 0, ledger: null, outputPath: null };
    }
    if (parsed.errors.length > 0)
        fail(parsed.errors.join(' '));
    const packageEvidence = Object.fromEntries(PACKAGE_EVIDENCE_OPTIONS.map((option) => [option, parsed.values[option] || null]));
    const ledger = (injectedContext.diagnose || diagnose)({
        dbPath: parsed.values.db,
        mode: parsed.executeExports
            ? 'execute-exports'
            : parsed.exportRequested
                ? 'export'
                : 'diagnose',
        packageEvidence,
        snapshotManifestPath: parsed.values['snapshot-manifest'],
        stores: parsed.values.stores,
    }, injectedContext);
    let exitCode = ledger.status === 'READY_FOR_EXPORT_PREFLIGHT' ? 0 : 2;
    if (parsed.executeExports) {
        assertSafeOutputPath(parsed.values.out);
        const preflight = validateExecuteInputs(ledger, {
            exportRoot: parsed.values['export-root'],
            packageEvidence,
        }, injectedContext);
        ledger.executeExports = {
            adsExecutionInvoked: false,
            authorityDatabaseMutated: false,
            blockers: preflight.blockers,
            formalArtifactsWritten: [],
            preflightPassed: preflight.passed,
            status: preflight.passed
                ? 'RUNNING_DEEP_FORMAL_PREFLIGHT'
                : 'BLOCKED_ZERO_FORMAL_ARTIFACTS',
        };
        if (preflight.passed) {
            const deepPreflight = await (injectedContext.deepFormalPreflight || deepFormalPreflight)(ledger, {
                exportRoot: parsed.values['export-root'],
                packageEvidence,
            }, injectedContext);
            ledger.executeExports.blockers = deepPreflight.blockers;
            ledger.executeExports.preflightPassed = deepPreflight.passed;
            ledger.executeExports.status = deepPreflight.passed
                ? 'FORMAL_EXPORT_RUNNING'
                : 'BLOCKED_ZERO_FORMAL_ARTIFACTS';
            if (deepPreflight.passed) {
                const exportResult = await executeFormalExports(ledger, {
                    exportRoot: parsed.values['export-root'],
                    packageEvidence,
                }, deepPreflight, injectedContext);
                ledger.executeExports.formalArtifactsWritten = exportResult.formalArtifacts;
                ledger.executeExports.status = exportResult.status;
                ledger.executeExports.completed = exportResult.passed;
                ledger.status = exportResult.passed
                    ? 'EXPORT_CHAIN_COMPLETED'
                    : 'EXPORT_CHAIN_INTERRUPTED';
                exitCode = exportResult.passed ? 0 : 1;
            }
            else {
                ledger.status = 'PARTIAL_MONITORING';
                exitCode = 2;
            }
        }
        else {
            ledger.status = 'PARTIAL_MONITORING';
            exitCode = 2;
        }
    }
    let outputPath = null;
    if (parsed.exportRequested) {
        outputPath = writeAtomicLedger(parsed.values.out, ledger, injectedContext);
    }
    const publicOutput = `${JSON.stringify(ledger, null, 2)}\n`;
    (injectedContext.writeStdout || process.stdout.write.bind(process.stdout))(publicOutput);
    return { exitCode, ledger, outputPath };
}

module.exports = { assertSafeOutputPath, writeAtomicLedger, usage, run };

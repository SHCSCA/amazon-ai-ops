// 按职责复用原有严格校验，公共入口继续保持兼容。
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { GATE_SPECS, defaultOutputPath, parseArgs } = require('./mission-control-production-contracts.js');
const { appendFinalStoreCapsuleFailure, buildReport, captureAndVerifyFinalAuthorityCurrentness, refreshReportState, verifyFinalCanaryPngEvidence, verifyFinalStoreCapsuleEvidence } = require('./mission-control-production-report.js');

function writeReport(outputPath, report) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const tempPath = path.join(path.dirname(outputPath), `.${path.basename(outputPath)}.${process.pid}.${crypto.randomUUID()}.tmp`);
    try {
        fs.writeFileSync(tempPath, `${JSON.stringify(report, null, 2)}\n`, {
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
        fs.renameSync(tempPath, outputPath);
    }
    finally {
        if (fs.existsSync(tempPath))
            fs.unlinkSync(tempPath);
    }
}

function buildPendingPublicationReport(report, outputPath) {
    const pendingReport = JSON.parse(JSON.stringify(report));
    const gates = Array.isArray(pendingReport.gates) ? pendingReport.gates : [];
    gates.push({
        id: 'final-publication-recheck',
        ok: false,
        status: 'needs_work',
        evidencePath: outputPath,
        reason: 'Final post-write Store Capsule, canary PNG, and authority currentness rechecks have not completed.',
    });
    pendingReport.gates = gates;
    pendingReport.appReady = false;
    pendingReport.allGatesPass = false;
    pendingReport.status = 'APP_NEEDS_WORK';
    pendingReport.summary = {
        total: gates.length,
        passed: gates.filter((gate) => gate?.ok === true).length,
        failed: gates.filter((gate) => gate?.ok !== true).length,
    };
    pendingReport.publication = {
        state: 'pending-post-write-recheck',
        finalReaderFacing: false,
        readyPublicationAllowed: false,
    };
    return pendingReport;
}

function usage() {
    return [
        'Usage: node scripts/verify-mission-control-production-readiness.js',
        ...GATE_SPECS.map((spec) => `  --${spec.option} <evidence.json>`),
        '  --authority-db <absolute live authority database>',
        '  --authority-snapshot-manifest <snapshot-provenance.json>',
        '  --out <readiness.json>',
    ].join('\n');
}

function run(argv = process.argv.slice(2), injectedContext = null) {
    const parsed = parseArgs(argv);
    if (parsed.help) {
        process.stdout.write(`${usage()}\n`);
        return { exitCode: 0, report: null, outputPath: null };
    }
    const outputPath = path.resolve(parsed.values.out || defaultOutputPath());
    const report = buildReport(parsed, injectedContext);
    if (injectedContext
        && Object.prototype.hasOwnProperty.call(injectedContext, 'beforeFinalEvidenceRecheck')) {
        if (typeof injectedContext.beforeFinalEvidenceRecheck !== 'function') {
            appendFinalStoreCapsuleFailure(report, 'Injected beforeFinalEvidenceRecheck test hook must be a function.');
        }
        else {
            try {
                injectedContext.beforeFinalEvidenceRecheck({ outputPath });
            }
            catch (error) {
                appendFinalStoreCapsuleFailure(report, `Injected beforeFinalEvidenceRecheck test hook failed closed: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }
    captureAndVerifyFinalAuthorityCurrentness(report, 'before-final-report-write');
    verifyFinalStoreCapsuleEvidence(report);
    verifyFinalCanaryPngEvidence(report);
    writeReport(outputPath, buildPendingPublicationReport(report, outputPath));
    if (typeof injectedContext?.afterFailClosedReportWrite === 'function') {
        injectedContext.afterFailClosedReportWrite({ outputPath });
    }
    const storeCapsuleStillValid = verifyFinalStoreCapsuleEvidence(report);
    const canaryPngsStillValid = verifyFinalCanaryPngEvidence(report);
    const authorityStillCurrent = captureAndVerifyFinalAuthorityCurrentness(report, 'after-final-report-write');
    if (!storeCapsuleStillValid || !canaryPngsStillValid || !authorityStillCurrent) {
        refreshReportState(report);
    }
    writeReport(outputPath, report);
    process.stdout.write(`${report.status}: ${report.summary.passed}/${report.summary.total} production gates passed.\n`);
    process.stdout.write(`Evidence: ${outputPath}\n`);
    return { exitCode: report.appReady ? 0 : 1, report, outputPath };
}

module.exports = { writeReport, buildPendingPublicationReport, usage, run };

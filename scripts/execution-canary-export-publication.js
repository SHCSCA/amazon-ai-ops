// 按职责复用原有严格校验，公共入口继续保持兼容。
const fs = require('node:fs');
const path = require('node:path');
const { loadAuthoritySnapshotManifest, } = require('./verify-s7-continuous-operation');
const { assertMatchingAuthorityCurrentnessProofs, captureAuthoritySnapshotCurrentness, } = require('./sqlite-authority-currentness');
const { PNG_EVIDENCE_MAX_FILE_BYTES, PNG_EVIDENCE_MIN_HEIGHT, PNG_EVIDENCE_MIN_WIDTH, inspectPngEvidenceFile, } = require('./canary-png-evidence');
const { validatePngArtifact } = require('./execution-canary-export-artifacts.js');
const { captureLiveAuthorityCurrentness, deriveCanonicalUserDataBoundary, inspectCurrentPackage } = require('./execution-canary-export-authority.js');
const { assertCondition, assertUniqueRegularFile, defaultContext, fail, samePath, sha256File, stableEqual } = require('./execution-canary-export-contracts.js');
const { buildExecutionCanaryEvidence } = require('./execution-canary-export-evidence.js');
const { ensureCanonicalOutputDirectory, normalizeProgrammaticOptions, parseOptions, validateCanonicalOutputBoundary } = require('./execution-canary-export-options.js');

function writeExclusiveAtomic(outputBoundary, serialized, context) {
    const outputRoot = ensureCanonicalOutputDirectory(outputBoundary);
    const resolved = outputBoundary.outputPath;
    assertCondition(samePath(path.dirname(resolved), outputRoot), 'Canary evidence output escaped its canonical execution-canary directory.');
    if (fs.existsSync(resolved))
        fail(`Canary evidence output already exists and will not be overwritten: ${resolved}`);
    const tempPath = path.join(outputRoot, `.${path.basename(resolved)}.${context.randomUUID()}.tmp`);
    let finalLinked = false;
    try {
        fs.writeFileSync(tempPath, serialized, { encoding: 'utf8', flag: 'wx' });
        const handle = fs.openSync(tempPath, 'r+');
        try {
            fs.fsyncSync(handle);
        }
        finally {
            fs.closeSync(handle);
        }
        fs.linkSync(tempPath, resolved);
        finalLinked = true;
        fs.unlinkSync(tempPath);
        assertUniqueRegularFile(resolved, 'Canary evidence output');
    }
    catch (error) {
        if (fs.existsSync(tempPath))
            fs.unlinkSync(tempPath);
        if (finalLinked && fs.existsSync(resolved))
            fs.unlinkSync(resolved);
        throw error;
    }
}

function removeOwnedOutput(outputBoundary) {
    const outputPath = outputBoundary.outputPath;
    if (!samePath(path.dirname(outputPath), outputBoundary.outputRoot) || !fs.existsSync(outputPath)) {
        return;
    }
    const linkStat = fs.lstatSync(outputPath);
    if (linkStat.isDirectory()) {
        fail(`Owned canary output unexpectedly became a directory and was not removed: ${outputPath}`);
    }
    fs.unlinkSync(outputPath);
}

function verifyPostWriteProvenance(options, context, outputBoundary, evidence, serialized) {
    const output = assertUniqueRegularFile(outputBoundary.outputPath, 'Canary evidence output');
    assertCondition(output.stat.size === Buffer.byteLength(serialized)
        && fs.readFileSync(output.path, 'utf8') === serialized, 'Canary evidence output bytes changed after the exclusive atomic write.');
    const packageAfterWrite = inspectCurrentPackage(context);
    assertCondition(stableEqual(packageAfterWrite.packageIdentity, evidence.packageIdentity), 'Canonical package hashes changed after the canary evidence write.');
    const authoritySnapshot = loadAuthoritySnapshotManifest(options.authoritySnapshotManifestPath, { authoritySnapshotRoot: context.authoritySnapshotRoot });
    assertCondition(authoritySnapshot.snapshotManifestSha256 === evidence.database.snapshotManifestSha256, 'Authority snapshot manifest hash changed after the canary evidence write.');
    const databaseArtifact = assertUniqueRegularFile(authoritySnapshot.databasePath, 'Authority database snapshot');
    assertCondition(samePath(databaseArtifact.path, evidence.database.absolutePath)
        && databaseArtifact.stat.size === evidence.database.sizeBytes
        && sha256File(databaseArtifact.path) === evidence.database.sha256, 'Authority database snapshot hash, size, or path changed after the canary evidence write.');
    const userDataBoundary = deriveCanonicalUserDataBoundary(authoritySnapshot);
    assertCondition(samePath(userDataBoundary.storesRoot, evidence.storesRoot), 'Canonical live USER_DATA_DIR stores root changed after the canary evidence write.');
    const currentnessAfterFinalOutput = captureLiveAuthorityCurrentness(authoritySnapshot, context, `canary-${evidence.mode}-after-final-output`);
    assertMatchingAuthorityCurrentnessProofs([...evidence.authorityCurrentness.captures, currentnessAfterFinalOutput], authoritySnapshot.snapshotArtifact, 'Execution-canary final authority currentness');
    for (const record of evidence.execution.evidence) {
        const artifact = assertUniqueRegularFile(record.artifactPath, `${record.slot} Store Capsule artifact`);
        const inspection = validatePngArtifact(artifact.path, `${record.slot} Store Capsule artifact`);
        assertCondition(inspection.sizeBytes === record.sizeBytes
            && inspection.sha256 === record.contentSha256, `${record.slot} Store Capsule artifact changed after the canary evidence write.`);
    }
}

function exportExecutionCanaryEvidence(rawOptions, injectedContext = {}) {
    const options = normalizeProgrammaticOptions(rawOptions);
    if (!options.outputPath)
        fail('outputPath is required for export.');
    const context = { ...defaultContext(), ...injectedContext };
    assertCondition(context.afterOutputWritten === null || typeof context.afterOutputWritten === 'function', 'afterOutputWritten must be null or a function.');
    const authoritySnapshot = loadAuthoritySnapshotManifest(options.authoritySnapshotManifestPath, { authoritySnapshotRoot: context.authoritySnapshotRoot });
    const userDataBoundary = deriveCanonicalUserDataBoundary(authoritySnapshot);
    const outputBoundary = validateCanonicalOutputBoundary(options, context, authoritySnapshot, userDataBoundary);
    const evidence = buildExecutionCanaryEvidence(options, context);
    const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
    let outputOwned = false;
    try {
        writeExclusiveAtomic(outputBoundary, serialized, context);
        outputOwned = true;
        if (context.afterOutputWritten) {
            context.afterOutputWritten({ evidence, outputPath: outputBoundary.outputPath });
        }
        verifyPostWriteProvenance(options, context, outputBoundary, evidence, serialized);
        return { evidence, outputPath: outputBoundary.outputPath };
    }
    catch (error) {
        if (outputOwned)
            removeOwnedOutput(outputBoundary);
        throw error;
    }
}

function usage() {
    return [
        'Usage: node scripts/export-mission-control-execution-canary-evidence.js',
        '  --authority-snapshot-manifest <snapshot-manifest.json>',
        '  --mode <manual_approval|policy_auto>',
        '  --store-id <normalized-store-id>',
        '  --authority-id <verified-authority-id>',
        '  --mission-grant-id <mission-grant-id>',
        '  --batch-id <execution-batch-id>',
        '  --job-id <execution-job-id>',
        '  --stores-root <absolute-store-capsule-root>',
        '  --before-artifact <absolute-before.png>',
        '  --after-artifact <absolute-after.png>',
        '  --reload-artifact <absolute-reload.png>',
        `    Each PNG must be CRC-valid, fully decodable, complete through IEND, at least ${PNG_EVIDENCE_MIN_WIDTH}x${PNG_EVIDENCE_MIN_HEIGHT}, and no larger than ${PNG_EVIDENCE_MAX_FILE_BYTES / (1024 * 1024)} MiB.`,
        '  --out <new-evidence.json>',
        '',
        'The exporter only reads the selected snapshot and Store Capsule artifacts.',
        'It never executes Ads, mutates SQLite, or accepts user-authored canary business facts.',
    ].join('\n');
}

function run(argv = process.argv.slice(2), injectedContext = {}) {
    const options = parseOptions(argv);
    if (options.help) {
        process.stdout.write(`${usage()}\n`);
        return { exitCode: 0, result: null };
    }
    const result = exportExecutionCanaryEvidence(options, injectedContext);
    process.stdout.write(`Execution canary evidence: ${result.outputPath}\n`);
    return { exitCode: 0, result };
}

module.exports = { writeExclusiveAtomic, removeOwnedOutput, verifyPostWriteProvenance, exportExecutionCanaryEvidence, usage, run };

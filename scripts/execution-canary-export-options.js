// 按职责复用原有严格校验，公共入口继续保持兼容。
const fs = require('node:fs');
const path = require('node:path');
const { EXECUTION_CANARY_OUTPUT_DIRECTORY_NAME, EXECUTION_SLOTS, MODES, OPTION_NAMES, assertCleanAbsolutePath, assertCondition, assertDirectDirectory, cleanIdentifier, fail, isPathContained, samePath } = require('./execution-canary-export-contracts.js');

function parseOptions(argv) {
    const values = {};
    let help = false;
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (token === '--help') {
            help = true;
            continue;
        }
        if (!token.startsWith('--'))
            fail(`Unexpected argument: ${token}`);
        const key = token.slice(2);
        if (!OPTION_NAMES.has(key))
            fail(`Unexpected argument: ${token}`);
        const value = argv[index + 1];
        if (!value || value.startsWith('--'))
            fail(`Missing value for ${token}`);
        if (Object.prototype.hasOwnProperty.call(values, key))
            fail(`Duplicate argument: ${token}`);
        values[key] = value;
        index += 1;
    }
    if (help)
        return { help: true };
    for (const key of OPTION_NAMES) {
        if (!Object.prototype.hasOwnProperty.call(values, key))
            fail(`--${key} is required.`);
    }
    if (!MODES.has(values.mode))
        fail('--mode must be manual_approval or policy_auto.');
    return {
        authoritySnapshotManifestPath: assertCleanAbsolutePath(values['authority-snapshot-manifest'], '--authority-snapshot-manifest'),
        mode: values.mode,
        storeId: cleanIdentifier(values['store-id'], '--store-id', { normalized: true }),
        authorityId: cleanIdentifier(values['authority-id'], '--authority-id'),
        missionGrantId: cleanIdentifier(values['mission-grant-id'], '--mission-grant-id'),
        batchId: cleanIdentifier(values['batch-id'], '--batch-id'),
        jobId: cleanIdentifier(values['job-id'], '--job-id'),
        storesRoot: assertCleanAbsolutePath(values['stores-root'], '--stores-root'),
        artifactPaths: {
            before: assertCleanAbsolutePath(values['before-artifact'], '--before-artifact'),
            after: assertCleanAbsolutePath(values['after-artifact'], '--after-artifact'),
            reload: assertCleanAbsolutePath(values['reload-artifact'], '--reload-artifact'),
        },
        outputPath: assertCleanAbsolutePath(values.out, '--out'),
    };
}

function normalizeProgrammaticOptions(options) {
    if (!options || typeof options !== 'object' || Array.isArray(options))
        fail('Exporter options are missing.');
    if (!MODES.has(options.mode))
        fail('mode must be manual_approval or policy_auto.');
    const artifactPaths = options.artifactPaths || {};
    return {
        authoritySnapshotManifestPath: assertCleanAbsolutePath(options.authoritySnapshotManifestPath, 'authoritySnapshotManifestPath'),
        mode: options.mode,
        storeId: cleanIdentifier(options.storeId, 'storeId', { normalized: true }),
        authorityId: cleanIdentifier(options.authorityId, 'authorityId'),
        missionGrantId: cleanIdentifier(options.missionGrantId, 'missionGrantId'),
        batchId: cleanIdentifier(options.batchId, 'batchId'),
        jobId: cleanIdentifier(options.jobId, 'jobId'),
        storesRoot: assertCleanAbsolutePath(options.storesRoot, 'storesRoot'),
        artifactPaths: Object.fromEntries(EXECUTION_SLOTS.map((slot) => [
            slot,
            assertCleanAbsolutePath(artifactPaths[slot], `${slot} artifactPath`),
        ])),
        outputPath: options.outputPath
            ? assertCleanAbsolutePath(options.outputPath, 'outputPath')
            : null,
    };
}

function validateCanonicalOutputBoundary(options, context, authoritySnapshot, userDataBoundary) {
    const canonicalEvidenceRoot = assertDirectDirectory(context.canonicalEvidenceRoot, 'Canonical codex-evidence root');
    const configuredOutputRoot = assertCleanAbsolutePath(context.executionCanaryOutputRoot, 'Canonical execution-canary output root');
    const expectedOutputRoot = path.join(canonicalEvidenceRoot, EXECUTION_CANARY_OUTPUT_DIRECTORY_NAME);
    assertCondition(samePath(configuredOutputRoot, expectedOutputRoot), `Execution-canary output root must be the direct ${EXECUTION_CANARY_OUTPUT_DIRECTORY_NAME} child of codex-evidence.`);
    assertCondition(samePath(path.dirname(configuredOutputRoot), canonicalEvidenceRoot), 'Execution-canary output root is not a direct codex-evidence child.');
    if (fs.existsSync(configuredOutputRoot)) {
        assertDirectDirectory(configuredOutputRoot, 'Canonical execution-canary output root');
    }
    const outputPath = assertCleanAbsolutePath(options.outputPath, 'Canary evidence output');
    assertCondition(samePath(path.dirname(outputPath), configuredOutputRoot), 'Canary evidence output must be a direct file under output/codex-evidence/execution-canaries.');
    assertCondition(/^[A-Za-z0-9][A-Za-z0-9._-]{0,238}\.json$/i.test(path.basename(outputPath)), 'Canary evidence output must use one safe, non-hidden .json filename.');
    if (fs.existsSync(outputPath)) {
        fail(`Canary evidence output already exists and will not be overwritten: ${outputPath}`);
    }
    const forbiddenDirectories = [
        context.releaseRoot,
        context.authoritySnapshotRoot,
        userDataBoundary.userDataDir,
        userDataBoundary.storesRoot,
    ].map((candidate) => assertCleanAbsolutePath(candidate, 'Forbidden canary output boundary'));
    const forbiddenFiles = [
        authoritySnapshot.manifestPath,
        authoritySnapshot.databasePath,
        userDataBoundary.sourceDatabasePath,
    ].map((candidate) => assertCleanAbsolutePath(candidate, 'Forbidden canary output file'));
    for (const forbiddenDirectory of forbiddenDirectories) {
        assertCondition(!isPathContained(forbiddenDirectory, configuredOutputRoot)
            && !isPathContained(forbiddenDirectory, outputPath), `Canary evidence output may not be written under release, snapshot, live AppData, or Store Capsule paths: ${forbiddenDirectory}`);
    }
    for (const forbiddenFile of forbiddenFiles) {
        assertCondition(!samePath(forbiddenFile, configuredOutputRoot) && !samePath(forbiddenFile, outputPath), `Canary evidence output may not alias a snapshot or live authority database file: ${forbiddenFile}`);
    }
    return {
        canonicalEvidenceRoot,
        outputPath,
        outputRoot: configuredOutputRoot,
    };
}

function ensureCanonicalOutputDirectory(outputBoundary) {
    if (!fs.existsSync(outputBoundary.outputRoot)) {
        try {
            fs.mkdirSync(outputBoundary.outputRoot, { recursive: false });
        }
        catch (error) {
            if (error?.code !== 'EEXIST')
                throw error;
        }
    }
    const outputRoot = assertDirectDirectory(outputBoundary.outputRoot, 'Canonical execution-canary output root');
    assertCondition(samePath(path.dirname(outputRoot), outputBoundary.canonicalEvidenceRoot), 'Execution-canary output root changed outside its canonical parent.');
    return outputRoot;
}

module.exports = { parseOptions, normalizeProgrammaticOptions, validateCanonicalOutputBoundary, ensureCanonicalOutputDirectory };

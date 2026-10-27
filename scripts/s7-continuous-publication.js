// 按职责复用原有严格校验，公共入口继续保持兼容。
const fs = require('node:fs');
const { assertMatchingAuthorityCurrentnessProofs, captureAuthoritySnapshotCurrentness, } = require('./sqlite-authority-currentness');
const path = require('node:path');
const { assertDirectDirectory, assertSafeExistingAncestor, assertUniqueRegularFile, pathsOverlap } = require('./s7-continuous-artifacts.js');
const { captureLiveAuthorityCurrentness, defaultRuntimeContext, loadAuthoritySnapshotManifest, verifyAuthorityInputsUnchanged } = require('./s7-continuous-authority.js');
const { inclusiveDates, recentCompletedUsBusinessDates, usFederalBusinessDates, validIsoDate } = require('./s7-continuous-calendar.js');
const { BUSINESS_TIMEZONE, US_BUSINESS_CALENDAR_VERSION, fail, requireLocalDbDependency, samePath } = require('./s7-continuous-contracts.js');
const { buildEvidenceManifest, evaluateContinuousOperationSnapshot } = require('./s7-continuous-evaluation.js');
const { readContinuousOperationSnapshot } = require('./s7-continuous-snapshot.js');

function parseArgs(argv, { now = () => new Date() } = {}) {
    const result = { stores: [] };
    for (let index = 0; index < argv.length; index += 1) {
        const name = argv[index];
        if (name === '--help')
            return { help: true, stores: [] };
        const value = argv[index + 1];
        if (!name.startsWith('--') || !value || value.startsWith('--'))
            fail(`Invalid argument ${name}.`);
        index += 1;
        if (name === '--authority-snapshot-manifest')
            result.authoritySnapshotManifestPath = path.resolve(value);
        else if (name === '--store')
            result.stores.push(value.trim().toLowerCase());
        else if (name === '--date-from')
            result.dateFrom = value;
        else if (name === '--date-to')
            result.dateTo = value;
        else if (name === '--output')
            result.outputPath = path.resolve(value);
        else
            fail(`Unknown argument ${name}.`);
    }
    if (!result.authoritySnapshotManifestPath) {
        fail('--authority-snapshot-manifest is required; raw live --database input is not accepted.');
    }
    if (result.stores.length !== 2 || new Set(result.stores).size !== 2)
        fail('Exactly two distinct --store values are required.');
    if (!validIsoDate(result.dateFrom) || !validIsoDate(result.dateTo))
        fail('--date-from and --date-to must use YYYY-MM-DD.');
    const calendarDates = inclusiveDates(result.dateFrom, result.dateTo);
    if (calendarDates.length === 0 || calendarDates.at(-1) !== result.dateTo) {
        fail('The continuous acceptance window must be ascending and no longer than 31 calendar days.');
    }
    const dates = usFederalBusinessDates(result.dateFrom, result.dateTo);
    if (dates.length !== 7) {
        fail(`The continuous acceptance window must contain exactly seven US federal business dates under ${US_BUSINESS_CALENDAR_VERSION}.`);
    }
    const generatedAtDate = now();
    if (!(generatedAtDate instanceof Date) || !Number.isFinite(generatedAtDate.valueOf())) {
        fail('Continuous-operation generation clock is invalid.');
    }
    const generatedAt = generatedAtDate.toISOString();
    const expectedDates = recentCompletedUsBusinessDates(generatedAt);
    if (JSON.stringify(dates) !== JSON.stringify(expectedDates)) {
        fail(`The continuous acceptance window must be the most recent seven completed US federal business dates in ${BUSINESS_TIMEZONE}.`);
    }
    return {
        ...result,
        dates,
        generatedAt,
        businessCalendarVersion: US_BUSINESS_CALENDAR_VERSION,
    };
}

function resolveCanonicalOutputPath(outputPath, context, authoritySnapshot) {
    if (typeof outputPath !== 'string'
        || outputPath !== outputPath.trim()
        || !path.isAbsolute(outputPath)
        || outputPath.includes('\0')) {
        fail('Continuous-operation output must be one clean absolute JSON path.');
    }
    const canonicalEvidenceRoot = path.resolve(context.canonicalEvidenceRoot);
    const expectedOutputRoot = path.join(canonicalEvidenceRoot, 'continuous-operation');
    const configuredOutputRoot = path.resolve(context.continuousOperationOutputRoot ?? expectedOutputRoot);
    if (!samePath(configuredOutputRoot, expectedOutputRoot)) {
        fail('Continuous-operation output root must be canonical output/codex-evidence/continuous-operation.');
    }
    const resolved = path.resolve(outputPath);
    if (!samePath(path.dirname(resolved), configuredOutputRoot)) {
        fail('Continuous-operation output must be a direct child of the canonical continuous-operation evidence root.');
    }
    const basename = path.basename(resolved);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$/.test(basename)) {
        fail('Continuous-operation output filename must be one safe <new-file>.json name.');
    }
    for (const [label, protectedRoot] of [
        ['authority snapshot root', context.authoritySnapshotRoot],
        ['canonical package root', context.releaseRoot],
        ['live USER_DATA_DIR', path.dirname(authoritySnapshot.authorityDbPath)],
        ['Store Capsule root', authoritySnapshot.storesRoot],
    ]) {
        if (pathsOverlap(configuredOutputRoot, protectedRoot)) {
            fail(`Continuous-operation output root overlaps the protected ${label}.`);
        }
    }
    if (fs.existsSync(resolved)) {
        fail(`Continuous-operation output already exists and will not be overwritten: ${resolved}`);
    }
    return { outputPath: resolved, outputRoot: configuredOutputRoot };
}

function writeExclusiveAtomic(outputBoundary, initialSerialized, context, finalizeBeforePublish) {
    const { outputPath, outputRoot } = outputBoundary;
    assertSafeExistingAncestor(outputRoot, 'Continuous-operation output root');
    fs.mkdirSync(outputRoot, { recursive: true });
    assertDirectDirectory(outputRoot, 'Continuous-operation output root');
    if (fs.existsSync(outputPath)) {
        fail(`Continuous-operation output already exists and will not be overwritten: ${outputPath}`);
    }
    const tempPath = path.join(outputRoot, `.${path.basename(outputPath)}.${context.randomUUID()}.tmp`);
    let finalLinked = false;
    try {
        fs.writeFileSync(tempPath, initialSerialized, { encoding: 'utf8', flag: 'wx' });
        fsyncFile(tempPath);
        const finalSerialized = finalizeBeforePublish({ stagingPath: tempPath });
        if (typeof finalSerialized !== 'string' || finalSerialized.length === 0) {
            fail('Continuous-operation final staged evidence is invalid.');
        }
        fs.writeFileSync(tempPath, finalSerialized, { encoding: 'utf8', flag: 'w' });
        fsyncFile(tempPath);
        if (fs.existsSync(outputPath)) {
            fail(`Continuous-operation output already exists and will not be overwritten: ${outputPath}`);
        }
        fs.linkSync(tempPath, outputPath);
        finalLinked = true;
        fs.unlinkSync(tempPath);
        assertUniqueRegularFile(outputPath, 'Continuous-operation evidence output');
        return finalSerialized;
    }
    catch (error) {
        if (fs.existsSync(tempPath))
            fs.unlinkSync(tempPath);
        if (finalLinked && fs.existsSync(outputPath))
            fs.unlinkSync(outputPath);
        throw error;
    }
}

function fsyncFile(filePath) {
    const handle = fs.openSync(filePath, 'r+');
    try {
        fs.fsyncSync(handle);
    }
    finally {
        fs.closeSync(handle);
    }
}

function run(argv = process.argv.slice(2), injectedContext = {}) {
    const context = { ...defaultRuntimeContext(), ...injectedContext };
    const input = parseArgs(argv, { now: context.now });
    if (input.help) {
        context.writeStdout('Usage: node scripts/verify-s7-continuous-operation.js --authority-snapshot-manifest <snapshot-manifest.json> --store <id> --store <id> --date-from YYYY-MM-DD --date-to YYYY-MM-DD [--output output/codex-evidence/continuous-operation/<new-file>.json]\n');
        return 0;
    }
    const authoritySnapshot = loadAuthoritySnapshotManifest(input.authoritySnapshotManifestPath, { ...context, verifyPackageIdentity: true });
    const currentnessBeforeWork = captureLiveAuthorityCurrentness(authoritySnapshot, context, 'continuous-before-work');
    input.databasePath = authoritySnapshot.databasePath;
    input.storesRoot = authoritySnapshot.storesRoot;
    const outputBoundary = input.outputPath
        ? resolveCanonicalOutputPath(input.outputPath, context, authoritySnapshot)
        : null;
    const Database = context.Database ?? requireLocalDbDependency('better-sqlite3');
    const database = new Database(input.databasePath, { readonly: true, fileMustExist: true });
    let integrityCheck;
    let manifest;
    let result;
    try {
        database.pragma('query_only = ON');
        const integrityRows = database.pragma('integrity_check');
        integrityCheck = integrityRows.map((row) => String(row.integrity_check ?? row[Object.keys(row)[0]]));
        const foreignKeyViolations = database.pragma('foreign_key_check');
        const snapshot = readContinuousOperationSnapshot(database, input);
        result = evaluateContinuousOperationSnapshot(snapshot, input);
        if (integrityCheck.length !== 1 || integrityCheck[0] !== 'ok') {
            result.passed = false;
            result.violations.unshift({ code: 'DATABASE_INTEGRITY_FAILED', message: 'PRAGMA integrity_check did not return ok.', actual: integrityCheck });
        }
        if (!Array.isArray(foreignKeyViolations) || foreignKeyViolations.length > 0) {
            result.passed = false;
            result.violations.unshift({
                code: 'DATABASE_FOREIGN_KEY_FAILED',
                message: 'PRAGMA foreign_key_check returned violations.',
                actual: foreignKeyViolations,
            });
        }
    }
    finally {
        database.close();
    }
    verifyAuthorityInputsUnchanged(authoritySnapshot, context, result._verifiedFileArtifacts);
    const currentnessBeforeFinalOutput = captureLiveAuthorityCurrentness(authoritySnapshot, context, 'continuous-before-final-output');
    const currentnessValidation = assertMatchingAuthorityCurrentnessProofs([currentnessBeforeWork, currentnessBeforeFinalOutput], authoritySnapshot.snapshotArtifact, 'Continuous-operation authority currentness');
    input.authorityCurrentness = {
        method: currentnessValidation.method,
        expectedSnapshot: currentnessValidation.expectedSnapshot,
        captures: [currentnessBeforeWork, currentnessBeforeFinalOutput],
        passed: true,
    };
    input.publication = outputBoundary
        ? {
            state: 'pending-staging-recheck',
            outputPath: outputBoundary.outputPath,
            stagedVerificationCaptureLabel: 'continuous-after-staging-output',
        }
        : null;
    manifest = buildEvidenceManifest(input.databasePath, input, result, integrityCheck, authoritySnapshot);
    let serialized = `${JSON.stringify(manifest, null, 2)}\n`;
    if (outputBoundary && manifest.status === 'PASSED') {
        serialized = writeExclusiveAtomic(outputBoundary, serialized, context, ({ stagingPath }) => {
            if (context.afterOutputWritten !== undefined && context.afterOutputWritten !== null) {
                if (typeof context.afterOutputWritten !== 'function') {
                    fail('afterOutputWritten must be null or a function.');
                }
                context.afterOutputWritten({
                    authoritySnapshot,
                    outputPath: outputBoundary.outputPath,
                    stagingPath,
                    finalPathPublished: false,
                });
            }
            verifyAuthorityInputsUnchanged(authoritySnapshot, context, result._verifiedFileArtifacts);
            const currentnessAfterStagingOutput = captureLiveAuthorityCurrentness(authoritySnapshot, context, 'continuous-after-staging-output');
            const finalCurrentnessValidation = assertMatchingAuthorityCurrentnessProofs([
                currentnessBeforeWork,
                currentnessBeforeFinalOutput,
                currentnessAfterStagingOutput,
            ], authoritySnapshot.snapshotArtifact, 'Continuous-operation final authority currentness');
            input.authorityCurrentness = {
                method: finalCurrentnessValidation.method,
                expectedSnapshot: finalCurrentnessValidation.expectedSnapshot,
                captures: [
                    currentnessBeforeWork,
                    currentnessBeforeFinalOutput,
                    currentnessAfterStagingOutput,
                ],
                passed: true,
            };
            input.publication = {
                state: 'atomic-published',
                outputPath: outputBoundary.outputPath,
                stagedVerificationCaptureLabel: 'continuous-after-staging-output',
            };
            manifest = buildEvidenceManifest(input.databasePath, input, result, integrityCheck, authoritySnapshot);
            return `${JSON.stringify(manifest, null, 2)}\n`;
        });
    }
    context.writeStdout(serialized);
    return manifest.status === 'PASSED' ? 0 : 2;
}

module.exports = { parseArgs, resolveCanonicalOutputPath, writeExclusiveAtomic, fsyncFile, run };

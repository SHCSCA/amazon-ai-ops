// 按职责复用原有严格校验，公共入口继续保持兼容。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { BUNDLE_KIND, BUNDLE_SCHEMA_VERSION, GATE_IDS, ROOT, canonicalPath, normalizedPath, parseArgs, readJson, requireRegularUnlinkedFile, stableEqual } = require('./s7-delivery-export-contracts.js');
const { inspectCanonicalPackage, validateAuthoritySnapshot, validateReadinessReport } = require('./s7-delivery-export-identity.js');
const { classifyReferencedArtifact, collectHashedArtifactReferences, copyWithRecord, inspectSelectedEvidence, safeName, validateOperationalEvidenceSemantics, validateReferencedArtifact } = require('./s7-delivery-export-references.js');
const { assertCurrentRevalidation, runReadyRevalidation } = require('./s7-delivery-export-revalidation.js');

function readmeContract(text, ready) {
    const claimsReady = /^\*\*DELIVERY:\s*APP_READY\b/im.test(text);
    const claimsNonReady = /^\*\*DELIVERY:\s*(?:APP_NEEDS_WORK|IN_PROGRESS|REPORT_COLLECTION_READY \/ APP_NEEDS_WORK)\b/im.test(text);
    return ready ? claimsReady : (claimsNonReady && !claimsReady);
}

function writeJsonAtomic(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`);
    try {
        fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
        fs.renameSync(tempPath, filePath);
    }
    finally {
        if (fs.existsSync(tempPath))
            fs.unlinkSync(tempPath);
    }
}

function exportBundle({ readinessPath, outDir, readmePath = path.join(ROOT, 'README.md'), rootDir = ROOT, releaseRoot = path.join(rootDir, 'apps', 'desktop', 'release'), evidenceRoot = path.join(rootDir, 'output', 'codex-evidence'), readinessRunner = null, now = new Date(), } = {}) {
    if (!readinessPath || !path.isAbsolute(readinessPath)) {
        throw new Error('--readiness must be an explicit absolute path.');
    }
    if (!outDir || !path.isAbsolute(outDir)) {
        throw new Error('--out must be an explicit absolute path.');
    }
    if (fs.existsSync(outDir)) {
        throw new Error(`Refusing to overwrite existing S7 delivery bundle: ${outDir}`);
    }
    requireRegularUnlinkedFile(readinessPath, 'Mission readiness');
    requireRegularUnlinkedFile(readmePath, 'README');
    const readiness = readJson(readinessPath);
    const readinessValidation = validateReadinessReport(readiness);
    if (!readinessValidation.ok) {
        throw new Error(`Invalid Mission readiness report: ${readinessValidation.errors.join('; ')}`);
    }
    const canonicalPackage = inspectCanonicalPackage({ releaseRoot });
    if (!stableEqual(canonicalPackage.identity, readinessValidation.packageIdentity)) {
        throw new Error('Mission readiness package identity does not match the current canonical package.');
    }
    const snapshotPath = readiness.evidenceSelection.authoritySnapshotManifest;
    const snapshotValidation = validateAuthoritySnapshot(snapshotPath, readiness, readinessValidation.packageIdentity);
    if (!snapshotValidation.ok) {
        throw new Error(`Invalid authority snapshot v2: ${snapshotValidation.errors.join('; ')}`);
    }
    const selectedEvidence = inspectSelectedEvidence(readiness);
    validateOperationalEvidenceSemantics(selectedEvidence);
    const readmeText = fs.readFileSync(readmePath, 'utf8');
    if (!readmeContract(readmeText, readinessValidation.ready)) {
        throw new Error(readinessValidation.ready
            ? 'README must explicitly state DELIVERY: APP_READY before READY export.'
            : 'README must explicitly remain non-ready for an APP_NEEDS_WORK export.');
    }
    const currentRevalidation = assertCurrentRevalidation(readiness, runReadyRevalidation(readiness, { rootDir, readinessRunner }), readinessValidation.ready ? 'ready' : 'non-ready');
    const parentDir = path.dirname(outDir);
    fs.mkdirSync(parentDir, { recursive: true });
    const stagingDir = path.join(parentDir, `.${path.basename(outDir)}.${process.pid}.${crypto.randomUUID()}.tmp`);
    fs.mkdirSync(stagingDir, { recursive: false });
    try {
        const files = [];
        const readinessFile = copyWithRecord({
            bundleDir: stagingDir,
            destinationRelativePath: 'evidence/mission-control-production-readiness.json',
            id: 'mission-readiness',
            role: 'mission-readiness',
            sourcePath: readinessPath,
        });
        files.push(readinessFile);
        const snapshotFile = copyWithRecord({
            bundleDir: stagingDir,
            destinationRelativePath: 'evidence/authority-snapshot-manifest.json',
            id: 'authority-snapshot-manifest',
            role: 'authority-snapshot-manifest',
            sourcePath: snapshotPath,
        });
        files.push(snapshotFile);
        const readmeFile = copyWithRecord({
            bundleDir: stagingDir,
            destinationRelativePath: 'handoff/README.md',
            id: 'readme',
            role: 'handoff-document',
            sourcePath: readmePath,
        });
        files.push(readmeFile);
        const gateArtifacts = [];
        for (const record of selectedEvidence) {
            let bundled = null;
            if (record.sourceExists) {
                bundled = copyWithRecord({
                    bundleDir: stagingDir,
                    destinationRelativePath: `evidence/gates/${safeName(record.gateId)}.json`,
                    id: `gate:${record.gateId}`,
                    role: 'gate-evidence',
                    sourcePath: record.sourcePath,
                });
                files.push(bundled);
            }
            gateArtifacts.push({
                gateId: record.gateId,
                status: record.status,
                ok: record.ok,
                sourcePath: record.sourcePath,
                sourceExists: record.sourceExists,
                sizeBytes: bundled?.sizeBytes ?? null,
                sha256: bundled?.sha256 ?? null,
                bundlePath: bundled?.bundlePath ?? null,
            });
        }
        const supportPaths = [
            path.join(rootDir, 'package.json'),
            path.join(rootDir, 'scripts', 'export-s7-delivery-bundle.js'),
            path.join(rootDir, 'scripts', 'verify-s7-non-ready-safety.js'),
            path.join(rootDir, 'scripts', 'verify-s7-ready-safety.js'),
            path.join(rootDir, 'scripts', 'verify-mission-control-production-readiness.js'),
        ];
        const supportFiles = [];
        for (const sourcePath of supportPaths) {
            if (!fs.existsSync(sourcePath))
                continue;
            const bundled = copyWithRecord({
                bundleDir: stagingDir,
                destinationRelativePath: `handoff/${safeName(path.relative(rootDir, sourcePath))}`,
                id: `support:${path.relative(rootDir, sourcePath).replace(/\\/g, '/')}`,
                role: 'verification-support',
                sourcePath,
            });
            files.push(bundled);
            supportFiles.push(bundled.id);
        }
        const rootSources = new Set(files.map((file) => normalizedPath(file.sourcePath)));
        const closureCandidates = [];
        collectHashedArtifactReferences(snapshotValidation.snapshot, 'authority-snapshot', closureCandidates);
        for (const record of selectedEvidence.filter((candidate) => candidate.ok && candidate.sourceJson)) {
            collectHashedArtifactReferences(record.sourceJson, `gate:${record.gateId}`, closureCandidates);
        }
        closureCandidates.push({
            origin: 'authority-snapshot',
            ...snapshotValidation.snapshotArtifact,
        });
        closureCandidates.push({
            origin: 'canonical-package:executable',
            ...canonicalPackage.artifacts.executable,
        });
        closureCandidates.push({
            origin: 'canonical-package:main-bundle',
            ...canonicalPackage.artifacts.mainBundle,
        });
        const deduped = new Map();
        for (const candidate of closureCandidates) {
            if (rootSources.has(normalizedPath(candidate.sourcePath)))
                continue;
            const validated = validateReferencedArtifact(candidate);
            const key = normalizedPath(validated.sourcePath);
            const previous = deduped.get(key);
            if (previous
                && (previous.sha256 !== validated.sha256 || previous.sizeBytes !== validated.sizeBytes)) {
                throw new Error(`Conflicting hash bindings for referenced artifact: ${validated.sourcePath}`);
            }
            if (!previous)
                deduped.set(key, validated);
        }
        const externalArtifacts = [];
        const closureFiles = [];
        for (const [key, reference] of [...deduped.entries()].sort(([left], [right]) => left.localeCompare(right))) {
            const classification = classifyReferencedArtifact(reference, evidenceRoot);
            if (!classification.copy) {
                externalArtifacts.push({
                    id: `external:${externalArtifacts.length + 1}`,
                    origin: reference.origin,
                    sourcePath: reference.sourcePath,
                    sizeBytes: reference.sizeBytes,
                    sha256: reference.sha256,
                    copied: false,
                    policy: classification.policy,
                });
                continue;
            }
            const bundled = copyWithRecord({
                bundleDir: stagingDir,
                destinationRelativePath: `evidence/artifacts/${reference.sha256.slice(0, 16)}-${safeName(path.basename(reference.sourcePath))}`,
                id: `closure:${closureFiles.length + 1}`,
                role: 'evidence-closure',
                sourcePath: reference.sourcePath,
            });
            files.push(bundled);
            closureFiles.push({
                ...bundled,
                origin: reference.origin,
                policy: classification.policy,
            });
        }
        const manifest = {
            kind: BUNDLE_KIND,
            schemaVersion: BUNDLE_SCHEMA_VERSION,
            generatedAt: now.toISOString(),
            status: readiness.status,
            appReady: readiness.appReady,
            warning: readinessValidation.ready
                ? 'APP_READY Mission bundle. READY credit still requires verify:s7-ready-safety against current source artifacts.'
                : 'APP_NEEDS_WORK Mission bundle. It must never be presented as READY.',
            gateSummary: {
                total: GATE_IDS.length,
                passed: readinessValidation.passed,
                failed: readinessValidation.failed,
            },
            gateOrder: [...GATE_IDS],
            readiness: {
                sourcePath: readinessFile.sourcePath,
                sizeBytes: readinessFile.sizeBytes,
                sha256: readinessFile.sha256,
                bundlePath: readinessFile.bundlePath,
                generatedAt: readiness.generatedAt,
            },
            authoritySnapshot: {
                ok: readiness.authoritySnapshot.ok,
                sourcePath: snapshotFile.sourcePath,
                sizeBytes: snapshotFile.sizeBytes,
                sha256: snapshotFile.sha256,
                bundlePath: snapshotFile.bundlePath,
                schemaVersion: snapshotValidation.snapshot.schemaVersion,
                exportedAt: snapshotValidation.snapshot.exportedAt,
                databaseArtifactSha256: snapshotValidation.snapshotArtifact.sha256,
                databaseArtifactSizeBytes: snapshotValidation.snapshotArtifact.sizeBytes,
                databaseCopied: false,
            },
            authorityDatabase: {
                sourcePath: canonicalPath(readiness.evidenceSelection.authorityDb),
                copied: false,
                policy: 'Live authority DB is never copied; READY is revalidated with WAL-aware online backup.',
            },
            packageIdentity: { ...canonicalPackage.identity },
            canonicalPackage: {
                executablePath: canonicalPackage.paths.executablePath,
                appContentPath: canonicalPackage.paths.appContentPath,
                mainBundlePath: canonicalPackage.paths.mainBundlePath,
                appContentFileCount: canonicalPackage.appContentFileCount,
                copied: false,
                policy: 'Package binaries and app-content are not copied; their canonical hashes are rechecked.',
            },
            currentRevalidation,
            gateArtifacts,
            files,
            closure: {
                copiedArtifactCount: closureFiles.length,
                externalHashOnlyArtifactCount: externalArtifacts.length,
                copiedArtifacts: closureFiles,
                externalArtifacts,
                complete: true,
                policy: 'Evidence JSON/screenshots under output/codex-evidence are bundled; DB, raw reports, package binaries, and external runtime files remain hash-only.',
            },
            supportFiles,
            exclusions: [
                'credentials, cookies, browser profiles, API keys, and passwords',
                'live and snapshot SQLite database bytes',
                'raw Lingxing report files',
                'installer, portable, unpacked EXE, and packaged app-content bytes',
            ],
        };
        const manifestPath = path.join(stagingDir, 's7-delivery-bundle-manifest.json');
        writeJsonAtomic(manifestPath, manifest);
        fs.renameSync(stagingDir, outDir);
        return {
            manifest,
            manifestPath: path.join(outDir, path.basename(manifestPath)),
            outDir,
        };
    }
    catch (error) {
        fs.rmSync(stagingDir, { recursive: true, force: true });
        throw error;
    }
}

function usage() {
    return [
        'Usage: node scripts/export-s7-delivery-bundle.js',
        '  --readiness <absolute mission-control-production-readiness.json>',
        '  --out <absolute new bundle directory>',
        '  [--readme <absolute README.md>]',
    ].join('\n');
}

function main(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    if (args.help) {
        process.stdout.write(`${usage()}\n`);
        return;
    }
    if (!args.readiness)
        throw new Error('Missing required argument: --readiness');
    if (!args.out)
        throw new Error('Missing required argument: --out');
    const result = exportBundle({
        readinessPath: path.resolve(args.readiness),
        outDir: path.resolve(args.out),
        readmePath: path.resolve(args.readme || path.join(ROOT, 'README.md')),
    });
    process.stdout.write(`S7 delivery bundle exported: ${result.outDir}\n`);
    process.stdout.write(`Manifest: ${result.manifestPath}\n`);
    process.stdout.write(`${result.manifest.status}: ${result.manifest.gateSummary.passed}/8 gates.\n`);
}

module.exports = { readmeContract, writeJsonAtomic, exportBundle, usage, main };

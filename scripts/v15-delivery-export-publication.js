// 按职责复用原有严格校验，公共入口继续保持兼容。
const fs = require('fs');
const path = require('path');
const { resolveBoundAdReadbackAuthorityDbPath } = require('./ad-readback-authority-db');
const { PACKAGE_ADVERSARIAL_NODE_ENV_CONTRACT_VERSION, validateAdversarialNodeEnvBundleSummaryContract, validateAdversarialNodeEnvEvidence, validateAdversarialNodeEnvSelectionContract, } = require('./smoke-package-adversarial-node-env');
const { validatePackageSecurityEvidence } = require('./smoke-package-security-boundaries');
const { validatePackageLaunchSmokeEvidence } = require('./smoke-package-launch');
const { bundleRoot, explicitFileArg, isInside, parseArgs, readJson, root, samePath, sha256, validatedPackageLaunchEvidencePaths } = require('./v15-delivery-export-contracts.js');
const { collectEvidencePaths, resolveDataReconciliationEvidence } = require('./v15-delivery-export-evidence.js');
const { assertNoObviousSecret, copyFile, writeGitSnapshot } = require('./v15-delivery-export-files.js');
const { buildPackageIndex, writePackageIndex } = require('./v15-delivery-export-packages.js');
const { buildRealReportIndex, collectFinalReadinessBlockers, writeRealReportIndex } = require('./v15-delivery-export-reports.js');
const { assertAppReadyFinalReadinessHasPackageEvidence, assertAppReadyReadmeState, assertManifestDrivenFinalReadiness, assertSelectedReadbackPassesVerifier, latestFinalReadinessEvidence } = require('./v15-delivery-export-selection.js');

function main() {
    const args = parseArgs(process.argv);
    const finalReadinessPath = path.resolve(args['final-readiness'] || latestFinalReadinessEvidence() || '');
    if (!finalReadinessPath || !fs.existsSync(finalReadinessPath)) {
        throw new Error('Missing final readiness evidence. Run pnpm run verify:v15-final-readiness first.');
    }
    const finalReadiness = readJson(finalReadinessPath);
    finalReadiness.__path = finalReadinessPath;
    assertManifestDrivenFinalReadiness(finalReadiness, finalReadinessPath);
    const claimsAppReady = finalReadiness.status === 'APP_READY' || finalReadiness.appReady === true;
    const recordedAuthorityDbPath = finalReadiness.evidenceSelection?.authorityDbPath;
    const authorityDbPath = recordedAuthorityDbPath || claimsAppReady
        ? resolveBoundAdReadbackAuthorityDbPath(recordedAuthorityDbPath, args.db)
        : null;
    assertSelectedReadbackPassesVerifier(finalReadiness, authorityDbPath);
    const readmePath = path.resolve(args.readme || path.join(root, 'README.md'));
    const packageUiManifestPath = explicitFileArg(args, 'package-ui-manifest');
    const workspaceUiManifestPath = explicitFileArg(args, 'workspace-ui-manifest');
    const businessUiSmokePath = explicitFileArg(args, 'business-ui-smoke');
    const fullTestEvidencePath = explicitFileArg(args, 'full-test-evidence');
    const packageSecurityEvidencePath = explicitFileArg(args, 'package-security-evidence');
    const packageAdversarialNodeEnvEvidencePath = explicitFileArg(args, 'package-adversarial-node-env-evidence');
    if (packageSecurityEvidencePath) {
        const validation = validatePackageSecurityEvidence(readJson(packageSecurityEvidencePath));
        if (!validation.passed) {
            throw new Error(`Refusing to export invalid package security evidence: ${validation.violations.join('; ')}`);
        }
    }
    const adversarialNodeEnvSelectionContract = validateAdversarialNodeEnvSelectionContract(finalReadiness.packageAdversarialNodeEnv);
    if (!adversarialNodeEnvSelectionContract.passed) {
        throw new Error(`Refusing to export final readiness without the current adversarial NODE_ENV package evidence contract ${PACKAGE_ADVERSARIAL_NODE_ENV_CONTRACT_VERSION}: `
            + adversarialNodeEnvSelectionContract.violations.join('; '));
    }
    if (!packageAdversarialNodeEnvEvidencePath) {
        throw new Error('Refusing to export current delivery bundle without explicit adversarial NODE_ENV package evidence.');
    }
    if (packageAdversarialNodeEnvEvidencePath) {
        const selected = finalReadiness.packageAdversarialNodeEnv;
        const validation = validateAdversarialNodeEnvEvidence(readJson(packageAdversarialNodeEnvEvidencePath), selected?.package || {});
        if (!validation.passed) {
            throw new Error(`Refusing to export invalid adversarial NODE_ENV package evidence: ${validation.violations.join('; ')}`);
        }
        if (selected?.passed !== true
            || !selected?.evidencePath
            || !samePath(selected.evidencePath, packageAdversarialNodeEnvEvidencePath)
            || !/^[A-F0-9]{64}$/.test(String(selected?.evidenceSha256 || ''))
            || sha256(packageAdversarialNodeEnvEvidencePath) !== String(selected.evidenceSha256).toUpperCase()) {
            throw new Error('Refusing to export adversarial NODE_ENV evidence that is not the passing hash-bound selection in final readiness.');
        }
    }
    assertAppReadyReadmeState(finalReadiness, readmePath);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const bundleDir = path.resolve(args.out || path.join(bundleRoot, `v15-delivery-bundle-${stamp}`));
    if (fs.existsSync(bundleDir) && isInside(bundleDir, bundleRoot)) {
        fs.rmSync(bundleDir, { recursive: true, force: true });
    }
    fs.mkdirSync(bundleDir, { recursive: true });
    const manifest = {
        generatedAt: new Date().toISOString(),
        bundleDir,
        status: finalReadiness.status,
        appReady: Boolean(finalReadiness.appReady),
        reportCollectionReady: Boolean(finalReadiness.reportCollectionReady),
        listingReadReady: Boolean(finalReadiness.listingReadReady),
        warning: finalReadiness.appReady
            ? 'APP_READY evidence bundle.'
            : 'APP_NEEDS_WORK evidence bundle. Do not present this bundle as final READY until every gate passes.',
        sensitiveDataNotice: [
            'This bundle excludes browser profiles, credentials, AppData SQLite DB files, raw downloaded report XLSX files, and installer binaries.',
            'Screenshots and evidence JSON may still contain business context such as store, ASIN, Listing text, URLs, and local paths.',
        ],
        excludedByDesign: [
            'storage/browser-data',
            'AppData amazon-ai-ops.db',
            'raw downloaded XLSX reports',
            'installer EXE',
            'API keys and passwords',
        ],
        authorityDatabase: {
            sourcePath: authorityDbPath,
            existsAtExport: Boolean(authorityDbPath && fs.existsSync(authorityDbPath)),
            copied: false,
            policy: 'SQLite authority database identity is recorded for revalidation and the database file is never copied.',
        },
        files: [],
        missing: [],
        dataReconciliation: {
            present: false,
            canonicalSource: null,
            canonical: null,
            blockers: [],
            sourceJsonPath: null,
            sourceMarkdownPath: null,
            bundleJson: null,
            bundleMarkdown: null,
        },
        finalReadinessBlockers: collectFinalReadinessBlockers(finalReadiness),
        realReportIndex: {
            present: false,
            count: 0,
            existingCount: 0,
            missingCount: 0,
            bundleJson: null,
            copyPolicy: 'Raw Lingxing report spreadsheets are not copied into the delivery bundle.',
        },
        packageIndex: {
            present: false,
            count: 0,
            existingCount: 0,
            missingCount: 0,
            bundleJson: null,
            copyPolicy: 'Installer and portable EXE binaries are not copied into the delivery bundle.',
        },
        uiEvidence: {
            packageUiManifest: {
                sourcePath: packageUiManifestPath,
                present: Boolean(packageUiManifestPath),
            },
            workspaceUiManifest: {
                sourcePath: workspaceUiManifestPath,
                present: Boolean(workspaceUiManifestPath),
            },
            copyPolicy: 'Explicit package/workspace UI manifests and every referenced screenshot/target JSON are copied into the bundle.',
        },
        sourceEvidence: {
            businessUiSmoke: {
                sourcePath: businessUiSmokePath,
                present: Boolean(businessUiSmokePath),
            },
            fullTestEvidence: {
                sourcePath: fullTestEvidencePath,
                present: Boolean(fullTestEvidencePath),
            },
            copyPolicy: 'Explicit source-level smoke and full-test evidence are copied into the bundle without latest-file discovery.',
        },
        securityEvidence: {
            packageSecurityBoundaries: {
                sourcePath: packageSecurityEvidencePath,
                present: Boolean(packageSecurityEvidencePath),
                bundlePath: null,
                sha256: null,
            },
            packageAdversarialNodeEnvSmoke: {
                contractVersion: PACKAGE_ADVERSARIAL_NODE_ENV_CONTRACT_VERSION,
                sourcePath: packageAdversarialNodeEnvEvidencePath,
                present: Boolean(packageAdversarialNodeEnvEvidencePath),
                requiredByFinalReadiness: true,
                bundlePath: null,
                sha256: null,
            },
            copyPolicy: 'Explicit static and adversarial-runtime package security evidence is schema-validated and copied without source paths, URLs, or credential values in its payload.',
        },
    };
    const docsDir = path.join(bundleDir, 'docs');
    copyFile(readmePath, docsDir, 'README.md', manifest);
    for (const relativePath of [
        'package.json',
        'docs/V1_5_PROGRESS_REPORT.md',
        'docs/V1_5_ACCEPTANCE_MATRIX.md',
        'docs/USER_GUIDE_v1_5.md',
        'docs/REAL_AD_READBACK_RUNBOOK.md',
        'docs/V1_5_ORCHESTRATOR_CLOSEOUT.md',
    ]) {
        copyFile(path.join(root, relativePath), docsDir, relativePath, manifest);
    }
    const scriptsDir = path.join(bundleDir, 'scripts');
    for (const relativePath of [
        'scripts/verify-v15-final-readiness.js',
        'scripts/verify-v15-non-ready-safety.js',
        'scripts/verify-v15-ready-safety.js',
        'scripts/export-v15-delivery-bundle.js',
        'scripts/write-v15-evidence-manifest.js',
        'scripts/verify-v15-delivery-evidence.js',
        'scripts/smoke-export-v15-delivery-bundle.js',
        'scripts/verify-listing-read-evidence.js',
        'scripts/verify-ai-live.js',
        'scripts/verify-ai-live-connection.js',
        'scripts/run-ai-structural-mock.js',
        'scripts/verify-ai-structural-mock-evidence.js',
        'scripts/verify-listing-ai-draft-evidence.js',
        'scripts/verify-ad-ai-explanation-evidence.js',
        'scripts/verify-ad-execution-fail-closed.js',
        'scripts/create-ad-readback-evidence-template.js',
        'scripts/create-ad-readback-candidate-from-recommendation.js',
        'scripts/prepare-ad-readback-session.js',
        'scripts/verify-ad-readback-session.js',
        'scripts/fill-ad-readback-session.js',
        'scripts/fill-ad-readback-evidence.js',
        'scripts/ad-readback-authority-db.js',
        'scripts/verify-ad-readback-evidence.js',
        'scripts/reconcile-lingxing-full8-data.js',
        'scripts/smoke-package-security-boundaries.js',
        'scripts/smoke-package-adversarial-node-env.js',
    ]) {
        copyFile(path.join(root, relativePath), scriptsDir, relativePath, manifest);
    }
    writeGitSnapshot(bundleDir, manifest);
    const evidenceOutDir = path.join(bundleDir, 'evidence');
    const screenshotsDir = path.join(bundleDir, 'screenshots');
    const dataReconciliation = resolveDataReconciliationEvidence(args);
    const copiedDataReconciliationJson = dataReconciliation.sourceJsonPath
        ? copyFile(dataReconciliation.sourceJsonPath, evidenceOutDir, 'data-reconciliation:json', manifest)
        : null;
    const copiedDataReconciliationMarkdown = dataReconciliation.sourceMarkdownPath
        ? copyFile(dataReconciliation.sourceMarkdownPath, evidenceOutDir, 'data-reconciliation:markdown', manifest)
        : null;
    manifest.dataReconciliation = {
        present: dataReconciliation.present,
        canonicalSource: dataReconciliation.canonicalSource,
        canonical: dataReconciliation.canonical,
        blockers: dataReconciliation.blockers,
        sourceJsonPath: dataReconciliation.sourceJsonPath,
        sourceMarkdownPath: dataReconciliation.sourceMarkdownPath,
        bundleJson: copiedDataReconciliationJson ? path.relative(bundleDir, copiedDataReconciliationJson) : null,
        bundleMarkdown: copiedDataReconciliationMarkdown ? path.relative(bundleDir, copiedDataReconciliationMarkdown) : null,
    };
    if (manifest.appReady && manifest.dataReconciliation.blockers.length > 0) {
        throw new Error(`Refusing to export APP_READY delivery bundle because data reconciliation has blockers: ${manifest.dataReconciliation.blockers.join('; ')}`);
    }
    if (manifest.appReady && Number(manifest.dataReconciliation.canonical?.spend || 0) <= 0) {
        throw new Error('Refusing to export APP_READY delivery bundle because data reconciliation has no positive canonical ad spend.');
    }
    const evidencePaths = collectEvidencePaths(finalReadiness, {
        includeLatestExtras: args['skip-latest-extras'] !== 'true',
        packageUiManifest: packageUiManifestPath,
        workspaceUiManifest: workspaceUiManifestPath,
        businessUiSmoke: businessUiSmokePath,
        fullTestEvidence: fullTestEvidencePath,
        packageSecurityEvidence: packageSecurityEvidencePath,
        packageAdversarialNodeEnvEvidence: packageAdversarialNodeEnvEvidencePath,
    });
    const packageIndex = buildPackageIndex(path.resolve(args['release-dir'] || path.join(root, 'apps', 'desktop', 'release')));
    assertAppReadyFinalReadinessHasPackageEvidence(finalReadiness, packageIndex);
    const packageIndexPath = writePackageIndex(bundleDir, evidenceOutDir, manifest, packageIndex);
    manifest.packageIndex = {
        present: packageIndex.packages.length > 0,
        count: packageIndex.packages.length,
        existingCount: packageIndex.packages.filter((item) => item.exists).length,
        missingCount: packageIndex.packages.filter((item) => !item.exists).length,
        bundleJson: path.relative(bundleDir, packageIndexPath),
        copyPolicy: packageIndex.copyPolicy,
    };
    if (manifest.appReady) {
        if (!manifest.packageIndex.present || manifest.packageIndex.count <= 0) {
            throw new Error('Refusing to export APP_READY delivery bundle because installer/package hash evidence is missing.');
        }
        if (!packageIndex.packages.some((item) => item.kind === 'installer')) {
            throw new Error('Refusing to export APP_READY delivery bundle because installer package hash evidence is missing.');
        }
        if (!packageIndex.packages.some((item) => item.kind === 'portable')) {
            throw new Error('Refusing to export APP_READY delivery bundle because portable no-install package hash evidence is missing.');
        }
        if (manifest.packageIndex.missingCount > 0) {
            throw new Error('Refusing to export APP_READY delivery bundle because installer/package index has missing files.');
        }
    }
    const reportIndex = buildRealReportIndex({
        finalReadiness,
        dataReconciliation: dataReconciliation.sourceJsonPath ? readJson(dataReconciliation.sourceJsonPath) : null,
        evidencePaths,
    });
    const reportIndexPath = writeRealReportIndex(bundleDir, evidenceOutDir, manifest, reportIndex);
    manifest.realReportIndex = {
        present: reportIndex.reports.length > 0,
        count: reportIndex.reports.length,
        existingCount: reportIndex.reports.filter((report) => report.exists).length,
        missingCount: reportIndex.reports.filter((report) => !report.exists).length,
        bundleJson: path.relative(bundleDir, reportIndexPath),
        copyPolicy: reportIndex.copyPolicy,
    };
    if (manifest.appReady) {
        if (!manifest.realReportIndex.present || manifest.realReportIndex.count <= 0) {
            throw new Error('Refusing to export APP_READY delivery bundle because real report index has no source reports.');
        }
        if (manifest.realReportIndex.missingCount > 0) {
            throw new Error('Refusing to export APP_READY delivery bundle because real report index has missing source reports.');
        }
    }
    for (const launchEvidencePath of validatedPackageLaunchEvidencePaths) {
        const validation = validatePackageLaunchSmokeEvidence(readJson(launchEvidencePath));
        if (!validation.passed) {
            throw new Error(`Package launch strict contract changed before bundle copy: ${validation.violations
                .map((violation) => `${violation.code}@${violation.path}`)
                .join('; ')}`);
        }
    }
    for (const sourcePath of evidencePaths) {
        const ext = path.extname(sourcePath).toLowerCase();
        const destinationDir = ['.png', '.jpg', '.jpeg', '.webp'].includes(ext) ? screenshotsDir : evidenceOutDir;
        const copied = copyFile(sourcePath, destinationDir, `evidence:${path.basename(sourcePath)}`, manifest);
        if (copied)
            assertNoObviousSecret(copied);
    }
    if (packageSecurityEvidencePath) {
        const bundledSecurityEvidence = manifest.files.find((file) => file.sourcePath === packageSecurityEvidencePath);
        if (!bundledSecurityEvidence) {
            throw new Error('Package security evidence was selected but not copied into the delivery bundle.');
        }
        manifest.securityEvidence.packageSecurityBoundaries.bundlePath = bundledSecurityEvidence.bundlePath;
        manifest.securityEvidence.packageSecurityBoundaries.sha256 = bundledSecurityEvidence.sha256;
    }
    if (packageAdversarialNodeEnvEvidencePath) {
        const bundledEvidence = manifest.files.find((file) => file.sourcePath === packageAdversarialNodeEnvEvidencePath);
        if (!bundledEvidence) {
            throw new Error('Adversarial NODE_ENV package evidence was selected but not copied into the delivery bundle.');
        }
        manifest.securityEvidence.packageAdversarialNodeEnvSmoke.bundlePath = bundledEvidence.bundlePath;
        manifest.securityEvidence.packageAdversarialNodeEnvSmoke.sha256 = bundledEvidence.sha256;
        const summaryContract = validateAdversarialNodeEnvBundleSummaryContract(manifest.securityEvidence.packageAdversarialNodeEnvSmoke);
        if (!summaryContract.passed) {
            throw new Error(`Invalid adversarial NODE_ENV bundle summary contract: ${summaryContract.violations.join('; ')}`);
        }
    }
    for (const file of manifest.files) {
        assertNoObviousSecret(path.join(bundleDir, file.bundlePath));
    }
    const manifestPath = path.join(bundleDir, 'delivery-bundle-manifest.json');
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    console.log(`Delivery bundle exported: ${bundleDir}`);
    console.log(`Manifest: ${manifestPath}`);
    console.log(`Status: ${manifest.status}`);
    if (!manifest.appReady) {
        console.log('Notice: bundle is APP_NEEDS_WORK, not final READY.');
    }
}

module.exports = { main };

// 按证据职责拆分共享夹具与断言，保留原有完整测试名称。
import { PACKAGE_MAIN_BUNDLE_SHA256, bundleAdversarialNodeEnvEvidence, fs, os, path, strictNonReadyGates, writeValidAdversarialNodeEnvEvidence } from './v15-non-ready-test-environment.mjs';
import { finalPackageIndex, runNode, sha256File, validPackageLaunchSmoke, validPackageSecurityEvidence, writeJson, writeReadme } from './v15-non-ready-test-artifacts.mjs';
import { bundlePackageUiReferencedArtifacts, validPackageUiEvidence } from './v15-non-ready-test-ui.mjs';
function writeStrictNonReadyFixture(options) {
    const { artifactDir, evidenceManifest, finalReadiness, packageSmoke, packageUiManifest = path.join(artifactDir, 'package-ui-manifest.json'), packageSecurityEvidence = path.join(artifactDir, 'package-security-boundaries.json'), packageAdversarialNodeEnvEvidence = path.join(artifactDir, 'package-adversarial-node-env.json'), bundleManifest, readme, mutateFinalReadiness = () => { }, } = options;
    fs.mkdirSync(artifactDir, { recursive: true });
    const packageIndex = finalPackageIndex(path.join(artifactDir, 'release'));
    const portablePackage = packageIndex.packages.find((item) => item.kind === 'portable');
    const smoke = validPackageLaunchSmoke(path.join(artifactDir, 'release'), portablePackage);
    const authorityDbPath = path.join(artifactDir, 'authority.db');
    fs.writeFileSync(authorityDbPath, 'authority database identity fixture\n', 'utf8');
    writeReadme(readme);
    writeJson(packageSmoke, smoke);
    const packageUi = validPackageUiEvidence(artifactDir, smoke, authorityDbPath);
    writeJson(packageUiManifest, packageUi);
    const packageSecurity = validPackageSecurityEvidence(smoke, packageUi);
    writeJson(packageSecurityEvidence, packageSecurity);
    const adversarialFixture = writeValidAdversarialNodeEnvEvidence(packageAdversarialNodeEnvEvidence, {
        executableSha256: smoke.artifacts.unpacked.sha256,
        appContentSha256: packageUi.artifactsAfter.appContent.sha256,
        mainBundleSha256: PACKAGE_MAIN_BUNDLE_SHA256,
        rendererEntryPath: path.join(packageUi.artifactsAfter.appContent.rootPath, 'dist', 'renderer', 'index.html'),
    });
    writeJson(evidenceManifest, {
        kind: 'v15-final-readiness-evidence-manifest',
        evidence: { packageAdversarialNodeEnv: adversarialFixture.manifestEntry },
    });
    const finalReadinessJson = {
        status: 'APP_NEEDS_WORK',
        appReady: false,
        reportCollectionReady: true,
        listingReadReady: true,
        evidenceSelection: {
            mode: 'manifest',
            manifestPath: evidenceManifest,
            authorityDbPath,
        },
        packageIndex,
        packageLaunchSmoke: {
            present: true,
            evidencePath: packageSmoke,
            selectedBy: 'explicit-arg',
            generatedAt: smoke.generatedAt,
            passed: true,
            artifacts: smoke.artifacts,
            checks: smoke.checks,
        },
        gates: strictNonReadyGates(),
        packageAdversarialNodeEnv: adversarialFixture.selection,
    };
    finalReadinessJson.gates.find((gate) => gate.id === 'package-launch-smoke').evidencePath = packageSmoke;
    mutateFinalReadiness(finalReadinessJson);
    writeJson(finalReadiness, finalReadinessJson);
    const bundlePackageIndexPath = path.join(path.dirname(bundleManifest), 'evidence', 'release-package-index.json');
    const bundledPackageUiManifestPath = path.join(path.dirname(bundleManifest), 'evidence', 'package-ui-manifest.json');
    const bundledPackageSecurityEvidencePath = path.join(path.dirname(bundleManifest), 'evidence', 'package-security-boundaries.json');
    const bundledPackageUiReferencedArtifacts = bundlePackageUiReferencedArtifacts(packageUi, bundleManifest);
    const bundledAdversarial = bundleAdversarialNodeEnvEvidence(bundleManifest, packageAdversarialNodeEnvEvidence);
    writeJson(bundlePackageIndexPath, {
        generatedAt: packageIndex.generatedAt,
        releaseDir: packageIndex.releaseDir,
        copyPolicy: 'Installer and portable EXE binaries are not copied into the delivery bundle; this index records local paths, existence, size, and SHA-256.',
        packages: packageIndex.packages,
    });
    writeJson(bundledPackageUiManifestPath, packageUi);
    writeJson(bundledPackageSecurityEvidencePath, packageSecurity);
    writeJson(bundleManifest, {
        status: 'APP_NEEDS_WORK',
        appReady: false,
        warning: 'Do not present this bundle as final READY until every gate passes.',
        authorityDatabase: {
            sourcePath: authorityDbPath,
            existsAtExport: true,
            copied: false,
        },
        files: [
            {
                label: 'release-package-index',
                sourcePath: 'generated',
                bundlePath: path.relative(path.dirname(bundleManifest), bundlePackageIndexPath),
                sizeBytes: fs.statSync(bundlePackageIndexPath).size,
                sha256: sha256File(bundlePackageIndexPath),
            },
            {
                label: 'evidence:package-ui-manifest.json',
                sourcePath: packageUiManifest,
                bundlePath: path.relative(path.dirname(bundleManifest), bundledPackageUiManifestPath),
                sizeBytes: fs.statSync(bundledPackageUiManifestPath).size,
                sha256: sha256File(bundledPackageUiManifestPath),
            },
            {
                label: 'evidence:package-security-boundaries.json',
                sourcePath: packageSecurityEvidence,
                bundlePath: path.relative(path.dirname(bundleManifest), bundledPackageSecurityEvidencePath),
                sizeBytes: fs.statSync(bundledPackageSecurityEvidencePath).size,
                sha256: sha256File(bundledPackageSecurityEvidencePath),
            },
            ...bundledPackageUiReferencedArtifacts,
            bundledAdversarial.file,
        ],
        packageIndex: {
            present: true,
            count: packageIndex.count,
            existingCount: packageIndex.existingCount,
            missingCount: packageIndex.missingCount,
            bundleJson: path.relative(path.dirname(bundleManifest), bundlePackageIndexPath),
        },
        uiEvidence: {
            packageUiManifest: {
                sourcePath: packageUiManifest,
                present: true,
            },
        },
        securityEvidence: {
            packageSecurityBoundaries: {
                sourcePath: packageSecurityEvidence,
                present: true,
                bundlePath: path.relative(path.dirname(bundleManifest), bundledPackageSecurityEvidencePath),
                sha256: sha256File(bundledPackageSecurityEvidencePath),
            },
            packageAdversarialNodeEnvSmoke: bundledAdversarial.summary,
        },
    });
    return {
        authorityDbPath,
        bundledPackageUiManifestPath,
        bundledPackageSecurityEvidencePath,
        bundlePackageIndexPath,
        packageIndex,
        packageUi,
        packageUiManifest,
        packageSecurity,
        packageSecurityEvidence,
        packageAdversarialNodeEnvEvidence,
        bundledPackageAdversarialNodeEnvEvidencePath: bundledAdversarial.targetPath,
        smoke,
    };
}

function runStrictNonReadySafetyFixture(options = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-non-ready-strict-'));
    const paths = {
        evidenceManifest: path.join(dir, 'evidence-manifest.json'),
        finalReadiness: path.join(dir, 'final-readiness.json'),
        packageSmoke: path.join(dir, 'package-launch-smoke.json'),
        packageUiManifest: path.join(dir, 'package-ui-manifest.json'),
        packageSecurityEvidence: path.join(dir, 'package-security-boundaries.json'),
        packageAdversarialNodeEnvEvidence: path.join(dir, 'package-adversarial-node-env.json'),
        bundleManifest: path.join(dir, 'delivery-bundle-manifest.json'),
        readme: path.join(dir, 'README.md'),
    };
    try {
        const fixture = writeStrictNonReadyFixture({
            artifactDir: dir,
            ...paths,
            mutateFinalReadiness: options.mutateFinalReadiness,
        });
        const context = { dir, paths, fixture };
        options.mutateAfterWrite?.(context);
        const extraArgs = typeof options.extraArgs === 'function'
            ? options.extraArgs(context)
            : options.extraArgs || [];
        return runNode('scripts/verify-v15-non-ready-safety.js', [
            '--final-readiness', paths.finalReadiness,
            '--bundle-manifest', paths.bundleManifest,
            '--package-launch-smoke', paths.packageSmoke,
            ...(options.omitPackageUiManifest ? [] : ['--package-ui-manifest', paths.packageUiManifest]),
            ...(options.omitPackageSecurityEvidence ? [] : ['--package-security-evidence', paths.packageSecurityEvidence]),
            ...(options.omitPackageAdversarialNodeEnvEvidence
                ? []
                : ['--package-adversarial-node-env-evidence', paths.packageAdversarialNodeEnvEvidence]),
            '--readme', paths.readme,
            ...extraArgs,
        ]);
    }
    finally {
        if (fs.existsSync(dir))
            fs.rmSync(dir, { recursive: true, force: true });
    }
}

function mutatePackageUiFixture(context, mutate) {
    const packageUi = JSON.parse(fs.readFileSync(context.paths.packageUiManifest, 'utf8'));
    mutate(packageUi);
    writeJson(context.paths.packageUiManifest, packageUi);
    writeJson(context.fixture.bundledPackageUiManifestPath, packageUi);
    const bundle = JSON.parse(fs.readFileSync(context.paths.bundleManifest, 'utf8'));
    const packageUiFile = bundle.files.find((file) => file.sourcePath === context.paths.packageUiManifest);
    packageUiFile.sizeBytes = fs.statSync(context.fixture.bundledPackageUiManifestPath).size;
    packageUiFile.sha256 = sha256File(context.fixture.bundledPackageUiManifestPath);
    writeJson(context.paths.bundleManifest, bundle);
}

function mutatePackageSecurityFixture(context, mutate) {
    const evidence = JSON.parse(fs.readFileSync(context.paths.packageSecurityEvidence, 'utf8'));
    mutate(evidence);
    writeJson(context.paths.packageSecurityEvidence, evidence);
    writeJson(context.fixture.bundledPackageSecurityEvidencePath, evidence);
    const bundle = JSON.parse(fs.readFileSync(context.paths.bundleManifest, 'utf8'));
    const record = bundle.files.find((file) => file.sourcePath === context.paths.packageSecurityEvidence);
    record.sizeBytes = fs.statSync(context.fixture.bundledPackageSecurityEvidencePath).size;
    record.sha256 = sha256File(context.fixture.bundledPackageSecurityEvidencePath);
    bundle.securityEvidence.packageSecurityBoundaries.sha256 = record.sha256;
    writeJson(context.paths.bundleManifest, bundle);
}
export { writeStrictNonReadyFixture, runStrictNonReadySafetyFixture, mutatePackageUiFixture, mutatePackageSecurityFixture };

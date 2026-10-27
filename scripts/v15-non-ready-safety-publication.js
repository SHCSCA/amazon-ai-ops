// 按职责复用原有严格校验，公共入口继续保持兼容。
const fs = require('fs');
const path = require('path');
const { resolveBoundAdReadbackAuthorityDbPath } = require('./ad-readback-authority-db');
const { PACKAGE_ADVERSARIAL_NODE_ENV_CONTRACT_VERSION, rendererPathIdentity, validateAdversarialNodeEnvBundleSummaryContract, validateAdversarialNodeEnvEvidence, validateAdversarialNodeEnvManifestEntryContract, validateAdversarialNodeEnvSelectionContract, } = require('./smoke-package-adversarial-node-env');
const { hasBoundExistingAuthorityDb } = require('./v15-non-ready-safety-authority.js');
const { bundlePackageIndexMatchesFinalReadiness } = require('./v15-non-ready-safety-bundle.js');
const { bundleRoot, check, evidenceDir, expectedNonReadyGateIds, finalReadinessPattern, gateById, gateByName, hasOnlyLegacySourceTraceabilityFailure, latestBundleManifest, latestEvidence, packageLaunchSmokePattern, parseArgs, readJson, readmeStatesNonReady, requireFile, root, runNode, samePath, selectedAdReadbackPath } = require('./v15-non-ready-safety-contracts.js');
const { hasCurrentPackageHashEvidence, packageAdversarialNodeEnvEvidenceIsStrictlyValid, packageLaunchSmokeMatchesFinalReadiness, packageLaunchSmokeMatchesPackageIndex, packageSecurityEvidenceIsStrictlyValid, readValidPackageLaunchSmoke } = require('./v15-non-ready-safety-packages.js');
const { packageUiEvidenceIsStrictlyValid } = require('./v15-non-ready-safety-ui.js');

function main() {
    const args = parseArgs(process.argv);
    const finalReadinessPath = path.resolve(args['final-readiness'] || latestEvidence(finalReadinessPattern) || path.join(evidenceDir, 'final-readiness-2026-06-09.json'));
    const bundleManifestPath = path.resolve(args['bundle-manifest'] || latestBundleManifest() || path.join(bundleRoot, 'v15-delivery-bundle-2026-06-09', 'delivery-bundle-manifest.json'));
    const packageLaunchSmokePath = args['package-launch-smoke']
        ? path.resolve(args['package-launch-smoke'])
        : latestEvidence(packageLaunchSmokePattern);
    const packageSecurityEvidencePath = args['package-security-evidence']
        ? path.resolve(args['package-security-evidence'])
        : '';
    const packageAdversarialNodeEnvEvidencePath = args['package-adversarial-node-env-evidence']
        ? path.resolve(args['package-adversarial-node-env-evidence'])
        : '';
    const readmePath = path.resolve(args.readme || path.join(root, 'README.md'));
    const failures = [];
    requireFile(finalReadinessPath, 'final readiness');
    requireFile(bundleManifestPath, 'delivery bundle manifest');
    requireFile(readmePath, 'README');
    const finalReadiness = readJson(finalReadinessPath);
    const manifest = readJson(bundleManifestPath);
    const readme = fs.readFileSync(readmePath, 'utf8');
    const aiLive = gateByName(finalReadiness, 'AI live provider');
    const adAiExplanation = gateByName(finalReadiness, 'Ad recommendation AI explanation');
    const listingAiDraft = gateByName(finalReadiness, 'Listing AI draft');
    const adReadback = gateByName(finalReadiness, 'Real ad execution readback');
    const releasePackageHash = gateById(finalReadiness, 'release-package-hash');
    const packageLaunchSmokeGate = gateById(finalReadiness, 'package-launch-smoke');
    const readmeNonReady = readmeStatesNonReady(readme);
    const explicitStrictNonReady = Boolean(args['package-ui-manifest']);
    const historicalReadyFinalReadiness = !explicitStrictNonReady && readmeNonReady && finalReadiness.status === 'APP_READY' && finalReadiness.appReady === true;
    const historicalReadyBundle = !explicitStrictNonReady && readmeNonReady && manifest.status === 'APP_READY' && manifest.appReady === true;
    const currentPackageHashEvidence = hasCurrentPackageHashEvidence(finalReadiness);
    const currentPackageLaunchSmoke = readValidPackageLaunchSmoke(packageLaunchSmokePath);
    const adversarialNodeEnvSelectionContract = validateAdversarialNodeEnvSelectionContract(finalReadiness.packageAdversarialNodeEnv);
    check(finalReadiness.evidenceSelection?.mode === 'manifest', 'final readiness uses manifest evidence selection', failures);
    check(Boolean(finalReadiness.evidenceSelection?.manifestPath && fs.existsSync(path.resolve(finalReadiness.evidenceSelection.manifestPath))), 'final readiness evidence manifest exists', failures);
    if (historicalReadyFinalReadiness) {
        check(true, 'historical APP_READY final readiness is baseline only because README is non-ready', failures);
        check(currentPackageHashEvidence || Boolean(currentPackageLaunchSmoke), 'historical APP_READY baseline has current package hash or launch smoke evidence', failures);
    }
    else {
        let adversarialNodeEnvManifestContractPassed = false;
        try {
            const evidenceManifest = readJson(path.resolve(finalReadiness.evidenceSelection?.manifestPath || ''));
            adversarialNodeEnvManifestContractPassed = validateAdversarialNodeEnvManifestEntryContract(evidenceManifest.evidence?.packageAdversarialNodeEnv).passed;
        }
        catch {
            adversarialNodeEnvManifestContractPassed = false;
        }
        check(adversarialNodeEnvSelectionContract.passed, `current NON_READY safety requires ${PACKAGE_ADVERSARIAL_NODE_ENV_CONTRACT_VERSION}`, failures);
        check(adversarialNodeEnvManifestContractPassed, `evidence manifest requires ${PACKAGE_ADVERSARIAL_NODE_ENV_CONTRACT_VERSION}`, failures);
        check(Boolean(args['package-ui-manifest']), 'strict APP_NEEDS_WORK requires an explicit package UI manifest', failures);
        check(packageUiEvidenceIsStrictlyValid({
            filePath: args['package-ui-manifest'] ? path.resolve(args['package-ui-manifest']) : '',
            finalReadiness,
            manifest,
            bundleManifestPath,
            smoke: currentPackageLaunchSmoke,
        }), 'explicit package UI evidence is fresh, complete, hash-bound, DB-safe, process-isolated, and bundled', failures);
        check(Boolean(args['package-security-evidence']), 'strict APP_NEEDS_WORK requires explicit passing package security evidence', failures);
        check(packageSecurityEvidenceIsStrictlyValid({
            filePath: packageSecurityEvidencePath,
            packageUiManifestPath: args['package-ui-manifest'] ? path.resolve(args['package-ui-manifest']) : '',
            manifest,
            bundleManifestPath,
            smoke: currentPackageLaunchSmoke,
        }), 'explicit package security evidence is schema-valid, fully passing, package-hash-bound, and bundled byte-for-byte', failures);
        check(Boolean(args['package-adversarial-node-env-evidence']), 'current strict APP_NEEDS_WORK requires explicit adversarial NODE_ENV package evidence', failures);
        check(adversarialNodeEnvSelectionContract.passed
            && Boolean(args['package-adversarial-node-env-evidence'])
            && packageAdversarialNodeEnvEvidenceIsStrictlyValid({
                filePath: packageAdversarialNodeEnvEvidencePath,
                finalReadiness,
                packageUiManifestPath: args['package-ui-manifest'] ? path.resolve(args['package-ui-manifest']) : '',
                manifest,
                bundleManifestPath,
                smoke: currentPackageLaunchSmoke,
            }), 'adversarial NODE_ENV evidence is passing, EXE/app-content/main/renderer hash-bound, process-clean, and bundled byte-for-byte', failures);
        check(finalReadiness.status === 'APP_NEEDS_WORK' && finalReadiness.appReady === false, 'final readiness remains APP_NEEDS_WORK with appReady=false', failures);
        const gates = Array.isArray(finalReadiness.gates) ? finalReadiness.gates : [];
        const gateIds = gates.map((gate) => gate?.id);
        const passedGates = gates.filter((gate) => gate?.ok === true && gate?.status === 'passed');
        const failedGates = gates.filter((gate) => gate?.ok === false && gate?.status === 'needs_work');
        check(gates.length === expectedNonReadyGateIds.size
            && new Set(gateIds).size === expectedNonReadyGateIds.size
            && gateIds.every((id) => expectedNonReadyGateIds.has(id))
            && passedGates.length === 7
            && failedGates.length === 1
            && passedGates.length + failedGates.length === gates.length
            && failedGates[0]?.id === 'real-ad-execution-readback', 'final readiness has exactly 8 gates, 7 passed, and only real-ad-execution-readback needs work', failures);
        check(releasePackageHash?.ok === true
            && releasePackageHash?.status === 'passed'
            && currentPackageHashEvidence, 'release-package-hash gate is passed with current package index evidence', failures);
        check(bundlePackageIndexMatchesFinalReadiness(finalReadiness, manifest, bundleManifestPath), 'bundle release-package-index exactly matches final readiness and current package files', failures);
        check(packageLaunchSmokeGate?.ok === true
            && packageLaunchSmokeGate?.status === 'passed'
            && Boolean(args['package-launch-smoke'])
            && Boolean(currentPackageLaunchSmoke)
            && packageLaunchSmokeGate?.evidencePath
            && samePath(packageLaunchSmokeGate.evidencePath, packageLaunchSmokePath)
            && packageLaunchSmokeMatchesFinalReadiness(finalReadiness, packageLaunchSmokePath, currentPackageLaunchSmoke)
            && packageLaunchSmokeMatchesPackageIndex(finalReadiness, currentPackageLaunchSmoke), 'package-launch-smoke gate is passed with explicit current evidence matching final readiness and package index', failures);
        check(hasBoundExistingAuthorityDb(finalReadiness, manifest, args.db), 'final readiness, explicit selection, and delivery bundle bind the same existing SQLite authority database identity', failures);
    }
    check(finalReadiness.reportCollectionReady === true, 'report collection ready remains true', failures);
    check(finalReadiness.listingReadReady === true, 'Listing read ready remains true', failures);
    check(aiLive && aiLive.ok === true && aiLive.status === 'passed', 'AI live gate is passed with real provider evidence', failures);
    check(adAiExplanation && adAiExplanation.ok === true && adAiExplanation.status === 'passed', 'ad recommendation AI explanation gate is passed with real AI evidence', failures);
    check(listingAiDraft && listingAiDraft.ok === true && listingAiDraft.status === 'passed', 'Listing AI draft gate is passed with real AI evidence', failures);
    if (historicalReadyFinalReadiness) {
        check(adReadback && adReadback.ok === true && adReadback.status === 'passed', 'historical real ad readback gate is baseline only', failures);
        const readbackPath = selectedAdReadbackPath(finalReadiness);
        let authorityDbPath = '';
        try {
            authorityDbPath = resolveBoundAdReadbackAuthorityDbPath(finalReadiness.evidenceSelection?.authorityDbPath, args.db);
            check(true, 'historical APP_READY records an existing SQLite authority database identity', failures);
        }
        catch (error) {
            check(false, `historical SQLite authority database identity is invalid: ${error instanceof Error ? error.message : String(error)}`, failures);
        }
        if (readbackPath && fs.existsSync(path.resolve(readbackPath)) && authorityDbPath) {
            const verifierArgs = [path.resolve(readbackPath)];
            verifierArgs.push('--db', authorityDbPath);
            const readbackVerification = runNode('scripts/verify-ad-readback-evidence.js', verifierArgs);
            if (readbackVerification.ok) {
                check(true, 'historical real ad readback baseline passes verify:ad-readback', failures);
            }
            else if (hasOnlyLegacySourceTraceabilityFailure(readbackVerification.output)) {
                check(false, 'historical real ad readback baseline lacks current source report traceability only', failures);
            }
            else {
                check(false, 'historical real ad readback baseline fails current verify:ad-readback', failures);
            }
            if (!readbackVerification.ok && readbackVerification.output && !hasOnlyLegacySourceTraceabilityFailure(readbackVerification.output)) {
                console.error(readbackVerification.output.split(/\r?\n/).slice(-8).join('\n'));
            }
        }
        else {
            check(false, 'historical real ad readback baseline has manifest-selected evidence file', failures);
        }
    }
    if (historicalReadyBundle) {
        check(true, 'historical APP_READY delivery bundle is baseline only because README is non-ready', failures);
    }
    else {
        check(manifest.status === 'APP_NEEDS_WORK'
            && manifest.appReady === false
            && /Do not present this bundle as final READY/.test(manifest.warning || ''), 'delivery bundle remains APP_NEEDS_WORK and blocks READY claims', failures);
    }
    check(readmeNonReady, 'README top-level delivery line is non-ready', failures);
    if (failures.length > 0) {
        console.error(`\nNEEDS_WORK: ${failures.length} non-ready safety check(s) failed.`);
        process.exit(1);
    }
    console.log('\nNON_READY_SAFETY verified.');
}

module.exports = { main };

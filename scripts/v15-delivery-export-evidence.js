// 按职责复用原有严格校验，公共入口继续保持兼容。
const fs = require('fs');
const path = require('path');
const { validatePackageLaunchSmokeEvidence } = require('./smoke-package-launch');
const { appDataStorageRoot, canonicalPath, explicitFileArg, isInside, isProductionDataReconciliationName, readJson, root, siblingMarkdownPath, validatedExternalPackageLaunchArtifacts, validatedPackageLaunchEvidencePaths } = require('./v15-delivery-export-contracts.js');
const { summarizeDataReconciliation } = require('./v15-delivery-export-reports.js');
const { assertCurrentPackageUiEvidence, latestAppDataExport, latestEvidence } = require('./v15-delivery-export-selection.js');

function resolveDataReconciliationEvidence(args) {
    const explicitJson = explicitFileArg(args, 'data-reconciliation');
    const explicitMarkdown = explicitFileArg(args, 'data-reconciliation-md');
    const jsonPath = explicitJson
        || latestEvidence(/^data-reconciliation-.*\.json$/i, isProductionDataReconciliationName)
        || latestAppDataExport(/^data-reconciliation-.*\.json$/i, isProductionDataReconciliationName)
        || latestEvidence(/^full8-data-reconciliation-.*\.json$/i, isProductionDataReconciliationName);
    const markdownPath = explicitMarkdown
        || siblingMarkdownPath(jsonPath)
        || (!explicitJson
            ? latestEvidence(/^data-reconciliation-.*\.md$/i, isProductionDataReconciliationName)
                || latestAppDataExport(/^data-reconciliation-.*\.md$/i, isProductionDataReconciliationName)
            : null);
    return summarizeDataReconciliation(jsonPath, markdownPath);
}

function collectEvidencePaths(finalReadiness, options = {}) {
    const includeLatestExtras = options.includeLatestExtras !== false;
    const paths = new Set();
    const validatedPackageLaunchPaths = new Set();
    const addValidatedPackageLaunchEvidence = (filePath) => {
        if (!filePath)
            return;
        const absolutePath = path.resolve(filePath);
        if (validatedPackageLaunchPaths.has(absolutePath))
            return;
        if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
            throw new Error(`Package launch evidence is missing: ${absolutePath}`);
        }
        const smoke = readJson(absolutePath);
        const validation = validatePackageLaunchSmokeEvidence(smoke);
        if (!validation.passed) {
            throw new Error(`Package launch strict contract failed: ${validation.violations
                .map((violation) => `${violation.code}@${violation.path}`)
                .join('; ')}`);
        }
        validatedPackageLaunchPaths.add(absolutePath);
        validatedPackageLaunchEvidencePaths.add(absolutePath);
        paths.add(absolutePath);
        for (const check of smoke.checks || []) {
            for (const artifact of [
                { path: check?.stdoutPath, allowExternal: false },
                { path: check?.stderrPath, allowExternal: false },
                { path: check?.userDataEvidence?.markerPath, allowExternal: true },
                { path: check?.windowReadyEvidence?.markerPath, allowExternal: true },
            ]) {
                if (artifact.path) {
                    const resolvedArtifactPath = path.resolve(artifact.path);
                    paths.add(resolvedArtifactPath);
                    if (artifact.allowExternal
                        && !isInside(resolvedArtifactPath, root)
                        && !isInside(resolvedArtifactPath, appDataStorageRoot)) {
                        validatedExternalPackageLaunchArtifacts.add(canonicalPath(resolvedArtifactPath).toLowerCase());
                    }
                }
            }
        }
    };
    paths.add(finalReadiness.__path);
    paths.add(finalReadiness.evidenceSelection?.manifestPath);
    for (const gate of finalReadiness.gates || []) {
        if (gate.evidencePath)
            paths.add(gate.evidencePath);
    }
    addValidatedPackageLaunchEvidence(finalReadiness.packageLaunchSmoke?.evidencePath);
    for (const gate of finalReadiness.gates || []) {
        if (gate?.id === 'package-launch-smoke' || gate?.id === 'package-launch') {
            addValidatedPackageLaunchEvidence(gate.evidencePath);
        }
    }
    if (options.packageUiManifest) {
        paths.add(options.packageUiManifest);
        const packageUi = readJson(options.packageUiManifest);
        assertCurrentPackageUiEvidence(packageUi);
        for (const run of packageUi.runs || []) {
            for (const screenshot of run.screenshots || []) {
                if (screenshot?.path)
                    paths.add(path.resolve(screenshot.path));
            }
            for (const screenshot of run.minimumWindow?.screenshots || []) {
                if (screenshot?.path)
                    paths.add(path.resolve(screenshot.path));
            }
            for (const overlay of run.overlayChecks || []) {
                if (overlay?.screenshot?.path)
                    paths.add(path.resolve(overlay.screenshot.path));
            }
            for (const workspace of run.workspaceChecks || []) {
                if (workspace?.inspectorEvidence?.screenshot?.path) {
                    paths.add(path.resolve(workspace.inspectorEvidence.screenshot.path));
                }
            }
            for (const subview of run.subviewChecks || []) {
                if (subview?.screenshot?.path) {
                    paths.add(path.resolve(subview.screenshot.path));
                }
            }
            if (run.schedulerReadOnlyRuntime?.artifact?.path) {
                paths.add(path.resolve(run.schedulerReadOnlyRuntime.artifact.path));
            }
        }
        for (const screenshot of packageUi.wideProfile?.screenshots || []) {
            if (screenshot?.path)
                paths.add(path.resolve(screenshot.path));
        }
        for (const workspace of packageUi.wideProfile?.workspaceChecks || []) {
            if (workspace?.inspectorEvidence?.screenshot?.path) {
                paths.add(path.resolve(workspace.inspectorEvidence.screenshot.path));
            }
        }
        if (packageUi.wideProfile?.schedulerReadOnlyRuntime?.artifact?.path) {
            paths.add(path.resolve(packageUi.wideProfile.schedulerReadOnlyRuntime.artifact.path));
        }
    }
    if (options.workspaceUiManifest) {
        paths.add(options.workspaceUiManifest);
        const workspaceUi = readJson(options.workspaceUiManifest);
        for (const target of workspaceUi.targets || []) {
            if (target?.screenshot?.path)
                paths.add(path.resolve(target.screenshot.path));
            if (target?.jsonPath)
                paths.add(path.resolve(target.jsonPath));
        }
    }
    if (options.businessUiSmoke)
        paths.add(options.businessUiSmoke);
    if (options.fullTestEvidence)
        paths.add(options.fullTestEvidence);
    if (options.packageSecurityEvidence)
        paths.add(options.packageSecurityEvidence);
    if (options.packageAdversarialNodeEnvEvidence)
        paths.add(options.packageAdversarialNodeEnvEvidence);
    if (includeLatestExtras) {
        const addSmokeEvidence = (smoke) => {
            if (!smoke)
                return;
            paths.add(smoke);
            const smokeJson = readJson(smoke);
            if (smokeJson.screenshotPath)
                paths.add(smokeJson.screenshotPath);
            if (smokeJson.listingScreenshotPath)
                paths.add(smokeJson.listingScreenshotPath);
            for (const page of Object.values(smokeJson.pages || {})) {
                if (page && page.screenshotPath)
                    paths.add(page.screenshotPath);
            }
        };
        addSmokeEvidence(latestEvidence(/^current-business-ui-smoke-.*\.json$/i));
        for (const pattern of [
            /^business-ui-shell-smoke-.*\.json$/i,
            /^business-ui-data-pipeline-smoke-.*\.json$/i,
            /^business-ui-ad-execution-smoke-.*\.json$/i,
            /^business-ui-keyword-listing-smoke-.*\.json$/i,
            /^business-ui-settings-delivery-smoke-.*\.json$/i,
        ]) {
            addSmokeEvidence(latestEvidence(pattern));
        }
        addSmokeEvidence(latestEvidence(/^v15-product-readiness-ui-smoke-.*\.json$/i));
        const structuralAi = latestEvidence(/^structural-ai-openai-compatible-mock-.*\.json$/i);
        if (structuralAi)
            paths.add(structuralAi);
        const evidenceManifest = latestEvidence(/^v15-final-readiness-evidence-manifest-.*\.json$/i);
        if (evidenceManifest)
            paths.add(evidenceManifest);
        for (const pattern of [
            /^real-ad-execution-readback-candidate-.*\.json$/i,
            /^real-ad-execution-readback-candidate-.*\.md$/i,
            /^real-ad-execution-readback-manual\.json$/i,
            /^real-ad-execution-readback-manual\.md$/i,
            /^ads-readonly-locate-.*\.json$/i,
        ]) {
            const adReadbackPacket = latestEvidence(pattern);
            if (adReadbackPacket) {
                paths.add(adReadbackPacket);
                if (/^ads-readonly-locate-.*\.json$/i.test(path.basename(adReadbackPacket))) {
                    const readonlyLocation = readJson(adReadbackPacket);
                    for (const evidencePath of Object.values(readonlyLocation.evidence || {})) {
                        if (evidencePath)
                            paths.add(evidencePath);
                    }
                }
            }
        }
        if (validatedPackageLaunchPaths.size === 0) {
            addValidatedPackageLaunchEvidence(latestEvidence(/^package-launch-smoke-.*\.json$/i));
        }
    }
    const delivery = (finalReadiness.gates || []).find((gate) => gate.name === 'Report collection delivery')?.evidencePath;
    if (delivery && fs.existsSync(delivery)) {
        const deliveryJson = readJson(delivery);
        if (deliveryJson.batch?.manifestPath)
            paths.add(deliveryJson.batch.manifestPath);
        if (deliveryJson.result?.batch?.manifestPath)
            paths.add(deliveryJson.result.batch.manifestPath);
        const batchId = deliveryJson.batch?.id || deliveryJson.result?.batch?.id;
        const auditDir = findAcceptanceAuditDir(batchId);
        if (auditDir) {
            for (const name of [
                'acceptance-audit.json',
                'acceptance-audit.md',
                'downloaded-report-files.json',
                'filename-date-range-analysis.json',
                'manifest.json',
            ]) {
                const filePath = path.join(auditDir, name);
                if (fs.existsSync(filePath))
                    paths.add(filePath);
            }
        }
    }
    const listing = (finalReadiness.gates || []).find((gate) => gate.name === 'Lingxing Listing full read')?.evidencePath;
    if (listing && fs.existsSync(listing)) {
        const listingJson = readJson(listing);
        if (listingJson.listingRead?.evidence?.screenshotPath) {
            paths.add(listingJson.listingRead.evidence.screenshotPath);
        }
    }
    return [...paths].filter(Boolean);
}

function findAcceptanceAuditDir(batchId) {
    if (!batchId || !appDataStorageRoot)
        return null;
    const exportsDir = path.join(appDataStorageRoot, 'exports');
    if (!fs.existsSync(exportsDir))
        return null;
    const candidates = fs.readdirSync(exportsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.includes(batchId) && entry.name.startsWith('lingxing_acceptance_audit_'))
        .map((entry) => {
        const filePath = path.join(exportsDir, entry.name);
        return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
    return candidates[0]?.filePath || null;
}

module.exports = { resolveDataReconciliationEvidence, collectEvidencePaths, findAcceptanceAuditDir };

// 按职责复用原有严格校验，公共入口继续保持兼容。
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeExperienceContract, safeSegment, timestampSegment, validateCaptureTarget, validatePreviewUrl } = require('./workspace-ui-capture-contracts.js');
const { collectWorkspaceDomMetrics } = require('./workspace-ui-capture-dom.js');
const { collectWorkspaceStateEvidence, prepareWorkspaceVisualState, verifyWorkspaceStatePostCapture } = require('./workspace-ui-capture-state.js');

async function captureWorkspaceEvidence({ outputDir, page, target, timestamp = new Date() }) {
    if (!page || typeof page.screenshot !== 'function')
        throw new Error('A Playwright page is required.');
    if (!outputDir)
        throw new Error('Workspace evidence outputDir is required.');
    validateCaptureTarget(target);
    const experienceContract = normalizeExperienceContract(target.experienceContract, 'capture');
    const metrics = await collectWorkspaceDomMetrics(page, {
        experienceContract,
        rootSelector: target.rootSelector,
    });
    validatePreviewUrl(metrics.identity.pageUrl, target.scenario, 'Runtime workspace evidence URL');
    const identityMismatches = [];
    for (const field of ['workspace', 'subview']) {
        if (metrics.identity[field] !== target[field]) {
            identityMismatches.push(`${field} actual ${metrics.identity[field] || '(missing)'} target ${target[field]}`);
        }
    }
    if (target.readbackMode && metrics.identity.previewScenario !== target.scenario) {
        identityMismatches.push(`preview scenario actual ${metrics.identity.previewScenario || '(missing)'} target ${target.scenario}`);
    }
    if (target.readbackMode && metrics.identity.readbackMode !== target.readbackMode) {
        identityMismatches.push(`readback mode actual ${metrics.identity.readbackMode || '(missing)'} target ${target.readbackMode}`);
    }
    if (identityMismatches.length > 0) {
        throw new Error(`Runtime workspace identity does not match target: ${identityMismatches.join('; ')}.`);
    }
    if (metrics.viewport.width !== target.viewport.width || metrics.viewport.height !== target.viewport.height) {
        throw new Error(`Runtime viewport ${metrics.viewport.width}x${metrics.viewport.height} does not match target ${target.viewport.width}x${target.viewport.height}.`);
    }
    if (Math.abs(metrics.dpr - target.dpr) > 0.001) {
        throw new Error(`Runtime DPR ${metrics.dpr} does not match target ${target.dpr}.`);
    }
    let stateEvidence = await collectWorkspaceStateEvidence(page, target);
    const absoluteOutputDir = path.resolve(outputDir);
    fs.mkdirSync(absoluteOutputDir, { recursive: true });
    const baseNameParts = [
        safeSegment(target.workspace),
        safeSegment(target.subview),
        safeSegment(target.scenario),
        `${target.viewport.width}x${target.viewport.height}`,
        `dpr-${String(target.dpr).replace('.', '_')}`,
    ];
    if (target.visualState) {
        baseNameParts.push(`state-${safeSegment(target.visualState)}`);
        baseNameParts.push(`motion-${safeSegment(target.motionPreference)}`);
    }
    baseNameParts.push(timestampSegment(timestamp));
    const baseName = baseNameParts.join('--');
    const screenshotPath = path.join(absoluteOutputDir, `${baseName}.png`);
    const jsonPath = path.join(absoluteOutputDir, `${baseName}.json`);
    await page.screenshot({ fullPage: false, path: screenshotPath });
    const screenshotSha256 = createHash('sha256').update(fs.readFileSync(screenshotPath)).digest('hex').toUpperCase();
    stateEvidence = await verifyWorkspaceStatePostCapture(page, target, stateEvidence);
    const evidence = {
        capturedAt: timestamp.toISOString(),
        domMetrics: metrics,
        dpr: metrics.dpr,
        kind: 'workspace-ui-runtime-evidence',
        pageUrl: typeof page.url === 'function' ? page.url() : null,
        scenario: target.scenario,
        schemaVersion: 'workspace-ui-evidence/v1',
        screenshot: {
            fullPage: false,
            path: screenshotPath,
            sha256: screenshotSha256,
        },
        subview: target.subview,
        viewport: metrics.viewport,
        workspace: target.workspace,
    };
    if (stateEvidence)
        evidence.stateEvidence = stateEvidence;
    fs.writeFileSync(jsonPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    return { evidence, jsonPath, screenshotPath };
}

async function runWorkspaceEvidenceTargets({ browser, generatedAt = new Date(), outputDir, targets }) {
    if (!browser || typeof browser.newContext !== 'function')
        throw new Error('A launched Playwright browser is required.');
    if (!outputDir)
        throw new Error('Workspace evidence outputDir is required.');
    if (!Array.isArray(targets) || targets.length === 0)
        throw new Error('Workspace evidence targets are required.');
    const absoluteOutputDir = path.resolve(outputDir);
    fs.mkdirSync(absoluteOutputDir, { recursive: true });
    const results = [];
    for (let index = 0; index < targets.length; index += 1) {
        const target = targets[index];
        validateCaptureTarget(target);
        if (typeof target.url !== 'string' || !target.url.trim()) {
            throw new Error(`Workspace evidence target ${index + 1} requires url.`);
        }
        validatePreviewUrl(target.url, target.scenario, `Workspace evidence target ${index + 1} URL`);
        const contextOptions = {
            deviceScaleFactor: target.dpr,
            viewport: target.viewport,
        };
        if (target.motionPreference)
            contextOptions.reducedMotion = target.motionPreference;
        const context = await browser.newContext(contextOptions);
        const page = await context.newPage();
        try {
            await page.goto(target.url, { waitUntil: target.waitUntil || 'networkidle' });
            await page.evaluate(({ subview, workspace }) => {
                window.dispatchEvent(new CustomEvent('amazon-ai-ops:navigate', {
                    detail: { subview, workspace },
                }));
            }, { subview: target.subview, workspace: target.workspace });
            if (target.waitFor)
                await page.locator(target.waitFor).first().waitFor({ state: 'visible' });
            await prepareWorkspaceVisualState(page, target);
            await page.waitForTimeout(target.settleMs === undefined ? 250 : target.settleMs);
            const timestamp = new Date(generatedAt.getTime() + index);
            const captured = await captureWorkspaceEvidence({ outputDir: absoluteOutputDir, page, target, timestamp });
            results.push(captured);
        }
        catch (error) {
            results.push({
                error: error && error.message ? error.message : String(error),
                target,
            });
        }
        finally {
            await context.close();
        }
    }
    const manifestTargets = results.map((result, index) => {
        const target = targets[index];
        if (result.error) {
            return {
                contractPassed: false,
                dpr: target.dpr,
                error: result.error,
                motionPreference: target.motionPreference,
                scenario: target.scenario,
                subview: target.subview,
                visualState: target.visualState,
                viewport: target.viewport,
                workspace: target.workspace,
            };
        }
        return {
            contractPassed: result.evidence.domMetrics.contract.passed
                && (!result.evidence.stateEvidence || result.evidence.stateEvidence.passed),
            dpr: result.evidence.dpr,
            jsonPath: result.jsonPath,
            motionPreference: target.motionPreference,
            scenario: result.evidence.scenario,
            screenshot: result.evidence.screenshot,
            stateEvidence: result.evidence.stateEvidence,
            subview: result.evidence.subview,
            violations: result.evidence.domMetrics.contract.violations,
            visualState: target.visualState,
            viewport: result.evidence.viewport,
            workspace: result.evidence.workspace,
        };
    });
    const passed = manifestTargets.every((target) => target.contractPassed);
    const manifest = {
        generatedAt: generatedAt.toISOString(),
        kind: 'workspace-ui-evidence-run',
        passed,
        schemaVersion: 'workspace-ui-evidence-run/v1',
        targets: manifestTargets,
    };
    const manifestPath = path.join(absoluteOutputDir, `workspace-ui-evidence-run-${timestampSegment(generatedAt)}.json`);
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    return { manifest, manifestPath, passed, results };
}

module.exports = { captureWorkspaceEvidence, runWorkspaceEvidenceTargets };

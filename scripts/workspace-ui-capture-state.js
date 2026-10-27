// 按职责复用原有严格校验，公共入口继续保持兼容。

const { STATE_EVIDENCE_SCHEMA_VERSION, validateVisualStateTarget } = require('./workspace-ui-capture-contracts.js');

async function prepareWorkspaceVisualState(page, target) {
    if (!target.visualState)
        return;
    validateVisualStateTarget(target, 'Runtime workspace evidence target');
    const preview = await page.evaluate(() => {
        const banner = Array.from(document.querySelectorAll('.app-status'))
            .find((element) => (element.textContent || '').includes('仅开发预览'));
        return {
            banner: (banner?.textContent || '').replace(/\s+/g, ' ').trim(),
            hasApi: Boolean(window.electronAPI?.getBusinessUiDataPipeline),
        };
    });
    if (!preview.banner || !preview.hasApi) {
        throw new Error('Visual state evidence requires the explicit local development-preview banner and preview API.');
    }
    if (target.visualState === 'workspace-error-retry') {
        await page.evaluate(() => {
            const api = window.electronAPI;
            const original = api.getBusinessUiDataPipeline.bind(api);
            const control = { failPipeline: true, original };
            Object.defineProperty(window, '__AMAZON_AI_OPS_WORKSPACE_EVIDENCE__', {
                configurable: true,
                value: control,
            });
            api.getBusinessUiDataPipeline = (...args) => (control.failPipeline
                ? Promise.reject(new Error('开发预览：模拟当前范围数据读取失败，请重新读取。'))
                : original(...args));
            window.dispatchEvent(new Event('business-ui:data-updated'));
        });
        await page.locator('[data-workspace-state="error"][role="alert"]').first().waitFor({ state: 'visible' });
        await page.locator('[data-workspace-state="error"] .workspace-state__action').first().waitFor({ state: 'visible' });
        return;
    }
    await page.evaluate(() => {
        const api = window.electronAPI;
        api.runAdStrategyDiagnosis = () => new Promise(() => { });
    });
    const firstRow = page.locator('[data-workspace-row]').first();
    await firstRow.waitFor({ state: 'visible' });
    await firstRow.click();
    await page.locator('.responsive-inspector--inline[data-inspector-mode="inline"]').first().waitFor({ state: 'visible' });
    const runButton = page
        .locator('.task-banner__actions button[data-action-priority="secondary"]')
        .filter({ hasText: '运行 AI 阶段分析' })
        .first();
    await runButton.waitFor({ state: 'visible' });
    await runButton.click();
    await page.locator('#ai-strategy-run-feedback[aria-busy="true"][data-ai-run-tone="pending"]').first().waitFor({ state: 'visible' });
    await page.locator('.task-banner__actions button[aria-busy="true"]').first().waitFor({ state: 'visible' });
}

async function collectWorkspaceStateEvidence(page, target) {
    if (!target.visualState)
        return null;
    return page.evaluate((settings) => {
        function rendered(element) {
            if (!(element instanceof Element) || !element.isConnected)
                return false;
            const style = window.getComputedStyle(element);
            if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0) {
                return false;
            }
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && element.getClientRects().length > 0;
        }
        function compactText(element) {
            return (element?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 240);
        }
        const violations = [];
        function violation(code, message, details = {}) {
            violations.push({ code, details, message });
        }
        const previewBanner = Array.from(document.querySelectorAll('.app-status'))
            .find((element) => rendered(element) && compactText(element).includes('仅开发预览'));
        const errorState = document.querySelector('[data-workspace-state="error"]');
        const retryAction = errorState?.querySelector('.workspace-state__action') || null;
        const aiRun = document.querySelector('#ai-strategy-run-feedback');
        const actionButtons = Array.from(document.querySelectorAll('.task-banner__actions button'))
            .filter(rendered);
        const busyAction = actionButtons.find((button) => button.getAttribute('aria-busy') === 'true') || null;
        const peerActions = actionButtons.filter((button) => button !== busyAction).map((button) => ({
            ariaBusy: button.getAttribute('aria-busy') === 'true',
            disabled: Boolean(button.disabled),
            label: compactText(button),
        }));
        const inspector = document.querySelector('.responsive-inspector[data-inspector-mode]');
        const visibleSpinners = Array.from(document.querySelectorAll('.workspace-spinner')).filter(rendered);
        const spinners = visibleSpinners.map((spinner) => {
            const style = window.getComputedStyle(spinner);
            return {
                animationDuration: style.animationDuration,
                animationIterationCount: style.animationIterationCount,
                animationName: style.animationName,
            };
        });
        const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const observed = {
            aiRun: {
                ariaBusy: aiRun?.getAttribute('aria-busy') === 'true',
                label: compactText(aiRun),
                tone: aiRun?.getAttribute('data-ai-run-tone') || null,
                visible: rendered(aiRun),
            },
            busyAction: busyAction ? {
                ariaBusy: busyAction.getAttribute('aria-busy') === 'true',
                disabled: Boolean(busyAction.disabled),
                label: compactText(busyAction),
                visible: rendered(busyAction),
            } : null,
            inspector: inspector ? {
                label: compactText(inspector.querySelector('h2')),
                mode: inspector.getAttribute('data-inspector-mode'),
                role: inspector.getAttribute('role'),
                visible: rendered(inspector),
            } : null,
            motion: {
                prefersReducedMotion,
                spinnerCount: visibleSpinners.length,
                spinners,
            },
            peerActions,
            previewBanner: compactText(previewBanner),
            retryAction: retryAction ? {
                ariaBusy: retryAction.getAttribute('aria-busy') === 'true',
                disabled: Boolean(retryAction.disabled),
                label: compactText(retryAction),
                visible: rendered(retryAction),
            } : null,
            workspaceState: errorState ? {
                kind: errorState.getAttribute('data-workspace-state'),
                role: errorState.getAttribute('role'),
                title: compactText(errorState.querySelector('.workspace-state__copy > strong')),
                visible: rendered(errorState),
            } : null,
        };
        if (!previewBanner) {
            violation('DEV_PREVIEW_BANNER_MISSING', 'Synthetic visual-state evidence must remain visibly marked as development preview.');
        }
        const expectsReducedMotion = settings.motionPreference === 'reduce';
        if (prefersReducedMotion !== expectsReducedMotion) {
            violation('MOTION_PREFERENCE_MISMATCH', 'Runtime prefers-reduced-motion does not match the requested evidence target.', {
                actual: prefersReducedMotion ? 'reduce' : 'no-preference',
                expected: settings.motionPreference,
            });
        }
        if (settings.visualState === 'workspace-error-retry') {
            if (!observed.workspaceState?.visible || observed.workspaceState.kind !== 'error' || observed.workspaceState.role !== 'alert') {
                violation('WORKSPACE_ERROR_STATE_MISSING', 'Workspace error evidence requires a visible alert state.');
            }
            if (!observed.retryAction?.visible || observed.retryAction.disabled || observed.retryAction.ariaBusy
                || !observed.retryAction.label.includes('重新读取')) {
                violation('WORKSPACE_RETRY_ACTION_MISSING', 'Workspace error evidence requires a visible enabled retry action.', {
                    retryAction: observed.retryAction,
                });
            }
        }
        else {
            if (!observed.aiRun.visible || !observed.aiRun.ariaBusy || observed.aiRun.tone !== 'pending'
                || !observed.aiRun.label.includes('AI 阶段分析运行中')) {
                violation('DIAGNOSIS_RUNNING_STATUS_MISSING', 'Diagnosis running evidence requires the visible pending live status.', {
                    aiRun: observed.aiRun,
                });
            }
            if (!observed.busyAction?.visible || !observed.busyAction.disabled || !observed.busyAction.ariaBusy
                || observed.busyAction.label !== 'AI 分析中...') {
                violation('DIAGNOSIS_BUSY_ACTION_MISSING', 'Diagnosis running evidence requires exactly one visible disabled busy action.', {
                    busyAction: observed.busyAction,
                });
            }
            if (!observed.inspector?.visible || observed.inspector.mode !== 'inline') {
                violation('DIAGNOSIS_INLINE_INSPECTOR_MISSING', 'Diagnosis running evidence must keep the selected inline inspector visible.', {
                    inspector: observed.inspector,
                });
            }
            if (observed.peerActions.length < 1 || observed.peerActions.some((action) => !action.disabled || action.ariaBusy)) {
                violation('DIAGNOSIS_PEER_LOCK_MISSING', 'Peer task actions must lock without impersonating the active busy action.', {
                    peerActions: observed.peerActions,
                });
            }
            if (visibleSpinners.length < 1) {
                violation('DIAGNOSIS_BUSY_SPINNER_MISSING', 'Diagnosis running evidence requires a visible busy spinner.');
            }
            if (expectsReducedMotion && spinners.some((spinner) => spinner.animationName !== 'none')) {
                violation('REDUCED_MOTION_SPINNER_ACTIVE', 'Visible busy spinners must not animate under prefers-reduced-motion.', {
                    spinners,
                });
            }
        }
        return {
            id: settings.visualState,
            observed,
            passed: violations.length === 0,
            postCapture: {
                retryAttempted: false,
                retryRecovered: settings.visualState === 'workspace-error-retry' ? false : null,
            },
            previewOnly: true,
            requested: {
                inspectorMode: settings.visualState === 'diagnosis-ai-running-with-inspector' ? 'inline' : null,
                motionPreference: settings.motionPreference,
            },
            schemaVersion: settings.schemaVersion,
            syntheticTrigger: settings.visualState === 'workspace-error-retry'
                ? 'pipeline-read-failure'
                : 'ai-promise-pending',
            violations,
        };
    }, {
        motionPreference: target.motionPreference,
        schemaVersion: STATE_EVIDENCE_SCHEMA_VERSION,
        visualState: target.visualState,
    });
}

async function verifyWorkspaceStatePostCapture(page, target, stateEvidence) {
    if (!stateEvidence || target.visualState !== 'workspace-error-retry')
        return stateEvidence;
    stateEvidence.postCapture.retryAttempted = true;
    try {
        await page.evaluate(() => {
            const control = window.__AMAZON_AI_OPS_WORKSPACE_EVIDENCE__;
            if (!control)
                throw new Error('Workspace evidence retry controller is missing.');
            control.failPipeline = false;
        });
        await page.locator('[data-workspace-state="error"] .workspace-state__action').first().click();
        await page.locator('[data-workspace-state="error"]').first().waitFor({ state: 'hidden' });
        await page.locator('[data-workspace-row]').first().waitFor({ state: 'visible' });
        stateEvidence.postCapture.retryRecovered = true;
    }
    catch (error) {
        stateEvidence.postCapture.retryRecovered = false;
        stateEvidence.violations.push({
            code: 'WORKSPACE_RETRY_RECOVERY_FAILED',
            details: { error: error && error.message ? error.message : String(error) },
            message: 'The visible workspace retry action did not recover the diagnosis queue after capture.',
        });
    }
    stateEvidence.passed = stateEvidence.violations.length === 0 && stateEvidence.postCapture.retryRecovered === true;
    return stateEvidence;
}

module.exports = { prepareWorkspaceVisualState, collectWorkspaceStateEvidence, verifyWorkspaceStatePostCapture };

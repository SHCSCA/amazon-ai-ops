// 按证据职责拆分共享夹具与断言，保留原有完整测试名称。
import { browser, collectWorkspaceStateEvidence, describe, expect, it } from './workspace-ui-test-environment.mjs';
import { loadMarkupAtUrl } from './workspace-ui-test-markup.mjs';
describe('workspace UI visual-state evidence', () => {
it('records a visible workspace error and enabled retry CTA as preview-only synthetic evidence', async () => {
    const context = await browser.newContext({
        reducedMotion: 'no-preference',
        viewport: { width: 1200, height: 700 },
    });
    const page = await context.newPage();
    try {
        await loadMarkupAtUrl(page, `
        <style>
          .app-status, .workspace-state { display: block; padding: 12px; }
          .workspace-state__action { width: 100px; height: 32px; }
        </style>
        <div class="app-status">仅开发预览 · diagnosis-ready</div>
        <section data-workspace="diagnosis" data-workspace-subview="analysis" data-workspace-evidence-root>
          <h1>广告诊断</h1>
          <div class="workspace-state workspace-state--error" data-workspace-state="error" role="alert">
            <div class="workspace-state__copy"><strong>诊断数据读取失败</strong></div>
            <button class="workspace-state__action" type="button">重新读取</button>
          </div>
        </section>
      `);
        const stateEvidence = await collectWorkspaceStateEvidence(page, {
            motionPreference: 'no-preference',
            visualState: 'workspace-error-retry',
        });
        expect(stateEvidence).toMatchObject({
            id: 'workspace-error-retry',
            passed: true,
            previewOnly: true,
            schemaVersion: 'workspace-ui-state-evidence/v1',
            syntheticTrigger: 'pipeline-read-failure',
            observed: {
                retryAction: { disabled: false, label: '重新读取', visible: true },
                workspaceState: { kind: 'error', role: 'alert', visible: true },
            },
        });
        expect(stateEvidence.violations).toEqual([]);
    }
    finally {
        await context.close();
    }
});

it('fails closed unless Diagnosis busy remains visible with an inline inspector, peer lock, and static reduced-motion spinners', async () => {
    const context = await browser.newContext({
        reducedMotion: 'reduce',
        viewport: { width: 1400, height: 900 },
    });
    const page = await context.newPage();
    try {
        await loadMarkupAtUrl(page, `
        <style>
          .app-status, #ai-strategy-run-feedback, .responsive-inspector { display: block; padding: 12px; }
          .task-banner__actions { display: flex; gap: 8px; }
          .task-banner__actions button { width: 160px; height: 36px; }
          .workspace-spinner { display: inline-block; width: 14px; height: 14px; animation: none; }
          .responsive-inspector { width: 360px; min-height: 180px; }
        </style>
        <div class="app-status">仅开发预览 · diagnosis-ready</div>
        <section data-workspace="diagnosis" data-workspace-subview="analysis" data-workspace-evidence-root>
          <h1>广告诊断</h1>
          <div id="ai-strategy-run-feedback" aria-busy="true" data-ai-run-tone="pending">
            <span class="workspace-spinner"></span>
            AI 阶段分析运行中 · 正在校验证据引用
          </div>
          <div class="task-banner__actions">
            <button data-action-priority="secondary" aria-busy="true" disabled>
              <span class="workspace-spinner"></span>AI 分析中...
            </button>
            <button data-action-priority="secondary" disabled>补充运营事件</button>
          </div>
          <aside class="responsive-inspector responsive-inspector--inline" data-inspector-mode="inline" role="complementary">
            <h2>door lock bedroom</h2>
          </aside>
        </section>
      `);
        const stateEvidence = await collectWorkspaceStateEvidence(page, {
            motionPreference: 'reduce',
            visualState: 'diagnosis-ai-running-with-inspector',
        });
        expect(stateEvidence).toMatchObject({
            id: 'diagnosis-ai-running-with-inspector',
            passed: true,
            previewOnly: true,
            requested: { inspectorMode: 'inline', motionPreference: 'reduce' },
            observed: {
                aiRun: { ariaBusy: true, tone: 'pending', visible: true },
                busyAction: { ariaBusy: true, disabled: true, label: 'AI 分析中...', visible: true },
                inspector: { mode: 'inline', visible: true },
                motion: { prefersReducedMotion: true, spinnerCount: 2 },
                peerActions: [{ ariaBusy: false, disabled: true, label: '补充运营事件' }],
            },
        });
        expect(stateEvidence.observed.motion.spinners.every((spinner) => spinner.animationName === 'none')).toBe(true);
        expect(stateEvidence.violations).toEqual([]);
    }
    finally {
        await context.close();
    }
});
});

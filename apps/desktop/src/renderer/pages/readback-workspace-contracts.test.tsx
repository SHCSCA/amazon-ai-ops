import { readStyleComposition } from '../styles/css-source.test-support';
import { transactionPageSource } from './transaction-page-source.test-support';
import {
  describe,
  expect,
  it,
} from 'vitest';
import { readFileSync } from 'node:fs';
import {
  readbackPrimaryTaskCopy,
  readbackRepairFieldClass,
  readbackStepFromKeyboard,
  readbackStepPanelId,
  readbackStepPanelProps,
  readbackStepTabId,
  requiredMissing,
} from './readback-page';
import { firstIncompleteReadbackStep } from '../readback-wizard';
import {
  completeForm,
} from "./readback-page.test-fixtures";

describe('readback task-first workspace frame', () => {
  it('does not report path-open success when the production bridge is unavailable', () => {
    const source = transactionPageSource('readback-navigation-actions.ts');
    const openFlow = source.slice(
      source.indexOf('async function openReadbackPathReadbackPageAction('),
      source.indexOf('async function openExportReadbackPageAction('),
    );

    expect(openFlow).toContain("if (typeof openReportPath !== 'function')");
    expect(openFlow).toContain('当前安全版本未提供路径打开能力');
    expect(openFlow).toContain('await openReportPath(targetPath)');
    expect(openFlow).not.toContain('openReportPath?.(targetPath)');
  });

  it('asks for an approved action before presenting screenshot repair as the main task', () => {
    const repairAction = {
      blocker: 'screenshot' as const,
      label: '补交截图',
      stepId: 'evidence' as const,
      focusTarget: 'readback-first-missing-screenshot',
    };

    expect(readbackPrimaryTaskCopy({
      recommendationId: '',
      finalVerificationPassed: false,
      primaryRepairAction: repairAction,
    })).toMatchObject({
      dataAction: 'select-approved-action',
      title: '选择已批准动作',
      statusLabel: '待选择动作',
    });
    expect(readbackPrimaryTaskCopy({
      recommendationId: '4',
      finalVerificationPassed: false,
      primaryRepairAction: repairAction,
    })).toMatchObject({
      dataAction: 'repair-screenshot',
      title: '补交截图',
    });
  });

  it('exposes the evidence workspace identity and uses one task banner, workbench, and technical inspector', () => {
    const source = readFileSync(new URL('./readback-view.tsx', import.meta.url), 'utf8');

    expect(transactionPageSource("readback-view.tsx")).toContain('<PageFrame');
    expect(transactionPageSource("readback-view.tsx")).toContain('<TaskBanner');
    expect(transactionPageSource("readback-view.tsx")).toContain('<WorkbenchPanel');
    expect(transactionPageSource("readback-view.tsx").match(/<ResponsiveInspector/g)).toHaveLength(1);
    expect(transactionPageSource("readback-view.tsx")).toContain('data-workspace="readback"');
    expect(transactionPageSource("readback-view.tsx")).toContain('data-workspace-subview="evidence"');
    expect(transactionPageSource("readback-view.tsx")).toContain('data-workspace-evidence-root="true"');
    expect(transactionPageSource("readback-view.tsx")).toContain('data-preview-scenario={authority.previewOnly ? previewScenarioId : undefined}');
    expect(source).not.toContain('<PageHeader');
    expect(source).not.toContain('<ProgressiveDetails');
  });

  it('keeps preview capture targets natively inert and removes raw screenshot path editors', () => {
    const source = readFileSync(new URL('./readback-view.tsx', import.meta.url), 'utf8');

    expect(transactionPageSource("readback-capture.tsx")).toContain('data-capture-slot={slot}');
    expect(transactionPageSource("readback-capture.tsx")).toContain('aria-disabled={disabled || undefined}');
    expect(transactionPageSource("readback-capture.tsx")).toContain('tabIndex={disabled ? -1 : 0}');
    expect(transactionPageSource("readback-view.tsx")).toContain('disabled={authority.previewOnly || Boolean(activeAction)}');
    expect(source).not.toMatch(/<input[^>]+value=\{form\.(approvalArtifactPath|beforeScreenshotPath|afterScreenshotPath|readbackEvidencePath)\}/);
  });

  it('treats loading another approved action as a complete evidence-session boundary', () => {
    const source = readFileSync(new URL('./readback-view.tsx', import.meta.url), 'utf8');
    const loadHandler = source.slice(
      source.indexOf('const nextForm = formFromRecommendation(row, scope, currentBatchId);'),
      source.indexOf('setActiveStep(firstIncompleteReadbackStep', source.indexOf('const nextForm = formFromRecommendation(row, scope, currentBatchId);')) + 140,
    );

    expect(loadHandler).toContain('setExportResult(null)');
    expect(loadHandler).toContain('setSessionResult(null)');
    expect(loadHandler).toContain('setSessionCheck(null)');
    expect(loadHandler).toContain('setSessionFillResult(null)');
    expect(loadHandler).toContain('setSessionVerifyResult(null)');
    expect(loadHandler).toContain('setMessage(null)');
    expect(loadHandler).toContain('setCopyNotice(null)');
  });

  it('publishes prepare, check, and fill results only for the current work-package request', () => {
    const source = readFileSync(new URL('./readback-view.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    const sessionFlow = transactionPageSource('readback-session-actions.ts').replace(/\r\n/g, '\n');

    expect(transactionPageSource("readback-workspace.tsx")).toContain("const activeSessionRequestRef = useRef<ReadbackRequestSnapshot | null>(null)");
    expect(sessionFlow.match(/kind: 'session'/g)).toHaveLength(3);
    expect(sessionFlow.match(/canPublishReadbackResult\(request, activeSessionRequestRef\.current\)/g)?.length).toBeGreaterThanOrEqual(6);
    expect(sessionFlow).toContain("runReadbackWorkflowMutation<any>(\n          'create'");
    expect(sessionFlow).toContain('activeSessionRequestRef.current\n              && canPublishReadbackResult(request, activeSessionRequestRef.current)');
    expect(sessionFlow).toContain('if (result?.readyForVerifier) setSessionCheck(null);');
  });

  it('does not attach a screenshot save that completes after the current scope or form changes', () => {
    const source = transactionPageSource('readback-capture-actions.tsx');
    const captureFlow = source.slice(
      source.indexOf('async function captureEvidenceReadbackPageAction('),
      source.indexOf('async function loadApprovedRowsReadbackPageAction('),
    );

    expect(transactionPageSource("readback-workspace.tsx")).toContain('const activeCaptureRequestRef = useRef<ReadbackRequestSnapshot | null>(null)');
    expect(captureFlow).toContain("kind: 'capture'");
    expect(captureFlow.match(/canPublishReadbackResult\(request, activeCaptureRequestRef\.current\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(captureFlow.indexOf('canPublishReadbackResult(request, activeCaptureRequestRef.current)'))
      .toBeLessThan(captureFlow.indexOf('update(captureSlotPatch'));
  });

  it('uses the strict readback error boundary for every workflow catch', () => {
    const source = readFileSync(new URL('./readback-view.tsx', import.meta.url), 'utf8');

    expect(transactionPageSource("readback-feedback.tsx")).toContain("import { toReadbackUserFacingError } from '../user-facing-error'");
    expect(source).not.toContain('toUserFacingError(');
    expect(transactionPageSource('readback-feedback.tsx')).toContain("rendererRuntimeLog.error('renderer.readback_failed'");
  });

  it('keeps first-screen copy operator-facing and shows one coherent passed state', () => {
    const source = readFileSync(new URL('./readback-view.tsx', import.meta.url), 'utf8');
    const firstScreen = source.slice(source.indexOf('<PageFrame'), source.indexOf('<ResponsiveInspector'));

    expect(transactionPageSource("readback-workspace.tsx")).toContain('const finalVerificationPassed = readbackVerifierPassed(sessionVerifyResult)');
    expect(transactionPageSource("readback-feedback.tsx")).toContain("title: '结果核对已通过'");
    expect(firstScreen).toContain('title={primaryTaskCopy.title}');
    expect(transactionPageSource("readback-workspace.tsx")).toContain("label: '查看核对详情'");
    expect(firstScreen).toContain('建议版本');
    expect(firstScreen).not.toContain('PASS');
    expect(firstScreen).not.toContain('NEEDS_WORK');
    expect(firstScreen).not.toContain('verifier');
    expect(firstScreen).not.toContain('Main 进程');
    expect(firstScreen).not.toContain('APP_READY');
  });

  it('uses a five-column authority table and a reduced-motion-safe repair handoff', () => {
    const source = readFileSync(new URL('./readback-view.tsx', import.meta.url), 'utf8');

    expect(transactionPageSource("readback-view.tsx")).toContain('<th>对象</th>');
    expect(transactionPageSource("readback-view.tsx")).toContain('<th>位置</th>');
    expect(transactionPageSource("readback-view.tsx")).toContain('<th>动作与值</th>');
    expect(transactionPageSource("readback-view.tsx")).toContain('<th>审批版本</th>');
    expect(transactionPageSource("readback-view.tsx")).toContain('<td colSpan={5}>');
    expect(transactionPageSource("readback-navigation-actions.ts")).toContain("window.matchMedia('(prefers-reduced-motion: reduce)').matches");
    expect(transactionPageSource("readback-navigation-actions.ts")).toContain("behavior: reducedMotion ? 'auto' : 'smooth'");
  });

  it('contains the task-first workspace at 1200px and 125% zoom without shrinking copy below 12px', () => {
    const stylesheet = readFileSync(new URL('../styles/readback.css', import.meta.url), 'utf8');

    expect(stylesheet).toMatch(/\.readback-page\s*{[\s\S]*overflow-x:\s*clip/);
    expect(stylesheet).toMatch(/\.readback-page \.approval-table\s*{[\s\S]*table-layout:\s*fixed/);
    expect(stylesheet).toContain('@media (max-width: 1199px)');
    expect(stylesheet).toContain('@media (max-width: 980px)');
    expect(stylesheet).toMatch(/\.readback-page :is\(small, code, \.muted-line\)[\s\S]*font-size:\s*12px/);
    expect(stylesheet).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation:\s*none/);
  });

  it('overrides legacy readback step and status labels to at least 12px', () => {
    const stylesheet = readFileSync(new URL('../styles/readback.css', import.meta.url), 'utf8');

    expect(stylesheet).toMatch(
      /\.readback-page \.readback-step > span,[\s\S]*\.readback-page \.readback-step strong,[\s\S]*\.readback-page \.readback-step small\s*{[\s\S]*font-size:\s*12px/,
    );
    expect(stylesheet).toMatch(
      /\.readback-page \.readback-contract-card > span,[\s\S]*\.readback-page \.status-pill,[\s\S]*\.readback-page \.chip\s*{[\s\S]*font-size:\s*12px/,
    );
  });

  it('keeps technical-drawer business splits readable without changing global business splits', () => {
    const stylesheet = readFileSync(new URL('../styles/readback.css', import.meta.url), 'utf8');

    expect(stylesheet).toMatch(
      /\.readback-technical-drawer \.business-split\s*{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    );
    expect(stylesheet).toMatch(
      /\.readback-technical-drawer \.business-split \.status-pill\s*{[\s\S]*justify-self:\s*start[\s\S]*width:\s*fit-content[\s\S]*white-space:\s*normal/,
    );
    expect(stylesheet).toMatch(
      /\.readback-technical-drawer \.business-split :is\(p, \.business-scope-line\)\s*{[\s\S]*text-align:\s*left[\s\S]*white-space:\s*normal/,
    );
    expect(stylesheet).not.toMatch(/(^|\n)\.business-split\s*{/);
  });
});

describe('readback safety checkbox feedback', () => {
  it('gives approval and verification checkboxes visible confirmation feedback', () => {
    const stylesheet = readStyleComposition(new URL('../styles.css', import.meta.url));

    expect(stylesheet).toMatch(/\.checkbox-grid label:focus-within[\s\S]*box-shadow:/);
    expect(stylesheet).toMatch(/\.checkbox-grid label:active[\s\S]*transform:\s*scale\(0\.98\)/);
    expect(stylesheet).toMatch(/\.checkbox-grid input\[type="checkbox"\]:checked[\s\S]*animation:\s*readback-checkbox-confirm/);
    expect(stylesheet).toContain('@keyframes readback-checkbox-confirm');
    expect(stylesheet).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.checkbox-grid input\[type="checkbox"\]:checked[\s\S]*animation:\s*none/);
  });
});

describe('readback structured field cells', () => {
  it('renders manual evidence inputs as labeled field cells instead of bare label/input pairs', () => {
    const source = readFileSync(new URL('./readback-view.tsx', import.meta.url), 'utf8');
    const stylesheet = readStyleComposition(new URL('../styles.css', import.meta.url));

    expect(transactionPageSource("readback-feedback.tsx")).toContain('function ReadbackFieldCell');
    expect(transactionPageSource("readback-feedback.tsx")).toContain('className="readback-field-cell-label"');
    expect(transactionPageSource("readback-view.tsx")).toMatch(/<ReadbackFieldCell[\s\S]{0,120}label="执行前值"/);
    expect(transactionPageSource("readback-view.tsx")).toMatch(/<ReadbackFieldCell[\s\S]{0,120}label="回读时间"/);
    expect(source).not.toContain("<label className={repairFieldClass('执行前值')}>执行前值<input");
    expect(stylesheet).toMatch(/\.readback-field-cell\s*{[\s\S]*border:\s*1px solid var\(--line-soft\)/);
    expect(stylesheet).toMatch(/\.readback-field-cell:focus-within\s*{[\s\S]*box-shadow:/);
    expect(stylesheet).toMatch(/\.readback-field-cell-label\s*{[\s\S]*background:\s*#fff/);
  });

  it('keeps Main-derived source and approval identity read-only without a renderer editor', () => {
    const source = readFileSync(new URL('./readback-view.tsx', import.meta.url), 'utf8');

    expect(transactionPageSource("readback-view.tsx")).toContain('className="readback-source-summary"');
    expect(transactionPageSource("readback-view.tsx")).toContain('data-readback-authority-source="main-derived"');
    expect(transactionPageSource("readback-view.tsx")).toContain('data-readback-approval-authority="main-derived"');
    expect(transactionPageSource("readback-view.tsx")).toContain('<dl className="readback-authority-grid"');
    expect(source).not.toContain('setSourceFieldEditorOpen');
    expect(source).not.toMatch(/<input[^>]+value=\{form\.(approverName|approvalNote|approvalConfirmedAt|approvalArtifactPath)\}/);
  });

  it('keeps verifier paths, hash, work package, and safety gates in one technical inspector', () => {
    const source = readFileSync(new URL('./readback-view.tsx', import.meta.url), 'utf8');

    expect(transactionPageSource("readback-view.tsx").match(/<ResponsiveInspector/g)).toHaveLength(1);
    expect(transactionPageSource("readback-view.tsx")).toContain('title="技术与证据详情"');
    expect(transactionPageSource("readback-view.tsx")).toContain('data-action="open-technical-inspector"');
    expect(transactionPageSource("readback-view.tsx")).toContain('<span>SHA-256</span>');
    expect(transactionPageSource("readback-view.tsx")).toContain('<h3 id="readback-technical-session-title">NEEDS_WORK 工作包</h3>');
    expect(transactionPageSource("readback-view.tsx")).toContain('className="readback-safety-gates"');
    expect(source).not.toContain('guardModalOpen');
    expect(source).not.toContain('<ProgressiveDetails');
  });
});

describe('readback wizard tab semantics', () => {
  it('binds step tabs to the active tabpanel and keeps a single keyboard landing point', () => {
    const source = readFileSync(new URL('./readback-view.tsx', import.meta.url), 'utf8');
    const stylesheet = readStyleComposition(new URL('../styles.css', import.meta.url));

    expect(readbackStepTabId('approval')).toBe('readback-step-tab-approval');
    expect(readbackStepPanelId('approval')).toBe('readback-step-panel-approval');
    expect(readbackStepPanelProps('approval')).toEqual({
      'aria-labelledby': 'readback-step-tab-approval',
      className: 'readback-step-panel',
      id: 'readback-step-panel-approval',
      role: 'tabpanel',
      tabIndex: 0,
    });
    expect(transactionPageSource("readback-view.tsx")).toContain('aria-controls={readbackStepPanelId(step.id)}');
    expect(transactionPageSource("readback-view.tsx")).toContain('id={readbackStepTabId(step.id)}');
    expect(transactionPageSource("readback-view.tsx")).toContain('tabIndex={activeStep === step.id ? 0 : -1}');
    expect(transactionPageSource("readback-view.tsx")).toContain("{...readbackStepPanelProps('target-source')}");
    expect(transactionPageSource("readback-view.tsx")).toContain("{...readbackStepPanelProps('verify-export')}");
    expect(stylesheet).toMatch(/\.readback-step-panel:focus-visible[\s\S]*outline:\s*2px solid rgb\(37 99 235 \/ 0\.34\)/);
  });

  it('supports desktop tablist keyboard navigation across readback steps', () => {
    expect(readbackStepFromKeyboard('target-source', 'ArrowRight')).toBe('approval');
    expect(readbackStepFromKeyboard('approval', 'ArrowDown')).toBe('evidence');
    expect(readbackStepFromKeyboard('evidence', 'ArrowLeft')).toBe('approval');
    expect(readbackStepFromKeyboard('target-source', 'ArrowUp')).toBe('verify-export');
    expect(readbackStepFromKeyboard('evidence', 'Home')).toBe('target-source');
    expect(readbackStepFromKeyboard('approval', 'End')).toBe('verify-export');
    expect(readbackStepFromKeyboard('approval', 'Enter')).toBeNull();
  });
});

describe('readback wizard integration', () => {
  it('uses requiredMissing output to select the first incomplete readback step', () => {
    const form = completeForm();
    form.approvalArtifactPath = '';

    expect(firstIncompleteReadbackStep(requiredMissing(form, 'batch_1'))).toBe('approval');
  });

  it('keeps the evidence edit transition explicit for the smoke no-tab-theft regression', () => {
    const form = completeForm();
    form.afterValue = '';

    expect(firstIncompleteReadbackStep(requiredMissing(form, 'batch_1'))).toBe('evidence');

    form.afterValue = '1.07';
    expect(firstIncompleteReadbackStep(requiredMissing(form, 'batch_1'))).toBe('verify-export');
  });
});

describe('delivery repair handoff', () => {
  it('maps delivery repair gaps to the exact evidence fields instead of only the panel', () => {
    expect(readbackRepairFieldClass('执行后截图', ['执行后截图'], true, true)).toBe('readback-repair-field-active readback-repair-field-pulse');
    expect(readbackRepairFieldClass('执行后截图', [], true, true)).toBe('');
    expect(readbackRepairFieldClass('执行后截图', ['执行后截图'], false, true)).toBe('');
    expect(readbackRepairFieldClass('回读值', ['回读值必须等于执行后值'], true, false)).toBe('readback-repair-field-active');
    expect(readbackRepairFieldClass('执行前截图', ['执行前、执行后和回读证据文件不能复用'], true, false)).toBe('readback-repair-field-active');
    expect(readbackRepairFieldClass('执行时间', ['时间顺序必须为审批≤执行前≤执行动作≤执行后≤回读'], true, false)).toBe('readback-repair-field-active');
  });

  it('consumes delivery repair intent and renders a visible repair target', () => {
    const source = readFileSync(new URL('./readback-view.tsx', import.meta.url), 'utf8');
    const stylesheet = readStyleComposition(new URL('../styles.css', import.meta.url));

    expect(transactionPageSource("readback-workspace.tsx")).toContain('READBACK_REPAIR_INTENT_EVENT');
    expect(transactionPageSource("readback-workspace.tsx")).toContain('READBACK_REPAIR_INTENT_STORAGE_KEY');
    expect(transactionPageSource("readback-workspace.tsx")).toContain('parseReadbackRepairIntent');
    expect(transactionPageSource("readback-view.tsx")).toContain('readback-repair-banner');
    expect(transactionPageSource("readback-view.tsx")).toContain('readback-step-repair-pulse');
    expect(transactionPageSource("readback-view.tsx")).toContain('readbackRepairPanelClass(Boolean(repairIntent), repairPulse)');
    expect(transactionPageSource("readback-view.tsx")).toContain('repairClassName={repairFieldClass');
    expect(stylesheet).toContain('.readback-repair-banner');
    expect(stylesheet).toContain('.readback-step-repair-pulse');
    expect(stylesheet).toContain('.readback-repair-target-pulse');
    expect(stylesheet).toContain('.readback-repair-field-active');
    expect(stylesheet).toContain('@keyframes readback-repair-field-ring');
    expect(stylesheet).toContain('@keyframes readback-repair-pulse');
  });
});

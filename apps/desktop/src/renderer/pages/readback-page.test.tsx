import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  EMPTY_FORM,
  buildFillAdReadbackCommand,
  buildFillAdReadbackSessionCommand,
  buildPrepareAdReadbackSessionCommand,
  buildVerifyAdReadbackSessionCommand,
  captureSlotPatch,
  decisionAgreementLabel,
  decisionSourceLabel,
  formFromRecommendation,
  groupMissing,
  nextEvidenceCaptureSlot,
  readbackCaptureTargetView,
  readbackActionButtonView,
  readbackContractChecks,
  readbackCopyCommandButtonView,
  readbackOpenPathButtonView,
  readbackPrimaryTaskCopy,
  readbackRepairFieldClass,
  readbackPrecheckCopy,
  readbackVerifierPassed,
  readbackSessionSummary,
  readbackSessionWorkflow,
  readbackStepFromKeyboard,
  readbackStepPanelId,
  readbackStepPanelProps,
  readbackStepTabId,
  readbackStepTabTitle,
  requiredMissing,
  runReadbackWorkflowMutation,
  sessionCheckCopy,
} from './readback-page';
import { firstIncompleteReadbackStep, readbackWizardSteps } from '../readback-wizard';
import { subscribeWorkflowInvalidation } from '../workflow-invalidation';

describe('readback workflow invalidation contract', () => {
  it('publishes readback-created after a successful evidence export', async () => {
    const target = new EventTarget();
    const sources: string[] = [];
    const unsubscribe = subscribeWorkflowInvalidation((detail) => sources.push(detail.source), target);

    await runReadbackWorkflowMutation('create', async () => ({ status: 'NEEDS_WORK' }), target);
    expect(sources).toEqual(['readback-created']);
    unsubscribe();
  });

  it('publishes readback-verified only when the authoritative verifier is ready and PASS', async () => {
    const target = new EventTarget();
    const sources: string[] = [];
    const unsubscribe = subscribeWorkflowInvalidation((detail) => sources.push(detail.source), target);

    await runReadbackWorkflowMutation('verify', async () => ({ ready: false, status: 'NEEDS_WORK' }), target);
    await runReadbackWorkflowMutation('verify', async () => ({ ready: true, status: 'NEEDS_WORK' }), target);
    await runReadbackWorkflowMutation('verify', async () => ({ ready: true, status: 'PASS' }), target);

    expect(readbackVerifierPassed({ ready: false, status: 'PASS' })).toBe(false);
    expect(readbackVerifierPassed({ ready: true, status: 'PASS' })).toBe(true);
    expect(sources).toEqual(['readback-verified']);
    unsubscribe();
  });

  it('suppresses workflow publication when the completed request is no longer current', async () => {
    const target = new EventTarget();
    const sources: string[] = [];
    const unsubscribe = subscribeWorkflowInvalidation((detail) => sources.push(detail.source), target);

    await runReadbackWorkflowMutation(
      'create',
      async () => ({ status: 'NEEDS_WORK' }),
      target,
      () => false,
    );
    await runReadbackWorkflowMutation(
      'verify',
      async () => ({ ready: true, status: 'PASS' }),
      target,
      () => false,
    );

    expect(sources).toEqual([]);
    unsubscribe();
  });
});

describe('readback task-first workspace frame', () => {
  it('does not report path-open success when the production bridge is unavailable', () => {
    const source = readFileSync(new URL('./readback-page.tsx', import.meta.url), 'utf8');
    const openFlow = source.slice(
      source.indexOf('async function openReadbackPath'),
      source.indexOf('async function openExportResult'),
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
    const source = readFileSync(new URL('./readback-page.tsx', import.meta.url), 'utf8');

    expect(source).toContain('<PageFrame');
    expect(source).toContain('<TaskBanner');
    expect(source).toContain('<WorkbenchPanel');
    expect(source.match(/<ResponsiveInspector/g)).toHaveLength(1);
    expect(source).toContain('data-workspace="readback"');
    expect(source).toContain('data-workspace-subview="evidence"');
    expect(source).toContain('data-workspace-evidence-root="true"');
    expect(source).toContain('data-preview-scenario={authority.previewOnly ? previewScenarioId : undefined}');
    expect(source).not.toContain('<PageHeader');
    expect(source).not.toContain('<ProgressiveDetails');
  });

  it('keeps preview capture targets natively inert and removes raw screenshot path editors', () => {
    const source = readFileSync(new URL('./readback-page.tsx', import.meta.url), 'utf8');

    expect(source).toContain('data-capture-slot={slot}');
    expect(source).toContain('aria-disabled={disabled || undefined}');
    expect(source).toContain('tabIndex={disabled ? -1 : 0}');
    expect(source).toContain('disabled={authority.previewOnly || Boolean(activeAction)}');
    expect(source).not.toMatch(/<input[^>]+value=\{form\.(approvalArtifactPath|beforeScreenshotPath|afterScreenshotPath|readbackEvidencePath)\}/);
  });

  it('treats loading another approved action as a complete evidence-session boundary', () => {
    const source = readFileSync(new URL('./readback-page.tsx', import.meta.url), 'utf8');
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
    const source = readFileSync(new URL('./readback-page.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    const sessionFlow = source.slice(
      source.indexOf('async function prepareSessionPacket()'),
      source.indexOf('async function verifyReadbackEvidence('),
    );

    expect(source).toContain("const activeSessionRequestRef = useRef<ReadbackRequestSnapshot | null>(null)");
    expect(sessionFlow.match(/kind: 'session'/g)).toHaveLength(3);
    expect(sessionFlow.match(/canPublishReadbackResult\(request, activeSessionRequestRef\.current\)/g)?.length).toBeGreaterThanOrEqual(6);
    expect(sessionFlow).toContain("runReadbackWorkflowMutation<any>(\n          'create'");
    expect(sessionFlow).toContain('activeSessionRequestRef.current\n              && canPublishReadbackResult(request, activeSessionRequestRef.current)');
    expect(sessionFlow).toContain('if (result?.readyForVerifier) setSessionCheck(null);');
  });

  it('does not attach a screenshot save that completes after the current scope or form changes', () => {
    const source = readFileSync(new URL('./readback-page.tsx', import.meta.url), 'utf8');
    const captureFlow = source.slice(
      source.indexOf('async function captureEvidence('),
      source.indexOf('async function loadApprovedRows()'),
    );

    expect(source).toContain('const activeCaptureRequestRef = useRef<ReadbackRequestSnapshot | null>(null)');
    expect(captureFlow).toContain("kind: 'capture'");
    expect(captureFlow.match(/canPublishReadbackResult\(request, activeCaptureRequestRef\.current\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(captureFlow.indexOf('canPublishReadbackResult(request, activeCaptureRequestRef.current)'))
      .toBeLessThan(captureFlow.indexOf('update(captureSlotPatch'));
  });

  it('uses the strict readback error boundary for every workflow catch', () => {
    const source = readFileSync(new URL('./readback-page.tsx', import.meta.url), 'utf8');

    expect(source).toContain("import { toReadbackUserFacingError } from '../user-facing-error'");
    expect(source).not.toContain('toUserFacingError(');
    expect(source).toContain("console.error('[readback-workspace]'");
  });

  it('keeps first-screen copy operator-facing and shows one coherent passed state', () => {
    const source = readFileSync(new URL('./readback-page.tsx', import.meta.url), 'utf8');
    const firstScreen = source.slice(source.indexOf('<PageFrame'), source.indexOf('<ResponsiveInspector'));

    expect(source).toContain('const finalVerificationPassed = readbackVerifierPassed(sessionVerifyResult)');
    expect(source).toContain("title: '结果核对已通过'");
    expect(firstScreen).toContain('title={primaryTaskCopy.title}');
    expect(source).toContain("label: '查看核对详情'");
    expect(firstScreen).toContain('建议版本');
    expect(firstScreen).not.toContain('PASS');
    expect(firstScreen).not.toContain('NEEDS_WORK');
    expect(firstScreen).not.toContain('verifier');
    expect(firstScreen).not.toContain('Main 进程');
    expect(firstScreen).not.toContain('APP_READY');
  });

  it('uses a five-column authority table and a reduced-motion-safe repair handoff', () => {
    const source = readFileSync(new URL('./readback-page.tsx', import.meta.url), 'utf8');

    expect(source).toContain('<th>对象</th>');
    expect(source).toContain('<th>位置</th>');
    expect(source).toContain('<th>动作与值</th>');
    expect(source).toContain('<th>审批版本</th>');
    expect(source).toContain('<td colSpan={5}>');
    expect(source).toContain("window.matchMedia('(prefers-reduced-motion: reduce)').matches");
    expect(source).toContain("behavior: reducedMotion ? 'auto' : 'smooth'");
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

function completeForm(sourceRow = '12') {
  return {
    ...EMPTY_FORM,
    storeName: 'FT-US-US',
    marketplaceCode: 'US',
    asin: 'B0TESTASIN',
    campaignName: 'D6-auto-test',
    adGroupName: 'D6-ad-group',
    entityType: 'target',
    entityName: 'tight match target',
    actionType: 'lower_bid',
    currentValue: '1.20',
    recommendedValue: '1.08',
    sourceBatchId: 'batch_1',
    sourceMetricDate: '2026-06-12',
    sourceRow,
    sourceFiles: 'C:/reports/user-search-term.xlsx',
    approverName: 'QA Approver',
    approvalArtifactPath: 'C:/evidence/approval.png',
    approvalConfirmedAt: '2026-06-12T10:00:00.000Z',
    executedBy: 'QA Operator',
    executionId: 'manual-smoke-001',
    executionExecutedAt: '2026-06-12T10:05:00.000Z',
    beforeValue: '1.20',
    beforeCapturedAt: '2026-06-12T10:03:00.000Z',
    beforeScreenshotPath: 'C:/evidence/before.png',
    afterValue: '1.08',
    afterCapturedAt: '2026-06-12T10:06:00.000Z',
    afterScreenshotPath: 'C:/evidence/after.png',
    readbackActualValue: '1.08',
    readbackReadAt: '2026-06-12T10:10:00.000Z',
    readbackEvidencePath: 'C:/evidence/readback.png',
    liveBidSourceNote: 'Ads UI row reloaded.',
    operatorConfirmed: true,
    realWriteApproved: true,
    allowedByPolicy: true,
    executionSuccess: true,
    executionVerified: true,
    readbackVerified: true,
  };
}

describe('requiredMissing', () => {
  it('does not report missing fields for a complete readback draft', () => {
    expect(requiredMissing(completeForm(), 'batch_1')).toEqual([]);
  });

  it('requires source row to be a positive original report row number', () => {
    expect(requiredMissing(completeForm('-1'), 'batch_1')).toContain('来源行号');
  });

  it('requires the execution target to be bound to a concrete product ASIN', () => {
    const form = completeForm();
    form.asin = '';

    expect(requiredMissing(form, 'batch_1')).toContain('ASIN');
  });

  it('requires source files to be real spreadsheet report paths', () => {
    const form = completeForm();
    form.sourceFiles = 'C:/evidence/acceptance-audit.json';

    expect(requiredMissing(form, 'batch_1')).toContain('推荐来源文件必须是真实报表');
  });

  it('rejects mixed source files when any entry is not a spreadsheet report', () => {
    const form = completeForm();
    form.sourceFiles = [
      'C:/reports/user-search-term.xlsx',
      'C:/evidence/acceptance-audit.json',
    ].join('\n');

    expect(requiredMissing(form, 'batch_1')).toContain('推荐来源文件必须全部是真实报表');
  });

  it('allows the source current value to differ from the before live value', () => {
    const form = completeForm();
    form.currentValue = '1.30';

    expect(requiredMissing(form, 'batch_1')).not.toContain('来源当前值必须等于执行前值');
  });

  it('allows the source recommended value to differ from the after live value', () => {
    const form = completeForm();
    form.recommendedValue = '1.10';

    expect(requiredMissing(form, 'batch_1')).not.toContain('来源建议值必须等于执行后值');
  });

  it('accepts readback values that numerically match the after value with USD formatting', () => {
    const form = completeForm();
    form.afterValue = '1.08 USD';
    form.readbackActualValue = '$1.08';
    form.recommendedValue = '1.08';

    expect(requiredMissing(form, 'batch_1')).not.toContain('回读值必须等于执行后值');
  });

  it('rejects unchanged before and after values even when their USD formatting differs', () => {
    const form = completeForm();
    form.beforeValue = '$1.08';
    form.afterValue = '1.08 USD';
    form.currentValue = '1.08';
    form.recommendedValue = '1.08';
    form.readbackActualValue = '1.08';

    expect(requiredMissing(form, 'batch_1')).toContain('执行前值和执行后值不能相同');
  });

  it('requires lower bid actions to prove the after value is below the before value', () => {
    const form = completeForm();
    form.afterValue = '1.30';
    form.readbackActualValue = '1.30';
    form.recommendedValue = '1.30';

    expect(requiredMissing(form, 'batch_1')).toContain('降价动作必须证明执行后值低于执行前值');
  });

  it('requires before, after, and readback evidence paths to be distinct', () => {
    const form = completeForm();
    form.readbackEvidencePath = form.afterScreenshotPath;

    expect(requiredMissing(form, 'batch_1')).toContain('执行前、执行后和回读证据文件不能复用');
  });
});

describe('readback safety checkbox feedback', () => {
  it('gives approval and verification checkboxes visible confirmation feedback', () => {
    const stylesheet = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

    expect(stylesheet).toMatch(/\.checkbox-grid label:focus-within[\s\S]*box-shadow:/);
    expect(stylesheet).toMatch(/\.checkbox-grid label:active[\s\S]*transform:\s*scale\(0\.98\)/);
    expect(stylesheet).toMatch(/\.checkbox-grid input\[type="checkbox"\]:checked[\s\S]*animation:\s*readback-checkbox-confirm/);
    expect(stylesheet).toContain('@keyframes readback-checkbox-confirm');
    expect(stylesheet).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.checkbox-grid input\[type="checkbox"\]:checked[\s\S]*animation:\s*none/);
  });
});

describe('readback wizard user-task copy', () => {
  it('frames the readback flow as approved action, approval proof, execution evidence, and export', () => {
    const source = readFileSync(new URL('./readback-page.tsx', import.meta.url), 'utf8');

    expect(readbackWizardSteps.map((step) => step.title)).toEqual([
      '1. 选择已批准动作',
      '2. 填写审批凭证',
      '3. 记录执行和回读',
      '4. 校验并导出证据',
    ]);
    expect(source).toContain('选择已批准动作，保存审批凭证、执行前后截图和刷新后的回读值');
    expect(source).toContain('先记录执行前值和截图，再记录执行后值和截图，最后刷新广告后台填写回读值和回读截图');
  });

  it('removes duplicate step numbers and does not repeat the workbench title inside the active panel', () => {
    const source = readFileSync(new URL('./readback-page.tsx', import.meta.url), 'utf8');

    expect(readbackStepTabTitle('1. 选择已批准动作')).toBe('选择已批准动作');
    expect(readbackStepTabTitle('4. 校验并导出证据')).toBe('校验并导出证据');
    expect(source).toContain('<strong>{readbackStepTabTitle(step.title)}</strong>');
    expect(source).toContain('<section aria-label="审批凭证内容" className="readback-workbench-section">');
    expect(source).not.toContain('<h3 id="readback-approval-title">2. 填写审批凭证</h3>');
    expect(source).not.toContain('<h3 id="readback-verify-title">4. 校验并导出证据</h3>');
  });

  it('runs export and direct verification only through the blocker-derived task action', () => {
    const source = readFileSync(new URL('./readback-page.tsx', import.meta.url), 'utf8');

    expect(source).toContain('runReadbackFinalVerificationWorkflow({');
    expect(source).toContain(': form.recommendationId ? taskBannerAction(primaryRepairAction) : selectApprovedActionTaskAction');
    expect(source).toContain("activeActionRef.current = action");
    expect(source).not.toContain('const exportEvidenceButton = readbackActionButtonView({');
  });
});

describe('readback structured field cells', () => {
  it('renders manual evidence inputs as labeled field cells instead of bare label/input pairs', () => {
    const source = readFileSync(new URL('./readback-page.tsx', import.meta.url), 'utf8');
    const stylesheet = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

    expect(source).toContain('function ReadbackFieldCell');
    expect(source).toContain('className="readback-field-cell-label"');
    expect(source).toMatch(/<ReadbackFieldCell[\s\S]{0,120}label="执行前值"/);
    expect(source).toMatch(/<ReadbackFieldCell[\s\S]{0,120}label="回读时间"/);
    expect(source).not.toContain("<label className={repairFieldClass('执行前值')}>执行前值<input");
    expect(stylesheet).toMatch(/\.readback-field-cell\s*{[\s\S]*border:\s*1px solid var\(--line-soft\)/);
    expect(stylesheet).toMatch(/\.readback-field-cell:focus-within\s*{[\s\S]*box-shadow:/);
    expect(stylesheet).toMatch(/\.readback-field-cell-label\s*{[\s\S]*background:\s*#fff/);
  });

  it('keeps Main-derived source and approval identity read-only without a renderer editor', () => {
    const source = readFileSync(new URL('./readback-page.tsx', import.meta.url), 'utf8');

    expect(source).toContain('className="readback-source-summary"');
    expect(source).toContain('data-readback-authority-source="main-derived"');
    expect(source).toContain('data-readback-approval-authority="main-derived"');
    expect(source).toContain('<dl className="readback-authority-grid"');
    expect(source).not.toContain('setSourceFieldEditorOpen');
    expect(source).not.toMatch(/<input[^>]+value=\{form\.(approverName|approvalNote|approvalConfirmedAt|approvalArtifactPath)\}/);
  });

  it('keeps verifier paths, hash, work package, and safety gates in one technical inspector', () => {
    const source = readFileSync(new URL('./readback-page.tsx', import.meta.url), 'utf8');

    expect(source.match(/<ResponsiveInspector/g)).toHaveLength(1);
    expect(source).toContain('title="技术与证据详情"');
    expect(source).toContain('data-action="open-technical-inspector"');
    expect(source).toContain('<span>SHA-256</span>');
    expect(source).toContain('<h3 id="readback-technical-session-title">NEEDS_WORK 工作包</h3>');
    expect(source).toContain('className="readback-safety-gates"');
    expect(source).not.toContain('guardModalOpen');
    expect(source).not.toContain('<ProgressiveDetails');
  });
});

describe('readback wizard tab semantics', () => {
  it('binds step tabs to the active tabpanel and keeps a single keyboard landing point', () => {
    const source = readFileSync(new URL('./readback-page.tsx', import.meta.url), 'utf8');
    const stylesheet = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

    expect(readbackStepTabId('approval')).toBe('readback-step-tab-approval');
    expect(readbackStepPanelId('approval')).toBe('readback-step-panel-approval');
    expect(readbackStepPanelProps('approval')).toEqual({
      'aria-labelledby': 'readback-step-tab-approval',
      className: 'readback-step-panel',
      id: 'readback-step-panel-approval',
      role: 'tabpanel',
      tabIndex: 0,
    });
    expect(source).toContain('aria-controls={readbackStepPanelId(step.id)}');
    expect(source).toContain('id={readbackStepTabId(step.id)}');
    expect(source).toContain('tabIndex={activeStep === step.id ? 0 : -1}');
    expect(source).toContain("{...readbackStepPanelProps('target-source')}");
    expect(source).toContain("{...readbackStepPanelProps('verify-export')}");
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

describe('groupMissing', () => {
  it('groups every readback verifier-aligned blocker so operators can see the recovery area', () => {
    const blockers = [
      '降价动作必须证明执行后值低于执行前值',
      '执行前、执行后和回读证据文件不能复用',
    ];

    const groupedItems = groupMissing(blockers).flatMap((group) => group.items);

    expect(groupedItems).toEqual(expect.arrayContaining(blockers));
  });
});

describe('readbackContractChecks', () => {
  function contractByKey(form: ReturnType<typeof completeForm>, key: ReturnType<typeof readbackContractChecks>[number]['key']) {
    return readbackContractChecks(form).find((check) => check.key === key);
  }

  it('marks every time and value contract check ready for a complete draft', () => {
    expect(readbackContractChecks(completeForm()).map((check) => check.status)).toEqual([
      'ready',
      'ready',
      'ready',
      'ready',
      'ready',
    ]);
  });

  it('blocks when execution time is earlier than the before screenshot time', () => {
    const form = completeForm();
    form.executionExecutedAt = '2026-06-12T10:02:00.000Z';

    expect(contractByKey(form, 'time-order')).toMatchObject({
      status: 'blocked',
      detail: expect.stringContaining('必须满足审批≤执行前≤执行动作≤执行后≤回读'),
    });
  });

  it('blocks unchanged values, readback mismatch, and reused screenshot paths as separate visible checks', () => {
    const form = completeForm();
    form.afterValue = form.beforeValue;
    form.readbackActualValue = '1.10';
    form.readbackEvidencePath = form.afterScreenshotPath;

    expect(contractByKey(form, 'value-change')).toMatchObject({ status: 'blocked' });
    expect(contractByKey(form, 'readback-match')).toMatchObject({ status: 'blocked' });
    expect(contractByKey(form, 'lower-bid-direction')).toMatchObject({ status: 'blocked' });
    expect(contractByKey(form, 'evidence-distinct')).toMatchObject({ status: 'blocked' });
  });

  it('shows pending states before the operator has filled live evidence values', () => {
    const form = completeForm();
    form.beforeValue = '';
    form.afterValue = '';
    form.readbackActualValue = '';

    expect(contractByKey(form, 'value-change')).toMatchObject({ status: 'pending' });
    expect(contractByKey(form, 'readback-match')).toMatchObject({ status: 'pending' });
    expect(contractByKey(form, 'lower-bid-direction')).toMatchObject({ status: 'pending' });
  });
});

describe('readbackPrecheckCopy', () => {
  it('does not claim final field completeness before backend file-existence verification', () => {
    expect(readbackPrecheckCopy([])).toEqual({
      statusLabel: '字段已填写，待导出校验',
      chipLabel: '执行前、执行后和回读值已填写；导出时会校验本地文件存在。',
      exportButtonLabel: '导出回读证据',
      helperText: '字段已填写时仍需导出证据文件和说明文件，并由后端校验截图、真实报表和回读证据文件是否存在。',
    });
  });
});

describe('readbackActionButtonView', () => {
  it('locks evidence workflow peers while only the active readback action shows busy feedback', () => {
    const active = readbackActionButtonView({
      action: 'fill-session',
      activeAction: 'fill-session',
      baseClassName: 'primary-button',
      busyLabel: '生成中...',
      label: '生成回读证据',
    });

    expect(active.label).toBe('生成中...');
    expect(active.disabled).toBe(true);
    expect(active.ariaBusy).toBe(true);
    expect(active.showSpinner).toBe(true);
    expect(active.className).toContain('button-loading');

    const lockedPeer = readbackActionButtonView({
      action: 'verify-evidence',
      activeAction: 'fill-session',
      baseClassName: 'secondary-button',
      busyLabel: '校验中...',
      label: '校验回读证据',
    });

    expect(lockedPeer.label).toBe('校验回读证据');
    expect(lockedPeer.disabled).toBe(true);
    expect(lockedPeer.ariaBusy).toBeUndefined();
    expect(lockedPeer.showSpinner).toBe(false);
    expect(lockedPeer.className).not.toContain('button-loading');
  });
});

describe('readbackCopyCommandButtonView', () => {
  it('gives backup copy-command buttons active feedback and locks copy peers', () => {
    const active = readbackCopyCommandButtonView({
      activeCommand: 'prepare',
      command: 'prepare',
      disabled: false,
      label: '复制创建工作包命令',
    });

    expect(active.label).toBe('复制中...');
    expect(active.disabled).toBe(true);
    expect(active.ariaBusy).toBe(true);
    expect(active.showSpinner).toBe(true);
    expect(active.className).toContain('button-loading');

    const lockedPeer = readbackCopyCommandButtonView({
      activeCommand: 'prepare',
      command: 'verify',
      disabled: false,
      label: '复制检查工作包命令',
    });

    expect(lockedPeer.label).toBe('复制检查工作包命令');
    expect(lockedPeer.disabled).toBe(true);
    expect(lockedPeer.ariaBusy).toBeUndefined();
    expect(lockedPeer.showSpinner).toBe(false);
    expect(lockedPeer.className).not.toContain('button-loading');
  });
});

describe('readbackOpenPathButtonView', () => {
  it('gives readback local path buttons explicit opening feedback and locks peers', () => {
    const active = readbackOpenPathButtonView({
      activePathKey: '打开工作包:C:/session',
      idleLabel: '打开工作包',
      pathKey: '打开工作包:C:/session',
    });

    expect(active.label).toBe('打开中...');
    expect(active.disabled).toBe(true);
    expect(active.ariaBusy).toBe(true);
    expect(active.showSpinner).toBe(true);
    expect(active.className).toContain('button-loading');

    const lockedPeer = readbackOpenPathButtonView({
      activePathKey: '打开工作包:C:/session',
      idleLabel: '打开填写文件',
      pathKey: '打开填写文件:C:/session/session-input.json',
    });

    expect(lockedPeer.label).toBe('打开填写文件');
    expect(lockedPeer.disabled).toBe(true);
    expect(lockedPeer.ariaBusy).toBeUndefined();
    expect(lockedPeer.showSpinner).toBe(false);
    expect(lockedPeer.className).not.toContain('button-loading');
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

describe('readback capture helpers', () => {
  it('maps pasted screenshot paths to the matching evidence field and timestamp', () => {
    expect(captureSlotPatch('before', 'C:/session/screenshots/before/before.png', '2026-06-25T12:00:00.000Z')).toEqual({
      beforeScreenshotPath: 'C:/session/screenshots/before/before.png',
      beforeCapturedAt: '2026-06-25T12:00:00.000Z',
    });
    expect(captureSlotPatch('readback', 'C:/session/screenshots/readback/readback.png', '2026-06-25T12:10:00.000Z')).toEqual({
      readbackEvidencePath: 'C:/session/screenshots/readback/readback.png',
      readbackReadAt: '2026-06-25T12:10:00.000Z',
    });
  });

  it('selects the next missing screenshot slot for global paste capture', () => {
    const form = completeForm();
    form.beforeScreenshotPath = '';
    form.afterScreenshotPath = '';
    form.readbackEvidencePath = '';

    expect(nextEvidenceCaptureSlot(form)).toBe('before');

    form.beforeScreenshotPath = 'C:/session/before.png';
    expect(nextEvidenceCaptureSlot(form)).toBe('after');

    form.afterScreenshotPath = 'C:/session/after.png';
    expect(nextEvidenceCaptureSlot(form)).toBe('readback');

    form.readbackEvidencePath = 'C:/session/readback.png';
    expect(nextEvidenceCaptureSlot(form)).toBe('readback');
  });

  it('builds distinct copy and classes for drop target visual states', () => {
    expect(readbackCaptureTargetView('before')).toMatchObject({
      className: 'readback-capture-target',
      title: '执行前截图',
      helper: '点击此区域后 Ctrl+V，或拖入图片文件',
    });

    expect(readbackCaptureTargetView('before', { dragging: true })).toMatchObject({
      className: expect.stringContaining('readback-capture-dragging'),
      title: '松开即可存证',
      helper: '已识别拖入截图，松开鼠标后写入本地证据目录。',
    });

    const savingView = readbackCaptureTargetView('after', { saving: true, dragging: true });
    expect(savingView).toMatchObject({
      className: expect.stringContaining('readback-capture-saving'),
      title: '正在存证...',
      helper: '正在写入本地证据目录...',
    });
    expect(savingView.className).not.toContain('readback-capture-dragging');

    expect(readbackCaptureTargetView('readback', { value: 'C:/evidence/readback.png' })).toMatchObject({
      className: expect.stringContaining('readback-capture-filled'),
      title: '回读截图已安全固定',
      helper: 'C:/evidence/readback.png',
      preview: {
        alt: '回读截图缩略预览',
        badge: '证据已安全固定',
        fileName: 'readback.png',
        path: 'C:/evidence/readback.png',
      },
    });
  });

  it('keeps the drag-over drop zone animation contract in CSS', () => {
    const stylesheet = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

    expect(stylesheet).toContain('.readback-capture-dragging');
    expect(stylesheet).toContain('readback-capture-marching-ants');
    expect(stylesheet).toContain('readback-capture-breathe');
  });

  it('keeps the fixed screenshot thumbnail and green badge contract in CSS', () => {
    const source = readFileSync(new URL('./readback-page.tsx', import.meta.url), 'utf8');
    const stylesheet = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

    expect(source).toContain('readback-capture-fixed-preview');
    expect(source).toContain('readback-capture-fixed-badge');
    expect(source).toContain('readback-capture-thumbnail');
    expect(stylesheet).toContain('.readback-capture-fixed-preview');
    expect(stylesheet).toContain('.readback-capture-thumbnail');
    expect(stylesheet).toContain('.readback-capture-fixed-badge');
    expect(stylesheet).toContain('var(--tone-ready-bg)');
    expect(source).toContain('证据已安全固定');
  });

  it('keeps the active wizard step rail slider contract', () => {
    const source = readFileSync(new URL('./readback-page.tsx', import.meta.url), 'utf8');
    const stylesheet = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

    expect(source).toContain('--readback-active-step');
    expect(source).toContain('--readback-step-count');
    expect(source).toContain('style={readbackStepRailStyle}');
    expect(stylesheet).toContain('.readback-step-tabs::after');
    expect(stylesheet).toContain('height: 2px');
    expect(stylesheet).toContain('transform: translateX(calc(var(--readback-active-step) * (100% + 6px)))');
    expect(stylesheet).toContain('transition: transform 180ms ease');
    expect(stylesheet).toContain('@media (prefers-reduced-motion: reduce)');
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
    const source = readFileSync(new URL('./readback-page.tsx', import.meta.url), 'utf8');
    const stylesheet = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

    expect(source).toContain('READBACK_REPAIR_INTENT_EVENT');
    expect(source).toContain('READBACK_REPAIR_INTENT_STORAGE_KEY');
    expect(source).toContain('parseReadbackRepairIntent');
    expect(source).toContain('readback-repair-banner');
    expect(source).toContain('readback-step-repair-pulse');
    expect(source).toContain('readbackRepairPanelClass(Boolean(repairIntent), repairPulse)');
    expect(source).toContain('repairClassName={repairFieldClass');
    expect(stylesheet).toContain('.readback-repair-banner');
    expect(stylesheet).toContain('.readback-step-repair-pulse');
    expect(stylesheet).toContain('.readback-repair-target-pulse');
    expect(stylesheet).toContain('.readback-repair-field-active');
    expect(stylesheet).toContain('@keyframes readback-repair-field-ring');
    expect(stylesheet).toContain('@keyframes readback-repair-pulse');
  });
});

describe('sessionCheckCopy', () => {
  it('translates backend capture field labels before showing them to operators', () => {
    const copy = sessionCheckCopy({
      ready: true,
      captureReady: false,
      captureMissingFields: [
        { group: '执行前', label: '执行前 Ads UI live bid' },
        { group: '执行后', label: '执行后 Ads UI live bid' },
      ],
    });

    expect(copy.detail).toBe('还需填写：执行前/现场出价、执行后/现场出价');
    expect(copy.detail).not.toContain('Ads UI');
  });
});

describe('buildFillAdReadbackCommand', () => {
  it('builds a quoted fill command from the current form and exported source path', () => {
    const form = completeForm();
    form.approverName = "Ops Owner's Desk";
    form.approvalArtifactPath = 'C:/evidence/approval ticket.png';

    const command = buildFillAdReadbackCommand(
      form,
      'C:/evidence/candidate.json',
      'C:/evidence/readback-pass.json',
    );

    expect(command).toContain('pnpm run fill:ad-readback --');
    expect(command).toContain("--source 'C:/evidence/candidate.json'");
    expect(command).toContain("--out 'C:/evidence/readback-pass.json'");
    expect(command).toContain("--approver-name 'Ops Owner''s Desk'");
    expect(command).toContain("--approval-artifact 'C:/evidence/approval ticket.png'");
    expect(command).toContain("--readback-evidence 'C:/evidence/readback.png'");
    expect(command).not.toContain('undefined');
  });
});

describe('ad readback session command builders', () => {
  it('builds prepare, verify and fill session commands from an exported gap draft path', () => {
    const sourcePath = "C:/evidence/rec 4's gap.json";
    const sessionDir = "C:/evidence/rec 4's gap-session";

    expect(buildPrepareAdReadbackSessionCommand(sourcePath, sessionDir)).toBe(
      "pnpm run prepare:ad-readback-session -- --source 'C:/evidence/rec 4''s gap.json' --out 'C:/evidence/rec 4''s gap-session'",
    );
    expect(buildVerifyAdReadbackSessionCommand(sourcePath, sessionDir)).toBe(
      "pnpm run verify:ad-readback-session -- 'C:/evidence/rec 4''s gap-session'",
    );
    expect(buildFillAdReadbackSessionCommand(sourcePath, sessionDir)).toBe(
      "pnpm run fill:ad-readback-session -- --session 'C:/evidence/rec 4''s gap-session'",
    );
  });

  it('defaults the session folder next to the exported JSON', () => {
    expect(buildPrepareAdReadbackSessionCommand('C:/evidence/readback.json')).toContain(
      "--out 'C:/evidence/readback-session'",
    );
    expect(buildFillAdReadbackSessionCommand('C:/evidence/readback.json')).toContain(
      "--session 'C:/evidence/readback-session'",
    );
  });
});

describe('readbackSessionWorkflow', () => {
  it('summarizes the work package without exposing command names as the primary flow', () => {
    expect(readbackSessionSummary('C:/evidence/readback.json')).toBe('创建工作包后，按清单补审批、执行前、执行后和回读截图。');
    expect(readbackSessionSummary()).toBe('先导出回读证据，再创建工作包。');
  });

  it('explains the operator session packet without claiming final readiness', () => {
    const workflow = readbackSessionWorkflow('C:/evidence/readback.json');

    expect(workflow.sessionDir).toBe('C:/evidence/readback-session');
    expect(workflow.steps.join(' ')).toContain('填写文件');
    expect(workflow.steps.join(' ')).toContain('执行前截图目录');
    expect(workflow.steps.join(' ')).toContain('执行后截图目录');
    expect(workflow.steps.join(' ')).toContain('回读截图目录');
    expect(workflow.warning).toContain('不等于最终验收通过');
    expect(workflow.warning).toContain('最终验收汇总');
    expect(workflow.steps.join(' ')).not.toContain('session-input.json');
    expect(workflow.steps.join(' ')).not.toContain('fill session');
    expect(workflow.steps.join(' ')).not.toContain('readback JSON');
    expect(workflow.warning).not.toContain('manifest');
    expect(workflow.warning).not.toContain('verify:ad-readback');
  });

  it('does not expose a fake session directory before a readback JSON is exported', () => {
    expect(readbackSessionWorkflow().sessionDir).toBe('导出回读证据后自动生成');
  });
});

describe('readback display labels', () => {
  it('shows operator-facing labels for decision agreement and source instead of raw enum values', () => {
    expect(decisionAgreementLabel('aligned')).toBe('规则+AI 一致');
    expect(decisionAgreementLabel('rule_only')).toBe('规则独立建议');
    expect(decisionAgreementLabel('ai_only')).toBe('AI 独立洞察');
    expect(decisionAgreementLabel('conflict')).toBe('规则/AI 冲突');
    expect(decisionSourceLabel('rule_ai')).toBe('规则+AI 合并');
    expect(decisionSourceLabel('rule')).toBe('规则');
  });
});

describe('formFromRecommendation', () => {
  it('preserves separated AI fallback reasons when loading a recommendation for readback', () => {
    const form = formFromRecommendation({
      id: 101,
      actionType: 'lower_bid',
      entityType: 'target',
      currentValue: '1.20',
      recommendedValue: '1.08',
      evidence: {
        batchId: 'batch_1',
        sourceRow: 12,
        sourceFiles: ['C:/reports/user-search-term.xlsx'],
        aiStrategyFallbackReason: 'AI 策略诊断 schemaVersion 错误，已回退规则。',
        aiActionFallbackReason: 'AI 单条解释无法解析 JSON，使用规则解释。',
      },
    } as any, { storeName: 'FT-US-US', marketplaceCode: 'US' }, 'batch_1');

    expect(form.aiStrategyFallbackReason).toBe('AI 策略诊断 schemaVersion 错误，已回退规则。');
    expect(form.aiActionFallbackReason).toBe('AI 单条解释无法解析 JSON，使用规则解释。');
  });

  it('preserves AI threshold review metadata when loading an approved recommendation for readback', () => {
    const form = formFromRecommendation({
      id: 101,
      actionType: 'lower_bid',
      entityType: 'target',
      currentValue: '1.20',
      recommendedValue: '1.08',
      evidence: {
        batchId: 'batch_1',
        sourceRow: 12,
        sourceFiles: ['C:/reports/user-search-term.xlsx'],
        aiThresholdSuggestions: {
          targetAcos: {
            value: 0.35,
            reason: '产品阶段证据不足，需人工复核',
            evidenceRefs: ['metric:batch_1:keyword:2026-06-12:target:abc'],
            requiresReview: true,
            reviewReasons: ['缺少产品阶段配置证据'],
          },
        },
      },
    } as any, { storeName: 'FT-US-US', marketplaceCode: 'US' }, 'batch_1');

    expect(form.aiThresholdSuggestions.targetAcos).toMatchObject({
      value: 0.35,
      requiresReview: true,
      reviewReasons: ['缺少产品阶段配置证据'],
      evidenceRefs: ['metric:batch_1:keyword:2026-06-12:target:abc'],
    });
  });
});

import { transactionPageSource } from './transaction-page-source.test-support';
import {
  describe,
  expect,
  it,
} from 'vitest';
import { readFileSync } from 'node:fs';
import {
  decisionAgreementLabel,
  decisionSourceLabel,
  formFromRecommendation,
  groupMissing,
  readbackContractChecks,
  readbackPrecheckCopy,
  readbackVerifierPassed,
  readbackStepTabTitle,
  requiredMissing,
  runReadbackWorkflowMutation,
} from './readback-page';
import { readbackWizardSteps } from '../readback-wizard';
import { subscribeWorkflowInvalidation } from '../workflow-invalidation';
import {
  completeForm,
} from "./readback-page.test-fixtures";

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

describe('readback wizard user-task copy', () => {
  it('frames the readback flow as approved action, approval proof, execution evidence, and export', () => {
    const source = readFileSync(new URL('./readback-view.tsx', import.meta.url), 'utf8');

    expect(readbackWizardSteps.map((step) => step.title)).toEqual([
      '1. 选择已批准动作',
      '2. 填写审批凭证',
      '3. 记录执行和回读',
      '4. 校验并导出证据',
    ]);
    expect(transactionPageSource("readback-view.tsx")).toContain('选择已批准动作，保存审批凭证、执行前后截图和刷新后的回读值');
    expect(transactionPageSource("readback-view.tsx")).toContain('先记录执行前值和截图，再记录执行后值和截图，最后刷新广告后台填写回读值和回读截图');
  });

  it('removes duplicate step numbers and does not repeat the workbench title inside the active panel', () => {
    const source = readFileSync(new URL('./readback-view.tsx', import.meta.url), 'utf8');

    expect(readbackStepTabTitle('1. 选择已批准动作')).toBe('选择已批准动作');
    expect(readbackStepTabTitle('4. 校验并导出证据')).toBe('校验并导出证据');
    expect(transactionPageSource("readback-view.tsx")).toContain('<strong>{readbackStepTabTitle(step.title)}</strong>');
    expect(transactionPageSource("readback-view.tsx")).toContain('<section aria-label="审批凭证内容" className="readback-workbench-section">');
    expect(source).not.toContain('<h3 id="readback-approval-title">2. 填写审批凭证</h3>');
    expect(source).not.toContain('<h3 id="readback-verify-title">4. 校验并导出证据</h3>');
  });

  it('runs export and direct verification only through the blocker-derived task action', () => {
    const source = readFileSync(new URL('./readback-view.tsx', import.meta.url), 'utf8');

    expect(transactionPageSource("readback-execution-actions.tsx")).toContain('runReadbackFinalVerificationWorkflow({');
    expect(transactionPageSource("readback-view.tsx")).toContain(': form.recommendationId ? taskBannerAction(primaryRepairAction) : selectApprovedActionTaskAction');
    expect(transactionPageSource("readback-execution-actions.tsx")).toContain("activeActionRef.current = action");
    expect(source).not.toContain('const exportEvidenceButton = readbackActionButtonView({');
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

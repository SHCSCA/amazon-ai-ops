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
  readbackRepairFieldClass,
  readbackPrecheckCopy,
  readbackSessionSummary,
  readbackSessionWorkflow,
  requiredMissing,
  sessionCheckCopy,
} from './readback-page';
import { firstIncompleteReadbackStep } from '../readback-wizard';

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
    expect(stylesheet).toContain('transform: translateX(calc(var(--readback-active-step) * (100% + 10px)))');
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

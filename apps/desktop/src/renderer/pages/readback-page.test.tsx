import { describe, expect, it } from 'vitest';
import {
  EMPTY_FORM,
  buildFillAdReadbackCommand,
  buildFillAdReadbackSessionCommand,
  buildPrepareAdReadbackSessionCommand,
  buildVerifyAdReadbackSessionCommand,
  decisionAgreementLabel,
  decisionSourceLabel,
  formFromRecommendation,
  groupMissing,
  readbackPrecheckCopy,
  readbackSessionWorkflow,
  requiredMissing,
} from './readback-page';

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

    expect(requiredMissing(form, 'batch_1')).not.toContain('来源当前值必须等于 before 值');
  });

  it('allows the source recommended value to differ from the after live value', () => {
    const form = completeForm();
    form.recommendedValue = '1.10';

    expect(requiredMissing(form, 'batch_1')).not.toContain('来源建议值必须等于 after 值');
  });

  it('accepts readback values that numerically match the after value with USD formatting', () => {
    const form = completeForm();
    form.afterValue = '1.08 USD';
    form.readbackActualValue = '$1.08';
    form.recommendedValue = '1.08';

    expect(requiredMissing(form, 'batch_1')).not.toContain('回读值必须等于 after 值');
  });

  it('rejects unchanged before and after values even when their USD formatting differs', () => {
    const form = completeForm();
    form.beforeValue = '$1.08';
    form.afterValue = '1.08 USD';
    form.currentValue = '1.08';
    form.recommendedValue = '1.08';
    form.readbackActualValue = '1.08';

    expect(requiredMissing(form, 'batch_1')).toContain('before/after 值不能相同');
  });

  it('requires lower bid actions to prove the after value is below the before value', () => {
    const form = completeForm();
    form.afterValue = '1.30';
    form.readbackActualValue = '1.30';
    form.recommendedValue = '1.30';

    expect(requiredMissing(form, 'batch_1')).toContain('降价动作必须证明 after 值低于 before 值');
  });

  it('requires before, after, and readback evidence paths to be distinct', () => {
    const form = completeForm();
    form.readbackEvidencePath = form.afterScreenshotPath;

    expect(requiredMissing(form, 'batch_1')).toContain('before/after/readback 证据文件不能复用');
  });
});

describe('groupMissing', () => {
  it('groups every readback verifier-aligned blocker so operators can see the recovery area', () => {
    const blockers = [
      '降价动作必须证明 after 值低于 before 值',
      'before/after/readback 证据文件不能复用',
    ];

    const groupedItems = groupMissing(blockers).flatMap((group) => group.items);

    expect(groupedItems).toEqual(expect.arrayContaining(blockers));
  });
});

describe('readbackPrecheckCopy', () => {
  it('does not claim final field completeness before backend file-existence verification', () => {
    expect(readbackPrecheckCopy([])).toEqual({
      statusLabel: '字段已填写，待导出校验',
      chipLabel: 'before/after/readback 值已填写；导出时会校验本地文件存在。',
      exportButtonLabel: '导出读回证据',
      helperText: '字段已填写时仍需导出 JSON/Markdown，并由后端校验截图、真实报表和回读证据文件是否存在。',
    });
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
  it('explains the operator session packet without claiming final readiness', () => {
    const workflow = readbackSessionWorkflow('C:/evidence/readback.json');

    expect(workflow.sessionDir).toBe('C:/evidence/readback-session');
    expect(workflow.steps.join(' ')).toContain('session-input.json');
    expect(workflow.steps.join(' ')).toContain('screenshots/before');
    expect(workflow.steps.join(' ')).toContain('screenshots/after');
    expect(workflow.steps.join(' ')).toContain('screenshots/readback');
    expect(workflow.warning).toContain('不等于最终验收通过');
    expect(workflow.warning).toContain('manifest 聚合');
    expect(workflow.warning).not.toContain('verify:ad-readback');
  });

  it('does not expose a fake session directory before a readback JSON is exported', () => {
    expect(readbackSessionWorkflow().sessionDir).toBe('导出读回证据 JSON 后自动生成');
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

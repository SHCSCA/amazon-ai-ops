import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { adReadbackEvidenceToMarkdown, buildAdReadbackEvidence, type AdReadbackEvidenceInput } from './ad-readback-evidence';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-readback-'));
  tempDirs.push(dir);
  return dir;
}

function writePng(filePath: string): string {
  fs.writeFileSync(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return filePath;
}

function writeReport(filePath: string): string {
  fs.writeFileSync(filePath, 'placeholder report file for readback source traceability\n', 'utf8');
  return filePath;
}

function completeInput(): AdReadbackEvidenceInput {
  const dir = makeTempDir();
  return {
    authority: {
      recommendationId: 101,
      recommendationRevision: 4,
      recommendationStatusAtExport: 'approved',
      dateFrom: '2026-06-01',
      dateTo: '2026-06-10',
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      asin: 'B0TESTASIN',
      batchId: 'manual_ad_execution_batch',
      checkedAt: '2026-06-10T10:00:30.000Z',
    },
    approval: {
      operatorConfirmed: true,
      realWriteApproved: true,
      scope: 'Approved one low-risk target bid decrease for FT-US-US / US.',
      confirmedAt: '2026-06-10T10:00:00.000Z',
      approverName: 'Ops Owner',
      approvalArtifactPath: 'approval-ticket-123',
      note: 'Approved only for the selected target and metric batch.',
    },
    target: {
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      asin: 'B0TESTASIN',
      campaignName: 'Campaign A',
      adGroupName: 'Ad Group A',
      entityType: 'target',
      entityName: 'close match',
      actionType: 'lower_bid',
    },
    risk: {
      allowedByPolicy: true,
      rationale: 'Small reversible bid decrease on one target.',
    },
    before: {
      value: '2.40',
      capturedAt: '2026-06-10T10:02:00.000Z',
      liveBidSourceNote: 'Read from Ads UI target bid cell before manual change.',
      screenshotPath: writePng(path.join(dir, 'before.png')),
    },
    after: {
      value: '2.16',
      capturedAt: '2026-06-10T10:04:00.000Z',
      screenshotPath: writePng(path.join(dir, 'after.png')),
    },
    readback: {
      verified: true,
      method: 'Ads UI reload target row',
      readAt: '2026-06-10T10:05:00.000Z',
      actualValue: '2.16',
      evidencePath: writePng(path.join(dir, 'readback.png')),
    },
    execution: {
      success: true,
      verified: true,
      executionId: 'manual-ads-ui-123',
      executedAt: '2026-06-10T10:03:00.000Z',
      executedBy: 'operator@example.com',
    },
    source: {
      recommendationId: '101',
      recommendationRevision: 4,
      batchId: 'manual_ad_execution_batch',
      metricDate: '2026-06-10',
      sourceFiles: [writeReport(path.join(dir, 'user_search_term.xlsx'))],
      sourceRow: 12,
      explanationSource: 'ai',
      aiModel: 'deepseek-chat',
      entityType: 'target',
      currentValue: '2.40',
      recommendedValue: '2.16',
      decisionAgreement: 'aligned',
      decisionSource: 'rule_ai',
      decisionReasons: ['AI: Coupon traffic did not convert enough orders.', 'Rule: ACOS crossed target.'],
      decisionRiskWarnings: ['Keep approval and readback before live operation.'],
      aiStrategySource: 'ai',
      aiLifecycleStage: 'keyword_exploration',
      aiStrategySummary: 'Constrain waste while preserving learning traffic.',
      aiMainProblems: ['High ACOS on a target with enough clicks.'],
      aiThresholdSuggestions: {
        targetAcos: { value: 0.35, reason: 'Launch stage target from product margin.' },
      },
      aiStrategyRiskWarnings: ['Do not scale bids during promotion cooldown.'],
      quantStatus: 'waste',
      quantLifecycleStage: 'keyword_exploration',
      quantReasons: ['Spend exceeded minimum with low conversion.'],
      quantThresholds: {
        targetAcos: 0.25,
        highAcosThreshold: 0.5,
      },
      quantReviewRequired: false,
      operationEventCount: 1,
      productContextCount: 1,
      productStage: 'keyword_exploration',
      productTargetAcos: 0.35,
      productTargetTacos: 0.12,
      productTargetNetMargin: 0.22,
      productMinPrice: 29.99,
    },
  };
}

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('ad readback evidence builder', () => {
  it('keeps an empty export as NEEDS_WORK', () => {
    const evidence = buildAdReadbackEvidence({});

    expect(evidence.status).toBe('NEEDS_WORK');
    expect(evidence.realWriteApproved).toBe(false);
    expect(evidence.safety.adWriteActionsPerformed).toBe(false);
    expect(evidence.execution.channel).toBe('manual_ads_ui');
    expect(evidence.execution.appExecutorUsed).toBe(false);
  });

  it('marks complete evidence ready for verifier while preserving manual Ads UI execution boundaries', () => {
    const evidence = buildAdReadbackEvidence(completeInput());

    expect(evidence.status).toBe('PASS');
    expect(evidence.schemaVersion).toBe(2);
    expect(evidence.authority).toMatchObject({
      recommendationId: 101,
      recommendationRevision: 4,
      recommendationStatusAtExport: 'approved',
      batchId: 'manual_ad_execution_batch',
    });
    expect(evidence.realWriteApproved).toBe(true);
    expect(evidence.safety).toMatchObject({
      full8Started: false,
      listingAiDraftOnly: false,
      adWriteActionsPerformed: true,
    });
    expect(evidence.execution).toMatchObject({
      success: true,
      verified: true,
      channel: 'manual_ads_ui',
      performedBy: 'operator@example.com',
      appExecutorUsed: false,
    });
    expect(evidence.approval.note).toBe('Approved only for the selected target and metric batch.');
    expect(evidence.source).toMatchObject({
      recommendationId: '101',
      batchId: 'manual_ad_execution_batch',
      metricDate: '2026-06-10',
      sourceRow: 12,
      explanationSource: 'ai',
      aiModel: 'deepseek-chat',
      decisionAgreement: 'aligned',
      decisionSource: 'rule_ai',
      aiStrategySource: 'ai',
      aiLifecycleStage: 'keyword_exploration',
      quantStatus: 'waste',
      quantLifecycleStage: 'keyword_exploration',
      productStage: 'keyword_exploration',
      productTargetAcos: 0.35,
      productTargetTacos: 0.12,
      productTargetNetMargin: 0.22,
      productMinPrice: 29.99,
    });
    expect(evidence.source.sourceFiles[0]).toMatch(/user_search_term\.xlsx$/);
    expect(evidence.source.decisionReasons).toEqual([
      'AI: Coupon traffic did not convert enough orders.',
      'Rule: ACOS crossed target.',
    ]);
    expect(evidence.source.aiThresholdSuggestions.targetAcos.value).toBe(0.35);
    expect(evidence.source.quantThresholds.targetAcos).toBe(0.25);
    expect(evidence.notes.join('\n')).toContain('No ad write is performed by this export action');
  });

  it('preserves separated AI fallback reasons in readback source evidence and markdown', () => {
    const input = completeInput();
    input.source!.aiStrategyFallbackReason = 'AI 策略诊断 schemaVersion 错误，已回退规则。';
    input.source!.aiActionFallbackReason = 'AI 单条解释无法解析 JSON，使用规则解释。';

    const evidence = buildAdReadbackEvidence(input);
    const markdown = adReadbackEvidenceToMarkdown(evidence, 'readback.json');

    expect(evidence.source.aiStrategyFallbackReason).toBe('AI 策略诊断 schemaVersion 错误，已回退规则。');
    expect(evidence.source.aiActionFallbackReason).toBe('AI 单条解释无法解析 JSON，使用规则解释。');
    expect(markdown).toContain('AI strategy fallback: AI 策略诊断 schemaVersion 错误，已回退规则。');
    expect(markdown).toContain('AI action explanation fallback: AI 单条解释无法解析 JSON，使用规则解释。');
  });

  it('does not mark evidence complete without original report source row', () => {
    const input = completeInput();
    delete input.source?.sourceRow;

    const evidence = buildAdReadbackEvidence(input);

    expect(evidence.status).toBe('NEEDS_WORK');
    expect(evidence.source.sourceRow).toBeNull();
  });

  it('does not mark evidence complete without a product ASIN target binding', () => {
    const input = completeInput();
    input.target!.asin = '';

    const evidence = buildAdReadbackEvidence(input);

    expect(evidence.status).toBe('NEEDS_WORK');
    expect(evidence.target.asin).toBe('');
  });

  it('does not mark evidence complete when original report source row is not positive', () => {
    const input = completeInput();
    input.source!.sourceRow = -1;

    const evidence = buildAdReadbackEvidence(input);

    expect(evidence.status).toBe('NEEDS_WORK');
    expect(evidence.source.sourceRow).toBeNull();
  });

  it('does not mark evidence complete when the source report file is missing', () => {
    const input = completeInput();
    input.source!.sourceFiles = ['C:/reports/missing-user-search-term.xlsx'];

    const evidence = buildAdReadbackEvidence(input);

    expect(evidence.status).toBe('NEEDS_WORK');
    expect(evidence.safety.adWriteActionsPerformed).toBe(false);
  });

  it('does not mark evidence complete when the source file is an audit artifact instead of a spreadsheet report', () => {
    const input = completeInput();
    const dir = makeTempDir();
    const auditPath = path.join(dir, 'acceptance-audit.json');
    fs.writeFileSync(auditPath, '{}\n', 'utf8');
    input.source!.sourceFiles = [auditPath];

    const evidence = buildAdReadbackEvidence(input);

    expect(evidence.status).toBe('NEEDS_WORK');
    expect(evidence.safety.adWriteActionsPerformed).toBe(false);
  });

  it('marks evidence complete when source current value differs from the live before value', () => {
    const input = completeInput();
    input.source!.currentValue = '2.10';

    const evidence = buildAdReadbackEvidence(input);

    expect(evidence.status).toBe('PASS');
    expect(evidence.safety.adWriteActionsPerformed).toBe(true);
  });

  it('marks evidence complete when source recommended value differs from the live after value', () => {
    const input = completeInput();
    input.source!.recommendedValue = '2.00';

    const evidence = buildAdReadbackEvidence(input);

    expect(evidence.status).toBe('PASS');
    expect(evidence.safety.adWriteActionsPerformed).toBe(true);
  });

  it('marks evidence complete when readback actual value numerically matches the after value with USD formatting', () => {
    const input = completeInput();
    input.after!.value = '2.16 USD';
    input.readback!.actualValue = '$2.16';
    input.source!.recommendedValue = '2.16';

    const evidence = buildAdReadbackEvidence(input);

    expect(evidence.status).toBe('PASS');
    expect(evidence.safety.adWriteActionsPerformed).toBe(true);
  });

  it('does not mark evidence complete when before and after values are numerically unchanged with different USD formatting', () => {
    const input = completeInput();
    input.target!.actionType = 'pause_target';
    input.before!.value = '$2.16';
    input.after!.value = '2.16 USD';
    input.source!.currentValue = '2.16';
    input.source!.recommendedValue = '2.16';
    input.readback!.actualValue = '2.16';

    const evidence = buildAdReadbackEvidence(input);

    expect(evidence.status).toBe('NEEDS_WORK');
    expect(evidence.safety.adWriteActionsPerformed).toBe(false);
  });

  it('does not accept recommendation CPC values as live before/after proof', () => {
    const input = completeInput();
    input.source = {
      currentValue: '2.40',
      recommendedValue: '2.16',
    };
    input.before = {
      value: 'FILL: value before write',
      liveBidSourceNote: 'FILL: source note',
      screenshotPath: input.before?.screenshotPath,
    };

    const evidence = buildAdReadbackEvidence(input);

    expect(evidence.status).toBe('NEEDS_WORK');
    expect(evidence.source).toMatchObject({
      currentValue: '2.40',
      recommendedValue: '2.16',
    });
    expect(evidence.before.value).toBe('FILL: value before write');
  });

  it('does not mark evidence complete when explicit timestamps are missing', () => {
    const input = completeInput();
    delete input.before?.capturedAt;

    const evidence = buildAdReadbackEvidence(input);

    expect(evidence.status).toBe('NEEDS_WORK');
    expect(evidence.before.capturedAt).toContain('FILL:');
  });

  it('does not mark evidence complete when before and after screenshots reuse the same file', () => {
    const input = completeInput();
    input.after!.screenshotPath = input.before!.screenshotPath;

    const evidence = buildAdReadbackEvidence(input);

    expect(evidence.status).toBe('NEEDS_WORK');
    expect(evidence.safety.adWriteActionsPerformed).toBe(false);
  });

  it('does not mark evidence complete when readback proof reuses the after screenshot file', () => {
    const input = completeInput();
    input.readback!.evidencePath = input.after!.screenshotPath;

    const evidence = buildAdReadbackEvidence(input);

    expect(evidence.status).toBe('NEEDS_WORK');
    expect(evidence.safety.adWriteActionsPerformed).toBe(false);
  });

  it('does not mark lower_bid evidence complete when the after value is higher than the before value', () => {
    const input = completeInput();
    input.after!.value = '2.60';
    input.readback!.actualValue = '2.60';
    input.source!.recommendedValue = '2.60';

    const evidence = buildAdReadbackEvidence(input);

    expect(evidence.status).toBe('NEEDS_WORK');
    expect(evidence.safety.adWriteActionsPerformed).toBe(false);
  });

  it('renders markdown that points to verifier instead of final readiness', () => {
    const evidence = buildAdReadbackEvidence(completeInput());
    const markdown = adReadbackEvidenceToMarkdown(evidence, 'C:\\evidence\\readback.json');

    expect(markdown).toContain('pnpm run verify:ad-readback');
    expect(markdown).toContain('appExecutorUsed=false');
    expect(markdown).toContain('Source batch: manual_ad_execution_batch');
    expect(markdown).toContain('Source files: ');
    expect(markdown).toContain('user_search_term.xlsx');
    expect(markdown).toContain('Source row: 12');
    expect(markdown).toContain('Source explanation: ai / deepseek-chat');
    expect(markdown).toContain('Product stage: keyword_exploration');
    expect(markdown).toContain('Product targets: ACOS=0.35; TACOS=0.12; netMargin=0.22; minPrice=29.99');
    expect(markdown).toContain('Decision: aligned / rule_ai');
    expect(markdown).toContain('AI strategy: ai / keyword_exploration');
    expect(markdown).toContain('"targetAcos":0.25');
    expect(markdown).toContain('Approval note: Approved only for the selected target and metric batch.');
    expect(markdown).toContain('final acceptance still requires the verifier command above to pass');
  });
});

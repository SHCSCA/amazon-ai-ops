import { describe, expect, it } from 'vitest';
import { buildDeliveryItems, buildManifestActions, findReadbackBlockerGate, packageEvidenceSummary, readbackBlockerSummary } from './delivery-page';

describe('buildManifestActions', () => {
  it('surfaces final readiness review and blocker reasons instead of only generic action items', () => {
    const actions = buildManifestActions({
      available: true,
      path: 'C:/evidence/final-readiness.json',
      exists: true,
      status: 'APP_NEEDS_WORK',
      appReady: false,
      manifestDriven: true,
      gates: [
        {
          name: 'ai-evidence',
          ok: false,
          message: 'AI 候选动作无法绑定当前范围内的真实广告对象。',
        },
      ],
      gatesSummary: { total: 1, passed: 0, failed: 1 },
      missing: ['缺少产品 ASIN。'],
      actionItems: ['补齐真实广告报表 sourceFile/sourceRow。'],
      recommendationReviewReasons: ['AI 阶段判断引用的指标证据缺少产品 ASIN。'],
      reviewBlockers: ['当前范围指标证据缺少真实广告报表 sourceFile/sourceRow。'],
      deliveryReviewReasons: ['交付包缺少最终复核说明。'],
      finalReadinessBlockers: ['AI 候选动作无法绑定当前范围内的真实广告对象。'],
    } as any);

    expect(actions).toContain('补齐真实广告报表 sourceFile/sourceRow。');
    expect(actions).toContain('缺少产品 ASIN。');
    expect(actions).toContain('AI 阶段判断引用的指标证据缺少产品 ASIN。');
    expect(actions).toContain('当前范围指标证据缺少真实广告报表 sourceFile/sourceRow。');
    expect(actions).toContain('交付包缺少最终复核说明。');
    expect(actions.filter((item) => item === 'AI 候选动作无法绑定当前范围内的真实广告对象。')).toHaveLength(1);
  });
});

describe('packageEvidenceSummary', () => {
  it('formats package path and hash without treating missing evidence as ready', () => {
    expect(packageEvidenceSummary(null)).toBe('安装包未记录');
    expect(packageEvidenceSummary({
      installerAvailable: true,
      installerPath: 'C:/release/AmazonAIOpsAgent-1.5.0.exe',
      portablePath: 'C:/release/AmazonAIOpsAgent-1.5.0-portable.exe',
      sha256: 'ABCDEF1234567890',
      latestBuiltAt: '2026-06-17T12:00:00.000Z',
    })).toBe('C:/release/AmazonAIOpsAgent-1.5.0-portable.exe / SHA-256 ABCDEF123456...');
  });
});

describe('readback blocker helpers', () => {
  it('finds the failed readback gate and includes the candidate path in the operator summary', () => {
    const gate = findReadbackBlockerGate({
      available: true,
      path: 'C:/evidence/final-readiness.json',
      exists: true,
      status: 'APP_NEEDS_WORK',
      appReady: false,
      manifestDriven: true,
      gates: [
        {
          name: 'Report collection',
          ok: true,
          message: 'Full 8 report collection passed.',
        },
        {
          name: 'Real ad execution readback',
          ok: false,
          message: 'Current candidate is missing before/after/reload readback proof.',
          evidencePath: 'C:/evidence/real-ad-execution-readback-candidate-rec-4-current.json',
        },
      ],
      gatesSummary: { total: 2, passed: 1, failed: 1 },
    } as any);

    expect(gate?.name).toBe('Real ad execution readback');
    expect(readbackBlockerSummary(gate)).toContain('Current candidate is missing before/after/reload readback proof.');
    expect(readbackBlockerSummary(gate)).toContain('real-ad-execution-readback-candidate-rec-4-current.json');
  });

  it('does not treat passed readback gates as blockers', () => {
    const gate = findReadbackBlockerGate({
      available: true,
      path: 'C:/evidence/final-readiness.json',
      exists: true,
      status: 'APP_READY',
      appReady: true,
      manifestDriven: true,
      gates: [
        {
          name: 'Real ad execution readback',
          ok: true,
          message: 'Readback passed.',
          evidencePath: 'C:/evidence/readback.json',
        },
      ],
      gatesSummary: { total: 1, passed: 1, failed: 0 },
    } as any);

    expect(gate).toBeNull();
    expect(readbackBlockerSummary(gate)).toContain('没有检测到广告回读');
  });
});

describe('buildDeliveryItems', () => {
  it('separates APP_READY manifest from installer package evidence', () => {
    const readiness = {
      available: true,
      path: 'C:/evidence/final-readiness.json',
      exists: true,
      status: 'APP_READY',
      appReady: true,
      manifestDriven: true,
      gates: [],
      gatesSummary: { total: 0, passed: 0, failed: 0 },
    } as any;

    const withoutPackage = buildDeliveryItems(null, readiness, null);
    const blockedPackage = withoutPackage.find((item) => item.title === '安装包');
    expect(blockedPackage?.tone).toBe('pending');
    expect(blockedPackage?.summary).toContain('安装包/hash 还未记录');

    const withPackage = buildDeliveryItems(null, readiness, {
      package: {
        installerAvailable: true,
        installerPath: 'C:/release/AmazonAIOpsAgent-1.5.0.exe',
        portablePath: 'C:/release/AmazonAIOpsAgent-1.5.0-portable.exe',
        sha256: 'ABCDEF123456',
        latestBuiltAt: '2026-06-17T12:00:00.000Z',
      },
    } as any);
    const readyPackage = withPackage.find((item) => item.title === '安装包');

    expect(readyPackage?.tone).toBe('ready');
    expect(readyPackage?.summary).toContain('安装包/hash 已记录');
    expect(readyPackage?.evidence).toContain('安装包：C:/release/AmazonAIOpsAgent-1.5.0.exe');
    expect(readyPackage?.evidence).toContain('免安装版：C:/release/AmazonAIOpsAgent-1.5.0-portable.exe');
    expect(readyPackage?.evidence).toContain('SHA-256：ABCDEF123456');
  });

  it('uses the same readiness blocker reasons in the current blocker card', () => {
    const items = buildDeliveryItems(null, {
      available: true,
      path: 'C:/evidence/final-readiness.json',
      exists: true,
      status: 'APP_NEEDS_WORK',
      appReady: false,
      manifestDriven: true,
      gates: [],
      gatesSummary: { total: 0, passed: 0, failed: 0 },
      missing: [],
      actionItems: [],
      recommendationReviewReasons: ['AI 候选缺少可回查证据引用。'],
      reviewBlockers: ['真实报表 sourceRow 缺失。'],
      deliveryReviewReasons: [],
      finalReadinessBlockers: [],
    } as any);

    const blockerItem = items.find((item) => item.title === '当前阻塞项');

    expect(blockerItem?.actions).toContain('AI 候选缺少可回查证据引用。');
    expect(blockerItem?.actions).toContain('真实报表 sourceRow 缺失。');
  });
});

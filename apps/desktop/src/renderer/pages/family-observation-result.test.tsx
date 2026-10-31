import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { FamilyObservation } from '@amazon-ai-ops/report-parser';
import { FamilyObservationResult } from './family-observation-panel';

const result: FamilyObservation = {
  schemaVersion: 1, provenanceLabel: 'user_confirmed_scope', familyLabel: '合成测试产品',
  confirmationReference: 'synthetic', bindings: [], consumedHashes: [], completeness: 'partial-observation',
  authority: 'campaign-only', nativeAsinAuthority: false, formalEligibility: false, currency: 'unknown',
  attributionWindow: 'unknown', keywordCoverage: 'subset-unknown', days: [{ date: '2026-01-01',
    campaign: { metrics: { impressions: 100, clicks: 5, cost: 8, orders: 1, sales: 20 }, identityStatus: 'labels-only', sourceRows: [] },
    adGroupCrosscheck: null, keywordSubset: null,
    campaignMinusAdGroup: { impressions: null, clicks: null, cost: null, orders: null, sales: null }, reconciliation: 'unknown' }],
};
describe('family observed metric display contract', () => {
  it('renders partial unknown source values without invented currency or totals', () => {
    const html = renderToStaticMarkup(<FamilyObservationResult result={result} />);
    expect(html).toContain('局部观察，不代表完整产品总量');
    expect(html).toContain('币种未知');
    expect(html).toContain('归因窗口未知');
    expect(html).toContain('关键词覆盖未知');
    expect(html).toContain('曝光 未知');
    expect(html).toContain('2026-01-01');
    expect(html).not.toContain('$');
    expect(html).not.toContain('利润');
    expect(html).not.toContain('总计');
  });
  it('surfaces discrepancy and repeated-dimension warnings without completing missing values', () => {
    const day = result.days[0];
    const html = renderToStaticMarkup(<FamilyObservationResult result={{ ...result, days: [{ ...day,
      reconciliation: 'discrepancy', campaignMinusAdGroup: { ...day.campaignMinusAdGroup, cost: 2 },
      keywordSubset: { metrics: { impressions: null, clicks: null, cost: null, orders: null, sales: null }, identityStatus: 'ambiguous-repeated-dimensions', sourceRows: [] },
    }] }} />);
    expect(html).toContain('1 天存在活动与广告组差异');
    expect(html).toContain('花费 2');
    expect(html).toContain('存在重复维度，相关指标保持未知');
    expect(html).toContain('关键词子集');
  });
});

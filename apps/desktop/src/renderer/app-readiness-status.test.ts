import { describe, expect, it } from 'vitest';
import { headerReadinessLabel, headerSessionStatusLabel } from './App';

describe('headerReadinessLabel', () => {
  it('labels final readiness as application package readiness instead of current business delivery', () => {
    expect(headerReadinessLabel({
      appReady: true,
      manifestDriven: true,
    } as any)).toBe('应用包验收通过');
  });
});

describe('headerSessionStatusLabel', () => {
  it('keeps the top bar session text compact while the full detail can live in the tooltip', () => {
    expect(headerSessionStatusLabel({
      erpSessionReused: true,
      adsTitle: 'Amazon Ads Console - Sponsored Products Dashboard',
    })).toBe('ERP/Ads 已连接');
  });

  it('does not show long browser state text before login state is confirmed', () => {
    expect(headerSessionStatusLabel(null)).toBe('会话待确认');
  });
});

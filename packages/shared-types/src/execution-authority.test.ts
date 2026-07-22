import { describe, expect, it } from 'vitest';
import {
  assertCanonicalKeywordIdentity,
  assertOpaqueExecutionArtifactRef,
  isTerminalAdExecutionStatus,
  type CanonicalKeywordIdentity,
} from './execution-authority';

const identity: CanonicalKeywordIdentity = {
  storeId: 'store-one' as CanonicalKeywordIdentity['storeId'],
  marketplace: 'US',
  currency: 'USD',
  adsAccountId: 'ads-account-1',
  campaignId: 'campaign-1',
  adGroupId: 'ad-group-1',
  keywordId: 'keyword-1',
  objectRevision: 2,
};

describe('Stage 6 execution authority contracts', () => {
  it('accepts only the exact US/USD canonical keyword identity', () => {
    expect(() => assertCanonicalKeywordIdentity(identity)).not.toThrow();
    expect(() => assertCanonicalKeywordIdentity({
      ...identity,
      currency: 'CNY',
    } as unknown as CanonicalKeywordIdentity)).toThrow(/US\/USD/i);
    expect(() => assertCanonicalKeywordIdentity({
      ...identity,
      keywordId: '',
    })).toThrow(/keywordId/i);
  });

  it('keeps evidence references opaque and UNKNOWN terminal', () => {
    expect(assertOpaqueExecutionArtifactRef('artifact:execution:before:abc123'))
      .toBe('artifact:execution:before:abc123');
    expect(() => assertOpaqueExecutionArtifactRef('C:\\screenshots\\before.png'))
      .toThrow(/opaque/i);
    expect(() => assertOpaqueExecutionArtifactRef('https://ads.example/path?token=secret'))
      .toThrow(/opaque/i);
    expect(isTerminalAdExecutionStatus('unknown')).toBe(true);
    expect(isTerminalAdExecutionStatus('verifying')).toBe(false);
  });
});

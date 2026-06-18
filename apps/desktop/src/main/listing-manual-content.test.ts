import { describe, expect, it } from 'vitest';
import { buildManualListingVersionSnapshot, normalizeManualListingContent, validateManualListingInput } from './listing-manual-content';

describe('manual listing content', () => {
  it('requires ASIN and at least one meaningful listing field', () => {
    expect(() => validateManualListingInput({ asin: '', title: '', bullets: [], backendTerms: '' })).toThrow('ASIN 必填');
    expect(() => validateManualListingInput({ asin: 'B001', title: '', bullets: [], backendTerms: '' })).toThrow('至少填写标题、五点、详情或后台搜索词中的一项');
  });

  it('normalizes manual listing content for local save', () => {
    const listing = normalizeManualListingContent({
      asin: ' b001 ',
      title: ' Smart Lock ',
      bullets: [' First bullet ', '', 'Second bullet'],
      description: ' Details ',
      backendTerms: 'lock, smart door',
      source: 'manual',
      versionLabel: '2026-06-18 手工录入',
      changeSummary: '补充标题和五点',
    });

    expect(listing).toMatchObject({
      asin: 'B001',
      title: 'Smart Lock',
      bullets: ['First bullet', 'Second bullet'],
      description: 'Details',
      backendTerms: 'lock, smart door',
      source: 'manual',
      versionLabel: '2026-06-18 手工录入',
      changeSummary: '补充标题和五点',
    });
  });

  it('creates a version snapshot from normalized content', () => {
    const snapshot = buildManualListingVersionSnapshot({
      listingContentId: 12,
      listing: {
        asin: ' b001 ',
        title: ' Smart Lock ',
        bullets: [' First bullet ', '', 'Second bullet'],
        description: ' Details ',
        backendTerms: 'lock, smart door',
        source: 'manual',
        versionLabel: '2026-06-18 手工录入',
        changeSummary: '补充标题和五点',
      },
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
    });

    expect(snapshot.versionId).toBe(0);
    expect(snapshot.listingContentId).toBe(12);
    expect(snapshot.asin).toBe('B001');
    expect(snapshot.storeName).toBe('FT-US-US');
    expect(snapshot.marketplaceCode).toBe('US');
    expect(snapshot.bullets).toEqual(['First bullet', 'Second bullet']);
  });
});

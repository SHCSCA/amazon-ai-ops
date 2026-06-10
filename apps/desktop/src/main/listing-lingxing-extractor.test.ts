import { describe, expect, it } from 'vitest';
import { extractLingxingListingFromSnapshot } from './listing-lingxing-extractor';

describe('Lingxing listing extractor', () => {
  it('extracts listing fields from semantic form snapshots', () => {
    const result = extractLingxingListingFromSnapshot({
      url: 'https://erp.lingxing.com/listing/edit?asin=B0ABCDEF12',
      title: 'Listing 编辑 - B0ABCDEF12',
      asinCandidates: ['B0ABCDEF12'],
      fields: [
        { key: 'input-0', label: '商品标题 title', value: 'Cordless Desk Lamp with USB-C' },
        { key: 'textarea-1', label: '五点描述1 bullet point 1', value: 'Rechargeable battery lamp' },
        { key: 'textarea-2', label: '五点描述2 bullet point 2', value: 'Dimmable warm light' },
        { key: 'textarea-3', label: 'Search Terms 后台关键词', value: 'desk lamp rechargeable' },
      ],
      capturedAt: '2026-06-09T00:00:00.000Z',
    });

    expect(result.ready).toBe(true);
    expect(result.partialReady).toBe(true);
    expect(result.fullContentReady).toBe(true);
    expect(result.listing?.asin).toBe('B0ABCDEF12');
    expect(result.listing?.title).toBe('Cordless Desk Lamp with USB-C');
    expect(result.listing?.bullets).toEqual(['Rechargeable battery lamp', 'Dimmable warm light']);
    expect(result.listing?.backendTerms).toBe('desk lamp rechargeable');
    expect(result.evidence.completeness).toEqual({
      asin: true,
      title: true,
      bullets: true,
      backendTerms: true,
    });
  });

  it('does not treat an arbitrary page as Listing evidence', () => {
    const result = extractLingxingListingFromSnapshot({
      url: 'https://erp.lingxing.com/home',
      title: '领星 ERP 首页',
      asinCandidates: [],
      fields: [
        { key: 'input-0', label: '搜索', value: '广告' },
      ],
    });

    expect(result.ready).toBe(false);
    expect(result.partialReady).toBe(false);
    expect(result.fullContentReady).toBe(false);
    expect(result.listing).toBeUndefined();
    expect(result.reason).toContain('未识别到 ASIN 和标题');
  });

  it('can infer ASIN and title from a Lingxing listing table row without treating it as full content', () => {
    const result = extractLingxingListingFromSnapshot({
      url: 'https://erp.lingxing.com/erp/listing',
      title: '领星ERP - 跨境电商管理系统',
      asinCandidates: [],
      fields: [
        { key: 'input-30', label: '标题筛选 title filter', value: 'on' },
        { key: 'asin-cell-0', label: 'ASIN', value: 'B0ABCDEF12' },
        {
          key: 'row-1',
          label: 'listing table row visible text',
          value: [
            'FT-US',
            '美国',
            'FBA',
            'FILTA DECO',
            'D9涂鸦蓝牙版黑色',
            'FT-D9-BK-H01-21',
            '$74.99',
            '在售',
            'B0ABCDEF12',
            '0.00%',
          ].join('\n'),
        },
      ],
    });

    expect(result.ready).toBe(true);
    expect(result.partialReady).toBe(true);
    expect(result.fullContentReady).toBe(false);
    expect(result.listing?.asin).toBe('B0ABCDEF12');
    expect(result.listing?.title).toBe('D9涂鸦蓝牙版黑色');
    expect(result.evidence.completeness).toMatchObject({
      asin: true,
      title: true,
      bullets: false,
      backendTerms: false,
    });
  });
});

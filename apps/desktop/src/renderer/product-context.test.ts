import { describe, expect, it } from 'vitest';
import { countProductsWithTargets, normalizeProductContexts, pickPrimaryProductContext } from './product-context';

describe('product context normalization', () => {
  it('drops empty product rows and keeps cost optional', () => {
    const products = normalizeProductContexts([
      undefined,
      null,
      { asin: '' },
      { asin: ' B001 ', productStage: 'keyword_exploration' },
      { asin: 'B002', cost: { targetAcos: 0.35 } },
    ] as any);

    expect(products).toEqual([
      { asin: 'B001', productStage: 'keyword_exploration' },
      { asin: 'B002', cost: { targetAcos: 0.35 } },
    ]);
  });

  it('counts target-bearing products without throwing when cost is missing', () => {
    expect(countProductsWithTargets([
      { asin: 'B001' },
      undefined,
      { asin: 'B002', cost: { targetTacos: 0.12 } },
    ] as any)).toBe(1);
  });

  it('selects the scoped product when present and otherwise falls back to the first product', () => {
    const products = normalizeProductContexts([
      { asin: 'B001' },
      { asin: 'B002', productStage: 'scaling' },
    ] as any);

    expect(pickPrimaryProductContext(products, 'b002')?.asin).toBe('B002');
    expect(pickPrimaryProductContext(products, '')?.asin).toBe('B001');
  });
});

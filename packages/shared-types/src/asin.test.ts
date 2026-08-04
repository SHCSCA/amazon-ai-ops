import { describe, expect, it } from 'vitest';
import { canonicalizeAmazonAsin, inspectAmazonAsin } from './asin';

describe('Amazon ASIN canonical contract', () => {
  it('canonicalizes valid ten-character Amazon ASINs', () => {
    expect(canonicalizeAmazonAsin(' b0abcd1234 ')).toBe('B0ABCD1234');
    expect(inspectAmazonAsin('b0abcd1234')).toEqual({
      canonical: 'B0ABCD1234',
      valid: true,
    });
  });

  it.each([
    '',
    'B0SHORT01',
    'B0TOOLONG001',
    'B0BAD-0001',
    'B0BAD_0001',
    'Ｂ０ＡＢＣＤ１２３４',
    'ßßßßß',
    'ıııııııııı',
    'ſſſſſſſſſſ',
    1234567890,
  ])('rejects non-Amazon ASIN writes: %j', (value) => {
    expect(() => canonicalizeAmazonAsin(value)).toThrow(
      'ASIN must be exactly 10 ASCII letters or digits',
    );
  });

  it('keeps historical values readable while marking them invalid', () => {
    expect(inspectAmazonAsin(' b0-old_asin ')).toEqual({
      canonical: 'B0-OLD_ASIN',
      valid: false,
    });
    expect(inspectAmazonAsin(null)).toEqual({ canonical: '', valid: false });
  });
});

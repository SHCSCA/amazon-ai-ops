import { describe, expect, it } from 'vitest';
import {
  StoreContractError,
  assertStoreContextEnvelope,
  assertUsStoreIdentity,
  normalizeBrowserProfileId,
  normalizeBusinessDate,
  normalizeSessionGeneration,
  normalizeProviderExternalAccountId,
  normalizeLingxingCollectionStoreName,
  normalizeStoreContextEnvelope,
  normalizeStoreId,
  normalizeUsStoreIdentity,
} from './store';

describe('V1 US store contract', () => {
  it('normalizes logical store identity and US/USD defaults', () => {
    expect(normalizeUsStoreIdentity({
      storeId: ' shc001 ',
      browserProfileId: 'profile-shc001',
    })).toEqual({
      storeId: 'shc001',
      browserProfileId: 'profile-shc001',
      marketplace: 'US',
      currency: 'USD',
    });
  });

  it('rejects filesystem paths as logical ids', () => {
    expect(() => normalizeStoreId('C:\\profiles\\shc001')).toThrow(StoreContractError);
    expect(() => normalizeBrowserProfileId('../profile')).toThrow(StoreContractError);
  });

  it('canonicalizes opaque logical ids to lowercase for Windows path uniqueness', () => {
    expect(normalizeStoreId('Store-SHC001')).toBe('store-shc001');
    expect(normalizeBrowserProfileId('Browser-SHC001')).toBe('browser-shc001');
  });

  it('rejects non-US marketplaces and non-USD currencies', () => {
    expect(() => normalizeUsStoreIdentity({
      storeId: 'shc001',
      browserProfileId: 'profile-shc001',
      marketplace: 'DE',
      currency: 'EUR',
    })).toThrow(/marketplace US only/);
  });

  it('accepts only real ISO business dates', () => {
    expect(normalizeBusinessDate('2026-07-22')).toBe('2026-07-22');
    expect(() => normalizeBusinessDate('2026-02-30')).toThrow(/real date/);
    expect(() => normalizeBusinessDate('2026-7-2')).toThrow(/YYYY-MM-DD/);
  });

  it('accepts only non-negative safe session generations', () => {
    expect(normalizeSessionGeneration(0)).toBe(0);
    expect(normalizeSessionGeneration(12)).toBe(12);
    expect(() => normalizeSessionGeneration(-1)).toThrow(/non-negative safe integer/);
    expect(() => normalizeSessionGeneration('1')).toThrow(/non-negative safe integer/);
  });

  it('normalizes provider external identities with trim, NFKC, and deterministic case folding', () => {
    expect(normalizeProviderExternalAccountId('lingxing', '  Store-ABC  ')).toBe('store-abc');
    expect(normalizeProviderExternalAccountId('lingxing', 'ＳＴＯＲＥ－ＡＢＣ')).toBe('store-abc');
    expect(normalizeProviderExternalAccountId('amazon_ads', ' Profile-123 ')).toBe('profile-123');
    expect(normalizeProviderExternalAccountId('amazon_ads', '   ')).toBeUndefined();
    expect(() => normalizeProviderExternalAccountId('lingxing', 'x'.repeat(257)))
      .toThrow(/at most 256/);
    expect(() => normalizeProviderExternalAccountId('amazon_ads', 'profile\u0000id'))
      .toThrow(/control characters/);
  });

  it('normalizes a Lingxing collection selector separately from stable provider identity', () => {
    expect(normalizeLingxingCollectionStoreName('  ＳＨＣ－美国店  ')).toBe('shc-美国店');
    expect(normalizeLingxingCollectionStoreName('   ')).toBeUndefined();
    expect(() => normalizeLingxingCollectionStoreName('store\u007fname'))
      .toThrow(/control characters/);
  });

  it('normalizes a complete store context without accepting a local path field', () => {
    const context = normalizeStoreContextEnvelope({
      storeId: 'shc001',
      browserProfileId: 'profile-shc001',
      marketplace: 'us',
      currency: 'usd',
      businessTimezone: 'America/Los_Angeles',
      businessDate: '2026-07-22',
      sessionGeneration: 3,
      userDataDir: 'C:\\must-not-cross-ipc',
    });

    expect(context).toEqual({
      storeId: 'shc001',
      browserProfileId: 'profile-shc001',
      marketplace: 'US',
      currency: 'USD',
      businessTimezone: 'America/Los_Angeles',
      businessDate: '2026-07-22',
      sessionGeneration: 3,
    });
    expect(context).not.toHaveProperty('userDataDir');
  });

  it('keeps assertions strict while normalizers may canonicalize', () => {
    expect(() => assertUsStoreIdentity({
      storeId: ' shc001 ',
      browserProfileId: 'profile-shc001',
      marketplace: 'US',
      currency: 'USD',
    })).toThrow(/canonical/);

    expect(() => assertStoreContextEnvelope({
      storeId: 'shc001',
      browserProfileId: 'profile-shc001',
      marketplace: 'US',
      currency: 'USD',
      businessTimezone: ' America/Los_Angeles ',
      businessDate: '2026-07-22',
      sessionGeneration: 3,
    })).toThrow(/canonical IANA/);
  });
});

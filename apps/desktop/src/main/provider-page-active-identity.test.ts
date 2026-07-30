import { describe, expect, it, vi } from 'vitest';
import {
  inspectLingxingProviderPageIdentity,
  type ProviderIdentityPageLike,
} from './provider-page-active-identity';

function page(input: {
  url?: string;
  title?: string;
  bodyText?: string;
  hasLoginInput?: boolean;
  hasPasswordInput?: boolean;
  hasMfaInput?: boolean;
  domObservations?: unknown[];
} = {}): ProviderIdentityPageLike {
  return {
    url: () => input.url ?? 'https://erp.lingxing.com/erp/home',
    title: vi.fn(async () => input.title ?? '领星 ERP'),
    evaluate: vi.fn(async () => ({
      bodyText: input.bodyText ?? '工作台',
      hasLoginInput: input.hasLoginInput ?? false,
      hasPasswordInput: input.hasPasswordInput ?? false,
      hasMfaInput: input.hasMfaInput ?? false,
      domObservations: input.domObservations ?? [
        { probeId: 'active-account-label', value: 'SHC001' },
        { probeId: 'current-seller-id', value: 'seller-001' },
      ],
    })) as ProviderIdentityPageLike['evaluate'],
  };
}

const connection = {
  provider: 'lingxing' as const,
  accountLabel: 'SHC001',
  externalAccountId: 'seller-001',
};

describe('inspectLingxingProviderPageIdentity', () => {
  it('verifies the current visible ERP page from bounded live DOM observations', async () => {
    const currentPage = page();
    const result = await inspectLingxingProviderPageIdentity({
      page: currentPage,
      connection,
      mode: 'collection_only',
    });

    expect(result).toMatchObject({
      status: 'ready',
      pageUrl: 'https://erp.lingxing.com/erp/home',
    });
    expect(currentPage.evaluate).toHaveBeenCalledOnce();
    expect(Object.isFrozen(result.domObservations)).toBe(true);
  });

  it.each([
    [
      'login_required',
      page({
        url: 'https://erp.lingxing.com/login',
        bodyText: '账号登录',
        hasLoginInput: true,
        hasPasswordInput: true,
        domObservations: [],
      }),
    ],
    [
      'mfa_required',
      page({
        bodyText: '请输入安全验证码',
        hasMfaInput: true,
        domObservations: [],
      }),
    ],
    [
      'identity_unverified',
      page({
        domObservations: [],
      }),
    ],
    [
      'identity_unverified',
      page({
        url: 'https://example.invalid/erp/home',
        domObservations: [{ probeId: 'active-account-label', value: 'SHC001' }],
      }),
    ],
  ] as const)('classifies %s without using stored session metadata', async (status, currentPage) => {
    await expect(inspectLingxingProviderPageIdentity({
      page: currentPage,
      connection,
      mode: 'collection_only',
    })).resolves.toMatchObject({ status });
  });

  it('forbids credential submission in collection-only mode', async () => {
    await expect(inspectLingxingProviderPageIdentity({
      page: page(),
      connection,
      mode: 'collection_only',
      credentialSubmission: {
        credentialSource: 'saved',
        credentialsSubmitted: false,
        username: 'SHC001',
      },
    })).rejects.toThrow(/forbids credential submission/);
  });

  it.each([
    [[
      { probeId: 'active-account-label', value: 'SHC001' },
    ]],
    [[
      { probeId: 'active-account-label', value: 'SHC001' },
      { probeId: 'current-seller-id', value: 'seller-OTHER' },
    ]],
  ])('does not let a matching label replace exact configured seller-id evidence', async (domObservations) => {
    await expect(inspectLingxingProviderPageIdentity({
      page: page({ domObservations }),
      connection,
      mode: 'collection_only',
    })).resolves.toMatchObject({ status: 'identity_unverified' });
  });

  it('does not accept a label-only connection without exact seller/store-id evidence', async () => {
    await expect(inspectLingxingProviderPageIdentity({
      page: page({
        domObservations: [
          { probeId: 'active-account-label', value: 'SHC001' },
        ],
      }),
      connection: {
        provider: 'lingxing',
        accountLabel: 'SHC001',
      },
      mode: 'collection_only',
    })).resolves.toMatchObject({ status: 'identity_unverified' });
  });

  it('rejects unbounded DOM payloads instead of truncating attacker-controlled output', async () => {
    await expect(inspectLingxingProviderPageIdentity({
      page: page({
        domObservations: Array.from({ length: 25 }, (_, index) => ({
          probeId: `probe-${index}`,
          value: 'SHC001',
        })),
      }),
      connection,
      mode: 'collection_only',
    })).rejects.toThrow(/bounded contract/);
    await expect(inspectLingxingProviderPageIdentity({
      page: page({
        domObservations: [{
          probeId: 'active-account-label',
          value: 'x'.repeat(257),
        }],
      }),
      connection,
      mode: 'collection_only',
    })).rejects.toThrow(/bounded contract/);
  });

  it('does not accept an Amazon Ads connection in the ERP-only helper', async () => {
    await expect(inspectLingxingProviderPageIdentity({
      page: page(),
      connection: { provider: 'amazon_ads', accountLabel: 'SHC001' },
      mode: 'collection_only',
    })).rejects.toThrow(/Lingxing ERP only/);
  });

  it('fails closed when the visible page navigates during the bounded observation', async () => {
    let currentUrl = 'https://erp.lingxing.com/erp/home';
    const navigatingPage: ProviderIdentityPageLike = {
      url: () => currentUrl,
      title: async () => 'ERP',
      evaluate: (async () => {
        currentUrl = 'https://erp.lingxing.com/erp/other';
        return {
          bodyText: '工作台',
          hasLoginInput: false,
          hasPasswordInput: false,
          hasMfaInput: false,
          domObservations: [{ probeId: 'active-account-label', value: 'SHC001' }],
        };
      }) as ProviderIdentityPageLike['evaluate'],
    };

    await expect(inspectLingxingProviderPageIdentity({
      page: navigatingPage,
      connection,
      mode: 'collection_only',
    })).resolves.toMatchObject({ status: 'identity_unverified' });
  });
});

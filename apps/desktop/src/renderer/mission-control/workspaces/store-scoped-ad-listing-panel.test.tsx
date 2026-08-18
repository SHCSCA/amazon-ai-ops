import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import {
  ListingRowActions,
  StoreListingVersionLedgerDialog,
  ListingVersionHistoryDialog,
  StoreScopedAdObjectsPanel,
  StoreScopedKeywordFactsPanel,
  StoreScopedListingContentPanel,
  buildListingCreateInput,
  buildListingUpdateInput,
  buildListingVersionHistoryInput,
  buildStoreListingVersionLedgerInput,
  listingVersionResponseIsCurrent,
  readListingVersionHistoryForTarget,
  readStoreListingVersionLedgerPage,
  storeResultBelongsToContext,
  storeListingVersionBelongsToContext,
  type ListingContentDraft,
  type StoreListingContentVersionView,
  type StoreListingContentView,
} from './store-scoped-ad-listing-panel';

const context = {
  storeId: 'store-one',
  browserProfileId: 'profile-one',
  marketplace: 'US',
  currency: 'USD',
  businessTimezone: 'America/Los_Angeles',
  businessDate: '2026-07-22',
  sessionGeneration: 6,
} as StoreContextEnvelope;

const listing = {
  id: 12,
  storeId: context.storeId,
  storeName: 'SHC001',
  marketplace: 'US',
  currency: 'USD',
  asin: 'B0LIST0001',
  asinValid: true,
  title: 'Current title',
  bullets: ['First bullet'],
  description: 'Current description',
  aPlus: '',
  imageCopy: '',
  backendTerms: 'smart lock',
  source: 'manual',
  versionLabel: 'v1',
  changeSummary: '',
  createdAt: '2026-07-22 00:00:00.000',
  updatedAt: '2026-07-22 00:00:00.000',
  revision: 'listing-content-v1:abc',
} as StoreListingContentView;

const draft: ListingContentDraft = {
  asin: ' b0list0001 ',
  title: ' Updated title ',
  bulletsText: ' First bullet \n\n Second bullet ',
  description: ' Updated description ',
  aPlus: ' A+ copy ',
  imageCopy: ' Image copy ',
  backendTerms: ' smart lock outdoor ',
  source: 'manual',
  versionLabel: ' v2 ',
  changeSummary: ' Reviewed by operator ',
};

const versions: StoreListingContentVersionView[] = [
  {
    id: 102,
    listingContentId: listing.id,
    storeId: context.storeId,
    asin: listing.asin,
    title: 'Version two title',
    bullets: ['Version two bullet', 'Second value point'],
    description: 'Version two description',
    aPlus: '',
    imageCopy: '',
    backendTerms: 'version two search terms',
    source: 'manual',
    versionLabel: 'v2',
    changeSummary: 'Operator refined title and search terms',
    createdAt: '2026-07-22 02:00:00.000',
  },
  {
    id: 101,
    listingContentId: listing.id,
    storeId: context.storeId,
    asin: listing.asin,
    title: 'Version one title',
    bullets: ['Version one bullet'],
    description: '',
    aPlus: '',
    imageCopy: '',
    backendTerms: 'version one search terms',
    source: 'lingxing',
    versionLabel: 'v1',
    changeSummary: 'Initial Lingxing snapshot',
    createdAt: '2026-07-22 01:00:00.000',
  },
];

describe('store-scoped ad/listing panels', () => {
  it('renders distinct production surfaces for ad objects, keyword facts, and Listing CRUD', () => {
    const adMarkup = renderToStaticMarkup(<StoreScopedAdObjectsPanel storeContext={context} />);
    const keywordMarkup = renderToStaticMarkup(<StoreScopedKeywordFactsPanel storeContext={context} />);
    const listingMarkup = renderToStaticMarkup(<StoreScopedListingContentPanel storeContext={context} />);

    expect(adMarkup).toContain('广告对象事实');
    expect(adMarkup).toContain('广告活动');
    expect(adMarkup).not.toContain('Campaign');
    expect(adMarkup).toContain('Amazon US · USD · 只读事实');
    expect(keywordMarkup).toContain('关键词事实与机会');
    expect(keywordMarkup).toContain('指标与机会合并');
    expect(listingMarkup).toContain('Listing 内容库');
    expect(listingMarkup).toContain('新建 Listing');
    expect(listingMarkup).toContain('查看当前店铺 Listing 版本账本');
    expect(listingMarkup).toContain('本地内容库');
    expect(listingMarkup).not.toContain('自动发布');
  });

  it('fails every surface closed without a fully confirmed current store', () => {
    for (const markup of [
      renderToStaticMarkup(<StoreScopedAdObjectsPanel storeContext={null} />),
      renderToStaticMarkup(<StoreScopedKeywordFactsPanel storeContext={null} />),
      renderToStaticMarkup(<StoreScopedListingContentPanel storeContext={null} />),
    ]) {
      expect(markup).toContain('当前店铺尚未确认');
      expect(markup).not.toMatch(/Main|StoreContext|Authority|Renderer|Profile/);
      expect(markup).not.toContain('新建 Listing');
      expect(markup).not.toContain('执行成功');
    }
  });

  it('builds normalized US/USD Listing creates without local paths', () => {
    expect(buildListingCreateInput(draft)).toEqual({
      asin: 'B0LIST0001',
      title: 'Updated title',
      bullets: ['First bullet', 'Second bullet'],
      description: 'Updated description',
      aPlus: 'A+ copy',
      imageCopy: 'Image copy',
      backendTerms: 'smart lock outdoor',
      source: 'manual',
      versionLabel: 'v2',
      changeSummary: 'Reviewed by operator',
      marketplace: 'US',
      currency: 'USD',
    });
    expect(buildListingCreateInput(draft)).not.toHaveProperty('screenshotPath');
    expect(buildListingCreateInput(draft)).not.toHaveProperty('sourceUrl');
  });

  it('locks Listing updates to the displayed content revision and immutable ASIN', () => {
    const update = buildListingUpdateInput(listing, draft);
    expect(update).toMatchObject({
      id: 12,
      expectedRevision: 'listing-content-v1:abc',
      patch: {
        title: 'Updated title',
        bullets: ['First bullet', 'Second bullet'],
        marketplace: 'US',
        currency: 'USD',
      },
    });
    expect(update.patch).not.toHaveProperty('asin');
    expect(update).not.toHaveProperty('expectedUpdatedAt');
  });

  it('rejects non-canonical ASINs before a Listing create reaches Main', () => {
    expect(() => buildListingCreateInput({ ...draft, asin: 'B001' }))
      .toThrow(/exactly 10 ASCII/i);
  });

  it('rejects cross-store and non-USD results before renderer state can accept them', () => {
    expect(storeResultBelongsToContext(listing, context)).toBe(true);
    expect(storeResultBelongsToContext({ ...listing, storeId: 'store-two' }, context)).toBe(false);
    expect(storeResultBelongsToContext({ ...listing, currency: 'USDT' }, context)).toBe(false);
    expect(storeResultBelongsToContext({ ...listing, marketplace: 'CA' }, context)).toBe(false);
  });

  it('keeps historical invalid ASIN rows visibly read-only while preserving version inspection', () => {
    const invalid = { ...listing, asin: 'LEGACY-ASIN', asinValid: false };
    const markup = renderToStaticMarkup(
      <ListingRowActions
        onDelete={() => undefined}
        onEdit={() => undefined}
        onHistory={() => undefined}
        pending={false}
        row={invalid}
      />,
    );

    expect(markup).toMatch(/aria-label="查看 LEGACY-ASIN 版本历史"(?![^>]*disabled)/);
    expect(markup).toMatch(/aria-label="编辑 LEGACY-ASIN"[^>]*disabled/);
    expect(markup).toMatch(/aria-label="删除 LEGACY-ASIN"[^>]*disabled/);
    expect(markup).toContain('历史 ASIN 无效，仅供对账，禁止删除');
    expect(markup).toContain('非法 ASIN · 只读');
  });

  it('routes an invalid-ASIN history click through durable listingContentId without ASIN normalization', async () => {
    const invalid = { ...listing, asin: 'LEGACY-ASIN', asinValid: false };
    const legacyVersion = {
      ...versions[0]!,
      listingContentId: invalid.id,
      asin: invalid.asin,
    };
    const listVersions = vi.fn(async (
      _context: StoreContextEnvelope,
      _input?: { listingContentId?: number; asin?: string; limit?: number; offset?: number },
    ) => [legacyVersion]);
    let loaded: StoreListingContentVersionView[] = [];
    const onHistory = vi.fn(async () => {
      loaded = await readListingVersionHistoryForTarget(listVersions, context, invalid);
    });
    const actions = ListingRowActions({
      row: invalid,
      pending: false,
      onHistory,
      onEdit: () => undefined,
      onDelete: () => undefined,
    });
    const historyButton = React.Children.toArray(actions.props.children)
      .find((child) => React.isValidElement(child)
        && child.props['aria-label'] === '查看 LEGACY-ASIN 版本历史') as React.ReactElement<{
          onClick(): Promise<void>;
        }>;

    await historyButton.props.onClick();

    expect(onHistory).toHaveBeenCalledTimes(1);
    expect(listVersions).toHaveBeenCalledWith(context, {
      listingContentId: invalid.id,
      limit: 100,
      offset: 0,
    });
    expect(listVersions.mock.calls[0]?.[1]).not.toHaveProperty('asin');
    expect(loaded).toEqual([legacyVersion]);
    expect(buildListingVersionHistoryInput(invalid)).not.toHaveProperty('asin');
  });

  it('renders a selectable version ledger with version, time, source, summary, and content snapshot', () => {
    const markup = renderToStaticMarkup(
      <ListingVersionHistoryDialog
        error={null}
        loading={false}
        onClose={() => undefined}
        onRetry={() => undefined}
        onSelect={() => undefined}
        rows={versions}
        selectedId={101}
        target={listing}
      />,
    );

    expect(markup).toContain('B0LIST0001 版本历史');
    expect(markup).toContain('当前店铺 · Amazon US · USD');
    expect(markup).not.toContain('store-one · Amazon US · USD');
    expect(markup).toContain('v2');
    expect(markup).toContain('2026-07-22 02:00:00.000 · 人工录入');
    expect(markup).toContain('Operator refined title and search terms');
    expect(markup).toContain('2026-07-22 01:00:00.000 · 领星读取');
    expect(markup).toContain('Version one title');
    expect(markup).toContain('Version one bullet');
    expect(markup).toContain('version one search terms');
    expect(markup).not.toContain('Version two description');
  });

  it('renders explicit loading, error/retry, and empty states for version history', () => {
    const props = {
      onClose: () => undefined,
      onRetry: () => undefined,
      onSelect: () => undefined,
      selectedId: null,
      target: listing,
    };
    const loading = renderToStaticMarkup(
      <ListingVersionHistoryDialog {...props} error={null} loading rows={[]} />,
    );
    const failed = renderToStaticMarkup(
      <ListingVersionHistoryDialog {...props} error="Main unavailable" loading={false} rows={[]} />,
    );
    const empty = renderToStaticMarkup(
      <ListingVersionHistoryDialog {...props} error={null} loading={false} rows={[]} />,
    );

    expect(loading).toContain('正在读取当前店铺的 Listing 版本历史');
    expect(failed).toContain('版本历史读取失败');
    expect(failed).toContain('请刷新后重试');
    expect(failed).not.toContain('Main unavailable');
    expect(failed).toContain('重试');
    expect(empty).toContain('当前 Listing 尚无已保存的历史快照');
  });

  it('exposes a store-level paged version ledger where deleted Listing snapshots remain reachable', async () => {
    const deletedListingVersions = versions.map((row) => ({ ...row, listingContentId: 412 }));
    const listVersions = vi.fn(async (
      _context: StoreContextEnvelope,
      _input?: { listingContentId?: number; asin?: string; limit?: number; offset?: number },
    ) => deletedListingVersions);

    expect(await readStoreListingVersionLedgerPage(listVersions, context, 100))
      .toEqual(deletedListingVersions);
    expect(listVersions).toHaveBeenCalledWith(context, {
      limit: 100,
      offset: 100,
    });
    expect(buildStoreListingVersionLedgerInput(200)).toEqual({ limit: 100, offset: 200 });

    const markup = renderToStaticMarkup(
      <StoreListingVersionLedgerDialog
        error={null}
        hasMore
        loading={false}
        loadingMore={false}
        onClose={() => undefined}
        onLoadMore={() => undefined}
        onRetry={() => undefined}
        onSelect={() => undefined}
        rows={deletedListingVersions}
        selectedId={deletedListingVersions[0]!.id}
        storeContext={context}
      />,
    );
    expect(markup).toContain('当前店铺 Listing 版本账本');
    expect(markup).toContain('已删除 Listing 的历史快照也会保留在这里');
    expect(markup).toContain('已关联历史版本');
    expect(markup).not.toContain('Listing #412');
    expect(markup).toContain('加载更多历史');
  });

  it('rejects cross-store/cross-listing version rows and stale store-switch responses', () => {
    expect(storeListingVersionBelongsToContext(versions[0]!, context, listing)).toBe(true);
    expect(storeListingVersionBelongsToContext(
      { ...versions[0]!, storeId: 'store-two' as StoreContextEnvelope['storeId'] },
      context,
      listing,
    )).toBe(false);
    expect(storeListingVersionBelongsToContext(
      { ...versions[0]!, listingContentId: listing.id + 1 },
      context,
      listing,
    )).toBe(false);
    expect(storeListingVersionBelongsToContext(
      { ...versions[0]!, asin: 'B0OTHER001' },
      context,
      listing,
    )).toBe(false);

    expect(listingVersionResponseIsCurrent(7, 7, 'store-one:6', 'store-one:6')).toBe(true);
    expect(listingVersionResponseIsCurrent(7, 8, 'store-one:6', 'store-one:6')).toBe(false);
    expect(listingVersionResponseIsCurrent(7, 7, 'store-one:6', 'store-two:1')).toBe(false);
  });
});

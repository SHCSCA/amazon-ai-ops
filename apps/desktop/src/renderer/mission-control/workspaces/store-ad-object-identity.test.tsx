import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import { normalizeStoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { StoreAdObjectIdentity } from './store-ad-object-identity';
import type { StoreAdObjectFactView } from './store-scoped-ad-listing-contracts';

const context = normalizeStoreContextEnvelope({ storeId: 'store-a', browserProfileId: 'profile-a', sessionGeneration: 1, marketplace: 'US', currency: 'USD', businessTimezone: 'America/Los_Angeles', businessDate: '2026-10-16' });
function row(overrides: Partial<StoreAdObjectFactView> = {}): StoreAdObjectFactView {
  return { storeId: context.storeId, marketplace: 'US', currency: 'USD', kind: 'target', objectKey: 'fact-private-key-a', entityId: 'internal-entity-a', resolved: true, nonExecutable: false, name: '同名关键词', campaignName: '活动甲', adGroupName: '广告组甲', impressions: 30, clicks: 4, spend: 3, orders: 1, sales: 12, acos: 0.25, cpc: 0.75, cvr: 0.25, sourceRowCount: 1, sourceFileCount: 1, reportTypeCount: 1, ...overrides };
}
const markup = (fact: StoreAdObjectFactView) => renderToStaticMarkup(<StoreAdObjectIdentity row={fact} />);
const ordinaryCopy = (value: string) => value.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, '');

describe('readable current-store advertising object identity', () => {
  it('shows explicit campaign and ad-group names while keeping internal keys inside a closed disclosure', () => {
    const html = markup(row());
    expect(ordinaryCopy(html)).toContain('同名关键词');
    expect(ordinaryCopy(html)).toContain('广告活动：活动甲');
    expect(ordinaryCopy(html)).toContain('广告组：广告组甲');
    expect(ordinaryCopy(html)).not.toContain('internal-entity-a');
    expect(ordinaryCopy(html)).not.toContain('fact-private-key-a');
    expect(html).toContain('<summary>查看内部标识</summary>');
    expect(html).not.toMatch(/<details[^>]*\bopen\b/);
    expect(html).toContain('对象已唯一识别，可用于受控动作');
  });
  it('keeps both levels readable when the campaign and ad-group have identical names', () => {
    const html = ordinaryCopy(markup(row({ campaignName: '相同名称', adGroupName: '相同名称' })));
    expect(html).toContain('广告活动：相同名称');
    expect(html).toContain('广告组：相同名称');
  });
  it('distinguishes equal object names by their actual campaign and ad-group path without treating names as authority', () => {
    const first = ordinaryCopy(markup(row()));
    const second = ordinaryCopy(markup(row({ objectKey: 'fact-private-key-b', entityId: 'internal-entity-b', campaignName: '活动乙', adGroupName: '广告组乙', resolved: false, nonExecutable: true })));
    expect(first).toContain('广告活动：活动甲'); expect(second).toContain('广告活动：活动乙');
    expect(first).toContain('广告组：广告组甲'); expect(second).toContain('广告组：广告组乙');
    expect(second).toContain('对象尚未唯一识别，不可执行');
    expect(second).not.toContain('可用于受控动作');
  });
  it('does not substitute an opaque entity key for a missing business name or parent context', () => {
    const html = ordinaryCopy(markup(row({ name: 'internal-entity-a', campaignName: '', adGroupName: '', resolved: false, nonExecutable: true })));
    expect(html).toContain('未命名关键词或投放');
    expect(html).toContain('广告活动：未提供'); expect(html).toContain('广告组：未提供');
    expect(html).not.toContain('internal-entity-a');
    const campaign = ordinaryCopy(markup(row({ kind: 'campaign', name: '实际活动', campaignName: '', adGroupName: '' })));
    expect(campaign).toContain('广告活动：实际活动'); expect(campaign).toContain('广告组：不适用');
  });
  it('hides each exact internal ID in the actual DOM until its own native details control is opened', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(`<article>${markup(row())}</article><article>${markup(row({ entityId: 'internal-entity-b', objectKey: 'fact-private-key-b', campaignName: '活动乙' }))}</article>`);
      const first = page.locator('article').nth(0), second = page.locator('article').nth(1);
      expect(await first.getByText('广告活动：活动甲 · 广告组：广告组甲', { exact: true }).isVisible()).toBe(true);
      expect(await first.getByText('internal-entity-a', { exact: true }).isVisible()).toBe(false);
      expect(await second.getByText('internal-entity-b', { exact: true }).isVisible()).toBe(false);
      await first.getByText('查看内部标识', { exact: true }).focus();
      await page.keyboard.press('Enter');
      expect(await first.getByText('internal-entity-a', { exact: true }).isVisible()).toBe(true);
      expect(await first.getByText('fact-private-key-a', { exact: true }).isVisible()).toBe(true);
      expect(await second.getByText('internal-entity-b', { exact: true }).isVisible()).toBe(false);
      await page.keyboard.press('Enter');
      expect(await first.getByText('internal-entity-a', { exact: true }).isVisible()).toBe(false);
    } finally { await browser.close(); }
  }, 20_000);
});

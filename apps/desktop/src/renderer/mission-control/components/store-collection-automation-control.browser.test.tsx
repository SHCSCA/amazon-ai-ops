import type { Page } from 'playwright';
import { describe, expect, it, vi } from 'vitest';
import { withAutomationControlFixture } from './store-collection-automation-control.test-support';

const toggle = (page: Page) => page.getByRole('button', { name: '当前店铺自动采集', exact: true });

describe('isolated production store collection automation control', () => {
  it('mounts the persistent control in the existing runtime settings panel', async () => {
    await withAutomationControlFixture({ surface: 'panel' }, async page => {
      await vi.waitFor(async () => { expect(await page.getByRole('heading', { name: '店铺运行配置', exact: true }).isVisible()).toBe(true); }, { timeout: 5_000 });
      await vi.waitFor(async () => { expect(await toggle(page).isVisible()).toBe(true); }, { timeout: 5_000 });
      await vi.waitFor(async () => { expect(await toggle(page).getAttribute('aria-pressed')).toBe('true'); }, { timeout: 5_000 });
      expect(await page.evaluate(() => (window as any).automationFixture.writes.length)).toBe(0);
    });
  }, 30_000);

  it('keeps unresolved and failed reads disabled without inventing an enabled default', async () => {
    await withAutomationControlFixture({ deferReads: true }, async page => {
      await vi.waitFor(async () => { expect(await toggle(page).isDisabled()).toBe(true); }, { timeout: 5_000 });
      await vi.waitFor(async () => { expect(await toggle(page).getAttribute('aria-pressed')).not.toBe('true'); }, { timeout: 5_000 });
      await vi.waitFor(async () => { expect(await page.getByText('自动采集已启用', { exact: true }).count()).toBe(0); }, { timeout: 5_000 });
      await vi.waitFor(async () => { expect(await page.evaluate(() => (window as any).automationFixture.reads.length)).toBe(1); }, { timeout: 5_000 });
      await page.evaluate(() => (window as any).automationFixture.finishRead(0, { error: true }));
      await vi.waitFor(async () => { expect(await page.getByRole('alert').isVisible()).toBe(true); }, { timeout: 5_000 });
      await vi.waitFor(async () => { expect(await toggle(page).isDisabled()).toBe(true); }, { timeout: 5_000 });
      expect(await page.evaluate(() => (window as any).automationFixture.writes.length)).toBe(0);
      expect(await page.evaluate(() => (window as any).automationFixture.logs.map((x: any) => x.event))).toContain('renderer.store_collection_automation_load_failed');
    });
  }, 30_000);

  it('persists false through CAS, prevents duplicate writes, and reads false after remount', async () => {
    await withAutomationControlFixture({}, async page => {
      await vi.waitFor(async () => { expect(await toggle(page).getAttribute('aria-pressed')).toBe('true'); }, { timeout: 5_000 });
      await toggle(page).evaluate(button => {
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await vi.waitFor(async () => { expect(await toggle(page).getAttribute('aria-busy')).toBe('true'); }, { timeout: 5_000 });
      expect(await page.evaluate(() => (window as any).automationFixture.writes.map((x: any) => x.input))).toEqual([
        { expectedRevision: 0, automaticCollectionEnabled: false },
      ]);
      await page.evaluate(() => (window as any).automationFixture.finishWrite(0));
      await vi.waitFor(async () => { expect(await toggle(page).getAttribute('aria-pressed')).toBe('false'); }, { timeout: 5_000 });
      await vi.waitFor(async () => { expect(await toggle(page).isEnabled()).toBe(true); }, { timeout: 5_000 });
      await page.evaluate(() => (window as any).automationFixture.remount());
      await vi.waitFor(async () => { expect(await page.evaluate(() => (window as any).automationFixture.reads.length)).toBe(2); }, { timeout: 5_000 });
      await vi.waitFor(async () => { expect(await toggle(page).getAttribute('aria-pressed')).toBe('false'); }, { timeout: 5_000 });
      expect(await page.evaluate(() => (window as any).automationFixture.writes.length)).toBe(1);
    });
  }, 30_000);

  it('clears uncertain state and busy after a rejected setter until an explicit reread', async () => {
    await withAutomationControlFixture({}, async page => {
      await vi.waitFor(async () => { expect(await toggle(page).getAttribute('aria-pressed')).toBe('true'); }, { timeout: 5_000 });
      await toggle(page).click();
      await vi.waitFor(async () => { expect(await toggle(page).getAttribute('aria-busy')).toBe('true'); }, { timeout: 5_000 });
      await page.evaluate(() => (window as any).automationFixture.finishWrite(0, { error: true }));
      await vi.waitFor(async () => { expect(await page.getByRole('alert').isVisible()).toBe(true); }, { timeout: 5_000 });
      await vi.waitFor(async () => { expect(await toggle(page).getAttribute('aria-pressed')).toBeNull(); }, { timeout: 5_000 });
      await vi.waitFor(async () => { expect(await toggle(page).getAttribute('aria-busy')).toBeNull(); }, { timeout: 5_000 });
      await vi.waitFor(async () => { expect(await toggle(page).isDisabled()).toBe(true); }, { timeout: 5_000 });
      await page.getByRole('button', { name: '重新读取自动采集状态', exact: true }).click();
      await vi.waitFor(async () => { expect(await toggle(page).getAttribute('aria-pressed')).toBe('true'); }, { timeout: 5_000 });
      await vi.waitFor(async () => { expect(await toggle(page).isEnabled()).toBe(true); }, { timeout: 5_000 });
      expect(await page.evaluate(() => (window as any).automationFixture.logs.map((x: any) => x.event))).toContain('renderer.store_collection_automation_set_failed');
    });
  }, 30_000);

  it('discards late get responses across an exact A to B to A context round trip', async () => {
    await withAutomationControlFixture({ deferReads: true }, async page => {
      await vi.waitFor(async () => { expect(await page.evaluate(() => (window as any).automationFixture.reads.length)).toBe(1); }, { timeout: 5_000 });
      await page.evaluate(() => (window as any).automationFixture.setStore('store-b'));
      await vi.waitFor(async () => { expect(await page.evaluate(() => (window as any).automationFixture.reads.length)).toBe(2); }, { timeout: 5_000 });
      await page.evaluate(() => (window as any).automationFixture.setStore('store-a'));
      await vi.waitFor(async () => { expect(await page.evaluate(() => (window as any).automationFixture.reads.length)).toBe(3); }, { timeout: 5_000 });
      await page.evaluate(() => (window as any).automationFixture.finishRead(2));
      await vi.waitFor(async () => { expect(await toggle(page).getAttribute('aria-pressed')).toBe('true'); }, { timeout: 5_000 });
      await page.evaluate(() => (window as any).automationFixture.finishRead(0, { patch: {
        automaticCollectionEnabled: false, source: 'explicit-override', revision: 1, updatedAt: '2026-10-22T06:00:00.000Z',
      } }));
      await page.evaluate(() => (window as any).automationFixture.finishRead(1, { error: true }));
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await vi.waitFor(async () => { expect(await toggle(page).getAttribute('aria-pressed')).toBe('true'); }, { timeout: 5_000 });
      await vi.waitFor(async () => { expect(await page.getByRole('alert').count()).toBe(0); }, { timeout: 5_000 });
    });
  }, 30_000);

  it('keeps the new A mutation busy when an old A rejection and finally arrive after A B A', async () => {
    await withAutomationControlFixture({}, async page => {
      await vi.waitFor(async () => { expect(await toggle(page).getAttribute('aria-pressed')).toBe('true'); }, { timeout: 5_000 });
      await toggle(page).click();
      await vi.waitFor(async () => { expect(await page.evaluate(() => (window as any).automationFixture.writes.length)).toBe(1); }, { timeout: 5_000 });
      await page.evaluate(() => (window as any).automationFixture.setStore('store-b'));
      await vi.waitFor(async () => { expect(await page.evaluate(() => (window as any).automationFixture.reads.length)).toBe(2); }, { timeout: 5_000 });
      await vi.waitFor(async () => { expect(await toggle(page).isEnabled()).toBe(true); }, { timeout: 5_000 });
      await page.evaluate(() => (window as any).automationFixture.setStore('store-a'));
      await vi.waitFor(async () => { expect(await page.evaluate(() => (window as any).automationFixture.reads.length)).toBe(3); }, { timeout: 5_000 });
      await vi.waitFor(async () => { expect(await toggle(page).isEnabled()).toBe(true); }, { timeout: 5_000 });
      await toggle(page).click();
      await vi.waitFor(async () => { expect(await page.evaluate(() => (window as any).automationFixture.writes.length)).toBe(2); }, { timeout: 5_000 });
      await page.evaluate(() => (window as any).automationFixture.finishWrite(0, { error: true }));
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await vi.waitFor(async () => { expect(await toggle(page).getAttribute('aria-busy')).toBe('true'); }, { timeout: 5_000 });
      await vi.waitFor(async () => { expect(await toggle(page).isDisabled()).toBe(true); }, { timeout: 5_000 });
      await vi.waitFor(async () => { expect(await page.getByRole('alert').count()).toBe(0); }, { timeout: 5_000 });
      await page.evaluate(() => (window as any).automationFixture.finishWrite(1));
      await vi.waitFor(async () => { expect(await toggle(page).getAttribute('aria-pressed')).toBe('false'); }, { timeout: 5_000 });
      await vi.waitFor(async () => { expect(await toggle(page).isEnabled()).toBe(true); }, { timeout: 5_000 });
    });
  }, 30_000);

  it('rejects a different-profile set response and disables the uncertain control', async () => {
    await withAutomationControlFixture({}, async page => {
      await vi.waitFor(async () => { expect(await toggle(page).getAttribute('aria-pressed')).toBe('true'); }, { timeout: 5_000 });
      await toggle(page).click();
      await page.evaluate(() => (window as any).automationFixture.finishWrite(0, { patch: { browserProfileId: 'other-profile' } }));
      await vi.waitFor(async () => { expect(await page.getByRole('alert').isVisible()).toBe(true); }, { timeout: 5_000 });
      await vi.waitFor(async () => { expect(await toggle(page).getAttribute('aria-pressed')).toBeNull(); }, { timeout: 5_000 });
      await vi.waitFor(async () => { expect(await toggle(page).getAttribute('aria-busy')).toBeNull(); }, { timeout: 5_000 });
      await vi.waitFor(async () => { expect(await toggle(page).isDisabled()).toBe(true); }, { timeout: 5_000 });
    });
  }, 30_000);

  it('fails closed with no writes when the preload automation surface is unavailable', async () => {
    await withAutomationControlFixture({ missingApi: true }, async page => {
      await vi.waitFor(async () => { expect(await page.getByRole('alert').isVisible()).toBe(true); }, { timeout: 5_000 });
      await vi.waitFor(async () => { expect(await toggle(page).isDisabled()).toBe(true); }, { timeout: 5_000 });
      await vi.waitFor(async () => { expect(await toggle(page).getAttribute('aria-pressed')).not.toBe('true'); }, { timeout: 5_000 });
      expect(await page.evaluate(() => (window as any).automationFixture.reads.length)).toBe(0);
      expect(await page.evaluate(() => (window as any).automationFixture.writes.length)).toBe(0);
    });
  }, 30_000);
});

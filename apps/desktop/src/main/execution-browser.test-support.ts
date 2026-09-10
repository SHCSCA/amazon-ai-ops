// Browser port double for isolated integration tests; never real Ads evidence.
import fs from 'node:fs';
import type { PlaywrightKeywordBidLocatorLike, PlaywrightKeywordBidPageLike } from '@amazon-ai-ops/action-executor';
const TARGET_PATH = '/ad_report/target/index/index';
class FakeLocator implements PlaywrightKeywordBidLocatorLike {
  constructor(
    private readonly page: FakeExecutionPage,
    private readonly kind: 'body' | 'marker' | 'row' | 'links' | 'bid' | 'save' | 'missing',
  ) {}

  async count(): Promise<number> {
    if (['body', 'marker', 'row', 'links', 'bid', 'save'].includes(this.kind)) return 1;
    return 0;
  }

  first(): PlaywrightKeywordBidLocatorLike { return this; }
  nth(): PlaywrightKeywordBidLocatorLike { return this; }

  locator(selector: string): PlaywrightKeywordBidLocatorLike {
    if (this.kind === 'marker' && selector === 'xpath=ancestor::tr[1]') return new FakeLocator(this.page, 'row');
    if (this.kind === 'row' && selector === 'a[href*="ad_group_id="]') return new FakeLocator(this.page, 'links');
    if (this.kind === 'row' && selector === '.form-control.price') return new FakeLocator(this.page, 'bid');
    if (this.kind === 'row' && selector === '.Js-bid-save') return new FakeLocator(this.page, 'save');
    return new FakeLocator(this.page, 'missing');
  }

  async getAttribute(name: string): Promise<string | null> {
    if (this.kind === 'marker' && name === 'value') return this.page.keywordId;
    if (this.kind === 'links' && name === 'href') {
      return `/ad_report/group?ad_group_id=${this.page.adGroupId}`;
    }
    return null;
  }

  async inputValue(): Promise<string> {
    if (this.kind === 'bid' && this.page.inputValueError) throw this.page.inputValueError;
    return this.kind === 'bid' ? this.page.bidValue : '';
  }
  async fill(value: string): Promise<void> { if (this.kind === 'bid') this.page.bidValue = value; }
  async hover(): Promise<void> {}

  async click(): Promise<void> {
    if (this.kind !== 'save') return;
    this.page.clickCount += 1;
    if (this.page.clickError) throw this.page.clickError;
  }

  async isVisible(): Promise<boolean> { return this.kind === 'save'; }
  async isEnabled(): Promise<boolean> {
    if (this.kind !== 'save') return false;
    if (this.page.pauseBeforePermit) {
      this.page.signalPrepareSaveReady();
      await this.page.waitForPermitRelease();
    }
    return true;
  }
  async innerText(): Promise<string> { return this.kind === 'body' ? 'Amazon Ads' : 'door lock exact'; }
}

export class FakeExecutionPage implements PlaywrightKeywordBidPageLike {
  bidValue = '$1.49';
  campaignId = 'campaign-1';
  adGroupId = 'ad-group-1';
  keywordId = 'keyword-1';
  clickCount = 0;
  clickError?: Error;
  inputValueError?: Error;
  pauseBeforePermit = false;
  private screenshotCount = 0;
  private afterScreenshotSignalled = false;
  private releaseAfterScreenshot?: () => void;
  readonly afterScreenshotStarted = new Promise<void>((resolve) => {
    this.releaseAfterScreenshot = resolve;
  });
  private readonly afterScreenshotGate = deferred();
  private readonly prepareSaveGate = deferred();
  private releasePrepareSave?: () => void;
  readonly prepareSaveReady = new Promise<void>((resolve) => {
    this.releasePrepareSave = resolve;
  });

  url(): string {
    return `https://ads.lingxing.com${TARGET_PATH}?profile_id=ads-account-1&id=${this.campaignId}`;
  }

  locator(selector: string): PlaywrightKeywordBidLocatorLike {
    if (selector === 'body') return new FakeLocator(this, 'body');
    if (selector === `input.select-item[value="${this.keywordId}"]`
      || selector === 'input.select-item[value="opaque-keyword-1"]') {
      return new FakeLocator(this, 'marker');
    }
    return new FakeLocator(this, 'missing');
  }

  selectCampaign(campaignId: string): void {
    this.campaignId = campaignId;
    const second = campaignId === 'campaign-2';
    this.adGroupId = second ? 'ad-group-2' : 'ad-group-1';
    const usesOpaqueStage5Id = this.keywordId.startsWith('opaque-keyword-');
    this.keywordId = usesOpaqueStage5Id
      ? (second ? 'opaque-keyword-2' : 'opaque-keyword-1')
      : (second ? 'keyword-2' : 'keyword-1');
    this.bidValue = second ? '$2.00' : '$1.49';
  }

  async reload(): Promise<unknown> { return null; }

  async screenshot(options: { path: string; fullPage: false }): Promise<unknown> {
    this.screenshotCount += 1;
    fs.writeFileSync(options.path, Buffer.from(`screenshot-${this.screenshotCount}`));
    if (this.clickCount > 0 && !this.afterScreenshotSignalled) {
      this.afterScreenshotSignalled = true;
      this.releaseAfterScreenshot?.();
      await this.afterScreenshotGate.promise;
    }
    return null;
  }

  allowAfterScreenshot(): void {
    this.afterScreenshotGate.resolve();
  }

  signalPrepareSaveReady(): void { this.releasePrepareSave?.(); }
  waitForPermitRelease(): Promise<void> { return this.prepareSaveGate.promise; }
  allowPermitCheck(): void { this.prepareSaveGate.resolve(); }
}

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

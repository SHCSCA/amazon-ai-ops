import { describe, expect, it } from 'vitest';
import { KeywordBidAdapter, type KeywordBidCommand } from './keyword-bid-adapter';
import { PlaywrightLingxingKeywordBidPage } from './lingxing-keyword-bid-page';

function acceptsRealPlaywrightPage(page: import('playwright').Page): PlaywrightLingxingKeywordBidPage {
  return new PlaywrightLingxingKeywordBidPage(page);
}
void acceptsRealPlaywrightPage;

const TARGET_PATH = '/ad_report/target/index/index';

function command(): KeywordBidCommand {
  return {
    actionType: 'set_keyword_bid',
    missionGrantId: 'grant-1',
    storeId: 'store-one',
    browserProfileId: 'profile-store-one',
    sessionGeneration: 4,
    marketplace: 'US',
    currency: 'USD',
    adsAccountId: 'profile-100',
    campaignId: 'campaign-200',
    adGroupId: 'ad-group-300',
    keywordId: 'keyword-400',
    objectRevision: 7,
    expectedBeforeBidCents: 100,
    targetBidCents: 90,
    maxChangePct: 10,
    pageIdentityExpectation: {
      origin: 'https://ads.lingxing.com',
      pathname: TARGET_PATH,
      requiredTextMarkers: ['US', 'USD'],
    },
    evidencePaths: {
      before: 'C:\\trusted\\before.png',
      after: 'C:\\trusted\\after.png',
      reload: 'C:\\trusted\\reload.png',
    },
  };
}

type LocatorKind = 'body' | 'marker' | 'row' | 'links' | 'bid' | 'save' | 'missing';

class FakeLocator {
  constructor(
    private readonly page: FakePlaywrightPage,
    private readonly kind: LocatorKind,
    private readonly index = 0,
  ) {}

  async count(): Promise<number> {
    if (this.kind === 'body') return 1;
    if (this.kind === 'marker' || this.kind === 'row') return this.page.keywordRowCount;
    if (this.kind === 'links') return this.page.adGroupHrefs.length;
    if (this.kind === 'bid' || this.kind === 'save') return this.page.keywordRowCount === 1 ? 1 : 0;
    return 0;
  }

  first(): FakeLocator {
    return new FakeLocator(this.page, this.kind, 0);
  }

  nth(index: number): FakeLocator {
    return new FakeLocator(this.page, this.kind, index);
  }

  locator(selector: string): FakeLocator {
    if (this.kind === 'marker' && selector === 'xpath=ancestor::tr[1]') {
      return new FakeLocator(this.page, 'row');
    }
    if (this.kind === 'row' && selector === 'a[href*="ad_group_id="]') {
      return new FakeLocator(this.page, 'links');
    }
    if (this.kind === 'row' && selector === '.form-control.price') {
      return new FakeLocator(this.page, 'bid');
    }
    if (this.kind === 'row' && selector === '.Js-bid-save') {
      return new FakeLocator(this.page, 'save');
    }
    return new FakeLocator(this.page, 'missing');
  }

  async getAttribute(name: string): Promise<string | null> {
    if (this.kind === 'marker' && name === 'value') return this.page.keywordId;
    if (this.kind === 'links' && name === 'href') return this.page.adGroupHrefs[this.index] ?? null;
    return null;
  }

  async inputValue(): Promise<string> {
    return this.kind === 'bid' ? this.page.bidValue : '';
  }

  async fill(value: string): Promise<void> {
    if (this.kind === 'bid') this.page.bidValue = value;
  }

  async click(): Promise<void> {
    if (this.kind === 'save') this.page.clickCount += 1;
  }

  async isVisible(): Promise<boolean> {
    return this.page.saveVisible;
  }

  async isEnabled(): Promise<boolean> {
    return this.page.saveEnabled;
  }

  async innerText(): Promise<string> {
    if (this.kind === 'body') return this.page.bodyText;
    if (this.kind === 'row') return this.page.rowText;
    return '';
  }
}

class FakePlaywrightPage {
  currentUrl = `https://ads.lingxing.com${TARGET_PATH}?profile_id=profile-100&id=campaign-200&token=must-not-leak#private`;
  bodyText = 'Amazon Ads account US currency USD';
  rowText = 'blue widget exact keyword';
  keywordId = 'keyword-400';
  keywordRowCount = 1;
  adGroupHrefs = ['/ad_report/group?ad_group_id=ad-group-300&secret=discard'];
  bidValue = '$1.00';
  clickCount = 0;
  reloadCount = 0;
  saveVisible = true;
  saveEnabled = true;
  readonly selectors: string[] = [];
  readonly screenshots: Array<{ path: string; fullPage?: boolean }> = [];

  url(): string {
    return this.currentUrl;
  }

  locator(selector: string): FakeLocator {
    this.selectors.push(selector);
    if (selector === 'body') return new FakeLocator(this, 'body');
    if (selector === `input.select-item[value="${this.keywordId}"]`) {
      return new FakeLocator(this, 'marker');
    }
    return new FakeLocator(this, 'missing');
  }

  async reload(): Promise<null> {
    this.reloadCount += 1;
    return null;
  }

  async screenshot(options: { path: string; fullPage?: boolean }): Promise<Buffer> {
    this.screenshots.push(options);
    return Buffer.from('png');
  }
}

describe('PlaywrightLingxingKeywordBidPage', () => {
  it('read-only resolves one Stage 5 opaque id into a safe canonical keyword identity', async () => {
    const page = new FakePlaywrightPage();
    page.bodyText = 'Amazon Ads account · United States · bid $1.00';
    const port = new PlaywrightLingxingKeywordBidPage(page);

    const result = await port.resolveCurrentKeywordIdentity({
      adEntityId: 'keyword-400',
      expectedName: 'blue widget',
    });

    expect(result).toMatchObject({
      status: 'RESOLVED',
      identity: {
        adsAccountId: 'profile-100',
        campaignId: 'campaign-200',
        adGroupId: 'ad-group-300',
        keywordId: 'keyword-400',
        bidCents: 100,
        marketplace: 'US',
        currency: 'USD',
        matchedTextMarkers: [],
        pageEvidence: {
          accountIdSource: 'profile_id',
          campaignIdSource: 'id',
          adGroupIdSource: 'row_link_query',
          keywordIdSource: 'row_input_value',
          bidSource: 'row_bid_input',
          observedCurrencySymbol: '$',
          matchedTextMarkers: [],
        },
        pageIdentityHashInput: {
          version: 'lingxing-keyword-page-v1',
          origin: 'https://ads.lingxing.com',
          pathname: TARGET_PATH,
          adsAccountId: 'profile-100',
          campaignId: 'campaign-200',
          adGroupId: 'ad-group-300',
          keywordId: 'keyword-400',
          marketplace: 'US',
          currency: 'USD',
        },
      },
    });
    if (result.status !== 'RESOLVED') throw new Error('expected resolution');
    expect(result.identity.pageIdentityHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result)).not.toContain('must-not-leak');
    expect(JSON.stringify(result)).not.toContain('secret=discard');
    expect(JSON.stringify(result)).not.toContain(page.bodyText);
    expect(page.clickCount).toBe(0);
    expect(page.bidValue).toBe('$1.00');
  });

  it('accepts a Main-provided reliable page marker without requiring literal US/USD DOM text', async () => {
    const page = new FakePlaywrightPage();
    page.bodyText = 'Bid adjustment · Current bid ($)';
    const port = new PlaywrightLingxingKeywordBidPage(page);

    const result = await port.resolveCurrentKeywordIdentity({
      adEntityId: 'keyword-400',
      requiredTextMarkers: ['$'],
    });

    expect(result).toMatchObject({
      status: 'RESOLVED',
      identity: {
        matchedTextMarkers: ['$'],
        pageEvidence: { matchedTextMarkers: ['$'] },
      },
    });
  });

  it.each([0, 2])('blocks a non-unique row count of %s without returning raw page content', async (rowCount) => {
    const page = new FakePlaywrightPage();
    page.keywordRowCount = rowCount;
    page.bodyText = 'US USD cookie=session-secret';
    const port = new PlaywrightLingxingKeywordBidPage(page);

    const result = await port.resolveCurrentKeywordIdentity({ adEntityId: 'keyword-400' });

    expect(result).toMatchObject({
      status: 'BLOCKED',
      error: { code: 'KEYWORD_ROW_NOT_UNIQUE' },
    });
    expect(JSON.stringify(result)).not.toContain('session-secret');
    expect(page.clickCount).toBe(0);
  });

  it('blocks ambiguous localized bid punctuation instead of guessing cents', async () => {
    const page = new FakePlaywrightPage();
    page.bidValue = '$1,2';
    const port = new PlaywrightLingxingKeywordBidPage(page);

    const result = await port.resolveCurrentKeywordIdentity({ adEntityId: 'keyword-400' });

    expect(result).toMatchObject({
      status: 'BLOCKED',
      error: { code: 'BID_VALUE_INVALID' },
    });
    expect(page.clickCount).toBe(0);
  });

  it('uses only the exact row controls for fill, one save click, reload, and screenshot', async () => {
    const page = new FakePlaywrightPage();
    const port = new PlaywrightLingxingKeywordBidPage(page);
    const input = command();

    const before = await port.readSnapshot(input);
    await port.fillBid(input, 90);
    const draft = await port.readSnapshot(input);
    const submitControl = await port.prepareSave(input);
    await submitControl.clickOnce();
    await port.reload();
    await port.captureScreenshot('C:\\trusted\\after.png');

    expect(before.keyword.bidCents).toBe(100);
    expect(draft.keyword.bidCents).toBe(90);
    expect(page.bidValue).toBe('0.90');
    expect(page.clickCount).toBe(1);
    expect(page.reloadCount).toBe(1);
    expect(page.screenshots).toEqual([{ path: 'C:\\trusted\\after.png', fullPage: false }]);
    expect(page.selectors).toContain('input.select-item[value="keyword-400"]');
  });

  it('surfaces production URL identity drift as a safe BLOCKED preflight', async () => {
    const page = new FakePlaywrightPage();
    page.currentUrl = `https://ads.lingxing.com${TARGET_PATH}?profile_id=profile-other&id=campaign-200`;
    const adapter = new KeywordBidAdapter(new PlaywrightLingxingKeywordBidPage(page));

    const result = await adapter.preflight(command());

    expect(result).toMatchObject({
      status: 'BLOCKED',
      error: { code: 'COMMAND_IDENTITY_MISMATCH' },
    });
    expect(page.clickCount).toBe(0);
    expect(page.screenshots).toEqual([]);
  });

  it('treats any identity drift after intent persistence as UNKNOWN without retry', async () => {
    const page = new FakePlaywrightPage();
    const adapter = new KeywordBidAdapter(new PlaywrightLingxingKeywordBidPage(page));
    const input = command();
    const preflight = await adapter.preflight(input);

    const result = await adapter.apply(input, preflight, {
      beforeSubmit: async (intent) => {
        page.currentUrl = `https://ads.lingxing.com${TARGET_PATH}?profile_id=profile-other&id=campaign-200`;
        return {
          intentId: 'intent-1',
          persistedAt: '2026-07-23T08:00:00.000Z',
          commandFingerprint: intent.commandFingerprint,
        };
      },
    });

    expect(result).toMatchObject({
      status: 'UNKNOWN',
      submitAttempted: true,
      intentReceipt: { intentId: 'intent-1' },
      error: { code: 'COMMAND_IDENTITY_MISMATCH' },
    });
    expect(page.clickCount).toBe(1);
  });
});

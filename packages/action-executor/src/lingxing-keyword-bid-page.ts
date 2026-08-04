import { win32 } from 'path';
import {
  LINGXING_KEYWORD_BID_ORIGIN,
  LINGXING_KEYWORD_BID_PATH,
  KeywordBidBlockedError,
  fingerprintKeywordBidPageSnapshot,
  type KeywordBidCommand,
  type KeywordBidPageIdentity,
  type KeywordBidPagePort,
  type KeywordBidPageSnapshot,
  type KeywordBidSafeError,
  type KeywordBidSubmitControl,
} from './keyword-bid-adapter';

const KEYWORD_ROW_SELECTOR_PREFIX = 'input.select-item[value="';
const KEYWORD_ROW_SELECTOR_SUFFIX = '"]';
const ROW_ANCESTOR_SELECTOR = 'xpath=ancestor::tr[1]';
const AD_GROUP_LINK_SELECTOR = 'a[href*="ad_group_id="]';
const BID_INPUT_SELECTOR = '.form-control.price';
const SAVE_BUTTON_SELECTOR = '.Js-bid-save';
const MAX_LINKS_PER_ROW = 20;
const DEFAULT_TIMEOUT_MS = 45_000;

/** The subset used by this adapter is structurally compatible with Playwright Locator. */
export interface PlaywrightKeywordBidLocatorLike {
  count(): Promise<number>;
  first(): PlaywrightKeywordBidLocatorLike;
  nth(index: number): PlaywrightKeywordBidLocatorLike;
  locator(selector: string): PlaywrightKeywordBidLocatorLike;
  getAttribute(name: string): Promise<string | null>;
  inputValue(): Promise<string>;
  fill(value: string): Promise<void>;
  click(): Promise<void>;
  isVisible(): Promise<boolean>;
  isEnabled(): Promise<boolean>;
  innerText(): Promise<string>;
}

/** The subset used by this adapter is structurally compatible with Playwright Page. */
export interface PlaywrightKeywordBidPageLike {
  url(): string;
  locator(selector: string): PlaywrightKeywordBidLocatorLike;
  reload(options?: {
    waitUntil?: 'domcontentloaded';
    timeout?: number;
  }): Promise<unknown>;
  screenshot(options: { path: string; fullPage: false }): Promise<unknown>;
}

export interface ResolveCurrentKeywordIdentityInput {
  /** Stage 5 opaque id; V1 treats it only as a candidate Lingxing keyword id. */
  adEntityId: string;
  /** Optional operator-visible label used only as a read-only row assertion. */
  expectedName?: string;
  /** Optional, Main-selected visible evidence such as a title, column label, or `$`. */
  requiredTextMarkers?: readonly string[];
}

export interface LingxingKeywordPageIdentityHashInput {
  version: 'lingxing-keyword-page-v1';
  origin: typeof LINGXING_KEYWORD_BID_ORIGIN;
  pathname: typeof LINGXING_KEYWORD_BID_PATH;
  adsAccountId: string;
  campaignId: string;
  adGroupId: string;
  keywordId: string;
  marketplace: 'US';
  currency: 'USD';
}

export interface ResolvedCurrentKeywordIdentity {
  adsAccountId: string;
  campaignId: string;
  adGroupId: string;
  keywordId: string;
  bidCents: number;
  marketplace: 'US';
  currency: 'USD';
  /** Only markers actually read from the page. Empty means Main must bind the account. */
  matchedTextMarkers: readonly string[];
  pageEvidence: {
    accountIdSource: 'profile_id';
    campaignIdSource: 'id';
    adGroupIdSource: 'row_link_query';
    keywordIdSource: 'row_input_value';
    bidSource: 'row_bid_input';
    observedCurrencySymbol: '$' | null;
    matchedTextMarkers: readonly string[];
  };
  pageIdentity: KeywordBidPageIdentity;
  /** Stable, sanitized fields Main can hash or independently compare. */
  pageIdentityHashInput: LingxingKeywordPageIdentityHashInput;
  pageIdentityHash: string;
}

export type ResolveCurrentKeywordIdentityResult =
  | {
      status: 'RESOLVED';
      identity: ResolvedCurrentKeywordIdentity;
    }
  | {
      status: 'BLOCKED';
      error: KeywordBidSafeError;
    };

interface ResolvedKeywordRow {
  snapshot: KeywordBidPageSnapshot;
  row: PlaywrightKeywordBidLocatorLike;
  bidInput: PlaywrightKeywordBidLocatorLike;
  saveButton: PlaywrightKeywordBidLocatorLike;
  observedCurrencySymbol: '$' | null;
}

/**
 * Production Lingxing Ads page adapter. It has no navigation, retry, authority,
 * or persistence behavior; Main owns those concerns and supplies exact paths.
 */
export class PlaywrightLingxingKeywordBidPage implements KeywordBidPagePort {
  constructor(
    private readonly page: PlaywrightKeywordBidPageLike,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  async resolveCurrentKeywordIdentity(
    input: ResolveCurrentKeywordIdentityInput,
  ): Promise<ResolveCurrentKeywordIdentityResult> {
    try {
      const expectedName = validateOptionalExpectedName(input?.expectedName);
      const resolved = await this.resolveRow(
        input?.adEntityId,
        expectedName,
        input?.requiredTextMarkers ?? [],
      );
      const pageIdentityHashInput = identityHashInput(resolved.snapshot);
      return {
        status: 'RESOLVED',
        identity: {
          adsAccountId: resolved.snapshot.pageIdentity.adsAccountId,
          campaignId: resolved.snapshot.pageIdentity.campaignId,
          adGroupId: resolved.snapshot.keyword.adGroupId,
          keywordId: resolved.snapshot.keyword.keywordId,
          bidCents: resolved.snapshot.keyword.bidCents,
          marketplace: 'US',
          currency: 'USD',
          matchedTextMarkers: resolved.snapshot.pageIdentity.matchedTextMarkers,
          pageEvidence: {
            accountIdSource: 'profile_id',
            campaignIdSource: 'id',
            adGroupIdSource: 'row_link_query',
            keywordIdSource: 'row_input_value',
            bidSource: 'row_bid_input',
            observedCurrencySymbol: resolved.observedCurrencySymbol,
            matchedTextMarkers: resolved.snapshot.pageIdentity.matchedTextMarkers,
          },
          pageIdentity: resolved.snapshot.pageIdentity,
          pageIdentityHashInput,
          pageIdentityHash: fingerprintKeywordBidPageSnapshot(resolved.snapshot),
        },
      };
    } catch (error) {
      return {
        status: 'BLOCKED',
        error: safePageError(error, 'PAGE_READ_FAILED', '无法安全解析当前关键词页面。'),
      };
    }
  }

  async readSnapshot(command: KeywordBidCommand): Promise<KeywordBidPageSnapshot> {
    const resolved = await this.resolveRow(
      command.keywordId,
      undefined,
      command.pageIdentityExpectation.requiredTextMarkers,
    );
    assertResolvedMatchesCommand(resolved.snapshot, command);
    await assertExactCount(
      resolved.saveButton,
      1,
      'SAVE_CONTROL_NOT_UNIQUE',
      '关键词行保存控件不是唯一目标。',
    );
    return resolved.snapshot;
  }

  async fillBid(command: KeywordBidCommand, targetBidCents: number): Promise<void> {
    const resolved = await this.resolveRow(
      command.keywordId,
      undefined,
      command.pageIdentityExpectation.requiredTextMarkers,
    );
    assertResolvedMatchesCommand(resolved.snapshot, command);
    if (resolved.snapshot.keyword.bidCents !== command.expectedBeforeBidCents) {
      throw new LingxingPageContractError(
        'EXPECTED_BEFORE_MISMATCH',
        '填写前竞价已变化，禁止继续。',
      );
    }
    if (targetBidCents !== command.targetBidCents) {
      throw new LingxingPageContractError('TARGET_BID_MISMATCH', '填写目标与命令不一致。');
    }
    await resolved.bidInput.fill(formatUsdCents(targetBidCents));
  }

  async prepareSave(command: KeywordBidCommand): Promise<KeywordBidSubmitControl> {
    const resolved = await this.resolveRow(
      command.keywordId,
      undefined,
      command.pageIdentityExpectation.requiredTextMarkers,
    );
    assertResolvedMatchesCommand(resolved.snapshot, command);
    if (resolved.snapshot.keyword.bidCents !== command.targetBidCents) {
      throw new LingxingPageContractError(
        'DRAFT_BID_MISMATCH',
        '保存前页面竞价未命中目标，禁止点击。',
      );
    }
    await assertExactCount(
      resolved.saveButton,
      1,
      'SAVE_CONTROL_NOT_UNIQUE',
      '关键词行保存控件不是唯一目标。',
    );
    if (!await resolved.saveButton.isVisible() || !await resolved.saveButton.isEnabled()) {
      throw new LingxingPageContractError('SAVE_CONTROL_NOT_READY', '关键词行保存控件不可用。');
    }
    let invoked = false;
    return {
      clickOnce: async () => {
        if (invoked) {
          throw new KeywordBidBlockedError('DUPLICATE_SUBMIT', '保存控件已调用，禁止重复提交。');
        }
        invoked = true;
        // Exactly one invocation. Callers classify any thrown outcome as UNKNOWN.
        await resolved.saveButton.click();
      },
    };
  }

  async reload(): Promise<void> {
    // Exactly one real reload. There is deliberately no retry loop.
    await this.page.reload({ waitUntil: 'domcontentloaded', timeout: this.timeoutMs });
  }

  async captureScreenshot(path: string): Promise<void> {
    assertScreenshotPath(path);
    await this.page.screenshot({ path, fullPage: false });
  }

  private async resolveRow(
    keywordIdInput: string | undefined,
    expectedName: string | undefined,
    requiredTextMarkers: readonly string[],
  ): Promise<ResolvedKeywordRow> {
    const keywordId = validateSelectorId(keywordIdInput, 'keyword id');
    const url = parseTargetUrl(this.page.url());
    const adsAccountId = singleQueryId(url, 'profile_id');
    const campaignId = singleQueryId(url, 'id');
    const matchedTextMarkers = await this.assertPageMarkers(requiredTextMarkers);

    const marker = this.page.locator(
      `${KEYWORD_ROW_SELECTOR_PREFIX}${keywordId}${KEYWORD_ROW_SELECTOR_SUFFIX}`,
    );
    await assertExactCount(
      marker,
      1,
      'KEYWORD_ROW_NOT_UNIQUE',
      '当前页面未唯一命中指定关键词行。',
    );
    const markerValue = await marker.first().getAttribute('value');
    if (markerValue !== keywordId) {
      throw new LingxingPageContractError('KEYWORD_IDENTITY_MISMATCH', '关键词行稳定 ID 不一致。');
    }

    const row = marker.first().locator(ROW_ANCESTOR_SELECTOR);
    await assertExactCount(
      row,
      1,
      'KEYWORD_ROW_NOT_UNIQUE',
      '指定关键词控件未唯一归属于表格行。',
    );
    if (expectedName) {
      const rowText = normalizeHumanText(await row.innerText());
      if (!rowText.includes(normalizeHumanText(expectedName))) {
        throw new LingxingPageContractError('KEYWORD_NAME_MISMATCH', '关键词行名称与期望不一致。');
      }
    }

    const adGroupId = await readUniqueAdGroupId(row, url.origin);
    const bidInput = row.locator(BID_INPUT_SELECTOR);
    await assertExactCount(
      bidInput,
      1,
      'BID_INPUT_NOT_UNIQUE',
      '关键词行竞价输入框不是唯一目标。',
    );
    const bid = parseUsdBid(await bidInput.inputValue());
    const pageIdentity: KeywordBidPageIdentity = {
      url: canonicalSafePageUrl(adsAccountId, campaignId),
      origin: LINGXING_KEYWORD_BID_ORIGIN,
      pathname: LINGXING_KEYWORD_BID_PATH,
      adsAccountId,
      campaignId,
      marketplace: 'US',
      currency: 'USD',
      matchedTextMarkers,
    };

    return {
      snapshot: {
        pageIdentity,
        keyword: { keywordId, adGroupId, bidCents: bid.cents },
      },
      row,
      bidInput,
      saveButton: row.locator(SAVE_BUTTON_SELECTOR),
      observedCurrencySymbol: bid.currencySymbol,
    };
  }

  private async assertPageMarkers(requiredMarkersInput: readonly string[]): Promise<readonly string[]> {
    const requiredMarkers = validateMarkers(requiredMarkersInput);
    if (requiredMarkers.length === 0) return [];
    const body = this.page.locator('body');
    await assertExactCount(body, 1, 'PAGE_BODY_NOT_UNIQUE', '页面正文不是唯一目标。');
    const bodyText = await body.innerText();
    if (requiredMarkers.some((marker) => !containsStandaloneMarker(bodyText, marker))) {
      throw new LingxingPageContractError('PAGE_MARKER_MISSING', '当前页面缺少 Main 指定的可见身份标记。');
    }
    return [...requiredMarkers];
  }
}

class LingxingPageContractError extends KeywordBidBlockedError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = 'LingxingPageContractError';
  }
}

function parseTargetUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new LingxingPageContractError('PAGE_URL_INVALID', '当前页面地址无效。');
  }
  if (url.username || url.password
    || url.origin !== LINGXING_KEYWORD_BID_ORIGIN
    || url.pathname !== LINGXING_KEYWORD_BID_PATH) {
    throw new LingxingPageContractError('PAGE_IDENTITY_MISMATCH', '当前页面不是目标关键词报表。');
  }
  return url;
}

function singleQueryId(url: URL, name: 'profile_id' | 'id'): string {
  const values = url.searchParams.getAll(name);
  if (values.length !== 1) {
    throw new LingxingPageContractError('PAGE_IDENTITY_MISMATCH', '当前页面身份参数不唯一。');
  }
  return validateSelectorId(values[0], name);
}

async function readUniqueAdGroupId(
  row: PlaywrightKeywordBidLocatorLike,
  expectedOrigin: string,
): Promise<string> {
  const links = row.locator(AD_GROUP_LINK_SELECTOR);
  const count = await links.count();
  if (count < 1 || count > MAX_LINKS_PER_ROW) {
    throw new LingxingPageContractError(
      'AD_GROUP_IDENTITY_MISMATCH',
      '关键词行未唯一解析广告组身份。',
    );
  }
  const ids = new Set<string>();
  for (let index = 0; index < count; index += 1) {
    const href = await links.nth(index).getAttribute('href');
    if (!href) {
      throw new LingxingPageContractError(
        'AD_GROUP_IDENTITY_MISMATCH',
        '关键词行广告组链接无效。',
      );
    }
    let link: URL;
    try {
      link = new URL(href, expectedOrigin);
    } catch {
      throw new LingxingPageContractError(
        'AD_GROUP_IDENTITY_MISMATCH',
        '关键词行广告组链接无效。',
      );
    }
    if (link.origin !== expectedOrigin) {
      throw new LingxingPageContractError(
        'AD_GROUP_IDENTITY_MISMATCH',
        '关键词行广告组链接不属于当前站点。',
      );
    }
    const values = link.searchParams.getAll('ad_group_id');
    if (values.length !== 1) {
      throw new LingxingPageContractError(
        'AD_GROUP_IDENTITY_MISMATCH',
        '关键词行广告组身份参数不唯一。',
      );
    }
    ids.add(validateSelectorId(values[0], 'ad group id'));
  }
  if (ids.size !== 1) {
    throw new LingxingPageContractError(
      'AD_GROUP_IDENTITY_MISMATCH',
      '关键词行广告组身份存在冲突。',
    );
  }
  return [...ids][0];
}

function assertResolvedMatchesCommand(snapshot: KeywordBidPageSnapshot, command: KeywordBidCommand): void {
  const identity = snapshot.pageIdentity;
  if (identity.origin !== command.pageIdentityExpectation.origin
    || identity.pathname !== command.pageIdentityExpectation.pathname
    || identity.adsAccountId !== command.adsAccountId
    || identity.campaignId !== command.campaignId
    || identity.marketplace !== command.marketplace
    || identity.currency !== command.currency
    || snapshot.keyword.adGroupId !== command.adGroupId
    || snapshot.keyword.keywordId !== command.keywordId) {
    throw new LingxingPageContractError('COMMAND_IDENTITY_MISMATCH', '当前页稳定身份与命令不一致。');
  }
}

async function assertExactCount(
  locator: PlaywrightKeywordBidLocatorLike,
  expected: number,
  code: string,
  message: string,
): Promise<void> {
  if (await locator.count() !== expected) {
    throw new LingxingPageContractError(code, message);
  }
}

function validateSelectorId(value: string | undefined, field: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(normalized)) {
    throw new LingxingPageContractError('IDENTIFIER_INVALID', `${field} 不是安全稳定 ID。`);
  }
  return normalized;
}

function validateOptionalExpectedName(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > 240 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new LingxingPageContractError('EXPECTED_NAME_INVALID', '期望名称无效。');
  }
  return normalized;
}

function validateMarkers(markers: readonly string[]): readonly string[] {
  if (!Array.isArray(markers)
    || markers.length > 8) {
    throw new LingxingPageContractError('PAGE_MARKERS_INVALID', '页面身份标记无效。');
  }
  const normalized = markers.map((marker) => {
    if (typeof marker !== 'string'
      || !marker
      || marker.length > 40
      || /[\u0000-\u001f\u007f]/.test(marker)) {
      throw new LingxingPageContractError('PAGE_MARKERS_INVALID', '页面身份标记无效。');
    }
    return marker;
  });
  if (new Set(normalized).size !== normalized.length) {
    throw new LingxingPageContractError('PAGE_MARKERS_INVALID', '页面身份标记重复。');
  }
  return normalized;
}

function parseUsdBid(value: string): { cents: number; currencySymbol: '$' | null } {
  const trimmed = String(value ?? '').trim();
  const currencySymbol = trimmed.startsWith('$') ? '$' : null;
  const numeric = trimmed.replace(/^\$/, '');
  const plainUsd = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;
  const groupedUsd = /^[1-9]\d{0,2}(?:,\d{3})+(?:\.\d{1,2})?$/;
  if (!plainUsd.test(numeric) && !groupedUsd.test(numeric)) {
    throw new LingxingPageContractError('BID_VALUE_INVALID', '页面竞价不是有效 USD 金额。');
  }
  const normalized = numeric.replace(/,/g, '');
  const [whole, decimal = ''] = normalized.split('.');
  const cents = Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents <= 0) {
    throw new LingxingPageContractError('BID_VALUE_INVALID', '页面竞价不是正数美分。');
  }
  return { cents, currencySymbol };
}

function formatUsdCents(value: number): string {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new LingxingPageContractError('BID_VALUE_INVALID', '目标竞价不是正数美分。');
  }
  return (value / 100).toFixed(2);
}

function assertScreenshotPath(value: string): void {
  if (typeof value !== 'string'
    || value.length > 1024
    || !win32.isAbsolute(value)
    || win32.extname(value).toLowerCase() !== '.png'
    || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new LingxingPageContractError('EVIDENCE_PATH_INVALID', '截图路径必须是 Main 选择的绝对 PNG 路径。');
  }
}

function containsStandaloneMarker(text: string, marker: string): boolean {
  if (!/^[A-Za-z0-9]+$/.test(marker)) return text.includes(marker);
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^A-Za-z0-9])${escaped}(?:$|[^A-Za-z0-9])`).test(text);
}

function normalizeHumanText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

function canonicalSafePageUrl(adsAccountId: string, campaignId: string): string {
  return `${LINGXING_KEYWORD_BID_ORIGIN}${LINGXING_KEYWORD_BID_PATH}`
    + `?profile_id=${encodeURIComponent(adsAccountId)}&id=${encodeURIComponent(campaignId)}`;
}

function identityHashInput(snapshot: KeywordBidPageSnapshot): LingxingKeywordPageIdentityHashInput {
  return {
    version: 'lingxing-keyword-page-v1',
    origin: LINGXING_KEYWORD_BID_ORIGIN,
    pathname: LINGXING_KEYWORD_BID_PATH,
    adsAccountId: snapshot.pageIdentity.adsAccountId,
    campaignId: snapshot.pageIdentity.campaignId,
    adGroupId: snapshot.keyword.adGroupId,
    keywordId: snapshot.keyword.keywordId,
    marketplace: 'US',
    currency: 'USD',
  };
}

function safePageError(
  error: unknown,
  fallbackCode: string,
  fallbackMessage: string,
): KeywordBidSafeError {
  if (error instanceof LingxingPageContractError) {
    return { code: error.code, message: error.message };
  }
  return { code: fallbackCode, message: fallbackMessage };
}

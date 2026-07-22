import { describe, expect, it } from 'vitest';
import {
  fingerprintKeywordBidPageSnapshot,
  KeywordBidAdapter,
  type KeywordBidCommand,
  type KeywordBidPagePort,
  type KeywordBidPageSnapshot,
} from './keyword-bid-adapter';

const TARGET_PATH = '/ad_report/target/index/index';

function command(overrides: Partial<KeywordBidCommand> = {}): KeywordBidCommand {
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
      before: 'C:\\trusted\\store-one\\screenshots\\before.png',
      after: 'C:\\trusted\\store-one\\screenshots\\after.png',
      reload: 'C:\\trusted\\store-one\\screenshots\\reload.png',
    },
    ...overrides,
  };
}

function snapshot(overrides: Partial<KeywordBidPageSnapshot> = {}): KeywordBidPageSnapshot {
  return {
    pageIdentity: {
      url: `https://ads.lingxing.com${TARGET_PATH}?profile_id=profile-100&id=campaign-200`,
      origin: 'https://ads.lingxing.com',
      pathname: TARGET_PATH,
      adsAccountId: 'profile-100',
      campaignId: 'campaign-200',
      marketplace: 'US',
      currency: 'USD',
      matchedTextMarkers: ['US', 'USD'],
    },
    keyword: {
      keywordId: 'keyword-400',
      adGroupId: 'ad-group-300',
      bidCents: 100,
    },
    ...overrides,
  };
}

class FakeKeywordBidPage implements KeywordBidPagePort {
  currentSnapshot = snapshot();
  readonly captures: string[] = [];
  clickCount = 0;
  reloadCount = 0;
  clickError?: Error;
  afterClickBidCents?: number;
  reloadError?: Error;
  readonly driftAfterCaptureByPath = new Map<string, KeywordBidPageSnapshot>();

  async readSnapshot(): Promise<KeywordBidPageSnapshot> {
    return this.currentSnapshot;
  }

  async fillBid(_command: KeywordBidCommand, targetBidCents: number): Promise<void> {
    this.currentSnapshot = snapshot({
      keyword: { ...this.currentSnapshot.keyword, bidCents: targetBidCents },
    });
  }

  async prepareSave(): Promise<{ clickOnce(): Promise<void> }> {
    return {
      clickOnce: async () => {
        this.clickCount += 1;
        if (this.clickError) {
          throw this.clickError;
        }
        if (this.afterClickBidCents !== undefined) {
          this.currentSnapshot = snapshot({
            keyword: { ...this.currentSnapshot.keyword, bidCents: this.afterClickBidCents },
          });
        }
      },
    };
  }

  async reload(): Promise<void> {
    this.reloadCount += 1;
    if (this.reloadError) throw this.reloadError;
  }

  async captureScreenshot(path: string): Promise<void> {
    this.captures.push(path);
    const drift = this.driftAfterCaptureByPath.get(path);
    if (drift) this.currentSnapshot = drift;
  }
}

describe('KeywordBidAdapter', () => {
  it('hashes the exact observed account, campaign, ad group and keyword identity', () => {
    const baseline = fingerprintKeywordBidPageSnapshot(snapshot());

    expect(baseline).toMatch(/^[a-f0-9]{64}$/);
    expect(fingerprintKeywordBidPageSnapshot(snapshot({
      keyword: { ...snapshot().keyword, adGroupId: 'ad-group-other' },
    }))).not.toBe(baseline);
    expect(fingerprintKeywordBidPageSnapshot(snapshot({
      keyword: { ...snapshot().keyword, keywordId: 'keyword-other' },
    }))).not.toBe(baseline);
  });

  it.each([
    {
      label: 'an action outside set_keyword_bid',
      input: command({ actionType: 'increase_keyword_bid' as 'set_keyword_bid' }),
      code: 'ACTION_NOT_ALLOWED',
    },
    {
      label: 'a marketplace outside US/USD',
      input: command({ marketplace: 'CA' as 'US' }),
      code: 'MARKET_NOT_ALLOWED',
    },
    {
      label: 'a bid that is not a decrease',
      input: command({ targetBidCents: 100 }),
      code: 'LOWER_BID_ONLY',
    },
    {
      label: 'a policy cap above the V1 maximum',
      input: command({ maxChangePct: 11 }),
      code: 'CHANGE_LIMIT_INVALID',
    },
    {
      label: 'a non-canonical keyword id',
      input: command({ keywordId: 'keyword-400"]' }),
      code: 'IDENTIFIER_INVALID',
    },
    {
      label: 'a non-positive object revision',
      input: command({ objectRevision: 0 }),
      code: 'OBJECT_REVISION_INVALID',
    },
    {
      label: 'non-distinct evidence paths',
      input: command({
        evidencePaths: {
          before: 'C:\\trusted\\same.png',
          after: 'C:\\trusted\\same.png',
          reload: 'C:\\trusted\\reload.png',
        },
      }),
      code: 'EVIDENCE_PATHS_INVALID',
    },
    {
      label: 'a policy change above the authorized limit',
      input: command({ targetBidCents: 94, maxChangePct: 5 }),
      code: 'CHANGE_LIMIT_EXCEEDED',
    },
  ])('blocks $label before any screenshot or click', async ({ input, code }) => {
    const page = new FakeKeywordBidPage();
    const result = await new KeywordBidAdapter(page).preflight(input);

    expect(result).toMatchObject({
      phase: 'preflight',
      status: 'BLOCKED',
      error: { code },
    });
    expect(page.captures).toEqual([]);
    expect(page.clickCount).toBe(0);
  });

  it('preflights one canonical US keyword and captures the independent before proof', async () => {
    const page = new FakeKeywordBidPage();
    const adapter = new KeywordBidAdapter(page, {
      now: () => new Date('2026-07-23T08:00:00.000Z'),
    });

    const result = await adapter.preflight(command());

    expect(result).toMatchObject({
      phase: 'preflight',
      status: 'READY',
      snapshot: snapshot(),
      beforeEvidence: {
        stage: 'before',
        path: 'C:\\trusted\\store-one\\screenshots\\before.png',
        pageIdentity: snapshot().pageIdentity,
        capturedAt: '2026-07-23T08:00:00.000Z',
      },
    });
    expect(result.commandFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(page.captures).toEqual(['C:\\trusted\\store-one\\screenshots\\before.png']);
  });

  it('fails closed when the keyword identity changes while the before screenshot is captured', async () => {
    const page = new FakeKeywordBidPage();
    page.driftAfterCaptureByPath.set(
      'C:\\trusted\\store-one\\screenshots\\before.png',
      snapshot({
        keyword: { ...snapshot().keyword, keywordId: 'keyword-other' },
      }),
    );

    const result = await new KeywordBidAdapter(page).preflight(command());

    expect(result).toMatchObject({
      phase: 'preflight',
      status: 'BLOCKED',
      error: { code: 'EVIDENCE_CAPTURE_DRIFT' },
    });
    expect(page.clickCount).toBe(0);
  });

  it.each([
    {
      label: 'account/campaign page identity drift',
      value: snapshot({
        pageIdentity: { ...snapshot().pageIdentity, adsAccountId: 'profile-other' },
      }),
      code: 'PAGE_IDENTITY_MISMATCH',
    },
    {
      label: 'row ad group drift',
      value: snapshot({
        keyword: { ...snapshot().keyword, adGroupId: 'ad-group-other' },
      }),
      code: 'KEYWORD_IDENTITY_MISMATCH',
    },
    {
      label: 'expected-before drift',
      value: snapshot({
        keyword: { ...snapshot().keyword, bidCents: 101 },
      }),
      code: 'EXPECTED_BEFORE_MISMATCH',
    },
  ])('blocks $label before capture', async ({ value, code }) => {
    const page = new FakeKeywordBidPage();
    page.currentSnapshot = value;

    const result = await new KeywordBidAdapter(page).preflight(command());

    expect(result).toMatchObject({ status: 'BLOCKED', error: { code } });
    expect(page.captures).toEqual([]);
    expect(page.clickCount).toBe(0);
  });

  it('persists intent before submitting exactly once and returns the after proof', async () => {
    const page = new FakeKeywordBidPage();
    const adapter = new KeywordBidAdapter(page, {
      now: () => new Date('2026-07-23T08:00:00.000Z'),
    });
    const input = command();
    const preflight = await adapter.preflight(input);
    expect(preflight.status).toBe('READY');
    const submitBoundary: string[] = [];

    const result = await adapter.apply(input, preflight, {
      beforeSubmit: async (intent) => {
        submitBoundary.push(`intent:${intent.commandFingerprint}`);
        return {
          intentId: 'intent-1',
          persistedAt: '2026-07-23T08:00:00.000Z',
          commandFingerprint: intent.commandFingerprint,
          cookie: 'must-not-cross-boundary',
        };
      },
    });

    expect(result).toMatchObject({
      phase: 'apply',
      status: 'SUBMITTED',
      submitAttempted: true,
      intentReceipt: {
        intentId: 'intent-1',
        persistedAt: '2026-07-23T08:00:00.000Z',
      },
      afterSnapshot: snapshot({
        keyword: { keywordId: 'keyword-400', adGroupId: 'ad-group-300', bidCents: 90 },
      }),
      afterEvidence: {
        stage: 'after',
        path: 'C:\\trusted\\store-one\\screenshots\\after.png',
      },
    });
    expect(submitBoundary).toHaveLength(1);
    expect(page.clickCount).toBe(1);
    expect(JSON.stringify(result)).not.toContain('must-not-cross-boundary');
  });

  it('uses a canonical command fingerprint independent of object key insertion order', async () => {
    const page = new FakeKeywordBidPage();
    const adapter = new KeywordBidAdapter(page);
    const input = command();
    const preflight = await adapter.preflight(input);
    const reordered = Object.fromEntries(Object.entries(input).reverse()) as unknown as KeywordBidCommand;

    const result = await adapter.apply(reordered, preflight, {
      beforeSubmit: async (intent) => ({
        intentId: 'intent-1',
        persistedAt: '2026-07-23T08:00:00.000Z',
        commandFingerprint: intent.commandFingerprint,
      }),
    });

    expect(result.status).toBe('SUBMITTED');
    expect(page.clickCount).toBe(1);
  });

  it('verifies only after one real reload independently re-locates the target bid', async () => {
    const page = new FakeKeywordBidPage();
    const adapter = new KeywordBidAdapter(page, {
      now: () => new Date('2026-07-23T08:00:00.000Z'),
    });
    const input = command();
    const preflight = await adapter.preflight(input);
    const applied = await adapter.apply(input, preflight, {
      beforeSubmit: async (intent) => ({
        intentId: 'intent-1',
        persistedAt: '2026-07-23T08:00:00.000Z',
        commandFingerprint: intent.commandFingerprint,
      }),
    });

    const result = await adapter.reloadReadback(input, applied);

    expect(result).toMatchObject({
      phase: 'reload_readback',
      status: 'VERIFIED',
      reloadSnapshot: snapshot({
        keyword: { keywordId: 'keyword-400', adGroupId: 'ad-group-300', bidCents: 90 },
      }),
      reloadEvidence: {
        stage: 'reload',
        path: 'C:\\trusted\\store-one\\screenshots\\reload.png',
      },
    });
    expect(page.reloadCount).toBe(1);
    expect(page.captures).toEqual([
      'C:\\trusted\\store-one\\screenshots\\before.png',
      'C:\\trusted\\store-one\\screenshots\\after.png',
      'C:\\trusted\\store-one\\screenshots\\reload.png',
    ]);
  });

  it('does not click when the persistent intent hook is incomplete', async () => {
    const page = new FakeKeywordBidPage();
    const adapter = new KeywordBidAdapter(page);
    const input = command();
    const preflight = await adapter.preflight(input);

    const result = await adapter.apply(input, preflight, {
      beforeSubmit: async () => {
        throw new Error('database unavailable with cookie=secret');
      },
    });

    expect(result).toMatchObject({
      phase: 'apply',
      status: 'NOT_SUBMITTED',
      submitAttempted: false,
      error: {
        code: 'NOT_SUBMITTED',
        message: '尚未进入提交边界，未点击保存。',
      },
    });
    expect(JSON.stringify(result)).not.toContain('cookie=secret');
    expect(page.clickCount).toBe(0);
  });

  it('blocks an unbound persistence receipt before the save boundary', async () => {
    const page = new FakeKeywordBidPage();
    const adapter = new KeywordBidAdapter(page);
    const input = command();
    const preflight = await adapter.preflight(input);

    const result = await adapter.apply(input, preflight, {
      beforeSubmit: async () => ({
        intentId: 'intent-1',
        persistedAt: '2026-07-23T08:00:00.000Z',
        commandFingerprint: '0'.repeat(64),
      }),
    });

    expect(result).toMatchObject({
      status: 'BLOCKED',
      submitAttempted: false,
      error: { code: 'INTENT_NOT_PERSISTED' },
    });
    expect(page.clickCount).toBe(0);
  });

  it('returns sanitized UNKNOWN and never retries when the one save click throws', async () => {
    const page = new FakeKeywordBidPage();
    page.clickError = new Error('<html>cookie=session-secret</html>');
    const adapter = new KeywordBidAdapter(page);
    const input = command();
    const preflight = await adapter.preflight(input);
    const result = await adapter.apply(input, preflight, {
      beforeSubmit: async (intent) => ({
        intentId: 'intent-1',
        persistedAt: '2026-07-23T08:00:00.000Z',
        commandFingerprint: intent.commandFingerprint,
      }),
    });

    expect(result).toMatchObject({
      phase: 'apply',
      status: 'UNKNOWN',
      submitAttempted: true,
      error: {
        code: 'SUBMIT_OUTCOME_UNKNOWN',
        message: '提交边界已进入，但无法证明外部写入结果；禁止自动重试。',
      },
    });
    expect(page.clickCount).toBe(1);
    expect(JSON.stringify(result)).not.toContain('session-secret');
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it('returns UNKNOWN when the keyword identity changes while the after screenshot is captured', async () => {
    const page = new FakeKeywordBidPage();
    page.driftAfterCaptureByPath.set(
      'C:\\trusted\\store-one\\screenshots\\after.png',
      snapshot({
        keyword: { keywordId: 'keyword-other', adGroupId: 'ad-group-300', bidCents: 90 },
      }),
    );
    const adapter = new KeywordBidAdapter(page);
    const input = command();
    const preflight = await adapter.preflight(input);

    const result = await adapter.apply(input, preflight, {
      beforeSubmit: async (intent) => ({
        intentId: 'intent-1',
        persistedAt: '2026-07-23T08:00:00.000Z',
        commandFingerprint: intent.commandFingerprint,
      }),
    });

    expect(result).toMatchObject({
      phase: 'apply',
      status: 'UNKNOWN',
      submitAttempted: true,
      error: { code: 'EVIDENCE_CAPTURE_DRIFT' },
    });
    expect(page.clickCount).toBe(1);
  });

  it('keeps the outcome UNKNOWN when independent reload differs from the target', async () => {
    const page = new FakeKeywordBidPage();
    const adapter = new KeywordBidAdapter(page);
    const input = command();
    const preflight = await adapter.preflight(input);
    const applied = await adapter.apply(input, preflight, {
      beforeSubmit: async (intent) => ({
        intentId: 'intent-1',
        persistedAt: '2026-07-23T08:00:00.000Z',
        commandFingerprint: intent.commandFingerprint,
      }),
    });
    page.currentSnapshot = snapshot();

    const result = await adapter.reloadReadback(input, applied);

    expect(result).toMatchObject({
      phase: 'reload_readback',
      status: 'UNKNOWN',
      error: { code: 'READBACK_NOT_VERIFIED' },
      reloadSnapshot: snapshot(),
      reloadEvidence: { stage: 'reload' },
    });
    expect(page.reloadCount).toBe(1);
  });

  it('does not verify when after differs even if the later reload reaches the target', async () => {
    const page = new FakeKeywordBidPage();
    page.afterClickBidCents = 95;
    const adapter = new KeywordBidAdapter(page);
    const input = command();
    const preflight = await adapter.preflight(input);
    const applied = await adapter.apply(input, preflight, {
      beforeSubmit: async (intent) => ({
        intentId: 'intent-1',
        persistedAt: '2026-07-23T08:00:00.000Z',
        commandFingerprint: intent.commandFingerprint,
      }),
    });
    expect(applied).toMatchObject({
      status: 'SUBMITTED',
      afterSnapshot: { keyword: { bidCents: 95 } },
    });
    page.currentSnapshot = snapshot({
      keyword: { ...snapshot().keyword, bidCents: 90 },
    });

    const result = await adapter.reloadReadback(input, applied);

    expect(result).toMatchObject({
      status: 'UNKNOWN',
      error: { code: 'READBACK_NOT_VERIFIED' },
      reloadSnapshot: { keyword: { bidCents: 90 } },
    });
    expect(page.reloadCount).toBe(1);
  });

  it('does not reload a command that never entered the submit boundary', async () => {
    const page = new FakeKeywordBidPage();
    const adapter = new KeywordBidAdapter(page);
    const input = command();
    const preflight = await adapter.preflight(input);
    const blocked = await adapter.apply(input, preflight, {
      beforeSubmit: async () => {
        throw new Error('persistence unavailable');
      },
    });

    const result = await adapter.reloadReadback(input, blocked);

    expect(result).toMatchObject({
      phase: 'reload_readback',
      status: 'BLOCKED',
      error: { code: 'SUBMIT_NOT_ATTEMPTED' },
    });
    expect(page.reloadCount).toBe(0);
  });

  it('sanitizes reload failures after submit and keeps the outcome UNKNOWN', async () => {
    const page = new FakeKeywordBidPage();
    const adapter = new KeywordBidAdapter(page);
    const input = command();
    const preflight = await adapter.preflight(input);
    const applied = await adapter.apply(input, preflight, {
      beforeSubmit: async (intent) => ({
        intentId: 'intent-1',
        persistedAt: '2026-07-23T08:00:00.000Z',
        commandFingerprint: intent.commandFingerprint,
      }),
    });
    page.reloadError = new Error('<html>cookie=reload-secret</html>');

    const result = await adapter.reloadReadback(input, applied);

    expect(result).toMatchObject({
      status: 'UNKNOWN',
      error: {
        code: 'READBACK_OUTCOME_UNKNOWN',
        message: '已进入提交边界，但独立刷新回读无法证明目标竞价；禁止自动重试。',
      },
    });
    expect(page.reloadCount).toBe(1);
    expect(JSON.stringify(result)).not.toContain('reload-secret');
  });
});

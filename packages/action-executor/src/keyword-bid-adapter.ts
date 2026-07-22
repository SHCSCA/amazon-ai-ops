import { createHash } from 'crypto';
import { win32 } from 'path';

export const LINGXING_KEYWORD_BID_ORIGIN = 'https://ads.lingxing.com' as const;
export const LINGXING_KEYWORD_BID_PATH = '/ad_report/target/index/index' as const;

export interface KeywordBidPageIdentityExpectation {
  origin: typeof LINGXING_KEYWORD_BID_ORIGIN;
  pathname: typeof LINGXING_KEYWORD_BID_PATH;
  requiredTextMarkers: readonly string[];
}

export interface KeywordBidEvidencePaths {
  before: string;
  after: string;
  reload: string;
}

/** Main-owned, canonical input. The adapter never derives authority from names. */
export interface KeywordBidCommand {
  actionType: 'set_keyword_bid';
  missionGrantId: string;
  storeId: string;
  browserProfileId: string;
  sessionGeneration: number;
  marketplace: 'US';
  currency: 'USD';
  adsAccountId: string;
  campaignId: string;
  adGroupId: string;
  keywordId: string;
  objectRevision: number;
  expectedBeforeBidCents: number;
  targetBidCents: number;
  maxChangePct: number;
  pageIdentityExpectation: KeywordBidPageIdentityExpectation;
  evidencePaths: KeywordBidEvidencePaths;
}

export interface KeywordBidPageIdentity {
  /** Sanitized URL containing only the stable account and campaign keys. */
  url: string;
  origin: string;
  pathname: string;
  adsAccountId: string;
  campaignId: string;
  marketplace: 'US';
  currency: 'USD';
  matchedTextMarkers: readonly string[];
}

export interface KeywordBidPageSnapshot {
  pageIdentity: KeywordBidPageIdentity;
  keyword: {
    keywordId: string;
    adGroupId: string;
    bidCents: number;
  };
}

/**
 * Canonical hash for an identity that was actually observed from the Lingxing
 * keyword page. Main persists this value for the identity binding and every
 * evidence slot so historical metadata can never substitute for a fresh read.
 */
export function fingerprintKeywordBidPageSnapshot(snapshot: KeywordBidPageSnapshot): string {
  assertSnapshotIdentityShape(snapshot);
  return createHash('sha256').update(JSON.stringify({
    version: 'lingxing-keyword-page-v1',
    origin: snapshot.pageIdentity.origin,
    pathname: snapshot.pageIdentity.pathname,
    adsAccountId: snapshot.pageIdentity.adsAccountId,
    campaignId: snapshot.pageIdentity.campaignId,
    adGroupId: snapshot.keyword.adGroupId,
    keywordId: snapshot.keyword.keywordId,
    marketplace: snapshot.pageIdentity.marketplace,
    currency: snapshot.pageIdentity.currency,
  })).digest('hex');
}

export interface KeywordBidScreenshotEvidence {
  stage: 'before' | 'after' | 'reload';
  path: string;
  pageIdentity: KeywordBidPageIdentity;
  capturedAt: string;
}

/** Narrow browser boundary; a Playwright-backed implementation is supplied below. */
export interface KeywordBidPagePort {
  readSnapshot(command: KeywordBidCommand): Promise<KeywordBidPageSnapshot>;
  fillBid(command: KeywordBidCommand, targetBidCents: number): Promise<void>;
  prepareSave(command: KeywordBidCommand): Promise<KeywordBidSubmitControl>;
  reload(): Promise<void>;
  captureScreenshot(path: string): Promise<void>;
}

/** Already-validated exact save control. Its sole method is the submit boundary. */
export interface KeywordBidSubmitControl {
  clickOnce(): Promise<void>;
}

export interface KeywordBidAdapterOptions {
  now?: () => Date;
}

export interface KeywordBidSafeError {
  code: string;
  message: string;
}

export type KeywordBidPreflightResult =
  | {
      phase: 'preflight';
      status: 'READY';
      commandFingerprint: string;
      snapshot: KeywordBidPageSnapshot;
      beforeEvidence: KeywordBidScreenshotEvidence;
      observedAt: string;
    }
  | {
      phase: 'preflight';
      status: 'BLOCKED';
      commandFingerprint: string;
      error: KeywordBidSafeError;
      observedAt: string;
    };

export interface KeywordBidBeforeSubmitIntent {
  commandFingerprint: string;
  missionGrantId: string;
  storeId: string;
  browserProfileId: string;
  sessionGeneration: number;
  adsAccountId: string;
  campaignId: string;
  adGroupId: string;
  keywordId: string;
  objectRevision: number;
  expectedBeforeBidCents: number;
  targetBidCents: number;
  preflightObservedAt: string;
}

export interface KeywordBidIntentReceipt {
  intentId: string;
  persistedAt: string;
  commandFingerprint: string;
}

export interface KeywordBidApplyHooks {
  beforeSubmit(intent: KeywordBidBeforeSubmitIntent): Promise<KeywordBidIntentReceipt>;
}

export type KeywordBidApplyResult =
  | {
      phase: 'apply';
      status: 'SUBMITTED';
      commandFingerprint: string;
      submitAttempted: true;
      intentReceipt: KeywordBidIntentReceipt;
      afterSnapshot: KeywordBidPageSnapshot;
      afterEvidence: KeywordBidScreenshotEvidence;
      observedAt: string;
    }
  | {
      phase: 'apply';
      status: 'BLOCKED' | 'NOT_SUBMITTED';
      commandFingerprint: string;
      submitAttempted: false;
      intentReceipt?: KeywordBidIntentReceipt;
      error: KeywordBidSafeError;
      observedAt: string;
    }
  | {
      phase: 'apply';
      status: 'UNKNOWN';
      commandFingerprint: string;
      submitAttempted: true;
      intentReceipt?: KeywordBidIntentReceipt;
      afterSnapshot?: KeywordBidPageSnapshot;
      afterEvidence?: KeywordBidScreenshotEvidence;
      error: KeywordBidSafeError;
      observedAt: string;
    };

export type KeywordBidReloadReadbackResult =
  | {
      phase: 'reload_readback';
      status: 'VERIFIED';
      commandFingerprint: string;
      afterSnapshot: KeywordBidPageSnapshot;
      afterEvidence: KeywordBidScreenshotEvidence;
      reloadSnapshot: KeywordBidPageSnapshot;
      reloadEvidence: KeywordBidScreenshotEvidence;
      observedAt: string;
    }
  | {
      phase: 'reload_readback';
      status: 'BLOCKED';
      commandFingerprint: string;
      error: KeywordBidSafeError;
      observedAt: string;
    }
  | {
      phase: 'reload_readback';
      status: 'UNKNOWN';
      commandFingerprint: string;
      afterSnapshot?: KeywordBidPageSnapshot;
      afterEvidence?: KeywordBidScreenshotEvidence;
      reloadSnapshot?: KeywordBidPageSnapshot;
      reloadEvidence?: KeywordBidScreenshotEvidence;
      error: KeywordBidSafeError;
      observedAt: string;
    };

export class KeywordBidAdapter {
  private readonly now: () => Date;

  constructor(
    private readonly page: KeywordBidPagePort,
    options: KeywordBidAdapterOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async preflight(command: KeywordBidCommand): Promise<KeywordBidPreflightResult> {
    const commandFingerprint = fingerprintCommand(command);
    const observedAt = this.timestamp();
    try {
      assertCommand(command);
      let snapshot = await this.page.readSnapshot(command);
      assertSnapshotMatchesCommand(snapshot, command, command.expectedBeforeBidCents);
      await this.page.captureScreenshot(command.evidencePaths.before);
      const confirmedSnapshot = await this.page.readSnapshot(command);
      assertEvidenceCaptureStable(snapshot, confirmedSnapshot, command, command.expectedBeforeBidCents);
      snapshot = confirmedSnapshot;
      return {
        phase: 'preflight',
        status: 'READY',
        commandFingerprint,
        snapshot,
        beforeEvidence: {
          stage: 'before',
          path: command.evidencePaths.before,
          pageIdentity: snapshot.pageIdentity,
          capturedAt: this.timestamp(),
        },
        observedAt,
      };
    } catch (error) {
      return {
        phase: 'preflight',
        status: 'BLOCKED',
        commandFingerprint,
        error: safeError(error, 'PREFLIGHT_BLOCKED', '关键词降价预检未通过。'),
        observedAt,
      };
    }
  }

  async apply(
    command: KeywordBidCommand,
    preflight: KeywordBidPreflightResult,
    hooks: KeywordBidApplyHooks,
  ): Promise<KeywordBidApplyResult> {
    const commandFingerprint = fingerprintCommand(command);
    const observedAt = this.timestamp();
    let submitAttempted = false;
    let intentReceipt: KeywordBidIntentReceipt | undefined;
    let afterSnapshot: KeywordBidPageSnapshot | undefined;
    let afterEvidence: KeywordBidScreenshotEvidence | undefined;

    try {
      assertCommand(command);
      if (preflight.status !== 'READY' || preflight.commandFingerprint !== commandFingerprint) {
        throw new KeywordBidContractError(
          'PREFLIGHT_NOT_CURRENT',
          '关键词降价预检不存在或不再属于当前命令。',
        );
      }

      const current = await this.page.readSnapshot(command);
      assertSnapshotMatchesCommand(current, command, command.expectedBeforeBidCents);
      await this.page.fillBid(command, command.targetBidCents);
      const draft = await this.page.readSnapshot(command);
      assertSnapshotMatchesCommand(draft, command, command.targetBidCents);

      // Resolve the exact stable save control first. The Main hook below is the
      // final transactional permit claim and policy/session revalidation; once
      // it returns there is no further DOM await before the one click.
      const submitControl = await this.page.prepareSave(command);
      const returnedReceipt = await hooks.beforeSubmit({
        commandFingerprint,
        missionGrantId: command.missionGrantId,
        storeId: command.storeId,
        browserProfileId: command.browserProfileId,
        sessionGeneration: command.sessionGeneration,
        adsAccountId: command.adsAccountId,
        campaignId: command.campaignId,
        adGroupId: command.adGroupId,
        keywordId: command.keywordId,
        objectRevision: command.objectRevision,
        expectedBeforeBidCents: command.expectedBeforeBidCents,
        targetBidCents: command.targetBidCents,
        preflightObservedAt: preflight.observedAt,
      });
      assertIntentReceipt(returnedReceipt, commandFingerprint);
      intentReceipt = {
        intentId: returnedReceipt.intentId,
        persistedAt: returnedReceipt.persistedAt,
        commandFingerprint: returnedReceipt.commandFingerprint,
      };
      submitAttempted = true;
      await submitControl.clickOnce();
      afterSnapshot = await this.page.readSnapshot(command);
      assertSnapshotIdentityMatchesCommand(afterSnapshot, command);
      await this.page.captureScreenshot(command.evidencePaths.after);
      const confirmedAfterSnapshot = await this.page.readSnapshot(command);
      assertEvidenceCaptureStable(afterSnapshot, confirmedAfterSnapshot, command, confirmedAfterSnapshot.keyword.bidCents);
      afterSnapshot = confirmedAfterSnapshot;
      afterEvidence = {
        stage: 'after',
        path: command.evidencePaths.after,
        pageIdentity: afterSnapshot.pageIdentity,
        capturedAt: this.timestamp(),
      };
      return {
        phase: 'apply',
        status: 'SUBMITTED',
        commandFingerprint,
        submitAttempted: true,
        intentReceipt,
        afterSnapshot,
        afterEvidence,
        observedAt,
      };
    } catch (error) {
      if (submitAttempted) {
        return {
          phase: 'apply',
          status: 'UNKNOWN',
          commandFingerprint,
          submitAttempted: true,
          ...(intentReceipt ? { intentReceipt } : {}),
          ...(afterSnapshot ? { afterSnapshot } : {}),
          ...(afterEvidence ? { afterEvidence } : {}),
          error: safeError(
            error,
            'SUBMIT_OUTCOME_UNKNOWN',
            '提交边界已进入，但无法证明外部写入结果；禁止自动重试。',
          ),
          observedAt,
        };
      }
      const blocked = error instanceof KeywordBidBlockedError;
      return {
        phase: 'apply',
        status: blocked ? 'BLOCKED' : 'NOT_SUBMITTED',
        commandFingerprint,
        submitAttempted: false,
        ...(intentReceipt ? { intentReceipt } : {}),
        error: safeError(
          error,
          blocked ? 'APPLY_BLOCKED' : 'NOT_SUBMITTED',
          blocked ? '关键词降价提交前校验未通过。' : '尚未进入提交边界，未点击保存。',
        ),
        observedAt,
      };
    }
  }

  async reloadReadback(
    command: KeywordBidCommand,
    applyResult: KeywordBidApplyResult,
  ): Promise<KeywordBidReloadReadbackResult> {
    const commandFingerprint = fingerprintCommand(command);
    const observedAt = this.timestamp();
    let reloadSnapshot: KeywordBidPageSnapshot | undefined;
    let reloadEvidence: KeywordBidScreenshotEvidence | undefined;

    try {
      assertCommand(command);
      if (applyResult.commandFingerprint !== commandFingerprint
        || applyResult.status === 'BLOCKED'
        || applyResult.status === 'NOT_SUBMITTED'
        || !applyResult.submitAttempted) {
        throw new KeywordBidContractError(
          'SUBMIT_NOT_ATTEMPTED',
          '当前命令没有已进入提交边界的结果，禁止执行回读。',
        );
      }

      await this.page.reload();
      reloadSnapshot = await this.page.readSnapshot(command);
      assertSnapshotIdentityMatchesCommand(reloadSnapshot, command);
      await this.page.captureScreenshot(command.evidencePaths.reload);
      const confirmedReloadSnapshot = await this.page.readSnapshot(command);
      assertEvidenceCaptureStable(
        reloadSnapshot,
        confirmedReloadSnapshot,
        command,
        confirmedReloadSnapshot.keyword.bidCents,
      );
      reloadSnapshot = confirmedReloadSnapshot;
      reloadEvidence = {
        stage: 'reload',
        path: command.evidencePaths.reload,
        pageIdentity: reloadSnapshot.pageIdentity,
        capturedAt: this.timestamp(),
      };

      const hasIndependentAfterProof = applyResult.status === 'SUBMITTED'
        && applyResult.afterSnapshot.keyword.bidCents === command.targetBidCents
        && applyResult.afterEvidence.stage === 'after';
      const reloadMatchesTarget = reloadSnapshot.keyword.bidCents === command.targetBidCents;
      if (!hasIndependentAfterProof || !reloadMatchesTarget) {
        throw new KeywordBidContractError(
          'READBACK_NOT_VERIFIED',
          '提交后证据与独立刷新回读未同时命中目标竞价。',
        );
      }

      return {
        phase: 'reload_readback',
        status: 'VERIFIED',
        commandFingerprint,
        afterSnapshot: applyResult.afterSnapshot,
        afterEvidence: applyResult.afterEvidence,
        reloadSnapshot,
        reloadEvidence,
        observedAt,
      };
    } catch (error) {
      const submitWasAttempted = applyResult.commandFingerprint === commandFingerprint
        && (applyResult.status === 'SUBMITTED' || applyResult.status === 'UNKNOWN')
        && applyResult.submitAttempted;
      if (!submitWasAttempted) {
        return {
          phase: 'reload_readback',
          status: 'BLOCKED',
          commandFingerprint,
          error: safeError(error, 'READBACK_BLOCKED', '执行回读不属于当前已提交命令。'),
          observedAt,
        };
      }
      return {
        phase: 'reload_readback',
        status: 'UNKNOWN',
        commandFingerprint,
        ...(applyResult.status === 'SUBMITTED' || applyResult.afterSnapshot
          ? { afterSnapshot: applyResult.afterSnapshot }
          : {}),
        ...(applyResult.status === 'SUBMITTED' || applyResult.afterEvidence
          ? { afterEvidence: applyResult.afterEvidence }
          : {}),
        ...(reloadSnapshot ? { reloadSnapshot } : {}),
        ...(reloadEvidence ? { reloadEvidence } : {}),
        error: safeError(
          error,
          'READBACK_OUTCOME_UNKNOWN',
          '已进入提交边界，但独立刷新回读无法证明目标竞价；禁止自动重试。',
        ),
        observedAt,
      };
    }
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

/** Safe, non-secret contract failure that callers may classify as BLOCKED. */
export class KeywordBidBlockedError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'KeywordBidBlockedError';
  }
}

class KeywordBidContractError extends KeywordBidBlockedError {}

function assertCommand(command: KeywordBidCommand): void {
  if (!command || typeof command !== 'object') {
    throw new KeywordBidContractError('INVALID_COMMAND', '关键词降价命令无效。');
  }
  if (command.actionType !== 'set_keyword_bid') {
    throw new KeywordBidContractError('ACTION_NOT_ALLOWED', 'V1 只允许 set_keyword_bid。');
  }
  if (command.marketplace !== 'US' || command.currency !== 'USD') {
    throw new KeywordBidContractError('MARKET_NOT_ALLOWED', 'V1 只允许 US/USD。');
  }
  assertBoundedText(command.missionGrantId, 'MISSION_GRANT_INVALID', '授权 ID 无效。');
  assertBoundedText(command.storeId, 'STORE_ID_INVALID', '店铺 ID 无效。');
  assertBoundedText(command.browserProfileId, 'BROWSER_PROFILE_INVALID', '浏览器配置 ID 无效。');
  for (const identifier of [
    command.adsAccountId,
    command.campaignId,
    command.adGroupId,
    command.keywordId,
  ]) {
    if (!isSafeSelectorIdentifier(identifier)) {
      throw new KeywordBidContractError('IDENTIFIER_INVALID', '广告对象稳定 ID 无效。');
    }
  }
  if (!Number.isSafeInteger(command.sessionGeneration) || command.sessionGeneration < 0) {
    throw new KeywordBidContractError('SESSION_GENERATION_INVALID', '浏览器会话代数无效。');
  }
  if (!Number.isSafeInteger(command.objectRevision) || command.objectRevision < 1) {
    throw new KeywordBidContractError('OBJECT_REVISION_INVALID', '广告对象修订号无效。');
  }
  if (!Number.isSafeInteger(command.expectedBeforeBidCents)
    || command.expectedBeforeBidCents <= 0
    || !Number.isSafeInteger(command.targetBidCents)
    || command.targetBidCents <= 0) {
    throw new KeywordBidContractError('BID_CENTS_INVALID', '竞价必须是正数整数美分。');
  }
  assertPageIdentityExpectation(command.pageIdentityExpectation);
  assertEvidencePaths(command.evidencePaths);
  if (command.targetBidCents >= command.expectedBeforeBidCents) {
    throw new KeywordBidContractError('LOWER_BID_ONLY', '目标竞价必须低于执行前竞价。');
  }
  if (!Number.isFinite(command.maxChangePct) || command.maxChangePct <= 0 || command.maxChangePct > 10) {
    throw new KeywordBidContractError('CHANGE_LIMIT_INVALID', '竞价降幅上限必须大于 0 且不超过 10%。');
  }
  const changePct = ((command.expectedBeforeBidCents - command.targetBidCents)
    / command.expectedBeforeBidCents) * 100;
  if (changePct > Math.min(10, command.maxChangePct) + 1e-8) {
    throw new KeywordBidContractError('CHANGE_LIMIT_EXCEEDED', '目标竞价超过授权降幅。');
  }
}

function assertSnapshotMatchesCommand(
  snapshot: KeywordBidPageSnapshot,
  command: KeywordBidCommand,
  expectedBidCents: number,
): void {
  assertSnapshotIdentityMatchesCommand(snapshot, command);
  if (snapshot.keyword.bidCents !== expectedBidCents) {
    throw new KeywordBidContractError('EXPECTED_BEFORE_MISMATCH', '页面当前竞价与 expected-before 不一致。');
  }
}

function assertEvidenceCaptureStable(
  beforeCapture: KeywordBidPageSnapshot,
  afterCapture: KeywordBidPageSnapshot,
  command: KeywordBidCommand,
  expectedBidCents: number,
): void {
  assertSnapshotMatchesCommand(beforeCapture, command, expectedBidCents);
  if (fingerprintKeywordBidPageSnapshot(beforeCapture) !== fingerprintKeywordBidPageSnapshot(afterCapture)) {
    throw new KeywordBidContractError(
      'EVIDENCE_CAPTURE_DRIFT',
      '截图捕获期间页面对象身份发生变化，证据无效。',
    );
  }
  assertSnapshotMatchesCommand(afterCapture, command, expectedBidCents);
}

function assertSnapshotIdentityMatchesCommand(
  snapshot: KeywordBidPageSnapshot,
  command: KeywordBidCommand,
): void {
  const identity = snapshot.pageIdentity;
  if (identity.origin !== command.pageIdentityExpectation.origin
    || identity.pathname !== command.pageIdentityExpectation.pathname
    || identity.url !== canonicalSafePageUrl(command.adsAccountId, command.campaignId)
    || identity.adsAccountId !== command.adsAccountId
    || identity.campaignId !== command.campaignId
    || identity.marketplace !== command.marketplace
    || identity.currency !== command.currency) {
    throw new KeywordBidContractError('PAGE_IDENTITY_MISMATCH', '页面身份与关键词降价命令不一致。');
  }
  if (command.pageIdentityExpectation.requiredTextMarkers.some(
    (marker) => !identity.matchedTextMarkers.includes(marker),
  )) {
    throw new KeywordBidContractError('PAGE_IDENTITY_MISMATCH', '页面身份标记不完整。');
  }
  if (snapshot.keyword.keywordId !== command.keywordId
    || snapshot.keyword.adGroupId !== command.adGroupId) {
    throw new KeywordBidContractError('KEYWORD_IDENTITY_MISMATCH', '关键词稳定身份与命令不一致。');
  }
}

function assertSnapshotIdentityShape(snapshot: KeywordBidPageSnapshot): void {
  if (!snapshot || typeof snapshot !== 'object' || !snapshot.pageIdentity || !snapshot.keyword) {
    throw new KeywordBidContractError('PAGE_IDENTITY_INVALID', '页面身份快照无效。');
  }
  const identity = snapshot.pageIdentity;
  if (identity.origin !== LINGXING_KEYWORD_BID_ORIGIN
    || identity.pathname !== LINGXING_KEYWORD_BID_PATH
    || identity.marketplace !== 'US'
    || identity.currency !== 'USD'
    || !isSafeSelectorIdentifier(identity.adsAccountId)
    || !isSafeSelectorIdentifier(identity.campaignId)
    || !isSafeSelectorIdentifier(snapshot.keyword.adGroupId)
    || !isSafeSelectorIdentifier(snapshot.keyword.keywordId)) {
    throw new KeywordBidContractError('PAGE_IDENTITY_INVALID', '页面身份快照不属于 US/USD 关键词对象。');
  }
}

function assertIntentReceipt(receipt: KeywordBidIntentReceipt, commandFingerprint: string): void {
  if (!receipt
    || typeof receipt.intentId !== 'string'
    || !receipt.intentId.trim()
    || receipt.intentId !== receipt.intentId.trim()
    || receipt.intentId.length > 240
    || /[\u0000-\u001f\u007f]/.test(receipt.intentId)) {
    throw new KeywordBidContractError('INTENT_NOT_PERSISTED', '提交意图未返回持久化凭据。');
  }
  if (typeof receipt.persistedAt !== 'string'
    || !Number.isFinite(Date.parse(receipt.persistedAt))
    || new Date(receipt.persistedAt).toISOString() !== receipt.persistedAt) {
    throw new KeywordBidContractError('INTENT_NOT_PERSISTED', '提交意图持久化时间无效。');
  }
  if (receipt.commandFingerprint !== commandFingerprint) {
    throw new KeywordBidContractError('INTENT_NOT_PERSISTED', '提交意图未绑定当前命令。');
  }
}

function fingerprintCommand(command: KeywordBidCommand): string {
  let serialized = 'INVALID_KEYWORD_BID_COMMAND';
  try {
    const markers = Array.isArray(command?.pageIdentityExpectation?.requiredTextMarkers)
      && command.pageIdentityExpectation.requiredTextMarkers.every((marker) => typeof marker === 'string')
      ? [...command.pageIdentityExpectation.requiredTextMarkers].sort()
      : null;
    serialized = JSON.stringify({
      version: 'keyword-bid-command-v1',
      actionType: command?.actionType ?? null,
      missionGrantId: command?.missionGrantId ?? null,
      storeId: command?.storeId ?? null,
      browserProfileId: command?.browserProfileId ?? null,
      sessionGeneration: command?.sessionGeneration ?? null,
      marketplace: command?.marketplace ?? null,
      currency: command?.currency ?? null,
      adsAccountId: command?.adsAccountId ?? null,
      campaignId: command?.campaignId ?? null,
      adGroupId: command?.adGroupId ?? null,
      keywordId: command?.keywordId ?? null,
      objectRevision: command?.objectRevision ?? null,
      expectedBeforeBidCents: command?.expectedBeforeBidCents ?? null,
      targetBidCents: command?.targetBidCents ?? null,
      maxChangePct: command?.maxChangePct ?? null,
      pageIdentityExpectation: {
        origin: command?.pageIdentityExpectation?.origin ?? null,
        pathname: command?.pageIdentityExpectation?.pathname ?? null,
        requiredTextMarkers: markers,
      },
      evidencePaths: {
        before: command?.evidencePaths?.before ?? null,
        after: command?.evidencePaths?.after ?? null,
        reload: command?.evidencePaths?.reload ?? null,
      },
    });
  } catch {}
  return createHash('sha256').update(serialized).digest('hex');
}

function assertBoundedText(value: string, code: string, message: string): void {
  if (typeof value !== 'string'
    || !value.trim()
    || value !== value.trim()
    || value.length > 240
    || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new KeywordBidContractError(code, message);
  }
}

function isSafeSelectorIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value);
}

function assertPageIdentityExpectation(value: KeywordBidPageIdentityExpectation): void {
  if (!value
    || value.origin !== LINGXING_KEYWORD_BID_ORIGIN
    || value.pathname !== LINGXING_KEYWORD_BID_PATH
    || !Array.isArray(value.requiredTextMarkers)
    || value.requiredTextMarkers.length > 8
  ) {
    throw new KeywordBidContractError('PAGE_EXPECTATION_INVALID', '页面身份期望必须绑定 Lingxing 关键词报表。');
  }
  for (const marker of value.requiredTextMarkers) {
    if (typeof marker !== 'string'
      || !marker
      || marker.length > 40
      || /[\u0000-\u001f\u007f]/.test(marker)) {
      throw new KeywordBidContractError('PAGE_EXPECTATION_INVALID', '页面身份标记无效。');
    }
  }
  if (new Set(value.requiredTextMarkers).size !== value.requiredTextMarkers.length) {
    throw new KeywordBidContractError('PAGE_EXPECTATION_INVALID', '页面身份标记重复。');
  }
}

function assertEvidencePaths(value: KeywordBidEvidencePaths): void {
  if (!value || typeof value !== 'object') {
    throw new KeywordBidContractError('EVIDENCE_PATHS_INVALID', '三段截图路径无效。');
  }
  const paths = [value.before, value.after, value.reload];
  for (const path of paths) {
    if (typeof path !== 'string'
      || path.length > 1024
      || !win32.isAbsolute(path)
      || win32.extname(path).toLowerCase() !== '.png'
      || /[\u0000-\u001f\u007f]/.test(path)) {
      throw new KeywordBidContractError('EVIDENCE_PATHS_INVALID', '截图路径必须是 Main 选择的绝对 PNG 路径。');
    }
  }
  if (new Set(paths.map((path) => win32.normalize(path).toLocaleLowerCase('en-US'))).size !== 3) {
    throw new KeywordBidContractError('EVIDENCE_PATHS_INVALID', 'before/after/reload 截图路径必须互不相同。');
  }
}

function canonicalSafePageUrl(adsAccountId: string, campaignId: string): string {
  return `${LINGXING_KEYWORD_BID_ORIGIN}${LINGXING_KEYWORD_BID_PATH}`
    + `?profile_id=${encodeURIComponent(adsAccountId)}&id=${encodeURIComponent(campaignId)}`;
}

function safeError(
  error: unknown,
  fallbackCode: string,
  fallbackMessage: string,
): KeywordBidSafeError {
  if (error instanceof KeywordBidBlockedError) {
    return { code: error.code, message: error.message };
  }
  return { code: fallbackCode, message: fallbackMessage };
}

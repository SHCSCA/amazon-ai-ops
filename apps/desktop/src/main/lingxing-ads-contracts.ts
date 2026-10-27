// 职责模块保留原有公开接口及安全校验边界。
import type { BrowserContext, Locator, Page, Response } from 'playwright';

export interface LingxingAdsProfileEvidence {
    readonly alias: string;
    readonly country: 'US';
    readonly externalAccountId: string;
}

export interface LingxingAdsSsoController {
    getPage(): Page | null;
    getContext(): BrowserContext | null;
    setActivePage(page: Page): void;
}

export interface DiscoverLingxingAdsKeywordTargetInput {
    readonly externalAccountId: string;
    readonly campaignName: string;
    readonly adGroupName: string;
    readonly entityName: string;
    readonly matchType: string;
    readonly currentBidCents: number | 'read_current';
}

export interface LingxingKeywordTargetRowSnapshot {
    readonly headers: readonly string[];
    readonly cellTexts: readonly string[];
    readonly keywordIds: readonly string[];
    readonly bidValues: readonly string[];
    readonly adGroupIds: readonly string[];
    readonly adGroupNames: readonly string[];
}

export interface DiscoveredLingxingAdsKeywordTarget {
    readonly adsAccountId: string;
    readonly campaignId: string;
    readonly adGroupId: string;
    readonly keywordId: string;
    readonly bidCents: number;
}

export interface NavigateLingxingAdsCampaignKeywordTargetInput {
    readonly externalAccountId: string;
    readonly campaignName: string;
    readonly expectedStoreAlias?: string;
}

export type LingxingAdsPageState = Readonly<{
    url: string;
    title?: string;
    bodyText?: string;
    hasAccountInput?: boolean;
    hasPasswordInput?: boolean;
}>;

export const ADS_SSO_TIMEOUT_MS = 45000;

export const ADS_PROFILE_LIST_PATH = '/common/common_list/common_list/get_profile_list';

export const ADS_PROFILE_ENTRY_RESPONSE_GRACE_MS = 5000;

export const ADS_CHANGE_ANNOUNCEMENT_MAX_INTERACTIONS = 64;

export const ADS_NAVIGATION_CONTEXT_READ_ATTEMPTS = 4;

export const ADS_NAVIGATION_CONTEXT_RETRY_WAIT_MS = 250;

export const ADS_PENDING_NAVIGATION_PAGE_RECOVERY_ATTEMPTS = 4;

export const ADS_PENDING_NAVIGATION_PAGE_RECOVERY_WAIT_MS = 100;

export const ADS_STORE_FILTER_READY_ATTEMPTS = 40;

export const ADS_STORE_FILTER_READY_POLL_MS = 250;

export const ERP_ADS_ENTRY_READY_ATTEMPTS = 60;

export const ERP_ADS_ENTRY_READY_POLL_MS = 250;

export const ADS_CHANGE_ANNOUNCEMENT_DIALOG_SELECTOR = [
    '.el-dialog:visible',
    '.ant-modal:visible',
    '[role="dialog"]:visible',
].join(', ');

export const ADS_CHANGE_ANNOUNCEMENT_TITLE_SELECTOR = [
    '.el-dialog__header',
    '.ant-modal-title',
    '[class*="dialog"][class*="title"]',
    '[class*="modal"][class*="title"]',
    '[role="heading"]',
].join(', ');

export const LINGXING_TRANSIENT_TOAST_SELECTOR = [
    '#toast-container [aria-live="polite"]:visible',
    '#toast-container .toast-success:visible',
    '#toast-container .toast-error:visible',
].join(', ');

export const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export const MAX_IDENTITY_LENGTH = 256;

export const LINGXING_KEYWORD_TARGET_PATH = '/ad_report/target/index/index';

export const LINGXING_KEYWORD_DETAIL_PATH = '/ad_report/keyword/index/index';

export const LINGXING_SAFE_SELECTOR_ID = /^[A-Za-z0-9._:-]+$/u;

export type LingxingVisibleLink = Readonly<{
    href: string;
    text: string;
}>;

export type CapturedLingxingAdsProfileResponse = Readonly<{
    ok: boolean;
    payload: Promise<unknown>;
}>;

export type LingxingAdsProfileResponseSlot = {
    promise: Promise<CapturedLingxingAdsProfileResponse>;
    resolve: (response: CapturedLingxingAdsProfileResponse) => void;
    settled: boolean;
};

export type LingxingAdsAnnouncementAction = Readonly<{
    dialogIndex: number;
    actionIndex: number;
    actionText: string;
    fingerprint: string;
}>;

export type LingxingVisibleProvider = 'lingxing' | 'amazon_ads';

export type LegacyLingxingAdsDropdownReference = Readonly<{
    documentIndex: number | null;
    visibleIndex: number;
}>;

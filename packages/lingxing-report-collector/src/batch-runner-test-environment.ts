// 按证据职责拆分共享夹具与断言，保留原有完整测试名称。

import * as fs from 'fs';

import * as os from 'os';

import * as path from 'path';

import * as XLSX from 'xlsx';

import { describe, expect, it } from 'vitest';

import { normalizeStoreContextEnvelope, type LingxingCreateReportOutcome, type LingxingReportDefinition, } from '@amazon-ai-ops/shared-types';

import { downloadExistingLingxingReportBatch, runLingxingReportBatch, type LingxingInPlaceResumeState, type RunBatchOptions, } from './batch-runner';

const TEST_STORE_CONTEXT = normalizeStoreContextEnvelope({
    storeId: 'shc001',
    browserProfileId: 'profile-shc001',
    marketplace: 'US',
    currency: 'USD',
    businessTimezone: 'America/Los_Angeles',
    businessDate: '2026-05-25',
    sessionGeneration: 7,
});

const REPORT_DIMENSION_HEADER: Record<LingxingReportDefinition['type'], string> = {
    campaign: '广告活动',
    ad_group: '广告组',
    placement: '广告位',
    advertised_product: '推广的商品',
    auto_targeting: '自动投放',
    keyword: '关键词',
    product_targeting: '商品投放',
    user_search_term: '用户搜索词',
};

type LegacyTestOptions = Omit<RunBatchOptions, 'requestId' | 'storeContext' | 'storeDisplayName' | 'progressSink' | 'authorityGuard' | 'cancellationGuard' | 'automation' | 'reportContentInspector'> & {
    automation: Omit<RunBatchOptions['automation'], 'createReport'> & {
        createReport: (...args: Parameters<RunBatchOptions['automation']['createReport']>) => Promise<unknown>;
    };
    storeName?: string;
    marketplaceCode?: string;
};
export { fs, os, path, XLSX, describe, expect, it, normalizeStoreContextEnvelope, type LingxingCreateReportOutcome, type LingxingReportDefinition, downloadExistingLingxingReportBatch, runLingxingReportBatch, type LingxingInPlaceResumeState, type RunBatchOptions, type LegacyTestOptions, TEST_STORE_CONTEXT, REPORT_DIMENSION_HEADER };

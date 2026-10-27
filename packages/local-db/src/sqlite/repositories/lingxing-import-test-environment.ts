// 按证据职责拆分共享夹具与断言，保留原有完整测试名称。

import * as fs from 'fs';

import * as os from 'os';

import * as path from 'path';

import type Database from 'better-sqlite3';

import { afterEach, describe, expect, it } from 'vitest';

import { normalizeStoreCapabilityId, normalizeStoreId, normalizeStoreContextEnvelope, type AdDailyMetrics, type LingxingCollectionJobSnapshot, type LingxingReportBatch, type LingxingReportFile, type StoreId, } from '@amazon-ai-ops/shared-types';

import { initSqlite } from '../db';

import { StoreRepository } from './store-repo';

import { fingerprintLingxingCollectionAuthorityProof, LingxingImportRepository, reconcileUsdAmount, type CommitReportImportInput, } from './lingxing-import-repo';

const databases: Database.Database[] = [];

const tempDirectories: string[] = [];

const AUTHORITY_REPORT_TYPES = [
    'campaign', 'ad_group', 'placement', 'advertised_product',
    'auto_targeting', 'keyword', 'product_targeting', 'user_search_term',
] as const;

afterEach(() => {
    while (databases.length) {
        const database = databases.pop();
        if (database?.open)
            database.close();
    }
    while (tempDirectories.length) {
        const directory = tempDirectories.pop();
        if (directory)
            fs.rmSync(directory, { recursive: true, force: true });
    }
});
export { fs, os, path, type Database, afterEach, describe, expect, it, normalizeStoreCapabilityId, normalizeStoreId, normalizeStoreContextEnvelope, type AdDailyMetrics, type LingxingCollectionJobSnapshot, type LingxingReportBatch, type LingxingReportFile, type StoreId, initSqlite, StoreRepository, fingerprintLingxingCollectionAuthorityProof, LingxingImportRepository, reconcileUsdAmount, type CommitReportImportInput, databases, tempDirectories, AUTHORITY_REPORT_TYPES };

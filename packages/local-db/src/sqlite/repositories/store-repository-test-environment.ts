// 按证据职责拆分共享夹具与断言，保留原有完整测试名称。

import * as fs from 'fs';

import * as os from 'os';

import * as path from 'path';

import Database from 'better-sqlite3';

import { afterEach, describe, expect, it } from 'vitest';

import { normalizeBrowserProfileId, normalizeStoreCapabilityId, normalizeStoreId, } from '@amazon-ai-ops/shared-types';

import { initSqlite, SQLITE_MIGRATION_CONTRACT } from '../db';

import { StoreRepository, StoreRepositoryError } from './store-repo';

const tempDirs: string[] = [];

afterEach(() => {
    while (tempDirs.length) {
        const dir = tempDirs.pop();
        if (dir)
            fs.rmSync(dir, { recursive: true, force: true });
    }
});
export { fs, os, path, Database, afterEach, describe, expect, it, normalizeBrowserProfileId, normalizeStoreCapabilityId, normalizeStoreId, initSqlite, SQLITE_MIGRATION_CONTRACT, StoreRepository, StoreRepositoryError, tempDirs };

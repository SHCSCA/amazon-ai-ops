import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type Database from 'better-sqlite3';
import { afterEach } from 'vitest';
import { normalizeStoreContextEnvelope, type PolicyVersionRules, type StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { initSqlite } from '../db';
import { ExecutionAuthorityRepository } from './execution-authority-repo';
import { seedStage5Authority } from './execution-authority-repo.test-authority';
export const NOW = '2026-07-23T02:00:00.000Z';

export const PAGE_HASH = 'a'.repeat(64);

export const PROOF_HASH = 'b'.repeat(64);

export const COMMAND_HASH = 'c'.repeat(64);

export const tempDirs: string[] = [];

export const databases: Database.Database[] = [];

afterEach(() => {
  while (databases.length > 0) {
    const database = databases.pop();
    if (database?.open) database.close();
  }
  while (tempDirs.length > 0) {
    const directory = tempDirs.pop();
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  }
});

export interface Harness {
  database: Database.Database;
  databasePath: string;
  context: StoreContextEnvelope;
  repository: ExecutionAuthorityRepository;
}

export function createHarness(
  maxChangePct = 10,
  totalImpactBudget = 10,
  actionCount = 1,
  issuerType: 'human' | 'policy' = 'human',
  rateLimits: Partial<PolicyVersionRules> = {},
): Harness {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-execution-repo-'));
  tempDirs.push(directory);
  const databasePath = path.join(directory, 'app.db');
  const database = initSqlite(databasePath);
  databases.push(database);
  seedStage5Authority(database, maxChangePct, totalImpactBudget, actionCount, issuerType, rateLimits);
  const context = normalizeStoreContextEnvelope({
    storeId: 'store-one',
    browserProfileId: 'profile-one',
    marketplace: 'US',
    currency: 'USD',
    businessTimezone: 'America/Los_Angeles',
    businessDate: '2026-07-22',
    sessionGeneration: 4,
  });
  return {
    database,
    databasePath,
    context,
    repository: new ExecutionAuthorityRepository(database, { now: () => new Date(NOW) }),
  };
}

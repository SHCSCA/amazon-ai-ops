import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import { normalizeStoreId } from '@amazon-ai-ops/shared-types';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertCurrentWritableAdTargetAuthority,
  resolveWritableAdTargetAuthority,
} from './writable-ad-target-resolution';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function createFixture() {
  const storeId = normalizeStoreId('store-one');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-writable-target-'));
  tempDirs.push(dir);
  const sourceFile = path.join(dir, 'keyword.xlsx');
  const identityProofPath = path.join(dir, 'ads-ui-keyword-identity.png');
  fs.writeFileSync(sourceFile, 'keyword report');
  fs.writeFileSync(identityProofPath, 'identity proof');
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE ad_daily_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id TEXT,
      batch_id TEXT,
      report_type TEXT,
      date TEXT,
      store_name TEXT,
      marketplace_code TEXT,
      asin TEXT,
      campaign_name TEXT,
      ad_group_name TEXT,
      targeting TEXT,
      match_type TEXT,
      source_file TEXT,
      source_row INTEGER
    );
  `);
  db.prepare(`
    INSERT INTO ad_daily_metrics (
      store_id, batch_id, report_type, date, store_name, marketplace_code, asin,
      campaign_name, ad_group_name, targeting, match_type, source_file, source_row
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    storeId, 'batch_current', 'keyword', '2026-06-23', 'Historical Display Name', 'US', 'B0TESTASIN',
    'Campaign A', 'Ad Group A', 'door lock', 'exact', sourceFile, 611,
  );
  return {
    db,
    storeId,
    sourceFile,
    identityProofPath,
    scope: {
      dateFrom: '2026-05-21',
      dateTo: '2026-06-23',
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      asin: 'B0TESTASIN',
      batchId: 'batch_current',
    },
    candidate: {
      entityType: 'keyword' as const,
      entityId: 'amzn-keyword-opaque-123',
      sourceFile,
      sourceRow: 611,
      identitySource: 'ads_ui' as const,
      identityProofPath,
      verificationNote: 'Matched the editable keyword row in authenticated Ads UI.',
    },
  };
}

describe('writable Ads target authority', () => {
  it('uses store_id authority across display-name changes and ignores another store same batch/source row', () => {
    const fixture = createFixture();
    fixture.db.prepare(`
      INSERT INTO ad_daily_metrics (
        store_id, batch_id, report_type, date, store_name, marketplace_code, asin,
        campaign_name, ad_group_name, targeting, match_type, source_file, source_row
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'store-two', 'batch_current', 'keyword', '2026-06-23', 'Other Store', 'US', 'B0TESTASIN',
      'Campaign A', 'Ad Group A', 'door lock', 'exact', fixture.sourceFile, 611,
    );
    try {
      expect(resolveWritableAdTargetAuthority(fixture.db, {
        storeId: fixture.storeId,
        scope: { ...fixture.scope, storeName: 'Renamed Logical Store' },
        candidate: fixture.candidate,
        allowedSourceFiles: [fixture.sourceFile],
        syntheticRecommendationEntityId: 'Campaign A_Ad Group A_door lock',
        verifiedBy: 'Alice',
        verifiedAt: '2026-07-16T03:00:00.000Z',
      })).toMatchObject({ sourceRow: 611, entityName: 'door lock' });
    } finally {
      fixture.db.close();
    }
  });

  it('resolves one current-batch keyword row into a canonical writable target', () => {
    const fixture = createFixture();
    try {
      const result = resolveWritableAdTargetAuthority(fixture.db, {
        storeId: fixture.storeId,
        scope: fixture.scope,
        candidate: fixture.candidate,
        allowedSourceFiles: [fixture.sourceFile],
        syntheticRecommendationEntityId: 'Campaign A_Ad Group A_door lock',
        verifiedBy: 'Alice',
        verifiedAt: '2026-07-16T03:00:00.000Z',
      });

      expect(result).toMatchObject({
        entityType: 'keyword',
        entityId: 'amzn-keyword-opaque-123',
        entityName: 'door lock',
        campaignName: 'Campaign A',
        adGroupName: 'Ad Group A',
        metricDate: '2026-06-23',
        sourceFile: fixture.sourceFile,
        sourceRow: 611,
        identitySource: 'ads_ui',
        verifiedBy: 'Alice',
      });
    } finally {
      fixture.db.close();
    }
  });

  it.each([
    ['read-only search term type', { entityType: 'search_term' }],
    ['synthetic recommendation id', { entityId: 'Campaign A_Ad Group A_door lock' }],
    ['missing identity source', { identitySource: '' }],
    ['missing proof', { identityProofPath: 'missing.png' }],
    ['foreign row', { sourceRow: 999 }],
  ])('fails closed for %s', (_label, candidateOverride) => {
    const fixture = createFixture();
    try {
      expect(() => resolveWritableAdTargetAuthority(fixture.db, {
        storeId: fixture.storeId,
        scope: fixture.scope,
        candidate: { ...fixture.candidate, ...candidateOverride } as any,
        allowedSourceFiles: [fixture.sourceFile],
        syntheticRecommendationEntityId: 'Campaign A_Ad Group A_door lock',
        verifiedBy: 'Alice',
        verifiedAt: '2026-07-16T03:00:00.000Z',
      })).toThrow(/可写对象/);
    } finally {
      fixture.db.close();
    }
  });

  it('rejects a stored writable target whose canonical row identity was tampered', () => {
    const fixture = createFixture();
    try {
      const target = resolveWritableAdTargetAuthority(fixture.db, {
        storeId: fixture.storeId,
        scope: fixture.scope,
        candidate: fixture.candidate,
        allowedSourceFiles: [fixture.sourceFile],
        syntheticRecommendationEntityId: 'Campaign A_Ad Group A_door lock',
        verifiedBy: 'Alice',
        verifiedAt: '2026-07-16T03:00:00.000Z',
      });

      expect(() => assertCurrentWritableAdTargetAuthority(fixture.db, {
        storeId: fixture.storeId,
        scope: fixture.scope,
        target: { ...target, entityName: 'forged target' },
        allowedSourceFiles: [fixture.sourceFile],
        syntheticRecommendationEntityId: 'Campaign A_Ad Group A_door lock',
      })).toThrow(/可写对象/);
    } finally {
      fixture.db.close();
    }
  });

  it('revalidates the writable target authority immediately before an approval CAS', () => {
    const source = fs.readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    const currentGate = source.slice(
      source.indexOf('function assertRecommendationCurrentDataGate'),
      source.indexOf('function handleResolveRecommendationReview'),
    );
    const currentTargetAuthority = source.slice(
      source.indexOf('function assertRecommendationWritableTargetCurrent'),
      source.indexOf('function validateCurrentAdReadbackEvidenceAuthority'),
    );

    expect(currentGate).toContain('assertRecommendationWritableTargetCurrent(');
    expect(currentTargetAuthority).toContain('const canonicalTarget = assertCurrentWritableAdTargetAuthority(');
    expect(currentTargetAuthority).toContain('getRecommendationWritableTargetOwnershipBlockers(');
    expect(currentTargetAuthority.indexOf('const canonicalTarget = assertCurrentWritableAdTargetAuthority('))
      .toBeLessThan(currentTargetAuthority.indexOf('getRecommendationWritableTargetOwnershipBlockers('));
  });
});

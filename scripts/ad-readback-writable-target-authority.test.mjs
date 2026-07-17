import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createValidAdReadbackEvidence,
  executeAdReadbackAuthorityDb,
  writeAdReadbackAuthorityDb,
} from './ad-readback-authority-db.test-fixture.mjs';

const require = createRequire(import.meta.url);
const { assertCurrentAdReadbackDbAuthority } = require('./ad-readback-authority-db.js');
const tempDirs = [];

afterEach(() => {
  while (tempDirs.length) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

function fixtureDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-writable-target-'));
  tempDirs.push(dir);
  return dir;
}

describe('ad readback writable target SQLite authority', () => {
  it('accepts one explicitly mapped current writable keyword row with identity proof', () => {
    const dir = fixtureDir();
    const evidence = createValidAdReadbackEvidence(dir);
    const dbPath = writeAdReadbackAuthorityDb(dir, evidence);

    expect(() => assertCurrentAdReadbackDbAuthority(evidence, { dbPath })).not.toThrow();
  });

  it('accepts a writable target row that is independently mapped from the recommendation metric row', () => {
    const dir = fixtureDir();
    const evidence = createValidAdReadbackEvidence(dir);
    const dbPath = writeAdReadbackAuthorityDb(dir, evidence, {
      writableTargetSourceRow: evidence.source.sourceRow + 7,
    });

    expect(() => assertCurrentAdReadbackDbAuthority(evidence, { dbPath })).not.toThrow();
  });

  it('rejects an otherwise valid approved row when it has no independently verified writable target', () => {
    const dir = fixtureDir();
    const evidence = createValidAdReadbackEvidence(dir);
    const dbPath = writeAdReadbackAuthorityDb(dir, evidence, {
      recommendationEvidence: { writableTarget: null },
    });

    expect(() => assertCurrentAdReadbackDbAuthority(evidence, { dbPath }))
      .toThrow(/writable Ads target|可写对象/i);
  });

  it('rejects an approved quant-review row when its review resolution is missing', () => {
    const dir = fixtureDir();
    const evidence = createValidAdReadbackEvidence(dir);
    const dbPath = writeAdReadbackAuthorityDb(dir, evidence, {
      recommendationEvidence: {
        quantReviewRequired: true,
        reviewResolution: null,
      },
    });

    expect(() => assertCurrentAdReadbackDbAuthority(evidence, { dbPath }))
      .toThrow(/review resolution|复核记录/i);
  });

  it('accepts an approved quant-review row with a matching prior-revision review resolution', () => {
    const dir = fixtureDir();
    const evidence = createValidAdReadbackEvidence(dir);
    evidence.authority.recommendationRevision = 2;
    evidence.source.recommendationRevision = 2;
    const writableTarget = {
      entityType: evidence.target.entityType,
      entityId: evidence.target.entityId,
      entityName: evidence.target.entityName,
      campaignName: evidence.target.campaignName,
      adGroupName: evidence.target.adGroupName,
      metricDate: evidence.target.metricDate,
      sourceFile: evidence.source.sourceFiles[0],
      sourceRow: evidence.source.sourceRow + 7,
      identitySource: 'ads_ui',
      verifiedBy: evidence.approval.approverName,
      verifiedAt: evidence.approval.confirmedAt,
      verificationNote: 'Matched against the current editable Ads target before approval.',
      identityProofPath: evidence.target.identityProofPath,
    };
    const dbPath = writeAdReadbackAuthorityDb(dir, evidence, {
      revision: 2,
      recommendationEvidence: {
        quantReviewRequired: true,
        writableTarget,
        reviewResolution: {
          schemaVersion: 1,
          fromStatus: 'needs_review',
          fromRevision: 0,
          resolvedRevision: 1,
          reviewedBy: 'Review Owner',
          reviewedAt: evidence.approval.confirmedAt,
          rationale: 'Confirmed one bounded keyword bid decrease against the current Ads target.',
          resolvedBlockers: ['quant_review_required'],
          scope: {
            dateFrom: evidence.authority.dateFrom,
            dateTo: evidence.authority.dateTo,
            storeName: evidence.authority.storeName,
            marketplaceCode: evidence.authority.marketplaceCode,
            asin: evidence.authority.asin,
            batchId: evidence.authority.batchId,
          },
          metricSource: {
            batchId: evidence.authority.batchId,
            sourceFiles: evidence.source.sourceFiles,
            sourceRow: evidence.source.sourceRow,
          },
          writableTarget,
        },
      },
    });

    expect(() => assertCurrentAdReadbackDbAuthority(evidence, { dbPath })).not.toThrow();
  });

  it('rejects target identity tampering after the approved SQLite snapshot was written', () => {
    const dir = fixtureDir();
    const evidence = createValidAdReadbackEvidence(dir);
    const dbPath = writeAdReadbackAuthorityDb(dir, evidence);
    evidence.target.entityId = 'keyword-forged';

    expect(() => assertCurrentAdReadbackDbAuthority(evidence, { dbPath }))
      .toThrow(/target\.entityId/);
  });

  it('rejects a synthetic recommendation entity id masquerading as an opaque writable Ads id', () => {
    const dir = fixtureDir();
    const evidence = createValidAdReadbackEvidence(dir);
    const dbPath = writeAdReadbackAuthorityDb(dir, evidence, {
      entityId: evidence.target.entityId,
    });

    expect(() => assertCurrentAdReadbackDbAuthority(evidence, { dbPath }))
      .toThrow(/writable Ads target|可写对象/i);
  });

  it('rejects a writable target tuple duplicated on another date inside the same authority range', () => {
    const dir = fixtureDir();
    const evidence = createValidAdReadbackEvidence(dir);
    const dbPath = writeAdReadbackAuthorityDb(dir, evidence);
    executeAdReadbackAuthorityDb(dbPath, `
      INSERT INTO ad_daily_metrics (
        batch_id, report_type, date, store_name, marketplace_code, asin,
        campaign_name, ad_group_name, targeting,
        impressions, clicks, cost, orders, sales, source_file, source_row
      ) VALUES (?, 'keyword', ?, ?, ?, ?, ?, ?, ?, 100, 3, 4, 1, 10, ?, ?)
    `, [
      evidence.authority.batchId,
      '2026-06-09',
      evidence.authority.storeName,
      evidence.authority.marketplaceCode,
      evidence.authority.asin,
      evidence.target.campaignName,
      evidence.target.adGroupName,
      evidence.target.entityName,
      evidence.source.sourceFiles[0],
      evidence.source.sourceRow,
    ]);

    expect(() => assertCurrentAdReadbackDbAuthority(evidence, { dbPath }))
      .toThrow(/exactly one current imported metric row/i);
  });
});

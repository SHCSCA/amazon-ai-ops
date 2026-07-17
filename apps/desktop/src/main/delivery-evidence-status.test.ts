import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { getDeliveryEvidenceStatus } from './delivery-evidence-status';

describe('getDeliveryEvidenceStatus', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('summarizes persisted listing read, AI listing draft and PASS readback for the current scope', () => {
    const db = createDb({
      listingContent: [{
        asin: 'B0TESTASIN',
        store_name: 'FT-US-US',
        marketplace_code: 'US',
        title: 'Smart Lock',
        bullets_json: '["Keyless entry"]',
        backend_terms: 'smart lock keypad',
        source_url: 'https://erp.lingxing.com/listing/B0TESTASIN',
        screenshot_path: 'C:/evidence/listing.png',
        updated_at: '2026-06-12T10:00:00.000Z',
      }],
      listingDrafts: [{
        asin: 'B0TESTASIN',
        store_name: 'FT-US-US',
        marketplace_code: 'US',
        source: 'ai',
        ai_fallback_reason: null,
        updated_at: '2026-06-12T10:10:00.000Z',
      }],
    });
    const readbackDir = makeTempDir();
    const sourceFile = writeFixtureFile(readbackDir, 'user-search-term.xlsx');
    const beforeScreenshot = writeFixtureFile(readbackDir, 'before.png');
    const afterScreenshot = writeFixtureFile(readbackDir, 'after.png');
    const readbackScreenshot = writeFixtureFile(readbackDir, 'readback.png');
    writeReadback(readbackDir, {
      status: 'PASS',
      target: {
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        asin: 'B0TESTASIN',
        metricDate: '2026-06-12',
        actionType: 'lower_bid',
      },
      source: {
        batchId: 'batch_current',
        metricDate: '2026-06-12',
        sourceFiles: [sourceFile],
        sourceRow: 12,
        currentValue: '2.40',
        recommendedValue: '2.16',
      },
      before: {
        value: '$1.20',
        screenshotPath: beforeScreenshot,
      },
      after: {
        value: '1.08 USD',
        screenshotPath: afterScreenshot,
      },
      readback: {
        verified: true,
        actualValue: '1.08',
        evidencePath: readbackScreenshot,
      },
    });

    const status = getDeliveryEvidenceStatus({
      db,
      readbackDir,
      scope: {
        dateFrom: '2026-06-01',
        dateTo: '2026-06-12',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        asin: 'B0TESTASIN',
        batchId: 'batch_current',
      },
    });

    expect(status.listing).toMatchObject({
      readReady: true,
      draftReady: true,
      contentCount: 1,
      aiDraftCount: 1,
      latestAsin: 'B0TESTASIN',
    });
    expect(status.readback).toMatchObject({
      verifiedCount: 1,
      latestStatus: 'PASS',
    });
  });

  it('summarizes installer and portable exe package evidence from the release directory', () => {
    const db = createDb({ listingContent: [], listingDrafts: [] });
    const releaseDir = makeTempDir();
    const installerPath = path.join(releaseDir, 'AmazonAIOpsAgent-1.5.0.exe');
    const portablePath = path.join(releaseDir, 'AmazonAIOpsAgent-1.5.0-portable.exe');
    fs.writeFileSync(installerPath, 'installer-binary\n', 'utf8');
    fs.writeFileSync(portablePath, 'portable-binary\n', 'utf8');

    const status = getDeliveryEvidenceStatus({
      db,
      readbackDir: makeTempDir(),
      releaseDir,
      scope: {
        dateFrom: '2026-06-01',
        dateTo: '2026-06-12',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
      },
    });

    expect(status.package).toMatchObject({
      installerAvailable: true,
      installerPath,
      portablePath,
      sha256: expect.stringMatching(/^[A-F0-9]{64}$/),
    });
    expect(status.package?.latestBuiltAt).toBeTruthy();
  });

  it('uses the newest portable artifact as the current package authority', () => {
    const db = createDb({ listingContent: [], listingDrafts: [] });
    const releaseDir = makeTempDir();
    const installerPath = path.join(releaseDir, 'AmazonAIOpsAgent-1.5.0.exe');
    const stalePortablePath = path.join(releaseDir, 'AmazonAIOpsAgent-1.4.9-portable.exe');
    const currentPortablePath = path.join(releaseDir, 'AmazonAIOpsAgent-1.5.0-portable.exe');
    fs.writeFileSync(installerPath, 'installer-binary\n', 'utf8');
    fs.writeFileSync(stalePortablePath, 'stale-portable\n', 'utf8');
    fs.writeFileSync(currentPortablePath, 'current-portable\n', 'utf8');
    const staleTime = new Date('2026-06-01T00:00:00.000Z');
    const currentTime = new Date('2026-06-02T00:00:00.000Z');
    fs.utimesSync(stalePortablePath, staleTime, staleTime);
    fs.utimesSync(currentPortablePath, currentTime, currentTime);

    const status = getDeliveryEvidenceStatus({
      db,
      readbackDir: makeTempDir(),
      releaseDir,
      scope: {},
    });

    expect(status.package.portablePath).toBe(currentPortablePath);
    expect(status.package.sha256).toBe(
      crypto.createHash('sha256').update('current-portable\n').digest('hex').toUpperCase(),
    );
  });

  it('reports installer unavailable when the release contains only a portable executable', () => {
    const releaseDir = makeTempDir();
    const portablePath = path.join(releaseDir, 'AmazonAIOpsAgent-1.5.0-portable.exe');
    fs.writeFileSync(portablePath, 'portable-only\n', 'utf8');

    const status = getDeliveryEvidenceStatus({
      db: createDb({ listingContent: [], listingDrafts: [] }),
      readbackDir: makeTempDir(),
      releaseDir,
      scope: {},
    });

    expect(status.package).toMatchObject({
      installerAvailable: false,
      installerPath: undefined,
      portablePath,
      sha256: expect.stringMatching(/^[A-F0-9]{64}$/),
    });
  });

  it('does not count incomplete listing content, rule fallback drafts or out-of-scope readback files', () => {
    const db = createDb({
      listingContent: [{
        asin: 'B0TESTASIN',
        title: 'Smart Lock',
        bullets_json: '[]',
        backend_terms: '',
        updated_at: '2026-06-12T10:00:00.000Z',
      }],
      listingDrafts: [{
        asin: 'B0TESTASIN',
        store_name: 'FT-US-US',
        marketplace_code: 'US',
        source: 'rule',
        ai_fallback_reason: 'AI unavailable',
        updated_at: '2026-06-12T10:10:00.000Z',
      }],
    });
    const readbackDir = makeTempDir();
    writeReadback(readbackDir, {
      status: 'PASS',
      target: {
        storeName: 'OTHER',
        marketplaceCode: 'US',
        asin: 'B0TESTASIN',
        metricDate: '2026-06-12',
      },
      source: { batchId: 'batch_current', metricDate: '2026-06-12' },
      readback: { verified: true },
    });

    const status = getDeliveryEvidenceStatus({
      db,
      readbackDir,
      scope: {
        dateFrom: '2026-06-01',
        dateTo: '2026-06-12',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        asin: 'B0TESTASIN',
        batchId: 'batch_current',
      },
    });

    expect(status.listing.readReady).toBe(false);
    expect(status.listing.draftReady).toBe(false);
    expect(status.listing.ruleFallbackDraftCount).toBe(1);
    expect(status.readback.verifiedCount).toBe(0);
  });

  it('does not count old readback evidence from a different batch or metric date', () => {
    const db = createDb({ listingContent: [], listingDrafts: [] });
    const readbackDir = makeTempDir();
    writeReadback(readbackDir, {
      status: 'PASS',
      target: {
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        asin: 'B0TESTASIN',
        metricDate: '2026-05-31',
      },
      source: { batchId: 'old_batch', metricDate: '2026-05-31' },
      readback: { verified: true },
    });
    writeReadback(readbackDir, {
      status: 'PASS',
      target: {
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        asin: 'B0TESTASIN',
      },
      source: { batchId: 'batch_current' },
      readback: { verified: true },
    });

    const status = getDeliveryEvidenceStatus({
      db,
      readbackDir,
      scope: {
        dateFrom: '2026-06-01',
        dateTo: '2026-06-12',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        asin: 'B0TESTASIN',
        batchId: 'batch_current',
      },
    });

    expect(status.readback.verifiedCount).toBe(0);
  });

  it('does not count PASS readback evidence without original report source traceability', () => {
    const db = createDb({ listingContent: [], listingDrafts: [] });
    const readbackDir = makeTempDir();
    writeReadback(readbackDir, {
      status: 'PASS',
      target: {
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        asin: 'B0TESTASIN',
        metricDate: '2026-06-12',
      },
      source: {
        batchId: 'batch_current',
        metricDate: '2026-06-12',
        sourceFiles: ['C:/reports/acceptance-audit.json'],
        sourceRow: -1,
      },
      readback: { verified: true },
    });

    const status = getDeliveryEvidenceStatus({
      db,
      readbackDir,
      scope: {
        dateFrom: '2026-06-01',
        dateTo: '2026-06-12',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        asin: 'B0TESTASIN',
        batchId: 'batch_current',
      },
    });

    expect(status.readback.verifiedCount).toBe(0);
    expect(status.readback.latestStatus).toBe('PASS');
  });

  it('does not count PASS readback evidence when source and before/after values do not prove the same executed action', () => {
    const db = createDb({ listingContent: [], listingDrafts: [] });
    const readbackDir = makeTempDir();
    writeReadback(readbackDir, {
      status: 'PASS',
      target: {
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        asin: 'B0TESTASIN',
        metricDate: '2026-06-12',
        actionType: 'lower_bid',
      },
      source: {
        batchId: 'batch_current',
        metricDate: '2026-06-12',
        sourceFiles: ['C:/reports/user-search-term.xlsx'],
        sourceRow: 12,
        currentValue: '2.40',
        recommendedValue: '2.16',
      },
      before: {
        value: '2.40',
        screenshotPath: 'C:/evidence/before.png',
      },
      after: {
        value: '2.40',
        screenshotPath: 'C:/evidence/after.png',
      },
      readback: {
        verified: true,
        actualValue: '2.40',
        evidencePath: 'C:/evidence/readback.png',
      },
    });

    const status = getDeliveryEvidenceStatus({
      db,
      readbackDir,
      scope: {
        dateFrom: '2026-06-01',
        dateTo: '2026-06-12',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        asin: 'B0TESTASIN',
        batchId: 'batch_current',
      },
    });

    expect(status.readback.verifiedCount).toBe(0);
    expect(status.readback.latestStatus).toBe('PASS');
  });

  it('does not count PASS readback evidence when evidence files are not real and independent', () => {
    const db = createDb({ listingContent: [], listingDrafts: [] });
    const readbackDir = makeTempDir();
    writeReadback(readbackDir, {
      status: 'PASS',
      target: {
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        asin: 'B0TESTASIN',
        metricDate: '2026-06-12',
        actionType: 'lower_bid',
      },
      source: {
        batchId: 'batch_current',
        metricDate: '2026-06-12',
        sourceFiles: ['C:/reports/user-search-term.xlsx'],
        sourceRow: 12,
        currentValue: '2.40',
        recommendedValue: '2.16',
      },
      before: {
        value: '2.40',
        screenshotPath: 'C:/evidence/same.png',
      },
      after: {
        value: '2.16',
        screenshotPath: 'C:/evidence/same.png',
      },
      readback: {
        verified: true,
        actualValue: '2.16',
        evidencePath: 'C:/evidence/same.png',
      },
    });

    const status = getDeliveryEvidenceStatus({
      db,
      readbackDir,
      scope: {
        dateFrom: '2026-06-01',
        dateTo: '2026-06-12',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        asin: 'B0TESTASIN',
        batchId: 'batch_current',
      },
    });

    expect(status.readback.verifiedCount).toBe(0);
    expect(status.readback.latestStatus).toBe('PASS');
  });

  it('does not count PASS readback evidence when distinct screenshot paths reuse the same bytes', () => {
    const db = createDb({ listingContent: [], listingDrafts: [] });
    const readbackDir = makeTempDir();
    const sourceFile = writeFixtureFile(readbackDir, 'user-search-term.xlsx');
    const beforeScreenshot = path.join(readbackDir, 'before.png');
    const afterScreenshot = path.join(readbackDir, 'after.png');
    const readbackScreenshot = path.join(readbackDir, 'readback.png');
    for (const screenshotPath of [beforeScreenshot, afterScreenshot, readbackScreenshot]) {
      fs.writeFileSync(screenshotPath, 'reused-screenshot-bytes\n', 'utf8');
    }
    writeReadback(readbackDir, {
      status: 'PASS',
      target: {
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        asin: 'B0TESTASIN',
        metricDate: '2026-06-12',
        actionType: 'lower_bid',
      },
      source: {
        batchId: 'batch_current',
        metricDate: '2026-06-12',
        sourceFiles: [sourceFile],
        sourceRow: 12,
        currentValue: '2.40',
        recommendedValue: '2.16',
      },
      before: {
        value: '2.40',
        screenshotPath: beforeScreenshot,
      },
      after: {
        value: '2.16',
        screenshotPath: afterScreenshot,
      },
      readback: {
        verified: true,
        actualValue: '2.16',
        evidencePath: readbackScreenshot,
      },
    });

    const status = getDeliveryEvidenceStatus({
      db,
      readbackDir,
      scope: {
        dateFrom: '2026-06-01',
        dateTo: '2026-06-12',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        asin: 'B0TESTASIN',
        batchId: 'batch_current',
      },
    });

    expect(status.readback.verifiedCount).toBe(0);
    expect(status.readback.latestStatus).toBe('PASS');
  });

  it('does not mark listing evidence ready when the current scope has no ASIN to match', () => {
    const db = createDb({
      listingContent: [{
        asin: 'B0TESTASIN',
        title: 'Smart Lock',
        bullets_json: '["Keyless entry"]',
        backend_terms: 'smart lock keypad',
        updated_at: '2026-06-12T10:00:00.000Z',
      }],
      listingDrafts: [{
        asin: 'B0TESTASIN',
        source: 'ai',
        ai_fallback_reason: null,
        updated_at: '2026-06-12T10:10:00.000Z',
      }],
    });

    const status = getDeliveryEvidenceStatus({
      db,
      readbackDir: makeTempDir(),
      scope: {
        dateFrom: '2026-06-01',
        dateTo: '2026-06-12',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
      },
    });

    expect(status.listing.contentCount).toBe(1);
    expect(status.listing.draftCount).toBe(1);
    expect(status.listing.readReady).toBe(false);
    expect(status.listing.draftReady).toBe(false);
  });

  it('does not mark listing evidence ready when stored listing belongs to another store or marketplace', () => {
    const db = createDb({
      listingContent: [{
        asin: 'B0TESTASIN',
        store_name: 'OTHER-STORE',
        marketplace_code: 'US',
        title: 'Smart Lock',
        bullets_json: '["Keyless entry"]',
        backend_terms: 'smart lock keypad',
        source_url: 'https://erp.lingxing.com/listing/B0TESTASIN',
        screenshot_path: 'C:/evidence/listing.png',
        updated_at: '2026-06-12T10:00:00.000Z',
      }],
      listingDrafts: [{
        asin: 'B0TESTASIN',
        store_name: 'OTHER-STORE',
        marketplace_code: 'US',
        source: 'ai',
        ai_fallback_reason: null,
        updated_at: '2026-06-12T10:10:00.000Z',
      }, {
        asin: 'B0TESTASIN',
        store_name: 'OTHER-STORE',
        marketplace_code: 'US',
        source: 'rule',
        ai_fallback_reason: 'AI unavailable',
        updated_at: '2026-06-12T10:09:00.000Z',
      }],
    });

    const status = getDeliveryEvidenceStatus({
      db,
      readbackDir: makeTempDir(),
      scope: {
        dateFrom: '2026-06-01',
        dateTo: '2026-06-12',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        asin: 'B0TESTASIN',
      },
    });

    expect(status.listing.contentCount).toBe(1);
    expect(status.listing.draftCount).toBe(2);
    expect(status.listing.readReady).toBe(false);
    expect(status.listing.draftReady).toBe(false);
    expect(status.listing.ruleFallbackDraftCount).toBe(0);
  });

  function makeTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-delivery-status-'));
    tempDirs.push(dir);
    return dir;
  }
});

function createDb(data: { listingContent: any[]; listingDrafts: any[] }) {
  return {
    prepare(sql: string) {
      return {
        all(params: { asin?: string }) {
          const rows = sql.includes('FROM listing_content') ? data.listingContent : data.listingDrafts;
          if (!params.asin) return rows;
          return rows.filter((row) => String(row.asin || '').toUpperCase() === String(params.asin || '').toUpperCase());
        },
      };
    },
  } as any;
}

function writeReadback(dir: string, payload: Record<string, unknown>) {
  fs.writeFileSync(path.join(dir, `real-ad-execution-readback-${Date.now()}.json`), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function writeFixtureFile(dir: string, name: string): string {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, `fixture:${name}\n`, 'utf8');
  return filePath;
}

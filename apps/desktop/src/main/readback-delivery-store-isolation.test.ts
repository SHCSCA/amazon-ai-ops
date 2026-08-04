import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  deriveStoreCapsulePaths,
  ensureStoreCapsulePaths,
} from '@amazon-ai-ops/browser-worker';
import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { describe, expect, it } from 'vitest';
import { getDeliveryEvidenceStatus } from './delivery-evidence-status';
import {
  createStoreScopedReadbackAccess,
  ensureStoreScopedReadbackDirectories,
  latestStoreScopedReadbackCandidate,
} from './readback-store-authority';

function context(storeId: string, profileId: string, generation = 1): StoreContextEnvelope {
  return {
    storeId,
    browserProfileId: profileId,
    marketplace: 'US',
    currency: 'USD',
    businessTimezone: 'America/Los_Angeles',
    businessDate: '2026-08-04',
    sessionGeneration: generation,
  } as StoreContextEnvelope;
}

function access(root: string, storeId: string, profileId: string, generation = 1) {
  const capsule = ensureStoreCapsulePaths(deriveStoreCapsulePaths(root, storeId, profileId));
  const result = createStoreScopedReadbackAccess(context(storeId, profileId, generation), capsule);
  ensureStoreScopedReadbackDirectories(result);
  return result;
}

function writeCurrentReadback(storeAccess: ReturnType<typeof access>): string {
  const report = path.join(storeAccess.capsule.reportsDir, 'user-search-term.xlsx');
  const before = path.join(storeAccess.capturesDir, 'before.png');
  const after = path.join(storeAccess.capturesDir, 'after.png');
  const reload = path.join(storeAccess.capturesDir, 'readback.png');
  fs.writeFileSync(report, 'report');
  fs.writeFileSync(before, 'before');
  fs.writeFileSync(after, 'after');
  fs.writeFileSync(reload, 'reload');
  const filePath = path.join(storeAccess.candidatesDir, 'real-ad-execution-readback-current.json');
  fs.writeFileSync(filePath, `${JSON.stringify({
    schemaVersion: 2,
    kind: 'real-ad-execution-readback',
    status: 'PASS',
    storeBinding: { ...storeAccess.binding },
    target: {
      storeName: 'Store A', marketplaceCode: 'US', asin: 'B0TESTASIN',
      actionType: 'lower_bid',
    },
    source: {
      batchId: 'batch-current', metricDate: '2026-08-04', sourceFiles: [report],
      sourceRow: 12, currentValue: '1.20', recommendedValue: '1.08',
    },
    before: { value: '1.20', screenshotPath: before },
    after: { value: '1.08', screenshotPath: after },
    readback: { verified: true, actualValue: '1.08', evidencePath: reload, readAt: '2026-08-04T10:05:00.000Z' },
  }, null, 2)}\n`, 'utf8');
  return filePath;
}

describe('store-scoped delivery readback status', () => {
  it('counts only a binding-valid current-store readback root', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'readback-delivery-store-'));
    const current = access(root, 'store-a', 'profile-a', 1);
    const currentFile = writeCurrentReadback(current);

    const status = getDeliveryEvidenceStatus({
      db: null,
      storeId: current.binding.storeId,
      readbackDir: current.rootDir,
      readbackAccess: current,
      scope: {
        dateFrom: '2026-08-04', dateTo: '2026-08-04', storeName: 'Store A',
        marketplaceCode: 'US', asin: 'B0TESTASIN', batchId: 'batch-current',
      },
    });

    expect(status.readback).toMatchObject({
      verifiedCount: 1,
      latestStatus: 'PASS',
      latestJsonPath: currentFile,
    });
    expect(latestStoreScopedReadbackCandidate(current)).toBe(currentFile);
  });

  it('rejects another store root and a stale generation binding', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'readback-delivery-store-'));
    const current = access(root, 'store-a', 'profile-a', 1);
    const other = access(root, 'store-b', 'profile-b', 1);
    const stale = createStoreScopedReadbackAccess(context('store-a', 'profile-a', 2), current.capsule);
    writeCurrentReadback(current);

    expect(() => getDeliveryEvidenceStatus({
      db: null,
      storeId: current.binding.storeId,
      readbackDir: current.rootDir,
      readbackAccess: other,
      scope: {},
    })).toThrow(/DELIVERY_ROOT_MISMATCH/);
    expect(() => getDeliveryEvidenceStatus({
      db: null,
      storeId: current.binding.storeId,
      readbackDir: current.rootDir,
      readbackAccess: stale,
      scope: {},
    })).toThrow(/BINDING_MISMATCH/);
  });
});

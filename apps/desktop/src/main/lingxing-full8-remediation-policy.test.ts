import { describe, expect, it } from 'vitest';
import {
  normalizeStoreContextEnvelope,
  type LingxingCollectionJobSnapshot,
  type LingxingReportType,
} from '@amazon-ai-ops/shared-types';
import { LINGXING_AD_REPORTS } from '@amazon-ai-ops/lingxing-report-collector';
import { assertLegacyLingxingResumeMayCreateJob } from './lingxing-full8-remediation-policy';

const FULL8 = LINGXING_AD_REPORTS.map((report) => report.type);

function job(
  mode: 'create-and-download' | 'download-existing',
  reportTypes: readonly LingxingReportType[],
  requestId = 'historical-request',
): Pick<LingxingCollectionJobSnapshot, 'request'> {
  return {
    request: {
      requestId,
      storeContext: normalizeStoreContextEnvelope({
        storeId: 'store-a' as never,
        browserProfileId: 'profile-a' as never,
        marketplace: 'US',
        currency: 'USD',
        businessTimezone: 'America/Los_Angeles',
        businessDate: '2026-07-21',
        sessionGeneration: 1,
      }),
      dateStart: '2026-07-20',
      dateEnd: '2026-07-21',
      mode,
      reportTypes,
    },
  };
}

describe('legacy Lingxing full8 remediation policy', () => {
  it.each([
    ['production create-and-download', job('create-and-download', FULL8)],
    ['historical download-existing', job('download-existing', FULL8)],
    ['historical canary-prefixed full8', job('download-existing', FULL8, 'canary:historical')],
  ])('blocks %s from creating a second durable job', (_label, target) => {
    expect(() => assertLegacyLingxingResumeMayCreateJob(target))
      .toThrow(/FULL8_REMEDIATION_MAIN_RUNTIME_REQUIRED/);
  });

  it('keeps a partial remediation job eligible for its legacy path', () => {
    expect(() => assertLegacyLingxingResumeMayCreateJob(
      job('download-existing', ['keyword', 'user_search_term']),
    )).not.toThrow();
  });
});

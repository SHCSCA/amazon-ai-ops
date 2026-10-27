
import React from 'react';

import { normalizeStoreContextEnvelope, type LingxingCollectionJobSnapshot, type LingxingCollectionProgressEvent } from '@amazon-ai-ops/shared-types';

export const storeContext = normalizeStoreContextEnvelope({
  storeId: 'store_us_primary',
  marketplace: 'US',
  currency: 'USD',
  businessTimezone: 'America/Los_Angeles',
  businessDate: '2026-07-22',
  browserProfileId: 'profile_us_primary',
  sessionGeneration: 4,
});

export function collectionProgressEvent(
  state: LingxingCollectionProgressEvent['job']['reports'][number]['state'] = 'downloading',
): LingxingCollectionProgressEvent {
  return {
    eventId: 'batch_1:3',
    emittedAt: '2026-07-22T08:00:00.000Z',
    changedReportType: 'campaign',
    externalStep: state === 'create_unknown' ? 'create' : 'download',
    job: {
      jobId: 'batch_1',
      request: {
        requestId: 'lx:recreate-full:test:abc',
        storeContext,
        dateStart: '2026-07-01',
        dateEnd: '2026-07-21',
        mode: 'create-and-download',
        reportTypes: ['campaign', 'keyword'],
      },
      state: state === 'create_unknown' ? 'completed_with_errors' : 'running',
      reports: [{
        reportType: 'campaign',
        state,
        attemptIndex: 0,
        autoRetryCount: 0,
        updatedAt: '2026-07-22T08:00:00.000Z',
      }],
      createdAt: '2026-07-22T07:59:00.000Z',
      updatedAt: '2026-07-22T08:00:00.000Z',
    },
  };
}

export const allReportTypes: LingxingCollectionJobSnapshot['request']['reportTypes'] = [
  'campaign',
  'ad_group',
  'placement',
  'advertised_product',
  'auto_targeting',
  'keyword',
  'product_targeting',
  'user_search_term',
];

export function collectionJob(input: {
  jobId?: string;
  jobState?: LingxingCollectionJobSnapshot['state'];
  checkpointState?: LingxingCollectionJobSnapshot['reports'][number]['state'];
  downloadedCount?: number;
  context?: typeof storeContext;
  canary?: boolean;
  reportTypes?: LingxingCollectionJobSnapshot['request']['reportTypes'];
  importState?: LingxingCollectionJobSnapshot['importState'];
  importError?: string;
} = {}): LingxingCollectionJobSnapshot {
  const downloadedCount = input.downloadedCount ?? 0;
  const checkpointState = input.checkpointState ?? 'failed';
  const reportTypes = input.reportTypes ?? allReportTypes;
  return {
    jobId: input.jobId || 'job_recent_1',
    request: {
      requestId: `${input.canary ? 'canary:' : 'lx:'}${input.jobId || 'job_recent_1'}`,
      storeContext: input.context || storeContext,
      dateStart: '2026-07-01',
      dateEnd: '2026-07-21',
      mode: 'create-and-download',
      reportTypes,
    },
    state: input.jobState || 'failed',
    reports: reportTypes.map((reportType, index) => ({
      reportType,
      state: index < downloadedCount ? 'downloaded' : index === downloadedCount ? checkpointState : 'queued',
      attemptIndex: 0,
      autoRetryCount: 0,
      updatedAt: `2026-07-22T08:0${Math.min(index, 9)}:00.000Z`,
    })),
    createdAt: '2026-07-22T07:59:00.000Z',
    updatedAt: '2026-07-22T08:10:00.000Z',
    blockerCode: input.jobState === 'failed' ? 'download_timeout' : undefined,
    ...(input.importState ? { importState: input.importState } : {}),
    ...(input.importError ? { importError: input.importError } : {}),
  };
}

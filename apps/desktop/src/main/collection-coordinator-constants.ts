import {
  LINGXING_AD_REPORTS,
} from '@amazon-ai-ops/lingxing-report-collector';
import type {
  LingxingCollectionJobSnapshot,
  LingxingReportType,
} from '@amazon-ai-ops/shared-types';

export const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const COLLECTION_LEASE_TTL_MS = 60 * 60 * 1_000;

export const REPORT_TYPES = new Set<LingxingReportType>(
  LINGXING_AD_REPORTS.map((report) => report.type),
);

export const TERMINAL_REPORT_STATES = new Set<LingxingCollectionJobSnapshot['reports'][number]['state']>([
  'downloaded',
  'failed',
  'create_unknown',
  'cancelled',
  'stale_authority',
]);

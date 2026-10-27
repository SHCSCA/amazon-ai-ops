import {
  type LingxingReportType,
} from '@amazon-ai-ops/shared-types';
import {
  LINGXING_AD_REPORTS,
} from '@amazon-ai-ops/lingxing-report-collector';

export const SAFE_ID = /^[A-Za-z0-9:_-]{1,160}$/;

export const FINGERPRINT = /^[a-f0-9]{64}$/;

export const EXECUTION_ATTEMPT_ID = /^sca:[a-f0-9]{64}$/;

export const EXECUTION_REQUEST_ID = /^scr:[a-f0-9]{64}$/;

export const SAFE_JOB_ID = /^[A-Za-z0-9._-]{1,180}$/;

export const FULL_REPORT_TYPES = Object.freeze(
  LINGXING_AD_REPORTS.map((report) => report.type),
) as readonly LingxingReportType[];

export const FULL_REPORT_TYPE_SET = new Set<LingxingReportType>(FULL_REPORT_TYPES);

export const SHA256 = /^[a-f0-9]{64}$/i;

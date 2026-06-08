import type {
  DownloadCenterActionSelectorCheck,
  DownloadCenterActionSelectors,
  DownloadCenterDiagnosticResult,
  DownloadCenterPageModel,
} from '@amazon-ai-ops/shared-types';

export const DEFAULT_DOWNLOAD_CENTER_DIAGNOSTIC_EVIDENCE_TTL_MS = 30 * 60 * 1000;

export interface DownloadCenterDiagnosticEvidenceReadiness {
  ready: boolean;
  missing: string[];
  reason?: string;
  diagnosticId?: number;
  checkedAt?: string;
}

export interface EvaluateDownloadCenterDiagnosticEvidenceOptions {
  nowMs?: number;
  ttlMs?: number;
  allowedFutureSkewMs?: number;
}

export function evaluateDownloadCenterDiagnosticEvidenceReadiness(
  model: DownloadCenterPageModel,
  dateRange: { start: string; end: string },
  diagnostic: DownloadCenterDiagnosticResult | undefined,
  options: EvaluateDownloadCenterDiagnosticEvidenceOptions = {},
): DownloadCenterDiagnosticEvidenceReadiness {
  if (!diagnostic) {
    return {
      ready: false,
      missing: ['diagnosticEvidence'],
      reason: 'no matching download-center diagnostic exists for this page model and date range',
    };
  }
  if (diagnostic.pageModel !== model.name || JSON.stringify(diagnostic.pageModelSnapshot) !== JSON.stringify(model)) {
    return {
      ready: false,
      missing: ['diagnosticModelSnapshot'],
      reason: 'diagnostic page model snapshot does not match the active page model',
      diagnosticId: diagnostic.id,
      checkedAt: diagnostic.checkedAt,
    };
  }
  if (diagnostic.dateStart !== dateRange.start || diagnostic.dateEnd !== dateRange.end) {
    return {
      ready: false,
      missing: ['diagnosticDateRange'],
      reason: 'diagnostic date range does not match the selected collection range',
      diagnosticId: diagnostic.id,
      checkedAt: diagnostic.checkedAt,
    };
  }
  if (!diagnostic.ready) {
    return {
      ready: false,
      missing: ['diagnosticReady'],
      reason: 'matching diagnostic did not pass basic page-model checks',
      diagnosticId: diagnostic.id,
      checkedAt: diagnostic.checkedAt,
    };
  }

  const checkedAt = diagnostic.checkedAt ? new Date(diagnostic.checkedAt).getTime() : Number.NaN;
  const nowMs = options.nowMs ?? Date.now();
  const ttlMs = options.ttlMs ?? DEFAULT_DOWNLOAD_CENTER_DIAGNOSTIC_EVIDENCE_TTL_MS;
  const allowedFutureSkewMs = options.allowedFutureSkewMs ?? 60_000;
  if (!Number.isFinite(checkedAt) || checkedAt - nowMs > allowedFutureSkewMs || nowMs - checkedAt > ttlMs) {
    return {
      ready: false,
      missing: ['diagnosticFreshness'],
      reason: 'matching diagnostic is missing a valid timestamp or is older than the allowed freshness window',
      diagnosticId: diagnostic.id,
      checkedAt: diagnostic.checkedAt,
    };
  }

  const missing = missingDownloadCenterActionSelectorSetupEvidence(model, diagnostic.actionSelectorChecks ?? []);
  return {
    ready: missing.length === 0,
    missing,
    reason: missing.length > 0 ? 'matching diagnostic setup selector checks are incomplete or unsafe' : undefined,
    diagnosticId: diagnostic.id,
    checkedAt: diagnostic.checkedAt,
  };
}

export function missingDownloadCenterActionSelectorSetupEvidence(
  model: DownloadCenterPageModel,
  checks: DownloadCenterActionSelectorCheck[],
): string[] {
  const missing: string[] = [];
  const selectors = model.actionSelectors;
  if (!selectors) return ['actionSelectors'];

  for (const name of [
    'storeSearchInput',
    'storeOption',
    'storeMoveButton',
    'reportSearchInput',
    'reportTypeSelect',
    'reportTypeOption',
    'dateStartInput',
    'dateEndInput',
    'dailyDetailRadio',
    'createReportButton',
    'confirmCreateButton',
  ] as const) {
    requireUsableSelectorEvidence(name, selectors[name], checks, missing);
  }

  return Array.from(new Set(missing));
}

function requireUsableSelectorEvidence(
  name: keyof DownloadCenterActionSelectors,
  selector: string | number | undefined,
  checks: DownloadCenterActionSelectorCheck[],
  missing: string[],
): void {
  if (typeof selector !== 'string' || !selector.trim()) {
    missing.push(String(name));
    return;
  }
  const matchingChecks = checks.filter((check) => check.name === name);
  if (matchingChecks.length === 0) {
    missing.push(`${name}:evidence`);
    return;
  }
  for (const check of matchingChecks) {
    const structuralProblem = invalidActionSelectorCheckReason(name, selector, check);
    if (structuralProblem) {
      missing.push(`${name}:${check.reportType || 'global'}:${structuralProblem}`);
    }
  }
}

function invalidActionSelectorCheckReason(
  name: keyof DownloadCenterActionSelectors,
  expectedSelector: string | number | undefined,
  check: DownloadCenterActionSelectorCheck,
): string | undefined {
  if (check.name !== name) return 'nameMismatch';
  if (typeof expectedSelector === 'string' && check.selector !== expectedSelector) return 'selectorMismatch';
  if (typeof check.renderedSelector !== 'string' || !check.renderedSelector.trim()) return 'renderedSelectorMissing';
  if (typeof check.selector !== 'string' || !check.selector.trim()) return 'selectorMissing';
  if (check.found !== true) return 'notFound';
  if (check.usable !== true) return check.errorMessage || 'notUsable';
  if (check.ambiguous !== false) return 'ambiguous';
  if (check.matchCount !== 1) return `matchCount:${check.matchCount}`;

  const expectedKind = expectedActionSelectorKind(name);
  if (expectedKind && check.kind !== expectedKind) return `kind:${check.kind || 'missing'}`;
  return undefined;
}

function expectedActionSelectorKind(name: keyof DownloadCenterActionSelectors): DownloadCenterActionSelectorCheck['kind'] | undefined {
  if (name === 'dateStartInput' || name === 'dateEndInput' || name === 'reportSearchInput') return 'input';
  if (name === 'createReportButton') return 'click';
  if (name === 'confirmCreateButton') return 'click';
  return undefined;
}

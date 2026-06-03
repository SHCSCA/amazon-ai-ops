import type {
  DownloadCenterDiagnosticResult,
  DownloadCenterPageModel,
  DownloadCenterPageSnapshot,
} from '@amazon-ai-ops/shared-types';

const REQUIRED_ACTION_SELECTOR_KEYS = [
  'dateStartInput',
  'dateEndInput',
  'createReportButton',
  'readyReportSelector',
  'downloadButton',
] as const;

const REPORT_SCOPED_ACTION_SELECTOR_KEYS = [
  'readyReportSelector',
  'statusTextSelector',
  'downloadButton',
] as const;

function usesReportScope(selector: string): boolean {
  return selector.includes('{reportType}')
    || selector.includes('{reportName}')
    || selector.includes('{expectedFilenameKeyword}');
}

function usesDateScope(selector: string): boolean {
  return selector.includes('{dateStart}')
    || selector.includes('{dateEnd}')
    || selector.includes('{dateRange}');
}

export function evaluateDownloadCenterPageModel(
  model: DownloadCenterPageModel,
  snapshot: DownloadCenterPageSnapshot,
): DownloadCenterDiagnosticResult {
  const bodyText = snapshot.bodyText || '';
  const matchedEntryHints = model.entryHints.filter((hint) => bodyText.includes(hint));
  const matchedReportNames = model.reportNames.filter((name) => bodyText.includes(name));
  const selectorChecks = model.verifySelectors.map((hint) => ({
    ...hint,
    found: Boolean(snapshot.selectorMatches[hint.selector]),
  }));
  const missingRequiredSelectors = selectorChecks
    .filter((check) => check.required && !check.found)
    .map((check) => check.name);
  const requiredSelectorReady = missingRequiredSelectors.length === 0;
  const contentReady = matchedEntryHints.length > 0 || matchedReportNames.length > 0;

  return {
    pageModel: model.name,
    url: snapshot.url,
    title: snapshot.title,
    ready: requiredSelectorReady && contentReady,
    requiresManualVerification: model.requiresManualVerification,
    matchedEntryHints,
    matchedReportNames,
    selectorChecks,
    missingRequiredSelectors,
    checkedAt: new Date().toISOString(),
  };
}

export function getDownloadCenterAutomationReadiness(model: DownloadCenterPageModel): {
  ready: boolean;
  missing: string[];
  reason?: string;
} {
  if (model.requiresManualVerification) {
    return {
      ready: false,
      missing: [],
      reason: 'download center page model still requires manual verification',
    };
  }

  const missing = REQUIRED_ACTION_SELECTOR_KEYS.filter((key) => !model.actionSelectors?.[key]);
  const unscoped = REPORT_SCOPED_ACTION_SELECTOR_KEYS.flatMap((key) => {
    const selector = model.actionSelectors?.[key];
    if (!selector) return [];
    const problems: string[] = [];
    if (!usesReportScope(selector)) {
      problems.push(`${key}:reportScope`);
    }
    if (!usesDateScope(selector)) {
      problems.push(`${key}:dateScope`);
    }
    return problems;
  });
  const missingOrUnsafe = [...missing, ...unscoped];
  return {
    ready: missingOrUnsafe.length === 0,
    missing: missingOrUnsafe,
    reason: missingOrUnsafe.length > 0 ? 'download center action selectors are incomplete or unsafe' : undefined,
  };
}

import type {
  DownloadCenterDiagnosticResult,
  DownloadCenterPageModel,
  DownloadCenterSelectorCandidate,
  DownloadCenterSelectorHint,
} from '@amazon-ai-ops/shared-types';

const MAX_DRAFT_VERIFY_SELECTORS = 20;

export interface DownloadCenterPageModelDraftResult {
  draft: DownloadCenterPageModel;
  notes: string[];
}

export function buildDownloadCenterPageModelDraft(
  fallbackModel: DownloadCenterPageModel,
  diagnostic: DownloadCenterDiagnosticResult,
): DownloadCenterPageModelDraftResult {
  const sourceModel = diagnostic.pageModelSnapshot ?? fallbackModel;
  const candidateUrls = mergeCandidateUrls(sourceModel.candidateUrls, diagnostic.url);
  const verifySelectors = mergeVerifySelectors(
    sourceModel.verifySelectors,
    diagnostic.selectorCandidates ?? [],
  );
  const draft: DownloadCenterPageModel = {
    ...sourceModel,
    description: `${sourceModel.description}\nDiagnostic draft generated from local evidence at ${new Date().toISOString()}. Keep manual verification enabled until every action selector is confirmed.`,
    candidateUrls,
    verifySelectors,
    actionSelectors: {
      reportSearchInput: sourceModel.actionSelectors?.reportSearchInput ?? '',
      dateStartInput: sourceModel.actionSelectors?.dateStartInput ?? '',
      dateEndInput: sourceModel.actionSelectors?.dateEndInput ?? '',
      createReportButton: sourceModel.actionSelectors?.createReportButton ?? '',
      confirmCreateButton: sourceModel.actionSelectors?.confirmCreateButton ?? '',
      readyReportSelector: sourceModel.actionSelectors?.readyReportSelector ?? '',
      statusTextSelector: sourceModel.actionSelectors?.statusTextSelector ?? '',
      downloadButton: sourceModel.actionSelectors?.downloadButton ?? '',
      readyTimeoutMs: sourceModel.actionSelectors?.readyTimeoutMs ?? 300000,
      downloadTimeoutMs: sourceModel.actionSelectors?.downloadTimeoutMs ?? 120000,
    },
    requiresManualVerification: true,
  };

  return {
    draft,
    notes: [
      'This draft is intentionally manual-verification-only.',
      'Copy only selectors proven by screenshot, DOM evidence, and action selector checks.',
      'Before enabling automation, dateStartInput, dateEndInput, createReportButton, readyReportSelector, and downloadButton must each match one visible target.',
      'readyReportSelector, statusTextSelector, and downloadButton must stay scoped by both report identity and selected date range.',
    ],
  };
}

export function downloadCenterPageModelDraftToMarkdown(
  result: DownloadCenterPageModelDraftResult,
  diagnostic: DownloadCenterDiagnosticResult,
): string {
  return [
    '# Lingxing Download Center Page Model Draft',
    '',
    `Diagnostic ID: ${diagnostic.id ?? 'unknown'}`,
    `Diagnostic URL: ${diagnostic.url || 'unknown'}`,
    `Diagnostic checked at: ${diagnostic.checkedAt || 'unknown'}`,
    `Draft requires manual verification: ${result.draft.requiresManualVerification ? 'yes' : 'no'}`,
    '',
    '## Notes',
    '',
    ...result.notes.map((note) => `- ${note}`),
    '',
    '## Next Checks',
    '',
    '- Confirm the draft candidate URL is the live Lingxing download center.',
    '- Fill or adjust action selectors from screenshot and sanitized DOM evidence.',
    '- Run the read-only diagnostic again for the same date range after saving the override.',
    '- Set `requiresManualVerification` to `false` only after every action selector check is usable and uniquely scoped.',
    '',
  ].join('\n');
}

function mergeCandidateUrls(existingUrls: string[], diagnosticUrl: string): string[] {
  const urls = [...existingUrls];
  if (isTrustedLingxingHttpsUrl(diagnosticUrl)) {
    return [diagnosticUrl, ...urls.filter((url) => url !== diagnosticUrl)];
  }
  return urls;
}

function mergeVerifySelectors(
  existingHints: DownloadCenterSelectorHint[],
  candidates: DownloadCenterSelectorCandidate[],
): DownloadCenterSelectorHint[] {
  const seenSelectors = new Set(existingHints.map((hint) => hint.selector));
  const draftHints: DownloadCenterSelectorHint[] = [];
  for (const candidate of candidates) {
    if (draftHints.length >= MAX_DRAFT_VERIFY_SELECTORS) break;
    if (!candidate.unique || !candidate.selector || seenSelectors.has(candidate.selector)) continue;
    seenSelectors.add(candidate.selector);
    draftHints.push({
      name: `diagnostic-${safeHintName(candidate.role || candidate.tagName || 'candidate')}-${draftHints.length + 1}`,
      selector: candidate.selector,
      required: false,
    });
  }

  return [...existingHints, ...draftHints];
}

function safeHintName(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
  return normalized || 'candidate';
}

function isTrustedLingxingHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'lingxing.com' || url.hostname.endsWith('.lingxing.com'));
  } catch {
    return false;
  }
}

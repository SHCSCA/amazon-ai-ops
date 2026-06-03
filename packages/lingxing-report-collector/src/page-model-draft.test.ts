import { describe, expect, it } from 'vitest';
import type { DownloadCenterDiagnosticResult, DownloadCenterPageModel } from '@amazon-ai-ops/shared-types';
import { buildDownloadCenterPageModelDraft, downloadCenterPageModelDraftToMarkdown } from './page-model-draft';

const baseModel: DownloadCenterPageModel = {
  name: 'lingxing-download-center',
  description: 'download center model',
  candidateUrls: ['https://erp.lingxing.com/download-center'],
  entryHints: ['下载中心'],
  reportNames: ['关键词报告'],
  verifySelectors: [{ name: 'table', selector: '.ant-table', required: false }],
  actionSelectors: {
    dateStartInput: '',
    dateEndInput: '',
    createReportButton: '',
    readyReportSelector: '',
    downloadButton: '',
  },
  requiresManualVerification: false,
};

function diagnostic(overrides: Partial<DownloadCenterDiagnosticResult> = {}): DownloadCenterDiagnosticResult {
  return {
    id: 9,
    pageModel: 'lingxing-download-center',
    pageModelSnapshot: baseModel,
    url: 'https://erp.lingxing.com/report/download',
    title: '下载中心',
    ready: true,
    requiresManualVerification: false,
    matchedEntryHints: ['下载中心'],
    matchedReportNames: ['关键词报告'],
    selectorChecks: [],
    missingRequiredSelectors: [],
    selectorCandidates: [
      { role: 'table', text: '', tagName: 'table', selector: '.ant-table', unique: true, matchCount: 1 },
      { role: 'create button', text: '创建', tagName: 'button', selector: 'button[data-id="create"]', unique: true, matchCount: 1 },
      { role: 'download button', text: '下载', tagName: 'button', selector: 'button.download', unique: false, matchCount: 4 },
    ],
    checkedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildDownloadCenterPageModelDraft', () => {
  it('keeps generated drafts manual-verification-only even when source model was enabled', () => {
    const result = buildDownloadCenterPageModelDraft(baseModel, diagnostic());

    expect(result.draft.requiresManualVerification).toBe(true);
    expect(result.draft.actionSelectors?.readyTimeoutMs).toBe(300000);
    expect(result.draft.actionSelectors?.downloadTimeoutMs).toBe(120000);
  });

  it('moves the trusted diagnostic url to the first candidate and merges unique selector candidates', () => {
    const result = buildDownloadCenterPageModelDraft(baseModel, diagnostic());

    expect(result.draft.candidateUrls[0]).toBe('https://erp.lingxing.com/report/download');
    expect(result.draft.verifySelectors).toEqual([
      { name: 'table', selector: '.ant-table', required: false },
      { name: 'diagnostic-create-button-1', selector: 'button[data-id="create"]', required: false },
    ]);
  });

  it('deduplicates repeated selector candidates in the draft', () => {
    const result = buildDownloadCenterPageModelDraft(baseModel, diagnostic({
      selectorCandidates: [
        { role: 'create button', text: '创建', tagName: 'button', selector: 'button[data-id="create"]', unique: true, matchCount: 1 },
        { role: 'create button', text: '创建报表', tagName: 'button', selector: 'button[data-id="create"]', unique: true, matchCount: 1 },
      ],
    }));

    expect(result.draft.verifySelectors.filter((hint) => hint.selector === 'button[data-id="create"]')).toHaveLength(1);
  });

  it('does not trust non-Lingxing or non-HTTPS diagnostic urls in the draft', () => {
    const result = buildDownloadCenterPageModelDraft(baseModel, diagnostic({ url: 'http://example.com/download' }));

    expect(result.draft.candidateUrls).toEqual(['https://erp.lingxing.com/download-center']);
  });

  it('renders operator notes that preserve the manual gate', () => {
    const result = buildDownloadCenterPageModelDraft(baseModel, diagnostic());
    const markdown = downloadCenterPageModelDraftToMarkdown(result, diagnostic());

    expect(markdown).toContain('Draft requires manual verification: yes');
    expect(markdown).toContain('Set `requiresManualVerification` to `false` only after every action selector check is usable');
  });
});

import { describe, expect, it } from 'vitest';
import type { ListingDraft, ListingSuggestion } from '@amazon-ai-ops/shared-types';
import * as XLSX from 'xlsx';
import { draftsToCsv, draftsToMarkdown, draftsToXlsxBuffer, suggestionsToCsv, suggestionsToXlsxBuffer } from './export';

function suggestion(overrides: Partial<ListingSuggestion>): ListingSuggestion {
  return {
    asin: 'B001',
    keyword: 'insulated mug',
    section: 'title',
    suggestedText: 'Stainless insulated mug',
    evidence: 'Search term opportunity',
    riskWarnings: [],
    status: 'pending',
    appVersion: '1.5.0',
    ...overrides,
  };
}

function draft(overrides: Partial<ListingDraft>): ListingDraft {
  return {
    asin: 'B001',
    section: 'title',
    currentText: 'Old title',
    draftedText: 'New insulated mug title',
    keywords: ['insulated mug'],
    evidence: 'keyword evidence',
    riskWarnings: ['review_required'],
    source: 'rule',
    status: 'pending',
    appVersion: '1.5.0',
    aiFallbackReason: '未配置 AI Key，使用规则草案',
    ...overrides,
  };
}

describe('suggestionsToCsv', () => {
  it('includes app version trace', () => {
    const csv = suggestionsToCsv([suggestion({ appVersion: '1.5.0' })]);

    expect(csv.split('\n')[0]).toContain('appVersion');
    expect(csv).toContain('"1.5.0"');
  });
});

describe('suggestionsToCsv', () => {
  it('escapes formula-like cells to prevent spreadsheet injection', () => {
    const csv = suggestionsToCsv([
      suggestion({
        asin: '=cmd',
        keyword: '+SUM(A1:A2)',
        suggestedText: '-malicious',
        evidence: '@external',
      }),
    ]);

    expect(csv).toContain('"\'=cmd"');
    expect(csv).toContain("\"'+SUM(A1:A2)\"");
    expect(csv).toContain('"\'-malicious"');
    expect(csv).toContain('"\'@external"');
  });
});

describe('suggestionsToXlsxBuffer', () => {
  it('exports sanitized worksheet cells', () => {
    const buffer = suggestionsToXlsxBuffer([
      suggestion({
        asin: '=cmd',
        keyword: '+SUM(A1:A2)',
        suggestedText: '-malicious',
        evidence: '@external',
      }),
    ]);

    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(workbook.Sheets['Listing Suggestions']);

    expect(rows[0].asin).toBe("'=cmd");
    expect(rows[0].keyword).toBe("'+SUM(A1:A2)");
    expect(rows[0].suggestedText).toBe("'-malicious");
    expect(rows[0].evidence).toBe("'@external");
  });
});

describe('draft exports', () => {
  it('exports current text, drafted text, source, AI fallback reason, evidence, and risk', () => {
    const csv = draftsToCsv([draft({})]);
    const header = csv.split('\n')[0];

    expect(header).toContain('currentText');
    expect(header).toContain('draftedText');
    expect(header).toContain('source');
    expect(header).toContain('aiFallbackReason');
    expect(csv).toContain('"Old title"');
    expect(csv).toContain('"New insulated mug title"');
    expect(csv).toContain('"未配置 AI Key，使用规则草案"');
  });

  it('exports sanitized draft worksheet cells', () => {
    const buffer = draftsToXlsxBuffer([
      draft({
        asin: '=cmd',
        draftedText: '+rewrite',
        evidence: '@evidence',
      }),
    ]);

    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(workbook.Sheets['Listing Drafts']);

    expect(rows[0].asin).toBe("'=cmd");
    expect(rows[0].draftedText).toBe("'+rewrite");
    expect(rows[0].evidence).toBe("'@evidence");
  });

  it('includes evidence and AI fallback reason in markdown exports', () => {
    const markdown = draftsToMarkdown([draft({ evidence: 'orders=3, spend=170' })]);

    expect(markdown).toContain('Evidence');
    expect(markdown).toContain('orders=3, spend=170');
    expect(markdown).toContain('未配置 AI Key，使用规则草案');
  });
});

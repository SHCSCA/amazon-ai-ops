import { describe, expect, it } from 'vitest';
import type { ListingSuggestion } from '@amazon-ai-ops/shared-types';
import * as XLSX from 'xlsx';
import { suggestionsToCsv, suggestionsToXlsxBuffer } from './export';

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

import type { ListingSuggestion } from '@amazon-ai-ops/shared-types';
import * as XLSX from 'xlsx';

const EXPORT_HEADERS = ['appVersion', 'asin', 'keyword', 'section', 'suggestedText', 'evidence', 'riskWarnings', 'status'];

export function suggestionsToCsv(suggestions: ListingSuggestion[]): string {
  const rows = suggestions.map((suggestion) => suggestionToRow(suggestion).map(formatCsvCell).join(','));
  return [EXPORT_HEADERS.join(','), ...rows].join('\n');
}

function formatCsvCell(value: unknown): string {
  return `"${sanitizeSpreadsheetCell(value).replace(/"/g, '""')}"`;
}

function sanitizeSpreadsheetCell(value: unknown): string {
  const raw = String(value ?? '');
  return /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
}

function suggestionToRow(suggestion: ListingSuggestion): string[] {
  return [
    suggestion.appVersion ?? '',
    suggestion.asin,
    suggestion.keyword,
    suggestion.section,
    suggestion.suggestedText,
    suggestion.evidence,
    suggestion.riskWarnings.join('|'),
    suggestion.status,
  ].map(sanitizeSpreadsheetCell);
}

export function suggestionsToXlsxBuffer(suggestions: ListingSuggestion[]): Buffer {
  const worksheet = XLSX.utils.aoa_to_sheet([
    EXPORT_HEADERS,
    ...suggestions.map(suggestionToRow),
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Listing Suggestions');
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
}

export function suggestionsToMarkdown(suggestions: ListingSuggestion[]): string {
  const lines = ['| ASIN | Keyword | Section | Suggestion | Risk |', '|---|---|---|---|---|'];
  for (const suggestion of suggestions) {
    lines.push(
      `| ${suggestion.asin} | ${suggestion.keyword} | ${suggestion.section} | ${suggestion.suggestedText.replace(/\|/g, '/')} | ${suggestion.riskWarnings.join(', ')} |`,
    );
  }
  return lines.join('\n');
}

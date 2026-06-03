import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { describe, expect, test } from 'vitest';
import { parseListingContent } from './listing-content';

function writeWorkbook(row: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-listing-'));
  const filePath = path.join(dir, 'listing.xlsx');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([row]), 'Listing');
  XLSX.writeFile(workbook, filePath);
  return filePath;
}

describe('parseListingContent', () => {
  test('maps listing workbook fields into listing content', () => {
    const filePath = writeWorkbook({
      ASIN: 'B012345678',
      Title: 'Garlic Press for Kitchen',
      'Bullet Points': 'Durable stainless steel\nEasy to clean',
      'A+': 'Premium kitchen prep tool',
      'Image Copy': 'Crush garlic fast',
      'Backend Search Terms': 'garlic press kitchen tool',
    });

    const listing = parseListingContent(filePath);

    expect(listing).toEqual({
      asin: 'B012345678',
      title: 'Garlic Press for Kitchen',
      bullets: ['Durable stainless steel', 'Easy to clean'],
      aPlus: 'Premium kitchen prep tool',
      imageCopy: 'Crush garlic fast',
      backendTerms: 'garlic press kitchen tool',
    });
  });
});

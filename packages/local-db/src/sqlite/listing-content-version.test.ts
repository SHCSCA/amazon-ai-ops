import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { closeSqlite, initSqlite } from './db';

const tempDirs: string[] = [];

function openTempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'amazon-ai-ops-listing-'));
  tempDirs.push(dir);
  return initSqlite(join(dir, 'test.db'));
}

afterEach(() => {
  closeSqlite();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe('listing content version schema', () => {
  it('creates latest listing columns and version history table', () => {
    const db = openTempDb();

    const listingColumns = db.prepare('PRAGMA table_info(listing_content)').all().map((row: any) => row.name);
    expect(listingColumns).toContain('source');
    expect(listingColumns).toContain('description');
    expect(listingColumns).toContain('version_label');
    expect(listingColumns).toContain('change_summary');
    expect(listingColumns).toContain('created_at');

    const versionColumns = db.prepare('PRAGMA table_info(listing_content_versions)').all().map((row: any) => row.name);
    expect(versionColumns).toEqual(expect.arrayContaining([
      'id',
      'listing_content_id',
      'asin',
      'store_name',
      'marketplace_code',
      'title',
      'bullets_json',
      'description',
      'a_plus',
      'image_copy',
      'backend_terms',
      'source',
      'source_url',
      'screenshot_path',
      'version_label',
      'change_summary',
      'created_at',
    ]));
  });
});

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

describe('retired legacy Listing/keyword renderer mutation channels', () => {
  it('does not expose path-based imports or non-CAS Listing persistence through preload/Main IPC', () => {
    const main = source('./index.ts');
    const preload = source('../preload/index.ts');
    const retiredChannels = [
      'v1_5:keywords:import-report',
      'v1_5:listing:import-content',
      'v1_5:listing:save-manual-content',
      'v1_5:listing:list-content-versions',
      'v1_5:listing:extract-from-lingxing',
      'v1_5:listing:open-and-extract-from-lingxing',
      'v1_5:listing:probe-detail-and-extract',
    ];
    for (const channel of retiredChannels) {
      expect(main).not.toContain(`registerTrackedIpcHandler('${channel}'`);
      expect(preload).not.toContain(`ipcRenderer.invoke('${channel}'`);
    }
    expect(preload).not.toMatch(/import(?:KeywordReport|ListingContent):\s*\(filePath/);
  });

  it('routes internal Lingxing Listing persistence through the store-scoped CAS service', () => {
    const main = source('./index.ts');
    const persist = main.slice(
      main.indexOf('function persistListingContent'),
      main.indexOf('function readCurrentOperationScopeValue'),
    );
    expect(persist).toContain('canonicalizeAmazonAsin(listing.asin)');
    expect(persist).toContain('storeScopedAdListingService.updateListingContent');
    expect(persist).toContain('expectedRevision: existing.revision');
    expect(persist).not.toContain('UPDATE listing_content');
    expect(persist).not.toContain('screenshotPath');
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SMOKE_SCENARIOS = {
  'smoke-business-ui-shell.js': 'diagnosis-ready',
  'smoke-business-ui-data-pipeline.js': 'diagnosis-ready',
  'smoke-business-ui-ad-execution.js': 'mixed-recommendations',
  'smoke-business-ui-keyword-listing.js': 'diagnosis-ready',
  'smoke-business-ui-settings-delivery.js': 'delivery-ready',
  'smoke-listing-draft-renderer.js': 'diagnosis-ready',
  'smoke-v15-product-readiness-ui.js': 'delivery-ready',
};

describe('browser smoke development preview URLs', () => {
  for (const [fileName, scenario] of Object.entries(SMOKE_SCENARIOS)) {
    it(`${fileName} explicitly opts into ${scenario}`, () => {
      const source = readFileSync(new URL(fileName, import.meta.url), 'utf8');

      expect(source).toContain(`preview=1&scenario=${scenario}`);
    });
  }
});

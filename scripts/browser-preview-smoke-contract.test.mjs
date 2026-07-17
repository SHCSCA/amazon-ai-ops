import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SMOKE_SCENARIOS = {
  'smoke-business-ui-shell.js': 'diagnosis-ready',
  'smoke-business-ui-data-pipeline.js': 'diagnosis-ready',
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

describe('authoritative browser smoke harnesses', () => {
  it('runs ad execution outside preview-readonly mode', () => {
    const source = readFileSync(new URL('smoke-business-ui-ad-execution.js', import.meta.url), 'utf8');

    expect(source).toContain('smoke=ad-execution-authoritative');
    expect(source).not.toContain('preview=1');
  });
});

describe('product object-workspace smoke contract', () => {
  for (const fileName of ['smoke-business-ui-shell.js', 'smoke-business-ui-data-pipeline.js']) {
    it(`${fileName} follows the product workspace heading and queue markers`, () => {
      const source = readFileSync(new URL(fileName, import.meta.url), 'utf8');

      expect(source).toContain('heading: /产品工作台/');
      expect(source).toContain("[data-workspace-queue=\"products\"]");
      expect(source).toContain('[data-workspace-queue-scroll]');
      expect(source).not.toContain('heading: /^产品$/');
    });
  }

  it('uses selectable virtual rows instead of the removed product table detail action', () => {
    const source = readFileSync(new URL('smoke-business-ui-data-pipeline.js', import.meta.url), 'utf8');

    expect(source).toContain("getByRole('row', { name: /B0TESTASIN/ })");
    expect(source).not.toContain("locator('tr', { hasText: 'B0TESTASIN' })");
    expect(source).not.toContain("getByRole('button', { name: '详情' })");
  });
});

describe('ad readback smoke v2 authority contract', () => {
  it('rejects renderer-owned authority fields instead of asserting them as export input', () => {
    const source = readFileSync(new URL('smoke-business-ui-ad-execution.js', import.meta.url), 'utf8');

    expect(source).toContain('assertRendererReadbackExportRequest');
    expect(source).not.toContain('readbackExport.input?.source?');
    expect(source).not.toContain('readbackExport.input?.target?');
    expect(source).not.toContain('readbackExport.input?.approval?');
    expect(source).not.toContain('readbackExport.input?.risk?');
    expect(source).not.toContain('readbackExport.input?.authority?');
  });

  it('proves the PASS branch verifies directly without work-package calls', () => {
    const source = readFileSync(new URL('smoke-business-ui-ad-execution.js', import.meta.url), 'utf8');

    expect(source).toContain('assertPassReadbackBranch');
    expect(source).toContain('PASS readback branch used a work-package action');
    expect(source).toContain("nextAction !== 'verify'");
  });

  it('proves the NEEDS_WORK branch follows export then prepare-check-fill-verify', () => {
    const source = readFileSync(new URL('smoke-business-ui-ad-execution.js', import.meta.url), 'utf8');

    expect(source).toContain('assertNeedsWorkReadbackBranch');
    expect(source).toContain('NEEDS_WORK readback branch did not preserve strict action order');
    expect(source).toContain("nextAction !== 'prepare'");
  });
});

describe('delivery readback verifier mock contract', () => {
  it('marks PASS as explicitly ready before delivery can publish it', () => {
    const source = readFileSync(new URL('smoke-business-ui-settings-delivery.js', import.meta.url), 'utf8');

    expect(source).toMatch(/verifyAdReadbackEvidence:[\s\S]*?status: 'PASS',\s*ready: true,\s*ok: true,\s*verified: true/);
  });
});

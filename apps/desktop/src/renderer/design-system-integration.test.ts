import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PAGE_FILES = [
  'pages/dashboard-page.tsx',
  'pages/product-management-page.tsx',
  'pages/operation-scope-page.tsx',
  'pages/data-collection-page.tsx',
  'pages/data-import-validation-page.tsx',
  'pages/operation-events-page.tsx',
  'pages/product-config-page.tsx',
  'pages/ad-quant-page.tsx',
  'pages/recommendations-page.tsx',
  'pages/approval-page.tsx',
  'pages/readback-page.tsx',
  'pages/keyword-opportunities-page.tsx',
  'pages/listing-optimization-page.tsx',
  'pages/delivery-page.tsx',
  'pages/scheduler-page.tsx',
  'pages/settings-page.tsx',
];

function rendererSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('prototype parity design system integration', () => {
  it('uses the shared KPI card strip on all prototype-mapped business pages', () => {
    for (const pageFile of PAGE_FILES) {
      const source = rendererSource(pageFile);

      expect(source, pageFile).toContain('KpiCard');
      expect(source, pageFile).toContain('className="kpi-row');
    }
  });

  it('keeps production renderer assets offline and light-theme only', () => {
    const indexHtml = rendererSource('index.html');
    const styles = rendererSource('styles.css');

    expect(indexHtml).not.toContain('fonts.googleapis.com');
    expect(styles).not.toContain('fonts.googleapis.com');
    expect(styles).not.toContain('DM Sans');
    expect(styles).not.toContain('DM Mono');
    expect(styles).not.toContain('.dark');
    expect(styles).not.toContain('color-scheme: dark');
  });

  it('does not leave prototype-only component stubs in the shared UI module', () => {
    const uiSource = rendererSource('components/ui.tsx');

    expect(uiSource).not.toContain('AiModuleCard');
    expect(uiSource).not.toContain('EmptyState');
    expect(uiSource).not.toContain('ContentCard');
    expect(uiSource).not.toContain('SectionHeader');
  });
});

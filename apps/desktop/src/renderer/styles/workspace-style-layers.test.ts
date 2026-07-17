import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const styleFiles = [
  'tokens.css',
  'foundations.css',
  'shell.css',
  'workspace.css',
  'priority-table.css',
  'decisions.css',
  'object-workspace.css',
  'states-motion.css',
] as const;

function style(name: typeof styleFiles[number]): string {
  return readFileSync(new URL(name, import.meta.url), 'utf8');
}

describe('task-first workspace style layers', () => {
  it('defines the approved type, spacing, radius, color, and motion tokens', () => {
    const css = style('tokens.css');

    expect(css).toMatch(/--workspace-font-body:\s*14px/);
    expect(css).toMatch(/--workspace-line-body:\s*21px/);
    expect(css).toMatch(/--workspace-font-support:\s*12px/);
    expect(css).toMatch(/--workspace-font-page-title:\s*24px/);
    expect(css).toMatch(/--workspace-space-1:\s*4px/);
    expect(css).toMatch(/--workspace-space-8:\s*32px/);
    expect(css).toMatch(/--workspace-radius-sm:\s*6px/);
    expect(css).toMatch(/--workspace-motion-fast:\s*120ms/);
    expect(css).toMatch(/--workspace-motion-standard:\s*180ms/);
    expect(css).toMatch(/color-scheme:\s*light/);
  });

  it('keeps visible workspace copy at 12px or above and uses explicit focus-visible rings', () => {
    const css = styleFiles.map(style).join('\n');
    const legacyCss = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

    expect(css).not.toMatch(/font-size:\s*(?:[0-9]|1[01])px/);
    expect(legacyCss).not.toMatch(/font-size:\s*(?:[0-9]|1[01])px/);
    expect(css).toMatch(/:focus-visible/);
    expect(css).toMatch(/outline:/);
    expect(style('foundations.css')).toMatch(/\.workspace-page-frame\s*\{[^}]*letter-spacing:\s*0/s);
    expect(style('workspace.css')).toMatch(/\.workspace-page-frame \.status-pill\s*\{[^}]*font-size:\s*var\(--workspace-font-support\)/s);
    expect(style('shell.css')).toMatch(/\.topbar \.scope-title-row span,[\s\S]*font-size:\s*var\(--workspace-font-support\)/);
  });

  it('assigns vertical scrolling to app content and only horizontal overflow to priority tables', () => {
    const shell = style('shell.css');
    const table = style('priority-table.css');
    const legacyCss = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

    expect(shell).toMatch(/\.app-content\s*\{[^}]*overflow-y:\s*auto/s);
    expect(shell).toMatch(/\.app-content\s*\{[^}]*overflow-x:\s*hidden/s);
    expect(shell).toMatch(/\.app-content\s*\{[^}]*overflow-anchor:\s*none/s);
    expect(table).toMatch(/\.priority-table-scroll\s*\{[^}]*overflow-x:\s*auto/s);
    expect(table).toMatch(/\.priority-table-scroll\s*\{[^}]*overflow-y:\s*visible/s);
    expect(style('workspace.css')).not.toMatch(/overflow-y:\s*(?:auto|scroll)/);
    for (const selector of [
      '.table-wrap',
      '.product-management-list-wrap',
      '.product-management-detail-table',
      '.product-management-timeline',
      '.product-config-page-stack .table-wrap',
      '.ad-quant-object-table-wrap',
      '.ad-quant-daily-table-wrap',
      '.recommendation-workbench-table-wrap',
      '.operation-events-primary-timeline',
    ]) {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expect(legacyCss).toMatch(new RegExp(`${escaped}[^\\{]*\\{[^}]*overflow-x:\\s*auto[^}]*overflow-y:\\s*visible`, 's'));
    }
  });

  it('moves the global scope into a controlled second topbar row at compact desktop width', () => {
    const shell = style('shell.css');

    expect(shell).toMatch(/@media\s*\(max-width:\s*1280px\)/);
    expect(shell).toMatch(/\.topbar > \.scope-bar\s*\{[^}]*grid-column:\s*1 \/ -1[^}]*grid-row:\s*2/s);
  });

  it('styles the Today queue context and one low-noise technical surface', () => {
    const css = style('workspace.css');

    expect(css).toMatch(/\.workbench-context-bar\s*\{/);
    expect(css).toMatch(/\.priority-object-cell\s*\{/);
    expect(css).toMatch(/\.priority-diagnosis-cell\s*\{/);
    expect(css).toMatch(/\.workspace-technical-surface\s*\{/);
    expect(css).toMatch(/\.workspace-technical-heading\s*\{/);
    expect(css).toMatch(/\.workspace-gap-list\s*\{/);
    expect(css).toMatch(/\.workspace-technical-surface \.state-light-card\s*\{[^}]*box-shadow:\s*none/s);
    expect(css).toMatch(/\.workspace-technical-surface \.dashboard-history-summary-grid > div\s*\{[^}]*box-shadow:\s*none/s);
  });

  it('keeps queue-first task guidance compact without shrinking visible copy', () => {
    const css = style('workspace.css');

    expect(css).toMatch(/\.task-banner--compact\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto[^}]*padding:\s*var\(--workspace-space-1\) var\(--workspace-space-3\)/s);
    expect(css).toMatch(/\.task-banner__title-line h2,[\s\S]*\.workbench-panel__title-line h2\s*\{[^}]*margin:\s*0/s);
    expect(css).toMatch(/\.task-banner--compact \.task-banner__title-line\s*\{[^}]*flex:\s*none/s);
    expect(css).toMatch(/\.task-banner--compact \.task-banner__title-line h2\s*\{[^}]*white-space:\s*nowrap/s);
    expect(css).toMatch(/\.task-banner--compact \.task-banner__description\s*\{[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/s);
    expect(css).toMatch(/\.task-banner--compact \.task-banner__meta\s*\{[^}]*position:\s*absolute[^}]*clip:\s*rect\(0 0 0 0\)/s);
  });

  it('keeps the unified decisions queue dense and preserves all five columns at 1200px', () => {
    const css = style('decisions.css');

    expect(css).toMatch(/\.decisions-workspace \.priority-table\s*\{[^}]*min-width:\s*680px[^}]*table-layout:\s*fixed/s);
    expect(css).toMatch(/\.decisions-table-cell strong,[\s\S]*text-overflow:\s*ellipsis/);
    expect(css).toMatch(/\.decisions-selection-status\s*\{[^}]*min-height:\s*34px[^}]*background:\s*var\(--workspace-surface-subtle\)/s);
    expect(css).toMatch(/\.decisions-selection-control\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center/s);
    expect(css).toMatch(/\.decisions-selection-checkbox:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--workspace-focus\)/s);
    expect(css).toMatch(/\.decisions-technical-disclosure\s*\{[^}]*border-top:\s*1px solid var\(--workspace-border\)/s);
    expect(css).toMatch(/@media\s*\(max-width:\s*1280px\)[\s\S]*\.decisions-workspace \.priority-table th:nth-child\(4\),[\s\S]*display:\s*table-cell/);
    expect(css).toMatch(/\.decisions-table-cell--decision\[data-decision-tone="confirmed"\] strong/);
    expect(css).toMatch(/\.decisions-table-cell--decision\[data-decision-tone="blocked"\] strong/);
  });

  it('uses an inline inspector from 1400px and a fixed, internally scrolling drawer below it', () => {
    const css = style('decisions.css');

    expect(css).toMatch(/@media\s*\(min-width:\s*1400px\)[\s\S]*\.decisions-workbench-layout:has\(\.responsive-inspector--inline\)[^{]*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(350px, 360px\)/s);
    expect(css).toMatch(/\.responsive-inspector__backdrop\s*\{[^}]*position:\s*fixed[^}]*z-index:\s*400[^}]*inset:\s*0/s);
    expect(css).toMatch(/\.responsive-inspector--drawer \.responsive-inspector__body\s*\{[^}]*overflow-y:\s*auto/s);
    expect(css).toMatch(/\.responsive-inspector--drawer \.responsive-inspector__header\s*\{[^}]*position:\s*sticky[^}]*z-index:\s*1[^}]*background:\s*var\(--workspace-surface\)/s);
    expect(css).toMatch(/\.responsive-inspector--drawer\s*\{[^}]*width:\s*min\(460px, calc\(100vw - 32px\)\)[^}]*overflow:\s*hidden/s);
    expect(css).toMatch(/\.responsive-inspector:focus-visible\s*\{[^}]*outline:/s);
  });

  it('gives object workspaces a bounded virtual queue and only adds the inline inspector at 1400px', () => {
    const css = style('object-workspace.css');

    expect(css).toMatch(/\[data-workspace-queue\] \.virtual-table-wrap\[data-scroll-owner="virtual-table"\]\s*\{[^}]*height:\s*clamp\(362px, calc\(100vh - 338px\), 422px\)[^}]*overflow-y:\s*auto/s);
    expect(css).toMatch(/@media\s*\(min-width:\s*1400px\)[\s\S]*\[data-workspace-work-surface\]:has\(\.responsive-inspector--inline\)[^{]*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(350px, 380px\)/s);
    expect(css).toMatch(/@media\s*\(min-width:\s*1400px\)[\s\S]*height:\s*clamp\(504px, calc\(100vh - 398px\), 542px\)[^}]*min-height:\s*504px/s);
    expect(css).toMatch(/\[data-workspace-queue\] \.virtual-table-head\s*\{[^}]*top:\s*0/s);
    expect(css).toMatch(/\[data-workspace-queue\] \.virtual-table-body-row\s*\{[^}]*min-height:\s*54px/s);
    expect(css).toMatch(/\[data-workspace-queue\] \.workbench-panel__toolbar\s*\{[^}]*flex-wrap:\s*nowrap/s);
    expect(css).toMatch(/\.diagnosis-queue-controls \.tag-metric-group\s*\{[^}]*flex-wrap:\s*nowrap/s);
    expect(css).toMatch(/\.product-management-queue \.workbench-panel__footer\s*\{[^}]*padding:\s*3px var\(--workspace-space-3\)/s);
    expect(css).toMatch(/\.diagnosis-workspace\s*\{[^}]*position:\s*relative[^}]*display:\s*grid[^}]*gap:\s*var\(--workspace-space-1\)/s);
    expect(css).toMatch(/\.diagnosis-workspace > \.page-header\s*\{[^}]*margin-bottom:\s*0[^}]*padding:\s*var\(--workspace-space-1\) 0 0/s);
    expect(css).toMatch(/\.diagnosis-workspace > \.progressive-details\s*\{[^}]*position:\s*absolute[^}]*top:\s*var\(--workspace-space-1\)[^}]*right:\s*0[^}]*z-index:\s*70/s);
    expect(css).toMatch(/\.diagnosis-workspace > \.progressive-details\[open\]\s*\{[^}]*max-height:\s*calc\(100vh - 120px\)[^}]*overflow-y:\s*auto/s);
  });

  it('makes read-only, blocked, confirmed, danger, and busy decision states visually distinct', () => {
    const css = style('decisions.css');

    expect(css).toMatch(/\.decisions-readonly-decision\s*\{[^}]*background:\s*var\(--workspace-surface-subtle\)/s);
    expect(css).toMatch(/\.decisions-blockers\s*\{[^}]*border-left:\s*3px solid var\(--workspace-error\)/s);
    expect(css).toMatch(/\.decisions-feedback--ready\s*\{[^}]*background:\s*var\(--workspace-confirmed-soft\)/s);
    expect(css).toMatch(/\.decisions-decision-actions \.danger-button\s*\{[^}]*background:\s*var\(--workspace-surface\)[^}]*color:\s*var\(--workspace-error\)/s);
    expect(css).toMatch(/\.responsive-inspector\[aria-busy="true"\]\s*\{[^}]*cursor:\s*wait/s);
  });

  it('uses purposeful transitions, never transition all, and provides reduced-motion fallback', () => {
    const css = styleFiles.map(style).join('\n');
    const legacyCss = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

    expect(css).not.toMatch(/transition:\s*all\b/);
    expect(legacyCss).not.toMatch(/transition:\s*all\b/);
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    expect(css).toMatch(/animation-duration:\s*0\.01ms/);
    expect(css).not.toMatch(/linear-gradient|radial-gradient|filter:\s*drop-shadow/);
  });
});

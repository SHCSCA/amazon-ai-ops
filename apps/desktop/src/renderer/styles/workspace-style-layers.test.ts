import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const styleFiles = [
  'tokens.css',
  'foundations.css',
  'shell.css',
  'workspace.css',
  'priority-table.css',
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

    expect(css).not.toMatch(/font-size:\s*(?:[0-9]|1[01])px/);
    expect(css).toMatch(/:focus-visible/);
    expect(css).toMatch(/outline:/);
    expect(style('foundations.css')).toMatch(/\.workspace-page-frame\s*\{[^}]*letter-spacing:\s*0/s);
    expect(style('workspace.css')).toMatch(/\.workspace-page-frame \.status-pill\s*\{[^}]*font-size:\s*var\(--workspace-font-support\)/s);
    expect(style('shell.css')).toMatch(/\.topbar \.scope-title-row span,[\s\S]*font-size:\s*var\(--workspace-font-support\)/);
  });

  it('assigns vertical scrolling to app content and only horizontal overflow to priority tables', () => {
    const shell = style('shell.css');
    const table = style('priority-table.css');

    expect(shell).toMatch(/\.app-content\s*\{[^}]*overflow-y:\s*auto/s);
    expect(shell).toMatch(/\.app-content\s*\{[^}]*overflow-x:\s*hidden/s);
    expect(table).toMatch(/\.priority-table-scroll\s*\{[^}]*overflow-x:\s*auto/s);
    expect(table).toMatch(/\.priority-table-scroll\s*\{[^}]*overflow-y:\s*visible/s);
    expect(style('workspace.css')).not.toMatch(/overflow-y:\s*(?:auto|scroll)/);
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

  it('uses purposeful transitions, never transition all, and provides reduced-motion fallback', () => {
    const css = styleFiles.map(style).join('\n');

    expect(css).not.toMatch(/transition:\s*all\b/);
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    expect(css).toMatch(/animation-duration:\s*0\.01ms/);
    expect(css).not.toMatch(/linear-gradient|radial-gradient|filter:\s*drop-shadow/);
  });
});

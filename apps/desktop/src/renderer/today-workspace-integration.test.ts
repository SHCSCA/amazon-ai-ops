import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function rendererSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('Task 5A Today workspace integration', () => {
  it('loads the layered workspace styles after the legacy reservoir', () => {
    const app = rendererSource('./App.tsx');
    const legacyIndex = app.indexOf("import './styles.css';");
    const tokensIndex = app.indexOf("import './styles/tokens.css';");
    const foundationsIndex = app.indexOf("import './styles/foundations.css';");
    const shellIndex = app.indexOf("import './styles/shell.css';");
    const workspaceIndex = app.indexOf("import './styles/workspace.css';");
    const tableIndex = app.indexOf("import './styles/priority-table.css';");
    const motionIndex = app.indexOf("import './styles/states-motion.css';");

    expect(legacyIndex).toBeGreaterThanOrEqual(0);
    expect(tokensIndex).toBeGreaterThan(legacyIndex);
    expect(foundationsIndex).toBeGreaterThan(tokensIndex);
    expect(shellIndex).toBeGreaterThan(foundationsIndex);
    expect(workspaceIndex).toBeGreaterThan(shellIndex);
    expect(tableIndex).toBeGreaterThan(workspaceIndex);
    expect(motionIndex).toBeGreaterThan(tableIndex);
  });

  it('keeps the authoritative next action inside Today instead of duplicating it globally', () => {
    const app = rendererSource('./App.tsx');

    expect(app).not.toContain('<NextSafeActionHandoff action={nextSafeAction}');
    expect(app).toContain('<DashboardPage nextSafeAction={nextSafeAction} />');
    expect(app).toContain('nextSafeAction: NextSafeAction');
  });

  it('removes the duplicate sidebar brand while retaining the eight-workspace navigation', () => {
    const shell = rendererSource('./components/app-shell.tsx');

    expect(shell).not.toContain('className="sidebar-brand"');
    expect(shell).toContain('VISIBLE_WORKSPACES');
    expect(shell).toContain('aria-label="主业务导航"');
  });

  it('makes Today a task banner, summary strip, object workbench, and compact context', () => {
    const dashboard = rendererSource('./pages/dashboard-page.tsx');

    expect(dashboard).toContain('<PageFrame');
    expect(dashboard).toContain('<TaskBanner');
    expect(dashboard).toContain('<SummaryStrip');
    expect(dashboard).toContain('<WorkbenchPanel');
    expect(dashboard).toContain('data-workspace="today"');
    expect(dashboard).not.toContain('<PageHeader');
    expect(dashboard).not.toContain('dashboard-overview-metrics');
  });

  it('uses a single non-nested technical disclosure on Today', () => {
    const dashboard = rendererSource('./pages/dashboard-page.tsx');
    const disclosureCount = dashboard.match(/<ProgressiveDetails\b/g)?.length || 0;

    expect(disclosureCount).toBe(1);
    expect(dashboard).not.toMatch(/<ProgressiveDetails[\s\S]*?<ProgressiveDetails/);
  });

  it('offers an in-place reload action when Today cannot load the current scope', () => {
    const dashboard = rendererSource('./pages/dashboard-page.tsx');

    expect(dashboard).toContain('const { data, error, loading, reload, scope } = useBusinessDataPipeline();');
    expect(dashboard).toContain('label: \'重试读取\'');
    expect(dashboard).toContain('onClick: reload');
  });
});

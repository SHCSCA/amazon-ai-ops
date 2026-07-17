import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('business quant diagnostic identity contract', () => {
  const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  const diagnosticsStart = source.indexOf('const diagnostics = rows.map');
  const diagnosticsEnd = source.indexOf('const blockers: string[]', diagnosticsStart);
  const diagnosticsSource = source.slice(diagnosticsStart, diagnosticsEnd);

  it('uses the rules-engine identity as the single evidence-binding authority', () => {
    expect(diagnosticsStart).toBeGreaterThan(-1);
    expect(diagnosticsEnd).toBeGreaterThan(diagnosticsStart);
    expect(diagnosticsSource).toContain('const identity = buildAdMetricObjectIdentity(metric)');
    expect(diagnosticsSource).toContain('objectKey: identity.key');
    expect(diagnosticsSource).toContain('objectType: identity.objectType');
    expect(diagnosticsSource).toContain('objectName: identity.objectName');
    expect(diagnosticsSource).not.toContain("objectType: row.reportType || 'metric'");
  });

  it('includes report identity before building the diagnostic object key', () => {
    expect(diagnosticsSource).toContain("reportType: row.reportType || ''");
    expect(diagnosticsSource.indexOf("reportType: row.reportType || ''"))
      .toBeLessThan(diagnosticsSource.indexOf('buildAdMetricObjectIdentity(metric)'));
  });
});

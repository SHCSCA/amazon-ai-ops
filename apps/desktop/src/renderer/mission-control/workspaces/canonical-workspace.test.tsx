import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CanonicalWorkspace } from './canonical-workspace';

describe('canonical workspace capability inspector copy', () => {
  it('keeps raw capability values inside collapsed diagnostics and exposes Chinese operator guidance', () => {
    const source = readFileSync(new URL('./canonical-workspace.tsx', import.meta.url), 'utf8');
    const inspector = source.match(
      /const inspector = \([\s\S]*?\n  \);\r?\n\r?\n  if \(kind === 'missions'\)/,
    )?.[0] ?? '';
    const ordinaryInspector = inspector.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, '');

    expect(CanonicalWorkspace).toBeTypeOf('function');
    expect(inspector).toContain('<summary>诊断详情</summary>');
    expect(ordinaryInspector).toContain('<dt>状态</dt>');
    expect(ordinaryInspector).toContain('<dt>原因</dt>');
    expect(ordinaryInspector).toContain('<dt>下一步</dt>');
    expect(ordinaryInspector)
      .not.toMatch(/\{capability\.(?:state|detail|blockerCode)\}/);
    expect(inspector).toMatch(
      /<details[\s\S]*?<summary>诊断详情<\/summary>[\s\S]*?\{capability\.state\}[\s\S]*?\{capability\.detail\}[\s\S]*?\{capability\.blockerCode\}[\s\S]*?<\/details>/,
    );
  });
});

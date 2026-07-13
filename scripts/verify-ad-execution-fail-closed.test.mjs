import { spawnSync } from 'child_process';
import path from 'path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');

describe('verify ad execution fail-closed contract', () => {
  it('accepts the current readback tablist semantics without depending on its visible label copy', () => {
    const result = spawnSync(process.execPath, ['scripts/verify-ad-execution-fail-closed.js'], {
      cwd: root,
      encoding: 'utf8',
    });

    const output = `${result.stdout || ''}${result.stderr || ''}`;
    expect(output).not.toContain('readback page shows execution readback wizard');
    expect(output).toContain('[PASS] readback page exposes the semantic wizard tablist');
    expect(output).toContain('[PASS] readback wizard buttons expose the tab role');
    expect(output).toContain('[PASS] readback wizard tabs are bound to stable panels');
    expect(output).toContain('[PASS] readback wizard tabs expose stable reciprocal ids');
    expect(output).toContain('[PASS] readback wizard exposes semantic tab panels');
    expect(output).toContain('[PASS] readback wizard panels expose stable reciprocal ids');
    expect(output).toContain('[PASS] readback wizard panels reference their controlling tabs');
    expect(result.status).toBe(0);
  });
});

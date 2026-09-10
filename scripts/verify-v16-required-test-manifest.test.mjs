import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
describe('required evidence CLI', () => {
  it('fails without an input manifest', () => {
    const result = spawnSync(process.execPath, ['scripts/verify-v16-required-test-manifest.js'], { encoding: 'utf8' });
    expect(result.status).toBe(1); expect(result.stderr).toContain('Missing --manifest');
  });
  it('writes a failing diagnostic for an unexecuted definition instead of claiming acceptance', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v16-cli-'));
    try {
      const out = path.join(dir, 'result.json');
      const result = spawnSync(process.execPath, ['scripts/verify-v16-required-test-manifest.js', '--manifest', 'docs/v16_required_test_manifest.json', '--out', out], { encoding: 'utf8' });
      expect(result.status).toBe(1); const report = JSON.parse(fs.readFileSync(out, 'utf8'));
      expect(report.success).toBe(false); expect(report.details.some(test => !test.success)).toBe(true);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

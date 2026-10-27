import { describe, expect, it } from 'vitest';
import scanner from './verify-no-sensitive-source.js';

describe('current source credential exclusion', () => {
  it.each([
    ['provider', 'sk-' + 'a'.repeat(32), 'PROVIDER_API_KEY'],
    ['project provider', 'sk-proj-' + 'b'.repeat(48), 'PROVIDER_API_KEY'],
    ['cloud access', 'AKIA' + 'C'.repeat(16), 'AWS_ACCESS_KEY'],
    ['private key', '-----BEGIN ' + 'PRIVATE KEY-----', 'PRIVATE_KEY'],
    ['source host token', 'ghp_' + 'd'.repeat(36), 'GITHUB_ACCESS_TOKEN'],
  ])('reports only the path line and kind for a %s match', (_label, value, kind) => {
    const result = scanner.inspectSourceText('docs/example.md', 'header\n' + value);
    expect(result).toEqual([{ path: 'docs/example.md', line: 2, kind }]);
    expect(JSON.stringify(result)).not.toContain(value);
  });
  it('does not confuse ordinary hashes, encrypted envelopes and placeholders with provider keys', () => {
    expect(scanner.inspectSourceText('source.ts', 'apiKey: [REDACTED]\nsha256:' + 'a'.repeat(64) + '\nsk-test-only')).toEqual([]);
  });
  it('scans the real tracked and unignored source without adding acceptance credit to runtime gates', () => {
    const result = scanner.inspectCurrentSource(process.cwd());
    expect(result.scannedFiles).toBeGreaterThan(100);
    expect(result.findings).toEqual([]);
    expect(result.success).toBe(true);
    expect(result).not.toHaveProperty('appReady');
  });
});

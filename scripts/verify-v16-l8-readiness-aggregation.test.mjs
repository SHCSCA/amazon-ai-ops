import { describe, expect, it } from 'vitest';
import { aggregateReadiness } from './verify-v16-l8-readiness-aggregation.js';
import { readJson } from './verify-v16-required-test-manifest.js';
describe('L8 current evidence aggregation', () => {
  it('cannot manufacture READY from unexecuted definitions or claimed progress', () => {
    const manifest = readJson('docs/v16_required_test_manifest.json');
    const result = aggregateReadiness({ ...manifest, readinessStatus: 'APP_READY', progress: 99 }, readJson('docs/v16_requirements_index.json'));
    expect(result.overallStatus).toBe('APP_NEEDS_WORK');
    expect(result.gates).toHaveLength(8); expect(result.gates.every(gate => !gate.passed)).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { verifyServices } from './verify-v16-services-contract.mjs';
const files = ['v16-l4-ui-contract', 'analysis-runs-ipc', 'mission-domain-service', 'analysis-authority-service', 'execution-authority-service'].map(name => 'apps/desktop/src/main/' + name + '.test.ts');
const manifest = { requiredTests: [{ testId: 'actual-suite', testFiles: files }] };
describe('production service contract evidence', () => {
  it('requires passing execution evidence for every production boundary', () => {
    expect(verifyServices(manifest, '.', { issues: [], details: [{ testId: 'actual-suite', success: true }] }).success).toBe(true);
    expect(verifyServices(manifest, '.', { issues: [], details: [{ testId: 'actual-suite', success: false }] }).success).toBe(false);
    expect(verifyServices({ requiredTests: [] }, '.', { issues: [], details: [] }).success).toBe(false);
    expect(verifyServices(manifest, '.', { issues: ['STALE_IDENTITY'], details: [{ testId: 'actual-suite', success: true }] }).success).toBe(false);
  });
});

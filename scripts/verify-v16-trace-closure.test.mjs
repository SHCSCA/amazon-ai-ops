import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { verifyTraceClosure } from './verify-v16-trace-closure.js';
import { parseMustRequirements, readJson } from './verify-v16-required-test-manifest.js';
const dirs = []; afterEach(() => dirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v16-trace-')); dirs.push(root); fs.mkdirSync(path.join(root, 'docs'));
  const prd = '| V16-TEST-001 | MUST | Complete operation | AC-TEST-001 |';
  fs.writeFileSync(path.join(root, 'docs/amazon_ai_ops_agent_prd_v1_6_0.md'), prd); fs.writeFileSync(path.join(root, 'implementation.ts'), 'export const implemented = true;');
  const requirement = { ...parseMustRequirements(prd)[0], implementation: ['implementation.ts'], testIds: ['T1'],
    acceptanceCases: [{ acceptanceId: 'AC-TEST-001', testId: 'T1', caseId: 'workflow.test.ts::round trip persists' }] };
  return { root, requirements: { requirements: [requirement] }, manifest: { requiredTests: [{ testId: 'T1', requirementIds: [requirement.id] }] }, verification: { issues: [], details: [{ testId: 'T1', success: true, caseIds: ['workflow.test.ts::round trip persists'] }] } };
}
describe('MUST trace closure', () => {
  it('indexes every current PRD MUST exactly once', () => {
    const actual = parseMustRequirements(fs.readFileSync('docs/amazon_ai_ops_agent_prd_v1_6_0.md', 'utf8'));
    const indexed = readJson('docs/v16_requirements_index.json').requirements;
    expect(indexed.map(item => item.id).sort()).toEqual(actual.map(item => item.id).sort()); expect(actual.length).toBe(172);
  });
  it('requires both implementation and executed bidirectional test links', () => {
    const f = fixture(); expect(verifyTraceClosure(f.requirements, f.manifest, f.root, f.verification).success).toBe(true);
    f.verification.details[0].success = false; expect(verifyTraceClosure(f.requirements, f.manifest, f.root, f.verification).success).toBe(false);
    f.verification.details[0].success = true; f.manifest.requiredTests[0].requirementIds = []; expect(verifyTraceClosure(f.requirements, f.manifest, f.root, f.verification).success).toBe(false);
  });
  it('rejects nonexistent implementation links even when runner links pass', () => {
    const f = fixture(); f.requirements.requirements[0].implementation = ['missing.ts'];
    expect(verifyTraceClosure(f.requirements, f.manifest, f.root, f.verification).success).toBe(false);
  });
  it('does not turn a whole-suite pass into acceptance of an unexecuted case', () => {
    const f = fixture();
    f.requirements.requirements[0].acceptanceCases[0].caseId = 'workflow.test.ts::never executed';
    expect(verifyTraceClosure(f.requirements, f.manifest, f.root, f.verification).details[0].issues)
      .toContain('UNVERIFIED_ACCEPTANCE_CASE:workflow.test.ts::never executed');
    f.requirements.requirements[0].acceptanceCases = [];
    expect(verifyTraceClosure(f.requirements, f.manifest, f.root, f.verification).details[0].issues)
      .toContain('MISSING_ACCEPTANCE_CASE_MAPPING');
  });
  it('rejects missing or altered PRD obligations', () => {
    const f = fixture(); f.requirements.requirements = []; expect(verifyTraceClosure(f.requirements, f.manifest, f.root, f.verification).success).toBe(false);
  });
});

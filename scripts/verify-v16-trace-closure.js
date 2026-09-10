const fs = require('node:fs');
const path = require('node:path');
const { cliArg, parseMustRequirements, readJson, verifyManifest, writeJson } = require('./verify-v16-required-test-manifest.js');

function verifyTraceClosure(requirements, manifest, root = process.cwd(), verification = verifyManifest(manifest, root)) {
  const issues = [...verification.issues];
  const prd = parseMustRequirements(fs.readFileSync(path.join(root, 'docs/amazon_ai_ops_agent_prd_v1_6_0.md'), 'utf8'));
  const indexed = requirements?.requirements;
  if (!prd.length || new Set(prd.map(r => r.id)).size !== prd.length) issues.push('EMPTY_OR_DUPLICATE_PRD_MUST');
  if (!Array.isArray(indexed) || indexed.length !== prd.length || new Set(indexed.map(r => r.id)).size !== prd.length) issues.push('INCOMPLETE_REQUIREMENT_INDEX');
  const tests = new Map(verification.details.map(test => [test.testId, test]));
  const details = prd.map(required => {
    const entry = indexed?.find(r => r.id === required.id);
    const problems = [];
    if (!entry || entry.title !== required.title || JSON.stringify(entry.acceptanceIds) !== JSON.stringify(required.acceptanceIds)) problems.push('PRD_MISMATCH');
    if (!entry?.testIds?.length || !entry?.implementation?.length) problems.push('MISSING_IMPLEMENTATION_OR_TEST_MAPPING');
    const cases = entry?.acceptanceCases;
    if (!Array.isArray(cases) || required.acceptanceIds.some(id => !cases.some(item => item.acceptanceId === id))) problems.push('MISSING_ACCEPTANCE_CASE_MAPPING');
    for (const item of Array.isArray(cases) ? cases : []) {
      const test = tests.get(item.testId);
      if (!required.acceptanceIds.includes(item.acceptanceId) || !entry.testIds?.includes(item.testId)
        || !test?.success || !test.caseIds?.includes(item.caseId)) problems.push('UNVERIFIED_ACCEPTANCE_CASE:' + String(item.caseId));
    }
    for (const link of entry?.implementation ?? []) {
      const candidate = typeof link === 'string' ? path.resolve(root, link) : '';
      const relative = candidate && path.relative(root, candidate);
      if (!candidate || path.isAbsolute(relative) || relative.startsWith('..') || !fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) problems.push('INVALID_IMPLEMENTATION_LINK:' + String(link));
    }
    for (const id of entry?.testIds ?? []) {
      const test = manifest.requiredTests.find(t => t.testId === id);
      if (!test?.requirementIds?.includes(required.id) || !tests.get(id)?.success) problems.push('UNVERIFIED_TEST:' + id);
    }
    return { id: required.id, success: !problems.length, issues: problems };
  });
  return { schemaVersion: 'v16.trace-closure/1', identity: verification.identity, success: !issues.length && details.length > 0 && details.every(d => d.success), issues, total: details.length, completed: details.filter(d => d.success).length, details };
}
function main() {
  const root = path.resolve(cliArg('repo-root', process.cwd()));
  const manifestPath = cliArg('manifest'), requirementsPath = cliArg('requirements', 'docs/v16_requirements_index.json');
  if (!manifestPath) throw new Error('Missing --manifest');
  const result = verifyTraceClosure(readJson(path.resolve(root, requirementsPath)), readJson(path.resolve(root, manifestPath)), root);
  const out = cliArg('out', path.join(root, 'output/v16-evidence/trace-closure.json'));
  writeJson(out, result);
  console.log(`V1.6 MUST closure: ${result.completed}/${result.total}; ${result.success ? 'PASS' : 'FAIL'}; ${out}`);
  process.exitCode = result.success ? 0 : 1;
}
if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { verifyTraceClosure, main };

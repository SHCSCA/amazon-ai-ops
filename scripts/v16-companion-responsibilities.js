const fs = require('node:fs');
const path = require('node:path');
const { createRuntimeLogRecord } = require('../packages/shared-types/src/runtime-log-format.cjs');

const SOURCE = 'docs/v16_companion_migration_compatibility.md';
const COMPANIONS = ['docs/v16_companion_migration_compatibility.md', 'docs/v16_companion_release_canary.md',
  'docs/v16_companion_verification_traceability.md'];
const RESPONSIBILITIES = ['schema', 'template', 'projection', 'evidence', 'test', 'release'];
const TRACE_INPUTS = ['docs/amazon_ai_ops_agent_prd_v1_6_0.md', 'docs/v16_requirements_index.json', 'docs/v16_required_test_manifest.json'];

function parseResponsibilities(markdown) {
  const text = markdown.replace(/\r\n/g, '\n');
  const section = text.split('## Companion 责任索引\n')[1];
  if (!section?.includes('`v16.companion-responsibilities/1`')) throw new Error('COMPANION_CONTRACT_MISSING');
  const entries = section.split('\n').filter(line => line.startsWith('|')).slice(2)
    .map(line => line.split('|').slice(1, -1).map(cell => cell.trim()));
  if (entries.length !== RESPONSIBILITIES.length || entries.some(row => row.length !== 3 || row.some(value => !value))) {
    throw new Error('COMPANION_RESPONSIBILITY_MISSING');
  }
  if (new Set(entries.map(row => row[0])).size !== RESPONSIBILITIES.length
    || RESPONSIBILITIES.some(role => !entries.some(row => row[0] === role))) throw new Error('COMPANION_RESPONSIBILITY_DUPLICATE');
  if (entries.some(row => !COMPANIONS.includes(row[1]))) throw new Error('COMPANION_SPEC_NOT_CANONICAL');
  return entries.map(([responsibility, specification, implementation]) => ({ responsibility, specification, implementation }));
}

function verifyResponsibilities(root) {
  const rows = parseResponsibilities(fs.readFileSync(path.join(root, SOURCE), 'utf8'));
  for (const target of [...COMPANIONS, ...TRACE_INPUTS, ...rows.map(row => row.implementation)]) {
    const absolute = path.resolve(root, target);
    if (!absolute.startsWith(path.resolve(root) + path.sep) || !fs.statSync(absolute).isFile()) throw new Error('COMPANION_TARGET_INVALID');
  }
  const requirements = JSON.parse(fs.readFileSync(path.join(root, TRACE_INPUTS[1]), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, TRACE_INPUTS[2]), 'utf8'));
  if (!requirements.requirements.some(row => row.id === 'V16-MIG-010' && row.acceptanceIds.includes('AC-MIG-010'))
    || !manifest.requiredTests.some(row => row.testId === 'V16-T-L1-ALL')) throw new Error('COMPANION_TRACE_MISSING');
  return { version: 'v16.companion-responsibilities/1', rows };
}

module.exports = { SOURCE, COMPANIONS, RESPONSIBILITIES, parseResponsibilities, verifyResponsibilities };
if (require.main === module) {
  try {
    const result = verifyResponsibilities(process.cwd());
    console.log(JSON.stringify(createRuntimeLogRecord('info', 'companion.responsibilities_checked',
      { responsibilities: result.rows.length })));
  } catch {
    console.error(JSON.stringify(createRuntimeLogRecord('error', 'companion.responsibilities_failed',
      { code: 'COMPANION_CONTRACT_INVALID' })));
    process.exitCode = 1;
  }
}

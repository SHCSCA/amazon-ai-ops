const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const mainPath = path.join(root, 'apps', 'desktop', 'src', 'main', 'index.ts');
const source = fs.readFileSync(mainPath, 'utf8');

function fail(message) {
  console.error(`[FAIL] ${message}`);
  process.exit(1);
}

function expect(condition, message) {
  if (!condition) fail(message);
}

const missingKeyBranchMatch = source.match(/if \(!config\.apiKey\.trim\(\)\) \{([\s\S]*?)\n  \}/);
expect(Boolean(missingKeyBranchMatch), 'missing-key AI test branch was not found');
const missingKeyBranch = missingKeyBranchMatch[1];

expect(missingKeyBranch.includes('未配置 AI Key'), 'missing-key AI test branch must return an operator-facing unconfigured message');
expect(!missingKeyBranch.includes('persistTestStatus'), 'missing-key AI test branch must not persist failed test status');
expect(source.includes("persistTestStatus('failed', message);"), 'failed provider responses should still persist failed status');
expect(source.includes("persistTestStatus('available', message);"), 'successful provider responses should still persist available status');
expect(source.includes('function normalizeAiSettingsForSave'), 'AI settings save normalizer was not found');
expect(source.includes('savedTestStillMatches'), 'AI settings save must preserve last test status when base URL/model are unchanged');
expect(source.includes('!incomingStatus') && source.includes('!incomingKey'), 'AI test preservation must only apply when renderer did not send a new status or key');
expect(source.includes('saved.aiLastTestBaseUrl === normalized.aiBaseUrl'), 'AI test preservation must compare saved and incoming Base URL');
expect(source.includes('saved.aiLastTestModel === normalized.aiModel'), 'AI test preservation must compare saved and incoming model');
expect(source.includes('strategyDiagnosis?: AdStrategyGenerationSummary'), 'recommendation generation return type must include strategyDiagnosis');

console.log('[PASS] AI settings no-key status smoke verified');

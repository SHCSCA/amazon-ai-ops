const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function pass(message) {
  console.log(`[PASS] ${message}`);
}

function fail(message) {
  console.error(`[FAIL] ${message}`);
  process.exitCode = 1;
}

function expectContains(source, needle, message) {
  if (source.includes(needle)) {
    pass(message);
  } else {
    fail(`${message} missing: ${needle}`);
  }
}

const draft = read('packages/listing-analyzer/src/draft.ts');
const exportSource = read('packages/listing-analyzer/src/export.ts');
const app = read('apps/desktop/src/renderer/App.tsx');

expectContains(
  draft,
  "suggestion.status !== 'accepted'",
  'rule-based Listing draft builder excludes non-accepted suggestions',
);

for (const field of ['currentText', 'draftedText', 'source', 'aiFallbackReason', 'evidence', 'riskWarnings']) {
  expectContains(exportSource, `'${field}'`, `Listing draft exports include ${field}`);
}

expectContains(app, 'acceptedSuggestionCount === 0', 'draft generation is disabled until suggestions are accepted');
expectContains(app, 'generateListingDrafts(acceptedSuggestions)', 'renderer sends only accepted suggestions to draft IPC');
expectContains(app, '用已采纳建议生成草案', 'operator-facing accepted-only draft button is visible');
expectContains(app, 'lastListingDraftExportPath', 'renderer stores the latest Listing draft export path');
expectContains(app, '打开最近草案导出', 'operator can open the latest Listing draft export');
expectContains(app, 'copyDraftText', 'operator can copy a Listing draft');
expectContains(app, '当前原文', 'draft review table shows current Listing text');
expectContains(app, '修改草案', 'draft review table shows drafted Listing text');
expectContains(app, 'AI 回退', 'draft review table shows AI fallback status');
expectContains(app, 'item.evidence', 'draft review table shows source evidence');

if (process.exitCode) {
  console.error('\nNEEDS_WORK: Listing draft UX regression gate failed.');
  process.exit(process.exitCode);
}

console.log('\nLISTING_DRAFT_UX verified.');

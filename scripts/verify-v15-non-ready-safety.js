const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const evidenceDir = path.join(root, 'output', 'codex-evidence');
const bundleRoot = path.join(root, 'output', 'delivery-bundles');

function latestEvidence(pattern) {
  if (!fs.existsSync(evidenceDir)) return null;
  const files = fs.readdirSync(evidenceDir)
    .filter((name) => pattern.test(name))
    .map((name) => {
      const filePath = path.join(evidenceDir, name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files[0]?.filePath || null;
}

function latestBundleManifest() {
  if (!fs.existsSync(bundleRoot)) return null;
  const files = fs.readdirSync(bundleRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(bundleRoot, entry.name, 'delivery-bundle-manifest.json'))
    .filter((filePath) => fs.existsSync(filePath))
    .map((filePath) => ({ filePath, mtimeMs: fs.statSync(filePath).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files[0]?.filePath || null;
}

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
    args[key] = value;
    index += 1;
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function requireFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} file is missing: ${filePath}`);
  }
}

function gateByName(finalReadiness, name) {
  return (finalReadiness.gates || []).find((gate) => gate.name === name);
}

function check(condition, message, failures) {
  if (condition) {
    console.log(`[PASS] ${message}`);
    return;
  }
  failures.push(message);
  console.error(`[FAIL] ${message}`);
}

function main() {
  const args = parseArgs(process.argv);
  const finalReadinessPath = path.resolve(args['final-readiness'] || latestEvidence(/^final-readiness-.*\.json$/i) || path.join(evidenceDir, 'final-readiness-2026-06-09.json'));
  const bundleManifestPath = path.resolve(args['bundle-manifest'] || latestBundleManifest() || path.join(bundleRoot, 'v15-delivery-bundle-2026-06-09', 'delivery-bundle-manifest.json'));
  const readmePath = path.join(root, 'README.md');
  const failures = [];

  requireFile(finalReadinessPath, 'final readiness');
  requireFile(bundleManifestPath, 'delivery bundle manifest');
  requireFile(readmePath, 'README');

  const finalReadiness = readJson(finalReadinessPath);
  const manifest = readJson(bundleManifestPath);
  const readme = fs.readFileSync(readmePath, 'utf8');
  const aiLive = gateByName(finalReadiness, 'AI live provider');
  const adAiExplanation = gateByName(finalReadiness, 'Ad recommendation AI explanation');
  const listingAiDraft = gateByName(finalReadiness, 'Listing AI draft');
  const adReadback = gateByName(finalReadiness, 'Real ad execution readback');

  check(finalReadiness.status === 'APP_NEEDS_WORK', 'final readiness status remains APP_NEEDS_WORK', failures);
  check(finalReadiness.evidenceSelection?.mode === 'manifest', 'final readiness uses manifest evidence selection', failures);
  check(
    Boolean(finalReadiness.evidenceSelection?.manifestPath && fs.existsSync(path.resolve(finalReadiness.evidenceSelection.manifestPath))),
    'final readiness evidence manifest exists',
    failures,
  );
  check(finalReadiness.appReady === false, 'final readiness appReady is false', failures);
  check(finalReadiness.reportCollectionReady === true, 'report collection ready remains true', failures);
  check(finalReadiness.listingReadReady === true, 'Listing read ready remains true', failures);
  check(aiLive && aiLive.ok === true && aiLive.status === 'passed', 'AI live gate is passed with real provider evidence', failures);
  check(adAiExplanation && adAiExplanation.ok === true && adAiExplanation.status === 'passed', 'ad recommendation AI explanation gate is passed with real AI evidence', failures);
  check(listingAiDraft && listingAiDraft.ok === true && listingAiDraft.status === 'passed', 'Listing AI draft gate is passed with real AI evidence', failures);
  check(adReadback && adReadback.ok === false && adReadback.status === 'needs_work', 'real ad readback gate remains the only READY blocker', failures);

  check(manifest.status === 'APP_NEEDS_WORK', 'delivery bundle manifest status remains APP_NEEDS_WORK', failures);
  check(manifest.appReady === false, 'delivery bundle manifest appReady is false', failures);
  check(/Do not present this bundle as final READY/.test(manifest.warning || ''), 'delivery bundle warning blocks READY claims', failures);
  check(/REPORT_COLLECTION_READY \/ APP_NEEDS_WORK/.test(readme), 'README top-level delivery line states REPORT_COLLECTION_READY / APP_NEEDS_WORK', failures);
  check(!/\*\*DELIVERY:\s*APP_READY\b/.test(readme), 'README does not mark top-level delivery as APP_READY', failures);

  if (failures.length > 0) {
    console.error(`\nNEEDS_WORK: ${failures.length} non-ready safety check(s) failed.`);
    process.exit(1);
  }
  console.log('\nNON_READY_SAFETY verified.');
}

main();

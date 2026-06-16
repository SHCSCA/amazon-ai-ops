const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const evidenceDir = path.join(root, 'output', 'codex-evidence');
const deliveryBundlesDir = path.join(root, 'output', 'delivery-bundles');

function latestEvidence(pattern) {
  if (!fs.existsSync(evidenceDir)) return undefined;
  return fs.readdirSync(evidenceDir)
    .filter((name) => pattern.test(name))
    .map((name) => path.join(evidenceDir, name))
    .filter((filePath) => fs.statSync(filePath).isFile())
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}

function latestFinalReadinessEvidence() {
  return latestEvidence(/^final-readiness-\d{4}-\d{2}-\d{2}\.json$/i);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function latestBundleManifest() {
  if (!fs.existsSync(deliveryBundlesDir)) return undefined;
  return fs.readdirSync(deliveryBundlesDir)
    .map((name) => path.join(deliveryBundlesDir, name, 'delivery-bundle-manifest.json'))
    .filter((filePath) => fs.existsSync(filePath) && fs.statSync(filePath).isFile())
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}

function check(ok, message, failures) {
  if (ok) {
    console.log(`[PASS] ${message}`);
  } else {
    failures.push(message);
    console.error(`[FAIL] ${message}`);
  }
}

const failures = [];
const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (arg.startsWith('--')) {
    args.set(arg.slice(2), process.argv[index + 1]);
    index += 1;
  }
}

const finalReadinessPath = path.resolve(args.get('final-readiness') || latestFinalReadinessEvidence() || '');
const smokePath = path.resolve(args.get('ui-smoke') || latestEvidence(/^v15-product-readiness-ui-smoke-.*\.json$/i) || '');
const bundleManifestPath = path.resolve(args.get('bundle-manifest') || latestBundleManifest() || '');
const readmePath = path.join(root, 'README.md');

check(Boolean(finalReadinessPath && fs.existsSync(finalReadinessPath)), 'final readiness evidence exists', failures);
check(Boolean(smokePath && fs.existsSync(smokePath)), 'latest product readiness UI smoke exists', failures);
check(Boolean(bundleManifestPath && fs.existsSync(bundleManifestPath)), 'latest delivery bundle manifest exists', failures);
check(fs.existsSync(readmePath), 'README exists', failures);

let finalReadiness = {};
let smoke = {};
let bundleManifest = {};
let readme = '';
if (fs.existsSync(finalReadinessPath)) finalReadiness = readJson(finalReadinessPath);
if (fs.existsSync(smokePath)) smoke = readJson(smokePath);
if (fs.existsSync(bundleManifestPath)) bundleManifest = readJson(bundleManifestPath);
if (fs.existsSync(readmePath)) readme = fs.readFileSync(readmePath, 'utf8');

check(finalReadiness.status === 'APP_READY', 'final readiness status is APP_READY', failures);
check(finalReadiness.appReady === true, 'final readiness appReady=true', failures);
check(finalReadiness.evidenceSelection?.mode === 'manifest', 'final readiness uses explicit evidence manifest', failures);
check(Array.isArray(finalReadiness.gates) && finalReadiness.gates.every((gate) => gate.ok === true), 'all final readiness gates pass', failures);
check(finalReadiness.gates?.some((gate) => gate.name === 'Real ad execution readback' && gate.ok === true), 'real ad readback gate passes', failures);
check(Boolean(finalReadiness.evidenceSelection?.manifestPath && fs.existsSync(finalReadiness.evidenceSelection.manifestPath)), 'selected evidence manifest exists', failures);

const manifest = finalReadiness.evidenceSelection?.manifestPath && fs.existsSync(finalReadiness.evidenceSelection.manifestPath)
  ? readJson(finalReadiness.evidenceSelection.manifestPath)
  : {};
check(manifest.evidence?.adReadback?.exists === true, 'manifest selects real ad readback evidence', failures);
check(Boolean(manifest.evidence?.adReadback?.absolutePath && fs.existsSync(manifest.evidence.adReadback.absolutePath)), 'ad readback evidence file exists', failures);

check(/\*\*DELIVERY:\s*APP_READY\b/.test(readme), 'README top-level delivery line states APP_READY', failures);
check(!/DELIVERY:\s*REPORT_COLLECTION_READY \/ APP_NEEDS_WORK/.test(readme), 'README no longer states top-level APP_NEEDS_WORK', failures);

const smokeText = JSON.stringify(smoke);
check(/APP_READY/.test(smokeText), 'UI smoke contains APP_READY state', failures);
check(/通用执行合同/.test(smokeText), 'UI smoke contains generalized ad execution contract', failures);
check(/广告 readback 已通过/.test(smokeText), 'UI smoke contains ad readback pass state', failures);
check(!/NEEDS_WORK \/ 待真实审批 \/ 不可作为 READY 证据/.test(smokeText), 'UI smoke no longer shows stale readback blocker', failures);
check(bundleManifest.status === 'APP_READY' && bundleManifest.appReady === true, 'delivery bundle manifest is APP_READY', failures);
check(Array.isArray(bundleManifest.files) && bundleManifest.files.some((file) => file.label === 'scripts/verify-v15-ready-safety.js'), 'delivery bundle includes READY safety verifier', failures);
check(bundleManifest.dataReconciliation?.present === true, 'delivery bundle includes current-scope data reconciliation summary', failures);
check(Boolean(bundleManifest.dataReconciliation?.bundleJson), 'delivery bundle includes data reconciliation JSON file', failures);
check(Boolean(bundleManifest.dataReconciliation?.bundleMarkdown), 'delivery bundle includes data reconciliation Markdown file', failures);
check(Boolean(bundleManifest.dataReconciliation?.canonicalSource), 'delivery bundle records canonical data source', failures);
check(Number(bundleManifest.dataReconciliation?.canonical?.spend || 0) > 0, 'delivery bundle records non-zero canonical ad spend', failures);
check(Array.isArray(bundleManifest.dataReconciliation?.blockers) && bundleManifest.dataReconciliation.blockers.length === 0, 'delivery bundle data reconciliation has no blockers', failures);

if (failures.length > 0) {
  console.error(`\nNEEDS_WORK: ${failures.length} READY safety check(s) failed.`);
  process.exit(1);
}

console.log('\nV15_READY_SAFETY verified.');

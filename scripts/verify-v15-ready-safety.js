const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const evidenceDir = path.join(root, 'output', 'codex-evidence');
const deliveryBundlesDir = path.join(root, 'output', 'delivery-bundles');
const finalReadinessPattern = /^final-readiness-(?:\d{4}-\d{2}-\d{2}|\d{10,})\.json$/i;
const currentBusinessUiSmokeScripts = [
  'scripts/smoke-business-ui-shell.js',
  'scripts/smoke-business-ui-data-pipeline.js',
  'scripts/smoke-business-ui-ad-execution.js',
  'scripts/smoke-business-ui-keyword-listing.js',
  'scripts/smoke-business-ui-settings-delivery.js',
];

function latestEvidence(pattern) {
  if (!fs.existsSync(evidenceDir)) return undefined;
  return fs.readdirSync(evidenceDir)
    .filter((name) => pattern.test(name))
    .map((name) => path.join(evidenceDir, name))
    .filter((filePath) => fs.statSync(filePath).isFile())
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}

function latestFinalReadinessEvidence() {
  return latestEvidence(finalReadinessPattern);
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

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function completeFinalPackageIndex(index) {
  return index?.present === true
    && Number(index.count || 0) > 0
    && Number(index.existingCount || 0) === Number(index.count || 0)
    && Number(index.missingCount || 0) === 0
    && Array.isArray(index.packages)
    && index.packages.length === Number(index.count || 0)
    && index.packages.some((item) => item.kind === 'installer')
    && index.packages.some((item) => item.kind === 'portable')
    && index.packages.every((item) => (
      item?.exists === true
      && Boolean(item.sourcePath)
      && Boolean(item.fileName)
      && fs.existsSync(item.sourcePath)
      && fs.statSync(item.sourcePath).isFile()
      && /^[A-F0-9]{64}$/.test(String(item.sha256 || ''))
      && Number(item.sizeBytes || 0) > 0
      && fs.statSync(item.sourcePath).size === Number(item.sizeBytes || 0)
      && sha256(item.sourcePath) === String(item.sha256 || '').toUpperCase()
    ));
}

function packageIdentity(item) {
  return [
    String(item?.kind || ''),
    String(item?.sourcePath || ''),
    String(item?.fileName || ''),
  ].join('\u0000');
}

function packagesMatch(leftPackages, rightPackages) {
  if (!Array.isArray(leftPackages) || !Array.isArray(rightPackages)) return false;
  if (leftPackages.length !== rightPackages.length) return false;
  const left = [...leftPackages].sort((a, b) => packageIdentity(a).localeCompare(packageIdentity(b)));
  const right = [...rightPackages].sort((a, b) => packageIdentity(a).localeCompare(packageIdentity(b)));
  return left.every((item, index) => {
    const other = right[index];
    return item.kind === other.kind
      && path.resolve(item.sourcePath) === path.resolve(other.sourcePath)
      && item.fileName === other.fileName
      && Number(item.sizeBytes || 0) === Number(other.sizeBytes || 0)
      && String(item.sha256 || '').toUpperCase() === String(other.sha256 || '').toUpperCase();
  });
}

function completeBundlePackageIndexSummary(index) {
  return index?.present === true
    && Number(index.count || 0) > 0
    && Number(index.existingCount || 0) === Number(index.count || 0)
    && Number(index.missingCount || 0) === 0
    && Boolean(index.bundleJson);
}

function completeBundlePackageIndex(index, bundleManifestPath, finalIndex) {
  if (!completeBundlePackageIndexSummary(index)) return false;
  const packageIndexPath = path.resolve(path.dirname(bundleManifestPath), index.bundleJson);
  if (!fs.existsSync(packageIndexPath) || !fs.statSync(packageIndexPath).isFile()) return false;
  let packageIndex;
  try {
    packageIndex = readJson(packageIndexPath);
  } catch {
    return false;
  }
  const packages = Array.isArray(packageIndex.packages) ? packageIndex.packages : [];
  if (packages.length !== Number(index.count || 0)) return false;
  const fileIndexOk = completeFinalPackageIndex({
    present: true,
    count: packages.length,
    existingCount: packages.length,
    missingCount: 0,
    packages,
  });
  if (!fileIndexOk) return false;
  return packagesMatch(packages, finalIndex?.packages || []);
}

function completePackageLaunchSmoke(smoke, finalIndex) {
  if (smoke?.present !== true || smoke.passed !== true) return false;
  if (!smoke.evidencePath || !fs.existsSync(smoke.evidencePath) || !fs.statSync(smoke.evidencePath).isFile()) return false;
  const portablePackage = (finalIndex?.packages || []).find((item) => item.kind === 'portable');
  const checks = Array.isArray(smoke.checks) ? smoke.checks : [];
  const hasCheck = (kind) => checks.some((item) => item?.kind === kind && item.ok === true);
  const validArtifact = (artifact) => {
    if (!artifact?.path || !fs.existsSync(artifact.path) || !fs.statSync(artifact.path).isFile()) return false;
    if (Number(artifact.sizeBytes || 0) <= 0) return false;
    if (fs.statSync(artifact.path).size !== Number(artifact.sizeBytes || 0)) return false;
    return /^[A-F0-9]{64}$/.test(String(artifact.sha256 || ''))
      && sha256(artifact.path) === String(artifact.sha256 || '').toUpperCase();
  };
  const portable = smoke.artifacts?.portable;
  return validArtifact(smoke.artifacts?.unpacked)
    && validArtifact(portable)
    && hasCheck('win-unpacked')
    && hasCheck('portable')
    && Boolean(portablePackage)
    && path.resolve(portable.path) === path.resolve(portablePackage.sourcePath)
    && Number(portable.sizeBytes || 0) === Number(portablePackage.sizeBytes || 0)
    && String(portable.sha256 || '').toUpperCase() === String(portablePackage.sha256 || '').toUpperCase();
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
const smokePath = path.resolve(
  args.get('ui-smoke')
  || latestEvidence(/^current-business-ui-smoke-.*\.json$/i)
  || latestEvidence(/^v15-product-readiness-ui-smoke-.*\.json$/i)
  || '',
);
const bundleManifestPath = path.resolve(args.get('bundle-manifest') || latestBundleManifest() || '');
const readmePath = path.resolve(args.get('readme') || path.join(root, 'README.md'));
const bundleReadmePath = bundleManifestPath && fs.existsSync(bundleManifestPath)
  ? path.join(path.dirname(bundleManifestPath), 'docs', 'README.md')
  : '';

check(Boolean(finalReadinessPath && fs.existsSync(finalReadinessPath)), 'final readiness evidence exists', failures);
check(Boolean(smokePath && fs.existsSync(smokePath)), 'current business or legacy product readiness UI smoke exists', failures);
check(Boolean(bundleManifestPath && fs.existsSync(bundleManifestPath)), 'latest delivery bundle manifest exists', failures);
check(fs.existsSync(readmePath), 'README exists', failures);
check(Boolean(bundleReadmePath && fs.existsSync(bundleReadmePath)), 'delivery bundle README exists', failures);

let finalReadiness = {};
let smoke = {};
let bundleManifest = {};
let readme = '';
let bundleReadme = '';
if (fs.existsSync(finalReadinessPath)) finalReadiness = readJson(finalReadinessPath);
if (fs.existsSync(smokePath)) smoke = readJson(smokePath);
if (fs.existsSync(bundleManifestPath)) bundleManifest = readJson(bundleManifestPath);
if (fs.existsSync(readmePath)) readme = fs.readFileSync(readmePath, 'utf8');
if (bundleReadmePath && fs.existsSync(bundleReadmePath)) bundleReadme = fs.readFileSync(bundleReadmePath, 'utf8');

check(finalReadiness.status === 'APP_READY', 'final readiness status is APP_READY', failures);
check(finalReadiness.appReady === true, 'final readiness appReady=true', failures);
check(finalReadiness.evidenceSelection?.mode === 'manifest', 'final readiness uses explicit evidence manifest', failures);
check(Array.isArray(finalReadiness.gates) && finalReadiness.gates.every((gate) => gate.ok === true), 'all final readiness gates pass', failures);
check(finalReadiness.gates?.some((gate) => gate.name === 'Real ad execution readback' && gate.ok === true), 'real ad readback gate passes', failures);
check(finalReadiness.gates?.some((gate) => gate.name === 'Release package hash' && gate.ok === true), 'release package hash gate passes', failures);
check(completeFinalPackageIndex(finalReadiness.packageIndex), 'final readiness records package hash evidence', failures);
check(finalReadiness.gates?.some((gate) => gate.name === 'Package launch smoke' && gate.ok === true), 'package launch smoke gate passes', failures);
check(completePackageLaunchSmoke(finalReadiness.packageLaunchSmoke, finalReadiness.packageIndex), 'final readiness records valid package launch smoke evidence', failures);
check(Boolean(finalReadiness.evidenceSelection?.manifestPath && fs.existsSync(finalReadiness.evidenceSelection.manifestPath)), 'selected evidence manifest exists', failures);

const manifest = finalReadiness.evidenceSelection?.manifestPath && fs.existsSync(finalReadiness.evidenceSelection.manifestPath)
  ? readJson(finalReadiness.evidenceSelection.manifestPath)
  : {};
check(manifest.evidence?.adReadback?.exists === true, 'manifest selects real ad readback evidence', failures);
check(Boolean(manifest.evidence?.adReadback?.absolutePath && fs.existsSync(manifest.evidence.adReadback.absolutePath)), 'ad readback evidence file exists', failures);
if (manifest.evidence?.adReadback?.absolutePath && fs.existsSync(manifest.evidence.adReadback.absolutePath)) {
  const readbackVerification = runNode('scripts/verify-ad-readback-evidence.js', [manifest.evidence.adReadback.absolutePath]);
  check(readbackVerification.ok, 'selected ad readback evidence passes verify:ad-readback', failures);
  if (!readbackVerification.ok && readbackVerification.output) {
    console.error(readbackVerification.output.split(/\r?\n/).slice(-8).join('\n'));
  }
}

check(/\*\*DELIVERY:\s*APP_READY\b/.test(readme), 'README top-level delivery line states APP_READY', failures);
check(!/DELIVERY:\s*REPORT_COLLECTION_READY \/ APP_NEEDS_WORK/.test(readme), 'README no longer states top-level APP_NEEDS_WORK', failures);
check(/\*\*DELIVERY:\s*APP_READY\b/.test(bundleReadme), 'delivery bundle README states APP_READY', failures);
check(!/DELIVERY:\s*REPORT_COLLECTION_READY \/ APP_NEEDS_WORK/.test(bundleReadme), 'delivery bundle README no longer states top-level APP_NEEDS_WORK', failures);

const smokeText = JSON.stringify(smoke);
const isCurrentBusinessUiSmoke = smoke?.kind === 'current-business-ui-smoke-summary';
if (isCurrentBusinessUiSmoke) {
  const smokeScripts = Array.isArray(smoke.scripts) ? smoke.scripts : [];
  check(smoke.passed === true, 'current business UI smoke summary passed', failures);
  for (const script of currentBusinessUiSmokeScripts) {
    check(smokeScripts.some((item) => item?.script === script && item?.status === 0), `current business UI smoke includes passing ${script}`, failures);
  }
  check(!/APP_READY|APP_NEEDS_WORK|REPORT_COLLECTION_READY/.test(smokeText), 'current business UI smoke does not expose raw readiness status codes', failures);
} else {
  check(/APP_READY/.test(smokeText), 'legacy UI smoke contains APP_READY state', failures);
  check(/通用执行合同/.test(smokeText), 'legacy UI smoke contains generalized ad execution contract', failures);
  check(/广告 readback 已通过/.test(smokeText), 'legacy UI smoke contains ad readback pass state', failures);
  check(!/NEEDS_WORK \/ 待真实审批 \/ 不可作为 READY 证据/.test(smokeText), 'legacy UI smoke no longer shows stale readback blocker', failures);
}

function runNode(script, args = []) {
  const result = spawnSync(process.execPath, [path.join(root, script), ...args], {
    cwd: root,
    encoding: 'utf8',
  });
  return {
    ok: result.status === 0,
    output: `${result.stdout || ''}${result.stderr || ''}`,
  };
}
check(bundleManifest.status === 'APP_READY' && bundleManifest.appReady === true, 'delivery bundle manifest is APP_READY', failures);
check(Array.isArray(bundleManifest.files) && bundleManifest.files.some((file) => file.label === 'scripts/verify-v15-ready-safety.js'), 'delivery bundle includes READY safety verifier', failures);
check(bundleManifest.dataReconciliation?.present === true, 'delivery bundle includes current-scope data reconciliation summary', failures);
check(Boolean(bundleManifest.dataReconciliation?.bundleJson), 'delivery bundle includes data reconciliation JSON file', failures);
check(Boolean(bundleManifest.dataReconciliation?.bundleMarkdown), 'delivery bundle includes data reconciliation Markdown file', failures);
check(Boolean(bundleManifest.dataReconciliation?.canonicalSource), 'delivery bundle records canonical data source', failures);
check(Number(bundleManifest.dataReconciliation?.canonical?.spend || 0) > 0, 'delivery bundle records non-zero canonical ad spend', failures);
check(Array.isArray(bundleManifest.dataReconciliation?.blockers) && bundleManifest.dataReconciliation.blockers.length === 0, 'delivery bundle data reconciliation has no blockers', failures);
check(bundleManifest.realReportIndex?.present === true, 'delivery bundle includes real report file index', failures);
check(Boolean(bundleManifest.realReportIndex?.bundleJson), 'delivery bundle includes real report index JSON file', failures);
check(Number(bundleManifest.realReportIndex?.count || 0) > 0, 'delivery bundle real report index references source reports', failures);
check(Number(bundleManifest.realReportIndex?.existingCount || 0) === Number(bundleManifest.realReportIndex?.count || 0), 'delivery bundle real report index resolves all source reports', failures);
check(Number(bundleManifest.realReportIndex?.missingCount || 0) === 0, 'delivery bundle real report index has no missing source reports', failures);
check(completeBundlePackageIndexSummary(bundleManifest.packageIndex), 'delivery bundle includes package hash index', failures);
check(completeBundlePackageIndex(bundleManifest.packageIndex, bundleManifestPath, finalReadiness.packageIndex), 'delivery bundle package index file is valid', failures);

if (failures.length > 0) {
  console.error(`\nNEEDS_WORK: ${failures.length} READY safety check(s) failed.`);
  process.exit(1);
}

console.log('\nV15_READY_SAFETY verified.');

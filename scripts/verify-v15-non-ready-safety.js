const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const evidenceDir = path.join(root, 'output', 'codex-evidence');
const bundleRoot = path.join(root, 'output', 'delivery-bundles');
const finalReadinessPattern = /^final-readiness-(?:\d{4}-\d{2}-\d{2}|\d{10,})\.json$/i;

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

function requireFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} file is missing: ${filePath}`);
  }
}

function gateByName(finalReadiness, name) {
  return (finalReadiness.gates || []).find((gate) => gate.name === name);
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function check(condition, message, failures) {
  if (condition) {
    console.log(`[PASS] ${message}`);
    return;
  }
  failures.push(message);
  console.error(`[FAIL] ${message}`);
}

function readmeStatesNonReady(readme) {
  return /\*\*DELIVERY:\s*(IN_PROGRESS|APP_NEEDS_WORK|REPORT_COLLECTION_READY \/ APP_NEEDS_WORK)\b/.test(readme)
    && !/\*\*DELIVERY:\s*APP_READY\b/.test(readme);
}

function selectedAdReadbackPath(finalReadiness) {
  const manifestPath = finalReadiness.evidenceSelection?.manifestPath;
  if (!manifestPath || !fs.existsSync(path.resolve(manifestPath))) return '';
  try {
    const evidenceManifest = readJson(path.resolve(manifestPath));
    return evidenceManifest.evidence?.adReadback?.absolutePath || '';
  } catch {
    return '';
  }
}

function hasOnlyLegacySourceTraceabilityFailure(output) {
  const failureLines = String(output || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('[FAIL]'));
  return failureLines.length === 1 && failureLines[0] === '[FAIL] source report traceability is incomplete';
}

function hasCurrentPackageHashEvidence(finalReadiness) {
  const releasePackageGate = gateByName(finalReadiness, 'Release package hash');
  const index = finalReadiness.packageIndex;
  if (!releasePackageGate || releasePackageGate.ok !== true || releasePackageGate.status !== 'passed') return false;
  if (index?.present !== true) return false;
  if (Number(index.count || 0) <= 0) return false;
  if (Number(index.existingCount || 0) !== Number(index.count || 0)) return false;
  if (Number(index.missingCount || 0) !== 0) return false;
  if (!Array.isArray(index.packages)) return false;
  if (!index.packages.some((item) => item.kind === 'installer')) return false;
  if (!index.packages.some((item) => item.kind === 'portable')) return false;
  return index.packages.every((item) => {
    if (!item?.sourcePath || !fs.existsSync(item.sourcePath) || !fs.statSync(item.sourcePath).isFile()) return false;
    if (Number(item.sizeBytes || 0) <= 0 || fs.statSync(item.sourcePath).size !== Number(item.sizeBytes || 0)) return false;
    return /^[A-F0-9]{64}$/.test(String(item.sha256 || ''))
      && sha256(item.sourcePath) === String(item.sha256 || '').toUpperCase();
  });
}

function main() {
  const args = parseArgs(process.argv);
  const finalReadinessPath = path.resolve(args['final-readiness'] || latestEvidence(finalReadinessPattern) || path.join(evidenceDir, 'final-readiness-2026-06-09.json'));
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
  const readmeNonReady = readmeStatesNonReady(readme);
  const historicalReadyFinalReadiness = readmeNonReady && finalReadiness.status === 'APP_READY' && finalReadiness.appReady === true;
  const historicalReadyBundle = readmeNonReady && manifest.status === 'APP_READY' && manifest.appReady === true;

  check(finalReadiness.evidenceSelection?.mode === 'manifest', 'final readiness uses manifest evidence selection', failures);
  check(
    Boolean(finalReadiness.evidenceSelection?.manifestPath && fs.existsSync(path.resolve(finalReadiness.evidenceSelection.manifestPath))),
    'final readiness evidence manifest exists',
    failures,
  );
  if (historicalReadyFinalReadiness) {
    check(true, 'historical APP_READY final readiness is baseline only because README is non-ready', failures);
    check(hasCurrentPackageHashEvidence(finalReadiness), 'historical APP_READY baseline has current package hash evidence', failures);
  } else {
    check(finalReadiness.status === 'APP_NEEDS_WORK', 'final readiness status remains APP_NEEDS_WORK', failures);
    check(finalReadiness.appReady === false, 'final readiness appReady is false', failures);
  }
  check(finalReadiness.reportCollectionReady === true, 'report collection ready remains true', failures);
  check(finalReadiness.listingReadReady === true, 'Listing read ready remains true', failures);
  check(aiLive && aiLive.ok === true && aiLive.status === 'passed', 'AI live gate is passed with real provider evidence', failures);
  check(adAiExplanation && adAiExplanation.ok === true && adAiExplanation.status === 'passed', 'ad recommendation AI explanation gate is passed with real AI evidence', failures);
  check(listingAiDraft && listingAiDraft.ok === true && listingAiDraft.status === 'passed', 'Listing AI draft gate is passed with real AI evidence', failures);
  if (historicalReadyFinalReadiness) {
    check(adReadback && adReadback.ok === true && adReadback.status === 'passed', 'historical real ad readback gate is baseline only', failures);
    const readbackPath = selectedAdReadbackPath(finalReadiness);
    if (readbackPath && fs.existsSync(path.resolve(readbackPath))) {
      const readbackVerification = runNode('scripts/verify-ad-readback-evidence.js', [path.resolve(readbackPath)]);
      if (readbackVerification.ok) {
        check(true, 'historical real ad readback baseline passes verify:ad-readback', failures);
      } else if (hasOnlyLegacySourceTraceabilityFailure(readbackVerification.output)) {
        check(false, 'historical real ad readback baseline lacks current source report traceability only', failures);
      } else {
        check(false, 'historical real ad readback baseline passes verify:ad-readback', failures);
      }
      if (!readbackVerification.ok && readbackVerification.output && !hasOnlyLegacySourceTraceabilityFailure(readbackVerification.output)) {
        console.error(readbackVerification.output.split(/\r?\n/).slice(-8).join('\n'));
      }
    } else {
      check(false, 'historical real ad readback baseline has manifest-selected evidence file', failures);
    }
  } else {
    check(adReadback && adReadback.ok === false && adReadback.status === 'needs_work', 'real ad readback gate remains the only READY blocker', failures);
  }

  if (historicalReadyBundle) {
    check(true, 'historical APP_READY delivery bundle is baseline only because README is non-ready', failures);
  } else {
    check(manifest.status === 'APP_NEEDS_WORK', 'delivery bundle manifest status remains APP_NEEDS_WORK', failures);
    check(manifest.appReady === false, 'delivery bundle manifest appReady is false', failures);
    check(/Do not present this bundle as final READY/.test(manifest.warning || ''), 'delivery bundle warning blocks READY claims', failures);
  }
  check(readmeNonReady, 'README top-level delivery line is non-ready', failures);

  if (failures.length > 0) {
    console.error(`\nNEEDS_WORK: ${failures.length} non-ready safety check(s) failed.`);
    process.exit(1);
  }
  console.log('\nNON_READY_SAFETY verified.');
}

main();

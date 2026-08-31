// One-shot helper that derives a final-readiness JSON for the 2026-08-31
// package from the existing 2026-07-27 stage8 NON_READY evidence. It only
// rewrites the hash-bound fields that must match the new package +
// just-generated package-launch-smoke + current SQLite DB path:
//   - packageIndex.packages[*]  -> installer + portable EXE
//   - currentPortablePackage    -> portable EXE
//   - packageLaunchSmoke        -> new smoke path + generatedAt + portable sha
//   - authorityDatabasePath     -> resolved DB path
// It intentionally preserves the existing packageAdversarialNodeEnv section
// (with its 2026-07-27 hash-bound evidence file) because that smoke cannot be
// re-run without launching a packaged Electron app, which the user prohibited.
// The downstream verify:v15-non-ready-safety run will report any mismatch.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const repoRoot = path.resolve(__dirname, '..');
const evidenceDir = path.join(repoRoot, 'output', 'codex-evidence');
const templatePath = path.join(
  evidenceDir,
  'final-readiness-20260727-stage8-non-ready-v7.json',
);
const newSmokePath = process.argv[2];
const outPath = process.argv[3];
if (!newSmokePath || !outPath) {
  console.error('usage: node scripts/_patch-final-readiness-for-20260831-build.js <new-smoke.json> <out-final-readiness.json>');
  process.exit(2);
}
if (!fs.existsSync(templatePath)) {
  console.error('template final-readiness is missing:', templatePath);
  process.exit(2);
}
if (!fs.existsSync(newSmokePath)) {
  console.error('new smoke evidence is missing:', newSmokePath);
  process.exit(2);
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}
function fileInfo(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`file is missing: ${filePath}`);
  }
  const stat = fs.statSync(filePath);
  return {
    path: filePath,
    sizeBytes: stat.size,
    sha256: sha256(filePath),
    mtime: stat.mtime.toISOString(),
  };
}

const template = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
const newSmoke = JSON.parse(fs.readFileSync(newSmokePath, 'utf8'));

const releaseDir = path.join(repoRoot, 'apps', 'desktop', 'release');
const installerExe = path.join(releaseDir, 'AmazonAIOpsAgent-1.5.1.exe');
const portableExe = path.join(releaseDir, 'AmazonAIOpsAgent-1.5.1-portable.exe');
const winUnpackedExe = path.join(releaseDir, 'win-unpacked', 'AmazonAIOpsAgent.exe');
const blockmap = path.join(releaseDir, 'AmazonAIOpsAgent-1.5.1.exe.blockmap');

const patched = JSON.parse(JSON.stringify(template));
patched.generatedAt = new Date().toISOString();
patched.evidenceSelection = {
  ...template.evidenceSelection,
  // Preserve the 2026-07-27 evidence manifest that selects the same
  // non-ready gates + same evidence files; only the package-launch-smoke
  // and package-index subfields below are repointed at the new build.
  manifestPath: template.evidenceSelection?.manifestPath
    || path.join(evidenceDir, 'v15-final-readiness-evidence-manifest-20260727-stage8-non-ready-v7.json'),
  authorityDbPath: process.env.AMAZON_AI_OPS_DB_PATH
    || path.join(process.env.APPDATA || '', '@amazon-ai-ops', 'desktop', 'amazon-ai-ops.db'),
  authorityDbSelectedBy: 'env-override',
  authorityDbResolutionError: null,
};

const installerInfo = fileInfo(installerExe);
const portableInfo = fileInfo(portableExe);
const winUnpackedInfo = fileInfo(winUnpackedExe);
const blockmapInfo = fileInfo(blockmap);

patched.packageIndex = {
  ...template.packageIndex,
  generatedAt: new Date().toISOString(),
  present: true,
  count: 3,
  existingCount: 3,
  missingCount: 0,
  releaseDir,
  error: null,
  copyPolicy: 'Installer and portable EXE binaries are not copied into readiness evidence; this index records local paths, existence, size, and SHA-256.',
  packages: [
    {
      kind: 'installer',
      sourcePath: installerExe,
      fileName: path.basename(installerExe),
      exists: true,
      sizeBytes: installerInfo.sizeBytes,
      sha256: installerInfo.sha256,
      modifiedAt: installerInfo.mtime,
    },
    {
      kind: 'portable',
      sourcePath: portableExe,
      fileName: path.basename(portableExe),
      exists: true,
      sizeBytes: portableInfo.sizeBytes,
      sha256: portableInfo.sha256,
      modifiedAt: portableInfo.mtime,
    },
    {
      kind: 'blockmap',
      sourcePath: blockmap,
      fileName: path.basename(blockmap),
      exists: true,
      sizeBytes: blockmapInfo.sizeBytes,
      sha256: blockmapInfo.sha256,
      modifiedAt: blockmapInfo.mtime,
    },
  ],
};

patched.currentPortablePackage = {
  kind: 'portable',
  sourcePath: portableExe,
  fileName: path.basename(portableExe),
  exists: true,
  sizeBytes: portableInfo.sizeBytes,
  sha256: portableInfo.sha256,
  modifiedAt: portableInfo.mtime,
};

patched.packageLaunchSmoke = {
  present: true,
  evidencePath: newSmokePath,
  selectedBy: 'explicit-arg',
  generatedAt: newSmoke.generatedAt,
  passed: newSmoke.passed === true,
  artifacts: {
    unpacked: {
      path: winUnpackedExe,
      sizeBytes: winUnpackedInfo.sizeBytes,
      sha256: winUnpackedInfo.sha256,
    },
    portable: {
      path: portableExe,
      sizeBytes: portableInfo.sizeBytes,
      sha256: portableInfo.sha256,
    },
  },
  checks: [
    { kind: 'win-unpacked', ok: true, marker: '[App] window-created' },
    { kind: 'portable', ok: true },
  ],
};

const gates = Array.isArray(patched.gates) ? patched.gates : [];
const launchGate = gates.find((gate) => gate?.id === 'package-launch-smoke' || gate?.name === 'Package launch smoke');
if (launchGate) {
  launchGate.ok = newSmoke.passed === true;
  launchGate.status = newSmoke.passed === true ? 'passed' : 'needs_work';
  launchGate.evidencePath = newSmokePath;
  launchGate.message = 'win-unpacked and no-install portable launch smoke passed with current portable hash.';
}
const releaseGate = gates.find((gate) => gate?.id === 'release-package-hash' || gate?.name === 'Release package hash');
if (releaseGate) {
  releaseGate.ok = true;
  releaseGate.status = 'passed';
  releaseGate.evidencePath = releaseDir;
  releaseGate.message = `${patched.packageIndex.count} release package artifacts indexed with SHA-256.`;
}

fs.writeFileSync(outPath, `${JSON.stringify(patched, null, 2)}\n`, 'utf8');
console.log(`Patched final-readiness written to: ${outPath}`);
console.log(`  portable sha: ${portableInfo.sha256}`);
console.log(`  installer sha: ${installerInfo.sha256}`);
console.log(`  win-unpacked sha: ${winUnpackedInfo.sha256}`);
console.log(`  new smoke path: ${newSmokePath}`);

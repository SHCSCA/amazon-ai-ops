const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const evidenceDir = path.join(root, 'output', 'codex-evidence');
const packageLaunchSmokePattern = /^package-launch-smoke-\d+\.json$/i;

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

function resolveMaybe(filePath) {
  return filePath ? path.resolve(filePath) : '';
}

function runNode(script, args = []) {
  const result = spawnSync(process.execPath, [path.join(root, script), ...args], {
    cwd: root,
    encoding: 'utf8',
  });
  return {
    ok: result.status === 0,
    status: result.status,
    output: `${result.stdout || ''}${result.stderr || ''}`.trim(),
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function containsObviousSecret(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value || {});
  return /sk-[A-Za-z0-9_-]{16,}/.test(text)
    || /Bearer\s+[A-Za-z0-9._~+/=-]{16,}/i.test(text)
    || /deepseek[_-]?api[_-]?key["']?\s*[:=]\s*["'][^"']+/i.test(text);
}

function resolveManifestEvidencePath(manifest, key) {
  const entry = manifest?.evidence?.[key];
  const selected = entry?.absolutePath || entry?.path || '';
  return selected ? path.resolve(root, selected) : '';
}

function readEvidenceManifest(filePath) {
  if (!filePath) return null;
  if (!fs.existsSync(filePath)) {
    throw new Error(`Evidence manifest does not exist: ${filePath}`);
  }
  const manifest = readJson(filePath);
  if (manifest.kind !== 'v15-final-readiness-evidence-manifest') {
    throw new Error(`Unexpected evidence manifest kind: ${manifest.kind}`);
  }
  return manifest;
}

function checkWithVerifier(name, script, evidencePath) {
  if (!evidencePath) {
    return { name, status: 'missing', ok: false, evidencePath: null, message: 'missing evidence path' };
  }
  if (!fs.existsSync(evidencePath)) {
    return { name, status: 'missing', ok: false, evidencePath, message: 'evidence file does not exist' };
  }
  const result = runNode(script, [evidencePath]);
  return {
    name,
    status: result.ok ? 'passed' : 'needs_work',
    ok: result.ok,
    evidencePath,
    message: result.output.split(/\r?\n/).slice(-3).join('\n'),
  };
}

function checkAiLive(evidencePath) {
  if (!evidencePath) {
    return { name: 'AI live provider', status: 'missing', ok: false, evidencePath: null, message: 'missing deepseek-live evidence' };
  }
  if (!fs.existsSync(evidencePath)) {
    return { name: 'AI live provider', status: 'missing', ok: false, evidencePath, message: 'evidence file does not exist' };
  }
  const evidence = readJson(evidencePath);
  if (evidence.kind === 'ai-openai-compatible-structural-mock' || evidence.readinessImpact === 'NO_FINAL_READINESS_CREDIT') {
    return {
      name: 'AI live provider',
      status: 'needs_work',
      ok: false,
      evidencePath,
      message: 'structural mock evidence has no APP_READY credit; real deepseek-live evidence is required',
    };
  }
  if (containsObviousSecret(evidence)) {
    return {
      name: 'AI live provider',
      status: 'needs_work',
      ok: false,
      evidencePath,
      message: 'AI live evidence contains possible secret material; regenerate redacted evidence before final readiness.',
    };
  }
  const ok = evidence.status === 'PASS'
    && evidence.keyPresent === true
    && evidence.success === true
    && Number(evidence.usage?.totalTokens || 0) > 0;
  return {
    name: 'AI live provider',
    status: ok ? 'passed' : 'needs_work',
    ok,
    evidencePath,
    message: ok
      ? `AI live passed for ${evidence.model}`
      : `AI live not passed: status=${evidence.status || 'missing'}, keyPresent=${Boolean(evidence.keyPresent)}`,
  };
}

function checkListingAiDraft(evidencePath) {
  if (!evidencePath) {
    return { name: 'Listing AI draft', status: 'missing', ok: false, evidencePath: null, message: 'missing Listing AI draft evidence' };
  }
  if (!fs.existsSync(evidencePath)) {
    return { name: 'Listing AI draft', status: 'missing', ok: false, evidencePath, message: 'evidence file does not exist' };
  }
  const evidence = readJson(evidencePath);
  if (evidence.kind === 'ai-openai-compatible-structural-mock' || evidence.readinessImpact === 'NO_FINAL_READINESS_CREDIT') {
    return {
      name: 'Listing AI draft',
      status: 'needs_work',
      ok: false,
      evidencePath,
      message: 'structural mock evidence has no APP_READY credit; real installed-listing-ai-draft evidence is required',
    };
  }
  if (evidence.ai?.keyPresent === false) {
    return {
      name: 'Listing AI draft',
      status: 'needs_work',
      ok: false,
      evidencePath,
      message: 'real AI key is missing; rerun listing-ai-draft after setting DEEPSEEK_API_KEY or AI_API_KEY',
    };
  }
  return checkWithVerifier('Listing AI draft', 'scripts/verify-listing-ai-draft-evidence.js', evidencePath);
}

function checkAdAiExplanation(evidencePath) {
  if (!evidencePath) {
    return { name: 'Ad recommendation AI explanation', status: 'missing', ok: false, evidencePath: null, message: 'missing ad AI explanation evidence' };
  }
  if (!fs.existsSync(evidencePath)) {
    return { name: 'Ad recommendation AI explanation', status: 'missing', ok: false, evidencePath, message: 'evidence file does not exist' };
  }
  const evidence = readJson(evidencePath);
  if (evidence.kind === 'ai-openai-compatible-structural-mock' || evidence.readinessImpact === 'NO_FINAL_READINESS_CREDIT') {
    return {
      name: 'Ad recommendation AI explanation',
      status: 'needs_work',
      ok: false,
      evidencePath,
      message: 'structural mock evidence has no APP_READY credit; real ad-ai-explanation evidence is required',
    };
  }
  if (evidence.ai?.keyPresent === false) {
    return {
      name: 'Ad recommendation AI explanation',
      status: 'needs_work',
      ok: false,
      evidencePath,
      message: 'real AI key is missing; rerun ad recommendation generation after setting DEEPSEEK_API_KEY or AI_API_KEY',
    };
  }
  return checkWithVerifier('Ad recommendation AI explanation', 'scripts/verify-ad-ai-explanation-evidence.js', evidencePath);
}

function checkAdExecutionReadback(evidencePath) {
  const failClosed = runNode('scripts/verify-ad-execution-fail-closed.js');
  if (evidencePath && fs.existsSync(evidencePath)) {
    const result = runNode('scripts/verify-ad-readback-evidence.js', [evidencePath]);
    return {
      name: 'Real ad execution readback',
      status: result.ok ? 'passed' : 'needs_work',
      ok: result.ok,
      evidencePath,
      message: result.output.split(/\r?\n/).slice(-3).join('\n'),
      safetyFailClosed: failClosed.ok,
    };
  }
  return {
    name: 'Real ad execution readback',
    status: 'needs_work',
    ok: false,
    evidencePath: evidencePath || null,
    message: failClosed.ok
      ? 'fail-closed safety is verified, but real before/after readback evidence is still missing'
      : 'fail-closed safety check failed and real readback evidence is missing',
    safetyFailClosed: failClosed.ok,
  };
}

function latestReleasePackageFiles(releaseDir) {
  if (!releaseDir || !fs.existsSync(releaseDir)) return [];
  const files = fs.readdirSync(releaseDir)
    .filter((name) => /^AmazonAIOpsAgent-.*\.exe$/i.test(name))
    .map((name) => path.join(releaseDir, name))
    .filter((filePath) => fs.existsSync(filePath) && fs.statSync(filePath).isFile())
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

  const portable = files.find((filePath) => /portable/i.test(path.basename(filePath)));
  const installer = files.find((filePath) => !/portable/i.test(path.basename(filePath)));
  return [
    installer ? { kind: 'installer', filePath: installer } : null,
    portable ? { kind: 'portable', filePath: portable } : null,
  ].filter(Boolean);
}

function buildPackageIndex(releaseDir) {
  const resolvedReleaseDir = path.resolve(releaseDir || path.join(root, 'apps', 'desktop', 'release'));
  const packages = latestReleasePackageFiles(resolvedReleaseDir).map((entry) => {
    const stat = fs.statSync(entry.filePath);
    return {
      kind: entry.kind,
      sourcePath: path.resolve(entry.filePath),
      fileName: path.basename(entry.filePath),
      exists: true,
      sizeBytes: stat.size,
      sha256: sha256(entry.filePath),
      modifiedAt: stat.mtime.toISOString(),
    };
  });
  return {
    generatedAt: new Date().toISOString(),
    present: packages.length > 0,
    count: packages.length,
    existingCount: packages.filter((item) => item.exists).length,
    missingCount: packages.filter((item) => !item.exists).length,
    releaseDir: resolvedReleaseDir,
    copyPolicy: 'Installer and portable EXE binaries are not copied into readiness evidence; this index records local paths, existence, size, and SHA-256.',
    packages,
  };
}

function checkReleasePackageHash(packageIndex) {
  if (!packageIndex.present || packageIndex.count <= 0) {
    return {
      name: 'Release package hash',
      status: 'missing',
      ok: false,
      evidencePath: packageIndex.releaseDir,
      message: 'installer/package hash evidence is missing',
    };
  }
  if (!packageIndex.packages.some((item) => item.kind === 'installer')) {
    return {
      name: 'Release package hash',
      status: 'needs_work',
      ok: false,
      evidencePath: packageIndex.releaseDir,
      message: 'installer package hash evidence is missing',
    };
  }
  if (!packageIndex.packages.some((item) => item.kind === 'portable')) {
    return {
      name: 'Release package hash',
      status: 'needs_work',
      ok: false,
      evidencePath: packageIndex.releaseDir,
      message: 'portable no-install package hash evidence is missing',
    };
  }
  if (packageIndex.missingCount > 0) {
    return {
      name: 'Release package hash',
      status: 'needs_work',
      ok: false,
      evidencePath: packageIndex.releaseDir,
      message: 'installer/package hash index contains missing files',
    };
  }
  return {
    name: 'Release package hash',
    status: 'passed',
    ok: true,
    evidencePath: packageIndex.releaseDir,
    message: `${packageIndex.count} release package artifacts indexed with SHA-256.`,
  };
}

function validatePackageLaunchSmoke(filePath, packageIndex) {
  if (!filePath || !fs.existsSync(filePath)) {
    return {
      gate: {
        name: 'Package launch smoke',
        status: 'missing',
        ok: false,
        evidencePath: filePath || null,
        message: 'package launch smoke evidence is missing',
      },
      summary: {
        present: false,
        evidencePath: filePath || null,
        passed: false,
        artifacts: null,
        checks: [],
      },
    };
  }

  try {
    const smoke = readJson(filePath);
    const checks = Array.isArray(smoke.checks) ? smoke.checks : [];
    const unpacked = smoke.artifacts?.unpacked;
    const portable = smoke.artifacts?.portable;
    const portablePackage = (packageIndex.packages || []).find((item) => item.kind === 'portable');
    const checkOk = (kind) => checks.some((item) => item?.kind === kind && item.ok === true);
    const validArtifact = (artifact) => {
      if (!artifact?.path || !fs.existsSync(artifact.path) || !fs.statSync(artifact.path).isFile()) return false;
      if (Number(artifact.sizeBytes || 0) <= 0) return false;
      if (fs.statSync(artifact.path).size !== Number(artifact.sizeBytes || 0)) return false;
      return /^[A-F0-9]{64}$/.test(String(artifact.sha256 || ''))
        && sha256(artifact.path) === String(artifact.sha256 || '').toUpperCase();
    };
    const portableMatchesPackage = Boolean(
      portablePackage
      && portable
      && path.resolve(portable.path) === path.resolve(portablePackage.sourcePath)
      && Number(portable.sizeBytes || 0) === Number(portablePackage.sizeBytes || 0)
      && String(portable.sha256 || '').toUpperCase() === String(portablePackage.sha256 || '').toUpperCase(),
    );
    const ok = smoke.kind === 'package-launch-smoke'
      && smoke.passed === true
      && validArtifact(unpacked)
      && validArtifact(portable)
      && checkOk('win-unpacked')
      && checkOk('portable')
      && portableMatchesPackage;

    return {
      gate: {
        name: 'Package launch smoke',
        status: ok ? 'passed' : 'needs_work',
        ok,
        evidencePath: filePath,
        message: ok
          ? 'win-unpacked and no-install portable launch smoke passed with current portable hash.'
          : 'package launch smoke is stale, incomplete, or does not match the current portable package hash',
      },
      summary: {
        present: true,
        evidencePath: filePath,
        generatedAt: smoke.generatedAt,
        passed: smoke.passed === true,
        artifacts: {
          unpacked: unpacked ? {
            path: unpacked.path,
            sizeBytes: unpacked.sizeBytes,
            sha256: unpacked.sha256,
          } : null,
          portable: portable ? {
            path: portable.path,
            sizeBytes: portable.sizeBytes,
            sha256: portable.sha256,
          } : null,
        },
        checks: checks.map((item) => ({
          kind: item.kind,
          ok: item.ok,
          marker: item.marker,
          appChildCount: item.appChildCount,
        })),
      },
    };
  } catch (error) {
    return {
      gate: {
        name: 'Package launch smoke',
        status: 'needs_work',
        ok: false,
        evidencePath: filePath,
        message: `package launch smoke could not be read: ${error.message}`,
      },
      summary: {
        present: true,
        evidencePath: filePath,
        passed: false,
        artifacts: null,
        checks: [],
      },
    };
  }
}

function printGate(gate) {
  const label = gate.ok ? 'PASS' : gate.status === 'missing' ? 'MISSING' : 'NEEDS_WORK';
  console.log(`[${label}] ${gate.name}`);
  if (gate.evidencePath) console.log(`  evidence: ${gate.evidencePath}`);
  if (gate.message) console.log(`  ${gate.message}`);
}

const args = parseArgs(process.argv);
const evidenceManifestPath = args['evidence-manifest'] ? path.resolve(args['evidence-manifest']) : '';
const evidenceManifest = evidenceManifestPath ? readEvidenceManifest(evidenceManifestPath) : null;
const deliveryEvidence = resolveMaybe(args.delivery || resolveManifestEvidencePath(evidenceManifest, 'delivery') || latestEvidence(/^desktop-live-full-8-e2e-.*\.json$/i));
const listingReadEvidence = resolveMaybe(args['listing-read'] || resolveManifestEvidencePath(evidenceManifest, 'listingRead') || latestEvidence(/^(source-listing-read-detail-probe|installed-listing-read).*\.json$/i));
const aiLiveEvidence = resolveMaybe(args['ai-live'] || resolveManifestEvidencePath(evidenceManifest, 'aiLive') || latestEvidence(/^deepseek-live-.*\.json$/i));
const adAiExplanationEvidence = resolveMaybe(args['ad-ai-explanation'] || resolveManifestEvidencePath(evidenceManifest, 'adAiExplanation') || latestEvidence(/^(installed-)?ad-ai-explanation-.*\.json$/i));
const listingAiEvidence = resolveMaybe(args['listing-ai-draft'] || resolveManifestEvidencePath(evidenceManifest, 'listingAiDraft') || latestEvidence(/^(installed-listing-ai-draft|listing-ai-draft).*\.json$/i));
const adReadbackEvidence = args['ad-readback'] ? path.resolve(args['ad-readback']) : resolveManifestEvidencePath(evidenceManifest, 'adReadback');
const packageIndex = buildPackageIndex(args['release-dir'] || path.join(root, 'apps', 'desktop', 'release'));
const packageLaunchSmoke = validatePackageLaunchSmoke(
  args['package-launch-smoke'] ? path.resolve(args['package-launch-smoke']) : latestEvidence(packageLaunchSmokePattern),
  packageIndex,
);

const gates = [
  checkWithVerifier('Report collection delivery', 'scripts/verify-v15-delivery-evidence.js', deliveryEvidence),
  checkWithVerifier('Lingxing Listing full read', 'scripts/verify-listing-read-evidence.js', listingReadEvidence),
  checkAiLive(aiLiveEvidence),
  checkAdAiExplanation(adAiExplanationEvidence),
  checkListingAiDraft(listingAiEvidence),
  checkAdExecutionReadback(adReadbackEvidence),
  checkReleasePackageHash(packageIndex),
  packageLaunchSmoke.gate,
];

for (const gate of gates) {
  printGate(gate);
}

const reportReady = gates[0].ok;
const listingReady = gates[1].ok;
const allGatesPass = gates.every((gate) => gate.ok);
const manifestDriven = Boolean(evidenceManifest);
const appReady = manifestDriven && allGatesPass;
const missing = [];
const actionItems = [];
if (!manifestDriven) {
  missing.push('最终验收未使用 evidence manifest，latest fallback 只能用于诊断，不能声明 APP_READY。');
  actionItems.push('先运行 write:v15-evidence-manifest，再用 --evidence-manifest 重新运行 verify:v15-final-readiness。');
}
for (const gate of gates) {
  if (!gate.ok) {
    missing.push(gate.message || `${gate.name} 未通过。`);
    actionItems.push(`补齐 ${gate.name} 证据后重新运行最终验收。`);
  }
}
const summary = {
  generatedAt: new Date().toISOString(),
  evidenceSelection: {
    mode: evidenceManifest ? 'manifest' : 'latest-fallback',
    manifestPath: evidenceManifestPath || null,
  },
  manifestDriven,
  status: appReady ? 'APP_READY' : reportReady && listingReady ? 'APP_NEEDS_WORK' : 'REPORT_COLLECTION_NEEDS_WORK',
  reportCollectionReady: reportReady,
  listingReadReady: listingReady,
  appReady,
  allGatesPass,
  missing,
  actionItems,
  packageIndex,
  packageLaunchSmoke: packageLaunchSmoke.summary,
  gates: gates.map((gate) => ({
    name: gate.name,
    status: gate.status,
    ok: gate.ok,
    evidencePath: gate.evidencePath,
    message: gate.message,
    safetyFailClosed: gate.safetyFailClosed,
  })),
};

fs.mkdirSync(evidenceDir, { recursive: true });
const summaryPath = path.resolve(args.out || path.join(evidenceDir, `final-readiness-${Date.now()}.json`));
fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

console.log('\nFINAL_READINESS_SUMMARY');
console.log(JSON.stringify(summary, null, 2));
console.log(`\nFinal readiness evidence: ${summaryPath}`);

if (!appReady) {
  console.error(`\nNEEDS_WORK: ${summary.status}`);
  process.exit(1);
}

console.log('\nAPP_READY verified.');

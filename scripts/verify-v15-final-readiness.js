const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const {
  evaluatePackageReadinessFromFiles,
  evaluateReadinessContract,
} = require('../apps/desktop/src/main/final-readiness-package-evaluator.js');
const { resolveAdReadbackAuthorityDbPath } = require('./ad-readback-authority-db');
const {
  PACKAGE_ADVERSARIAL_NODE_ENV_CONTRACT_VERSION,
  collectPackageIdentity,
  validateAdversarialNodeEnvEvidence,
  validateAdversarialNodeEnvManifestEntryContract,
} = require('./smoke-package-adversarial-node-env');

const root = path.resolve(__dirname, '..');
const evidenceDir = path.join(root, 'output', 'codex-evidence');
const packageLaunchSmokePattern = /^package-launch-smoke-\d+\.json$/i;
const packageAdversarialNodeEnvPattern = /^package-adversarial-node-env-.*\.json$/i;

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

function sha256File(filePath) {
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

function checkAdExecutionReadback(evidencePath, dbPath, dbResolutionError) {
  const failClosed = runNode('scripts/verify-ad-execution-fail-closed.js');
  if (evidencePath && fs.existsSync(evidencePath)) {
    if (dbResolutionError) {
      return {
        name: 'Real ad execution readback',
        status: 'needs_work',
        ok: false,
        evidencePath,
        message: `SQLite authority database resolution failed: ${dbResolutionError}`,
        safetyFailClosed: failClosed.ok,
      };
    }
    const verifierArgs = [evidencePath];
    if (dbPath) verifierArgs.push('--db', dbPath);
    const result = runNode('scripts/verify-ad-readback-evidence.js', verifierArgs);
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

function inspectPackageAdversarialNodeEnv(
  evidencePath,
  releaseDir,
  packageEvaluation,
  selectedBy,
  manifestEntryContract,
) {
  const base = {
    contractVersion: PACKAGE_ADVERSARIAL_NODE_ENV_CONTRACT_VERSION,
    present: Boolean(evidencePath && fs.existsSync(evidencePath)),
    evidencePath: evidencePath || null,
    selectedBy,
    requiredForDeliverySafety: true,
    passed: false,
    evidenceSha256: null,
    package: null,
    message: 'adversarial NODE_ENV package smoke evidence is missing',
  };
  if (!base.present) return base;
  try {
    const appContentPath = path.join(releaseDir, 'win-unpacked', 'resources', 'app');
    const executablePath = path.join(releaseDir, 'win-unpacked', 'AmazonAIOpsAgent.exe');
    const expected = collectPackageIdentity({ appContentPath, executablePath });
    const evidence = readJson(evidencePath);
    const validation = validateAdversarialNodeEnvEvidence(evidence, expected);
    const launchExecutableSha256 = String(
      packageEvaluation?.packageLaunchSmoke?.artifacts?.unpacked?.sha256 || '',
    ).toUpperCase();
    const launchIdentityBound = /^[A-F0-9]{64}$/.test(launchExecutableSha256)
      && launchExecutableSha256 === expected.executableSha256;
    const manifestContractPassed = manifestEntryContract?.passed !== false;
    const passed = validation.passed && launchIdentityBound && manifestContractPassed;
    return {
      ...base,
      passed,
      evidenceSha256: sha256File(evidencePath),
      package: {
        executableSha256: evidence?.package?.executableSha256 || null,
        appContentSha256: evidence?.package?.appContentSha256 || null,
        mainBundleSha256: evidence?.package?.mainBundleSha256 || null,
      },
      message: passed
        ? 'hostile NODE_ENV=development stayed packaged, file-rendered, DevTools-closed, localhost-free and process-clean'
        : `adversarial NODE_ENV evidence is stale or invalid (${[
          ...validation.violations,
          ...(launchIdentityBound ? [] : ['package launch executable identity mismatch']),
          ...(manifestContractPassed ? [] : manifestEntryContract.violations),
        ].join('; ')})`,
    };
  } catch {
    return { ...base, message: 'adversarial NODE_ENV evidence or current package identity could not be read' };
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
let authorityDbPath = null;
let authorityDbSelectedBy = null;
let authorityDbResolutionError = null;
if (adReadbackEvidence || args.db || process.env.AMAZON_AI_OPS_DB_PATH) {
  try {
    authorityDbPath = resolveAdReadbackAuthorityDbPath(args.db);
    authorityDbSelectedBy = args.db
      ? 'explicit-arg'
      : process.env.AMAZON_AI_OPS_DB_PATH
        ? 'env-override'
        : 'default-discovery';
  } catch (error) {
    authorityDbResolutionError = error instanceof Error ? error.message : String(error);
  }
}
const packageLaunchSmokePath = args['package-launch-smoke']
  ? path.resolve(args['package-launch-smoke'])
  : latestEvidence(packageLaunchSmokePattern);
const packageAdversarialNodeEnvPath = args['package-adversarial-node-env-evidence']
  ? path.resolve(args['package-adversarial-node-env-evidence'])
  : resolveManifestEvidencePath(evidenceManifest, 'packageAdversarialNodeEnv')
    || (!evidenceManifest ? latestEvidence(packageAdversarialNodeEnvPattern) : '');
const releaseDir = path.resolve(args['release-dir'] || path.join(root, 'apps', 'desktop', 'release'));
const packageEvaluation = evaluatePackageReadinessFromFiles({
  releaseDir,
  packageLaunchSmokePath,
  selectedBy: args['package-launch-smoke'] ? 'explicit-arg' : 'latest-evidence',
});
const packageAdversarialNodeEnv = inspectPackageAdversarialNodeEnv(
  packageAdversarialNodeEnvPath,
  releaseDir,
  packageEvaluation,
  args['package-adversarial-node-env-evidence']
    ? 'explicit-arg'
    : evidenceManifest
      ? 'evidence-manifest'
      : 'latest-evidence',
  evidenceManifest
    ? validateAdversarialNodeEnvManifestEntryContract(
      evidenceManifest.evidence?.packageAdversarialNodeEnv,
    )
    : { passed: true, violations: [] },
);

const businessGates = [
  checkWithVerifier('Report collection delivery', 'scripts/verify-v15-delivery-evidence.js', deliveryEvidence),
  checkWithVerifier('Lingxing Listing full read', 'scripts/verify-listing-read-evidence.js', listingReadEvidence),
  checkAiLive(aiLiveEvidence),
  checkAdAiExplanation(adAiExplanationEvidence),
  checkListingAiDraft(listingAiEvidence),
  checkAdExecutionReadback(adReadbackEvidence, authorityDbPath, authorityDbResolutionError),
];
const manifestDriven = Boolean(evidenceManifest);
const readiness = evaluateReadinessContract({ businessGates, packageEvaluation, manifestDriven });
const { gates } = readiness;

for (const gate of gates) {
  printGate(gate);
}
console.log(`[${packageAdversarialNodeEnv.passed ? 'PASS' : 'NEEDS_WORK'}] Adversarial NODE_ENV package delivery safety`);
console.log(`  ${packageAdversarialNodeEnv.message}`);

const reportReady = gates[0].ok;
const listingReady = gates[1].ok;
const formalAllGatesPass = readiness.allGatesPass;
const allGatesPass = formalAllGatesPass && packageAdversarialNodeEnv.passed;
const appReady = readiness.appReady && packageAdversarialNodeEnv.passed;
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
if (!packageAdversarialNodeEnv.passed) {
  missing.push(packageAdversarialNodeEnv.message);
  actionItems.push('生成并显式选择当前版本的 adversarial NODE_ENV 包体证据后重新运行最终验收。');
}
const failures = [...readiness.failures];
if (!packageAdversarialNodeEnv.passed) {
  failures.push({
    gateId: 'package-adversarial-node-env',
    code: 'PACKAGE_ADVERSARIAL_NODE_ENV_DELIVERY_CONTRACT_FAILED',
    message: packageAdversarialNodeEnv.message,
  });
}
const summary = {
  generatedAt: new Date().toISOString(),
  evidenceSelection: {
    mode: evidenceManifest ? 'manifest' : 'latest-fallback',
    manifestPath: evidenceManifestPath || null,
    authorityDbPath,
    authorityDbSelectedBy,
    authorityDbResolutionError,
  },
  manifestDriven,
  status: appReady ? 'APP_READY' : reportReady && listingReady ? 'APP_NEEDS_WORK' : 'REPORT_COLLECTION_NEEDS_WORK',
  reportCollectionReady: reportReady,
  listingReadReady: listingReady,
  appReady,
  allGatesPass,
  formalAllGatesPass,
  missing,
  actionItems,
  failures,
  packageIndex: readiness.packageIndex,
  currentPortablePackage: readiness.currentPortablePackage,
  packageLaunchSmoke: readiness.packageLaunchSmoke,
  packageAdversarialNodeEnv,
  gates: gates.map((gate) => ({
    id: gate.id,
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

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  PACKAGE_ADVERSARIAL_NODE_ENV_CONTRACT_VERSION,
} = require('./smoke-package-adversarial-node-env');

const root = path.resolve(__dirname, '..');
const evidenceDir = path.join(root, 'output', 'codex-evidence');

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

function runGit(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? (result.stdout || '').trim() : '';
}

function relativeOrNull(filePath) {
  if (!filePath) return null;
  return path.relative(root, path.resolve(filePath)).replace(/\\/g, '/');
}

function evidenceEntry(label, explicitPath, fallbackPattern, requiredForAppReady) {
  const selected = explicitPath ? path.resolve(explicitPath) : latestEvidence(fallbackPattern);
  return {
    label,
    path: relativeOrNull(selected),
    absolutePath: selected ? path.resolve(selected) : null,
    exists: Boolean(selected && fs.existsSync(selected)),
    selectedBy: explicitPath ? 'explicit-arg' : 'latest-evidence',
    requiredForAppReady,
  };
}

function main() {
  const args = parseArgs(process.argv);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const manifest = {
    kind: 'v15-final-readiness-evidence-manifest',
    generatedAt: new Date().toISOString(),
    status: 'EVIDENCE_SELECTION_ONLY',
    appVersion: pkg.version,
    git: {
      head: runGit(['rev-parse', 'HEAD']),
      branch: runGit(['branch', '--show-current']),
      dirty: Boolean(runGit(['status', '--short'])),
    },
    evidence: {
      delivery: evidenceEntry('Report collection delivery', args.delivery, /^desktop-live-full-8-e2e-.*\.json$/i, true),
      listingRead: evidenceEntry('Lingxing Listing full read', args['listing-read'], /^(source-listing-read-detail-probe|installed-listing-read).*\.json$/i, true),
      aiLive: evidenceEntry('AI live provider', args['ai-live'], /^deepseek-live-.*\.json$/i, true),
      adAiExplanation: evidenceEntry('Ad recommendation AI explanation', args['ad-ai-explanation'], /^(installed-)?ad-ai-explanation-.*\.json$/i, true),
      listingAiDraft: evidenceEntry('Listing AI draft', args['listing-ai-draft'], /^(installed-listing-ai-draft|listing-ai-draft).*\.json$/i, true),
      adReadback: evidenceEntry('Real ad execution readback', args['ad-readback'], /^real-ad-execution-readback-.*\.json$/i, true),
      packageAdversarialNodeEnv: {
        contractVersion: PACKAGE_ADVERSARIAL_NODE_ENV_CONTRACT_VERSION,
        ...evidenceEntry(
          'Adversarial NODE_ENV package smoke',
          args['package-adversarial-node-env-evidence'],
          /^package-adversarial-node-env-.*\.json$/i,
          true,
        ),
      },
    },
    note: 'This manifest selects evidence paths for verify:v15-final-readiness. It does not make APP_READY claims by itself.',
  };

  fs.mkdirSync(evidenceDir, { recursive: true });
  const out = path.resolve(args.out || path.join(evidenceDir, `v15-final-readiness-evidence-manifest-${Date.now()}.json`));
  fs.writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`V15 evidence manifest written: ${out}`);
  for (const entry of Object.values(manifest.evidence)) {
    console.log(`${entry.exists ? '[FOUND]' : '[MISSING]'} ${entry.label}: ${entry.path || '<none>'}`);
  }
}

main();

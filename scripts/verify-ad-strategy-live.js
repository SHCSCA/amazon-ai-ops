const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const evidenceDir = path.join(root, 'output', 'codex-evidence');

function parseArgs(argv) {
  const inputIndex = argv.indexOf('--input');
  const outIndex = argv.indexOf('--out');
  const positionalInput = argv.find((arg) => !arg.startsWith('--'));
  return {
    inputPath: inputIndex >= 0 ? argv[inputIndex + 1] : positionalInput,
    outPath: outIndex >= 0 ? argv[outIndex + 1] : '',
  };
}

function main() {
  const { inputPath, outPath } = parseArgs(process.argv.slice(2));
  if (!inputPath) {
    console.error('Usage: node scripts/verify-ad-strategy-live.js --input <input.json> [--out evidence.json]');
    process.exit(2);
  }

  fs.mkdirSync(evidenceDir, { recursive: true });
  const esbuildPath = require.resolve('esbuild/bin/esbuild', {
    paths: [root, path.join(root, 'apps', 'desktop')],
  });
  const runnerSource = path.join(__dirname, 'verify-ad-strategy-live-runner.ts');
  const runnerOut = path.join(evidenceDir, '.verify-ad-strategy-live-runner.cjs');
  childProcess.execFileSync(process.execPath, [
    esbuildPath,
    runnerSource,
    '--bundle',
    '--platform=node',
    '--target=node18',
    '--format=cjs',
    `--outfile=${runnerOut}`,
  ], {
    cwd: root,
    stdio: 'inherit',
  });

  const args = [runnerOut, path.resolve(inputPath)];
  if (outPath) args.push('--out', path.resolve(outPath));
  childProcess.execFileSync(process.execPath, args, {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });
}

main();

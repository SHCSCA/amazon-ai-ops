#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('./playwright-loader');
const {
  normalizeWorkspaceEvidenceConfig,
  parseWorkspaceEvidenceArgs,
  runWorkspaceEvidenceTargets,
} = require('./workspace-ui-evidence');

const HELP = `Workspace UI runtime evidence

Captures a viewport screenshot, SHA-256 and task-first DOM contract metrics.
Contract failures still write evidence and make the command exit non-zero.

Config matrix:
  pnpm run evidence:workspace-ui -- --config scripts/workspace-evidence.json

Inline target:
  pnpm run evidence:workspace-ui -- --url http://127.0.0.1:4173/?preview=1&scenario=diagnosis-ready \\
    --workspace today --subview overview --scenario diagnosis-ready \\
    --viewport 1200x700 --dpr 1.25 --output output/workspace-ui-evidence

Options:
  --config FILE             JSON config with baseUrl/outputDir/targets
  --url URL                 Explicit running renderer URL
  --workspace ID            Canonical workspace id
  --subview ID              Canonical workspace subview
  --scenario ID             Explicit development-preview scenario
  --viewport WIDTHxHEIGHT   Browser CSS viewport (default 1400x900)
  --dpr NUMBER              Device scale factor (default 1)
  --output DIR              Evidence directory
  --root SELECTOR           Workspace evidence root selector
  --wait-for SELECTOR       Wait for a visible runtime anchor before capture
  --settle-ms NUMBER        Delay after structured navigation (default 250)
  --allow-contract-fail     Write evidence but exit zero for exploratory runs
  --help                    Show this help
`;

function readConfig(configPath) {
  const absolutePath = path.resolve(configPath);
  let source;
  try {
    source = fs.readFileSync(absolutePath, 'utf8');
  } catch (error) {
    throw new Error(`Unable to read workspace evidence config ${absolutePath}: ${error.message}`);
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`Invalid JSON in workspace evidence config ${absolutePath}: ${error.message}`);
  }
}

async function main(argv) {
  if (argv.includes('--help')) {
    process.stdout.write(HELP);
    return;
  }

  const parsed = parseWorkspaceEvidenceArgs(argv);
  const run = parsed.mode === 'config'
    ? normalizeWorkspaceEvidenceConfig(readConfig(parsed.configPath))
    : {
        allowContractFail: Boolean(parsed.allowContractFail),
        outputDir: parsed.outputDir,
        targets: [parsed.target],
      };

  const browser = await chromium.launch({ headless: true });
  try {
    const result = await runWorkspaceEvidenceTargets({
      browser,
      outputDir: run.outputDir,
      targets: run.targets,
    });
    process.stdout.write(`[workspace-ui-evidence] manifest: ${result.manifestPath}\n`);
    process.stdout.write(`[workspace-ui-evidence] ${result.passed ? 'PASS' : 'FAIL'} (${result.results.length} target(s))\n`);
    if (!result.passed && !run.allowContractFail) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`[workspace-ui-evidence] ${error && error.stack ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});

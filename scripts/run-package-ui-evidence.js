#!/usr/bin/env node

const {
  collectFixedPackageHashes,
  parsePackageUiEvidenceArgs,
  runPackageUiEvidence,
} = require('./package-ui-evidence');

function printHelp(print = console.log) {
  print(`Amazon AI Ops packaged Electron UI evidence

Usage:
  pnpm run evidence:package-ui -- --print-package-hashes

  pnpm run evidence:package-ui -- \\
    --expected-exe-sha256 <64-hex> \\
    --expected-app-content-sha256 <64-hex> \\
    --user-data-dir <D:\\Temp\\amazon-ai-ops-...> \\
    --protected-db <C:\\Users\\...\\amazon-ai-ops.db> \\
    --allow-interactive-login

This runner is fixed to:
  apps/desktop/release/win-unpacked/AmazonAIOpsAgent.exe
  apps/desktop/release/win-unpacked/resources/app

The hash preflight is read-only and never launches Electron. Evidence mode
launches the real packaged Electron application and keeps the full 1200x700
matrix at 100% and 125% across all ten canonical Mission Control workspaces
and the three established overlay keyboard checks. The retained 1400x900@100
profile checks packaged process/profile isolation and diagnostics only; the
50,000-row production virtualizer contract is verified independently by
verify:s7-large-table. It accepts no
URL, preview scenario, executable override, credentials, approval, execution,
export, collection, or Ads-write argument.

Evidence mode requires an existing isolated profile copy under
D:\\Temp\\amazon-ai-ops*. Electron main binds this exact directory through
app.setPath('userData') before any app.getPath('userData') use; APPDATA is not
used as an isolation mechanism. Before launch, profile/amazon-ai-ops.db must
match the explicit protected DB by SHA-256 and size while remaining a distinct
file. The protected DB is also hashed before and after the run; matching package
processes must be zero before and after.
Schema v7 requires a visible, secret-blind operator handoff for every profile;
the first profile must establish a fresh typed-and-saved identity proof.

Options:
  --print-package-hashes                 Print fixed EXE + app-content hashes only
  --expected-exe-sha256 <hash>           Required immutable EXE hash
  --expected-app-content-sha256 <hash>   Required immutable app tree hash
  --user-data-dir <absolute D path>      Required existing isolated profile copy
  --protected-db <absolute file path>    Required real AppData DB protected by before/after hash
  --allow-interactive-login              Required: wait for visible operator login without secret capture
  --output <dir>                         Evidence output directory
  --interactive-login-timeout-ms <ms>    Visible handoff timeout, 60000-900000 (default 600000)
  --settle-ms <ms>                       Extra settle floor (default 800; capture enforces at least 2500)
  --help                                  Show this help without launching Electron`);
}

async function main(argv = process.argv.slice(2), dependencies = {}) {
  const collectHashes = dependencies.collectFixedPackageHashes || collectFixedPackageHashes;
  const runEvidence = dependencies.runPackageUiEvidence || runPackageUiEvidence;
  const print = dependencies.print || console.log;
  if (argv.includes('--help')) {
    if (argv.length !== 1) throw new Error('--help cannot be combined with evidence arguments.');
    printHelp(print);
    return;
  }
  if (argv.includes('--print-package-hashes')) {
    if (argv.length !== 1) throw new Error('--print-package-hashes cannot be combined with evidence arguments or path overrides.');
    print(JSON.stringify(collectHashes(), null, 2));
    return;
  }
  const options = parsePackageUiEvidenceArgs(argv);
  const result = await runEvidence(options);
  print(`[PASS] packaged Electron UI evidence: ${result.manifestPath}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[FAIL] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { main, printHelp };

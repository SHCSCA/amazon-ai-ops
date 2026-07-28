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
    --run-group <operator-safe-id> \\
    --allow-interactive-login

This runner is fixed to:
  apps/desktop/release/win-unpacked/AmazonAIOpsAgent.exe
  apps/desktop/release/win-unpacked/resources/app

The hash preflight is read-only and never launches Electron. Evidence mode
launches the real packaged Electron application and keeps the full 1200x700
matrix at 100% and 125% across all ten canonical Mission Control workspaces
and the three established overlay keyboard checks. The 1400x900@100 profile
adds real Decisions and Objects workspace checks; the 50,000-row production
virtualizer contract is verified independently by verify:s7-large-table. It accepts no
URL, preview scenario, executable override, credentials, approval, execution,
export, collection, or Ads-write argument.

Evidence mode requires an existing isolated profile copy under
D:\\Temp\\amazon-ai-ops*. Electron main binds this exact directory through
app.setPath('userData') before any app.getPath('userData') use; APPDATA is not
used as an isolation mechanism. Before launch, profile/amazon-ai-ops.db must
match the explicit protected DB through a WAL-aware read-only SQLite online
backup while remaining a distinct file. Raw main-file hashes are auxiliary.
Schema v7 writes immutable 100/125/wide checkpoints under one run group, binds
the packaged Chromium hash and target root/child PID lineage, and proves target
cleanup without treating unrelated daily Chrome/Edge processes as failures.
A failed later profile can resume with --resume-run-group. Every unfinished
profile uses a visible secret-blind handoff; the first profile validates its
fresh typed-and-saved identity proof immediately after login. Each attempt
writes to its own immutable artifact directory. If target product/Chromium
cleanup cannot be attested, that run group is deliberately non-resumable:
create a fresh isolated profile and run group instead of reusing its cursor.

Options:
  --print-package-hashes                 Print fixed EXE + app-content hashes only
  --expected-exe-sha256 <hash>           Required immutable EXE hash
  --expected-app-content-sha256 <hash>   Required immutable app tree hash
  --user-data-dir <absolute D path>      Required existing isolated profile copy
  --protected-db <absolute file path>    Required real AppData DB protected by WAL-aware before/after proof
  --run-group <id>                       Optional new immutable run-group id
  --resume-run-group <id>                Resume matching package/profile checkpoints
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

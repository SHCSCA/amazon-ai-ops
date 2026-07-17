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
    --allow-saved-login

This runner is fixed to:
  apps/desktop/release/win-unpacked/AmazonAIOpsAgent.exe
  apps/desktop/release/win-unpacked/resources/app

The hash preflight is read-only and never launches Electron. Evidence mode
launches the real packaged Electron application and keeps the full 1200x700
matrix at 100% and 125% across all eight workspaces and the
three established overlay keyboard checks. Product and Diagnosis additionally
prove their bounded virtual queues and read-only row inspectors. A separate
1400x900@100 profile checks only Product and Diagnosis with non-modal inline
inspectors. It accepts no
URL, preview scenario, executable override, credentials, approval, execution,
export, collection, or Ads-write argument.

Evidence mode requires an existing isolated profile copy under
D:\\Temp\\amazon-ai-ops*. Electron main binds this exact directory through
app.setPath('userData') before any app.getPath('userData') use; APPDATA is not
used as an isolation mechanism. Before launch, profile/amazon-ai-ops.db must
match the explicit protected DB by SHA-256 and size while remaining a distinct
file. The protected DB is also hashed before and after the run; matching package
processes must be zero before and after.

Options:
  --print-package-hashes                 Print fixed EXE + app-content hashes only
  --expected-exe-sha256 <hash>           Required immutable EXE hash
  --expected-app-content-sha256 <hash>   Required immutable app tree hash
  --user-data-dir <absolute D path>      Required existing isolated profile copy
  --protected-db <absolute file path>    Required real AppData DB protected by before/after hash
  --allow-saved-login                    Explicitly allow app-owned saved credentials
  --output <dir>                         Evidence output directory
  --login-timeout-ms <ms>                Saved-session login timeout (default 120000)
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

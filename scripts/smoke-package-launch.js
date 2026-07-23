const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const {
  PACKAGE_LAUNCH_SMOKE_MODE,
  buildEvidenceUserDataEnv,
  inspectPackagedUserDataOverrideContract,
  readEvidenceUserDataRuntimeMarker,
  validateEvidenceUserDataIdentity,
  validateEvidenceUserDataPath,
} = require('./evidence-user-data');

const root = path.resolve(__dirname, '..');
const releaseDir = path.join(root, 'apps', 'desktop', 'release');
const evidenceDir = path.join(root, 'output', 'codex-evidence');
const desktopPackage = JSON.parse(fs.readFileSync(path.join(root, 'apps', 'desktop', 'package.json'), 'utf8'));
const runId = Date.now();
const isolatedUserDataRoot = path.join('D:\\Temp', 'amazon-ai-ops-package-launch-smoke', String(runId));

function fail(message, details) {
  throw new Error(details ? `${message}: ${details}` : message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function prepareIsolatedUserData(kind) {
  const userDataDir = path.join(isolatedUserDataRoot, kind);
  fs.mkdirSync(userDataDir, { recursive: true });
  return validateEvidenceUserDataPath(userDataDir);
}

function collectUserDataEvidence(userDataDir) {
  const runtime = readEvidenceUserDataRuntimeMarker(userDataDir);
  const identity = validateEvidenceUserDataIdentity({
    actualUserDataDir: runtime.marker?.userDataDir,
    evidenceMode: runtime.marker?.mode,
    expectedMode: PACKAGE_LAUNCH_SMOKE_MODE,
    expectedUserDataDir: userDataDir,
  });
  return {
    ...identity,
    marker: runtime.marker,
    markerError: runtime.error || null,
    markerPath: runtime.markerPath,
  };
}

function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex').toUpperCase();
}

function fileInfo(filePath) {
  if (!fs.existsSync(filePath)) fail('Package artifact is missing', filePath);
  const stat = fs.statSync(filePath);
  return {
    path: filePath,
    sizeBytes: stat.size,
    sha256: sha256(filePath),
    mtime: stat.mtime.toISOString(),
  };
}

function writeLog(filePath, chunks) {
  fs.writeFileSync(filePath, chunks.join(''), 'utf8');
}

function killTree(pid) {
  if (!pid) return;
  spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
    encoding: 'utf8',
    windowsHide: true,
  });
}

function windowsDescendants(pid) {
  const script = `
$rootPid = ${Number(pid)}
$seen = @($rootPid)
$all = @()
do {
  $next = Get-CimInstance Win32_Process | Where-Object { $seen -contains $_.ParentProcessId -and $seen -notcontains $_.ProcessId }
  foreach ($item in $next) {
    $seen += [int]$item.ProcessId
    $all += $item
  }
} while ($next.Count -gt 0)
$all | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress
`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) {
    return { error: result.stderr || result.stdout || `powershell exited ${result.status}`, processes: [] };
  }
  const text = String(result.stdout || '').trim();
  if (!text) return { processes: [] };
  try {
    const parsed = JSON.parse(text);
    return { processes: Array.isArray(parsed) ? parsed : [parsed] };
  } catch (error) {
    return { error: error.message, raw: text, processes: [] };
  }
}

async function launchUnpacked(exePath, userDataDir) {
  const stdout = [];
  const stderr = [];
  const stdoutPath = path.join(evidenceDir, `package-launch-unpacked-${runId}.stdout.log`);
  const stderrPath = path.join(evidenceDir, `package-launch-unpacked-${runId}.stderr.log`);
  const child = spawn(exePath, [], {
    cwd: path.dirname(exePath),
    env: {
      ...buildEvidenceUserDataEnv(process.env, PACKAGE_LAUNCH_SMOKE_MODE, userDataDir),
      ELECTRON_ENABLE_LOGGING: '1',
      ELECTRON_ENABLE_STACK_DUMPING: '1',
    },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => stdout.push(chunk.toString()));
  child.stderr.on('data', (chunk) => stderr.push(chunk.toString()));

  let marker = '';
  try {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const text = stdout.join('');
      const userDataEvidence = collectUserDataEvidence(userDataDir);
      if (text.includes('[App] window-created') && userDataEvidence.passed) {
        marker = '[App] window-created';
        break;
      }
      if (text.includes('[App] ipc-ready') && userDataEvidence.passed) {
        marker = '[App] ipc-ready';
        break;
      }
      if (child.exitCode !== null) break;
      await sleep(300);
    }
  } finally {
    killTree(child.pid);
    await sleep(500);
    writeLog(stdoutPath, stdout);
    writeLog(stderrPath, stderr);
  }

  const stdoutText = stdout.join('');
  const stderrText = stderr.join('');
  const userDataEvidence = collectUserDataEvidence(userDataDir);
  return {
    kind: 'win-unpacked',
    ok: Boolean(marker) && userDataEvidence.passed,
    marker,
    pid: child.pid,
    exitCode: child.exitCode,
    stdoutPath,
    stderrPath,
    stdoutTail: stdoutText.slice(-2000),
    stderrTail: stderrText.slice(-2000),
    userDataEvidence,
  };
}

async function launchPortable(exePath, userDataDir) {
  const stdout = [];
  const stderr = [];
  const stdoutPath = path.join(evidenceDir, `package-launch-portable-${runId}.stdout.log`);
  const stderrPath = path.join(evidenceDir, `package-launch-portable-${runId}.stderr.log`);
  const portableEnv = {
    ...buildEvidenceUserDataEnv(process.env, PACKAGE_LAUNCH_SMOKE_MODE, userDataDir),
    AMAZON_AI_OPS_PORTABLE_CWD: path.dirname(exePath),
    AMAZON_AI_OPS_PORTABLE_EXE: exePath,
    ELECTRON_ENABLE_LOGGING: '1',
    ELECTRON_ENABLE_STACK_DUMPING: '1',
  };
  const bootstrapScript = [
    '$process = Start-Process',
    '-FilePath $env:AMAZON_AI_OPS_PORTABLE_EXE',
    '-WorkingDirectory $env:AMAZON_AI_OPS_PORTABLE_CWD',
    '-WindowStyle Hidden',
    '-PassThru;',
    '[Console]::Out.Write($process.Id)',
  ].join(' ');
  const bootstrap = spawnSync('powershell.exe', ['-NoProfile', '-Command', bootstrapScript], {
    encoding: 'utf8',
    env: portableEnv,
    windowsHide: true,
  });
  stdout.push(String(bootstrap.stdout || ''));
  stderr.push(String(bootstrap.stderr || ''));
  if (bootstrap.status !== 0) {
    fail('Portable launcher bootstrap failed', stderr.join('').trim() || `PowerShell exited ${bootstrap.status}`);
  }
  const launcherPid = Number(String(bootstrap.stdout || '').trim());
  if (!Number.isInteger(launcherPid) || launcherPid <= 0) {
    fail('Portable launcher bootstrap returned an invalid PID', String(bootstrap.stdout || '').trim());
  }

  let descendantSnapshot = { processes: [] };
  try {
    // Portable NSIS startup includes extraction of the full Windows payload.
    // On operator machines with real-time scanning this consistently exceeds
    // one minute even though the child app starts correctly. PowerShell's
    // Start-Process also avoids binding the NSIS extractor to Node's job/pipe
    // handles, while WMI + the runtime marker still prove the exact child app.
    const deadline = Date.now() + 120000;
    let nextDescendantPollAt = 0;
    while (Date.now() < deadline) {
      if (Date.now() >= nextDescendantPollAt) {
        descendantSnapshot = windowsDescendants(launcherPid);
        nextDescendantPollAt = Date.now() + 2000;
      }
      const appChildren = descendantSnapshot.processes.filter((item) => /AmazonAIOpsAgent\.exe/i.test(String(item.Name || '')));
      const userDataEvidence = collectUserDataEvidence(userDataDir);
      if (appChildren.length > 0 && userDataEvidence.passed) break;
      await sleep(500);
    }
  } finally {
    killTree(launcherPid);
    await sleep(500);
    writeLog(stdoutPath, stdout);
    writeLog(stderrPath, stderr);
  }

  const appChildren = descendantSnapshot.processes.filter((item) => /AmazonAIOpsAgent\.exe/i.test(String(item.Name || '')));
  const userDataEvidence = collectUserDataEvidence(userDataDir);
  return {
    kind: 'portable',
    ok: appChildren.length > 0 && userDataEvidence.passed,
    launcherPid,
    launcherExitCode: null,
    bootstrapExitCode: bootstrap.status,
    descendantCount: descendantSnapshot.processes.length,
    appChildCount: appChildren.length,
    descendants: descendantSnapshot.processes,
    descendantError: descendantSnapshot.error || null,
    stdoutPath,
    stderrPath,
    stdoutTail: stdout.join('').slice(-2000),
    stderrTail: stderr.join('').slice(-2000),
    userDataEvidence,
  };
}

async function main() {
  if (process.platform !== 'win32') {
    fail('Package launch smoke currently supports Windows only', process.platform);
  }
  fs.mkdirSync(evidenceDir, { recursive: true });
  const unpackedExe = path.join(releaseDir, 'win-unpacked', 'AmazonAIOpsAgent.exe');
  const portableExe = path.join(releaseDir, `AmazonAIOpsAgent-${desktopPackage.version}-portable.exe`);
  const userDataOverrideBundleContract = inspectPackagedUserDataOverrideContract(
    path.join(releaseDir, 'win-unpacked', 'resources', 'app', 'dist', 'main', 'index.js'),
  );
  const isolatedUserData = {
    unpacked: prepareIsolatedUserData('win-unpacked'),
    portable: prepareIsolatedUserData('portable'),
  };
  const evidence = {
    kind: 'package-launch-smoke',
    generatedAt: new Date().toISOString(),
    releaseDir,
    evidenceMode: PACKAGE_LAUNCH_SMOKE_MODE,
    isolatedUserData,
    userDataOverrideBundleContract,
    artifacts: {
      unpacked: fileInfo(unpackedExe),
      portable: fileInfo(portableExe),
    },
    checks: [],
    passed: false,
  };

  if (!userDataOverrideBundleContract.passed) {
    fail('Package launch smoke refused to start a package without the userData override contract', JSON.stringify(
      userDataOverrideBundleContract.violations,
    ));
  }

  evidence.checks.push(await launchUnpacked(unpackedExe, isolatedUserData.unpacked));
  evidence.checks.push(await launchPortable(portableExe, isolatedUserData.portable));
  evidence.passed = evidence.checks.every((check) => check.ok);

  const evidencePath = path.join(evidenceDir, `package-launch-smoke-${runId}.json`);
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  if (!evidence.passed) {
    fail('Package launch smoke failed', evidencePath);
  }
  console.log(`[PASS] package launch smoke evidence: ${evidencePath}`);
}

main().catch((error) => {
  console.error(`[FAIL] ${error.message}`);
  process.exit(1);
});

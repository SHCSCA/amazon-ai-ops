const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const releaseDir = path.join(root, 'apps', 'desktop', 'release');
const evidenceDir = path.join(root, 'output', 'codex-evidence');
const desktopPackage = JSON.parse(fs.readFileSync(path.join(root, 'apps', 'desktop', 'package.json'), 'utf8'));
const runId = Date.now();

function fail(message, details) {
  throw new Error(details ? `${message}: ${details}` : message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function launchUnpacked(exePath) {
  const stdout = [];
  const stderr = [];
  const stdoutPath = path.join(evidenceDir, `package-launch-unpacked-${runId}.stdout.log`);
  const stderrPath = path.join(evidenceDir, `package-launch-unpacked-${runId}.stderr.log`);
  const child = spawn(exePath, [], {
    cwd: path.dirname(exePath),
    env: {
      ...process.env,
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
      if (text.includes('[App] window-created')) {
        marker = '[App] window-created';
        break;
      }
      if (text.includes('[App] ipc-ready')) {
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
  return {
    kind: 'win-unpacked',
    ok: Boolean(marker),
    marker,
    pid: child.pid,
    exitCode: child.exitCode,
    stdoutPath,
    stderrPath,
    stdoutTail: stdoutText.slice(-2000),
    stderrTail: stderrText.slice(-2000),
  };
}

async function launchPortable(exePath) {
  const stdout = [];
  const stderr = [];
  const stdoutPath = path.join(evidenceDir, `package-launch-portable-${runId}.stdout.log`);
  const stderrPath = path.join(evidenceDir, `package-launch-portable-${runId}.stderr.log`);
  const child = spawn(exePath, [], {
    cwd: path.dirname(exePath),
    env: {
      ...process.env,
      ELECTRON_ENABLE_LOGGING: '1',
      ELECTRON_ENABLE_STACK_DUMPING: '1',
    },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => stdout.push(chunk.toString()));
  child.stderr.on('data', (chunk) => stderr.push(chunk.toString()));

  let descendantSnapshot = { processes: [] };
  try {
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      descendantSnapshot = windowsDescendants(child.pid);
      const appChildren = descendantSnapshot.processes.filter((item) => /AmazonAIOpsAgent\.exe/i.test(String(item.Name || '')));
      if (appChildren.length > 0) break;
      if (child.exitCode !== null) break;
      await sleep(500);
    }
  } finally {
    killTree(child.pid);
    await sleep(500);
    writeLog(stdoutPath, stdout);
    writeLog(stderrPath, stderr);
  }

  const appChildren = descendantSnapshot.processes.filter((item) => /AmazonAIOpsAgent\.exe/i.test(String(item.Name || '')));
  return {
    kind: 'portable',
    ok: appChildren.length > 0,
    launcherPid: child.pid,
    launcherExitCode: child.exitCode,
    descendantCount: descendantSnapshot.processes.length,
    appChildCount: appChildren.length,
    descendants: descendantSnapshot.processes,
    descendantError: descendantSnapshot.error || null,
    stdoutPath,
    stderrPath,
    stdoutTail: stdout.join('').slice(-2000),
    stderrTail: stderr.join('').slice(-2000),
  };
}

async function main() {
  if (process.platform !== 'win32') {
    fail('Package launch smoke currently supports Windows only', process.platform);
  }
  fs.mkdirSync(evidenceDir, { recursive: true });
  const unpackedExe = path.join(releaseDir, 'win-unpacked', 'AmazonAIOpsAgent.exe');
  const portableExe = path.join(releaseDir, `AmazonAIOpsAgent-${desktopPackage.version}-portable.exe`);
  const evidence = {
    kind: 'package-launch-smoke',
    generatedAt: new Date().toISOString(),
    releaseDir,
    artifacts: {
      unpacked: fileInfo(unpackedExe),
      portable: fileInfo(portableExe),
    },
    checks: [],
    passed: false,
  };

  evidence.checks.push(await launchUnpacked(unpackedExe));
  evidence.checks.push(await launchPortable(portableExe));
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

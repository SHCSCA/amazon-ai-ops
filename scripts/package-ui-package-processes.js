// 跨职责调用通过组合入口注入，延迟转发保留单一实现和初始化顺序。
module.exports = function createPackageUiModule(dependencies) {
  const {
    PACKAGE_PROCESS_NAME,
    spawnSync,
  } = dependencies;
  const normalizedWindowsPath = (...args) => dependencies.normalizedWindowsPath(...args);
  const nullableProcessId = (...args) => dependencies.nullableProcessId(...args);
  const packageProcessAbsencePassed = (...args) => dependencies.packageProcessAbsencePassed(...args);
  const parsePowerShellProcessRows = (...args) => dependencies.parsePowerShellProcessRows(...args);
  const sanitizeDiagnosticText = (...args) => dependencies.sanitizeDiagnosticText(...args);

function collectMatchingPackageProcesses(executablePath, run = spawnSync) {
  const command = [
    "$ErrorActionPreference = 'Stop'",
    `$items = @(Get-CimInstance Win32_Process -Filter "Name='${PACKAGE_PROCESS_NAME.replace(/'/g, "''")}'" | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath)`,
    'ConvertTo-Json -InputObject $items -Compress',
  ].join('; ');
  const result = run('powershell.exe', ['-NoProfile', '-Command', command], {
    encoding: 'utf8',
    windowsHide: true,
  });
  const primary = parsePowerShellProcessRows(result, 'package');
  let collectionMethod = 'cim';
  let primaryError = null;
  let observed = primary.observed;
  if (!primary.passed) {
    primaryError = primary.error;
    const expectedName = PACKAGE_PROCESS_NAME.replace(/'/g, "''");
    const fallbackCommand = [
      "$ErrorActionPreference = 'Stop'",
      `$expectedName = '${expectedName}'`,
      '$items = @(Get-Process -ErrorAction Stop | Where-Object { "$($_.ProcessName).exe" -ieq $expectedName } | ForEach-Object {',
      '  $executablePath = $null',
      '  try { $executablePath = $_.Path } catch { $executablePath = $null }',
      '  [PSCustomObject]@{ ProcessId = $_.Id; ParentProcessId = $null; Name = "$($_.ProcessName).exe"; ExecutablePath = $executablePath }',
      '})',
      'ConvertTo-Json -InputObject $items -Compress',
    ].join('; ');
    const fallbackResult = run('powershell.exe', ['-NoProfile', '-Command', fallbackCommand], {
      encoding: 'utf8',
      windowsHide: true,
    });
    const fallback = parsePowerShellProcessRows(fallbackResult, 'package Get-Process fallback');
    collectionMethod = 'get-process-fallback';
    if (!fallback.passed) {
      return {
        collectionMethod,
        error: sanitizeDiagnosticText(`${primaryError}; fallback: ${fallback.error}`),
        matching: [],
        matchingCount: null,
        observedCount: null,
        passed: false,
        primaryError,
        unresolved: [],
        unresolvedCount: null,
      };
    }
    observed = fallback.observed;
  }
  if (!Array.isArray(observed)) {
    return {
      collectionMethod,
      error: sanitizeDiagnosticText(primaryError || 'Package process collection returned no rows.'),
      matching: [],
      matchingCount: null,
      observedCount: null,
      passed: false,
      primaryError,
      unresolved: [],
      unresolvedCount: null,
    };
  }
  const expectedPath = normalizedWindowsPath(executablePath);
  const unresolved = observed.filter((item) => !item.ExecutablePath);
  const matching = observed
    .filter((item) => item.ExecutablePath && normalizedWindowsPath(item.ExecutablePath) === expectedPath)
    .map((item) => ({
      executablePath: item.ExecutablePath,
      name: item.Name,
      parentProcessId: nullableProcessId(item.ParentProcessId),
      processId: Number(item.ProcessId),
    }));
  return {
    collectionMethod,
    error: null,
    matching,
    matchingCount: matching.length,
    observedCount: observed.length,
    passed: unresolved.length === 0,
    primaryError,
    unresolved: unresolved.map((item) => ({
      executablePath: null,
      name: item.Name || null,
      parentProcessId: nullableProcessId(item.ParentProcessId),
      processId: Number(item.ProcessId),
    })),
    unresolvedCount: unresolved.length,
  };
}

async function waitForPackageProcessCleanup(executablePath, options = {}) {
  const collect = options.collect || collectMatchingPackageProcesses;
  const attempts = Number.isInteger(options.attempts) ? options.attempts : 20;
  const intervalMs = Number.isInteger(options.intervalMs) ? options.intervalMs : 250;
  let snapshot = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    snapshot = collect(executablePath);
    if (packageProcessAbsencePassed(snapshot)) {
      return { ...snapshot, attempts: attempt, passed: true };
    }
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  return { ...snapshot, attempts, passed: false };
}

  return {
    collectMatchingPackageProcesses,
    waitForPackageProcessCleanup,
  };
};

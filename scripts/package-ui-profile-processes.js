// 跨职责调用通过组合入口注入，延迟转发保留单一实现和初始化顺序。
module.exports = function createPackageUiModule(dependencies) {
  const {
    PROFILE_BROWSER_PROCESS_NAMES,
    path,
    spawnSync,
  } = dependencies;
  const envelopePayloadSha256 = (...args) => dependencies.envelopePayloadSha256(...args);
  const normalizedWindowsPath = (...args) => dependencies.normalizedWindowsPath(...args);
  const sanitizeDiagnosticText = (...args) => dependencies.sanitizeDiagnosticText(...args);
  const sha256Buffer = (...args) => dependencies.sha256Buffer(...args);

function extractProfileUserDataDirectories(commandLine) {
  const source = String(commandLine || '');
  const values = [];
  const patterns = [
    /"--user-data-dir=([^"]+)"/gi,
    /--user-data-dir\s*=\s*"([^"]+)"/gi,
    /--user-data-dir\s*=\s*'([^']+)'/gi,
    /--user-data-dir\s*=\s*([^\s"]+)/gi,
    /"--user-data-dir"\s+"([^"]+)"/gi,
    /--user-data-dir\s+"([^"]+)"/gi,
    /--user-data-dir\s+'([^']+)'/gi,
    /--user-data-dir\s+([^\s"]+)/gi,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      if (match[1]) values.push(match[1]);
    }
  }
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function nullableProcessId(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : null;
}

function parsePowerShellProcessRows(result, label) {
  if (result.status !== 0) {
    return {
      error: sanitizeDiagnosticText(result.stderr || result.error?.message || `PowerShell exited ${result.status}`),
      observed: null,
      passed: false,
    };
  }
  try {
    const parsed = JSON.parse(String(result.stdout || '').trim() || '[]');
    return {
      error: null,
      observed: Array.isArray(parsed) ? parsed : parsed ? [parsed] : [],
      passed: true,
    };
  } catch (error) {
    return {
      error: sanitizeDiagnosticText(`Could not parse ${label} process snapshot: ${error instanceof Error ? error.message : String(error)}`),
      observed: null,
      passed: false,
    };
  }
}

function browserProcessRecord(item, profileMatched, profilePathBindingSha256 = null) {
  return {
    executablePath: item.ExecutablePath || null,
    name: item.Name || null,
    parentProcessId: nullableProcessId(item.ParentProcessId),
    processId: Number(item.ProcessId),
    profileMatched: Boolean(profileMatched),
    profilePathBindingSha256: profileMatched ? profilePathBindingSha256 : null,
  };
}

function collectMatchingProfileBrowserProcesses(profilePath, options = {}, run = spawnSync) {
  if (typeof options === 'function') {
    run = options;
    options = {};
  }
  const expectedProfilePath = normalizedWindowsPath(profilePath);
  const expectedProfilePrefix = `${expectedProfilePath.replace(/\/+$/, '')}/`;
  const expectedExecutablePath = options.expectedExecutablePath
    ? normalizedWindowsPath(options.expectedExecutablePath)
    : null;
  const baselineProvided = Array.isArray(options.baselineProcessIds);
  const baselineProcessIds = new Set(
    baselineProvided
      ? options.baselineProcessIds.filter((value) => Number.isInteger(value) && value > 0)
      : [],
  );
  const names = PROFILE_BROWSER_PROCESS_NAMES.map((name) => `'${name.replace(/'/g, "''")}'`).join(',');
  const command = [
    "$ErrorActionPreference = 'Stop'",
    `$names = @(${names})`,
    '$items = @(Get-CimInstance Win32_Process | Where-Object { $names -contains $_.Name } | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine)',
    'ConvertTo-Json -InputObject $items -Compress',
  ].join('; ');
  const result = run('powershell.exe', ['-NoProfile', '-Command', command], {
    encoding: 'utf8',
    windowsHide: true,
  });
  const primary = parsePowerShellProcessRows(result, 'profile browser');
  let collectionMethod = 'cim';
  let primaryError = null;
  let observed = primary.observed;
  if (!primary.passed) {
    primaryError = primary.error;
    const fallbackCommand = [
      "$ErrorActionPreference = 'Stop'",
      `$names = @(${names})`,
      '$processes = @(Get-Process -ErrorAction Stop | Where-Object { $names -contains "$($_.ProcessName).exe" })',
      '$items = @($processes | ForEach-Object {',
      '  $process = $_',
      '  $cim = $null',
      '  try { $cim = Get-CimInstance Win32_Process -Filter "ProcessId=$($process.Id)" -ErrorAction Stop } catch { $cim = $null }',
      '  $executablePath = $null',
      '  try { $executablePath = $process.Path } catch { $executablePath = $null }',
      '  [PSCustomObject]@{ ProcessId = $process.Id; ParentProcessId = if ($cim) { $cim.ParentProcessId } else { $null }; Name = "$($process.ProcessName).exe"; ExecutablePath = $executablePath; CommandLine = if ($cim) { $cim.CommandLine } else { $null } }',
      '})',
      'ConvertTo-Json -InputObject $items -Compress',
    ].join('; ');
    const fallbackResult = run('powershell.exe', ['-NoProfile', '-Command', fallbackCommand], {
      encoding: 'utf8',
      windowsHide: true,
    });
    const fallback = parsePowerShellProcessRows(fallbackResult, 'profile browser Get-Process fallback');
    collectionMethod = 'get-process-targeted-cim-fallback';
    if (!fallback.passed) {
      return {
        collectionMethod,
        error: sanitizeDiagnosticText(`${primaryError}; fallback: ${fallback.error}`),
        matching: [],
        matchingCount: null,
        observedCount: null,
        passed: false,
        primaryError,
        profilePath: path.resolve(profilePath),
        unresolved: [],
        unresolvedCount: null,
      };
    }
    observed = fallback.observed;
  }
  if (!Array.isArray(observed)) {
    return {
      collectionMethod,
      error: sanitizeDiagnosticText(primaryError || 'Profile browser process collection returned no rows.'),
      matching: [],
      matchingCount: null,
      observedCount: null,
      passed: false,
      primaryError,
      profilePath: path.resolve(profilePath),
      unresolved: [],
      unresolvedCount: null,
    };
  }
  const enriched = observed.map((item) => {
    const matchedProfilePaths = Boolean(item.CommandLine)
      ? extractProfileUserDataDirectories(item.CommandLine)
        .map((candidate) => normalizedWindowsPath(candidate))
        .filter((normalizedCandidate) => (
          normalizedCandidate === expectedProfilePath
          || normalizedCandidate.startsWith(expectedProfilePrefix)
        ))
        .sort((left, right) => left.localeCompare(right, 'en'))
      : [];
    const profileMatched = matchedProfilePaths.length > 0;
    const profilePathBindingSha256 = profileMatched
      ? envelopePayloadSha256([...new Set(matchedProfilePaths)])
      : null;
    /*
     * Raw command lines and matched --user-data-dir values are discarded here.
     * The per-process token lets the terminal verifier derive the observed
     * profile binding without persisting browser arguments or store paths.
     */
    const executableMatched = Boolean(
      expectedExecutablePath
      && item.ExecutablePath
      && normalizedWindowsPath(item.ExecutablePath) === expectedExecutablePath
    );
    return {
      executableMatched,
      item,
      profileMatched,
      profilePathBindingSha256,
    };
  });
  const seedPids = new Set(
    enriched
      .filter((entry) => entry.profileMatched)
      .map((entry) => Number(entry.item.ProcessId)),
  );
  const lineagePids = new Set(seedPids);
  let lineageExpanded = true;
  while (lineageExpanded) {
    lineageExpanded = false;
    for (const entry of enriched) {
      const processId = Number(entry.item.ProcessId);
      const parentProcessId = nullableProcessId(entry.item.ParentProcessId);
      if (
        lineagePids.has(processId)
        && parentProcessId !== null
        && enriched.some((candidate) => Number(candidate.item.ProcessId) === parentProcessId)
        && !lineagePids.has(parentProcessId)
      ) {
        lineagePids.add(parentProcessId);
        lineageExpanded = true;
      }
      if (!lineagePids.has(processId) && parentProcessId !== null && lineagePids.has(parentProcessId)) {
        lineagePids.add(processId);
        lineageExpanded = true;
      }
    }
  }
  const targetItems = enriched.filter((entry) => (
    lineagePids.has(Number(entry.item.ProcessId))
    || entry.executableMatched
  ));
  /*
   * Unreadable rows remain fail-closed by default. The evidence orchestrator
   * may explicitly classify a pre-existing daily browser as baseline-only
   * after it has independently proved both packaged-process absence and an
   * exclusive-open isolated profile tree. Cleanup may retain only those exact
   * baseline PIDs; any new unreadable row still blocks.
   */
  const baselineUnrelatedItems = enriched.filter((entry) => {
    if (entry.item.CommandLine && entry.item.ExecutablePath) return false;
    if (entry.profileMatched || entry.executableMatched) return false;
    const processId = Number(entry.item.ProcessId);
    return options.allowUnreadableBaseline === true
      && (!baselineProvided || baselineProcessIds.has(processId));
  });
  const baselineUnrelatedProcessIds = new Set(
    baselineUnrelatedItems.map((entry) => Number(entry.item.ProcessId)),
  );
  const newlyObservedUnreadableItems = enriched.filter((entry) => (
    (!entry.item.CommandLine || !entry.item.ExecutablePath)
    && !baselineUnrelatedProcessIds.has(Number(entry.item.ProcessId))
  ));
  const unresolvedItems = [...new Set([
    ...targetItems.filter((entry) => (
      !entry.item.ExecutablePath
      || (lineagePids.has(Number(entry.item.ProcessId)) && !entry.item.CommandLine)
    )),
    ...newlyObservedUnreadableItems,
  ])];
  const mismatchedItems = targetItems.filter((entry) => (
    expectedExecutablePath
    && (
      (entry.item.ExecutablePath && !entry.executableMatched)
      || (
        entry.executableMatched
        && !lineagePids.has(Number(entry.item.ProcessId))
      )
    )
  ));
  const matchingItems = targetItems.filter((entry) => (
    entry.item.ExecutablePath
    && (!expectedExecutablePath || entry.executableMatched)
    && (
      lineagePids.has(Number(entry.item.ProcessId))
      || (!expectedExecutablePath && entry.profileMatched)
    )
  ));
  const matchingProcessIds = new Set(matchingItems.map((entry) => Number(entry.item.ProcessId)));
  const rootProcessIds = matchingItems
    .filter((entry) => {
      const parentProcessId = nullableProcessId(entry.item.ParentProcessId);
      return parentProcessId === null || !matchingProcessIds.has(parentProcessId);
    })
    .map((entry) => Number(entry.item.ProcessId))
    .sort((left, right) => left - right);
  const ignoredUnresolvedCount = 0;
  const observedProfileBindingTokens = [...new Set(
    matchingItems
      .filter((entry) => entry.profileMatched)
      .map((entry) => entry.profilePathBindingSha256),
  )].sort((left, right) => left.localeCompare(right, 'en'));
  return {
    baselineUnrelated: baselineUnrelatedItems.map((entry) => browserProcessRecord(
      entry.item,
      entry.profileMatched,
      entry.profilePathBindingSha256,
    )),
    baselineUnrelatedCount: baselineUnrelatedItems.length,
    collectionMethod,
    error: null,
    descendantProcessIds: matchingItems
      .map((entry) => Number(entry.item.ProcessId))
      .filter((processId) => !rootProcessIds.includes(processId))
      .sort((left, right) => left - right),
    ignoredUnresolvedCount,
    expectedProfileRootSha256: sha256Buffer(Buffer.from(expectedProfilePath, 'utf8')),
    matching: matchingItems.map((entry) => browserProcessRecord(
      entry.item,
      entry.profileMatched,
      entry.profilePathBindingSha256,
    )),
    matchingCount: matchingItems.length,
    mismatched: mismatchedItems.map((entry) => browserProcessRecord(
      entry.item,
      entry.profileMatched,
      entry.profilePathBindingSha256,
    )),
    mismatchedCount: mismatchedItems.length,
    observedCount: observed.length,
    observedProcessIds: enriched
      .map((entry) => Number(entry.item.ProcessId))
      .filter((value) => Number.isInteger(value) && value > 0)
      .sort((left, right) => left - right),
    passed: unresolvedItems.length === 0 && mismatchedItems.length === 0,
    primaryError,
    profilePath: path.resolve(profilePath),
    profileBindingSha256: observedProfileBindingTokens.length > 0
      ? envelopePayloadSha256(observedProfileBindingTokens)
      : null,
    profileBindingTokenCount: observedProfileBindingTokens.length,
    rootProcessIds,
    targetObservedCount: targetItems.length,
    unresolved: unresolvedItems.map((entry) => browserProcessRecord(
      entry.item,
      entry.profileMatched,
      entry.profilePathBindingSha256,
    )),
    unresolvedCount: unresolvedItems.length,
  };
}

async function waitForProfileBrowserProcessCleanup(profilePath, options = {}) {
  const collect = options.collect || collectMatchingProfileBrowserProcesses;
  const collectOptions = options.collectOptions || {};
  const attempts = Number.isInteger(options.attempts) ? options.attempts : 20;
  const intervalMs = Number.isInteger(options.intervalMs) ? options.intervalMs : 250;
  let snapshot = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    snapshot = collect(profilePath, collectOptions);
    if (
      snapshot.passed === true
      && snapshot.matchingCount === 0
      && snapshot.unresolvedCount === 0
      && (snapshot.ignoredUnresolvedCount ?? 0) === 0
    ) {
      return { ...snapshot, attempts: attempt, passed: true };
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return { ...snapshot, attempts, passed: false };
}

function processSnapshotEvidencePassed(snapshot) {
  return snapshot?.passed === true
    && snapshot.error === null
    && Number.isInteger(snapshot.observedCount)
    && snapshot.observedCount >= 0
    && Array.isArray(snapshot.matching)
    && Number.isInteger(snapshot.matchingCount)
    && snapshot.matchingCount === snapshot.matching.length
    && Array.isArray(snapshot.unresolved)
    && Number.isInteger(snapshot.unresolvedCount)
    && snapshot.unresolvedCount === snapshot.unresolved.length
    && (!Array.isArray(snapshot.mismatched)
      || (
        Number.isInteger(snapshot.mismatchedCount)
        && snapshot.mismatchedCount === snapshot.mismatched.length
        && snapshot.mismatchedCount === 0
      ))
    && (
      snapshot.ignoredUnresolvedCount === undefined
      || snapshot.ignoredUnresolvedCount === 0
    )
    && snapshot.observedCount >= snapshot.matchingCount + snapshot.unresolvedCount;
}

  return {
    extractProfileUserDataDirectories,
    nullableProcessId,
    parsePowerShellProcessRows,
    browserProcessRecord,
    collectMatchingProfileBrowserProcesses,
    waitForProfileBrowserProcessCleanup,
    processSnapshotEvidencePassed,
  };
};

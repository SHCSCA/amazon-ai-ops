import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const scriptPath = path.resolve(process.env.AMAZON_AI_OPS_ZIP_CLEANUP_CONTRACT_SOURCE || 'scripts/smoke-folder-zip-launch.ps1');
const source = fs.readFileSync(scriptPath, 'utf8');
const escapedPath = scriptPath.replaceAll("'", "''");
const powershell = command => spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', command], {
  encoding: 'utf8', timeout: 20000, windowsHide: true,
});
const harness = `
$ErrorActionPreference = 'Stop'
$errors = $null; $tokens = $null
$ast = [Management.Automation.Language.Parser]::ParseFile('${escapedPath}', [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | ConvertTo-Json) }
foreach ($name in @('Get-ZipRuntimeProcessSnapshot','Get-ZipRuntimeProcesses','Assert-ZipRuntimeProcessIdentity',
  'Remember-ZipRuntimeProcess','Stop-ZipRuntimeProcess','Add-ZipCleanupFailure','Stop-VerifiedRuntime','Complete-ZipRuntimeCleanup')) {
  $definition = $ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name}, $true)
  if ($definition) { Invoke-Expression $definition.Extent.Text }
}
$safeExtractRoot = 'G:\\Temp\\amazon-ai-ops-folder-zip-smoke-123'
$safeUserDataRoot = 'G:\\Temp\\amazon-ai-ops-folder-zip-user-123'
$extractRoot = $safeExtractRoot; $userDataRoot = $safeUserDataRoot
$expectedExecutable = Join-Path $safeExtractRoot 'AmazonAIOpsAgent.exe'
$created = [DateTime]::UtcNow
$script:zipRuntimeStartedAt = $created.AddSeconds(-1)
$script:zipRuntimeIdentities = @{}
$script:zipCleanupFailures = [System.Collections.Generic.List[object]]::new()
$script:reads = 0; $script:opens = 0; $script:disposes = 0; $script:enumerations = 0
$script:alive = $true; $script:pidOwner = 'original'
$script:kills = [System.Collections.Generic.List[string]]::new()
$script:pidStops = [System.Collections.Generic.List[string]]::new()
$script:removed = [System.Collections.Generic.List[string]]::new()
function New-Snapshot {
  $creation = $created; $executable = $expectedExecutable
  if ($script:scenario -eq 'missing-path') { $executable = $null }
  if ($script:scenario -eq 'changed-path') { $executable = 'G:\\Temp\\other.exe' }
  if ($script:scenario -eq 'prefixed-sibling') { $executable = $safeExtractRoot + '-other\\AmazonAIOpsAgent.exe' }
  if ($script:scenario -eq 'missing-creation') { $creation = $null }
  if ($script:scenario -eq 'reused-before-open' -or
    ($script:scenario -eq 'reused-after-handle' -and $script:reads -ge 2)) { $creation = $created.AddSeconds(1) }
  if ($script:pidOwner -eq 'replacement') { $creation = $created.AddSeconds(2); $executable = 'G:\\Temp\\unrelated.exe' }
  $snapshot = [pscustomobject]@{Name='AmazonAIOpsAgent.exe'; ProcessId=123; ExecutablePath=$executable; CreationDate=$creation}
  if ($script:scenario -eq 'path-throws') {
    $snapshot.PSObject.Properties.Remove('ExecutablePath')
    $snapshot | Add-Member ScriptProperty ExecutablePath { throw 'path cannot be read' }
  }
  return $snapshot
}
$script:initial = [pscustomobject]@{Name='AmazonAIOpsAgent.exe'; ProcessId=123; ExecutablePath=$expectedExecutable; CreationDate=$created}
$script:zipRuntimeIdentities[123] = $script:initial
function Get-ZipRuntimeProcessSnapshot {
  param($ProcessId)
  $script:reads++
  if ($script:scenario -eq 'vanished-first' -or
    ($script:scenario -eq 'vanished-after-handle' -and $script:reads -ge 2)) { $script:alive = $false }
  if (-not $script:alive) { return @() }
  $snapshot = New-Snapshot
  if ($script:scenario -eq 'replaced-after-recheck' -and $script:reads -eq 2) { $script:pidOwner = 'replacement' }
  return $snapshot
}
function Get-ZipRuntimeProcesses {
  $script:enumerations++
  if ($script:alive) {
    $snapshot = New-Snapshot
    if ($script:scenario -in @('reused-before-open','reused-after-handle')) { $snapshot.CreationDate = $created }
    return $snapshot
  }
  return @()
}
function Get-CimInstance {
  param($ClassName, $Filter, $ErrorAction)
  return Get-ZipRuntimeProcesses
}
function Get-Process {
  param($Id, $ErrorAction)
  if ($script:scenario -eq 'vanished-open') { $script:alive = $false; throw 'already exited at open' }
  $script:opens++
  $handle = [pscustomobject]@{Target='original'}
  $handle | Add-Member ScriptProperty Handle {
    if ($script:scenario -eq 'handle-throws') { throw 'handle cannot be opened' }
    return 777
  }
  $handle | Add-Member ScriptProperty Path {
    if ($script:scenario -eq 'path-throws') { throw 'path cannot be read' }
    if ($script:scenario -eq 'replaced-after-recheck') { $script:pidOwner = 'replacement'; return $expectedExecutable }
    return (New-Snapshot).ExecutablePath
  }
  $handle | Add-Member ScriptMethod Kill {
    $script:kills.Add($this.Target)
    if ($script:scenario -eq 'replaced-after-recheck') { throw 'bound original already exited' }
    if ($script:scenario -notin @('wait-timeout','surviving-peer')) { $script:alive = $false }
    if ($script:scenario -eq 'exit-during-kill') { throw 'already exited during stop' }
  }
  $handle | Add-Member ScriptMethod WaitForExit { param($Timeout) return $script:scenario -ne 'wait-timeout' }
  $handle | Add-Member ScriptMethod Dispose { $script:disposes++ }
  return $handle
}
function Stop-Process {
  param($Id, [switch]$Force, $ErrorAction)
  $script:pidStops.Add($script:pidOwner)
  if ($script:scenario -ne 'surviving-peer') { $script:alive = $false }
}
function Start-Sleep { param($Seconds, $Milliseconds) }
function Test-Path { param($LiteralPath, $PathType) return $true }
function Assert-SafeTempPath { param($Path, $ExpectedPath) return $Path }
function Remove-Item { param($LiteralPath, [switch]$Recurse, [switch]$Force) $script:removed.Add($LiteralPath) }
`;

describe('isolated ZIP process cleanup contract', () => {
  it('parses the guarded PowerShell without launching any package', () => {
    const result = powershell(harness + "'parsed without package launch'");
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });

  for (const phase of ['candidate', 'peer']) {
    for (const scenario of ['missing-path', 'path-throws', 'missing-creation', 'reused-before-open', 'reused-after-handle']) {
      it(`rejects ${phase} ${scenario} before any termination and retains both roots`, () => {
        const result = powershell(harness + `
          $script:scenario = '${scenario}'
          if ('${phase}' -eq 'peer') { $script:zipRuntimeIdentities = @{} }
          $rejected = $false
          try { $null = Stop-VerifiedRuntime -ProcessIds $(if ('${phase}' -eq 'candidate') { @(123) } else { @() }) -ExpectedExecutableRoot $safeExtractRoot }
          catch { $rejected = $true }
          if (-not $rejected -or $script:kills.Count -or $script:pidStops.Count) { throw 'unverified process termination was admitted' }
          $receipt = Complete-ZipRuntimeCleanup $(if ('${phase}' -eq 'candidate') { @(123) } else { @() })
          if ($receipt.processCleanupConfirmed -or $receipt.temporaryFilesRemoved -or $receipt.failures.Count -eq 0) { throw 'unsafe cleanup accepted' }
          if ($script:kills.Count -or $script:pidStops.Count -or $script:removed.Count) { throw 'unverified process or directory was changed' }
          if ($script:opens -ne $script:disposes) { throw 'process handle leaked' }
          'rejected without mutation'`);
        expect(result.status, result.stdout + result.stderr).toBe(0);
        expect(result.stderr).toContain('package.folder_zip_cleanup_failed');
      });
    }
  }

  it.each(['changed-path', 'prefixed-sibling', 'handle-throws', 'unowned-pid'])(
    'rejects %s without a PID fallback or directory removal', scenario => {
      const result = powershell(harness + `
        $script:scenario = '${scenario}'
        if ($script:scenario -eq 'unowned-pid') { $script:zipRuntimeIdentities = @{} }
        $receipt = Complete-ZipRuntimeCleanup @(123)
        if ($receipt.processCleanupConfirmed -or $receipt.temporaryFilesRemoved) { throw 'unsafe cleanup accepted' }
        if ($script:kills.Count -or $script:pidStops.Count -or $script:removed.Count) { throw 'unsafe fallback performed' }
        if ($script:opens -ne $script:disposes) { throw 'process handle leaked' }
        'rejected without fallback'`);
      expect(result.status, result.stdout + result.stderr).toBe(0);
    },
  );

  it('never stops a similarly prefixed foreign peer', () => {
    const result = powershell(harness + `
      $script:scenario = 'prefixed-sibling'; $script:zipRuntimeIdentities = @{}
      $receipt = Complete-ZipRuntimeCleanup @()
      if (-not $receipt.processCleanupConfirmed -or -not $receipt.temporaryFilesRemoved) { throw 'foreign peer blocked owned cleanup' }
      if ($script:kills.Count -or $script:pidStops.Count -or -not $script:alive) { throw 'foreign peer was terminated' }
      if ($script:removed.Count -ne 2) { throw 'owned directories were not cleaned' }`);
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });

  it('uses only the bound original handle if the PID changes after the second snapshot', () => {
    const result = powershell(harness + `
      $script:scenario = 'replaced-after-recheck'
      $rejected = $false
      try { $null = Stop-VerifiedRuntime -ProcessIds @(123) -ExpectedExecutableRoot $safeExtractRoot } catch { $rejected = $true }
      if (-not $rejected -or $script:pidStops.Count) { throw 'replacement PID was terminated after verification' }
      $receipt = Complete-ZipRuntimeCleanup @(123)
      if ($receipt.temporaryFilesRemoved -or $receipt.processCleanupConfirmed) { throw 'PID replacement became cleanup success' }
      if ($script:kills.Count -ne 1 -or $script:kills[0] -ne 'original') { throw 'original handle was not retained' }
      if ($script:pidStops.Count -or $script:removed.Count -or $script:pidOwner -ne 'replacement' -or -not $script:alive) { throw 'replacement process or owned evidence changed' }
      if ($script:opens -ne $script:disposes) { throw 'original handle leaked' }`);
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });

  it.each(['vanished-first', 'vanished-open', 'vanished-after-handle', 'exit-during-kill'])(
    'accepts confirmed %s without terminating a replacement', scenario => {
      const result = powershell(harness + `
        $script:scenario = '${scenario}'
        $receipt = Complete-ZipRuntimeCleanup @(123)
        if (-not $receipt.processCleanupConfirmed -or -not $receipt.temporaryFilesRemoved -or $receipt.failures.Count) { throw 'confirmed exit rejected' }
        if ($script:pidStops.Count -or $script:alive -or $script:removed.Count -ne 2) { throw 'unsafe exit handling' }
        if ($script:opens -ne $script:disposes) { throw 'process handle leaked' }`);
      expect(result.status, result.stdout + result.stderr).toBe(0);
    },
  );

  it.each(['wait-timeout', 'surviving-peer'])(
    'fails and preserves both roots for %s', scenario => {
      const result = powershell(harness + `
        $script:scenario = '${scenario}'
        $receipt = Complete-ZipRuntimeCleanup @(123)
        if ($receipt.processCleanupConfirmed -or $receipt.temporaryFilesRemoved -or -not $receipt.failures.Count) { throw 'surviving process accepted' }
        if (-not $script:alive -or $script:removed.Count -or $script:pidStops.Count) { throw 'surviving process evidence changed' }
        if ($script:opens -ne $script:disposes) { throw 'process handle leaked' }`);
      expect(result.status, result.stdout + result.stderr).toBe(0);
    },
  );

  it.each(['candidate', 'peer'])('closes a valid %s through one handle and removes only the two owned roots', phase => {
    const result = powershell(harness + `
      $script:scenario = 'valid'
      if ('${phase}' -eq 'peer') { $script:zipRuntimeIdentities = @{} }
      $receipt = Complete-ZipRuntimeCleanup $(if ('${phase}' -eq 'candidate') { @(123,123) } else { @() })
      if (-not $receipt.processCleanupConfirmed -or -not $receipt.temporaryFilesRemoved -or $receipt.failures.Count) { throw 'valid process cleanup rejected' }
      if ($script:kills.Count -ne 1 -or $script:opens -ne 1 -or $script:disposes -ne 1 -or $script:pidStops.Count -or $script:alive) { throw 'handle cleanup contract lost' }
      if ($script:removed.Count -ne 2 -or $script:removed[0] -ne $safeExtractRoot -or $script:removed[1] -ne $safeUserDataRoot) { throw 'foreign directory removed' }`);
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });

  it('retains an earlier cleanup failure even when the process subsequently exits', () => {
    const result = powershell(harness + `
      $script:scenario = 'missing-path'
      try { Stop-VerifiedRuntime -ProcessIds @(123) -ExpectedExecutableRoot $safeExtractRoot } catch {}
      $script:alive = $false
      $receipt = Complete-ZipRuntimeCleanup @(123)
      if ($receipt.processCleanupConfirmed -or $receipt.temporaryFilesRemoved -or $receipt.failures.Count -ne 1 -or $script:removed.Count) { throw 'earlier cleanup uncertainty was erased' }`);
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });

  it.each([1, 2])('rejects a non-unique identity at snapshot %s without termination', snapshotIndex => {
    const result = powershell(harness + `
      $script:scenario = 'valid'
      function Get-ZipRuntimeProcessSnapshot {
        param($ProcessId)
        $script:reads++
        if ($script:reads -eq ${snapshotIndex}) { return @($script:initial,$script:initial) }
        return $script:initial
      }
      $receipt = Complete-ZipRuntimeCleanup @(123)
      if ($receipt.processCleanupConfirmed -or $receipt.temporaryFilesRemoved -or -not $receipt.failures.Count) { throw 'non-unique identity accepted' }
      if ($script:kills.Count -or $script:pidStops.Count -or $script:removed.Count -or $script:opens -ne $script:disposes) { throw 'non-unique identity changed a process or directory' }`);
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });

  it.each(['first-snapshot', 'second-snapshot', 'peer-enumeration'])(
    'fails closed and records a CIM error at %s', stage => {
      const result = powershell(harness + `
        $script:scenario = 'valid'
        function Get-ZipRuntimeProcessSnapshot {
          param($ProcessId)
          $script:reads++
          if (('${stage}' -eq 'first-snapshot' -and $script:reads -eq 1) -or
            ('${stage}' -eq 'second-snapshot' -and $script:reads -eq 2)) { throw 'CIM identity query failed' }
          return $script:initial
        }
        if ('${stage}' -eq 'peer-enumeration') { function Get-ZipRuntimeProcesses { throw 'CIM peer query failed' } }
        $receipt = Complete-ZipRuntimeCleanup $(if ('${stage}' -eq 'peer-enumeration') { @() } else { @(123) })
        if ($receipt.processCleanupConfirmed -or $receipt.temporaryFilesRemoved -or -not $receipt.failures.Count) { throw 'CIM failure accepted' }
        if ($script:kills.Count -or $script:pidStops.Count -or $script:removed.Count -or $script:opens -ne $script:disposes) { throw 'CIM failure changed a process or directory' }`);
      expect(result.status, result.stdout + result.stderr).toBe(0);
      expect(result.stderr).toContain('package.folder_zip_cleanup_failed');
    },
  );

  it('records a stopping dependency failure before its inner guard and preserves both roots', () => {
    const result = powershell(harness + `
      $script:scenario = 'valid'
      function Stop-VerifiedRuntime { param($ProcessIds,$ExpectedExecutableRoot) throw 'stop dependency failed before its inner guard' }
      $receipt = Complete-ZipRuntimeCleanup @(123)
      if ($receipt.processCleanupConfirmed -or $receipt.temporaryFilesRemoved -or $receipt.failures.Count -ne 1) { throw 'unrecorded stop failure accepted' }
      if ($script:removed.Count -or $script:kills.Count -or $script:pidStops.Count) { throw 'unconfirmed cleanup changed evidence' }`);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stderr).toContain('package.folder_zip_cleanup_failed');
  });

  it('retains the original main failure and the cleanup error in the actual finally report', () => {
    const result = powershell(harness + `
      $script:scenario = 'missing-path'
      $launch = [pscustomobject]@{Id=123}; $marker = [pscustomobject]@{pid=123}
      $stoppedProcessIds = @(); $passed = $false; $failure = 'original-main-error'
      $result = [ordered]@{passed=$false;error=$failure}
      $evidencePath='not-written.json'
      $previousEvidenceMode=$env:AMAZON_AI_OPS_EVIDENCE_MODE; $previousUserDataDir=$env:AMAZON_AI_OPS_USER_DATA_DIR
      $previousElectronLogging=$env:ELECTRON_ENABLE_LOGGING
      function Set-Content { param($LiteralPath,$Value,$Encoding) $script:savedJson=$Value }
      $outer = @($ast.EndBlock.Statements | Where-Object {$_ -is [Management.Automation.Language.TryStatementAst] -and $_.Finally})[-1]
      $block=$outer.Finally.Extent.Text
      Invoke-Expression $block.Substring(1,$block.Length-2)
      $saved = $script:savedJson | ConvertFrom-Json
      if ($saved.passed -or $saved.error -ne 'original-main-error' -or $saved.cleanupFailures.Count -ne 1 -or $saved.temporaryFilesRemoved -or $saved.processCleanupConfirmed) { throw 'main or cleanup original was lost' }
      if ($script:removed.Count -or $script:kills.Count -or $script:pidStops.Count) { throw 'failed cleanup changed evidence' }
      'both failures retained'`);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain('both failures retained');
    const records = result.stderr.trim().split(/\r?\n/).map(line => JSON.parse(line));
    expect(records).toHaveLength(1);
    expect(records[0].level).toBe('error');
    expect(records[0].event).toBe('package.folder_zip_cleanup_failed');
    expect(Number.isFinite(Date.parse(records[0].timestamp))).toBe(true);
    expect(records[0].context.message).toBeTruthy();
  });

  it('has no PID termination fallback and preserves the existing wrapper and size boundary', () => {
    expect(source).not.toContain('Stop-Process');
    expect(source).toContain('$boundHandle = $handle.Handle');
    expect(source).toContain('$boundHandle -eq [IntPtr]::Zero');
    expect(source).toContain('$handle.Kill()');
    expect(source).toContain('$handle.WaitForExit(10000)');
    expect(source).toContain('$handle.Dispose()');
    expect(source).toContain("$runtimeWorkPackageArgs = @('--acceptance-work-package', $AcceptanceWorkPackagePath)");
    expect(source.split(/\r?\n/).length).toBeLessThan(1000);
  });
});

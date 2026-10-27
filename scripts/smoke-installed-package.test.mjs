import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
const systemPowerShell = path.join(process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

const scriptPath = path.resolve('scripts/smoke-installed-package.ps1');
const source = fs.readFileSync(scriptPath, 'utf8');
const powershell = (command) => spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', command], {
  encoding: 'utf8', timeout: 20000, windowsHide: true,
});

describe('isolated installed package smoke contract', () => {
  it('parses the PowerShell source without running installation', () => {
    const result = powershell(`$errors = $null; $tokens = $null
      $null = [Management.Automation.Language.Parser]::ParseFile('${scriptPath.replaceAll("'", "''")}', [ref]$tokens, [ref]$errors)
      if ($errors.Count) { $errors | ConvertTo-Json; exit 1 }`);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(fs.readFileSync(scriptPath).subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    const systemParse = spawnSync(systemPowerShell, ['-NoProfile', '-NonInteractive', '-Command', `$errors = $null; $tokens = $null
      $null = [Management.Automation.Language.Parser]::ParseFile('${scriptPath.replaceAll("'", "''")}', [ref]$tokens, [ref]$errors)
      if ($errors.Count) { $errors | ConvertTo-Json; exit 1 }`], { encoding: 'utf8', timeout: 20000 });
    expect(systemParse.status, systemParse.stdout + systemParse.stderr).toBe(0);
    // 仅执行参数与路径解析前缀，避免触发安装、注册表或应用。
    const boundary = '$InstallerPath = [IO.Path]::GetFullPath($InstallerPath)';
    expect(source.split(boundary)).toHaveLength(2);
    const probeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-wrapper-default-'));
    const probePath = path.join(probeRoot, 'defaults.ps1');
    const explicitRoot = path.join(probeRoot, 'explicit-root');
    const quoted = value => value.replaceAll("'", "''");
    fs.writeFileSync(probePath, source.slice(0, source.indexOf(boundary)) +
      '[ordered]@{ repoRoot=$repoRoot; runId=$RunId; workPackage=$AcceptanceWorkPackagePath } | ConvertTo-Json -Compress');
    let probePassed = false;
    try {
      const command = `$ErrorActionPreference = 'Stop'
        $default = & '${quoted(probePath)}' -InstallerPath 'not-executed.exe' -RunId '123'
        $explicit = & '${quoted(probePath)}' -InstallerPath 'not-executed.exe' -RunId '123' -RepoRoot '${quoted(explicitRoot)}'
        $emptyRejected = $false
        try { $null = & '${quoted(probePath)}' -InstallerPath 'not-executed.exe' -RepoRoot '' } catch { $emptyRejected = $true }
        [ordered]@{ default=($default | ConvertFrom-Json); explicit=($explicit | ConvertFrom-Json); emptyRejected=$emptyRejected } | ConvertTo-Json -Compress`;
      for (const host of [systemPowerShell, 'pwsh']) {
        const evaluated = spawnSync(host, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { encoding: 'utf8', timeout: 20000 });
        expect(evaluated.status, evaluated.stdout + evaluated.stderr).toBe(0);
        const values = JSON.parse(evaluated.stdout.trim());
        expect(values.default).toEqual({ repoRoot: path.resolve(probeRoot, '..'), runId: '123', workPackage: '' });
        expect(values.explicit).toEqual({ repoRoot: explicitRoot, runId: '123', workPackage: '' });
        expect(values.emptyRejected).toBe(true);
      }
      probePassed = true;
    } finally {
      // 失败时保留自有只读探针，便于定位宿主差异。
      if (probePassed) { fs.unlinkSync(probePath); fs.rmdirSync(probeRoot); }
    }

  });

  it('admits only a clean host across both registry hives and views', () => {
    expect(source).toContain("@('CurrentUser', 'LocalMachine')");
    expect(source).toContain("@('Registry32', 'Registry64')");
    expect(source).toContain('@($installKey, $uninstallKey)');
    expect(source).toContain('dd323244-58b0-5c8a-a8ba-19643663c7d9');
    expect(source).toContain("Win32_Process -Filter \"Name='AmazonAIOpsAgent.exe'\"");
    expect(source).toContain('@($state.shortcuts | Where-Object exists).Count -ne 0');
    expect(source).toContain('$state.updaterCache.exists');
    expect(source.match(/\$report\.hostAdmission = Assert-CleanHost/g)).toHaveLength(2);
  });

  it('uses shared path admission and places an unquoted no-space /D argument last', () => {
    expect(source).toContain('& node $evidencePathHelper resolve $repoRoot $RunId');
    expect(source).toContain('& node $evidencePathHelper assert $Path $ExpectedPath');
    expect(source).toContain("$installRoot -match '\\s'");
    expect(source).toContain("@('/S', '--no-desktop-shortcut', \"/D=$installRoot\")");
    expect(source).toContain('-WindowStyle Hidden -PassThru');
    expect(source).not.toContain('--force-run');
    expect(source).not.toMatch(/D:\\Temp|cmd(?:\.exe)?\s+\/c/i);
  });

  it('uses actual packaged UI verification and binds its report to the current installed EXE', () => {
    expect(source).toContain("'verify-isolated-desktop-runtime.mjs') --app-executable $appPath --delivery-kind installed");
    for (const field of ['target.deliveryKind', 'target.executablePath', 'target.executableSha256']) {
      expect(source).toContain(`$runtimeReport.${field}`);
    }
    expect(source).toContain('$runtimeReport.formalAppReadiness');
    expect(source).toContain('$runtimeReport.realStoreEvidence');
    expect(source).toContain('formalAppReadiness = $false; realStoreEvidence = $false');
    expect(source).toContain('$nativeCliErrorActionPreference = $ErrorActionPreference');
    expect(source).toContain("$ErrorActionPreference = 'Continue'");
    expect(source).toContain('$ErrorActionPreference = $nativeCliErrorActionPreference');
    expect(source).toContain('$runtimeExitCode = $LASTEXITCODE');
    expect(source).toContain('$runtimeExitCode -ne 0');
    expect(source).toContain('Get-Content -Raw -LiteralPath $finished[0].reportPath -Encoding UTF8 | ConvertFrom-Json');
  });

  it('exercises installation ownership admission with safe in-memory mocks', () => {
    const result = powershell(`$ErrorActionPreference = 'Stop'
      $errors = $null; $tokens = $null
      $ast = [Management.Automation.Language.Parser]::ParseFile('${scriptPath.replaceAll("'", "''")}', [ref]$tokens, [ref]$errors)
      foreach ($name in @('Assert-OwnedRegistryEntries', 'Assert-OwnedInstallation')) {
        $definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
        Invoke-Expression $definition.Extent.Text
      }
      $installRoot = 'G:\\Temp\\amazon-ai-ops-installed-smoke-123'
      $appPath = Join-Path $installRoot 'AmazonAIOpsAgent.exe'
      $uninstallerPath = Join-Path $installRoot 'Uninstall AmazonAIOpsAgent.exe'
      $installKey = 'Software\\test'; $uninstallKey = 'Software\\Uninstall\\test'
      $report = @{ paths = @{ installRoot = $installRoot }; currentExe = @{ sha256 = 'CURRENT' } }
      function Assert-SafeTempPath { param($Path, $ExpectedPath) return $Path }
      function Test-Path { param($LiteralPath, $PathType) return $true }
      function Get-Hash { param($Path) return $script:mockHash }
      function Get-Item { param($LiteralPath) return @{ Attributes = $script:mockAttributes } }
      function Get-RegistrySnapshot { return $script:mockRegistry }
      $scenarios = @('valid', 'foreign-hive', 'wrong-location', 'wrong-uninstaller', 'missing-registration', 'wrong-hash', 'linked-exe')
      foreach ($scenario in $scenarios) {
        $script:mockHash = 'CURRENT'; $script:mockAttributes = 0
        $location = [pscustomobject]@{ exists = $true; hive = 'CurrentUser'; key = $installKey; installLocation = $installRoot; uninstallString = '' }
        $uninstall = [pscustomobject]@{ exists = $true; hive = 'CurrentUser'; key = $uninstallKey; installLocation = ''; uninstallString = ('"{0}" /currentuser' -f $uninstallerPath) }
        $script:mockRegistry = @($location, $uninstall)
        switch ($scenario) {
          'foreign-hive' { $location.hive = 'LocalMachine' }
          'wrong-location' { $location.installLocation = 'G:\\Temp\\amazon-ai-ops-another-run' }
          'wrong-uninstaller' { $uninstall.uninstallString = 'another.exe /currentuser' }
          'missing-registration' { $script:mockRegistry = @($location) }
          'wrong-hash' { $script:mockHash = 'OTHER' }
          'linked-exe' { $script:mockAttributes = [IO.FileAttributes]::ReparsePoint }
        }
        $rejected = $false
        $rejectionMessage = ''
        try { $null = Assert-OwnedInstallation } catch { $rejected = $true; $rejectionMessage = $_.Exception.Message }
        if (($scenario -eq 'valid') -eq $rejected) { throw ('unexpected ownership admission: ' + $scenario + ': ' + $rejectionMessage) }
      }
      'ownership scenarios passed'`);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain('ownership scenarios passed');
  });

  it('performs a real guarded uninstall without deleting application data or installation folders', () => {
    const cleanup = source.slice(source.indexOf('} finally {\n  if ($installationAttempted'));
    expect(cleanup.indexOf('Assert-OwnedInstallation')).toBeLessThan(cleanup.indexOf('Invoke-InstallerProcess'));
    expect(cleanup.indexOf('Stop-OwnedApplication')).toBeLessThan(cleanup.indexOf('Invoke-InstallerProcess'));
    expect(cleanup.indexOf('Assert-UninstallerIdentity')).toBeLessThan(cleanup.indexOf('Invoke-InstallerProcess'));
    expect(cleanup).not.toMatch(/initialUninstallerSha256\s*=|uninstallerSha256\s*=/);
    expect(cleanup).toContain("Invoke-InstallerProcess $uninstallerPath @('/S', '--updated') 'uninstall'");
    expect(cleanup).toContain('Wait-ForInstallationRestoration');
    expect(source).toContain('realUninstallerRemovedInstallation = -not $snapshot.installationExists');
    expect(source).toContain('registry = @(Get-RegistrySnapshot)');
    expect(source).not.toMatch(/--delete-app-data|\/KEEP_APP_DATA|-Recurse\s+-Force|Remove-Item[^\r\n]*\$installRoot/);
    expect(source).toContain('if ($activeHelper -and -not $activeHelper.HasExited)');
  });

  it.each(['directory-first', 'foreign-registry', 'foreign-shortcut', 'timeout'])(
    'waits for complete restoration and fails closed for %s using only memory snapshots', (scenario) => {
      const result = powershell(`$ErrorActionPreference = 'Stop'; Set-StrictMode -Version Latest
        $errors = $null; $tokens = $null
        $ast = [Management.Automation.Language.Parser]::ParseFile('${scriptPath.replaceAll("'", "''")}', [ref]$tokens, [ref]$errors)
        foreach ($name in @('Assert-OwnedRegistryEntries', 'Assert-OwnedShortcutEntries', 'Wait-ForInstallationRestoration')) {
          $definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
          Invoke-Expression $definition.Extent.Text
        }
        $installRoot = 'G:\\Temp\\amazon-ai-ops-installed-smoke-123'
        $appPath = Join-Path $installRoot 'AmazonAIOpsAgent.exe'
        $uninstallerPath = Join-Path $installRoot 'Uninstall AmazonAIOpsAgent.exe'
        $installKey = 'Software\\test'; $uninstallKey = 'Software\\Uninstall\\test'
        $shortcuts = @('G:\\mock-start-menu\\AmazonAIOpsAgent.lnk')
        $report = [ordered]@{ checks = [ordered]@{}; paths = @{ installRoot = $installRoot } }
        $script:observations = 0; $script:sleeps = 0
        function Write-Event { param($Name, $Context) }
        function Assert-SafeTempPath { param($Path, $ExpectedPath) return $Path }
        function Start-Sleep { param($Milliseconds) $script:sleeps++ }
        function Get-RestorationSnapshot {
          $script:observations++
          $pending = '${scenario}' -ne 'directory-first' -or $script:observations -lt 3
          $registry = @()
          foreach ($hive in @('CurrentUser', 'LocalMachine')) {
            foreach ($view in @('Registry32', 'Registry64')) {
              foreach ($key in @($installKey, $uninstallKey)) {
                $registry += [pscustomobject]@{
                  hive = $hive; view = $view; key = $key; exists = ($pending -and $hive -eq 'CurrentUser')
                  installLocation = $(if ($key -eq $installKey) { $installRoot } else { '' })
                  uninstallString = $(if ($key -eq $uninstallKey) { ('"{0}" /currentuser' -f $uninstallerPath) } else { '' })
                }
              }
            }
          }
          if ('${scenario}' -eq 'foreign-registry') { $registry[0].installLocation = 'G:\\existing-installation' }
          $shortcutTarget = $(if ('${scenario}' -eq 'foreign-shortcut') { 'G:\\existing-installation\\AmazonAIOpsAgent.exe' } else { $appPath })
          return [ordered]@{
            installationExists = $false; registry = $registry; processes = @()
            shortcuts = @([pscustomobject]@{ path = $shortcuts[0]; exists = $pending; targetPath = $shortcutTarget; reparsePoint = $false })
          }
        }
        $rejected = $false; $message = ''
        try { Wait-ForInstallationRestoration -TimeoutMilliseconds $(if ('${scenario}' -eq 'timeout') { 0 } else { 60000 }) }
        catch { $rejected = $true; $message = $_.Exception.Message }
        if ('${scenario}' -eq 'directory-first') {
          if ($rejected -or $script:observations -ne 3 -or $script:sleeps -ne 2) { throw ('late restoration failed: ' + $message) }
          foreach ($name in @('realUninstallerRemovedInstallation', 'registryRestored', 'shortcutsRestored', 'noApplicationProcesses')) {
            if (-not $report.checks[$name]) { throw ('missing restoration gate: ' + $name) }
          }
          if ($report.restoration.finalSnapshot.registry.Count -ne 8) { throw 'registry snapshot coverage lost' }
        } else {
          if (-not $rejected -or $script:observations -ne 1 -or $script:sleeps -ne 0) { throw 'failure did not stop immediately or retained no snapshot' }
          if ('${scenario}' -eq 'timeout' -and $message -notmatch '超时') { throw $message }
          if ('${scenario}' -eq 'foreign-registry' -and $message -notmatch 'InstallLocation') { throw $message }
          if ('${scenario}' -eq 'foreign-shortcut' -and $message -notmatch '快捷方式') { throw $message }
        }
        if ($report.restoration.observations -ne $script:observations) { throw 'observation count was not retained' }
        if (-not $report.restoration.finalSnapshot) { throw 'final snapshot missing' }`);
      expect(result.status, result.stdout + result.stderr).toBe(0);
    },
  );

  it('records level in the shared JSON protocol and never removes registry or shortcuts itself', () => {
    expect(source).toContain("[string]$Level = 'info'");
    expect(source).toContain('level = $Level; event = $Name; context = $Context');
    expect(source).toContain("Write-Event 'package.installed_smoke_failed' $detail 'error'");
    expect(source).toContain('[ValidateRange(0, 60000)][int]$TimeoutMilliseconds = 60000');
    expect(source).toContain('finalSnapshot = $snapshot');
    expect(source).not.toMatch(/Remove-ItemProperty|Remove-Item[^\r\n]*(?:HKCU|HKLM|shortcut)|DeleteSubKey|\.Save\(/i);
  });

  it('requires the initial uninstaller hash and rejects a changed binary without reseeding it', () => {
    expect(source.indexOf('$report.installedRegistry = @(Assert-OwnedInstallation)')).toBeLessThan(
      source.indexOf('$initialUninstallerSha256 = Get-Hash $uninstallerPath'));
    const result = powershell(`$ErrorActionPreference = 'Stop'
      $errors = $null; $tokens = $null
      $ast = [Management.Automation.Language.Parser]::ParseFile('${scriptPath.replaceAll("'", "''")}', [ref]$tokens, [ref]$errors)
      $definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Assert-UninstallerIdentity' }, $true)
      Invoke-Expression $definition.Extent.Text
      function Get-Hash { param($Path) $script:hashReads++; return $script:mockHash }
      $uninstallerPath = 'G:\\Temp\\amazon-ai-ops-installed-smoke-123\\Uninstall AmazonAIOpsAgent.exe'
      foreach ($scenario in @('valid', 'missing-initial', 'changed')) {
        $initialUninstallerSha256 = 'INITIAL'; $script:mockHash = 'INITIAL'; $script:hashReads = 0
        if ($scenario -eq 'missing-initial') { $initialUninstallerSha256 = $null }
        if ($scenario -eq 'changed') { $script:mockHash = 'CHANGED' }
        $rejected = $false
        try { Assert-UninstallerIdentity } catch { $rejected = $true }
        if (($scenario -eq 'valid') -eq $rejected) { throw ('unexpected hash admission: ' + $scenario) }
        if ($scenario -eq 'missing-initial' -and $script:hashReads -ne 0) { throw 'missing identity must not read a replacement baseline' }
        if ($scenario -eq 'changed' -and $initialUninstallerSha256 -ne 'INITIAL') { throw 'initial identity changed' }
      }`);
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });

  it('tolerates vanished children while rejecting reused PIDs, changed paths, and surviving peers', () => {
    const result = powershell(`$ErrorActionPreference = 'Stop'
      $errors = $null; $tokens = $null
      $ast = [Management.Automation.Language.Parser]::ParseFile('${scriptPath.replaceAll("'", "''")}', [ref]$tokens, [ref]$errors)
      foreach ($name in @('Assert-SameOwnedProcess', 'Stop-OwnedApplication')) {
        $definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
        Invoke-Expression $definition.Extent.Text
      }
      $appPath = 'G:\\Temp\\amazon-ai-ops-installed-smoke-123\\AmazonAIOpsAgent.exe'
      function Write-Event { param($Name, $Context) }
      function Get-AppProcesses {
        $script:listReads++
        if ($script:listReads -eq 1 -or $script:scenario -eq 'surviving-peer') { return $script:initial }
        return @()
      }
      function Get-LiveProcessSnapshot {
        param($ProcessId)
        $script:liveReads++
        if ($script:scenario -eq 'vanished-child') { return @() }
        $creation = $script:initial.CreationDate; $executable = $appPath
        if ($script:scenario -eq 'reused-pid' -and $script:liveReads -ge 2) { $creation = $creation.AddSeconds(1) }
        if ($script:scenario -eq 'changed-path') { $executable = 'G:\\Temp\\another.exe' }
        if ($script:scenario -eq 'exit-during-stop' -and $script:liveReads -ge 3) { return @() }
        return [pscustomobject]@{ ProcessId = $ProcessId; Name = 'AmazonAIOpsAgent.exe'; ExecutablePath = $executable; CreationDate = $creation }
      }
      function Get-Process {
        param($Id, $ErrorAction)
        $handle = [pscustomobject]@{ Handle = 1 }
        $handle | Add-Member ScriptMethod Kill {
          if ($script:scenario -eq 'exit-during-stop') { throw 'already exited' }
          $script:kills++
        }
        $handle | Add-Member ScriptMethod WaitForExit { param($Timeout) return $true }
        $handle | Add-Member ScriptMethod Dispose { }
        return $handle
      }
      foreach ($script:scenario in @('valid', 'vanished-child', 'exit-during-stop', 'reused-pid', 'changed-path', 'surviving-peer')) {
        $script:listReads = 0; $script:liveReads = 0; $script:kills = 0
        $script:initial = [pscustomobject]@{ ProcessId = 123; ExecutablePath = $appPath; CreationDate = [DateTime]::UtcNow }
        $rejected = $false; $message = ''
        try { Stop-OwnedApplication } catch { $rejected = $true; $message = $_.Exception.Message }
        $shouldReject = $script:scenario -in @('reused-pid', 'changed-path', 'surviving-peer')
        if ($rejected -ne $shouldReject) { throw ('unexpected process cleanup: ' + $script:scenario + ': ' + $message) }
        if ($script:scenario -in @('reused-pid', 'changed-path', 'vanished-child') -and $script:kills -ne 0) { throw 'unsafe process stop attempted' }
      }`);
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });

  it('removes only a newly created exact installer cache with matching SHA-256', () => {
    expect(source).toContain('$item.FullName -ne $expectedCache');
    expect(source).toContain('$report.hostAdmission.updaterCache.exists');
    expect(source).toContain('(Get-Hash $item.FullName) -ne $report.installer.sha256');
    expect(source).toContain('Remove-Item -LiteralPath $item.FullName -Force');
    expect(source).toContain('@(Get-ChildItem -LiteralPath $parent.FullName -Force).Count -eq 0');
    expect(source).toContain('Remove-Item -LiteralPath $parent.FullName');
  });

  it('protects canonical data, retains failure evidence, and restores evidence environment variables', () => {
    expect(source).toContain('$report.canonicalBefore = Get-CanonicalSnapshot');
    expect(source).toContain('$report.canonicalAfter = Get-CanonicalSnapshot');
    expect(source).toContain('Get-Hash $entry.FullName');
    expect(source).toContain("Record-Failure 'uninstall-and-restoration' $_");
    expect(source).toContain("[Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process')");
    expect(source).toContain('if ($outputCreated) { $report | ConvertTo-Json');
    expect(source).toContain('if (-not $report.passed) { exit 1 }');
    expect(source.split(/\r?\n/).length).toBeLessThan(1000);
  });
});

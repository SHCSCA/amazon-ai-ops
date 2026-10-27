param(
  [Parameter(Mandatory = $true)][string]$InstallerPath,
  [string]$RepoRoot = '',
  [ValidatePattern('^[0-9]+$')][string]$RunId = ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds().ToString()),
  [string]$AcceptanceWorkPackagePath = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
# 高级参数默认值在 Windows PowerShell 5 中尚无脚本路径，进入正文后再解析。
if (-not $PSBoundParameters.ContainsKey('RepoRoot')) {
  $RepoRoot = Join-Path $PSScriptRoot '..'
}
$repoRoot = [IO.Path]::GetFullPath($RepoRoot)
$InstallerPath = [IO.Path]::GetFullPath($InstallerPath)
$runtimeWorkPackageArgs = @()
if (-not [string]::IsNullOrWhiteSpace($AcceptanceWorkPackagePath)) {
  # 仅透传显式原件；复制与无链接检查由统一隔离 runner 执行。
  $AcceptanceWorkPackagePath = [IO.Path]::GetFullPath($AcceptanceWorkPackagePath)
  if (-not (Test-Path -LiteralPath (Join-Path $AcceptanceWorkPackagePath 'manifest.json') -PathType Leaf)) { throw '验收工作包缺少 manifest.json。' }
  $runtimeWorkPackageArgs = @('--acceptance-work-package', $AcceptanceWorkPackagePath)
}
$evidencePathHelper = Join-Path $PSScriptRoot 'package-evidence-paths.js'
$outputRoot = Join-Path $repoRoot "output\codex-evidence\installed-package-smoke-$RunId"
$reportPath = Join-Path $outputRoot 'report.json'
$guid = 'dd323244-58b0-5c8a-a8ba-19643663c7d9'
$installKey = "Software\$guid"
$uninstallKey = "Software\Microsoft\Windows\CurrentVersion\Uninstall\$guid"
$canonicalRoot = Join-Path $env:APPDATA '@amazon-ai-ops\desktop'
$cachePath = Join-Path $env:LOCALAPPDATA '@amazon-ai-opsdesktop-updater\installer.exe'
$shortcuts = @(
  (Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'AmazonAIOpsAgent.lnk'),
  (Join-Path ([Environment]::GetFolderPath('CommonDesktopDirectory')) 'AmazonAIOpsAgent.lnk'),
  (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs\AmazonAIOpsAgent.lnk'),
  (Join-Path ([Environment]::GetFolderPath('CommonStartMenu')) 'Programs\AmazonAIOpsAgent.lnk')
)
$report = [ordered]@{
  kind = 'installed-package-smoke'; schemaVersion = 1; runId = $RunId
  generatedAt = [DateTime]::UtcNow.ToString('o'); passed = $false
  formalAppReadiness = $false; realStoreEvidence = $false
  checks = [ordered]@{}; failures = @(); events = @()
}
$installationAttempted = $false
$installedVerified = $false
$outputCreated = $false
$activeHelper = $null
$originalEnvironment = @{}
$installRoot = $null
$appPath = $null
$uninstallerPath = $null
$initialUninstallerSha256 = $null

function Write-Event([string]$Name, [object]$Context, [string]$Level = 'info') {
  $record = [ordered]@{ timestamp = [DateTime]::UtcNow.ToString('o'); level = $Level; event = $Name; context = $Context }
  $report.events += $record
  [Console]::Out.WriteLine(($record | ConvertTo-Json -Depth 8 -Compress))
}

function Record-Failure([string]$Stage, [object]$Failure) {
  $detail = [ordered]@{ stage = $Stage; message = [string]$Failure.Exception.Message; stack = [string]$Failure.ScriptStackTrace }
  $report.failures += $detail
  Write-Event 'package.installed_smoke_failed' $detail 'error'
}

function Assert-SafeTempPath([string]$Path, [string]$ExpectedPath) {
  $validated = & node $evidencePathHelper assert $Path $ExpectedPath
  if ($LASTEXITCODE -ne 0) { throw "隔离目录校验失败：$Path" }
  return (($validated -join "`n") | ConvertFrom-Json)
}

function Get-Hash([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
}

function Get-RegistrySnapshot {
  $entries = @()
  foreach ($hive in @('CurrentUser', 'LocalMachine')) {
    foreach ($view in @('Registry32', 'Registry64')) {
      $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey(
        [Microsoft.Win32.RegistryHive]::$hive, [Microsoft.Win32.RegistryView]::$view)
      try {
        foreach ($keyName in @($installKey, $uninstallKey)) {
          $key = $base.OpenSubKey($keyName, $false)
          try {
            $entries += [pscustomobject]@{
              hive = $hive; view = $view; key = $keyName; exists = ($null -ne $key)
              installLocation = $(if ($key) { [string]$key.GetValue('InstallLocation', '') } else { '' })
              uninstallString = $(if ($key) { [string]$key.GetValue('UninstallString', '') } else { '' })
            }
          } finally { if ($key) { $key.Dispose() } }
        }
      } finally { $base.Dispose() }
    }
  }
  return $entries
}

function Get-AppProcesses {
  return @(Get-CimInstance -ClassName Win32_Process -Filter "Name='AmazonAIOpsAgent.exe'" |
    Select-Object ProcessId, ExecutablePath, CreationDate)
}

function Get-CanonicalSnapshot {
  $entries = @()
  if (Test-Path -LiteralPath $canonicalRoot) {
    $root = Get-Item -LiteralPath $canonicalRoot
    if (-not $root.PSIsContainer -or ($root.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
      throw '正式 userData 目录类型异常，停止验收。'
    }
    foreach ($entry in (Get-ChildItem -LiteralPath $canonicalRoot -Force -Recurse | Sort-Object FullName)) {
      if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw '正式 userData 含链接，无法可靠建立保护快照。' }
      $entries += [ordered]@{
        relativePath = $entry.FullName.Substring($canonicalRoot.Length)
        directory = [bool]$entry.PSIsContainer
        sha256 = $(if ($entry.PSIsContainer) { $null } else { Get-Hash $entry.FullName })
      }
    }
  }
  return [ordered]@{ path = $canonicalRoot; exists = (Test-Path -LiteralPath $canonicalRoot); entries = @($entries) }
}

function Assert-CleanHost {
  $state = [ordered]@{
    registry = @(Get-RegistrySnapshot); processes = @(Get-AppProcesses)
    shortcuts = @($shortcuts | ForEach-Object { [pscustomobject]@{ path = $_; exists = (Test-Path -LiteralPath $_) } })
    updaterCache = [ordered]@{ path = $cachePath; exists = (Test-Path -LiteralPath $cachePath) }
  }
  if (@($state.registry | Where-Object exists).Count -ne 0 -or $state.processes.Count -ne 0 -or
    @($state.shortcuts | Where-Object exists).Count -ne 0 -or $state.updaterCache.exists) {
    $report.hostAdmission = $state
    throw '检测到现有安装、进程、快捷方式或安装器缓存；拒绝覆盖。'
  }
  return $state
}

function Assert-OwnedRegistryEntries([object[]]$Entries) {
  foreach ($entry in @($Entries | Where-Object exists)) {
    if ($entry.key -notin @($installKey, $uninstallKey)) { throw '出现未知安装注册项，保留现场。' }
    if ($entry.hive -ne 'CurrentUser') { throw '发现非本次用户级安装注册，拒绝执行卸载。' }
    if ($entry.key -eq $installKey -or $entry.installLocation) {
      if ([IO.Path]::GetFullPath($entry.installLocation).TrimEnd('\') -ne $installRoot.TrimEnd('\')) {
        throw '注册的 InstallLocation 不属于本次隔离目录。'
      }
    }
    if ($entry.key -eq $uninstallKey -and $entry.uninstallString -ne ('"{0}" /currentuser' -f $uninstallerPath)) {
      throw '卸载注册未精确指向本次卸载程序。'
    }
  }
}

function Assert-OwnedInstallation {
  $null = Assert-SafeTempPath $installRoot $report.paths.installRoot
  $entries = @(Get-RegistrySnapshot | Where-Object exists)
  $locations = @($entries | Where-Object { $_.key -eq $installKey })
  $uninstallers = @($entries | Where-Object { $_.key -eq $uninstallKey })
  if ($locations.Count -eq 0 -or $uninstallers.Count -eq 0) { throw '本次安装注册不完整，拒绝执行卸载。' }
  Assert-OwnedRegistryEntries $entries
  if (-not (Test-Path -LiteralPath $appPath -PathType Leaf) -or
    (Get-Hash $appPath) -ne $report.currentExe.sha256 -or
    -not (Test-Path -LiteralPath $uninstallerPath -PathType Leaf)) {
    throw '本次安装 EXE 或卸载程序身份不符。'
  }
  foreach ($filePath in @($appPath, $uninstallerPath)) {
    if ((Get-Item -LiteralPath $filePath).Attributes -band [IO.FileAttributes]::ReparsePoint) {
      throw '安装 EXE 和卸载程序不允许是链接。'
    }
  }
  return $entries
}

function Get-ShortcutSnapshot {
  $entries = @()
  $shell = New-Object -ComObject WScript.Shell
  try {
    foreach ($shortcut in $shortcuts) {
      $entry = [ordered]@{ path = $shortcut; exists = $false; targetPath = $null; reparsePoint = $false }
      if (Test-Path -LiteralPath $shortcut) {
        try {
          $entry.reparsePoint = [bool]((Get-Item -LiteralPath $shortcut).Attributes -band [IO.FileAttributes]::ReparsePoint)
          $link = $shell.CreateShortcut($shortcut)
          try { $entry.targetPath = [string]$link.TargetPath }
          finally { $null = [Runtime.InteropServices.Marshal]::FinalReleaseComObject($link) }
          $entry.exists = Test-Path -LiteralPath $shortcut
        } catch {
          # 卸载器可在两次读取之间撤销快捷方式；只允许已消失的文件继续。
          if (Test-Path -LiteralPath $shortcut) { throw }
        }
      }
      $entries += [pscustomobject]$entry
    }
  } finally { $null = [Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell) }
  return $entries
}

function Assert-OwnedShortcutEntries([object[]]$Entries) {
  foreach ($entry in @($Entries | Where-Object exists)) {
    if ($entry.path -notin $shortcuts -or $entry.reparsePoint -or -not $entry.targetPath -or
      [IO.Path]::GetFullPath($entry.targetPath) -ne $appPath) {
      throw '快捷方式不属于本次隔离安装，保留现场。'
    }
  }
}

function Assert-OwnedShortcuts {
  Assert-OwnedShortcutEntries @(Get-ShortcutSnapshot)
}

function Get-RestorationSnapshot {
  return [ordered]@{
    observedAt = [DateTime]::UtcNow.ToString('o')
    installationExists = (Test-Path -LiteralPath $installRoot)
    registry = @(Get-RegistrySnapshot)
    shortcuts = @(Get-ShortcutSnapshot)
    processes = @(Get-AppProcesses)
  }
}

function Wait-ForInstallationRestoration(
  [ValidateRange(0, 60000)][int]$TimeoutMilliseconds = 60000,
  [ValidateRange(1, 60000)][int]$PollMilliseconds = 500
) {
  $timer = [Diagnostics.Stopwatch]::StartNew()
  $observations = 0
  while ($true) {
    $snapshot = Get-RestorationSnapshot
    $observations++
    $report.restoration = [ordered]@{
      observations = $observations; elapsedMilliseconds = $timer.ElapsedMilliseconds
      timeoutMilliseconds = $TimeoutMilliseconds; finalSnapshot = $snapshot
    }
    $report.registryAfter = $snapshot.registry
    $report.checks.realUninstallerRemovedInstallation = -not $snapshot.installationExists
    $report.checks.registryRestored = @($snapshot.registry | Where-Object exists).Count -eq 0
    $report.checks.shortcutsRestored = @($snapshot.shortcuts | Where-Object exists).Count -eq 0
    $report.checks.noApplicationProcesses = @($snapshot.processes).Count -eq 0
    Write-Event 'package.uninstall_restoration_observed' @{
      observation = $observations; installationExists = $snapshot.installationExists
      remainingRegistry = @($snapshot.registry | Where-Object exists).Count
      remainingShortcuts = @($snapshot.shortcuts | Where-Object exists).Count
      remainingProcesses = @($snapshot.processes).Count
    }
    if ($snapshot.installationExists) { $null = Assert-SafeTempPath $installRoot $report.paths.installRoot }
    Assert-OwnedRegistryEntries $snapshot.registry
    Assert-OwnedShortcutEntries $snapshot.shortcuts
    foreach ($process in @($snapshot.processes)) {
      if (-not $process.ExecutablePath -or [IO.Path]::GetFullPath($process.ExecutablePath) -ne $appPath) {
        throw '卸载期间出现其他安装的同名进程，保留现场。'
      }
    }
    if ($report.checks.realUninstallerRemovedInstallation -and $report.checks.registryRestored -and
      $report.checks.shortcutsRestored -and $report.checks.noApplicationProcesses) { return }
    if ($timer.ElapsedMilliseconds -ge $TimeoutMilliseconds) { throw '卸载后的撤销校验超时，保留现场。' }
    Start-Sleep -Milliseconds ([Math]::Max(0, [Math]::Min($PollMilliseconds, $TimeoutMilliseconds - $timer.ElapsedMilliseconds)))
  }
}

function Assert-UninstallerIdentity {
  if ([string]::IsNullOrWhiteSpace($initialUninstallerSha256)) { throw '未建立初始卸载程序身份，保留现场。' }
  if ((Get-Hash $uninstallerPath) -ne $initialUninstallerSha256) { throw '卸载程序哈希发生变化，保留现场。' }
}

function Get-LiveProcessSnapshot([uint32]$ProcessId) {
  return @(Get-CimInstance -ClassName Win32_Process -Filter "ProcessId=$ProcessId" |
    Select-Object Name, ProcessId, ExecutablePath, CreationDate)
}

function Assert-SameOwnedProcess([object]$Initial, [object]$Current) {
  if (-not $Initial.ExecutablePath -or [IO.Path]::GetFullPath($Initial.ExecutablePath) -ne $appPath -or
    -not $Initial.CreationDate -or $Current.ProcessId -ne $Initial.ProcessId -or
    $Current.Name -ne 'AmazonAIOpsAgent.exe' -or -not $Current.ExecutablePath -or
    [IO.Path]::GetFullPath($Current.ExecutablePath) -ne $appPath -or $Current.CreationDate -ne $Initial.CreationDate) {
    throw [Security.SecurityException]::new('进程身份已变化或不属于本次安装，拒绝停止进程。')
  }
}

function Stop-OwnedApplication {
  foreach ($initial in @(Get-AppProcesses)) {
    $handle = $null
    try {
      $current = @(Get-LiveProcessSnapshot $initial.ProcessId)
      if ($current.Count -eq 0) { continue }
      if ($current.Count -ne 1) { throw '进程 PID 查询结果不唯一。' }
      Assert-SameOwnedProcess $initial $current[0]
      $handle = Get-Process -Id $initial.ProcessId -ErrorAction Stop
      # 先绑定原进程句柄，再复核创建时间；终止时不重新解析可能被复用的 PID。
      $null = $handle.Handle
      $current = @(Get-LiveProcessSnapshot $initial.ProcessId)
      if ($current.Count -eq 0) { continue }
      if ($current.Count -ne 1) { throw '进程 PID 查询结果不唯一。' }
      Assert-SameOwnedProcess $initial $current[0]
      Write-Event 'package.stop_owned_process' @{ pid = $initial.ProcessId; executable = $initial.ExecutablePath }
      $handle.Kill()
      $handle.WaitForExit(10000) | Out-Null
    } catch {
      if ($_.Exception -is [Security.SecurityException]) { throw }
      $remaining = @(Get-LiveProcessSnapshot $initial.ProcessId)
      if ($remaining.Count -eq 0) {
        Write-Event 'package.owned_process_already_exited' @{ pid = $initial.ProcessId }
        continue
      }
      throw
    } finally { if ($handle) { $handle.Dispose() } }
  }
  if (@(Get-AppProcesses).Count -ne 0) { throw '本次应用进程仍未退出。' }
}

function Invoke-InstallerProcess([string]$Executable, [string[]]$Arguments, [string]$Stage) {
  $process = Start-Process -FilePath $Executable -ArgumentList $Arguments -WindowStyle Hidden -PassThru
  $script:activeHelper = $process
  Write-Event "package.$Stage.started" @{ pid = $process.Id; executable = $Executable; arguments = $Arguments }
  if (-not $process.WaitForExit(300000)) { throw "$Stage 超时；保留进程与证据，PID=$($process.Id)" }
  $process.Refresh()
  $script:activeHelper = $null
  $result = [ordered]@{ pid = $process.Id; exitCode = $process.ExitCode }
  $report[$Stage] = $result
  Write-Event "package.$Stage.finished" $result
  if ($process.ExitCode -ne 0) { throw "$Stage 返回非零退出码：$($process.ExitCode)" }
}

function Remove-OwnedInstallerCache {
  if (Test-Path -LiteralPath $cachePath) {
    $expectedCache = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA '@amazon-ai-opsdesktop-updater\installer.exe'))
    $item = Get-Item -LiteralPath $cachePath
    $parent = Get-Item -LiteralPath $item.DirectoryName
    if ($item.FullName -ne $expectedCache -or $item.PSIsContainer -or
      ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
      ($parent.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
      $report.hostAdmission.updaterCache.exists -or (Get-Hash $item.FullName) -ne $report.installer.sha256) {
      throw '缓存身份或所有权无法确认，保留该文件。'
    }
    Remove-Item -LiteralPath $item.FullName -Force
    if (-not $report.cacheParentExisted -and @(Get-ChildItem -LiteralPath $parent.FullName -Force).Count -eq 0) {
      Remove-Item -LiteralPath $parent.FullName
    }
  }
  $report.checks.ownedInstallerCacheRemoved = -not (Test-Path -LiteralPath $cachePath)
}

try {
  if (Test-Path -LiteralPath $outputRoot) { throw '本次报告目录已存在，拒绝复用 runId。' }
  $null = New-Item -ItemType Directory -Path $outputRoot
  $outputCreated = $true
  $pathsJson = & node $evidencePathHelper resolve $repoRoot $RunId
  if ($LASTEXITCODE -ne 0) { throw '无法解析本次隔离目录。' }
  $paths = ($pathsJson -join "`n") | ConvertFrom-Json
  $temporaryRoot = Split-Path -Parent ([string]$paths.folderZipExtractRoot)
  $installRoot = Join-Path $temporaryRoot "amazon-ai-ops-installed-smoke-$RunId"
  $installerUserData = Join-Path $temporaryRoot "amazon-ai-ops-installed-launch-$RunId"
  $report.paths = [ordered]@{ installRoot = $installRoot; installerUserData = $installerUserData; outputRoot = $outputRoot }
  $null = Assert-SafeTempPath $installRoot $installRoot
  $null = Assert-SafeTempPath $installerUserData $installerUserData
  if ($installRoot -match '\s' -or (Test-Path -LiteralPath $installRoot) -or (Test-Path -LiteralPath $installerUserData)) {
    throw '安装隔离目录已存在或含空格，停止验收。'
  }
  $appPath = Join-Path $installRoot 'AmazonAIOpsAgent.exe'
  $uninstallerPath = Join-Path $installRoot 'Uninstall AmazonAIOpsAgent.exe'
  $sourceExe = Join-Path $repoRoot 'apps\desktop\release\win-unpacked\AmazonAIOpsAgent.exe'
  $report.installer = [ordered]@{ path = $InstallerPath; sha256 = (Get-Hash $InstallerPath) }
  $report.currentExe = [ordered]@{ sourcePath = $sourceExe; sha256 = (Get-Hash $sourceExe) }
  $report.canonicalBefore = Get-CanonicalSnapshot
  $report.cacheParentExisted = Test-Path -LiteralPath (Split-Path -Parent $cachePath)
  $report.hostAdmission = Assert-CleanHost
  $null = New-Item -ItemType Directory -Path $installerUserData
  $null = Assert-SafeTempPath $installerUserData $installerUserData
  foreach ($name in @('AMAZON_AI_OPS_EVIDENCE_MODE', 'AMAZON_AI_OPS_USER_DATA_DIR', 'ELECTRON_RUN_AS_NODE')) {
    $originalEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
  }
  $env:AMAZON_AI_OPS_EVIDENCE_MODE = 'package-launch-smoke'
  $env:AMAZON_AI_OPS_USER_DATA_DIR = $installerUserData
  [Environment]::SetEnvironmentVariable('ELECTRON_RUN_AS_NODE', $null, 'Process')
  # 安装器可能停止同名进程并更新旧版本，真正执行前再次确认主机无现有安装。
  $report.hostAdmission = Assert-CleanHost
  $report.checks.cleanHostAdmitted = $true
  $installationAttempted = $true
  Invoke-InstallerProcess $InstallerPath @('/S', '--no-desktop-shortcut', "/D=$installRoot") 'install'
  $report.installedRegistry = @(Assert-OwnedInstallation)
  $initialUninstallerSha256 = Get-Hash $uninstallerPath
  $report.uninstallerSha256 = $initialUninstallerSha256
  Assert-OwnedShortcuts
  $installedVerified = $true
  $report.checks.installedExeMatchesCurrentPackage = $true
  if (@(Get-AppProcesses).Count -ne 0) { throw '静默安装意外启动了应用，停止本次运行验收。' }
  $stdoutPath = Join-Path $outputRoot 'runtime.stdout.log'
  $stderrPath = Join-Path $outputRoot 'runtime.stderr.log'
  # 原生 stderr 保留为日志，返回码与报告继续决定失败，调用后恢复严格模式。
  $nativeCliErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    & node (Join-Path $PSScriptRoot 'verify-isolated-desktop-runtime.mjs') --app-executable $appPath --delivery-kind installed @runtimeWorkPackageArgs 1> $stdoutPath 2> $stderrPath
    $runtimeExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $nativeCliErrorActionPreference
  }
  $finished = @(Get-Content -LiteralPath $stdoutPath | Where-Object { $_.StartsWith('{') } | ForEach-Object {
    $value = $_ | ConvertFrom-Json
    if ($value.event -eq 'desktop.isolated_verification_finished') { $value }
  })
  if ($finished.Count -ne 1) { throw '运行验收没有产生唯一结束记录。' }
  $runtimeReport = Get-Content -Raw -LiteralPath $finished[0].reportPath -Encoding UTF8 | ConvertFrom-Json
  $report.runtime = [ordered]@{ exitCode = $runtimeExitCode; reportPath = $finished[0].reportPath; passed = $runtimeReport.passed }
  if ($runtimeExitCode -ne 0 -or -not $runtimeReport.passed -or $runtimeReport.formalAppReadiness -or
    $runtimeReport.realStoreEvidence -or $runtimeReport.target.deliveryKind -ne 'installed' -or
    $runtimeReport.target.executablePath -ne $appPath -or
    $runtimeReport.target.executableSha256.ToUpperInvariant() -ne $report.currentExe.sha256) {
    throw '安装版实际运行验收失败或证据身份不匹配。'
  }
  $report.checks.installedRuntimePassed = $true
  if ($runtimeWorkPackageArgs.Count -gt 0) {
    if (-not $runtimeReport.checks.packagedWorkerViewRefreshFaithfulNonReadyExport -or -not $runtimeReport.checks.originalWorkPackageUnchanged) { throw '安装版缺少当前包内 Worker 完整收据。' }
    $report.checks.packagedWorkerViewRefreshFaithfulNonReadyExport = $true
  }
} catch {
  Record-Failure 'install-or-runtime' $_
} finally {
  if ($installationAttempted -and $installRoot -and (Test-Path -LiteralPath $installRoot)) {
    try {
      if ($activeHelper -and -not $activeHelper.HasExited) { throw "安装辅助进程仍在运行，保留现场，PID=$($activeHelper.Id)" }
      $null = Assert-OwnedInstallation
      Assert-UninstallerIdentity
      Assert-OwnedShortcuts
      Stop-OwnedApplication
      Assert-UninstallerIdentity
      # --updated 明确保留用户数据，实际卸载必须由本次 NSIS 卸载程序完成。
      Invoke-InstallerProcess $uninstallerPath @('/S', '--updated') 'uninstall'
      Wait-ForInstallationRestoration
      Remove-OwnedInstallerCache
      foreach ($name in @('realUninstallerRemovedInstallation', 'registryRestored', 'shortcutsRestored', 'noApplicationProcesses', 'ownedInstallerCacheRemoved')) {
        if (-not $report.checks[$name]) { throw "卸载后的撤销校验失败：$name" }
      }
    } catch { Record-Failure 'uninstall-and-restoration' $_ }
  }
  if ($report.Contains('canonicalBefore')) {
    try {
      $report.canonicalAfter = Get-CanonicalSnapshot
      $report.checks.canonicalUserDataUnchanged = ($report.canonicalBefore | ConvertTo-Json -Depth 12 -Compress) -eq
        ($report.canonicalAfter | ConvertTo-Json -Depth 12 -Compress)
      if (-not $report.checks.canonicalUserDataUnchanged) { throw '正式 userData 快照发生变化。' }
    } catch { Record-Failure 'canonical-protection' $_ }
  }
  if ($report.Contains('installer')) {
    try {
      $report.checks.installerUnchanged = (Get-Hash $InstallerPath) -eq $report.installer.sha256
      if (-not $report.checks.installerUnchanged) { throw '安装器文件在验收期间发生变化。' }
    } catch { Record-Failure 'installer-identity' $_ }
  }
  foreach ($entry in $originalEnvironment.GetEnumerator()) {
    [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process')
  }
  $report.installedVerified = $installedVerified
  $report.passed = $report.failures.Count -eq 0 -and $installedVerified -and
    $report.checks['installedRuntimePassed'] -and $report.checks['realUninstallerRemovedInstallation'] -and
    $report.checks['canonicalUserDataUnchanged']
  if ($outputCreated) { $report | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $reportPath -Encoding utf8 }
  Write-Event 'package.installed_smoke_finished' @{ passed = $report.passed; reportPath = $reportPath }
}
if (-not $report.passed) { exit 1 }

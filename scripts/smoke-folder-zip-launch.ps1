param(
  [string]$ZipPath,
  [int]$TimeoutSeconds = 90,
  [switch]$VerifyConfiguration,
  [string]$AcceptanceWorkPackagePath = ''
)

$ErrorActionPreference = 'Stop'
$runtimeWorkPackageArgs = @()
if (-not [string]::IsNullOrWhiteSpace($AcceptanceWorkPackagePath)) {
  # 工作包收据复用配置重启链，默认无此参数时保持原启动探针。
  $AcceptanceWorkPackagePath = [System.IO.Path]::GetFullPath($AcceptanceWorkPackagePath)
  if (-not (Test-Path -LiteralPath (Join-Path $AcceptanceWorkPackagePath 'manifest.json') -PathType Leaf)) { throw '验收工作包缺少 manifest.json。' }
  $runtimeWorkPackageArgs = @('--acceptance-work-package', $AcceptanceWorkPackagePath)
  $VerifyConfiguration = $true
}

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$releaseDir = Join-Path $repoRoot 'apps\desktop\release'
if ([string]::IsNullOrWhiteSpace($ZipPath)) {
  $desktopPackagePath = Join-Path $repoRoot 'apps\desktop\package.json'
  $desktopPackageVersion = [string]((Get-Content -Raw -LiteralPath $desktopPackagePath -Encoding UTF8 | ConvertFrom-Json).version)
  if ($desktopPackageVersion -notmatch '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$') {
    throw "Desktop package version is invalid: $desktopPackageVersion"
  }
  $ZipPath = Join-Path $releaseDir "AmazonAIOpsAgent-$desktopPackageVersion.zip"
}
$ZipPath = [System.IO.Path]::GetFullPath($ZipPath)
$winUnpackedExe = Join-Path $releaseDir 'win-unpacked\AmazonAIOpsAgent.exe'
$evidenceDir = Join-Path $repoRoot 'output\codex-evidence'
$runId = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$evidencePathHelper = Join-Path $PSScriptRoot 'package-evidence-paths.js'
$resolvedPathsJson = & node $evidencePathHelper resolve $repoRoot ([string]$runId)
if ($LASTEXITCODE -ne 0) { throw 'Unable to resolve isolated ZIP evidence paths.' }
$resolvedPaths = ($resolvedPathsJson -join "`n") | ConvertFrom-Json
$extractRoot = [string]$resolvedPaths.folderZipExtractRoot
$userDataRoot = [string]$resolvedPaths.folderZipUserDataRoot
$evidencePath = Join-Path $evidenceDir "folder-zip-launch-smoke-$runId.json"
$stdoutPath = Join-Path $evidenceDir "folder-zip-launch-$runId.stdout.log"
$stderrPath = Join-Path $evidenceDir "folder-zip-launch-$runId.stderr.log"

function Assert-SafeTempPath {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$ExpectedPath
  )

  $resolvedJson = & node $evidencePathHelper assert $Path $ExpectedPath
  if ($LASTEXITCODE -ne 0) { throw "Refusing to operate on unexpected temporary path: $Path" }
  return (($resolvedJson -join "`n") | ConvertFrom-Json)
}

function Get-Sha256Hex {
  param([Parameter(Mandatory = $true)][string]$Path)

  $stream = [System.IO.File]::OpenRead($Path)
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = $sha256.ComputeHash($stream)
    return ([System.BitConverter]::ToString($bytes)).Replace('-', '')
  } finally {
    $sha256.Dispose()
    $stream.Dispose()
  }
}

function Initialize-VisibleWindowProbe {
  if ('AmazonAiOpsFolderZipSmoke.NativeWindow' -as [type]) { return }

  Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;

namespace AmazonAiOpsFolderZipSmoke {
  public static class NativeWindow {
    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);

    public static IntPtr FindVisibleWindow(int processId) {
      IntPtr match = IntPtr.Zero;
      EnumWindows((hWnd, lParam) => {
        uint owner;
        GetWindowThreadProcessId(hWnd, out owner);
        if (owner == (uint)processId && IsWindowVisible(hWnd)) {
          match = hWnd;
          return false;
        }
        return true;
      }, IntPtr.Zero);
      return match;
    }

    public static string GetTitle(IntPtr hWnd) {
      var text = new StringBuilder(1024);
      GetWindowText(hWnd, text, text.Capacity);
      return text.ToString();
    }
  }
}
'@
}

function Get-ZipRuntimeProcessSnapshot([uint32]$ProcessId) {
  return @(Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction Stop |
    Select-Object Name, ProcessId, ExecutablePath, CreationDate)
}

function Get-ZipRuntimeProcesses {
  return @(Get-CimInstance Win32_Process -Filter "Name = 'AmazonAIOpsAgent.exe'" -ErrorAction Stop |
    Select-Object Name, ProcessId, ExecutablePath, CreationDate)
}

function Assert-ZipRuntimeProcessIdentity([object]$Initial, [object]$Current, [string]$ExpectedExecutablePath) {
  foreach ($snapshot in @($Initial, $Current)) {
    if ($null -eq $snapshot -or $snapshot.ProcessId -le 0 -or
      $snapshot.Name -ne 'AmazonAIOpsAgent.exe' -or -not $snapshot.ExecutablePath -or
      -not $snapshot.CreationDate -or
      -not [string]::Equals([IO.Path]::GetFullPath($snapshot.ExecutablePath), $ExpectedExecutablePath,
        [StringComparison]::OrdinalIgnoreCase) -or
      ([DateTime]$snapshot.CreationDate).ToUniversalTime() -lt $script:zipRuntimeStartedAt) {
      throw [Security.SecurityException]::new('ZIP 进程身份不完整或不属于本次精确程序，拒绝停止。')
    }
  }
  if ($Current.ProcessId -ne $Initial.ProcessId -or
    ([DateTime]$Current.CreationDate).ToUniversalTime() -ne ([DateTime]$Initial.CreationDate).ToUniversalTime()) {
    throw [Security.SecurityException]::new('ZIP 进程 PID 已复用或创建时间发生变化，拒绝停止。')
  }
}

function Remember-ZipRuntimeProcess([object]$Snapshot, [string]$ExpectedExecutablePath) {
  Assert-ZipRuntimeProcessIdentity $Snapshot $Snapshot $ExpectedExecutablePath
  $processId = [int]$Snapshot.ProcessId
  if ($script:zipRuntimeIdentities.ContainsKey($processId)) {
    Assert-ZipRuntimeProcessIdentity $script:zipRuntimeIdentities[$processId] $Snapshot $ExpectedExecutablePath
  } else {
    $script:zipRuntimeIdentities[$processId] = [pscustomobject]@{
      Name = $Snapshot.Name; ProcessId = $processId; ExecutablePath = $Snapshot.ExecutablePath
      CreationDate = ([DateTime]$Snapshot.CreationDate).ToUniversalTime()
    }
  }
}

function Stop-ZipRuntimeProcess([object]$Initial, [string]$ExpectedExecutablePath) {
  $handle = $null
  try {
    $current = @(Get-ZipRuntimeProcessSnapshot $Initial.ProcessId)
    if ($current.Count -eq 0) { return $false }
    if ($current.Count -ne 1) { throw 'ZIP 进程 PID 查询结果不唯一。' }
    Assert-ZipRuntimeProcessIdentity $Initial $current[0] $ExpectedExecutablePath
    $handle = Get-Process -Id $Initial.ProcessId -ErrorAction Stop
    # 先绑定进程句柄，再核验身份；停止时不重新按可能复用的 PID 查找。
    $boundHandle = $handle.Handle
    if ($null -eq $boundHandle -or $boundHandle -eq [IntPtr]::Zero) {
      throw [Security.SecurityException]::new('ZIP 进程句柄未成功绑定，拒绝停止。')
    }
    $current = @(Get-ZipRuntimeProcessSnapshot $Initial.ProcessId)
    if ($current.Count -eq 0) { return $false }
    if ($current.Count -ne 1) { throw 'ZIP 进程 PID 二次查询结果不唯一。' }
    Assert-ZipRuntimeProcessIdentity $Initial $current[0] $ExpectedExecutablePath
    $handle.Kill()
    if (-not $handle.WaitForExit(10000)) { throw 'ZIP 自有进程未在限定时间内退出。' }
    return $true
  } catch {
    if ($_.Exception -is [Security.SecurityException]) { throw }
    $remaining = @(Get-ZipRuntimeProcessSnapshot $Initial.ProcessId)
    if ($remaining.Count -eq 0) { return $false }
    throw
  } finally {
    if ($handle) { $handle.Dispose() }
  }
}

function Add-ZipCleanupFailure([string]$Stage, [object]$Failure) {
  $detail = [ordered]@{
    stage = $Stage; message = $Failure.Exception.Message
    type = $Failure.Exception.GetType().FullName; stack = [string]$Failure.ScriptStackTrace
  }
  $script:zipCleanupFailures.Add($detail)
  $record = [ordered]@{
    timestamp = [DateTime]::UtcNow.ToString('o'); level = 'error'
    event = 'package.folder_zip_cleanup_failed'; context = $detail
  }
  [Console]::Error.WriteLine(($record | ConvertTo-Json -Depth 6 -Compress))
}

function Stop-VerifiedRuntime {
  param([int[]]$ProcessIds, [string]$ExpectedExecutableRoot)

  $expectedExecutable = [IO.Path]::GetFullPath((Join-Path $ExpectedExecutableRoot 'AmazonAIOpsAgent.exe'))
  $stopped = [System.Collections.Generic.List[int]]::new()
  try {
    foreach ($processId in @($ProcessIds | Where-Object { $_ -gt 0 } | Select-Object -Unique)) {
      if (-not $script:zipRuntimeIdentities.ContainsKey($processId)) {
        if (@(Get-ZipRuntimeProcessSnapshot $processId).Count -eq 0) { continue }
        throw [Security.SecurityException]::new('ZIP 候选 PID 没有本轮身份原件，保留现场。')
      }
      if (Stop-ZipRuntimeProcess $script:zipRuntimeIdentities[$processId] $expectedExecutable) { $stopped.Add($processId) }
    }
    foreach ($snapshot in @(Get-ZipRuntimeProcesses)) {
      if (-not $snapshot.ExecutablePath) { throw 'ZIP 同名进程路径不可验证，保留现场。' }
      if (-not [string]::Equals([IO.Path]::GetFullPath($snapshot.ExecutablePath), $expectedExecutable,
        [StringComparison]::OrdinalIgnoreCase)) { continue }
      Remember-ZipRuntimeProcess $snapshot $expectedExecutable
      if (Stop-ZipRuntimeProcess $script:zipRuntimeIdentities[[int]$snapshot.ProcessId] $expectedExecutable) {
        $stopped.Add([int]$snapshot.ProcessId)
      }
    }
    foreach ($snapshot in @(Get-ZipRuntimeProcesses)) {
      if (-not $snapshot.ExecutablePath -or [string]::Equals([IO.Path]::GetFullPath($snapshot.ExecutablePath),
        $expectedExecutable, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'ZIP 清理后仍有存活或身份不明的进程，保留现场。'
      }
    }
    return @($stopped | Select-Object -Unique)
  } catch {
    Add-ZipCleanupFailure 'processes' $_
    throw
  }
}

function Complete-ZipRuntimeCleanup([int[]]$ProcessIds) {
  $stopped = @()
  $failureCount = $script:zipCleanupFailures.Count
  try { $stopped = @(Stop-VerifiedRuntime -ProcessIds $ProcessIds -ExpectedExecutableRoot $safeExtractRoot) }
  catch {
    if ($script:zipCleanupFailures.Count -eq $failureCount) { Add-ZipCleanupFailure 'processes' $_ }
  }
  $confirmed = $script:zipCleanupFailures.Count -eq 0
  if ($confirmed) {
    foreach ($temporaryPath in @($safeExtractRoot, $safeUserDataRoot)) {
      try {
        if (Test-Path -LiteralPath $temporaryPath -PathType Container) {
          $expectedPath = if ($temporaryPath -eq $safeExtractRoot) { $extractRoot } else { $userDataRoot }
          $verifiedCleanupPath = Assert-SafeTempPath -Path $temporaryPath -ExpectedPath $expectedPath
          Remove-Item -LiteralPath $verifiedCleanupPath -Recurse -Force
        }
      } catch { Add-ZipCleanupFailure 'directories' $_ }
    }
  }
  return [ordered]@{
    stoppedProcessIds = $stopped; processCleanupConfirmed = $confirmed
    temporaryFilesRemoved = $confirmed -and $script:zipCleanupFailures.Count -eq 0
    failures = @($script:zipCleanupFailures.ToArray())
  }
}

$safeExtractRoot = Assert-SafeTempPath -Path $extractRoot -ExpectedPath $extractRoot
$safeUserDataRoot = Assert-SafeTempPath -Path $userDataRoot -ExpectedPath $userDataRoot
$previousEvidenceMode = $env:AMAZON_AI_OPS_EVIDENCE_MODE
$previousUserDataDir = $env:AMAZON_AI_OPS_USER_DATA_DIR
$previousElectronLogging = $env:ELECTRON_ENABLE_LOGGING
$launch = $null
$marker = $null
$runtimeMarker = $null
$runtimeProcess = $null
$runtimeWindowHandle = [IntPtr]::Zero
$runtimeWindowTitle = ''
$stoppedProcessIds = @()
$passed = $false
$failure = $null
$result = $null
$configurationRuntime = $null
$script:zipRuntimeIdentities = @{}
$script:zipCleanupFailures = [System.Collections.Generic.List[object]]::new()
$script:zipRuntimeStartedAt = [DateTime]::UtcNow

try {
  if (-not (Test-Path -LiteralPath $ZipPath -PathType Leaf)) {
    throw "Folder ZIP is missing: $ZipPath"
  }
  if (-not (Test-Path -LiteralPath $winUnpackedExe -PathType Leaf)) {
    throw "win-unpacked executable is missing: $winUnpackedExe"
  }

  New-Item -ItemType Directory -Path $safeExtractRoot, $safeUserDataRoot, $evidenceDir -Force | Out-Null
  $safeExtractRoot = Assert-SafeTempPath -Path $safeExtractRoot -ExpectedPath $extractRoot
  $safeUserDataRoot = Assert-SafeTempPath -Path $safeUserDataRoot -ExpectedPath $userDataRoot
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  Initialize-VisibleWindowProbe
  [System.IO.Compression.ZipFile]::ExtractToDirectory($ZipPath, $safeExtractRoot)

  $extractedExe = Join-Path $safeExtractRoot 'AmazonAIOpsAgent.exe'
  if (-not (Test-Path -LiteralPath $extractedExe -PathType Leaf)) {
    throw 'ZIP extraction did not produce AmazonAIOpsAgent.exe at the package root.'
  }

  $zipHash = Get-Sha256Hex -Path $ZipPath
  $extractedExeHash = Get-Sha256Hex -Path $extractedExe
  $winUnpackedExeHash = Get-Sha256Hex -Path $winUnpackedExe
  if ($extractedExeHash -ne $winUnpackedExeHash) {
    throw 'Extracted ZIP executable hash differs from the freshly built win-unpacked executable.'
  }

  $env:AMAZON_AI_OPS_EVIDENCE_MODE = 'package-launch-smoke'
  $env:AMAZON_AI_OPS_USER_DATA_DIR = $safeUserDataRoot
  $env:ELECTRON_ENABLE_LOGGING = '1'

  $script:zipRuntimeStartedAt = [DateTime]::UtcNow
  $launch = Start-Process -FilePath $extractedExe -WorkingDirectory $safeExtractRoot -PassThru `
    -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
  $initialLaunch = @(Get-ZipRuntimeProcessSnapshot $launch.Id)
  if ($initialLaunch.Count -ne 1) { throw 'ZIP 启动进程没有唯一身份原件。' }
  Remember-ZipRuntimeProcess $initialLaunch[0] $extractedExe
  $windowMarkerPath = Join-Path $safeUserDataRoot 'package-launch-window-ready.json'
  $runtimeMarkerPath = Join-Path $safeUserDataRoot 'evidence-user-data-runtime.json'
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

  while ((Get-Date) -lt $deadline) {
    if (
      (Test-Path -LiteralPath $windowMarkerPath -PathType Leaf) -and
      (Test-Path -LiteralPath $runtimeMarkerPath -PathType Leaf)
    ) {
      try {
        $marker = Get-Content -Raw -LiteralPath $windowMarkerPath -Encoding UTF8 | ConvertFrom-Json
        $runtimeMarker = Get-Content -Raw -LiteralPath $runtimeMarkerPath -Encoding UTF8 | ConvertFrom-Json
        $runtimeProcess = Get-Process -Id ([int]$marker.pid) -ErrorAction Stop
        $runtimeWindowHandle = [AmazonAiOpsFolderZipSmoke.NativeWindow]::FindVisibleWindow([int]$marker.pid)
        if ($runtimeWindowHandle -ne [IntPtr]::Zero) {
          $runtimeWindowTitle = [AmazonAiOpsFolderZipSmoke.NativeWindow]::GetTitle($runtimeWindowHandle)
          break
        }
      } catch {
        $marker = $null
        $runtimeMarker = $null
        $runtimeProcess = $null
      }
    }
    Start-Sleep -Milliseconds 500
  }

  if ($null -eq $marker -or $null -eq $runtimeMarker -or $null -eq $runtimeProcess) {
    throw "Extracted ZIP did not publish verified runtime markers within $TimeoutSeconds seconds."
  }
  if ($runtimeWindowHandle -eq [IntPtr]::Zero) {
    throw 'Extracted ZIP did not create a visible main window.'
  }
  if ([int]$marker.pid -ne [int]$runtimeMarker.pid) {
    throw 'Window-ready and runtime markers identify different processes.'
  }
  if ($runtimeMarker.mode -ne 'package-launch-smoke' -or $runtimeMarker.overridden -ne $true) {
    throw 'Extracted ZIP did not honor the isolated package-launch user-data contract.'
  }
  if ([System.IO.Path]::GetFullPath([string]$runtimeMarker.userDataDir) -ne $safeUserDataRoot) {
    throw 'Extracted ZIP runtime used an unexpected user-data directory.'
  }
  if (-not ([string]$marker.rendererUrl).StartsWith('file:///', [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Extracted ZIP did not load a packaged file renderer.'
  }
  $initialRuntime = @(Get-ZipRuntimeProcessSnapshot $marker.pid)
  if ($initialRuntime.Count -ne 1) { throw 'ZIP 主窗口进程没有唯一身份原件。' }
  Remember-ZipRuntimeProcess $initialRuntime[0] $extractedExe

  if ($VerifyConfiguration) {
    # 先结束启动探针，再用同一解压包验证独立配置的保存与重启。
    $stoppedProcessIds = @(Stop-VerifiedRuntime -ProcessIds @([int]$launch.Id, [int]$marker.pid) -ExpectedExecutableRoot $safeExtractRoot)
    $configurationStdout = Join-Path $evidenceDir "folder-zip-configuration-$runId.stdout.log"
    $configurationStderr = Join-Path $evidenceDir "folder-zip-configuration-$runId.stderr.log"
    # 原生 stderr 保留为日志，返回码与报告继续决定失败，调用后恢复严格模式。
    $nativeCliErrorActionPreference = $ErrorActionPreference
    try {
      $ErrorActionPreference = 'Continue'
      & node (Join-Path $PSScriptRoot 'verify-isolated-desktop-runtime.mjs') --app-executable $extractedExe --delivery-kind folder-zip @runtimeWorkPackageArgs 1> $configurationStdout 2> $configurationStderr
      $configurationExitCode = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $nativeCliErrorActionPreference
    }
    $finished = @(Get-Content -LiteralPath $configurationStdout | Where-Object { $_.StartsWith('{') } | ForEach-Object {
      $entry = $_ | ConvertFrom-Json
      if ($entry.event -eq 'desktop.isolated_verification_finished') { $entry }
    })
    if ($finished.Count -ne 1) { throw 'ZIP 配置验收没有产生唯一结束记录。' }
    $configurationReport = Get-Content -LiteralPath $finished[0].reportPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($configurationExitCode -ne 0 -or -not $configurationReport.passed -or
      $configurationReport.target.deliveryKind -ne 'folder-zip' -or
      $configurationReport.target.executablePath -ne $extractedExe -or
      $configurationReport.target.executableSha256.ToUpperInvariant() -ne $extractedExeHash.ToUpperInvariant() -or
      $configurationReport.formalAppReadiness -or $configurationReport.realStoreEvidence) {
      throw 'ZIP 配置保存与重启验收失败或包身份不匹配。'
    }
    $configurationRuntime = [ordered]@{ passed = $true; reportPath = $finished[0].reportPath; exitCode = $configurationExitCode }
    if ($runtimeWorkPackageArgs.Count -gt 0) {
      if (-not $configurationReport.checks.packagedWorkerViewRefreshFaithfulNonReadyExport -or -not $configurationReport.checks.originalWorkPackageUnchanged) { throw 'ZIP 缺少当前包内 Worker 完整收据。' }
      $configurationRuntime.packagedWorkerViewRefreshFaithfulNonReadyExport = $true
    }
  }

  $passed = $true
  $result = [ordered]@{
    kind = 'folder-zip-launch-smoke'
    schemaVersion = 1
    generatedAt = (Get-Date).ToUniversalTime().ToString('o')
    passed = $true
    configurationRuntime = $configurationRuntime
    zip = [ordered]@{
      path = $ZipPath
      sizeBytes = (Get-Item -LiteralPath $ZipPath).Length
      sha256 = $zipHash
    }
    extractedExecutable = [ordered]@{
      path = $extractedExe
      sha256 = $extractedExeHash
      matchesWinUnpacked = $true
    }
    runtime = [ordered]@{
      launcherPid = [int]$launch.Id
      processId = [int]$marker.pid
      mainWindowHandle = [int64]$runtimeWindowHandle
      mainWindowTitle = [string]$runtimeWindowTitle
      rendererUrl = [string]$marker.rendererUrl
      userDataDir = [string]$runtimeMarker.userDataDir
      windowReadyGeneratedAt = [string]$marker.generatedAt
    }
    logs = [ordered]@{
      stdout = $stdoutPath
      stderr = $stderrPath
    }
  }
} catch {
  $failure = $_.Exception.Message
  $launchExited = $null
  $launchExitCode = $null
  if ($null -ne $launch) {
    try {
      $launch.Refresh()
      $launchExited = [bool]$launch.HasExited
      if ($launch.HasExited) { $launchExitCode = [int]$launch.ExitCode }
    } catch {}
  }
  $stdoutTail = if (Test-Path -LiteralPath $stdoutPath) {
    (Get-Content -Tail 80 -LiteralPath $stdoutPath -ErrorAction SilentlyContinue) -join "`n"
  } else { '' }
  $stderrTail = if (Test-Path -LiteralPath $stderrPath) {
    (Get-Content -Tail 80 -LiteralPath $stderrPath -ErrorAction SilentlyContinue) -join "`n"
  } else { '' }
  $result = [ordered]@{
    kind = 'folder-zip-launch-smoke'
    schemaVersion = 1
    generatedAt = (Get-Date).ToUniversalTime().ToString('o')
    passed = $false
    zipPath = $ZipPath
    error = $failure
    launcher = [ordered]@{
      processId = if ($null -ne $launch) { [int]$launch.Id } else { $null }
      exited = $launchExited
      exitCode = $launchExitCode
    }
    logs = [ordered]@{
      stdout = $stdoutPath
      stderr = $stderrPath
      stdoutTail = $stdoutTail
      stderrTail = $stderrTail
    }
  }
} finally {
  $candidateIds = @()
  if ($null -ne $launch) { $candidateIds += [int]$launch.Id }
  if ($null -ne $marker -and $null -ne $marker.pid) { $candidateIds += [int]$marker.pid }
  $cleanup = Complete-ZipRuntimeCleanup $candidateIds
  $stoppedProcessIds = @($stoppedProcessIds) + @($cleanup.stoppedProcessIds)
  if (-not $cleanup.temporaryFilesRemoved) {
    $passed = $false
    $result.passed = $false
    if (-not $failure) { $failure = 'ZIP 清理未获确认，保留现场与清理错误原件。'; $result.error = $failure }
  }

  $env:AMAZON_AI_OPS_EVIDENCE_MODE = $previousEvidenceMode
  $env:AMAZON_AI_OPS_USER_DATA_DIR = $previousUserDataDir
  $env:ELECTRON_ENABLE_LOGGING = $previousElectronLogging

  $result.stoppedProcessIds = @($stoppedProcessIds)
  $result.processCleanupConfirmed = $cleanup.processCleanupConfirmed
  $result.cleanupFailures = @($cleanup.failures)
  $result.temporaryFilesRemoved = $cleanup.temporaryFilesRemoved
  $json = $result | ConvertTo-Json -Depth 8
  Set-Content -LiteralPath $evidencePath -Value $json -Encoding utf8
  Write-Output $json
  Write-Output "Evidence: $evidencePath"
}

if (-not $passed) {
  exit 1
}

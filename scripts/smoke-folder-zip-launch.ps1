param(
  [string]$ZipPath,
  [int]$TimeoutSeconds = 90
)

$ErrorActionPreference = 'Stop'

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$releaseDir = Join-Path $repoRoot 'apps\desktop\release'
if ([string]::IsNullOrWhiteSpace($ZipPath)) {
  $ZipPath = Join-Path $releaseDir 'AmazonAIOpsAgent-1.5.0.zip'
}
$ZipPath = [System.IO.Path]::GetFullPath($ZipPath)
$winUnpackedExe = Join-Path $releaseDir 'win-unpacked\AmazonAIOpsAgent.exe'
$evidenceDir = Join-Path $repoRoot 'output\codex-evidence'
$runId = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$extractRoot = "D:\Temp\amazon-ai-ops-folder-zip-smoke-$runId"
$userDataRoot = "D:\Temp\amazon-ai-ops-folder-zip-user-$runId"
$evidencePath = Join-Path $evidenceDir "folder-zip-launch-smoke-$runId.json"
$stdoutPath = Join-Path $evidenceDir "folder-zip-launch-$runId.stdout.log"
$stderrPath = Join-Path $evidenceDir "folder-zip-launch-$runId.stderr.log"

function Assert-SafeTempPath {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Prefix
  )

  $resolved = [System.IO.Path]::GetFullPath($Path)
  if (-not $resolved.StartsWith($Prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to operate on unexpected temporary path: $resolved"
  }
  return $resolved
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

function Stop-VerifiedRuntime {
  param(
    [int[]]$ProcessIds,
    [string]$ExpectedExecutableRoot
  )

  $stopped = [System.Collections.Generic.List[int]]::new()
  foreach ($processId in @($ProcessIds | Where-Object { $_ -gt 0 } | Select-Object -Unique)) {
    $candidate = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($null -eq $candidate) { continue }
    $candidatePath = $null
    try { $candidatePath = $candidate.Path } catch {}
    if (
      $candidatePath -and
      -not $candidatePath.StartsWith($ExpectedExecutableRoot, [System.StringComparison]::OrdinalIgnoreCase)
    ) {
      throw "Refusing to stop process outside extracted ZIP: $processId $candidatePath"
    }
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    $stopped.Add($processId)
  }

  Start-Sleep -Seconds 2
  $remaining = @(
    Get-CimInstance Win32_Process -Filter "Name = 'AmazonAIOpsAgent.exe'" -ErrorAction SilentlyContinue |
      Where-Object {
        $_.ExecutablePath -and
        $_.ExecutablePath.StartsWith($ExpectedExecutableRoot, [System.StringComparison]::OrdinalIgnoreCase)
      }
  )
  foreach ($process in $remaining) {
    Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction SilentlyContinue
    $stopped.Add([int]$process.ProcessId)
  }
  return @($stopped | Select-Object -Unique)
}

$safeExtractRoot = Assert-SafeTempPath -Path $extractRoot -Prefix 'D:\Temp\amazon-ai-ops-folder-zip-smoke-'
$safeUserDataRoot = Assert-SafeTempPath -Path $userDataRoot -Prefix 'D:\Temp\amazon-ai-ops-folder-zip-user-'
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

try {
  if (-not (Test-Path -LiteralPath $ZipPath -PathType Leaf)) {
    throw "Folder ZIP is missing: $ZipPath"
  }
  if (-not (Test-Path -LiteralPath $winUnpackedExe -PathType Leaf)) {
    throw "win-unpacked executable is missing: $winUnpackedExe"
  }

  New-Item -ItemType Directory -Path $safeExtractRoot, $safeUserDataRoot, $evidenceDir -Force | Out-Null
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

  $launch = Start-Process -FilePath $extractedExe -WorkingDirectory $safeExtractRoot -PassThru `
    -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
  $windowMarkerPath = Join-Path $safeUserDataRoot 'package-launch-window-ready.json'
  $runtimeMarkerPath = Join-Path $safeUserDataRoot 'evidence-user-data-runtime.json'
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

  while ((Get-Date) -lt $deadline) {
    if (
      (Test-Path -LiteralPath $windowMarkerPath -PathType Leaf) -and
      (Test-Path -LiteralPath $runtimeMarkerPath -PathType Leaf)
    ) {
      try {
        $marker = Get-Content -Raw -LiteralPath $windowMarkerPath | ConvertFrom-Json
        $runtimeMarker = Get-Content -Raw -LiteralPath $runtimeMarkerPath | ConvertFrom-Json
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

  $passed = $true
  $result = [ordered]@{
    kind = 'folder-zip-launch-smoke'
    schemaVersion = 1
    generatedAt = (Get-Date).ToUniversalTime().ToString('o')
    passed = $true
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
  try {
    $stoppedProcessIds = Stop-VerifiedRuntime -ProcessIds $candidateIds -ExpectedExecutableRoot $safeExtractRoot
  } catch {
    if ($passed) {
      $passed = $false
      $failure = $_.Exception.Message
      $result.passed = $false
      $result.error = $failure
    }
  }

  $env:AMAZON_AI_OPS_EVIDENCE_MODE = $previousEvidenceMode
  $env:AMAZON_AI_OPS_USER_DATA_DIR = $previousUserDataDir
  $env:ELECTRON_ENABLE_LOGGING = $previousElectronLogging

  foreach ($temporaryPath in @($safeExtractRoot, $safeUserDataRoot)) {
    if (Test-Path -LiteralPath $temporaryPath) {
      Remove-Item -LiteralPath $temporaryPath -Recurse -Force
    }
  }

  $result.stoppedProcessIds = @($stoppedProcessIds)
  $result.temporaryFilesRemoved = $true
  $json = $result | ConvertTo-Json -Depth 8
  Set-Content -LiteralPath $evidencePath -Value $json -Encoding utf8
  Write-Output $json
  Write-Output "Evidence: $evidencePath"
}

if (-not $passed) {
  exit 1
}

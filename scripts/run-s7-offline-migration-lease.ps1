param(
  [Parameter(Mandatory = $true)]
  [string]$RequestPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ExpectedTargetVersion = 11

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class S7OfflineLeaseNative
{
    [StructLayout(LayoutKind.Sequential)]
    public struct FILETIME
    {
        public uint Low;
        public uint High;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct BY_HANDLE_FILE_INFORMATION
    {
        public uint FileAttributes;
        public FILETIME CreationTime;
        public FILETIME LastAccessTime;
        public FILETIME LastWriteTime;
        public uint VolumeSerialNumber;
        public uint FileSizeHigh;
        public uint FileSizeLow;
        public uint NumberOfLinks;
        public uint FileIndexHigh;
        public uint FileIndexLow;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool GetFileInformationByHandle(
        IntPtr fileHandle,
        out BY_HANDLE_FILE_INFORMATION information
    );

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern uint GetFinalPathNameByHandle(
        IntPtr fileHandle,
        StringBuilder path,
        uint pathLength,
        uint flags
    );

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CreateHardLink(
        string newFileName,
        string existingFileName,
        IntPtr securityAttributes
    );
}
'@

function Get-FullPath([string]$CandidatePath) {
  if ([string]::IsNullOrWhiteSpace($CandidatePath) -or
      -not [System.IO.Path]::IsPathRooted($CandidatePath)) {
    throw "Lease path must be absolute: $CandidatePath"
  }
  return [System.IO.Path]::GetFullPath($CandidatePath)
}

function Test-SamePath([string]$Left, [string]$Right) {
  return [string]::Equals(
    (Get-FullPath $Left).TrimEnd('\'),
    (Get-FullPath $Right).TrimEnd('\'),
    [System.StringComparison]::OrdinalIgnoreCase
  )
}

function Assert-RegularDirectPath(
  [string]$CandidatePath,
  [string]$Label,
  [bool]$Directory
) {
  $fullPath = Get-FullPath $CandidatePath
  $item = Get-Item -LiteralPath $fullPath -Force
  if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "$Label may not be a reparse point: $fullPath"
  }
  if ($Directory -and -not $item.PSIsContainer) {
    throw "$Label must be a directory: $fullPath"
  }
  if (-not $Directory -and $item.PSIsContainer) {
    throw "$Label must be a file: $fullPath"
  }
  return $fullPath
}

function Get-DirectoryEntries([string]$DirectoryPath) {
  [string[]]$entries = @(
    Get-ChildItem -LiteralPath $DirectoryPath -Force |
      Select-Object -ExpandProperty Name
  )
  [System.Array]::Sort($entries, [System.StringComparer]::Ordinal)
  return $entries
}

function Assert-NoSidecars([string]$SourcePath) {
  $present = @()
  foreach ($suffix in @('-wal', '-shm', '-journal')) {
    $candidate = "$SourcePath$suffix"
    if (Test-Path -LiteralPath $candidate) {
      $present += $candidate
    }
  }
  if ($present.Count -gt 0) {
    throw "Source database is not offline; close the app and remove no files manually: $($present -join ', ')"
  }
}

function Get-StreamSha256([System.IO.FileStream]$Stream) {
  $Stream.Position = 0
  $algorithm = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = $algorithm.ComputeHash($Stream)
  }
  finally {
    $algorithm.Dispose()
    $Stream.Position = 0
  }
  return ([System.BitConverter]::ToString($bytes)).Replace('-', '')
}

function Get-FileSha256([string]$FilePath) {
  $stream = [System.IO.File]::Open(
    $FilePath,
    [System.IO.FileMode]::Open,
    [System.IO.FileAccess]::Read,
    [System.IO.FileShare]::Read
  )
  try {
    return Get-StreamSha256 $stream
  }
  finally {
    $stream.Dispose()
  }
}

function Get-HandleIdentity([System.IO.FileStream]$Stream) {
  $information = New-Object S7OfflineLeaseNative+BY_HANDLE_FILE_INFORMATION
  $handle = $Stream.SafeFileHandle.DangerousGetHandle()
  if (-not [S7OfflineLeaseNative]::GetFileInformationByHandle($handle, [ref]$information)) {
    throw "GetFileInformationByHandle failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
  }
  $buffer = New-Object System.Text.StringBuilder 32768
  $length = [S7OfflineLeaseNative]::GetFinalPathNameByHandle(
    $handle,
    $buffer,
    [uint32]$buffer.Capacity,
    0
  )
  if ($length -eq 0 -or $length -ge $buffer.Capacity) {
    throw "GetFinalPathNameByHandle failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
  }
  $finalPath = $buffer.ToString()
  if ($finalPath.StartsWith('\\?\UNC\', [StringComparison]::OrdinalIgnoreCase)) {
    $finalPath = "\\$($finalPath.Substring(8))"
  }
  elseif ($finalPath.StartsWith('\\?\', [StringComparison]::OrdinalIgnoreCase)) {
    $finalPath = $finalPath.Substring(4)
  }
  return [ordered]@{
    finalPath = Get-FullPath $finalPath
    volumeSerialNumber = [uint64]$information.VolumeSerialNumber
    fileIndexHigh = [uint64]$information.FileIndexHigh
    fileIndexLow = [uint64]$information.FileIndexLow
    numberOfLinks = [uint64]$information.NumberOfLinks
    sizeBytes = [uint64]$Stream.Length
  }
}

function Write-Utf8ExclusiveDurable([string]$FilePath, [string]$Text) {
  $encoding = New-Object System.Text.UTF8Encoding($false)
  $bytes = $encoding.GetBytes($Text)
  $stream = [System.IO.File]::Open(
    $FilePath,
    [System.IO.FileMode]::CreateNew,
    [System.IO.FileAccess]::Write,
    [System.IO.FileShare]::None
  )
  try {
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush($true)
  }
  finally {
    $stream.Dispose()
  }
}

function Remove-OwnedFile([string]$FilePath) {
  if (Test-Path -LiteralPath $FilePath -PathType Leaf) {
    Remove-Item -LiteralPath $FilePath -Force
  }
}

$requestFullPath = Get-FullPath $RequestPath
$request = Get-Content -LiteralPath $requestFullPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($request.kind -ne 's7-offline-migration-lease-request' -or
    $request.schemaVersion -ne 1) {
  throw 'Offline lease request contract is invalid.'
}
$targetVersionValue = $request.plan.targetVersion
$targetVersionIsInteger = $targetVersionValue -is [sbyte] -or
  $targetVersionValue -is [byte] -or
  $targetVersionValue -is [int16] -or
  $targetVersionValue -is [uint16] -or
  $targetVersionValue -is [int32] -or
  $targetVersionValue -is [uint32] -or
  $targetVersionValue -is [int64] -or
  $targetVersionValue -is [uint64]
if (-not $targetVersionIsInteger -or
    [int64]$targetVersionValue -ne $ExpectedTargetVersion) {
  throw "Offline lease plan targetVersion must be exactly $ExpectedTargetVersion."
}
$targetVersion = [int]$targetVersionValue

$sourcePath = Get-FullPath ([string]$request.plan.source.path)
$workingPath = Get-FullPath ([string]$request.plan.workingDatabasePath)
$restorePath = Get-FullPath ([string]$request.plan.restoreDatabasePath)
$manifestPath = Get-FullPath ([string]$request.plan.manifestPath)
$temporaryManifestPath = Get-FullPath ([string]$request.temporaryManifestPath)
$leaseProofPath = Get-FullPath ([string]$request.leaseProofPath)
$workDir = Assert-RegularDirectPath ([string]$request.plan.workDir) 'Work directory' $true
$manifestParent = Assert-RegularDirectPath ([System.IO.Path]::GetDirectoryName($manifestPath)) 'Manifest parent' $true
$sourcePath = Assert-RegularDirectPath $sourcePath 'Source database' $false
$sourceDirectory = Assert-RegularDirectPath ([System.IO.Path]::GetDirectoryName($sourcePath)) 'Source directory' $true

foreach ($candidate in @($workingPath, $restorePath, $manifestPath, $temporaryManifestPath, $leaseProofPath)) {
  if (-not (Test-SamePath $workDir ([System.IO.Path]::GetDirectoryName($candidate))) -and
      -not $candidate.StartsWith("$workDir\", [StringComparison]::OrdinalIgnoreCase)) {
    throw "Lease artifact escaped the work directory: $candidate"
  }
}
if (-not (Test-SamePath $manifestParent ([System.IO.Path]::GetDirectoryName($temporaryManifestPath)))) {
  throw 'Temporary and final manifests must share one directory.'
}

$expectedSha256 = ([string]$request.plan.source.sha256).ToUpperInvariant()
$expectedEntriesJson = ConvertTo-Json @($request.plan.source.offlineIdentity.sourceDirectory.entries) -Compress
$faultMode = [string]$request.faultMode
$sourceStream = $null
$publishedByThisRun = $false
$createdFinalByFault = $false
$success = $false
$failure = $null
$injectedSidecars = New-Object System.Collections.Generic.List[string]

try {
  Assert-NoSidecars $sourcePath
  try {
    $sourceStream = [System.IO.File]::Open(
      $sourcePath,
      [System.IO.FileMode]::Open,
      [System.IO.FileAccess]::Read,
      [System.IO.FileShare]::None
    )
  }
  catch {
    throw "Exclusive offline lease could not be acquired; the app or another process still has the database open: $($_.Exception.Message)"
  }

  $handleIdentity = Get-HandleIdentity $sourceStream
  if (-not (Test-SamePath $handleIdentity.finalPath $sourcePath)) {
    throw "Locked handle resolved to an unexpected database path: $($handleIdentity.finalPath)"
  }
  if ($handleIdentity.numberOfLinks -ne 1) {
    throw "Source database must have exactly one hard link; observed $($handleIdentity.numberOfLinks)."
  }
  Assert-NoSidecars $sourcePath
  $lockedEntriesJson = ConvertTo-Json @(Get-DirectoryEntries $sourceDirectory) -Compress
  if ($lockedEntriesJson -ne $expectedEntriesJson) {
    throw "Source directory changed before the offline lease was acquired."
  }
  $lockedSha256 = Get-StreamSha256 $sourceStream
  if ($lockedSha256 -ne $expectedSha256) {
    throw "Locked source SHA-256 mismatch: expected=$expectedSha256 actual=$lockedSha256"
  }

  $workingStream = [System.IO.File]::Open(
    $workingPath,
    [System.IO.FileMode]::CreateNew,
    [System.IO.FileAccess]::Write,
    [System.IO.FileShare]::None
  )
  try {
    $sourceStream.Position = 0
    $sourceStream.CopyTo($workingStream, 1048576)
    $workingStream.Flush($true)
  }
  finally {
    $workingStream.Dispose()
    $sourceStream.Position = 0
  }
  $workingSha256 = Get-FileSha256 $workingPath
  if ($workingSha256 -ne $lockedSha256) {
    throw "Working database copy SHA-256 does not match the locked source handle."
  }

  if ($faultMode -eq 'after-working-copy-wal') {
    $injected = "$sourcePath-wal"
    Write-Utf8ExclusiveDurable $injected 'fault injection'
    $injectedSidecars.Add($injected)
  }
  Assert-NoSidecars $sourcePath

  $leaseProof = [ordered]@{
    method = 'windows-file-share-none'
    sourcePath = $handleIdentity.finalPath
    sourceSha256 = $lockedSha256
    sourceSizeBytes = [uint64]$handleIdentity.sizeBytes
    volumeSerialNumber = [uint64]$handleIdentity.volumeSerialNumber
    fileIndexHigh = [uint64]$handleIdentity.fileIndexHigh
    fileIndexLow = [uint64]$handleIdentity.fileIndexLow
    hardLinkCount = [uint64]$handleIdentity.numberOfLinks
    workingCopySha256 = $workingSha256
    lockHeldThroughFinalPublish = $true
    publisher = 'powershell-create-hard-link'
  }
  Write-Utf8ExclusiveDurable $leaseProofPath "$(ConvertTo-Json $leaseProof -Depth 8 -Compress)`n"

  $childOutput = & ([string]$request.nodeExecutable) ([string]$request.migrationScriptPath) `
    '--execute-locked-plan' $requestFullPath 2>&1
  $childExitCode = $LASTEXITCODE
  if ($childExitCode -ne 0) {
    throw "Locked working-copy migration failed with exit code ${childExitCode}: $($childOutput -join [Environment]::NewLine)"
  }
  if (-not (Test-Path -LiteralPath $temporaryManifestPath -PathType Leaf)) {
    throw 'Locked working-copy migration did not produce its temporary manifest.'
  }

  if ($faultMode -eq 'before-publish-wal') {
    $injected = "$sourcePath-wal"
    Write-Utf8ExclusiveDurable $injected 'fault injection'
    $injectedSidecars.Add($injected)
  }
  Assert-NoSidecars $sourcePath
  if ((Get-StreamSha256 $sourceStream) -ne $lockedSha256 -or
      $sourceStream.Length -ne $handleIdentity.sizeBytes) {
    throw 'Locked source handle changed before manifest publication.'
  }
  $finalEntriesJson = ConvertTo-Json @(Get-DirectoryEntries $sourceDirectory) -Compress
  if ($finalEntriesJson -ne $expectedEntriesJson) {
    throw 'Source directory changed before manifest publication.'
  }

  $manifest = Get-Content -LiteralPath $temporaryManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($manifest.passed -ne $true -or
      ([string]$manifest.source.sha256).ToUpperInvariant() -ne $lockedSha256 -or
      ([string]$manifest.offlineLease.sourceSha256).ToUpperInvariant() -ne $lockedSha256 -or
      ([string]$manifest.workingDatabase.sourceCopySha256).ToUpperInvariant() -ne $workingSha256) {
    throw 'Temporary manifest is not bound to the locked source and working copy.'
  }
  if ($faultMode -eq 'before-publish-failure') {
    throw 'Injected failure after temporary manifest fsync and before publication.'
  }
  if ($faultMode -eq 'publish-conflict') {
    Write-Utf8ExclusiveDurable $manifestPath 'preexisting evidence'
    $createdFinalByFault = $true
  }
  if (Test-Path -LiteralPath $manifestPath) {
    throw "Output manifest already exists and will not be overwritten: $manifestPath"
  }
  if (-not [S7OfflineLeaseNative]::CreateHardLink(
    $manifestPath,
    $temporaryManifestPath,
    [IntPtr]::Zero
  )) {
    throw "Exclusive atomic manifest publication failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
  }
  $publishedByThisRun = $true
  Remove-OwnedFile $temporaryManifestPath
  $success = $true
  [Console]::Out.WriteLine((ConvertTo-Json ([ordered]@{
    passed = $true
    manifestPath = $manifestPath
    sourceSha256 = $lockedSha256
    workingCopySha256 = $workingSha256
  }) -Compress))
}
catch {
  $failure = $_
}
finally {
  foreach ($sidecar in $injectedSidecars) {
    Remove-OwnedFile $sidecar
  }
  if (-not $success) {
    if ($publishedByThisRun) {
      Remove-OwnedFile $manifestPath
    }
    Remove-OwnedFile $temporaryManifestPath
    Remove-OwnedFile $leaseProofPath
    Remove-OwnedFile $workingPath
    foreach ($suffix in @('-wal', '-shm', '-journal')) {
      Remove-OwnedFile "$workingPath$suffix"
    }
    Remove-OwnedFile "$workingPath.pre-upgrade-to-v$targetVersion.bak"
    Remove-OwnedFile "$workingPath.pre-upgrade-to-v$targetVersion.manifest.json"
    Remove-OwnedFile $restorePath
    foreach ($suffix in @('-wal', '-shm', '-journal')) {
      Remove-OwnedFile "$restorePath$suffix"
    }
  }
  else {
    Remove-OwnedFile $leaseProofPath
  }
  if ($sourceStream -ne $null) {
    $sourceStream.Dispose()
  }
}

if ($failure -ne $null) {
  [Console]::Error.WriteLine("[S7 OFFLINE LEASE BLOCKED] $($failure.Exception.Message)")
  exit 1
}

exit 0

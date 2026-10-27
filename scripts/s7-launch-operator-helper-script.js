// 按职责复用原有严格校验，公共入口继续保持兼容。

const { EXCLUSIVE_WINDOW_CREATE_COMMAND, EXCLUSIVE_WINDOW_PROTOCOL, EXCLUSIVE_WINDOW_RELEASE_COMMAND, STARTUP_GATE_ACTIVE_FILE, STARTUP_GATE_ACTIVE_KIND, STARTUP_GATE_ACTIVE_SCHEMA, STARTUP_GATE_ADMISSION_FILE, STARTUP_GATE_ADMISSION_KIND, STARTUP_GATE_ADMISSION_SCHEMA, STARTUP_GATE_BOUND_FILE, STARTUP_GATE_BOUND_KIND, STARTUP_GATE_BOUND_SCHEMA, STARTUP_GATE_CLOSED_FILE, STARTUP_GATE_CLOSED_KIND, STARTUP_GATE_CLOSED_SCHEMA, STARTUP_GATE_FINALIZED_FILE, STARTUP_GATE_HANDOFF_READY_FILE, STARTUP_GATE_HANDOFF_READY_KIND, STARTUP_GATE_HANDOFF_READY_SCHEMA, STARTUP_GATE_HANDOFF_RELEASED_FILE, STARTUP_GATE_HANDOFF_RELEASED_KIND, STARTUP_GATE_HANDOFF_RELEASED_SCHEMA, TRUSTED_INSTALLER_SID, TRUSTED_POWERSHELL_MAX_HARDLINKS } = require('./s7-launch-operator-contracts.js');

const EXCLUSIVE_WINDOW_HELPER_SCRIPT = String.raw `
$ErrorActionPreference='Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

public static class S7NativeLaunch {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct STARTUPINFO {
    public UInt32 cb;
    public string lpReserved;
    public string lpDesktop;
    public string lpTitle;
    public UInt32 dwX;
    public UInt32 dwY;
    public UInt32 dwXSize;
    public UInt32 dwYSize;
    public UInt32 dwXCountChars;
    public UInt32 dwYCountChars;
    public UInt32 dwFillAttribute;
    public UInt32 dwFlags;
    public UInt16 wShowWindow;
    public UInt16 cbReserved2;
    public IntPtr lpReserved2;
    public IntPtr hStdInput;
    public IntPtr hStdOutput;
    public IntPtr hStdError;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct PROCESS_INFORMATION {
    public IntPtr hProcess;
    public IntPtr hThread;
    public UInt32 dwProcessId;
    public UInt32 dwThreadId;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct FILETIME {
    public UInt32 Low;
    public UInt32 High;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct BY_HANDLE_FILE_INFORMATION {
    public UInt32 FileAttributes;
    public FILETIME CreationTime;
    public FILETIME LastAccessTime;
    public FILETIME LastWriteTime;
    public UInt32 VolumeSerialNumber;
    public UInt32 FileSizeHigh;
    public UInt32 FileSizeLow;
    public UInt32 NumberOfLinks;
    public UInt32 FileIndexHigh;
    public UInt32 FileIndexLow;
  }

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool CreateProcessW(
    string applicationName,
    StringBuilder commandLine,
    IntPtr processAttributes,
    IntPtr threadAttributes,
    bool inheritHandles,
    UInt32 creationFlags,
    IntPtr environment,
    string currentDirectory,
    ref STARTUPINFO startupInfo,
    out PROCESS_INFORMATION processInformation
  );

  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern UInt32 ResumeThread(IntPtr threadHandle);

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool QueryFullProcessImageNameW(
    IntPtr processHandle,
    UInt32 flags,
    StringBuilder executablePath,
    ref UInt32 size
  );

  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern UInt32 WaitForSingleObject(IntPtr handle, UInt32 milliseconds);

  [DllImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool GetExitCodeProcess(IntPtr processHandle, out UInt32 exitCode);

  [DllImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool GetFileInformationByHandle(
    SafeFileHandle fileHandle,
    out BY_HANDLE_FILE_INFORMATION information
  );

  [DllImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool CloseHandle(IntPtr handle);
}
'@

function Write-S7Proof([System.Collections.IDictionary]$proof) {
  [Console]::Out.WriteLine(($proof | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
}

function Decode-S7Value([string]$name) {
  $encoded=[Environment]::GetEnvironmentVariable($name)
  if ([string]::IsNullOrWhiteSpace($encoded)) { throw "missing-$name" }
  return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded))
}

function Get-S7ProcessImagePath([IntPtr]$processHandle) {
  $capacity=[uint32]32768
  $buffer=New-Object System.Text.StringBuilder ([int]$capacity)
  $size=$capacity
  if (![S7NativeLaunch]::QueryFullProcessImageNameW(
    $processHandle,
    [uint32]0,
    $buffer,
    [ref]$size
  )) {
    throw ('QueryFullProcessImageNameW-failed-' + [Runtime.InteropServices.Marshal]::GetLastWin32Error())
  }
  return $buffer.ToString()
}

function Get-S7FileIdentity([System.IO.FileStream]$stream) {
  $information=New-Object S7NativeLaunch+BY_HANDLE_FILE_INFORMATION
  if (![S7NativeLaunch]::GetFileInformationByHandle(
    $stream.SafeFileHandle,
    [ref]$information
  )) {
    throw ('GetFileInformationByHandle-failed-' + [Runtime.InteropServices.Marshal]::GetLastWin32Error())
  }
  $fileId=([uint64]$information.FileIndexHigh -shl 32) -bor [uint64]$information.FileIndexLow
  return [ordered]@{
    deviceId=[string][uint64]$information.VolumeSerialNumber
    fileId=[string]$fileId
    hardLinkCount=[int]$information.NumberOfLinks
  }
}

function Get-S7StreamArtifact(
  [System.IO.FileStream]$fileStream,
  [string]$filePath,
  [string]$knownSha256=$null,
  [bool]$allowServicingLinks=$false
) {
  $identity=Get-S7FileIdentity $fileStream
  if (
    (!$allowServicingLinks -and [int]$identity.hardLinkCount -ne 1) -or
    ($allowServicingLinks -and (
      [int]$identity.hardLinkCount -lt 1 -or
      [int]$identity.hardLinkCount -gt ${TRUSTED_POWERSHELL_MAX_HARDLINKS}
    ))
  ) { throw 'gate-artifact-hard-link-count-invalid' }
  $hash=$knownSha256
  if ([string]::IsNullOrWhiteSpace($hash)) {
    $position=$fileStream.Position
    $fileStream.Position=0
    $sha=[System.Security.Cryptography.SHA256]::Create()
    try {
      $hash=([BitConverter]::ToString($sha.ComputeHash($fileStream))).Replace('-','')
    } finally {
      $sha.Dispose()
      $fileStream.Position=$position
    }
  }
  return [ordered]@{
    realPath=[System.IO.Path]::GetFullPath($filePath)
    sha256=$hash
    sizeBytes=[int64]$fileStream.Length
    identity=$identity
  }
}

function Get-S7TrustedShellArtifact([string]$filePath) {
  $fullPath=[System.IO.Path]::GetFullPath($filePath)
  $fileInfo=[System.IO.FileInfo]::new($fullPath)
  if (
    !$fileInfo.Exists -or
    ($fileInfo.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0
  ) { throw 'trusted-shell-file-invalid' }
  $fileStream=[System.IO.File]::Open(
    $fullPath,
    [System.IO.FileMode]::Open,
    [System.IO.FileAccess]::Read,
    ([System.IO.FileShare]::Read -bor [System.IO.FileShare]::Delete)
  )
  try {
    return Get-S7StreamArtifact $fileStream $fullPath $null $true
  } finally {
    $fileStream.Dispose()
  }
}

function Get-S7FileArtifact([string]$filePath) {
  $fullPath=[System.IO.Path]::GetFullPath($filePath)
  $fileInfo=[System.IO.FileInfo]::new($fullPath)
  if (!$fileInfo.Exists) { throw 'gate-artifact-missing' }
  if (($fileInfo.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'gate-artifact-reparse-point'
  }
  $fileStream=[System.IO.File]::Open(
    $fullPath,
    [System.IO.FileMode]::Open,
    [System.IO.FileAccess]::Read,
    ([System.IO.FileShare]::Read -bor [System.IO.FileShare]::Delete)
  )
  try {
    return Get-S7StreamArtifact $fileStream $fullPath
  } finally {
    $fileStream.Dispose()
  }
}

function Protect-S7Path([string]$targetPath,[bool]$directory) {
  $current=[System.Security.Principal.WindowsIdentity]::GetCurrent().User
  $system=[System.Security.Principal.SecurityIdentifier]::new('S-1-5-18')
  $admins=[System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
  if ($directory) {
    $acl=New-Object System.Security.AccessControl.DirectorySecurity
    $inherit=(
      [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
      [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
    )
  } else {
    $acl=New-Object System.Security.AccessControl.FileSecurity
    $inherit=[System.Security.AccessControl.InheritanceFlags]::None
  }
  $acl.SetOwner($current)
  $acl.SetAccessRuleProtection($true,$false)
  foreach ($sid in @($current,$system,$admins)) {
    $rule=[System.Security.AccessControl.FileSystemAccessRule]::new(
      $sid,
      [System.Security.AccessControl.FileSystemRights]::FullControl,
      $inherit,
      [System.Security.AccessControl.PropagationFlags]::None,
      [System.Security.AccessControl.AccessControlType]::Allow
    )
    [void]$acl.AddAccessRule($rule)
  }
  if ($directory) {
    [System.IO.Directory]::SetAccessControl($targetPath,$acl)
  } else {
    [System.IO.File]::SetAccessControl($targetPath,$acl)
  }
}

function Assert-S7PathSecurity([string]$targetPath,[bool]$directory) {
  $current=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  if ($directory) {
    $info=[System.IO.DirectoryInfo]::new($targetPath)
    if (!$info.Exists) { throw 'gate-directory-missing' }
    if (($info.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw 'gate-directory-reparse-point'
    }
    $acl=[System.IO.Directory]::GetAccessControl($targetPath)
  } else {
    $info=[System.IO.FileInfo]::new($targetPath)
    if (!$info.Exists) { throw 'gate-file-missing' }
    if (($info.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw 'gate-file-reparse-point'
    }
    $acl=[System.IO.File]::GetAccessControl($targetPath)
  }
  if (
    $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $current -or
    !$acl.AreAccessRulesProtected
  ) {
    throw 'gate-path-owner-or-inheritance-invalid'
  }
  $rules=@($acl.GetAccessRules(
    $true,
    $true,
    [System.Security.Principal.SecurityIdentifier]
  ))
  $required=@($current,'S-1-5-18','S-1-5-32-544') | Sort-Object -Unique
  $seen=@()
  foreach ($rule in $rules) {
    $sid=$rule.IdentityReference.Value
    $seen += $sid
    if (
      $rule.IsInherited -or
      $rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow -or
      $required -notcontains $sid -or
      (([int64]$rule.FileSystemRights -band 2032127) -ne 2032127)
    ) {
      throw 'gate-path-acl-rule-invalid'
    }
  }
  $seen=@($seen | Sort-Object -Unique)
  if ($seen.Count -ne $required.Count) { throw 'gate-path-principal-set-invalid' }
  for ($index=0; $index -lt $required.Count; $index++) {
    if ($seen[$index] -ne $required[$index]) { throw 'gate-path-principal-set-invalid' }
  }
}

function Write-S7ExclusiveJson([string]$targetPath,[object]$value) {
  $json=$value | ConvertTo-Json -Compress -Depth 20
  $bytes=(New-Object System.Text.UTF8Encoding($false)).GetBytes($json + [Environment]::NewLine)
  $fileStream=[System.IO.File]::Open(
    $targetPath,
    [System.IO.FileMode]::CreateNew,
    [System.IO.FileAccess]::Write,
    [System.IO.FileShare]::None
  )
  try {
    $fileStream.Write($bytes,0,$bytes.Length)
    $fileStream.Flush($true)
  } finally {
    $fileStream.Dispose()
  }
  Protect-S7Path $targetPath $false
  Assert-S7PathSecurity $targetPath $false
  return Get-S7FileArtifact $targetPath
}

function Assert-S7ArtifactBinding([object]$actual,[object]$expected,[string]$label) {
  if (
    $null -eq $expected -or
    ![StringComparer]::OrdinalIgnoreCase.Equals(
      [System.IO.Path]::GetFullPath([string]$actual.realPath),
      [System.IO.Path]::GetFullPath([string]$expected.realPath)
    ) -or
    ![StringComparer]::OrdinalIgnoreCase.Equals(
      [string]$actual.sha256,
      [string]$expected.sha256
    ) -or
    [int64]$actual.sizeBytes -ne [int64]$expected.sizeBytes -or
    [string]$actual.identity.deviceId -ne [string]$expected.identity.deviceId -or
    [string]$actual.identity.fileId -ne [string]$expected.identity.fileId -or
    [int]$actual.identity.hardLinkCount -ne 1 -or
    [int]$expected.identity.hardLinkCount -ne 1
  ) {
    throw ($label + '-binding-mismatch')
  }
}

function Assert-S7TrustedShellBinding([object]$expected) {
  $trustedShellPath=[System.IO.Path]::GetFullPath(
    (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe')
  )
  $actual=Get-S7TrustedShellArtifact $trustedShellPath
  if (
    $null -eq $expected -or
    ![StringComparer]::OrdinalIgnoreCase.Equals(
      [string]$actual.realPath,
      [System.IO.Path]::GetFullPath([string]$expected.realPath)
    ) -or
    ![StringComparer]::OrdinalIgnoreCase.Equals(
      [string]$actual.sha256,
      [string]$expected.sha256
    ) -or
    [int64]$actual.sizeBytes -ne [int64]$expected.sizeBytes -or
    [string]$actual.identity.deviceId -ne [string]$expected.identity.deviceId -or
    [string]$actual.identity.fileId -ne [string]$expected.identity.fileId -or
    [int]$actual.identity.hardLinkCount -ne [int]$expected.identity.hardLinkCount
  ) { throw 'trusted-shell-artifact-binding-mismatch' }
  $signature=Get-AuthenticodeSignature -LiteralPath $trustedShellPath
  $version=[Diagnostics.FileVersionInfo]::GetVersionInfo($trustedShellPath)
  # Localized MUI FileVersion text may differ from the signed executable's fixed version.
  $fixedFileVersion=[string]::Join('.',@($version.FileMajorPart,$version.FileMinorPart,$version.FileBuildPart,$version.FilePrivatePart))
  if (
    $signature.Status.ToString() -ne 'Valid' -or
    [string]$signature.SignerCertificate.Subject -ne [string]$expected.signature.subject -or
    ![StringComparer]::OrdinalIgnoreCase.Equals(
      [string]$signature.SignerCertificate.Thumbprint,
      [string]$expected.signature.thumbprint
    ) -or
    [string]$version.CompanyName -ne [string]$expected.version.companyName -or
    [string]$fixedFileVersion -ne [string]$expected.version.fileVersion -or
    [string]$version.OriginalFilename -ne [string]$expected.version.originalFilename
  ) { throw 'trusted-shell-signature-version-binding-mismatch' }
  $acl=[System.IO.File]::GetAccessControl($trustedShellPath)
  $owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
  if (
    @(
      '${TRUSTED_INSTALLER_SID}',
      'S-1-5-18'
    ) -notcontains $owner -or
    !$acl.AreAccessRulesProtected
  ) { throw 'trusted-shell-owner-acl-invalid' }
  return $actual
}

$phase='decode-input'
$databasePath=Decode-S7Value 'AAO_S7_EXCLUSIVE_DB_B64'
$executablePath=Decode-S7Value 'AAO_S7_EXECUTABLE_B64'
$workingDirectory=Decode-S7Value 'AAO_S7_WORKING_DIRECTORY_B64'
[Environment]::SetEnvironmentVariable('AAO_S7_EXCLUSIVE_DB_B64',$null)
[Environment]::SetEnvironmentVariable('AAO_S7_EXECUTABLE_B64',$null)
[Environment]::SetEnvironmentVariable('AAO_S7_WORKING_DIRECTORY_B64',$null)

$stream=$null
$databaseHandleAcquired=$false
$databaseHandleReleased=$false
$processInformation=New-Object S7NativeLaunch+PROCESS_INFORMATION
$processCreated=$false
$observedExitCode=$null
$processResumed=$false
try {
  $phase='open-exclusive-database'
  $stream=[System.IO.File]::Open(
    $databasePath,
    [System.IO.FileMode]::Open,
    [System.IO.FileAccess]::Read,
    [System.IO.FileShare]::None
  )
  $databaseHandleAcquired=$true
  $sha=[System.Security.Cryptography.SHA256]::Create()
  try {
    $hash=([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','')
  } finally {
    $sha.Dispose()
  }
  $databaseArtifact=Get-S7StreamArtifact $stream $stream.Name $hash
  Write-S7Proof ([ordered]@{
    protocol='${EXCLUSIVE_WINDOW_PROTOCOL}'
    status='READY'
    helperPid=[int]$PID
    path=$stream.Name
    sha256=$hash
    sizeBytes=[int64]$stream.Length
    openedAt=(Get-Date).ToUniversalTime().ToString('o')
    databaseHandleExclusive=$true
  })

  $phase='await-create-command'
  $request=[Console]::In.ReadLine()
  $createPrefix='${EXCLUSIVE_WINDOW_CREATE_COMMAND} '
  if (
    [string]::IsNullOrWhiteSpace($request) -or
    !$request.StartsWith($createPrefix,[StringComparison]::Ordinal)
  ) {
    throw 'exclusive-window-create-command-not-confirmed'
  }

  $phase='validate-startup-gate-plan'
  $encodedPlan=$request.Substring($createPrefix.Length)
  try {
    $planJson=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encodedPlan))
    $gatePlan=$planJson | ConvertFrom-Json
  } catch {
    throw 'startup-gate-plan-invalid'
  }
  $activeDocument=$gatePlan.activeDocument
  $gateDirectory=[System.IO.Path]::GetFullPath([string]$gatePlan.gateDirectory)
  $activePath=[System.IO.Path]::GetFullPath([string]$gatePlan.activePath)
  $boundPath=[System.IO.Path]::GetFullPath([string]$gatePlan.boundPath)
  $handoffReadyPath=[System.IO.Path]::GetFullPath([string]$gatePlan.handoffReadyPath)
  $handoffReleasedPath=[System.IO.Path]::GetFullPath([string]$gatePlan.handoffReleasedPath)
  $admissionPath=[System.IO.Path]::GetFullPath([string]$gatePlan.admissionPath)
  $closedPath=[System.IO.Path]::GetFullPath([string]$gatePlan.closedPath)
  $finalizedPath=[System.IO.Path]::GetFullPath([string]$gatePlan.finalizedPath)
  if (
    $null -eq $activeDocument -or
    $activeDocument.kind -ne '${STARTUP_GATE_ACTIVE_KIND}' -or
    $activeDocument.schemaVersion -ne '${STARTUP_GATE_ACTIVE_SCHEMA}' -or
    $activeDocument.status -ne 'ACTIVE_AWAITING_BOUND_CHILD' -or
    [string]$activeDocument.gateId -ne [string]$gatePlan.gateId -or
    [string]$activeDocument.invocationId -ne [string]$gatePlan.invocationId -or
    ![StringComparer]::OrdinalIgnoreCase.Equals(
      [System.IO.Path]::GetFullPath([string]$activeDocument.paths.active),
      $activePath
    ) -or
    ![StringComparer]::OrdinalIgnoreCase.Equals(
      [System.IO.Path]::GetFullPath([string]$activeDocument.paths.bound),
      $boundPath
    ) -or
    ![StringComparer]::OrdinalIgnoreCase.Equals(
      [System.IO.Path]::GetFullPath([string]$activeDocument.paths.handoffReady),
      $handoffReadyPath
    ) -or
    ![StringComparer]::OrdinalIgnoreCase.Equals(
      [System.IO.Path]::GetFullPath([string]$activeDocument.paths.handoffReleased),
      $handoffReleasedPath
    ) -or
    ![StringComparer]::OrdinalIgnoreCase.Equals(
      [System.IO.Path]::GetFullPath([string]$activeDocument.paths.admission),
      $admissionPath
    ) -or
    ![StringComparer]::OrdinalIgnoreCase.Equals(
      [System.IO.Path]::GetFullPath([string]$activeDocument.paths.closed),
      $closedPath
    ) -or
    ![StringComparer]::OrdinalIgnoreCase.Equals(
      [System.IO.Path]::GetFullPath([string]$activeDocument.paths.finalized),
      $finalizedPath
    ) -or
    ![StringComparer]::OrdinalIgnoreCase.Equals(
      [System.IO.Path]::GetDirectoryName($activePath),
      $gateDirectory
    ) -or
    ![StringComparer]::OrdinalIgnoreCase.Equals(
      [System.IO.Path]::GetFileName($activePath),
      '${STARTUP_GATE_ACTIVE_FILE}'
    ) -or
    ![StringComparer]::OrdinalIgnoreCase.Equals(
      [System.IO.Path]::GetFileName($boundPath),
      '${STARTUP_GATE_BOUND_FILE}'
    ) -or
    ![StringComparer]::OrdinalIgnoreCase.Equals(
      [System.IO.Path]::GetFileName($handoffReadyPath),
      '${STARTUP_GATE_HANDOFF_READY_FILE}'
    ) -or
    ![StringComparer]::OrdinalIgnoreCase.Equals(
      [System.IO.Path]::GetFileName($handoffReleasedPath),
      '${STARTUP_GATE_HANDOFF_RELEASED_FILE}'
    ) -or
    ![StringComparer]::OrdinalIgnoreCase.Equals(
      [System.IO.Path]::GetFileName($admissionPath),
      '${STARTUP_GATE_ADMISSION_FILE}'
    ) -or
    ![StringComparer]::OrdinalIgnoreCase.Equals(
      [System.IO.Path]::GetFileName($closedPath),
      '${STARTUP_GATE_CLOSED_FILE}'
    ) -or
    ![StringComparer]::OrdinalIgnoreCase.Equals(
      [System.IO.Path]::GetFileName($finalizedPath),
      '${STARTUP_GATE_FINALIZED_FILE}'
    ) -or
    [System.IO.File]::Exists($activePath) -or
    [System.IO.File]::Exists($boundPath) -or
    [System.IO.File]::Exists($handoffReadyPath) -or
    [System.IO.File]::Exists($handoffReleasedPath) -or
    [System.IO.File]::Exists($admissionPath) -or
    [System.IO.File]::Exists($closedPath) -or
    [System.IO.File]::Exists($finalizedPath)
  ) {
    throw 'startup-gate-plan-binding-invalid'
  }
  Assert-S7PathSecurity $gateDirectory $true
  $executableArtifact=Get-S7FileArtifact $executablePath
  $mainArtifact=Get-S7FileArtifact ([string]$activeDocument.bindings.package.main.realPath)
  $intentArtifact=Get-S7FileArtifact ([string]$activeDocument.bindings.intent.realPath)
  Assert-S7ArtifactBinding $executableArtifact $activeDocument.bindings.executable 'executable'
  Assert-S7ArtifactBinding $executableArtifact $activeDocument.bindings.package.exe 'package-executable'
  Assert-S7ArtifactBinding $mainArtifact $activeDocument.bindings.package.main 'package-main'
  Assert-S7ArtifactBinding $databaseArtifact $activeDocument.bindings.database 'database'
  Assert-S7ArtifactBinding $intentArtifact $activeDocument.bindings.intent 'intent'
  $trustedShellArtifact=Assert-S7TrustedShellBinding $activeDocument.bindings.shell

  $phase='create-active-startup-gate'
  $activeArtifact=Write-S7ExclusiveJson $activePath $activeDocument
  [Environment]::SetEnvironmentVariable(
    'AAO_S7_STARTUP_GATE_ACTIVE_PATH_B64',
    [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($activePath))
  )
  [Environment]::SetEnvironmentVariable(
    'AAO_S7_STARTUP_GATE_ACTIVE_SHA256',
    [string]$activeArtifact.sha256
  )
  [Environment]::SetEnvironmentVariable(
    'AAO_S7_STARTUP_GATE_ACTIVE_DEVICE_ID',
    [string]$activeArtifact.identity.deviceId
  )
  [Environment]::SetEnvironmentVariable(
    'AAO_S7_STARTUP_GATE_ACTIVE_FILE_ID',
    [string]$activeArtifact.identity.fileId
  )
  [Environment]::SetEnvironmentVariable(
    'AAO_S7_STARTUP_GATE_ID',
    [string]$activeDocument.gateId
  )
  [Environment]::SetEnvironmentVariable(
    'AAO_S7_STARTUP_INVOCATION_ID',
    [string]$activeDocument.invocationId
  )

  $phase='create-suspended-process'
  $startupInfo=New-Object S7NativeLaunch+STARTUPINFO
  $startupInfo.cb=[uint32][Runtime.InteropServices.Marshal]::SizeOf(
    [type][S7NativeLaunch+STARTUPINFO]
  )
  $commandLine=New-Object System.Text.StringBuilder ('"' + $executablePath + '"')
  $created=[S7NativeLaunch]::CreateProcessW(
    $executablePath,
    $commandLine,
    [IntPtr]::Zero,
    [IntPtr]::Zero,
    $false,
    [uint32]0x00000004,
    [IntPtr]::Zero,
    $workingDirectory,
    [ref]$startupInfo,
    [ref]$processInformation
  )
  if (!$created) {
    throw ('CreateProcessW-failed-' + [Runtime.InteropServices.Marshal]::GetLastWin32Error())
  }
  $processCreated=$true
  foreach ($name in @(
    'AAO_S7_STARTUP_GATE_ACTIVE_PATH_B64',
    'AAO_S7_STARTUP_GATE_ACTIVE_SHA256',
    'AAO_S7_STARTUP_GATE_ACTIVE_DEVICE_ID',
    'AAO_S7_STARTUP_GATE_ACTIVE_FILE_ID',
    'AAO_S7_STARTUP_GATE_ID',
    'AAO_S7_STARTUP_INVOCATION_ID'
  )) {
    [Environment]::SetEnvironmentVariable($name,$null)
  }
  $queriedExecutablePath=Get-S7ProcessImagePath $processInformation.hProcess
  if (![StringComparer]::OrdinalIgnoreCase.Equals(
    [System.IO.Path]::GetFullPath($queriedExecutablePath),
    [System.IO.Path]::GetFullPath($executablePath)
  )) {
    throw 'created-process-image-mismatch'
  }
  $phase='bind-suspended-child-startup-gate'
  $boundAt=(Get-Date).ToUniversalTime().ToString('o')
  $boundDocument=[ordered]@{
    kind='${STARTUP_GATE_BOUND_KIND}'
    schemaVersion='${STARTUP_GATE_BOUND_SCHEMA}'
    status='BOUND_SUSPENDED'
    gateId=[string]$activeDocument.gateId
    invocationId=[string]$activeDocument.invocationId
    boundAt=$boundAt
    pid=[int]$processInformation.dwProcessId
    threadId=[int]$processInformation.dwThreadId
    activeGate=$activeArtifact
    bindings=$activeDocument.bindings
  }
  $boundArtifact=Write-S7ExclusiveJson $boundPath $boundDocument
  Write-S7Proof ([ordered]@{
    protocol='${EXCLUSIVE_WINDOW_PROTOCOL}'
    status='SPAWNED'
    helperPid=[int]$PID
    pid=[int]$processInformation.dwProcessId
    threadId=[int]$processInformation.dwThreadId
    executablePath=$executablePath
    queriedExecutablePath=$queriedExecutablePath
    processImageQueryPassed=$true
    createdSuspended=$true
    databaseHandleExclusive=$true
    createdAt=(Get-Date).ToUniversalTime().ToString('o')
    startupGateId=[string]$activeDocument.gateId
    startupGateInvocationId=[string]$activeDocument.invocationId
    startupGateActivePath=$activeArtifact.realPath
    startupGateActiveSha256=$activeArtifact.sha256
    startupGateActiveDeviceId=$activeArtifact.identity.deviceId
    startupGateActiveFileId=$activeArtifact.identity.fileId
    startupGateBoundPath=$boundArtifact.realPath
    startupGateBoundSha256=$boundArtifact.sha256
    startupGateBoundDeviceId=$boundArtifact.identity.deviceId
    startupGateBoundFileId=$boundArtifact.identity.fileId
    startupGateHandoffReadyPath=$handoffReadyPath
    startupGateHandoffReleasedPath=$handoffReleasedPath
    startupGateAdmissionPath=$admissionPath
    startupGateClosedPath=$closedPath
    startupGateFinalizedPath=$finalizedPath
    trustedShellPath=$trustedShellArtifact.realPath
    trustedShellSha256=$trustedShellArtifact.sha256
    trustedShellDeviceId=$trustedShellArtifact.identity.deviceId
    trustedShellFileId=$trustedShellArtifact.identity.fileId
    trustedShellHardLinkCount=$trustedShellArtifact.identity.hardLinkCount
    startupGateWindowsSecurityPassed=$true
  })

  $phase='await-release-command'
  $request=[Console]::In.ReadLine()
  if ($request -ne '${EXCLUSIVE_WINDOW_RELEASE_COMMAND}') {
    throw 'exclusive-window-release-command-not-confirmed'
  }

  $phase='final-same-name-process-inventory'
  $expectedName=[System.IO.Path]::GetFileName($executablePath)
  $escapedName=$expectedName.Replace("'","''")
  $matching=@(
    Get-CimInstance Win32_Process -Filter ("Name='" + $escapedName + "'") |
      Select-Object ProcessId
  )
  if ($matching.Count -ne 1) {
    throw ('final-same-name-process-count-' + $matching.Count)
  }
  $candidate=$matching[0]
  if (
    [int]$candidate.ProcessId -ne [int]$processInformation.dwProcessId
  ) {
    throw 'final-same-name-process-identity-mismatch'
  }
  $finalQueriedExecutablePath=Get-S7ProcessImagePath $processInformation.hProcess
  if (![StringComparer]::OrdinalIgnoreCase.Equals(
    [System.IO.Path]::GetFullPath($finalQueriedExecutablePath),
    [System.IO.Path]::GetFullPath($executablePath)
  )) {
    throw 'final-process-image-mismatch'
  }
  $finalInventoryAt=(Get-Date).ToUniversalTime().ToString('o')

  $phase='resume-child-await-main-handoff'
  $resumeResult=[S7NativeLaunch]::ResumeThread($processInformation.hThread)
  if ($resumeResult -eq [uint32]::MaxValue) {
    throw ('ResumeThread-failed-' + [Runtime.InteropServices.Marshal]::GetLastWin32Error())
  }
  $processResumed=$true
  $actualResumedAt=(Get-Date).ToUniversalTime().ToString('o')
  $handoffTimer=[Diagnostics.Stopwatch]::StartNew()
  $handoffReadyArtifact=$null
  while (
    $null -eq $handoffReadyArtifact -and
    $handoffTimer.ElapsedMilliseconds -lt 45000
  ) {
    if ([System.IO.File]::Exists($handoffReadyPath)) {
      try {
        Assert-S7PathSecurity $handoffReadyPath $false
        $handoffReadyArtifact=Get-S7FileArtifact $handoffReadyPath
      } catch {
        $handoffReadyArtifact=$null
      }
    }
    if ($null -eq $handoffReadyArtifact) {
      Start-Sleep -Milliseconds 25
    }
  }
  $handoffTimer.Stop()
  if ($null -eq $handoffReadyArtifact) {
    throw 'main-handoff-ready-not-secure-before-timeout'
  }
  $phase='validate-main-handoff-ready'
  try {
    $handoffReady=[System.IO.File]::ReadAllText(
      $handoffReadyPath,
      (New-Object System.Text.UTF8Encoding($false))
    ) | ConvertFrom-Json
  } catch {
    throw 'main-handoff-ready-invalid-json'
  }
  if (
    $handoffReady.kind -ne '${STARTUP_GATE_HANDOFF_READY_KIND}' -or
    $handoffReady.schemaVersion -ne '${STARTUP_GATE_HANDOFF_READY_SCHEMA}' -or
    $handoffReady.status -ne 'READY_FOR_DB_HANDOFF' -or
    [int]$handoffReady.pid -ne [int]$processInformation.dwProcessId -or
    [string]$handoffReady.gateId -ne [string]$activeDocument.gateId -or
    [string]$handoffReady.invocationId -ne [string]$activeDocument.invocationId -or
    $handoffReady.singleInstanceLockAcquired -ne $true
  ) {
    throw 'main-handoff-ready-binding-invalid'
  }
  Assert-S7ArtifactBinding $activeArtifact $handoffReady.activeGate 'handoff-ready-active'
  Assert-S7ArtifactBinding $boundArtifact $handoffReady.boundGate 'handoff-ready-bound'
  Assert-S7ArtifactBinding $executableArtifact $handoffReady.executable 'handoff-ready-executable'
  Assert-S7ArtifactBinding $mainArtifact $handoffReady.main 'handoff-ready-main'
  Assert-S7ArtifactBinding $intentArtifact $handoffReady.intent 'handoff-ready-intent'
  [void](Assert-S7TrustedShellBinding $handoffReady.shell)
  if (
    [string]$handoffReady.package.appContent.sha256 -ne
      [string]$activeDocument.bindings.package.appContent.sha256 -or
    [int]$handoffReady.package.appContent.fileCount -ne
      [int]$activeDocument.bindings.package.appContent.fileCount -or
    [int64]$handoffReady.package.appContent.sizeBytes -ne
      [int64]$activeDocument.bindings.package.appContent.sizeBytes
  ) {
    throw 'main-handoff-ready-package-binding-invalid'
  }

  $phase='release-database-handoff'
  $stream.Dispose()
  $stream=$null
  $databaseHandleReleased=$true
  $releasedAt=(Get-Date).ToUniversalTime().ToString('o')
  $handoffReleasedDocument=[ordered]@{
    kind='${STARTUP_GATE_HANDOFF_RELEASED_KIND}'
    schemaVersion='${STARTUP_GATE_HANDOFF_RELEASED_SCHEMA}'
    status='DB_HANDLE_RELEASED'
    releasedAt=$releasedAt
    helperPid=[int]$PID
    pid=[int]$processInformation.dwProcessId
    gateId=[string]$activeDocument.gateId
    invocationId=[string]$activeDocument.invocationId
    activeGate=$activeArtifact
    boundGate=$boundArtifact
    handoffReady=$handoffReadyArtifact
    database=$databaseArtifact
    shell=$activeDocument.bindings.shell
  }
  $handoffReleasedArtifact=Write-S7ExclusiveJson $handoffReleasedPath $handoffReleasedDocument
  Write-S7Proof ([ordered]@{
    protocol='${EXCLUSIVE_WINDOW_PROTOCOL}'
    status='RESUMED'
    helperPid=[int]$PID
    pid=[int]$processInformation.dwProcessId
    releasedAt=$releasedAt
    resumedAt=$actualResumedAt
    databaseHandleExclusive=$false
    resumeResult=[uint32]$resumeResult
    finalSameNameInventoryPassed=$true
    finalSameNameProcessCount=[int]$matching.Count
    finalSameNameInventoryAt=$finalInventoryAt
    finalQueriedExecutablePath=$finalQueriedExecutablePath
    finalProcessImageQueryPassed=$true
    startupGateId=[string]$activeDocument.gateId
    startupGateInvocationId=[string]$activeDocument.invocationId
    startupGateActiveSha256=$activeArtifact.sha256
    startupGateBoundSha256=$boundArtifact.sha256
    startupGateHandoffReadyPath=$handoffReadyArtifact.realPath
    startupGateHandoffReadySha256=$handoffReadyArtifact.sha256
    startupGateHandoffReadyDeviceId=$handoffReadyArtifact.identity.deviceId
    startupGateHandoffReadyFileId=$handoffReadyArtifact.identity.fileId
    startupGateHandoffReleasedPath=$handoffReleasedArtifact.realPath
    startupGateHandoffReleasedSha256=$handoffReleasedArtifact.sha256
    startupGateHandoffReleasedDeviceId=$handoffReleasedArtifact.identity.deviceId
    startupGateHandoffReleasedFileId=$handoffReleasedArtifact.identity.fileId
    trustedShellSha256=$trustedShellArtifact.sha256
  })

  $phase='wait-for-process-close'
  $waitResult=[S7NativeLaunch]::WaitForSingleObject(
    $processInformation.hProcess,
    [uint32]::MaxValue
  )
  if ($waitResult -ne 0) {
    throw ('WaitForSingleObject-failed-' + $waitResult)
  }
  $exitCode=[uint32]0
  if (![S7NativeLaunch]::GetExitCodeProcess($processInformation.hProcess,[ref]$exitCode)) {
    throw ('GetExitCodeProcess-failed-' + [Runtime.InteropServices.Marshal]::GetLastWin32Error())
  }
  $observedExitCode=[long]$exitCode
  if ($exitCode -ne 0) {
    $phase='child-exit-failed-before-closed-receipt'
    throw ('approved-child-exit-code-' + $exitCode)
  }

  $phase='validate-main-admission-receipt'
  Assert-S7PathSecurity $admissionPath $false
  $admissionArtifact=Get-S7FileArtifact $admissionPath
  try {
    $admission=[System.IO.File]::ReadAllText(
      $admissionPath,
      (New-Object System.Text.UTF8Encoding($false))
    ) | ConvertFrom-Json
  } catch {
    throw 'main-admission-receipt-invalid-json'
  }
  if (
    $admission.kind -ne '${STARTUP_GATE_ADMISSION_KIND}' -or
    $admission.schemaVersion -ne '${STARTUP_GATE_ADMISSION_SCHEMA}' -or
    $admission.status -ne 'ADMITTED_UNDER_EXCLUSIVE_SQLITE_LOCK' -or
    [int]$admission.pid -ne [int]$processInformation.dwProcessId -or
    [string]$admission.gateId -ne [string]$activeDocument.gateId -or
    [string]$admission.invocationId -ne [string]$activeDocument.invocationId -or
    $admission.singleInstanceLockAcquired -ne $true
  ) {
    throw 'main-admission-receipt-binding-invalid'
  }
  Assert-S7ArtifactBinding $activeArtifact $admission.activeGate 'admission-active-gate'
  Assert-S7ArtifactBinding $boundArtifact $admission.boundGate 'admission-bound-gate'
  Assert-S7ArtifactBinding $handoffReadyArtifact $admission.handoffReady 'admission-ready'
  Assert-S7ArtifactBinding $handoffReleasedArtifact $admission.handoffReleased 'admission-released'
  Assert-S7ArtifactBinding $executableArtifact $admission.executable 'admission-executable'
  Assert-S7ArtifactBinding $mainArtifact $admission.main 'admission-main'
  Assert-S7ArtifactBinding $databaseArtifact $admission.database 'admission-database'
  Assert-S7ArtifactBinding $intentArtifact $admission.intent 'admission-intent'
  [void](Assert-S7TrustedShellBinding $admission.shell)
  if (
    $admission.sqliteTakeover.fileMustExist -ne $true -or
    [string]$admission.sqliteTakeover.lockingMode -ne 'exclusive' -or
    [string]$admission.sqliteTakeover.beginMode -ne 'exclusive' -or
    $admission.sqliteTakeover.transactionActive -ne $true -or
    $admission.sqliteTakeover.sameConnectionRequiredForMigration -ne $true -or
    @(0, 11) -notcontains [int]$admission.sqliteTakeover.schemaVersionBefore
  ) {
    throw 'main-admission-sqlite-takeover-invalid'
  }
  Assert-S7PathSecurity $databasePath $false
  $databaseAfterClose=Get-S7FileArtifact $databasePath

  $phase='write-closed-receipt'
  $closedAt=(Get-Date).ToUniversalTime().ToString('o')
  $closedDocument=[ordered]@{
    kind='${STARTUP_GATE_CLOSED_KIND}'
    schemaVersion='${STARTUP_GATE_CLOSED_SCHEMA}'
    status='CLOSED_AFTER_GUARDED_MIGRATION'
    closedAt=$closedAt
    helperPid=[int]$PID
    pid=[int]$processInformation.dwProcessId
    exitCode=[uint32]$exitCode
    gateId=[string]$activeDocument.gateId
    invocationId=[string]$activeDocument.invocationId
    activeGate=$activeArtifact
    boundGate=$boundArtifact
    handoffReady=$handoffReadyArtifact
    handoffReleased=$handoffReleasedArtifact
    admission=$admissionArtifact
    databaseAfterClose=$databaseAfterClose
    shell=$activeDocument.bindings.shell
  }
  $closedArtifact=Write-S7ExclusiveJson $closedPath $closedDocument
  Write-S7Proof ([ordered]@{
    protocol='${EXCLUSIVE_WINDOW_PROTOCOL}'
    status='CLOSED'
    helperPid=[int]$PID
    pid=[int]$processInformation.dwProcessId
    exitCode=[uint32]$exitCode
    signal=$null
    closedAt=$closedAt
    databaseHandleExclusive=$false
    startupGateId=[string]$activeDocument.gateId
    startupGateInvocationId=[string]$activeDocument.invocationId
    startupGateActivePath=$activeArtifact.realPath
    startupGateActiveSha256=$activeArtifact.sha256
    startupGateActiveDeviceId=$activeArtifact.identity.deviceId
    startupGateActiveFileId=$activeArtifact.identity.fileId
    startupGateBoundPath=$boundArtifact.realPath
    startupGateBoundSha256=$boundArtifact.sha256
    startupGateBoundDeviceId=$boundArtifact.identity.deviceId
    startupGateBoundFileId=$boundArtifact.identity.fileId
    startupGateHandoffReadyPath=$handoffReadyArtifact.realPath
    startupGateHandoffReadySha256=$handoffReadyArtifact.sha256
    startupGateHandoffReadyDeviceId=$handoffReadyArtifact.identity.deviceId
    startupGateHandoffReadyFileId=$handoffReadyArtifact.identity.fileId
    startupGateHandoffReleasedPath=$handoffReleasedArtifact.realPath
    startupGateHandoffReleasedSha256=$handoffReleasedArtifact.sha256
    startupGateHandoffReleasedDeviceId=$handoffReleasedArtifact.identity.deviceId
    startupGateHandoffReleasedFileId=$handoffReleasedArtifact.identity.fileId
    startupGateAdmissionPath=$admissionArtifact.realPath
    startupGateAdmissionSha256=$admissionArtifact.sha256
    startupGateAdmissionDeviceId=$admissionArtifact.identity.deviceId
    startupGateAdmissionFileId=$admissionArtifact.identity.fileId
    startupGateClosedPath=$closedArtifact.realPath
    startupGateClosedSha256=$closedArtifact.sha256
    startupGateClosedDeviceId=$closedArtifact.identity.deviceId
    startupGateClosedFileId=$closedArtifact.identity.fileId
    startupGateAdmissionVerified=$true
    databaseAfterCloseSha256=$databaseAfterClose.sha256
    trustedShellSha256=$trustedShellArtifact.sha256
    startupGateWindowsSecurityPassed=$true
  })
} catch {
  $errorPid=$null
  if ($processCreated) { $errorPid=[int]$processInformation.dwProcessId }
  $releaseState='NOT_RELEASED'
  if ($databaseHandleReleased) { $releaseState='RELEASED' }
  Write-S7Proof ([ordered]@{
    protocol='${EXCLUSIVE_WINDOW_PROTOCOL}'
    status='ERROR'
    helperPid=[int]$PID
    pid=$errorPid
    phase=$phase
    processCreated=$processCreated
    processResumed=$processResumed
    databaseHandleExclusive=($null -ne $stream)
    databaseHandleAcquired=$databaseHandleAcquired
    databaseHandleReleased=$databaseHandleReleased
    releaseState=$releaseState
    errorType=$_.Exception.GetType().Name
    exitCode=$observedExitCode
    observedAt=(Get-Date).ToUniversalTime().ToString('o')
  })
  exit 1
} finally {
  foreach ($name in @(
    'AAO_S7_STARTUP_GATE_ACTIVE_PATH_B64',
    'AAO_S7_STARTUP_GATE_ACTIVE_SHA256',
    'AAO_S7_STARTUP_GATE_ACTIVE_DEVICE_ID',
    'AAO_S7_STARTUP_GATE_ACTIVE_FILE_ID',
    'AAO_S7_STARTUP_GATE_ID',
    'AAO_S7_STARTUP_INVOCATION_ID'
  )) {
    [Environment]::SetEnvironmentVariable($name,$null)
  }
  if ($null -ne $stream) { $stream.Dispose() }
  if ($processCreated) {
    if ($processInformation.hThread -ne [IntPtr]::Zero) {
      [void][S7NativeLaunch]::CloseHandle($processInformation.hThread)
    }
    if ($processInformation.hProcess -ne [IntPtr]::Zero) {
      [void][S7NativeLaunch]::CloseHandle($processInformation.hProcess)
    }
  }
}
`;

module.exports = { EXCLUSIVE_WINDOW_HELPER_SCRIPT };

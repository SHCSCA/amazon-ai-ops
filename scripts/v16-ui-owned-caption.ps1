param(
  [Parameter(Mandatory=$true)][string]$InputFile,
  [Parameter(Mandatory=$true)][string]$ReportFile
)
$ErrorActionPreference = 'Stop'
$exitStatus = 1
$report = [ordered]@{kind='v16-owned-caption-activation';schemaVersion=1;passed=$false;formalCredit=$false;setupOnly=$true;nodeTimingCredit=$false}
try {
  $request = Get-Content -LiteralPath $InputFile -Raw | ConvertFrom-Json
  $expectedFields = @('schemaVersion','MainPid','ExpectedBirthUtc','ExpectedExe','RootHwnd','DeadlineAt','RunToken','Nonce','nativeSource','HitTestMaxMs','ObservationMs','PollMs')
  $actualFields = @($request.PSObject.Properties.Name)
  if (@(Compare-Object ($actualFields | Sort-Object) ($expectedFields | Sort-Object)).Length -ne 0) { throw 'UI_CAPTION_REQUEST_FIELDS' }
  if ($request.schemaVersion -ne 1 -or [uint32]$request.MainPid -eq 0 -or $request.RunToken -notmatch '^[a-f0-9-]{36}$' -or $request.Nonce -notmatch '^[a-f0-9-]{36}$') { throw 'UI_CAPTION_REQUEST_INVALID' }
  $source = Join-Path $PSScriptRoot 'v16-ui-owned-caption-native.cs'
  if ([IO.Path]::GetFullPath($request.nativeSource.path) -cne [IO.Path]::GetFullPath($source)) { throw 'UI_CAPTION_SOURCE_LOCATION' }
  $sourceBytes = [IO.File]::ReadAllBytes($source)
  $sha = [Security.Cryptography.SHA256]::Create()
  try { $digest = -join ($sha.ComputeHash($sourceBytes) | ForEach-Object { $_.ToString('x2') }) } finally { $sha.Dispose() }
  if ($digest -cne $request.nativeSource.sha256 -or $sourceBytes.Length -ne $request.nativeSource.sizeBytes) { throw 'UI_CAPTION_SOURCE_CHANGED' }
  Add-Type -TypeDefinition ([Text.Encoding]::UTF8.GetString($sourceBytes)) -Language CSharp
  $report.request = $request
  $report.result = [V16OwnedCaption]::Activate([uint32]$request.MainPid,[string]$request.ExpectedBirthUtc,[string]$request.ExpectedExe,[string]$request.RootHwnd,[string]$request.DeadlineAt,[uint32]$request.HitTestMaxMs,[uint32]$request.ObservationMs,[uint32]$request.PollMs)
  $report.passed = [bool]$report.result.passed
  if ($report.passed) { $exitStatus = 0 }
} catch {
  $report.passed = $false
  $report.error = [ordered]@{name=$_.Exception.GetType().Name;message=$_.Exception.Message}
}
try {
  $bytes = [Text.UTF8Encoding]::new($false).GetBytes(($report | ConvertTo-Json -Depth 12) + [Environment]::NewLine)
  $stream = [IO.File]::Open($ReportFile,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
  try { $stream.Write($bytes,0,$bytes.Length) } finally { $stream.Dispose() }
  [Console]::Out.WriteLine((@{report=$ReportFile;passed=$report.passed;formalCredit=$false} | ConvertTo-Json -Compress))
} catch {
  $exitStatus = 1
  [Console]::Error.WriteLine((@{timestamp=[DateTime]::UtcNow.ToString('o');level='error';event='v16.ui_caption_report_write_failed';context=@{error=$_.Exception.Message;originalError=$report.error;activationError=$report.result.error}} | ConvertTo-Json -Depth 8 -Compress))
}
if (-not $report.passed) {
  [Console]::Error.WriteLine((@{timestamp=[DateTime]::UtcNow.ToString('o');level='error';event='v16.ui_caption_activation_failed';context=@{error=$report.error;activation=$report.result}} | ConvertTo-Json -Depth 12 -Compress))
}
exit $exitStatus


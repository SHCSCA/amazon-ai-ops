param(
    [Parameter(Mandatory = $true)][int]$TargetProcessId,
    [Parameter(Mandatory = $true)][int]$TargetParentProcessId,
    [Parameter(Mandatory = $true)][string]$ExpectedExecutablePath,
    [Parameter(Mandatory = $true)][string]$ExpectedCreationTimeUtc,
    [Parameter(Mandatory = $true)][string]$OwnerToken,
    [Parameter(Mandatory = $true)][int]$MaxWaitTimeoutMs
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$format = "yyyy-MM-dd'T'HH:mm:ss.fffffff'Z'"
$culture = [Globalization.CultureInfo]::InvariantCulture
$target = $null
$failed = $false
$handleCreationTimeUtc = $null

function Write-Message([object]$Value) {
    [Console]::Out.WriteLine(($Value | ConvertTo-Json -Depth 6 -Compress))
    [Console]::Out.Flush()
}

function Same-Executable([string]$First, [string]$Second) {
    return [string]::Equals([IO.Path]::GetFullPath($First), [IO.Path]::GetFullPath($Second), [StringComparison]::OrdinalIgnoreCase)
}

try {
    if ($TargetProcessId -le 0 -or $TargetParentProcessId -le 0 -or $TargetProcessId -eq $TargetParentProcessId -or $MaxWaitTimeoutMs -le 0) {
        throw 'NFR_MAIN_EXIT_BOUND_IDENTITY_REQUIRED'
    }
    if ($OwnerToken -notmatch '^[a-fA-F0-9-]{36}$' -or $ExpectedCreationTimeUtc -notmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z$') {
        throw 'NFR_MAIN_EXIT_PROTOCOL_IDENTITY_REQUIRED'
    }
    $expectedStart = [DateTime]::ParseExact($ExpectedCreationTimeUtc, $format, $culture, [Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal)
    $target = [Diagnostics.Process]::GetProcessById($TargetProcessId)
    # 先持有句柄；后续退出码始终读取这个进程对象，不能按 PID 再次查找。
    $heldHandle = $target.Handle
    if ($heldHandle -eq [IntPtr]::Zero -or $target.HasExited -or $target.Id -ne $TargetProcessId) {
        throw 'NFR_MAIN_EXIT_HANDLE_ACQUISITION_FAILED'
    }
    $handleStart = $target.StartTime.ToUniversalTime()
    $handleCreationTimeUtc = $handleStart.ToString($format, $culture)
    $modulePath = $target.MainModule.FileName
    $rows = @(Get-CimInstance Win32_Process -Filter "ProcessId=$TargetProcessId" -ErrorAction Stop)
    if ($rows.Count -ne 1) { throw 'NFR_MAIN_EXIT_CIM_IDENTITY_NOT_UNIQUE' }
    $row = $rows[0]
    $cimStart = ([DateTime]$row.CreationDate).ToUniversalTime()
    $cimCreationTimeUtc = $cimStart.ToString($format, $culture)
    # CIM 只有微秒精度；句柄时间保留七位，匹配时仅截断无法由 CIM 观测的第七位。
    $handleMicrosecondTicks = $handleStart.Ticks - ($handleStart.Ticks % 10)
    $expectedMicrosecondTicks = $expectedStart.Ticks - ($expectedStart.Ticks % 10)
    if ([int]$row.ProcessId -ne $TargetProcessId -or [int]$row.ParentProcessId -ne $TargetParentProcessId -or
        -not (Same-Executable ([string]$row.ExecutablePath) $ExpectedExecutablePath) -or
        -not (Same-Executable $modulePath $ExpectedExecutablePath) -or
        $cimCreationTimeUtc -cne $ExpectedCreationTimeUtc -or $handleMicrosecondTicks -ne $expectedMicrosecondTicks -or $target.HasExited) {
        throw 'NFR_MAIN_EXIT_HANDLE_IDENTITY_MISMATCH'
    }
    $identity = [ordered]@{
        schemaVersion = 1
        ownerToken = $OwnerToken
        watcherPid = [int]$PID
        pid = $TargetProcessId
        parentPid = $TargetParentProcessId
        executablePath = $modulePath
        creationTimeUtc = $cimCreationTimeUtc
        handleCreationTimeUtc = $handleCreationTimeUtc
        creationPrecision = 'cim-microsecond+handle-100ns'
    }
    $ready = [ordered]@{}
    foreach ($key in $identity.Keys) { $ready[$key] = $identity[$key] }
    $ready.kind = 'v16-main-exit-ready'
    $ready.handleAcquired = $true
    $ready.observedAt = [DateTime]::UtcNow.ToString($format, $culture)
    Write-Message $ready
    while ($true) {
        $line = [Console]::In.ReadLine()
        if ($null -eq $line) { break }
        $command = $line | ConvertFrom-Json -ErrorAction Stop
        if ($null -eq $command -or $command -is [Array] -or $command.ownerToken -cne $OwnerToken) {
            throw 'NFR_MAIN_EXIT_COMMAND_OWNER_MISMATCH'
        }
        if ($command.command -ceq 'dispose') {
            Write-Message ([ordered]@{ kind = 'v16-main-exit-disposed'; schemaVersion = 1; ownerToken = $OwnerToken; watcherPid = [int]$PID; pid = $TargetProcessId })
            break
        }
        if ($command.command -cne 'close' -or
            -not ($command.timeoutMs -is [int] -or $command.timeoutMs -is [long]) -or
            $command.timeoutMs -le 0 -or $command.timeoutMs -gt $MaxWaitTimeoutMs) {
            throw 'NFR_MAIN_EXIT_COMMAND_INVALID'
        }
        if (-not $target.WaitForExit([int]$command.timeoutMs)) { throw 'NFR_MAIN_EXIT_NOT_OBSERVED' }
        if (-not $target.HasExited -or $target.StartTime.ToUniversalTime().ToString($format, $culture) -cne $handleCreationTimeUtc) {
            throw 'NFR_MAIN_EXIT_HELD_IDENTITY_CHANGED'
        }
        $proof = [ordered]@{}
        foreach ($key in $identity.Keys) { $proof[$key] = $identity[$key] }
        $proof.kind = 'v16-main-exit-proof'
        $proof.exited = $true
        $proof.exitCode = [int]$target.ExitCode
        $proof.signalCode = $null
        $proof.observedAt = [DateTime]::UtcNow.ToString($format, $culture)
        Write-Message $proof
        break
    }
} catch {
    $failed = $true
    try {
        Write-Message ([ordered]@{ kind = 'v16-main-exit-error'; schemaVersion = 1; ownerToken = $OwnerToken; watcherPid = [int]$PID; pid = $TargetProcessId; name = $_.Exception.GetType().Name; message = $_.Exception.Message; observedAt = [DateTime]::UtcNow.ToString($format, $culture) })
    } catch { [Console]::Error.WriteLine('NFR_MAIN_EXIT_ERROR_DELIVERY_FAILED') }
} finally {
    if ($null -ne $target) {
        try { $target.Dispose() }
        catch {
            $failed = $true
            try {
                Write-Message ([ordered]@{ kind = 'v16-main-exit-error'; schemaVersion = 1; ownerToken = $OwnerToken; watcherPid = [int]$PID; pid = $TargetProcessId; name = $_.Exception.GetType().Name; message = $_.Exception.Message; observedAt = [DateTime]::UtcNow.ToString($format, $culture) })
            } catch { [Console]::Error.WriteLine('NFR_MAIN_EXIT_DISPOSE_ERROR_DELIVERY_FAILED') }
        }
    }
}
if ($failed) { exit 1 }
exit 0

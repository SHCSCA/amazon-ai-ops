// 按数据库生命周期、迁移和身份保护职责拆分，事务边界保持一致。
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { fail, isPathWithin, samePath, type S7StableFileArtifact, sameIdentity, fileIdentity, type GateTrustedShellBinding, WINDOWS_WRITE_RIGHTS_MASK, WINDOWS_TRUSTED_INSTALLER_SID, WINDOWS_SYSTEM_SID, WINDOWS_ADMINISTRATORS_SID, type S7WindowsPathSecurity, stableJson } from './s7-startup-gate-contracts';
import { requireTrustedShellBinding } from './s7-startup-gate-bindings';

export function defaultSleep(milliseconds: number): void {
    const signal = new Int32Array(new SharedArrayBuffer(4));
    Atomics.wait(signal, 0, 0, milliseconds);
}

export function windowsRoot(): string {
    const candidate = String(process.env.SYSTEMROOT || process.env.WINDIR || '');
    if (!candidate || !path.isAbsolute(candidate) || candidate.includes('\0')) {
        fail('S7_STARTUP_GATE_SHELL_UNTRUSTED', 'Windows root is unavailable.');
    }
    return path.resolve(candidate);
}

export function assertDirectAncestors(candidate: string, root: string, label: string): void {
    const resolved = path.resolve(candidate);
    if (!isPathWithin(root, resolved)) {
        fail('S7_STARTUP_GATE_SHELL_UNTRUSTED', `${label} is outside Windows.`);
    }
    const relative = path.relative(root, resolved);
    let cursor = root;
    for (const segment of relative.split(path.sep).filter(Boolean)) {
        cursor = path.join(cursor, segment);
        const stat = fs.lstatSync(cursor);
        if (stat.isSymbolicLink() || !samePath(cursor, fs.realpathSync.native(cursor))) {
            fail('S7_STARTUP_GATE_SHELL_UNTRUSTED', `${label} traverses a link or junction.`);
        }
    }
}

export function stableServicingFile(filePath: string): S7StableFileArtifact {
    const requested = path.resolve(filePath);
    const before = fs.lstatSync(requested, { bigint: true });
    if (!before.isFile()
        || before.isSymbolicLink()
        || Number(before.nlink) < 1
        || Number(before.nlink) > 8) {
        fail('S7_STARTUP_GATE_SHELL_UNTRUSTED', 'Trusted PowerShell file identity is invalid.');
    }
    const realPath = fs.realpathSync.native(requested);
    if (!samePath(requested, realPath)) {
        fail('S7_STARTUP_GATE_SHELL_UNTRUSTED', 'Trusted PowerShell path is indirect.');
    }
    const descriptor = fs.openSync(requested, fs.constants.O_RDONLY);
    try {
        const opened = fs.fstatSync(descriptor, { bigint: true });
        const hash = crypto.createHash('sha256');
        const buffer = Buffer.allocUnsafe(1024 * 1024);
        let total = 0;
        let read = 0;
        do {
            read = fs.readSync(descriptor, buffer, 0, buffer.length, null);
            if (read > 0) {
                hash.update(buffer.subarray(0, read));
                total += read;
            }
        } while (read > 0);
        const after = fs.fstatSync(descriptor, { bigint: true });
        if (!sameIdentity(fileIdentity(before), fileIdentity(opened))
            || !sameIdentity(fileIdentity(opened), fileIdentity(after))
            || opened.size !== after.size
            || opened.mtimeMs !== after.mtimeMs
            || BigInt(total) !== after.size) {
            fail('S7_STARTUP_GATE_SHELL_UNTRUSTED', 'Trusted PowerShell drifted during hashing.');
        }
        return {
            path: requested,
            realPath,
            sha256: hash.digest('hex').toUpperCase(),
            sizeBytes: total,
            mtimeMs: Number(after.mtimeNs / 1000000000n) * 1000 + Number(after.mtimeNs % 1000000000n) / 1000000,
            identity: fileIdentity(after),
        };
    }
    finally {
        fs.closeSync(descriptor);
    }
}

export function fixedWindowsPowerShellPath(): string {
    const root = windowsRoot();
    const candidate = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    assertDirectAncestors(candidate, root, 'Trusted Windows PowerShell');
    return candidate;
}

export function defaultInspectTrustedPowerShell(): GateTrustedShellBinding {
    const root = windowsRoot();
    const executablePath = fixedWindowsPowerShellPath();
    const artifact = stableServicingFile(executablePath);
    const fsutil = path.join(root, 'System32', 'fsutil.exe');
    assertDirectAncestors(fsutil, root, 'Trusted fsutil');
    const runtimeEnv = pickEnvironment(process.env);
    const hardlinkResult = spawnSync(fsutil, ['hardlink', 'list', executablePath], {
        encoding: 'utf8',
        env: runtimeEnv,
        shell: false,
        windowsHide: true,
        timeout: 20000,
    });
    if (hardlinkResult.error || hardlinkResult.status !== 0) {
        fail('S7_STARTUP_GATE_SHELL_UNTRUSTED', 'PowerShell hard-link enumeration failed.');
    }
    const driveRoot = path.parse(executablePath).root;
    const hardlinkPaths = String(hardlinkResult.stdout || '')
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => (/^[\\/]/.test(value) && !/^[A-Za-z]:[\\/]/.test(value)
        ? path.resolve(driveRoot, value.replace(/^[\\/]+/, ''))
        : path.resolve(value)))
        .sort((left, right) => left.localeCompare(right, 'en'));
    if (hardlinkPaths.length !== artifact.identity.hardLinkCount
        || hardlinkPaths.length < 1
        || hardlinkPaths.length > 8
        || hardlinkPaths.reduce((total, value) => total + value.length, 0) > 8192
        || !hardlinkPaths.some((value) => samePath(value, executablePath))) {
        fail('S7_STARTUP_GATE_SHELL_UNTRUSTED', 'PowerShell hard-link set is incomplete.');
    }
    const servicingRoot = path.join(root, 'WinSxS');
    for (const hardlinkPath of hardlinkPaths) {
        if (!samePath(hardlinkPath, executablePath) && !isPathWithin(servicingRoot, hardlinkPath)) {
            fail('S7_STARTUP_GATE_SHELL_UNTRUSTED', 'PowerShell has an unapproved hard-link path.');
        }
        assertDirectAncestors(hardlinkPath, root, 'PowerShell hard link');
        const stat = fs.statSync(hardlinkPath, { bigint: true });
        if (stat.dev.toString() !== artifact.identity.deviceId
            || stat.ino.toString() !== artifact.identity.fileId) {
            fail('S7_STARTUP_GATE_SHELL_UNTRUSTED', 'PowerShell hard-link identity differs.');
        }
    }
    const command = String.raw `
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:AAO_S7_TRUSTED_SHELL_B64))
$acl=[IO.File]::GetAccessControl($p)
$sidType=[Security.Principal.SecurityIdentifier]
$rules=@($acl.GetAccessRules($true,$true,$sidType) | ForEach-Object { [ordered]@{ sid=$_.IdentityReference.Value; type=$_.AccessControlType.ToString(); rights=([int64]$_.FileSystemRights).ToString(); inherited=[bool]$_.IsInherited } })
$signature=Get-AuthenticodeSignature -LiteralPath $p
$version=[Diagnostics.FileVersionInfo]::GetVersionInfo($p)
[ordered]@{ ownerSid=$acl.GetOwner($sidType).Value; inheritanceProtected=[bool]$acl.AreAccessRulesProtected; rules=$rules; signatureStatus=$signature.Status.ToString(); signatureSubject=$signature.SignerCertificate.Subject; signatureThumbprint=$signature.SignerCertificate.Thumbprint; companyName=$version.CompanyName; fileVersion=([string]::Join('.',@($version.FileMajorPart,$version.FileMinorPart,$version.FileBuildPart,$version.FilePrivatePart))); productName=$version.ProductName; originalFilename=$version.OriginalFilename } | ConvertTo-Json -Compress -Depth 6
`;
    const result = spawnSync(executablePath, ['-NoProfile', '-NonInteractive', '-Command', command], {
        encoding: 'utf8',
        env: {
            ...runtimeEnv,
            AAO_S7_TRUSTED_SHELL_B64: Buffer.from(executablePath, 'utf8').toString('base64'),
        },
        shell: false,
        windowsHide: true,
        timeout: 30000,
    });
    if (result.error || result.status !== 0) {
        fail('S7_STARTUP_GATE_SHELL_UNTRUSTED', 'PowerShell signature/ACL inspection failed.');
    }
    let proof: Record<string, unknown>;
    try {
        proof = JSON.parse(String(result.stdout || '').trim()) as Record<string, unknown>;
    }
    catch {
        fail('S7_STARTUP_GATE_SHELL_UNTRUSTED', 'PowerShell signature/ACL proof is invalid.');
    }
    const rules = Array.isArray(proof.rules) ? proof.rules : proof.rules ? [proof.rules] : [];
    const unsafeWritable = rules.some((ruleValue) => {
        const rule = ruleValue as Record<string, unknown>;
        let rights: bigint;
        try {
            rights = BigInt(String(rule.rights || ''));
        }
        catch {
            return true;
        }
        return String(rule.type) !== 'Allow'
            || rule.inherited === true
            || ((rights & WINDOWS_WRITE_RIGHTS_MASK) !== 0n
                && ![
                    WINDOWS_TRUSTED_INSTALLER_SID,
                    WINDOWS_SYSTEM_SID,
                    WINDOWS_ADMINISTRATORS_SID,
                ].includes(String(rule.sid || '')));
    });
    if (![WINDOWS_TRUSTED_INSTALLER_SID, WINDOWS_SYSTEM_SID].includes(String(proof.ownerSid || ''))
        || proof.inheritanceProtected !== true
        || unsafeWritable
        || proof.signatureStatus !== 'Valid'
        || !/Microsoft/i.test(String(proof.signatureSubject || ''))
        || !/^Microsoft/i.test(String(proof.companyName || ''))
        || !String(proof.fileVersion || '')
        || !String(proof.originalFilename || '').toLowerCase().includes('powershell')) {
        fail('S7_STARTUP_GATE_SHELL_UNTRUSTED', 'PowerShell signature, owner, or ACL is invalid.');
    }
    return {
        realPath: artifact.realPath,
        sha256: artifact.sha256,
        sizeBytes: artifact.sizeBytes,
        identity: artifact.identity,
        hardlinkPaths,
        signature: {
            status: 'Valid',
            subject: String(proof.signatureSubject),
            thumbprint: String(proof.signatureThumbprint || '').toUpperCase(),
        },
        version: {
            companyName: String(proof.companyName),
            fileVersion: String(proof.fileVersion),
            originalFilename: String(proof.originalFilename),
            productName: String(proof.productName || ''),
        },
    };
}

export function pickEnvironment(source: NodeJS.ProcessEnv, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
    const root = windowsRoot();
    const result: NodeJS.ProcessEnv = {
        COMSPEC: path.join(root, 'System32', 'cmd.exe'),
        PATH: [
            path.join(root, 'System32'),
            path.join(root, 'System32', 'Wbem'),
            path.join(root, 'System32', 'WindowsPowerShell', 'v1.0'),
        ].join(path.delimiter),
        PATHEXT: String(source.PATHEXT || '.COM;.EXE;.BAT;.CMD'),
        SYSTEMDRIVE: path.parse(root).root.replace(/[\\/]$/, ''),
        SYSTEMROOT: root,
        WINDIR: root,
    };
    for (const key of ['TEMP', 'TMP'] as const) {
        const value = source[key];
        if (typeof value === 'string' && value && !value.includes('\0'))
            result[key] = value;
    }
    return { ...result, ...extra };
}

export const WINDOWS_SECURITY_INSPECTOR = String.raw `
$ErrorActionPreference='Stop'
$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:AAO_S7_PATH_B64))
$type=$env:AAO_S7_PATH_TYPE
$current=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
if ($type -eq 'directory') {
  $acl=[IO.Directory]::GetAccessControl($p)
} elseif ($type -eq 'file') {
  $acl=[IO.File]::GetAccessControl($p)
} else {
  throw 'invalid-path-type'
}
$rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
$safe=@($current,'S-1-5-18','S-1-5-32-544')
$unauthorized=@()
foreach ($rule in $rules) {
  $sid=$rule.IdentityReference.Value
  $rights=[int64]$rule.FileSystemRights
  if (
    $rule.IsInherited -or
    $rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
    $safe -notcontains $sid -or
    (($rights -band 2032127) -ne 2032127)
  ) {
    $unauthorized += ($sid + ':' + $rule.AccessControlType + ':' + $rights + ':' + $rule.IsInherited)
  }
}
[ordered]@{
  path=$p
  type=$type
  ownerSid=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
  currentUserSid=$current
  inheritanceProtected=[bool]$acl.AreAccessRulesProtected
  seenSids=@($rules | ForEach-Object { $_.IdentityReference.Value } | Sort-Object -Unique)
  unauthorizedRules=$unauthorized
} | ConvertTo-Json -Compress
`;

export function defaultInspectWindowsPathSecurity(filePath: string, type: 'file' | 'directory', label: string, trustedShell?: GateTrustedShellBinding): S7WindowsPathSecurity {
    const resolved = path.resolve(filePath);
    const shell = trustedShell
        ? requireTrustedShellBinding(trustedShell)
        : null;
    const shellPath = shell?.realPath ?? fixedWindowsPowerShellPath();
    const shellBefore = shell ? stableServicingFile(shellPath) : null;
    if (shell
        && (!samePath(shellBefore?.realPath, shell.realPath)
            || shellBefore?.sha256 !== shell.sha256
            || shellBefore?.sizeBytes !== shell.sizeBytes
            || shellBefore?.identity.deviceId !== shell.identity.deviceId
            || shellBefore?.identity.fileId !== shell.identity.fileId
            || shellBefore?.identity.hardLinkCount !== shell.identity.hardLinkCount)) {
        fail('S7_STARTUP_GATE_SHELL_UNTRUSTED', `${label} ACL inspector PowerShell no longer matches its authenticated binding.`);
    }
    const result = spawnSync(shellPath, ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_SECURITY_INSPECTOR], {
        encoding: 'utf8',
        env: pickEnvironment(process.env, {
            AAO_S7_PATH_B64: Buffer.from(resolved, 'utf8').toString('base64'),
            AAO_S7_PATH_TYPE: type,
        }),
        shell: false,
        windowsHide: true,
        timeout: 20000,
    });
    if (result.error || result.status !== 0) {
        fail('S7_STARTUP_GATE_ACL_UNTRUSTED', `${label} ACL inspection failed: ${result.error?.message || result.stderr || 'unknown failure'}.`);
    }
    if (shell) {
        const shellAfter = stableServicingFile(shellPath);
        if (shellAfter.sha256 !== shell.sha256
            || shellAfter.sizeBytes !== shell.sizeBytes
            || shellAfter.identity.deviceId !== shell.identity.deviceId
            || shellAfter.identity.fileId !== shell.identity.fileId
            || shellAfter.identity.hardLinkCount !== shell.identity.hardLinkCount) {
            fail('S7_STARTUP_GATE_SHELL_UNTRUSTED', `${label} ACL inspector PowerShell drifted during inspection.`);
        }
    }
    let parsed: {
        path?: string;
        type?: string;
        ownerSid?: string;
        currentUserSid?: string;
        inheritanceProtected?: boolean;
        seenSids?: string[] | string;
        unauthorizedRules?: string[] | string;
    };
    try {
        parsed = JSON.parse(String(result.stdout || '').replace(/^\uFEFF/, '').trim());
    }
    catch {
        fail('S7_STARTUP_GATE_ACL_UNTRUSTED', `${label} ACL proof was not JSON.`);
    }
    const seenSids = Array.isArray(parsed.seenSids)
        ? parsed.seenSids
        : typeof parsed.seenSids === 'string'
            ? [parsed.seenSids]
            : [];
    const unauthorizedRules = Array.isArray(parsed.unauthorizedRules)
        ? parsed.unauthorizedRules
        : typeof parsed.unauthorizedRules === 'string'
            ? [parsed.unauthorizedRules]
            : [];
    const requiredSids = [
        String(parsed.currentUserSid || ''),
        WINDOWS_SYSTEM_SID,
        WINDOWS_ADMINISTRATORS_SID,
    ].sort();
    const passed = samePath(parsed.path, resolved)
        && parsed.type === type
        && parsed.ownerSid === parsed.currentUserSid
        && parsed.inheritanceProtected === true
        && unauthorizedRules.length === 0
        && stableJson([...new Set(seenSids)].sort()) === stableJson(requiredSids);
    return {
        passed,
        path: resolved,
        type,
        ownerSid: String(parsed.ownerSid || ''),
        currentUserSid: String(parsed.currentUserSid || ''),
        inheritanceProtected: parsed.inheritanceProtected === true,
        unauthorizedRules,
    };
}

export const WINDOWS_SECURITY_PROTECTOR = String.raw `
$ErrorActionPreference='Stop'
$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:AAO_S7_PATH_B64))
$type=$env:AAO_S7_PATH_TYPE
$current=[Security.Principal.WindowsIdentity]::GetCurrent().User
$system=New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
$admins=New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')
if ($type -eq 'directory') {
  $acl=New-Object Security.AccessControl.DirectorySecurity
  $inherit=[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
} elseif ($type -eq 'file') {
  $acl=New-Object Security.AccessControl.FileSecurity
  $inherit=[Security.AccessControl.InheritanceFlags]::None
} else {
  throw 'invalid-path-type'
}
$acl.SetOwner($current)
$acl.SetAccessRuleProtection($true,$false)
foreach ($sid in @($current,$system,$admins)) {
  $rule=New-Object Security.AccessControl.FileSystemAccessRule(
    $sid,
    [Security.AccessControl.FileSystemRights]::FullControl,
    $inherit,
    [Security.AccessControl.PropagationFlags]::None,
    [Security.AccessControl.AccessControlType]::Allow
  )
  [void]$acl.AddAccessRule($rule)
}
if ($type -eq 'directory') {
  [IO.Directory]::SetAccessControl($p,$acl)
} else {
  [IO.File]::SetAccessControl($p,$acl)
}
`;

export function defaultProtectWindowsPath(filePath: string, type: 'file' | 'directory'): void {
    const result = spawnSync(fixedWindowsPowerShellPath(), ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_SECURITY_PROTECTOR], {
        encoding: 'utf8',
        env: pickEnvironment(process.env, {
            AAO_S7_PATH_B64: Buffer.from(path.resolve(filePath), 'utf8').toString('base64'),
            AAO_S7_PATH_TYPE: type,
        }),
        shell: false,
        windowsHide: true,
        timeout: 20000,
    });
    if (result.error || result.status !== 0) {
        fail('S7_STARTUP_GATE_ACL_UNTRUSTED', `Could not protect ${type} ACL: ${result.error?.message || result.stderr || 'unknown failure'}.`);
    }
}

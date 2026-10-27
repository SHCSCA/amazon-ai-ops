// 按职责复用原有严格校验，公共入口继续保持兼容。
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { CHILD_ENVIRONMENT_ALLOWLIST, TRUSTED_INSTALLER_SID, TRUSTED_POWERSHELL_MAX_HARDLINKS, TRUSTED_POWERSHELL_MAX_HARDLINK_PATH_CHARACTERS, TRUSTED_POWERSHELL_SIGNATURE_SUBJECT, WINDOWS_WRITE_RIGHTS_MASK, fail, normalizedPath, sameOrInside, samePath, sameStat } = require('./s7-launch-operator-contracts.js');
const { directPath } = require('./s7-launch-operator-filesystem.js');

let trustedPowerShellCache = null;

function minimalWindowsRuntimeEnvironment(env) {
    const result = {};
    const allowed = new Set(CHILD_ENVIRONMENT_ALLOWLIST);
    for (const [key, value] of Object.entries(env || {})) {
        const normalizedKey = key.toUpperCase();
        if (allowed.has(normalizedKey)
            && typeof value === 'string'
            && !normalizedKey.includes('\0')
            && !value.includes('\0')) {
            result[normalizedKey] = value;
        }
    }
    const windowsRootValue = String(result.SYSTEMROOT || result.WINDIR || env?.SystemRoot || env?.windir || '');
    if (!windowsRootValue
        || windowsRootValue.includes('\0')
        || !path.win32.isAbsolute(windowsRootValue)
        || windowsRootValue.startsWith('\\\\')) {
        fail('Trusted Windows runtime requires one absolute local SystemRoot.');
    }
    const windowsRoot = path.win32.normalize(windowsRootValue);
    const system32 = path.win32.join(windowsRoot, 'System32');
    result.SYSTEMROOT = windowsRoot;
    result.WINDIR = windowsRoot;
    result.SYSTEMDRIVE = path.win32.parse(windowsRoot).root.replace(/[\\/]$/, '');
    result.COMSPEC = path.win32.join(system32, 'cmd.exe');
    result.PATH = [
        system32,
        path.win32.join(system32, 'Wbem'),
        path.win32.join(system32, 'WindowsPowerShell', 'v1.0'),
    ].join(';');
    return result;
}

function assertDirectWindowsAncestors(filePath, windowsRoot, label) {
    const root = path.resolve(windowsRoot);
    let current = path.resolve(filePath);
    for (;;) {
        const leaf = fs.lstatSync(current);
        if (leaf.isSymbolicLink()) {
            fail(`${label} traverses a reparse point: ${current}`);
        }
        if (!samePath(fs.realpathSync.native(current), current)) {
            fail(`${label} resolves through an indirect path: ${current}`);
        }
        if (samePath(current, root))
            break;
        const parent = path.dirname(current);
        if (samePath(parent, current) || !sameOrInside(current, root)) {
            fail(`${label} escaped the trusted Windows root.`);
        }
        current = parent;
    }
}

function stableServicingFileArtifact(filePath, label) {
    const before = directPath(filePath, label, 'file');
    if (!Number.isInteger(before.stat.nlink)
        || before.stat.nlink < 1
        || before.stat.nlink > TRUSTED_POWERSHELL_MAX_HARDLINKS) {
        fail(`${label} servicing hard-link count is outside the bounded contract.`);
    }
    const handle = fs.openSync(before.realPath, 'r');
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let total = 0;
    let start;
    let end;
    try {
        start = fs.fstatSync(handle);
        if (!sameStat(before.stat, start))
            fail(`${label} changed before hashing.`);
        let bytesRead;
        do {
            bytesRead = fs.readSync(handle, buffer, 0, buffer.length, null);
            if (bytesRead > 0) {
                hash.update(buffer.subarray(0, bytesRead));
                total += bytesRead;
            }
        } while (bytesRead > 0);
        end = fs.fstatSync(handle);
        if (!sameStat(start, end) || total !== end.size) {
            fail(`${label} changed during hashing.`);
        }
    }
    finally {
        fs.closeSync(handle);
    }
    const after = directPath(filePath, label, 'file');
    if (!sameStat(end, after.stat) || !samePath(before.realPath, after.realPath)) {
        fail(`${label} path changed during hashing.`);
    }
    return {
        path: before.resolved,
        realPath: after.realPath,
        sha256: hash.digest('hex').toUpperCase(),
        sizeBytes: total,
        mtimeMs: end.mtimeMs,
        identity: {
            deviceId: String(end.dev),
            fileId: String(end.ino),
            hardLinkCount: Number(end.nlink),
        },
    };
}

function resolveTrustedWindowsPowerShell(env = process.env, dependencies = {}) {
    const runtimeEnv = minimalWindowsRuntimeEnvironment(env);
    const windowsRoot = path.resolve(runtimeEnv.SYSTEMROOT);
    const executablePath = path.resolve(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    if (trustedPowerShellCache
        && samePath(trustedPowerShellCache.realPath, executablePath)) {
        const stat = fs.statSync(executablePath);
        if (String(stat.dev) === trustedPowerShellCache.identity.deviceId
            && String(stat.ino) === trustedPowerShellCache.identity.fileId
            && Number(stat.nlink) === trustedPowerShellCache.identity.hardLinkCount
            && stat.size === trustedPowerShellCache.sizeBytes
            && stat.mtimeMs === trustedPowerShellCache.mtimeMs) {
            return trustedPowerShellCache;
        }
        fail('Trusted Windows PowerShell identity drifted after validation.');
    }
    assertDirectWindowsAncestors(executablePath, windowsRoot, 'Trusted Windows PowerShell');
    const artifact = stableServicingFileArtifact(executablePath, 'Trusted Windows PowerShell');
    const fsutilPath = path.resolve(windowsRoot, 'System32', 'fsutil.exe');
    assertDirectWindowsAncestors(fsutilPath, windowsRoot, 'Trusted fsutil');
    const run = dependencies.spawnSync || spawnSync;
    const hardlinkResult = run(fsutilPath, ['hardlink', 'list', executablePath], {
        encoding: 'utf8',
        env: runtimeEnv,
        shell: false,
        timeout: 20000,
        windowsHide: true,
    });
    if (hardlinkResult.error || hardlinkResult.status !== 0) {
        fail('Trusted Windows PowerShell hard-link enumeration failed.');
    }
    const driveRoot = path.parse(executablePath).root;
    const hardlinkPaths = String(hardlinkResult.stdout || '')
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => (/^[\\/]/.test(value) && !/^[A-Za-z]:[\\/]/.test(value)
        ? path.resolve(driveRoot, value.replace(/^[\\/]+/, ''))
        : path.isAbsolute(value)
            ? path.resolve(value)
            : path.resolve(driveRoot, value)))
        .sort((left, right) => left.localeCompare(right, 'en'));
    const hardlinkPathCharacters = hardlinkPaths.reduce((total, value) => total + value.length, 0);
    if (hardlinkPaths.length !== artifact.identity.hardLinkCount
        || hardlinkPaths.length < 1
        || hardlinkPaths.length > TRUSTED_POWERSHELL_MAX_HARDLINKS
        || hardlinkPathCharacters > TRUSTED_POWERSHELL_MAX_HARDLINK_PATH_CHARACTERS
        || !hardlinkPaths.some((candidate) => samePath(candidate, executablePath))) {
        fail('Trusted Windows PowerShell hard-link set is incomplete or unbounded.');
    }
    const normalizedSystemPath = normalizedPath(executablePath);
    const normalizedServicingRoot = normalizedPath(path.resolve(windowsRoot, 'WinSxS'));
    for (const candidate of hardlinkPaths) {
        const normalized = normalizedPath(candidate);
        if (normalized !== normalizedSystemPath
            && !sameOrInside(normalized, normalizedServicingRoot)) {
            fail('Trusted Windows PowerShell has an unapproved hard-link path.');
        }
        assertDirectWindowsAncestors(candidate, windowsRoot, 'Trusted Windows PowerShell hard link');
        const stat = fs.statSync(candidate);
        if (String(stat.dev) !== artifact.identity.deviceId
            || String(stat.ino) !== artifact.identity.fileId) {
            fail('Trusted Windows PowerShell hard-link identity differs.');
        }
    }
    const identityCommand = [
        "$ErrorActionPreference='Stop'",
        "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)",
        "$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:AAO_S7_TRUSTED_SHELL_B64))",
        '$acl=[IO.File]::GetAccessControl($p)',
        '$sidType=[Security.Principal.SecurityIdentifier]',
        '$rules=@($acl.GetAccessRules($true,$true,$sidType) | ForEach-Object { [ordered]@{ sid=$_.IdentityReference.Value; type=$_.AccessControlType.ToString(); rights=([int64]$_.FileSystemRights).ToString(); inherited=[bool]$_.IsInherited } })',
        '$signature=Get-AuthenticodeSignature -LiteralPath $p',
        '$version=[Diagnostics.FileVersionInfo]::GetVersionInfo($p)',
        '[ordered]@{ ownerSid=$acl.GetOwner($sidType).Value; inheritanceProtected=[bool]$acl.AreAccessRulesProtected; rules=$rules; signatureStatus=$signature.Status.ToString(); signatureSubject=$signature.SignerCertificate.Subject; signatureThumbprint=$signature.SignerCertificate.Thumbprint; companyName=$version.CompanyName; fileVersion=([string]::Join(\'.\',@($version.FileMajorPart,$version.FileMinorPart,$version.FileBuildPart,$version.FilePrivatePart))); productName=$version.ProductName; originalFilename=$version.OriginalFilename } | ConvertTo-Json -Compress -Depth 6',
    ].join('\n');
    const identityResult = run(executablePath, ['-NoProfile', '-NonInteractive', '-Command', identityCommand], {
        encoding: 'utf8',
        env: {
            ...runtimeEnv,
            AAO_S7_TRUSTED_SHELL_B64: Buffer.from(executablePath, 'utf8').toString('base64'),
        },
        shell: false,
        timeout: 30000,
        windowsHide: true,
    });
    if (identityResult.error || identityResult.status !== 0) {
        fail('Trusted Windows PowerShell signature/ACL inspection failed.');
    }
    let proof;
    try {
        proof = JSON.parse(String(identityResult.stdout || '').trim());
    }
    catch {
        fail('Trusted Windows PowerShell signature/ACL proof was invalid.');
    }
    const rules = Array.isArray(proof?.rules)
        ? proof.rules
        : proof?.rules
            ? [proof.rules]
            : [];
    const unsafeWritable = rules.filter((rule) => {
        let rights;
        try {
            rights = BigInt(rule?.rights);
        }
        catch {
            return true;
        }
        return String(rule?.type) !== 'Allow'
            || rule?.inherited === true
            || ((rights & WINDOWS_WRITE_RIGHTS_MASK) !== 0n
                && ![TRUSTED_INSTALLER_SID, 'S-1-5-18', 'S-1-5-32-544'].includes(String(rule?.sid || '')));
    });
    if (![TRUSTED_INSTALLER_SID, 'S-1-5-18'].includes(String(proof?.ownerSid || ''))
        || proof?.inheritanceProtected !== true
        || unsafeWritable.length !== 0
        || proof?.signatureStatus !== 'Valid'
        || !TRUSTED_POWERSHELL_SIGNATURE_SUBJECT.test(String(proof?.signatureSubject || ''))
        || !/^Microsoft/i.test(String(proof?.companyName || ''))
        || !String(proof?.fileVersion || '')
        || !String(proof?.originalFilename || '').toLowerCase().includes('powershell')) {
        fail('Trusted Windows PowerShell signature, owner, or ACL contract failed.');
    }
    trustedPowerShellCache = Object.freeze({
        ...artifact,
        hardlinkPaths: Object.freeze([...hardlinkPaths]),
        hardlinkPathCharacters,
        signature: Object.freeze({
            status: proof.signatureStatus,
            subject: proof.signatureSubject,
            thumbprint: String(proof.signatureThumbprint || '').toUpperCase(),
        }),
        version: Object.freeze({
            companyName: proof.companyName,
            fileVersion: proof.fileVersion,
            originalFilename: proof.originalFilename,
            productName: proof.productName,
        }),
    });
    return trustedPowerShellCache;
}

function captureTrustedWindowsRuntime(env = process.env, dependencies = {}) {
    // 只在已有启动配置入口截取一次环境；调用方拿到冻结只读快照。
    const snapshot = Object.freeze({ ...env });
    return Object.freeze({ executable: resolveTrustedWindowsPowerShell(snapshot, dependencies),
        environment: Object.freeze(minimalWindowsRuntimeEnvironment(snapshot)) });
}

function spawnTrustedWindowsPowerShell(args, options = {}, env = process.env) {
    const shellIdentity = resolveTrustedWindowsPowerShell(env);
    return spawnSync(shellIdentity.realPath, args, {
        ...options,
        env: options.env || minimalWindowsRuntimeEnvironment(env),
        shell: false,
    });
}

function defaultInspectWindowsPathSecurity(value, options = {}) {
    const target = directPath(value, options.label || 'Windows protected path', options.type || 'directory');
    const result = spawnTrustedWindowsPowerShell([
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        [
            "$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:AAO_S7_ACL_PATH_B64))",
            '$acl=if([System.IO.Directory]::Exists($p)){',
            '  [System.IO.Directory]::GetAccessControl($p)',
            '} else {',
            '  [System.IO.File]::GetAccessControl($p)',
            '}',
            '$sidType=[System.Security.Principal.SecurityIdentifier]',
            '$current=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
            '$owner=$acl.GetOwner($sidType).Value',
            '$rules=@($acl.GetAccessRules($true,$true,$sidType) | ForEach-Object {',
            '  [ordered]@{',
            '    sid=$_.IdentityReference.Value',
            '    type=$_.AccessControlType.ToString()',
            '    rights=([int64]$_.FileSystemRights).ToString()',
            '    inherited=[bool]$_.IsInherited',
            '  }',
            '})',
            '[ordered]@{',
            '  ownerSid=$owner',
            '  currentUserSid=$current',
            '  inheritanceProtected=[bool]$acl.AreAccessRulesProtected',
            '  rules=$rules',
            '} | ConvertTo-Json -Compress -Depth 5',
        ].join('\n'),
    ], {
        encoding: 'utf8',
        env: {
            ...minimalWindowsRuntimeEnvironment(process.env),
            AAO_S7_ACL_PATH_B64: Buffer.from(target.realPath, 'utf8').toString('base64'),
        },
        windowsHide: true,
        timeout: 20000,
    });
    if (result.error || result.status !== 0) {
        fail(`${options.label || 'Windows protected path'} ACL inspection failed.`);
    }
    let proof;
    try {
        proof = JSON.parse(String(result.stdout || '').trim());
    }
    catch {
        fail(`${options.label || 'Windows protected path'} ACL proof was invalid.`);
    }
    const currentSid = String(proof?.currentUserSid || '');
    const ownerSid = String(proof?.ownerSid || '');
    const rules = Array.isArray(proof?.rules)
        ? proof.rules
        : proof?.rules
            ? [proof.rules]
            : [];
    const safeWritePrincipals = new Set([
        currentSid,
        'S-1-5-18',
        'S-1-5-32-544',
    ]);
    const highRiskPrincipals = new Set([
        'S-1-1-0',
        'S-1-5-7',
        'S-1-5-11',
        'S-1-5-32-545',
        'S-1-5-32-546',
    ]);
    const writeBits = [
        2n,
        4n,
        16n,
        64n,
        256n,
        65536n,
        262144n,
        524288n,
    ];
    let currentUserWriteAllowed = false;
    const normalizedRules = rules.map((rule) => {
        const sid = String(rule?.sid || '');
        const type = String(rule?.type || '');
        let rights;
        try {
            rights = BigInt(rule?.rights);
        }
        catch {
            fail(`${options.label || 'Windows protected path'} ACL rights were invalid.`);
        }
        const writable = writeBits.some((bit) => (rights & bit) !== 0n);
        if (type === 'Allow' && highRiskPrincipals.has(sid)) {
            fail(`${options.label || 'Windows protected path'} ACL grants a high-risk principal.`);
        }
        if (type === 'Allow' && writable && !safeWritePrincipals.has(sid)) {
            fail(`${options.label || 'Windows protected path'} ACL grants write access to an unapproved principal.`);
        }
        if (type === 'Allow' && writable && sid === currentSid)
            currentUserWriteAllowed = true;
        return {
            sid,
            type,
            rights: rights.toString(),
            inherited: rule?.inherited === true,
        };
    });
    if (!currentSid
        || ownerSid !== currentSid
        || !currentUserWriteAllowed
        || (options.requireProtected === true && proof?.inheritanceProtected !== true)) {
        fail(`${options.label || 'Windows protected path'} owner or inheritance contract failed.`);
    }
    return {
        passed: true,
        path: target.realPath,
        ownerSid,
        currentUserSid: currentSid,
        inheritanceProtected: proof.inheritanceProtected === true,
        protectedInheritanceRequired: options.requireProtected === true,
        highRiskWritePrincipalCount: 0,
        rules: normalizedRules,
    };
}

function defaultProtectWindowsDirectory(value) {
    const target = directPath(value, 'Windows directory to protect', 'directory');
    const result = spawnTrustedWindowsPowerShell([
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        [
            "$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:AAO_S7_ACL_PATH_B64))",
            '$current=[System.Security.Principal.WindowsIdentity]::GetCurrent().User',
            '$system=[System.Security.Principal.SecurityIdentifier]::new("S-1-5-18")',
            '$admins=[System.Security.Principal.SecurityIdentifier]::new("S-1-5-32-544")',
            '$acl=New-Object System.Security.AccessControl.DirectorySecurity',
            '$acl.SetOwner($current)',
            '$acl.SetAccessRuleProtection($true,$false)',
            'foreach($sid in @($current,$system,$admins)){',
            '  $rule=[System.Security.AccessControl.FileSystemAccessRule]::new(',
            '    $sid,',
            '    [System.Security.AccessControl.FileSystemRights]::FullControl,',
            '    ([System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit),',
            '    [System.Security.AccessControl.PropagationFlags]::None,',
            '    [System.Security.AccessControl.AccessControlType]::Allow',
            '  )',
            '  [void]$acl.AddAccessRule($rule)',
            '}',
            '[System.IO.Directory]::SetAccessControl($p,$acl)',
        ].join('\n'),
    ], {
        encoding: 'utf8',
        env: {
            ...minimalWindowsRuntimeEnvironment(process.env),
            AAO_S7_ACL_PATH_B64: Buffer.from(target.realPath, 'utf8').toString('base64'),
        },
        windowsHide: true,
        timeout: 20000,
    });
    if (result.error || result.status !== 0) {
        const detail = String(result.error?.message || result.stderr || 'unknown PowerShell ACL failure').trim().slice(0, 500);
        fail(`Could not establish a protected Windows ACL for ${target.realPath}: ${detail}`);
    }
    return target.realPath;
}

function defaultProtectWindowsFile(value) {
    const target = directPath(value, 'Windows file to protect', 'file');
    const result = spawnTrustedWindowsPowerShell([
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        [
            "$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:AAO_S7_ACL_PATH_B64))",
            '$current=[System.Security.Principal.WindowsIdentity]::GetCurrent().User',
            '$system=[System.Security.Principal.SecurityIdentifier]::new("S-1-5-18")',
            '$admins=[System.Security.Principal.SecurityIdentifier]::new("S-1-5-32-544")',
            '$acl=New-Object System.Security.AccessControl.FileSecurity',
            '$acl.SetOwner($current)',
            '$acl.SetAccessRuleProtection($true,$false)',
            'foreach($sid in @($current,$system,$admins)){',
            '  $rule=[System.Security.AccessControl.FileSystemAccessRule]::new(',
            '    $sid,',
            '    [System.Security.AccessControl.FileSystemRights]::FullControl,',
            '    [System.Security.AccessControl.InheritanceFlags]::None,',
            '    [System.Security.AccessControl.PropagationFlags]::None,',
            '    [System.Security.AccessControl.AccessControlType]::Allow',
            '  )',
            '  [void]$acl.AddAccessRule($rule)',
            '}',
            '[System.IO.File]::SetAccessControl($p,$acl)',
        ].join('\n'),
    ], {
        encoding: 'utf8',
        env: {
            ...minimalWindowsRuntimeEnvironment(process.env),
            AAO_S7_ACL_PATH_B64: Buffer.from(target.realPath, 'utf8').toString('base64'),
        },
        windowsHide: true,
        timeout: 20000,
    });
    if (result.error || result.status !== 0) {
        const detail = String(result.error?.message || result.stderr || 'unknown PowerShell ACL failure').trim().slice(0, 500);
        fail(`Could not establish a protected Windows ACL for ${target.realPath}: ${detail}`);
    }
    return target.realPath;
}

function validateAuthorityDatabaseSecurity(context, databasePath, label) {
    const security = context.inspectWindowsPathSecurity(databasePath, {
        label,
        type: 'file',
        requireProtected: true,
    });
    if (security?.passed !== true
        || security?.ownerSid !== security?.currentUserSid
        || security?.inheritanceProtected !== true
        || Number(security?.highRiskWritePrincipalCount || 0) !== 0) {
        fail(`${label} Windows ACL/owner proof failed.`);
    }
    return security;
}

module.exports = { captureTrustedWindowsRuntime, minimalWindowsRuntimeEnvironment, assertDirectWindowsAncestors, stableServicingFileArtifact, resolveTrustedWindowsPowerShell, spawnTrustedWindowsPowerShell, defaultInspectWindowsPathSecurity, defaultProtectWindowsDirectory, defaultProtectWindowsFile, validateAuthorityDatabaseSecurity, trustedPowerShellCache };

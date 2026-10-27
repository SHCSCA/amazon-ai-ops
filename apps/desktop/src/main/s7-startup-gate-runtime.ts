// 按数据库生命周期、迁移和身份保护职责拆分，事务边界保持一致。
import * as fs from 'fs';
import * as path from 'path';
import { type S7StartupGateIo, type S7AuthorityPathProtectionPort, samePath, fail, GATE_ENV_NAMES, S7_STARTUP_GATE_ENV, type S7StartupGateAppPort } from './s7-startup-gate-contracts';
import { defaultReadStableFile, defaultInspectDirectory, defaultBuildAppContentManifest, defaultWriteExclusiveJson, defaultWriteProtectedExclusiveJson } from './s7-startup-gate-files';
import { defaultReadAuthoritySchemaVersion, defaultInspectPostMigrationAuthority } from './s7-startup-gate-authority';
import { defaultInspectTrustedPowerShell, defaultInspectWindowsPathSecurity, defaultProtectWindowsPath, defaultSleep } from './s7-startup-gate-security';

export const DEFAULT_IO: S7StartupGateIo = {
    existsSync: (filePath) => fs.existsSync(filePath),
    readStableFile: defaultReadStableFile,
    inspectDirectory: defaultInspectDirectory,
    buildAppContentManifest: defaultBuildAppContentManifest,
    readAuthoritySchemaVersion: defaultReadAuthoritySchemaVersion,
    inspectPostMigrationAuthority: defaultInspectPostMigrationAuthority,
    inspectTrustedPowerShell: defaultInspectTrustedPowerShell,
    inspectWindowsPathSecurity: defaultInspectWindowsPathSecurity,
    writeExclusiveJson: defaultWriteExclusiveJson,
    writeProtectedExclusiveJson: defaultWriteProtectedExclusiveJson,
    protectWindowsPath: defaultProtectWindowsPath,
    sleep: defaultSleep,
};

export function protectFreshS7AuthorityPath(filePath: string, type: 'file' | 'directory', label: string, port: S7AuthorityPathProtectionPort = DEFAULT_IO): void {
    const resolved = path.resolve(filePath);
    port.protectWindowsPath(resolved, type);
    const security = port.inspectWindowsPathSecurity(resolved, type, label);
    if (security.passed !== true
        || !samePath(security.path, resolved)
        || security.type !== type
        || security.ownerSid !== security.currentUserSid
        || security.inheritanceProtected !== true
        || security.unauthorizedRules.length !== 0) {
        fail('S7_STARTUP_GATE_ACL_UNTRUSTED', `${label} ACL/owner proof failed.`);
    }
}

export function gateEnvironmentPresent(env: NodeJS.ProcessEnv): boolean {
    return GATE_ENV_NAMES.some((name) => typeof env[name] === 'string' && env[name] !== '');
}

export function scrubGateEnvironment(env: NodeJS.ProcessEnv): void {
    for (const name of GATE_ENV_NAMES)
        delete env[name];
}

export function decodeGatePath(env: NodeJS.ProcessEnv): string {
    const encoded = String(env[S7_STARTUP_GATE_ENV.activePathB64] || '');
    if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
        fail('S7_STARTUP_GATE_ENV_INVALID', 'ACTIVE gate path environment binding is invalid.');
    }
    let decoded: string;
    try {
        decoded = Buffer.from(encoded, 'base64').toString('utf8');
    }
    catch {
        fail('S7_STARTUP_GATE_ENV_INVALID', 'ACTIVE gate path environment binding is not base64.');
    }
    if (!decoded || decoded.includes('\0') || !path.isAbsolute(decoded)) {
        fail('S7_STARTUP_GATE_ENV_INVALID', 'ACTIVE gate path environment binding is not absolute.');
    }
    return decoded;
}

export function assertSingleInstanceLock(app: S7StartupGateAppPort): void {
    if (app.requestSingleInstanceLock() !== true) {
        fail('S7_SINGLE_INSTANCE_LOCK_DENIED', 'Another application instance already owns the Electron lock.');
    }
}

export function resolveCanonicalAuthorityUserDataDir(env: NodeJS.ProcessEnv = process.env): string {
    const roaming = String(env.APPDATA || '');
    if (!roaming || roaming.includes('\0') || !path.isAbsolute(roaming)) {
        fail('S7_CANONICAL_USER_DATA_UNRESOLVED', 'APPDATA is unavailable or invalid.');
    }
    return path.resolve(roaming, '@amazon-ai-ops', 'desktop');
}

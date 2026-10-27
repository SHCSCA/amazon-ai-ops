// 按数据库生命周期、迁移和身份保护职责拆分，事务边界保持一致。
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { type S7StableFileArtifact, fail, samePath, sameIdentity, fileIdentity, MAX_GATE_FILE_BYTES, type S7FileIdentity, type GatePackageBinding, MAX_APP_CONTENT_DEPTH, MAX_APP_CONTENT_FILES, isPathWithin, sha256, type GateTrustedShellBinding } from './s7-startup-gate-contracts';
import { defaultProtectWindowsPath, defaultInspectWindowsPathSecurity } from './s7-startup-gate-security';

export function defaultReadStableFile(filePath: string, label: string, options: {
    captureContents?: boolean;
    maxBytes?: number;
} = {}): S7StableFileArtifact & {
    contents?: Buffer;
} {
    const requested = path.resolve(filePath);
    const pathBefore = fs.lstatSync(requested, { bigint: true });
    if (!pathBefore.isFile() || pathBefore.isSymbolicLink() || Number(pathBefore.nlink) !== 1) {
        fail('S7_STARTUP_GATE_PATH_UNSAFE', `${label} must be one direct, single-link file.`);
    }
    const realPath = fs.realpathSync.native(requested);
    if (!samePath(requested, realPath)) {
        fail('S7_STARTUP_GATE_PATH_UNSAFE', `${label} may not traverse a link or junction.`);
    }
    const descriptor = fs.openSync(requested, fs.constants.O_RDONLY);
    try {
        const handleBefore = fs.fstatSync(descriptor, { bigint: true });
        if (!handleBefore.isFile()
            || Number(handleBefore.nlink) !== 1
            || !sameIdentity(fileIdentity(pathBefore), fileIdentity(handleBefore))) {
            fail('S7_STARTUP_GATE_PATH_UNSAFE', `${label} changed while it was opened.`);
        }
        if (handleBefore.size < 1n) {
            fail('S7_STARTUP_GATE_INVALID', `${label} size is outside the bounded contract.`);
        }
        const captureContents = options.captureContents === true;
        const maxBytes = options.maxBytes ?? MAX_GATE_FILE_BYTES;
        if (captureContents
            && (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || handleBefore.size > BigInt(maxBytes))) {
            fail('S7_STARTUP_GATE_INVALID', `${label} size is outside the bounded JSON contract.`);
        }
        const hash = crypto.createHash('sha256');
        const chunks: Buffer[] = [];
        const buffer = Buffer.allocUnsafe(1024 * 1024);
        let total = 0;
        let bytesRead: number;
        do {
            bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
            if (bytesRead > 0) {
                const chunk = buffer.subarray(0, bytesRead);
                hash.update(chunk);
                if (captureContents)
                    chunks.push(Buffer.from(chunk));
                total += bytesRead;
            }
        } while (bytesRead > 0);
        const handleAfter = fs.fstatSync(descriptor, { bigint: true });
        const pathAfter = fs.lstatSync(requested, { bigint: true });
        if (!sameIdentity(fileIdentity(handleBefore), fileIdentity(handleAfter))
            || !sameIdentity(fileIdentity(handleBefore), fileIdentity(pathAfter))
            || handleBefore.size !== handleAfter.size
            || handleBefore.mtimeNs !== handleAfter.mtimeNs
            || handleAfter.mtimeNs !== pathAfter.mtimeNs
            || BigInt(total) !== handleAfter.size
            || !samePath(fs.realpathSync.native(requested), realPath)) {
            fail('S7_STARTUP_GATE_PATH_UNSAFE', `${label} drifted during its stable read.`);
        }
        return {
            path: requested,
            realPath,
            sha256: hash.digest('hex').toUpperCase(),
            sizeBytes: Number(handleAfter.size),
            mtimeMs: Number(handleAfter.mtimeNs / 1000000000n) * 1000 + Number(handleAfter.mtimeNs % 1000000000n) / 1000000,
            identity: fileIdentity(handleAfter),
            contents: captureContents ? Buffer.concat(chunks, total) : undefined,
        };
    }
    finally {
        fs.closeSync(descriptor);
    }
}

export function defaultInspectDirectory(directoryPath: string, label: string): {
    realPath: string;
    identity: S7FileIdentity;
} {
    const requested = path.resolve(directoryPath);
    const before = fs.lstatSync(requested, { bigint: true });
    if (!before.isDirectory() || before.isSymbolicLink()) {
        fail('S7_STARTUP_GATE_PATH_UNSAFE', `${label} must be one direct directory.`);
    }
    const realPath = fs.realpathSync.native(requested);
    if (!samePath(requested, realPath)) {
        fail('S7_STARTUP_GATE_PATH_UNSAFE', `${label} may not traverse a link or junction.`);
    }
    const after = fs.lstatSync(requested, { bigint: true });
    if (!sameIdentity(fileIdentity(before), fileIdentity(after))) {
        fail('S7_STARTUP_GATE_PATH_UNSAFE', `${label} changed during inspection.`);
    }
    return { realPath, identity: fileIdentity(after) };
}

export function hashDirectSingleLinkFile(filePath: string, label: string): {
    sha256: string;
    sizeBytes: number;
    identity: S7FileIdentity;
    realPath: string;
} {
    const requested = path.resolve(filePath);
    const before = fs.lstatSync(requested, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || Number(before.nlink) !== 1) {
        fail('S7_STARTUP_GATE_PATH_UNSAFE', `${label} must be one direct, single-link file.`);
    }
    const realPath = fs.realpathSync.native(requested);
    if (!samePath(realPath, requested)) {
        fail('S7_STARTUP_GATE_PATH_UNSAFE', `${label} may not traverse a link or junction.`);
    }
    const descriptor = fs.openSync(requested, fs.constants.O_RDONLY);
    try {
        const opened = fs.fstatSync(descriptor, { bigint: true });
        if (!sameIdentity(fileIdentity(before), fileIdentity(opened))) {
            fail('S7_STARTUP_GATE_PATH_UNSAFE', `${label} changed while it was opened.`);
        }
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
        if (!sameIdentity(fileIdentity(opened), fileIdentity(after))
            || opened.size !== after.size
            || opened.mtimeNs !== after.mtimeNs
            || BigInt(total) !== after.size
            || !samePath(fs.realpathSync.native(requested), realPath)) {
            fail('S7_STARTUP_GATE_PATH_UNSAFE', `${label} drifted while it was hashed.`);
        }
        return {
            realPath,
            sha256: hash.digest('hex').toUpperCase(),
            sizeBytes: total,
            identity: fileIdentity(after),
        };
    }
    finally {
        fs.closeSync(descriptor);
    }
}

export function defaultBuildAppContentManifest(rootPathInput: string): GatePackageBinding['appContent'] {
    const inspectedRoot = defaultInspectDirectory(rootPathInput, 'Packaged app-content root');
    const rootPath = inspectedRoot.realPath;
    const files: Array<{
        path: string;
        sha256: string;
        sizeBytes: number;
    }> = [];
    const visit = (directoryPath: string, depth: number): void => {
        if (depth > MAX_APP_CONTENT_DEPTH) {
            fail('S7_STARTUP_GATE_PACKAGE_UNTRUSTED', 'Packaged app-content nesting is unbounded.');
        }
        const names = fs.readdirSync(directoryPath).sort((left, right) => left.localeCompare(right, 'en'));
        for (const name of names) {
            if (files.length >= MAX_APP_CONTENT_FILES) {
                fail('S7_STARTUP_GATE_PACKAGE_UNTRUSTED', 'Packaged app-content file count is unbounded.');
            }
            const targetPath = path.join(directoryPath, name);
            const stat = fs.lstatSync(targetPath);
            if (stat.isSymbolicLink()) {
                fail('S7_STARTUP_GATE_PACKAGE_UNTRUSTED', 'Packaged app-content contains a link.');
            }
            const realPath = fs.realpathSync.native(targetPath);
            if (!isPathWithin(rootPath, realPath)) {
                fail('S7_STARTUP_GATE_PACKAGE_UNTRUSTED', 'Packaged app-content escapes its fixed root.');
            }
            if (stat.isDirectory()) {
                visit(realPath, depth + 1);
                continue;
            }
            const artifact = hashDirectSingleLinkFile(targetPath, `Packaged app-content ${name}`);
            const relativePath = path.relative(rootPath, artifact.realPath).split(path.sep).join('/');
            if (!relativePath
                || relativePath === '..'
                || relativePath.startsWith('../')
                || path.posix.isAbsolute(relativePath)) {
                fail('S7_STARTUP_GATE_PACKAGE_UNTRUSTED', 'Packaged app-content path is invalid.');
            }
            files.push({
                path: relativePath,
                sha256: artifact.sha256,
                sizeBytes: artifact.sizeBytes,
            });
        }
    };
    visit(rootPath, 0);
    files.sort((left, right) => left.path.localeCompare(right.path, 'en'));
    if (files.length < 1) {
        fail('S7_STARTUP_GATE_PACKAGE_UNTRUSTED', 'Packaged app-content is empty.');
    }
    const canonical = JSON.stringify({ schemaVersion: 1, files });
    return {
        realPath: rootPath,
        sha256: sha256(Buffer.from(canonical, 'utf8')),
        fileCount: files.length,
        sizeBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
    };
}

export function defaultWriteExclusiveJson(filePath: string, value: unknown): void {
    const contents = `${JSON.stringify(value, null, 2)}\n`;
    const descriptor = fs.openSync(path.resolve(filePath), 'wx');
    try {
        fs.writeFileSync(descriptor, contents, 'utf8');
        fs.fsyncSync(descriptor);
    }
    finally {
        fs.closeSync(descriptor);
    }
}

export function flushParentDirectoryWhereSupported(filePath: string): void {
    let descriptor: number | null = null;
    try {
        descriptor = fs.openSync(path.dirname(path.resolve(filePath)), fs.constants.O_RDONLY);
        fs.fsyncSync(descriptor);
    }
    catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code;
        if (!['EACCES', 'EBADF', 'EINVAL', 'EISDIR', 'ENOTSUP', 'EPERM'].includes(String(code))) {
            throw error;
        }
    }
    finally {
        if (descriptor !== null)
            fs.closeSync(descriptor);
    }
}

export function defaultWriteProtectedExclusiveJson(filePath: string, value: unknown, trustedShell?: GateTrustedShellBinding): void {
    const finalPath = path.resolve(filePath);
    const temporaryPath = path.join(path.dirname(finalPath), `.tmp-${path.basename(finalPath)}-${crypto.randomUUID()}`);
    let descriptor: number | null = null;
    let published = false;
    try {
        descriptor = fs.openSync(temporaryPath, 'wx');
        fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
        fs.fsyncSync(descriptor);
        fs.closeSync(descriptor);
        descriptor = null;
        defaultProtectWindowsPath(temporaryPath, 'file');
        const security = defaultInspectWindowsPathSecurity(temporaryPath, 'file', 'Post-migration admission staging receipt', trustedShell);
        if (security.passed !== true
            || security.ownerSid !== security.currentUserSid
            || security.inheritanceProtected !== true
            || security.unauthorizedRules.length !== 0) {
            fail('S7_STARTUP_GATE_ACL_UNTRUSTED', 'Post-migration admission staging receipt ACL/owner proof failed.');
        }
        fs.linkSync(temporaryPath, finalPath);
        published = true;
        fs.unlinkSync(temporaryPath);
        flushParentDirectoryWhereSupported(finalPath);
    }
    catch (error) {
        if (descriptor !== null) {
            try {
                fs.closeSync(descriptor);
            }
            catch {
            }
        }
        if (!published && fs.existsSync(temporaryPath)) {
            try {
                fs.unlinkSync(temporaryPath);
            }
            catch {
            }
        }
        throw error;
    }
}

// 按职责复用原有严格校验，公共入口继续保持兼容。
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { readJsonArtifact, validateS7LiveMigrationAcceptanceReceipt, } = require('./verify-s7-live-migration-acceptance');
const { SIDECARS, cleanAbsolute, exists, fail, identity, pathsOverlap, sameOrInside, samePath, sameStat } = require('./s7-launch-operator-contracts.js');

function directPath(value, label, type, { bigint = false } = {}) {
    const resolved = cleanAbsolute(value, label);
    let lstat;
    try {
        lstat = fs.lstatSync(resolved, { bigint });
    }
    catch (error) {
        if (error && error.code === 'ENOENT')
            fail(`${label} does not exist: ${resolved}`);
        throw error;
    }
    if (lstat.isSymbolicLink()) {
        fail(`${label} may not be a symbolic link, junction, or reparse point: ${resolved}`);
    }
    const realPath = fs.realpathSync.native(resolved);
    if (!samePath(resolved, realPath)) {
        fail(`${label} may not traverse a symbolic link, junction, or reparse point: ${resolved}`);
    }
    const stat = fs.statSync(realPath, { bigint });
    if (type === 'file' && !stat.isFile())
        fail(`${label} must be a regular file.`);
    if (type === 'directory' && !stat.isDirectory())
        fail(`${label} must be a directory.`);
    return { resolved, realPath, stat };
}

function fileArtifact(value, label) {
    const before = directPath(value, label, 'file', { bigint: true });
    if (before.stat.nlink !== 1n)
        fail(`${label} must have exactly one hard link.`);
    const handle = fs.openSync(before.realPath, 'r');
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let total = 0;
    let start;
    let end;
    let after;
    try {
        start = fs.fstatSync(handle, { bigint: true });
        if (!sameStat(before.stat, start)) {
            fail(`${label} changed identity before its stable read began.`);
        }
        let bytes;
        do {
            bytes = fs.readSync(handle, buffer, 0, buffer.length, null);
            if (bytes > 0) {
                hash.update(buffer.subarray(0, bytes));
                total += bytes;
            }
        } while (bytes > 0);
        end = fs.fstatSync(handle, { bigint: true });
        if (!sameStat(start, end) || BigInt(total) !== start.size) {
            fail(`${label} changed while it was being read.`);
        }
        after = directPath(value, label, 'file', { bigint: true });
        if (!sameStat(end, after.stat) || !samePath(before.realPath, after.realPath)) {
            fail(`${label} path was replaced while it was being read.`);
        }
    }
    finally {
        fs.closeSync(handle);
    }
    return Object.freeze({
        path: before.resolved,
        realPath: after.realPath,
        identity: identity(end, after.realPath),
        sha256: hash.digest('hex').toUpperCase(),
        sizeBytes: total,
        // 分开秒与纳秒，避免大整数先转浮点后偏离 Node 普通 stat 的时间值。
        mtimeMs: Number(end.mtimeNs / 1000000000n) * 1000 + Number(end.mtimeNs % 1000000000n) / 1000000,
    });
}

function startupGateFileArtifact(value, label) {
    const resolved = cleanAbsolute(value, label);
    const pathBefore = fs.lstatSync(resolved, { bigint: true });
    if (!pathBefore.isFile() || pathBefore.isSymbolicLink() || pathBefore.nlink !== 1n) {
        fail(`${label} must be one direct, single-link file.`);
    }
    const realPath = fs.realpathSync.native(resolved);
    if (!samePath(resolved, realPath)) {
        fail(`${label} may not traverse a symbolic link, junction, or reparse point.`);
    }
    const handle = fs.openSync(resolved, 'r');
    let contents;
    let handleBefore;
    let handleAfter;
    try {
        handleBefore = fs.fstatSync(handle, { bigint: true });
        if (handleBefore.dev !== pathBefore.dev
            || handleBefore.ino !== pathBefore.ino
            || handleBefore.nlink !== 1n) {
            fail(`${label} changed before its stable read.`);
        }
        contents = fs.readFileSync(handle);
        handleAfter = fs.fstatSync(handle, { bigint: true });
    }
    finally {
        fs.closeSync(handle);
    }
    const pathAfter = fs.lstatSync(resolved, { bigint: true });
    if (handleBefore.dev !== handleAfter.dev
        || handleBefore.ino !== handleAfter.ino
        || handleBefore.nlink !== handleAfter.nlink
        || handleBefore.size !== handleAfter.size
        || handleBefore.mtimeMs !== handleAfter.mtimeMs
        || handleAfter.dev !== pathAfter.dev
        || handleAfter.ino !== pathAfter.ino
        || handleAfter.nlink !== 1n
        || !samePath(fs.realpathSync.native(resolved), realPath)) {
        fail(`${label} changed during its stable read.`);
    }
    return {
        path: resolved,
        realPath,
        sha256: crypto.createHash('sha256').update(contents).digest('hex').toUpperCase(),
        sizeBytes: Number(handleAfter.size),
        mtimeMs: Number(handleAfter.mtimeMs),
        identity: {
            deviceId: handleAfter.dev.toString(),
            fileId: handleAfter.ino.toString(),
            hardLinkCount: Number(handleAfter.nlink),
        },
    };
}

function noSidecars(db, label) {
    const found = SIDECARS.filter((suffix) => exists(`${db}${suffix}`));
    if (found.length) {
        fail(`${label} has SQLite sidecars: ${found.map((item) => path.basename(item)).join(', ')}.`);
    }
}

function safeOutput(value, label = '--out') {
    const resolved = cleanAbsolute(value, label);
    if (path.extname(resolved).toLowerCase() !== '.json') {
        fail(`${label} must name a .json file.`);
    }
    directPath(path.dirname(resolved), `${label} parent`, 'directory');
    if (exists(resolved))
        fail(`${label} already exists and will not be overwritten: ${resolved}`);
    return resolved;
}

function isolatedRecoveryOutput(outputValue, recoveryRootValue, canonical, packageIdentity, inputArtifactPaths, inspectWindowsPathSecurity) {
    const recoveryRoot = directPath(recoveryRootValue, '--recovery-root', 'directory').realPath;
    const output = safeOutput(outputValue);
    if (!sameOrInside(output, recoveryRoot)) {
        fail('--out must be contained by --recovery-root.');
    }
    if (!samePath(path.dirname(output), recoveryRoot)) {
        fail('--out must be a direct child of --recovery-root.');
    }
    const packageRoot = path.dirname(cleanAbsolute(packageIdentity?.exe?.realPath, 'Current package EXE identity'));
    const appContentRoot = cleanAbsolute(packageIdentity?.appContent?.realPath, 'Current package app-content identity');
    const forbidden = [
        { label: 'package root', value: packageRoot },
        { label: 'package app-content', value: appContentRoot },
        {
            label: 'canonical packaged userData, database, sidecars, and profiles',
            value: cleanAbsolute(canonical?.userDataDir, 'Canonical packaged userData'),
        },
    ];
    for (const [index, inputPath] of inputArtifactPaths.entries()) {
        const artifact = directPath(inputPath, `Input artifact ${index + 1}`, 'file');
        forbidden.push({
            label: `input artifact tree ${index + 1}`,
            value: path.dirname(artifact.realPath),
        });
    }
    for (const item of forbidden) {
        if (pathsOverlap(recoveryRoot, item.value) || pathsOverlap(output, item.value)) {
            fail(`--recovery-root and --out must be isolated from ${item.label}.`);
        }
    }
    const windowsSecurity = inspectWindowsPathSecurity(recoveryRoot, {
        label: '--recovery-root',
        type: 'directory',
        requireProtected: true,
    });
    if (windowsSecurity?.passed !== true) {
        fail('--recovery-root Windows ACL proof failed.');
    }
    return { output, recoveryRoot, windowsSecurity };
}

function writeExclusive(output, value) {
    const finalPath = safeOutput(output);
    const temporary = path.join(path.dirname(finalPath), `.tmp-${path.basename(finalPath)}-${crypto.randomUUID()}`);
    let handle;
    try {
        handle = fs.openSync(temporary, 'wx', 0o600);
        fs.writeFileSync(handle, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
        fs.fsyncSync(handle);
        fs.closeSync(handle);
        handle = null;
        fs.linkSync(temporary, finalPath);
        fs.unlinkSync(temporary);
        return finalPath;
    }
    catch (error) {
        if (handle !== undefined && handle !== null)
            fs.closeSync(handle);
        if (exists(temporary))
            fs.unlinkSync(temporary);
        throw error;
    }
}

function writeDurableBlockingIntent(output, value) {
    const finalPath = safeOutput(output, 'Live migration launch intent');
    let handle;
    try {
        handle = fs.openSync(finalPath, 'wx', 0o600);
        fs.writeFileSync(handle, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
        fs.fsyncSync(handle);
        fs.closeSync(handle);
        handle = null;
        return finalPath;
    }
    catch (error) {
        if (handle !== undefined && handle !== null) {
            try {
                fs.closeSync(handle);
            }
            catch {
            }
        }
        throw error;
    }
}

function readJsonStable(value, label) {
    const result = readJsonArtifact(value, label);
    const artifact = fileArtifact(result.artifact.path, label);
    if (artifact.sha256 !== result.artifact.sha256
        || artifact.sizeBytes !== result.artifact.sizeBytes
        || !samePath(artifact.realPath, result.artifact.realPath)) {
        fail(`${label} changed between JSON parsing and stable identity verification.`);
    }
    return { artifact, value: result.value };
}

function assertTreeSingleLinked(rootPath) {
    const root = directPath(rootPath, 'Canonical package app-content', 'directory');
    const visit = (directory) => {
        for (const name of fs.readdirSync(directory)) {
            const target = path.join(directory, name);
            const stat = fs.lstatSync(target);
            if (stat.isSymbolicLink()) {
                fail(`Canonical package app-content contains a link or reparse point: ${target}`);
            }
            const real = fs.realpathSync.native(target);
            const relative = path.relative(root.realPath, real);
            if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
                fail(`Canonical package app-content escapes its fixed root: ${target}`);
            }
            if (stat.isDirectory())
                visit(real);
            else if (!stat.isFile() || stat.nlink !== 1) {
                fail(`Canonical package app-content leaf must be a single-linked regular file: ${target}`);
            }
        }
    };
    visit(root.realPath);
    return root;
}

function writeProtectedRecoveryOutput(output, value, context, label) {
    const written = writeExclusive(output, value);
    context.protectWindowsFile(written);
    const security = context.inspectWindowsPathSecurity(written, {
        label,
        type: 'file',
        requireProtected: false,
    });
    if (security?.passed !== true)
        fail(`${label} Windows ACL proof failed.`);
    return written;
}

function flushDirectoryWhereSupported(directoryPath) {
    let descriptor = null;
    try {
        descriptor = fs.openSync(directoryPath, fs.constants.O_RDONLY);
        fs.fsyncSync(descriptor);
    }
    catch (error) {
        if (!['EACCES', 'EBADF', 'EINVAL', 'EISDIR', 'ENOTSUP', 'EPERM'].includes(String(error?.code))) {
            throw error;
        }
    }
    finally {
        if (descriptor !== null)
            fs.closeSync(descriptor);
    }
}

function writeProtectedAtomicJson(output, value, context, label) {
    const finalPath = safeOutput(output, label);
    const parent = path.dirname(finalPath);
    const temporary = path.join(parent, `.tmp-${path.basename(finalPath)}-${crypto.randomUUID()}`);
    let handle = null;
    let published = false;
    try {
        handle = fs.openSync(temporary, 'wx', 0o600);
        fs.writeFileSync(handle, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
        fs.fsyncSync(handle);
        fs.closeSync(handle);
        handle = null;
        context.protectWindowsFile(temporary);
        const stagedSecurity = context.inspectWindowsPathSecurity(temporary, {
            label: `${label} staging file`,
            type: 'file',
            requireProtected: true,
        });
        if (stagedSecurity?.passed !== true) {
            fail(`${label} staging ACL proof failed.`);
        }
        fs.linkSync(temporary, finalPath);
        published = true;
        fs.unlinkSync(temporary);
        flushDirectoryWhereSupported(parent);
        const finalArtifact = fileArtifact(finalPath, label);
        const finalSecurity = context.inspectWindowsPathSecurity(finalPath, {
            label,
            type: 'file',
            requireProtected: true,
        });
        if (finalSecurity?.passed !== true)
            fail(`${label} final ACL proof failed.`);
        return { path: finalPath, artifact: finalArtifact, windowsSecurity: finalSecurity };
    }
    catch (error) {
        if (handle !== null) {
            try {
                fs.closeSync(handle);
            }
            catch {
            }
        }
        if (!published && exists(temporary)) {
            try {
                fs.unlinkSync(temporary);
            }
            catch {
            }
        }
        throw error;
    }
}

module.exports = { directPath, fileArtifact, startupGateFileArtifact, noSidecars, safeOutput, isolatedRecoveryOutput, writeExclusive, writeDurableBlockingIntent, readJsonStable, assertTreeSingleLinked, writeProtectedRecoveryOutput, flushDirectoryWhereSupported, writeProtectedAtomicJson };

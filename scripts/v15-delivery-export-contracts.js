// 按职责复用原有严格校验，公共入口继续保持兼容。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');


const root = path.resolve(__dirname, '..');

const evidenceDir = path.join(root, 'output', 'codex-evidence');

const bundleRoot = path.join(root, 'output', 'delivery-bundles');

const appDataStorageRoot = process.env.APPDATA
    ? path.join(process.env.APPDATA, '@amazon-ai-ops', 'desktop', 'storage')
    : '';

const validatedExternalPackageLaunchArtifacts = new Set();

const validatedPackageLaunchEvidencePaths = new Set();

function parseArgs(argv) {
    const args = {};
    for (let index = 2; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith('--'))
            throw new Error(`Unexpected argument: ${token}`);
        const key = token.slice(2);
        const value = argv[index + 1];
        if (!value || value.startsWith('--'))
            throw new Error(`Missing value for --${key}`);
        args[key] = value;
        index += 1;
    }
    return args;
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sha256(filePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function safeBasename(filePath) {
    return path.basename(filePath).replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function canonicalPath(inputPath) {
    const resolved = path.resolve(inputPath);
    try {
        return fs.realpathSync.native(resolved);
    }
    catch {
        return resolved;
    }
}

function samePath(left, right) {
    if (!left || !right)
        return false;
    return canonicalPath(left).toLowerCase() === canonicalPath(right).toLowerCase();
}

function isInside(childPath, parentPath) {
    if (!childPath || !parentPath)
        return false;
    const relative = path.relative(canonicalPath(parentPath), canonicalPath(childPath));
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function explicitFileArg(args, key) {
    if (!args[key])
        return null;
    const filePath = path.resolve(args[key]);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        throw new Error(`Explicit --${key} file is missing: ${filePath}`);
    }
    return filePath;
}

function siblingMarkdownPath(jsonPath) {
    if (!jsonPath)
        return null;
    const markdownPath = jsonPath.replace(/\.json$/i, '.md');
    return fs.existsSync(markdownPath) && fs.statSync(markdownPath).isFile() ? markdownPath : null;
}

function isProductionDataReconciliationName(fileName) {
    return !/(?:^|[-_.])(smoke|test|fixture)(?:[-_.]|$)/i.test(path.basename(fileName));
}

function isRealReportPath(value) {
    return typeof value === 'string' && /\.(xlsx|xls|csv)$/i.test(value.trim());
}

function packageIdentity(item) {
    return [
        String(item?.kind || ''),
        String(item?.sourcePath || ''),
        String(item?.fileName || ''),
    ].join('\u0000');
}

function packageListsMatch(leftPackages, rightPackages) {
    if (!Array.isArray(leftPackages) || !Array.isArray(rightPackages))
        return false;
    if (leftPackages.length !== rightPackages.length)
        return false;
    const left = [...leftPackages].sort((a, b) => packageIdentity(a).localeCompare(packageIdentity(b)));
    const right = [...rightPackages].sort((a, b) => packageIdentity(a).localeCompare(packageIdentity(b)));
    return left.every((item, index) => {
        const other = right[index];
        return item.kind === other.kind
            && path.resolve(item.sourcePath) === path.resolve(other.sourcePath)
            && item.fileName === other.fileName
            && Number(item.sizeBytes || 0) === Number(other.sizeBytes || 0)
            && String(item.sha256 || '').toUpperCase() === String(other.sha256 || '').toUpperCase();
    });
}

module.exports = { parseArgs, readJson, sha256, safeBasename, canonicalPath, samePath, isInside, explicitFileArg, siblingMarkdownPath, isProductionDataReconciliationName, isRealReportPath, packageIdentity, packageListsMatch, root, evidenceDir, bundleRoot, appDataStorageRoot, validatedExternalPackageLaunchArtifacts, validatedPackageLaunchEvidencePaths };

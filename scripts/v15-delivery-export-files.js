// 按职责复用原有严格校验，公共入口继续保持兼容。
const fs = require('fs');
const path = require('path');
const { appDataStorageRoot, canonicalPath, evidenceDir, isInside, root, safeBasename, sha256, validatedExternalPackageLaunchArtifacts } = require('./v15-delivery-export-contracts.js');

function uniqueDestinationPath(destinationDir, basename) {
    const parsed = path.parse(basename);
    let candidate = path.join(destinationDir, basename);
    let index = 1;
    while (fs.existsSync(candidate)) {
        candidate = path.join(destinationDir, `${parsed.name}-${index}${parsed.ext}`);
        index += 1;
    }
    return candidate;
}

function assertAllowedSource(sourcePath, label) {
    const resolved = canonicalPath(sourcePath);
    const ext = path.extname(resolved).toLowerCase();
    const isRepoDocOrScript = isInside(resolved, root)
        && (isInside(resolved, path.join(root, 'docs'))
            || isInside(resolved, path.join(root, 'scripts'))
            || path.basename(resolved) === 'AGENTS.md'
            || path.basename(resolved) === 'README.md'
            || path.basename(resolved) === 'package.json'
            || isInside(resolved, evidenceDir));
    const isAppOwnedEvidence = appDataStorageRoot
        && isInside(resolved, appDataStorageRoot)
        && (isInside(resolved, path.join(appDataStorageRoot, 'screenshots'))
            || isInside(resolved, path.join(appDataStorageRoot, 'exports'))
            || path.basename(resolved).toLowerCase() === 'manifest.json');
    const isValidatedPackageLaunchArtifact = validatedExternalPackageLaunchArtifacts.has(resolved.toLowerCase());
    if (!isRepoDocOrScript && !isAppOwnedEvidence && !isValidatedPackageLaunchArtifact) {
        throw new Error(`Refusing to export ${label}: source path is outside allowed evidence roots: ${resolved}`);
    }
    if (['.db', '.sqlite', '.sqlite3', '.exe', '.xlsx', '.xls', '.csv'].includes(ext)) {
        throw new Error(`Refusing to export ${label}: blocked file extension ${ext}`);
    }
}

function copyFile(sourcePath, destinationDir, label, manifest) {
    if (!sourcePath || !fs.existsSync(sourcePath)) {
        manifest.missing.push({ label, sourcePath: sourcePath || null });
        return null;
    }
    if (!fs.statSync(sourcePath).isFile())
        return null;
    const resolved = path.resolve(sourcePath);
    assertAllowedSource(resolved, label);
    assertNoObviousSecret(resolved);
    const destinationPath = uniqueDestinationPath(destinationDir, safeBasename(resolved));
    fs.mkdirSync(destinationDir, { recursive: true });
    fs.copyFileSync(resolved, destinationPath);
    manifest.files.push({
        label,
        sourcePath: resolved,
        bundlePath: path.relative(manifest.bundleDir, destinationPath),
        sizeBytes: fs.statSync(destinationPath).size,
        sha256: sha256(destinationPath),
    });
    return destinationPath;
}

function assertNoObviousSecret(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (!['.json', '.md', '.txt', '.csv'].includes(ext))
        return;
    const text = fs.readFileSync(filePath, 'utf8');
    const textForScan = text.replace(/(DEEPSEEK[_-]?API[_-]?KEY["']?\s*[:=]\s*)["']<[^"']+>["']/gi, '$1<placeholder>');
    const patterns = [
        /sk-[A-Za-z0-9_-]{16,}/,
        /Bearer\s+[A-Za-z0-9._~+/=-]{16,}/i,
        /deepseek[_-]?api[_-]?key["']?\s*[:=]\s*["'][^"']+/i,
        /LINGXING_PASSWORD\s*[:=]\s*['"]?(?!<)[^'"\s]+/i,
    ];
    const matched = patterns.find((pattern) => pattern.test(textForScan));
    if (matched) {
        throw new Error(`Refusing to export possible secret in ${filePath}: ${matched}`);
    }
}

function writeGitSnapshot(bundleDir, manifest) {
    const { spawnSync } = require('child_process');
    const run = (args) => {
        const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
        return result.status === 0 ? (result.stdout || '').trim() : `ERROR: ${(result.stderr || result.stdout || '').trim()}`;
    };
    const text = [
        `generatedAt=${new Date().toISOString()}`,
        `head=${run(['rev-parse', 'HEAD'])}`,
        `branch=${run(['branch', '--show-current'])}`,
        '',
        'status --short:',
        run(['status', '--short']),
        '',
        'diff --stat:',
        run(['diff', '--stat']),
    ].join('\n');
    const gitDir = path.join(bundleDir, 'git');
    fs.mkdirSync(gitDir, { recursive: true });
    const targetPath = path.join(gitDir, 'git-status.txt');
    fs.writeFileSync(targetPath, text, 'utf8');
    manifest.files.push({
        label: 'git-status',
        sourcePath: 'generated',
        bundlePath: path.relative(manifest.bundleDir, targetPath),
        sizeBytes: fs.statSync(targetPath).size,
        sha256: sha256(targetPath),
    });
}

module.exports = { uniqueDestinationPath, assertAllowedSource, copyFile, assertNoObviousSecret, writeGitSnapshot };

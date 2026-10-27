// 按职责复用原有严格校验，公共入口继续保持兼容。
const fs = require('fs');
const path = require('path');
const { root, sha256 } = require('./v15-delivery-export-contracts.js');

function latestReleasePackageFiles(releaseDir) {
    if (!releaseDir || !fs.existsSync(releaseDir))
        return [];
    const files = fs.readdirSync(releaseDir)
        .filter((name) => /^AmazonAIOpsAgent-.*\.exe$/i.test(name))
        .map((name) => path.join(releaseDir, name))
        .filter((filePath) => fs.existsSync(filePath) && fs.statSync(filePath).isFile())
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    const portable = files.find((filePath) => /portable/i.test(path.basename(filePath)));
    const installer = files.find((filePath) => !/portable/i.test(path.basename(filePath)));
    return [
        installer ? { kind: 'installer', filePath: installer } : null,
        portable ? { kind: 'portable', filePath: portable } : null,
    ].filter(Boolean);
}

function buildPackageIndex(releaseDir) {
    const packages = latestReleasePackageFiles(releaseDir).map((entry) => {
        const stat = fs.statSync(entry.filePath);
        return {
            kind: entry.kind,
            sourcePath: path.resolve(entry.filePath),
            fileName: path.basename(entry.filePath),
            exists: true,
            sizeBytes: stat.size,
            sha256: sha256(entry.filePath),
            modifiedAt: stat.mtime.toISOString(),
        };
    });
    return {
        generatedAt: new Date().toISOString(),
        releaseDir: path.resolve(releaseDir || path.join(root, 'apps', 'desktop', 'release')),
        copyPolicy: 'Installer and portable EXE binaries are not copied into the delivery bundle; this index records local paths, existence, size, and SHA-256.',
        packages,
    };
}

function writePackageIndex(bundleDir, evidenceOutDir, manifest, packageIndex) {
    const indexPath = path.join(evidenceOutDir, 'release-package-index.json');
    fs.mkdirSync(evidenceOutDir, { recursive: true });
    fs.writeFileSync(indexPath, `${JSON.stringify(packageIndex, null, 2)}\n`, 'utf8');
    manifest.files.push({
        label: 'release-package-index',
        sourcePath: 'generated',
        bundlePath: path.relative(bundleDir, indexPath),
        sizeBytes: fs.statSync(indexPath).size,
        sha256: sha256(indexPath),
    });
    return indexPath;
}

module.exports = { latestReleasePackageFiles, buildPackageIndex, writePackageIndex };

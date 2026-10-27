// 按职责复用原有严格校验，公共入口继续保持兼容。
const fs = require('fs');
const { resolveBoundAdReadbackAuthorityDbPath } = require('./ad-readback-authority-db');
const { samePath } = require('./v15-non-ready-safety-contracts.js');

function hasBoundExistingAuthorityDb(finalReadiness, manifest, explicitPath) {
    const bundleAuthority = manifest.authorityDatabase;
    if (!bundleAuthority?.sourcePath || bundleAuthority.existsAtExport !== true || bundleAuthority.copied !== false)
        return false;
    try {
        const recordedPath = resolveBoundAdReadbackAuthorityDbPath(finalReadiness.evidenceSelection?.authorityDbPath, explicitPath);
        return fs.statSync(recordedPath).isFile()
            && fs.statSync(bundleAuthority.sourcePath).isFile()
            && samePath(recordedPath, bundleAuthority.sourcePath);
    }
    catch {
        return false;
    }
}

module.exports = { hasBoundExistingAuthorityDb };

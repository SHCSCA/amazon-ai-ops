// 按职责复用原有严格校验，公共入口继续保持兼容。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { addViolation, isRecord } = require('./mission-ui-contract-contracts.js');

function isAbsoluteScreenshotPath(value) {
    return typeof value === 'string'
        && value.length > 0
        && (path.win32.isAbsolute(value) || path.posix.isAbsolute(value))
        && path.extname(value).toLowerCase() === '.png';
}

function isSha256(value) {
    return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function sha256File(filePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function sha256Tree(rootDir) {
    const files = [];
    const visit = (directory) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const absolutePath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                visit(absolutePath);
            }
            else if (entry.isFile()) {
                files.push(absolutePath);
            }
        }
    };
    visit(rootDir);
    files.sort((left, right) => left.localeCompare(right, 'en'));
    const hash = crypto.createHash('sha256');
    for (const filePath of files) {
        hash.update(path.relative(rootDir, filePath).replace(/\\/g, '/'));
        hash.update('\0');
        hash.update(fs.readFileSync(filePath));
        hash.update('\0');
    }
    return hash.digest('hex');
}

function currentMissionControlUiEvidenceSourceHashes(repoRoot = path.resolve(__dirname, '..')) {
    return {
        runnerSha256: sha256File(path.join(repoRoot, 'scripts', 'run-mission-control-ui-evidence.js')),
        contractSha256: sha256File(__filename),
        rendererTreeSha256: sha256Tree(path.join(repoRoot, 'apps', 'desktop', 'src', 'renderer')),
    };
}

function validateScreenshot(capture, capturePath, violations, options = {}) {
    if (!isRecord(capture.screenshot)) {
        addViolation(violations, 'SCREENSHOT_MISSING', `${capturePath}.screenshot`, 'Capture must include screenshot evidence.');
        return;
    }
    if (!isAbsoluteScreenshotPath(capture.screenshot.absolutePath)) {
        addViolation(violations, 'SCREENSHOT_PATH_NOT_ABSOLUTE', `${capturePath}.screenshot.absolutePath`, 'Screenshot path must be an absolute PNG path.');
    }
    if (!isSha256(capture.screenshot.sha256)) {
        addViolation(violations, 'SCREENSHOT_SHA256_MISSING', `${capturePath}.screenshot.sha256`, 'Screenshot must carry a 64-character SHA-256 digest.');
    }
    if (options.verifyScreenshotFiles !== true || !isAbsoluteScreenshotPath(capture.screenshot.absolutePath)) {
        return;
    }
    if (!fs.existsSync(capture.screenshot.absolutePath)) {
        addViolation(violations, 'SCREENSHOT_FILE_MISSING', `${capturePath}.screenshot.absolutePath`, 'Screenshot file must exist when filesystem verification is enabled.');
        return;
    }
    if (isSha256(capture.screenshot.sha256)) {
        const actualSha256 = crypto
            .createHash('sha256')
            .update(fs.readFileSync(capture.screenshot.absolutePath))
            .digest('hex');
        if (actualSha256.toLowerCase() !== capture.screenshot.sha256.toLowerCase()) {
            addViolation(violations, 'SCREENSHOT_SHA256_MISMATCH', `${capturePath}.screenshot.sha256`, 'Screenshot SHA-256 must match the referenced PNG bytes.', { actual: actualSha256, expected: capture.screenshot.sha256 });
        }
    }
}

module.exports = { isAbsoluteScreenshotPath, isSha256, sha256File, sha256Tree, currentMissionControlUiEvidenceSourceHashes, validateScreenshot };

// 按证据职责拆分夹具与验收断言，测试仍归属原有入口。
import { CRC_TABLE, ONE_PIXEL_PNG, PNG_SIGNATURE, crypto, fs, packageUiEvidence, path, readinessVerifier, root, spawnSync, testTempRoot, verifierPath, zlib } from './mission-control-readiness-test-environment.mjs';
function makeTempDir(prefix) {
    return fs.mkdtempSync(path.join(testTempRoot, prefix));
}

function runVerifier(args) {
    if (args.verificationContext) {
        const result = readinessVerifier.run(args, args.verificationContext);
        return { status: result.exitCode, stdout: '', stderr: '' };
    }
    const env = { ...process.env, TEMP: testTempRoot, TMP: testTempRoot };
    delete env.npm_config_cache;
    return spawnSync(process.execPath, [verifierPath, ...args], {
        cwd: root,
        encoding: 'utf8',
        env,
    });
}

function createCanonicalPackageFixture(tempDir) {
    const releaseRoot = path.join(tempDir, 'release');
    const executablePath = path.join(releaseRoot, 'win-unpacked', 'AmazonAIOpsAgent.exe');
    const appContentPath = path.join(releaseRoot, 'win-unpacked', 'resources', 'app');
    const mainBundlePath = path.join(appContentPath, 'dist', 'main', 'index.js');
    const portablePath = path.join(releaseRoot, 'AmazonAIOpsAgent-1.5.0-portable.exe');
    const installerPath = path.join(releaseRoot, 'AmazonAIOpsAgent-1.5.0.exe');
    fs.mkdirSync(path.join(appContentPath, 'dist', 'preload'), { recursive: true });
    fs.mkdirSync(path.join(appContentPath, 'dist', 'renderer'), { recursive: true });
    fs.mkdirSync(path.join(appContentPath, 'playwright-browsers', 'chrome-win64'), { recursive: true });
    writeJson(path.join(appContentPath, 'package.json'), {
        name: '@amazon-ai-ops/desktop', version: JSON.parse(fs.readFileSync(new URL('../apps/desktop/package.json', import.meta.url), 'utf8')).version, main: 'dist/main/index.js',
    });
    fs.mkdirSync(path.dirname(mainBundlePath), { recursive: true });
    fs.writeFileSync(executablePath, 'canonical-unpacked-package');
    fs.writeFileSync(mainBundlePath, 'canonical-main-bundle');
    fs.writeFileSync(path.join(appContentPath, 'dist', 'preload', 'index.js'), 'canonical-preload');
    fs.writeFileSync(path.join(appContentPath, 'dist', 'renderer', 'index.html'), '<!doctype html>');
    fs.writeFileSync(path.join(appContentPath, 'playwright-browsers', 'chrome-win64', 'chrome.exe'), 'canonical-chromium-runtime');
    fs.writeFileSync(portablePath, 'canonical-portable-package');
    fs.writeFileSync(installerPath, 'canonical-installer-package');
    const builtAt = new Date('2026-07-10T00:30:00.000Z');
    const touchTree = (target) => {
        const stat = fs.statSync(target);
        if (stat.isDirectory())
            for (const name of fs.readdirSync(target))
                touchTree(path.join(target, name));
        fs.utimesSync(target, builtAt, builtAt);
    };
    touchTree(releaseRoot);
    const appContent = packageUiEvidence.buildAppContentManifest(appContentPath);
    return {
        releaseRoot, executablePath, appContentPath, mainBundlePath, portablePath, installerPath,
        packageIdentity: {
            executableSha256: sha256File(executablePath),
            appContentSha256: appContent.sha256.toUpperCase(),
            mainBundleSha256: sha256File(mainBundlePath),
        },
    };
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    return filePath;
}

function sha256File(filePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function sha256Text(value) {
    return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function stableJson(value) {
    if (Array.isArray(value))
        return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function artifact(filePath) {
    const stat = fs.statSync(filePath);
    return { path: filePath, sizeBytes: stat.size, sha256: sha256File(filePath) };
}

function writeArtifact(filePath, content) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
    return artifact(filePath);
}

function screenshotBytes(label) {
    return Buffer.concat([ONE_PIXEL_PNG, Buffer.from(`\n${label}\n`, 'utf8')]);
}

function crc32(buffer) {
    let crc = 0xFFFFFFFF;
    for (const byte of buffer)
        crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data = Buffer.alloc(0)) {
    const typeBytes = Buffer.from(type, 'ascii');
    const chunk = Buffer.alloc(12 + data.length);
    chunk.writeUInt32BE(data.length, 0);
    typeBytes.copy(chunk, 4);
    data.copy(chunk, 8);
    chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
    return chunk;
}

function canaryScreenshotBytes(gray, { width = 1200, height = 700 } = {}) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = 0;
    const raw = Buffer.alloc((width + 1) * height);
    for (let row = 0; row < height; row += 1) {
        const offset = row * (width + 1);
        raw[offset] = 0;
        raw.fill(gray, offset + 1, offset + width + 1);
    }
    return Buffer.concat([
        PNG_SIGNATURE,
        pngChunk('IHDR', ihdr),
        pngChunk('IDAT', zlib.deflateSync(raw)),
        pngChunk('IEND'),
    ]);
}

function packageIndexArtifact(kind, filePath) {
    const record = artifact(filePath);
    return {
        kind,
        sourcePath: record.path,
        fileName: path.basename(record.path),
        exists: true,
        sizeBytes: record.sizeBytes,
        sha256: record.sha256,
        modifiedAt: fs.statSync(filePath).mtime.toISOString(),
    };
}
export { makeTempDir, runVerifier, createCanonicalPackageFixture, readJson, writeJson, sha256File, sha256Text, stableJson, artifact, writeArtifact, screenshotBytes, crc32, pngChunk, canaryScreenshotBytes, packageIndexArtifact };

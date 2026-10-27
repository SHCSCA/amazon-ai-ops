// 按证据职责拆分共享夹具与断言，保留原有完整测试名称。
import { cleanupPaths, crypto, fs, path } from './v15-export-test-environment.mjs';
function writeJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    cleanupPaths.push(filePath);
}

function writePng(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.from(path.basename(filePath), 'utf8'),
    ]));
    cleanupPaths.push(filePath);
    return filePath;
}

function hashBoundFile(filePath) {
    const stat = fs.statSync(filePath);
    return {
        path: filePath,
        sizeBytes: stat.size,
        sha256: crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase(),
    };
}

function writeReport(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'placeholder report file for delivery bundle verifier\n', 'utf8');
    cleanupPaths.push(filePath);
    return filePath;
}

function writeReleaseFile(filePath, content) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
    cleanupPaths.push(filePath);
    return filePath;
}

function writeReadme(filePath, status = 'APP_READY') {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, [
        '# Amazon AI Ops',
        '',
        `**DELIVERY: ${status}.** Test delivery status line.`,
        '',
    ].join('\n'), 'utf8');
    cleanupPaths.push(filePath);
    return filePath;
}

function writeText(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, value, 'utf8');
    cleanupPaths.push(filePath);
    return filePath;
}

function sha256Text(content) {
    return crypto.createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex').toUpperCase();
}

function packageIndexFromArtifacts(artifacts) {
    return {
        present: artifacts.length > 0,
        count: artifacts.length,
        existingCount: artifacts.length,
        missingCount: 0,
        packages: artifacts.map((artifact) => ({
            kind: artifact.kind,
            sourcePath: artifact.filePath,
            fileName: path.basename(artifact.filePath),
            exists: true,
            sizeBytes: Buffer.byteLength(artifact.content, 'utf8'),
            sha256: sha256Text(artifact.content),
        })),
    };
}
export { writeJson, writePng, hashBoundFile, writeReport, writeReleaseFile, writeReadme, writeText, sha256Text, packageIndexFromArtifacts };

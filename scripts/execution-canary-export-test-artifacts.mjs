// 按证据职责拆分夹具与验收断言，测试仍归属原有入口。
import { crypto, fs, ownedTempDirs, path, tempRoot } from './execution-canary-export-test-environment.mjs';
function makeTempDir(prefix) {
    const directory = fs.mkdtempSync(path.join(tempRoot, prefix));
    ownedTempDirs.push(directory);
    return directory;
}

function sha256File(filePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function fileArtifact(filePath) {
    const stat = fs.statSync(filePath);
    return {
        sha256: sha256File(filePath),
        sizeBytes: stat.size,
        mtimeMs: stat.mtimeMs,
    };
}

function temporaryOutputFiles(fixture) {
    const outputDirectory = path.dirname(fixture.outputPath);
    if (!fs.existsSync(outputDirectory))
        return [];
    return fs.readdirSync(outputDirectory)
        .filter((name) => name.includes(path.basename(fixture.outputPath)) && name.endsWith('.tmp'));
}
export { makeTempDir, sha256File, fileArtifact, temporaryOutputFiles };

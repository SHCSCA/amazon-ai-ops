// 按证据职责拆分夹具与验收断言，测试仍归属原有入口。
import { REQUIRED_MIGRATION_VERIFICATION_CODES, fs, path, require } from './s7-launch-operator-test-environment.mjs';
function sha(value) {
    return require('node:crypto').createHash('sha256').update(value).digest('hex').toUpperCase();
}

function write(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function gateArtifact(filePath) {
    const stat = fs.lstatSync(filePath, { bigint: true });
    return {
        path: path.resolve(filePath),
        realPath: fs.realpathSync.native(filePath),
        sha256: sha(fs.readFileSync(filePath)),
        sizeBytes: Number(stat.size),
        mtimeMs: Number(stat.mtimeMs),
        identity: {
            deviceId: stat.dev.toString(),
            fileId: stat.ino.toString(),
            hardLinkCount: Number(stat.nlink),
        },
    };
}

function gateBinding(artifact) {
    return {
        realPath: artifact.realPath,
        sha256: artifact.sha256,
        sizeBytes: artifact.sizeBytes,
        identity: { ...artifact.identity },
    };
}

function passingVerification(manifest) {
    return {
        kind: 's7-migration-backup-restore-verification',
        schemaVersion: 1,
        generatedAt: '2026-07-29T00:30:00.000Z',
        sourceManifestPath: manifest,
        sourceManifestSha256: sha(fs.readFileSync(manifest)),
        passed: true,
        checks: REQUIRED_MIGRATION_VERIFICATION_CODES.map((code) => ({
            code,
            passed: true,
            detail: 'synthetic-readonly-proof',
        })),
        summary: {
            total: REQUIRED_MIGRATION_VERIFICATION_CODES.length,
            passed: REQUIRED_MIGRATION_VERIFICATION_CODES.length,
            failed: 0,
        },
    };
}
export { sha, write, clone, gateArtifact, gateBinding, passingVerification };

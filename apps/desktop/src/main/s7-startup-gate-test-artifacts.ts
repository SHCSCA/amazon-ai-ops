// 按证据职责拆分共享夹具与验收断言，保留原有断言名称。
import { S7_STARTUP_GATE_TESTING, fs, path } from './s7-startup-gate-test-environment';
function write(filePath: string, contents: string | object): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, typeof contents === 'string' ? contents : `${JSON.stringify(contents, null, 2)}\n`);
}

function publicArtifact(artifact: ReturnType<typeof S7_STARTUP_GATE_TESTING.defaultReadStableFile>) {
    return {
        realPath: artifact.realPath,
        sha256: artifact.sha256,
        sizeBytes: artifact.sizeBytes,
        identity: { ...artifact.identity },
    };
}
export { write, publicArtifact };

// 按证据职责拆分共享夹具与断言，保留原有完整测试名称。
import { crypto, fs, path, root, spawnSync } from './v15-ready-test-environment.mjs';
function runNode(script, args = []) {
    return spawnSync(process.execPath, [path.join(root, script), ...args], {
        cwd: root,
        encoding: 'utf8',
    });
}

function writeJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writePng(filePath) {
    fs.writeFileSync(filePath, Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.from(path.basename(filePath), 'utf8'),
    ]));
    return filePath;
}

function writeReport(filePath) {
    fs.writeFileSync(filePath, 'placeholder report file for READY safety verifier\n', 'utf8');
    return filePath;
}

function sha256Text(content) {
    return crypto.createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex').toUpperCase();
}
export { runNode, writeJson, readJson, writePng, writeReport, sha256Text };

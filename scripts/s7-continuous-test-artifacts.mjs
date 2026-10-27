// 按证据职责拆分夹具与验收断言，测试仍归属原有入口。
import { crypto, fs } from './s7-continuous-test-environment.mjs';
function sha256Text(value) {
    return crypto.createHash('sha256').update(value).digest('hex').toUpperCase();
}

function sha256File(filePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}
export { sha256Text, sha256File };

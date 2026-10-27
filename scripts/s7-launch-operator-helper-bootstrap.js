// 按职责复用原有严格校验，公共入口继续保持兼容。
const zlib = require('node:zlib');
const { EXCLUSIVE_WINDOW_HELPER_SCRIPT } = require('./s7-launch-operator-helper-script.js');

const EXCLUSIVE_WINDOW_HELPER_BOOTSTRAP = (() => {
    const compressed = zlib.gzipSync(Buffer.from(EXCLUSIVE_WINDOW_HELPER_SCRIPT, 'utf8'), { level: 9 }).toString('base64');
    return [
        "$ErrorActionPreference='Stop'",
        `$b=[Convert]::FromBase64String('${compressed}')`,
        '$m=[IO.MemoryStream]::new($b)',
        '$g=[IO.Compression.GZipStream]::new($m,[IO.Compression.CompressionMode]::Decompress)',
        '$r=[IO.StreamReader]::new($g,[Text.Encoding]::UTF8,$true)',
        'try{$s=$r.ReadToEnd()}finally{$r.Dispose();$g.Dispose();$m.Dispose()}',
        '& ([ScriptBlock]::Create($s))',
    ].join(';');
})();

module.exports = { EXCLUSIVE_WINDOW_HELPER_BOOTSTRAP };

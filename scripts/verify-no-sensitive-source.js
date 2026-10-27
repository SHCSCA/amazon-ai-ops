const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createRuntimeLogRecord } = require('../packages/shared-types/src/runtime-log-format.cjs');

const RULES = [
  { kind: 'PROVIDER_API_KEY', expression: /\bsk-(?:(?:proj|ant-api03)-)?[A-Za-z0-9_-]{24,}\b/g },
  { kind: 'AWS_ACCESS_KEY', expression: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { kind: 'PRIVATE_KEY', expression: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { kind: 'GITHUB_ACCESS_TOKEN', expression: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g },
];
const TEXT_SOURCE = /\.(?:[cm]?[jt]sx?|json|md|ya?ml|toml|ini|env|txt|html|css)$/i;
const FORBIDDEN_ARTIFACT = /(?:^|\/)(?:Local State|Cookies|Login Data)(?:$|\/)|\.(?:db|sqlite3?|exe|pfx|p12|pem|key)$/i;

function inspectSourceText(relativePath, text) {
  const findings = [];
  for (const { kind, expression } of RULES) {
    expression.lastIndex = 0;
    for (const match of text.matchAll(expression)) {
      findings.push({ path: relativePath, line: text.slice(0, match.index).split('\n').length, kind });
    }
  }
  return findings;
}
function inspectCurrentSource(root) {
  const filenames = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024,
  }).split('\0').filter(Boolean);
  const findings = [];
  for (const filename of new Set(filenames)) {
    const normalized = filename.replaceAll('\\', '/');
    if (FORBIDDEN_ARTIFACT.test(normalized)) { findings.push({ path: normalized, line: 1, kind: 'FORMAL_OR_CREDENTIAL_ARTIFACT' }); continue; }
    const absolute = path.resolve(root, filename);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile() || !TEXT_SOURCE.test(filename)) continue;
    findings.push(...inspectSourceText(normalized, fs.readFileSync(absolute, 'utf8')));
  }
  return { success: findings.length === 0, scannedFiles: filenames.length, findings };
}
module.exports = { inspectSourceText, inspectCurrentSource };
if (require.main === module) {
  try {
    const result = inspectCurrentSource(process.cwd());
    process.stdout.write(JSON.stringify({ ...createRuntimeLogRecord(result.success ? 'info' : 'error', 'security.source_inspected'), ...result }) + '\n');
    process.exitCode = result.success ? 0 : 1;
  } catch {
    process.stderr.write(JSON.stringify(createRuntimeLogRecord('error', 'security.source_inspection_failed', { code: 'SOURCE_INSPECTION_UNAVAILABLE' })) + '\n');
    process.exitCode = 1;
  }
}

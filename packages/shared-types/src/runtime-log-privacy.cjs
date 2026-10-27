const { sha256 } = require('@noble/hashes/sha256');
const { bytesToHex, utf8ToBytes } = require('@noble/hashes/utils');

function stableRuntimeLogAlias(category, value) {
  const text = String(value);
  if (new RegExp('^\\[' + category + ':[a-f0-9]{20}\\]$').test(text)) return text;
  const hash = bytesToHex(sha256(utf8ToBytes('runtime-log/' + category + '/' + text)));
  return '[' + category + ':' + hash.slice(0, 20) + ']';
}

function runtimeLogIdentityCategory(key) {
  const normalized = key.replace(/[-_]/g, '').toLowerCase();
  const match = normalized.match(/(browserprofile|profile|store|job|importrun|import|batch|request|run|mission|grant|decision|experiment|adentity|recommendation)(?:id|ids|name|names)$/);
  if (match) return match[1] === 'browserprofile' ? 'profile' : match[1] === 'importrun' ? 'import' : match[1];
  return /^(store|profile|job|import|id|nonce)$/.test(normalized) ? normalized : null;
}

function redactRuntimeLogText(input) {
  return input
    .replace(/(password|passwd|secret|token|authorization|cookie|api[-_]?key|private[-_]?key)(["']?\s*[:=]\s*)[^\r\n]*/gi, '$1$2[REDACTED]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
    .replace(/\b[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/g, '[REDACTED]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/\b((?:browser[-_]?profile|profile|store|job|import[-_]?run|import|batch|request|mission|grant|decision|experiment)[-_]?(?:id|name))(["']?\s*[:=]\s*["']?)(?!\[)([^\s,;"'\]}]+)/gi,
      (_value, key, separator, identifier) => key + separator + stableRuntimeLogAlias(runtimeLogIdentityCategory(key), identifier))
    .replace(/\b[A-Za-z]:[\\/][^\r\n<>|"')]+/g, value => stableRuntimeLogAlias('path', value.trim()))
    .replace(/\\\\[^\r\n<>|"')]+/g, value => stableRuntimeLogAlias('path', value.trim()))
    .replace(/(^|[\s('"=])((?:\/[^\s/<>|"')]+)+)/g, (_value, prefix, file) => prefix + stableRuntimeLogAlias('path', file))
    .replace(/\b(store|profile|job|batch|mission|grant|decision|experiment)(\s+)([A-Za-z0-9][A-Za-z0-9:_-]*[-_:][A-Za-z0-9:_-]{1,179})/gi,
      (_value, category, space, identifier) => category + space + stableRuntimeLogAlias(category.toLowerCase(), identifier));
}

exports.stableRuntimeLogAlias = stableRuntimeLogAlias;
exports.runtimeLogIdentityCategory = runtimeLogIdentityCategory;
exports.redactRuntimeLogText = redactRuntimeLogText;

const fs = require('node:fs');
const path = require('node:path');
const { insist, directPath } = require('./v16-performance-artifacts');
const MAXIMUM_ID = (1n << 64n) - 1n;

function identityToken(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(value)) return null;
  return BigInt(value) <= MAXIMUM_ID ? value : null;
}
function validIdentity(value) { return identityToken(value?.dev) !== null && identityToken(value?.ino) !== null; }
function normalizedIdentity(value) {
  insist(validIdentity(value), 'EVIDENCE_WINDOW_IDENTITY_NOT_EXACT');
  return { ...value, dev: identityToken(value.dev), ino: identityToken(value.ino) };
}
function sameIdentity(first, second) {
  return validIdentity(first) && validIdentity(second)
    && identityToken(first.dev) === identityToken(second.dev) && identityToken(first.ino) === identityToken(second.ino);
}
function nativeIdentity(stat) {
  for (const value of [stat.dev, stat.ino]) insist(typeof value === 'bigint' && value >= 0n && value <= MAXIMUM_ID,
    'EVIDENCE_WINDOW_NATIVE_IDENTITY_REQUIRED');
  return { dev: stat.dev.toString(), ino: stat.ino.toString() };
}
function nativePath(file, directory = false) {
  const admitted = directPath(file, directory), stat = fs.lstatSync(admitted.path, { bigint: true });
  insist(!stat.isSymbolicLink() && (directory ? stat.isDirectory() : stat.isFile() && stat.nlink === 1n)
    && path.resolve(fs.realpathSync.native(file)).toLowerCase() === path.resolve(admitted.path).toLowerCase(), 'NFR_PATH_MUST_BE_DIRECT');
  nativeIdentity(stat); return { path: admitted.path, stat };
}
function nativeDescriptor(descriptor) { const stat = fs.fstatSync(descriptor, { bigint: true }); nativeIdentity(stat); return stat; }
function sameNativeFile(first, second) {
  return [first, second].every(value => ['dev', 'ino', 'size', 'nlink', 'mtimeNs'].every(key => typeof value[key] === 'bigint'))
    && first.dev === second.dev && first.ino === second.ino && first.size === second.size
    && first.nlink === second.nlink && first.mtimeNs === second.mtimeNs;
}
function validTimestampNs(value) {
  return typeof value === 'string' && value.length <= 30 && /^-?(0|[1-9][0-9]*)$/.test(value) && BigInt(value).toString() === value;
}
function fileMetadata(stat) {
  const sizeBytes = Number(stat.size);
  insist(Number.isSafeInteger(sizeBytes) && sizeBytes >= 0 && typeof stat.mtimeNs === 'bigint', 'EVIDENCE_WINDOW_FILE_METADATA_INVALID');
  // 身份及竞态检查保持原生整数精度；毫秒字段仅保留旧原件的可读语义。
  return { sizeBytes, ...nativeIdentity(stat), mtimeMs: Number(stat.mtimeNs) / 1000000, mtimeNs: stat.mtimeNs.toString() };
}
module.exports = { MAXIMUM_ID, identityToken, validIdentity, normalizedIdentity, sameIdentity, nativeIdentity,
  nativePath, nativeDescriptor, sameNativeFile, validTimestampNs, fileMetadata };

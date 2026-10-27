const path = require('node:path');

const EVIDENCE_USER_DATA_DIR_ENV = 'AMAZON_AI_OPS_USER_DATA_DIR';
const DEFAULT_EVIDENCE_USER_DATA_ROOT = 'D:\\Temp';
const SCOPED_DIRECTORY = /^amazon-ai-ops(?:-|$)/i;

function normalizeWindowsPath(filePath) {
  return path.win32.normalize(filePath).replace(/[\\/]+$/, '').toLowerCase();
}

function resolveEvidenceUserDataRoot(driveRoot) {
  if (!/^[a-z]:\\$/i.test(driveRoot)) {
    throw new Error('Evidence root requires an absolute local Windows drive root.');
  }
  return path.win32.join(driveRoot, 'Temp');
}

function normalizeEvidenceUserDataPath(requestedPath) {
  if (typeof requestedPath !== 'string' || !requestedPath
    || requestedPath !== requestedPath.trim() || requestedPath.includes('\0')) {
    throw new Error(`${EVIDENCE_USER_DATA_DIR_ENV} must be a non-empty path without surrounding whitespace or NUL bytes.`);
  }
  const normalized = path.win32.normalize(requestedPath);
  const driveRoot = path.win32.parse(normalized).root;
  if (!path.win32.isAbsolute(normalized) || !/^[a-z]:\\$/i.test(driveRoot)) {
    throw new Error(`${EVIDENCE_USER_DATA_DIR_ENV} must be an absolute local Windows path.`);
  }
  if (normalized.slice(2).includes(':')) {
    throw new Error(`${EVIDENCE_USER_DATA_DIR_ENV} may not contain an alternate data stream.`);
  }
  // 证据目录允许使用现有盘符，但必须留在专用 Temp 子树中。
  const allowedRoot = resolveEvidenceUserDataRoot(driveRoot);
  const relative = path.win32.relative(allowedRoot, normalized);
  if (!relative || relative === '..' || relative.startsWith('..\\') || path.win32.isAbsolute(relative)) {
    throw new Error(`${EVIDENCE_USER_DATA_DIR_ENV} must be a child of ${allowedRoot}.`);
  }
  if (!SCOPED_DIRECTORY.test(relative.split('\\')[0])) {
    throw new Error(`${EVIDENCE_USER_DATA_DIR_ENV} must use an amazon-ai-ops-prefixed directory under ${allowedRoot}.`);
  }
  return normalized;
}

module.exports = {
  DEFAULT_EVIDENCE_USER_DATA_ROOT,
  normalizeEvidenceUserDataPath,
  normalizeWindowsPath,
  resolveEvidenceUserDataRoot,
};

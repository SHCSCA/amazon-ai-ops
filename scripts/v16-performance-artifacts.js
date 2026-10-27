const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createRuntimeLogRecord } = require('../packages/shared-types/src/runtime-log-format.cjs');

const digest = value => createHash('sha256').update(value).digest('hex');
function insist(condition, code) { if (!condition) throw new Error(code); }
function within(root, file) {
  const relative = path.relative(root, file);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
}
function directPath(file, directory = false) {
  insist(typeof file === 'string' && path.isAbsolute(file) && !file.includes('\0'), 'NFR_ABSOLUTE_PATH_REQUIRED');
  const stat = fs.lstatSync(file), real = fs.realpathSync.native(file);
  insist(!stat.isSymbolicLink() && (directory ? stat.isDirectory() : stat.isFile() && stat.nlink === 1)
    && path.resolve(real).toLowerCase() === path.resolve(file).toLowerCase(), 'NFR_PATH_MUST_BE_DIRECT');
  return { path: real, stat };
}
function readBound(record, root = process.cwd()) {
  insist(record && /^[a-f0-9]{64}$/i.test(record.sha256 ?? ''), 'NFR_ARTIFACT_DIGEST_REQUIRED');
  const target = directPath(path.resolve(root, record.path));
  const bytes = fs.readFileSync(target.path), after = fs.statSync(target.path);
  insist(bytes.length === target.stat.size && target.stat.mtimeMs === after.mtimeMs
    && digest(bytes).toLowerCase() === record.sha256.toLowerCase(), 'NFR_ARTIFACT_CHANGED');
  return { ...target, bytes, json: () => JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')) };
}
function fileRecord(file) {
  const target = directPath(path.resolve(file)), bytes = fs.readFileSync(target.path);
  const after = fs.statSync(target.path);
  insist(after.size === target.stat.size && after.mtimeMs === target.stat.mtimeMs, 'NFR_ARTIFACT_CHANGED');
  return { path: target.path, sha256: digest(bytes), sizeBytes: bytes.length };
}
function createArtifactWriter(directory) {
  insist(path.isAbsolute(directory) && !fs.existsSync(directory), 'NFR_NEW_OUTPUT_DIRECTORY_REQUIRED');
  fs.mkdirSync(directory, { recursive: true });
  const root = directPath(directory, true).path;
  const written = [];
  function write(name, value) {
    const file = path.resolve(root, name);
    insist(within(root, file) && file !== root, 'NFR_OUTPUT_ESCAPES_RUN');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
    fs.writeFileSync(file, bytes, { flag: 'wx' });
    const record = fileRecord(file); written.push(record); return record;
  }
  return {
    root, write,
    track(record) { readBound(record); written.push(record); return record; },
    artifacts: () => [...written, ...(fs.existsSync(path.join(root, 'collector.jsonl')) ? [fileRecord(path.join(root, 'collector.jsonl'))] : [])],
    json: (name, value) => write(name, JSON.stringify(value, null, 2) + '\n'),
    copy: (name, record) => write(name, readBound(record).bytes),
    log(event, error, context = {}) {
      const record = createRuntimeLogRecord(error ? 'error' : 'info', event, error ? { ...context, error } : context);
      fs.appendFileSync(path.join(root, 'collector.jsonl'), JSON.stringify(record) + '\n');
    },
  };
}
function treeBytes(directory) {
  let root;
  try { root = directPath(path.resolve(directory), true).path; }
  catch (error) { if (error.code === 'ENOENT') return { bytes: 0, files: 0, exists: false }; throw error; }
  let total = 0, files = 0;
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name), stat = fs.lstatSync(file);
      insist(!stat.isSymbolicLink() && within(root, fs.realpathSync.native(file)), 'NFR_TREE_LINK_REJECTED');
      if (stat.isDirectory()) pending.push(file);
      else { insist(stat.isFile() && stat.nlink === 1, 'NFR_TREE_SPECIAL_FILE_REJECTED'); total += stat.size; files++; }
      insist(files <= 100000 && pending.length <= 100000, 'NFR_TREE_LIMIT_EXCEEDED');
    }
  }
  return { bytes: total, files, exists: true };
}
function databaseBytes(file) {
  directPath(path.resolve(file));
  return ['', '-wal', '-shm'].reduce((total, suffix) => {
    const target = file + suffix;
    try { return total + directPath(path.resolve(target)).stat.size; }
    catch (error) { if (error.code === 'ENOENT') return total; throw error; }
  }, 0);
}
module.exports = { digest, insist, within, directPath, readBound, fileRecord, createArtifactWriter, treeBytes, databaseBytes };

const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

function hashRegularFile(filePath) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('PUBLICATION_INPUT_NOT_REGULAR:' + filePath);
  const descriptor = fs.openSync(filePath, 'r');
  try {
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.ino !== stat.ino || opened.dev !== stat.dev) throw new Error('PUBLICATION_INPUT_CHANGED:' + filePath);
    const hash = createHash('sha256');
    const chunk = Buffer.alloc(64 * 1024);
    let length;
    while ((length = fs.readSync(descriptor, chunk, 0, chunk.length, null)) > 0) hash.update(chunk.subarray(0, length));
    const after = fs.fstatSync(descriptor);
    if (opened.size !== after.size || opened.mtimeMs !== after.mtimeMs) throw new Error('PUBLICATION_INPUT_CHANGED:' + filePath);
    return hash.digest('hex');
  } finally { fs.closeSync(descriptor); }
}

function snapshotInput(root, inputPath) {
  if (typeof inputPath !== 'string' || !inputPath.trim()) throw new Error('PUBLICATION_INPUT_PATH_MISSING');
  const absolute = path.resolve(root, inputPath);
  try { return { path: absolute, sha256: hashRegularFile(absolute) }; }
  catch (error) {
    if (error.code === 'ENOENT') return { path: absolute, missing: true, sha256: null };
    throw error;
  }
}

function validateFrozenInputs(inputs) {
  const issues = [];
  if (!Array.isArray(inputs) || !inputs.length || new Set(inputs.map(input => input.path)).size !== inputs.length) return ['PUBLICATION_INPUT_SET_INVALID'];
  for (const input of inputs) {
    try {
      const current = snapshotInput('.', input.path);
      if (JSON.stringify(current) !== JSON.stringify(input)) issues.push('PUBLICATION_INPUT_CHANGED:' + input.path);
    } catch (error) { issues.push('PUBLICATION_INPUT_UNREADABLE:' + input.path + ':' + error.message); }
  }
  return issues;
}

function capturePublicationInputs(root, manifestPath, requirementsPath, manifest, core) {
  const paths = new Set([manifestPath, requirementsPath]);
  for (const test of manifest.requiredTests ?? []) {
    if (!test.evidencePath) continue;
    paths.add(test.evidencePath);
    try {
      const evidence = JSON.parse(fs.readFileSync(path.resolve(root, test.evidencePath), 'utf8'));
      if (evidence.artifact?.path) paths.add(evidence.artifact.path);
    } catch (error) {
      // 缺失或无效原件由核心门拒绝；NON_READY 闭包仍冻结该原件当前的实际状态。
      if (core.eligible) throw error;
    }
  }
  for (const gate of core.gates) {
    for (const test of gate.tests) {
      for (const input of test.inputArtifacts ?? []) paths.add(input.path);
    }
  }
  return [...new Set([...paths].map(file => path.resolve(root, file)))].sort().map(file => snapshotInput(root, file));
}

function writeNewJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
}

function replacePublicationFile(file, content) {
  const absolute = path.resolve(file);
  const parent = path.dirname(absolute);
  fs.mkdirSync(parent, { recursive: true });
  try {
    const existing = fs.lstatSync(absolute);
    if (!existing.isFile() || existing.isSymbolicLink()) throw new Error('PUBLICATION_OUTPUT_NOT_REGULAR:' + absolute);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = path.join(parent, `.${path.basename(absolute)}.pending-${randomUUID()}`);
  fs.writeFileSync(temporary, content, { encoding: 'utf8', flag: 'wx' });
  try { fs.renameSync(temporary, absolute); }
  catch (error) {
    try { fs.unlinkSync(temporary); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], 'PUBLICATION_ATOMIC_REPLACE_FAILED', { cause: error }); }
    throw error;
  }
}

function replacePublicationJson(file, value) { replacePublicationFile(file, JSON.stringify(value, null, 2) + '\n'); }

module.exports = { hashRegularFile, snapshotInput, validateFrozenInputs, capturePublicationInputs, writeNewJson, replacePublicationFile, replacePublicationJson };

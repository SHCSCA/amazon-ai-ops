const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { fileRecord, readBound, within } = require('./v16-performance-artifacts');
const { stableServicingFileArtifact } = require('./s7-launch-operator-security');
const { createRuntimeLogRecord } = require('../packages/shared-types/src/runtime-log-format.cjs');
const canonical = value => path.resolve(value).toLowerCase();
const fields = ['ino', 'size', 'mtimeMs', 'ctimeMs', 'birthtimeMs', 'mode', 'nlink'];
const stat = file => { const value = fs.lstatSync(file); return Object.fromEntries(fields.map(key => [key, value[key]])); };
function log(config, event, error, context = {}) {
  try { config.writer.log(event, error, context); }
  catch (loggingError) {
    try { process.stderr.write(JSON.stringify(createRuntimeLogRecord('error', 'v16.ui_caption_log_failed', { event, error: loggingError, originalError: error, ...context })) + '\n'); }
    catch { /* 输出关闭时仍保留首错与自有资源回收路径。 */ }
  }
}
function captureShellIdentity(trustedRuntime) {
  assert.ok(trustedRuntime && trustedRuntime.executable && trustedRuntime.environment, 'UI_CAPTION_TRUSTED_SHELL_REQUIRED');
  const expected = trustedRuntime.executable;
  const actual = stableServicingFileArtifact(expected.realPath, 'UI caption trusted system shell');
  for (const key of ['realPath', 'sha256', 'sizeBytes', 'mtimeMs', 'identity']) assert.deepEqual(actual[key], expected[key], 'UI_CAPTION_SYSTEM_SHELL_CHANGED');
  return { artifact: actual, stat: stat(actual.realPath) };
}
function validateShellIdentity(trustedRuntime, expected) {
  const current = captureShellIdentity(trustedRuntime); assert.deepEqual(current, expected, 'UI_CAPTION_SYSTEM_SHELL_STAT_CHANGED'); return current;
}
function createCaptionArtifacts(writer) {
  return { fs, path, assert, canonical, record: fileRecord, log,
    read: file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')),
    validate(reference) { const value = readBound(reference); assert.equal(value.bytes.length, reference.sizeBytes); return { ...reference, path: value.path }; },
    write(file, value) {
      assert.ok(writer && within(writer.root, file) && canonical(file) !== canonical(writer.root), 'UI_CAPTION_OUTPUT_OUTSIDE_OWNER');
      return writer.write(path.relative(writer.root, file), JSON.stringify(value, null, 2) + '\n');
    } };
}
module.exports = { createCaptionArtifacts, captureShellIdentity, validateShellIdentity };

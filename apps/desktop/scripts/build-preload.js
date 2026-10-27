const path = require('node:path');
const fs = require('node:fs');
const esbuild = require('esbuild');
const { createRuntimeLogRecord } = require('../../../packages/shared-types/src/runtime-log-format.cjs');

const desktopDir = path.resolve(__dirname, '..');

function validatePreloadBundle(result, outfile, workingDir) {
  const expected = new Set([path.resolve(outfile), path.resolve(`${outfile}.map`)]);
  const files = result.outputFiles ?? [];
  if (files.length !== expected.size || new Set(files.map(file => path.resolve(file.path))).size !== expected.size
    || files.some(file => !expected.has(path.resolve(file.path)))) {
    throw new Error('PRELOAD_BUNDLE_OUTPUT_INVALID');
  }
  const outputs = Object.entries(result.metafile?.outputs ?? {});
  if (outputs.length !== expected.size || outputs.some(([file]) => !expected.has(path.resolve(workingDir, file)))) {
    throw new Error('PRELOAD_BUNDLE_METADATA_INVALID');
  }
  // Electron 沙盒只允许桥接模块；所有业务依赖必须在写出前完成内联。
  for (const [, output] of outputs) {
    for (const dependency of output.imports ?? []) {
      if (dependency.path !== 'electron' || dependency.external !== true) {
        throw new Error(`PRELOAD_BUNDLE_IMPORT_FORBIDDEN: ${dependency.path}`);
      }
    }
  }
}

function buildPreload(options = {}) {
  const workingDir = path.resolve(options.workingDir ?? desktopDir);
  const outfile = path.resolve(options.outfile ?? path.join(workingDir, 'dist/preload/index.cjs'));
  const result = (options.buildSync ?? esbuild.buildSync)({
    absWorkingDir: workingDir,
    entryPoints: [options.entryPoint ?? 'src/preload/index.ts'],
    bundle: true,
    platform: 'browser',
    target: 'es2022',
    outfile,
    external: ['electron'],
    format: 'cjs',
    sourcemap: true,
    metafile: true,
    write: false,
    logLevel: 'silent',
  });
  validatePreloadBundle(result, outfile, workingDir);
  fs.mkdirSync(path.dirname(outfile), { recursive: true });
  for (const file of result.outputFiles) fs.writeFileSync(file.path, file.contents);
  return result;
}

if (require.main === module) {
  try {
    process.stdout.write(JSON.stringify(createRuntimeLogRecord('info', 'build.preload_started')) + '\n');
    const result = buildPreload();
    process.stdout.write(JSON.stringify(createRuntimeLogRecord('info', 'build.preload_completed', {
      outputs: result.outputFiles.length,
    })) + '\n');
  } catch (error) {
    process.stderr.write(JSON.stringify(createRuntimeLogRecord('error', 'build.preload_failed', { error })) + '\n');
    process.exitCode = 1;
  }
}

module.exports = { buildPreload, validatePreloadBundle };

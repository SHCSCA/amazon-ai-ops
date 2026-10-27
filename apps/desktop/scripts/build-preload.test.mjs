import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';
import { buildPreload } from './build-preload.js';

const owned = [];
function temporary() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-preload-build-'));
  owned.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of owned.splice(0)) {
    const resolved = path.resolve(dir);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir())
      || !path.basename(resolved).startsWith('amazon-ai-ops-preload-build-')
      || fs.realpathSync.native(resolved).toLowerCase() !== resolved.toLowerCase()) {
      throw new Error('拒绝清理非本测试直接创建的临时目录。');
    }
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});

function resultFor(outfile, imports = []) {
  return {
    outputFiles: [outfile, `${outfile}.map`].map(file => ({ path: file, contents: Buffer.from('new bundle') })),
    metafile: { outputs: { [outfile]: { imports }, [`${outfile}.map`]: { imports: [] } } },
  };
}

describe('sandbox preload build', () => {
  it('executes the actual production bundle with electron as its only required module', () => {
    const outfile = path.join(temporary(), 'index.cjs');
    const result = buildPreload({ outfile });
    const imports = Object.values(result.metafile.outputs).flatMap(output => output.imports);
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.every(dependency => dependency.path === 'electron' && dependency.external)).toBe(true);
    const required = [], exposed = [], calls = [];
    const ipc = {
      on: () => undefined, removeListener: () => undefined,
      invoke: (...args) => { calls.push(args); throw new Error('BUSINESS_IPC_MUST_NOT_RUN_DURING_PRELOAD'); },
    };
    vm.runInNewContext(fs.readFileSync(outfile, 'utf8'), {
      require: name => {
        required.push(name);
        if (name !== 'electron') throw new Error(`SANDBOX_REQUIRE_FORBIDDEN: ${name}`);
        return { ipcRenderer: ipc, contextBridge: { exposeInMainWorld: (...args) => exposed.push(args) } };
      },
      console, TextEncoder, TextDecoder, Uint8Array, Uint32Array, DataView,
    }, { filename: outfile });
    expect([...new Set(required)]).toEqual(['electron']);
    expect(exposed).toHaveLength(1);
    expect(exposed[0][0]).toBe('electronAPI');
    expect(Object.keys(exposed[0][1]).length).toBeGreaterThan(100);
    expect(typeof exposed[0][1].missionControl.query).toBe('function');
    expect(typeof exposed[0][1].missionControl.command).toBe('function');
    expect(calls).toEqual([]);
  });

  it('selects browser conditions while preserving CJS, isolation and a single output bundle', () => {
    const outfile = path.join(temporary(), 'index.cjs');
    let options;
    buildPreload({ outfile, buildSync: input => { options = input; return resultFor(outfile, [{ path: 'electron', external: true }]); } });
    expect(options).toMatchObject({ platform: 'browser', bundle: true, format: 'cjs', target: 'es2022',
      external: ['electron'], sourcemap: true, metafile: true, write: false });
    expect(fs.readFileSync(outfile, 'utf8')).toBe('new bundle');
  });

  it.each(['node:crypto', 'crypto', './runtime-log.cjs', '@noble/hashes/sha256', 'electron/main'])
  ('rejects runtime import %s before either existing output is changed', dependency => {
    const outfile = path.join(temporary(), 'index.cjs');
    fs.writeFileSync(outfile, 'previous bundle');
    fs.writeFileSync(`${outfile}.map`, 'previous map');
    expect(() => buildPreload({ outfile, buildSync: () => resultFor(outfile, [{ path: dependency, external: true }]) }))
      .toThrow('PRELOAD_BUNDLE_IMPORT_FORBIDDEN');
    expect(fs.readFileSync(outfile, 'utf8')).toBe('previous bundle');
    expect(fs.readFileSync(`${outfile}.map`, 'utf8')).toBe('previous map');
  });

  it('rejects an unresolved local electron chunk', () => {
    const outfile = path.join(temporary(), 'index.cjs');
    expect(() => buildPreload({ outfile, buildSync: () => resultFor(outfile, [{ path: 'electron', external: false }]) }))
      .toThrow('PRELOAD_BUNDLE_IMPORT_FORBIDDEN');
    expect(fs.existsSync(outfile)).toBe(false);
  });

  it.each(['unexpected-output', 'duplicate-output', 'missing-metadata', 'extra-metadata'])
  ('rejects %s before publishing any output', fault => {
    const outfile = path.join(temporary(), 'index.cjs');
    const result = resultFor(outfile);
    if (fault === 'unexpected-output') result.outputFiles[1].path = `${outfile}.chunk.cjs`;
    if (fault === 'duplicate-output') result.outputFiles[1].path = outfile;
    if (fault === 'missing-metadata') delete result.metafile.outputs[outfile];
    if (fault === 'extra-metadata') result.metafile.outputs[`${outfile}.chunk.cjs`] = { imports: [] };
    expect(() => buildPreload({ outfile, buildSync: () => result })).toThrow(/PRELOAD_BUNDLE_(OUTPUT|METADATA)_INVALID/);
    expect(fs.existsSync(outfile)).toBe(false);
  });

  it('fails the actual browser build on a Node builtin and preserves existing files', () => {
    const directory = temporary(), outfile = path.join(directory, 'index.cjs');
    fs.writeFileSync(path.join(directory, 'unsafe.cjs'), "module.exports = require('node:crypto');\n");
    fs.writeFileSync(outfile, 'previous bundle');
    fs.writeFileSync(`${outfile}.map`, 'previous map');
    expect(() => buildPreload({ workingDir: directory, entryPoint: './unsafe.cjs', outfile })).toThrow(/node:crypto/);
    expect(fs.readFileSync(outfile, 'utf8')).toBe('previous bundle');
    expect(fs.readFileSync(`${outfile}.map`, 'utf8')).toBe('previous map');
  });
});

import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  buildWindowsPackage,
  resolveWindowsBuildSteps,
  withFreshPackageOutputs,
} = require('./build-windows-package.js');
const {
  PROGRESS_TEMPLATE,
  assertProgressTemplateContract,
  withPortableTemplateOverride,
} = require('./run-electron-builder-windows.js');
const {
  EXPECTED_ELECTRON_MODULES_ABI,
  sha256File,
} = require('./prepare-native-runtime.js');

const tempDirectories = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('retained Windows package output history', () => {
  it('retains the entire previous release after a successful fresh build', () => {
    const fixture = nativeFixture();
    fs.writeFileSync(path.join(fixture.packageOutputs.releaseRoot, 'builder-debug.yml'), 'old-debug');
    fs.writeFileSync(path.join(fixture.packageOutputs.releaseRoot, 'older-version.exe'), 'older-exe');
    const oldTree = packageTreeSnapshot(fixture.packageOutputs.releaseRoot);
    withFreshPackageOutputs(fixture.packageOutputs, () => {
      fixture.writePackage();
      fs.writeFileSync(path.join(fixture.packageOutputs.releaseRoot, 'builder-debug.yml'), 'fresh-debug');
    });
    const retained = retainedHistory(fixture);
    expect(fs.readFileSync(path.join(retained, 'previous-release/win-unpacked/AmazonAIOpsAgent.exe'), 'utf8')).toBe('stale-package-exe');
    expect(fs.readFileSync(path.join(retained, 'previous-release/builder-debug.yml'), 'utf8')).toBe('old-debug');
    expect(fs.readFileSync(path.join(retained, 'previous-release/older-version.exe'), 'utf8')).toBe('older-exe');
    expect(packageTreeSnapshot(path.join(retained, 'previous-release'))).toEqual(oldTree);
    expect(fs.readFileSync(fixture.packageExe, 'utf8')).toBe('fresh-package-exe');
    expect(JSON.parse(fs.readFileSync(path.join(retained, 'receipt.json'), 'utf8')).status).toBe('succeeded');
  });

  it('retains every failed output and restores previous ancillary files without overwriting history', () => {
    const fixture = nativeFixture();
    fs.writeFileSync(path.join(fixture.packageOutputs.releaseRoot, 'builder-debug.yml'), 'old-debug');
    const oldTree = packageTreeSnapshot(fixture.packageOutputs.releaseRoot);
    const primary = new Error('controlled builder failure');
    expect(() => withFreshPackageOutputs(fixture.packageOutputs, () => {
      fixture.writePackage();
      fs.writeFileSync(path.join(fixture.packageOutputs.releaseRoot, 'builder-debug.yml'), 'failed-debug');
      fs.writeFileSync(path.join(fixture.packageOutputs.releaseRoot, 'new-unlisted.7z'), 'partial-unlisted');
      throw primary;
    })).toThrow(primary);
    const retained = retainedHistory(fixture);
    expect(fs.readFileSync(path.join(retained, 'failed-release/win-unpacked/AmazonAIOpsAgent.exe'), 'utf8')).toBe('fresh-package-exe');
    expect(fs.readFileSync(path.join(retained, 'failed-release/new-unlisted.7z'), 'utf8')).toBe('partial-unlisted');
    expect(fs.readFileSync(path.join(retained, 'failed-release/builder-debug.yml'), 'utf8')).toBe('failed-debug');
    expect(fs.readFileSync(fixture.packageExe, 'utf8')).toBe('stale-package-exe');
    expect(fs.readFileSync(path.join(fixture.packageOutputs.releaseRoot, 'builder-debug.yml'), 'utf8')).toBe('old-debug');
    expect(packageTreeSnapshot(fixture.packageOutputs.releaseRoot)).toEqual(oldTree);
    const receipt = JSON.parse(fs.readFileSync(path.join(retained, 'receipt.json'), 'utf8'));
    expect(receipt.status).toBe('failed-restored');
    expect(receipt.primaryError.message).toBe(primary.message);
  });

  it('returns the successful retention receipt through the unchanged native orchestration', () => {
    const fixture = nativeFixture();
    const result = buildWindowsPackage({ ...fixture.injections, withLock: callback => callback(),
      prepareNativeRuntime: fixture.preparePackage, runBuildSteps: () => { fixture.writePackage(); return []; } });
    expect(result.outputRetention.status).toBe('succeeded');
    expect(result.outputRetention.previousRelease).toBe(path.join(retainedHistory(fixture), 'previous-release'));
    expect(fs.existsSync(result.outputRetention.receiptPath)).toBe(true);
    expect(result.sourceBindings.unchangedExact).toBe(true);
  });

  it('retains a complete new package when its native package probe fails', () => {
    const fixture = nativeFixture();
    const primary = new Error('controlled native probe failure');
    expect(() => buildWindowsPackage({ ...fixture.injections, withLock: callback => callback(),
      prepareNativeRuntime: () => { throw primary; }, runBuildSteps: () => { fixture.writePackage(); return []; } })).toThrow(primary);
    const archive = retainedHistory(fixture);
    for (const name of ['installerPath', 'portablePath', 'folderZipPath', 'blockmapPath']) {
      expect(fs.readFileSync(path.join(archive, 'failed-release', path.basename(fixture.packageOutputs[name])), 'utf8')).toMatch(/^fresh-/);
    }
    expect(fs.readFileSync(fixture.packageExe, 'utf8')).toBe('stale-package-exe');
  });

  it.each(['native-cleanup', 'source-after'])('retains and restores the whole release when %s fails after the package probe', point => {
    const fixture = nativeFixture(), primary = new Error('controlled isolated-native cleanup failure');
    let probed = false;
    const injections = {
      ...fixture.injections, withLock: callback => callback(),
      prepareNativeRuntime: () => { probed = true; return fixture.preparePackage(); },
      runBuildSteps: () => { fixture.writePackage(); return []; },
      ...(point === 'native-cleanup' ? { withPreparedElectron: (_paths, _metadata, callback) => {
        callback(fixture.electronPreparation); throw primary;
      } } : { sha256File: candidate => probed && candidate === fixture.sourcePaths.sqliteBindingPath ? 'F'.repeat(64) : sha256File(candidate) }),
    };
    const failure = capturePackageFailure(() => buildWindowsPackage(injections));
    if (point === 'native-cleanup') expect(failure).toBe(primary);
    else expect(failure.message).toMatch(/read-only source native/);
    expect(probed).toBe(true);
    const archive = retainedHistory(fixture);
    expect(fs.readFileSync(path.join(archive, 'failed-release/win-unpacked/AmazonAIOpsAgent.exe'), 'utf8')).toBe('fresh-package-exe');
    expect(fs.readFileSync(fixture.packageExe, 'utf8')).toBe('stale-package-exe');
    expect(JSON.parse(fs.readFileSync(path.join(archive, 'receipt.json'), 'utf8')).primaryError.message).toBe(failure.message);
  });

  it('retains a failed first build without creating a pretend previous release', () => {
    const fixture = nativeFixture();
    const seed = path.join(path.dirname(fixture.packageOutputs.releaseRoot), 'test-seed');
    fs.renameSync(fixture.packageOutputs.releaseRoot, seed);
    expect(() => withFreshPackageOutputs(fixture.packageOutputs, () => {
      fixture.writePackage(); throw new Error('first build failed');
    })).toThrow(/first build failed/);
    const archive = retainedHistory(fixture);
    expect(fs.existsSync(fixture.packageOutputs.releaseRoot)).toBe(false);
    expect(fs.readFileSync(path.join(archive, 'failed-release/win-unpacked/AmazonAIOpsAgent.exe'), 'utf8')).toBe('fresh-package-exe');
    expect(fs.existsSync(path.join(archive, 'previous-release'))).toBe(false);
    expect(fs.readFileSync(path.join(seed, 'win-unpacked/AmazonAIOpsAgent.exe'), 'utf8')).toBe('stale-package-exe');
  });

  it.each(['winUnpackedRoot', 'installerPath'])('rejects an escaping %s before any rename', field => {
    const fixture = nativeFixture(), before = packageTreeSnapshot(fixture.packageOutputs.releaseRoot);
    const rename = vi.spyOn(fs, 'renameSync'), callback = vi.fn();
    expect(() => withFreshPackageOutputs({ ...fixture.packageOutputs,
      [field]: path.join(path.dirname(fixture.packageOutputs.releaseRoot), 'outside') }, callback)).toThrow(/canonical|escapes/i);
    expect(rename).not.toHaveBeenCalled(); expect(callback).not.toHaveBeenCalled();
    expect(packageTreeSnapshot(fixture.packageOutputs.releaseRoot)).toEqual(before);
  });

  it('rejects a linked old descendant without moving its output tree', () => {
    const fixture = nativeFixture(), parent = path.dirname(fixture.packageOutputs.releaseRoot);
    const external = path.join(parent, 'external'); fs.mkdirSync(external);
    fs.writeFileSync(path.join(external, 'retained.txt'), 'outside');
    fs.symlinkSync(external, path.join(fixture.packageOutputs.releaseRoot, 'link'), 'junction');
    const rename = vi.spyOn(fs, 'renameSync'), callback = vi.fn();
    expect(() => withFreshPackageOutputs(fixture.packageOutputs, callback)).toThrow(/linked|invalid/i);
    expect(rename).not.toHaveBeenCalled(); expect(callback).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(external, 'retained.txt'), 'utf8')).toBe('outside');
    expect(fs.readFileSync(fixture.packageExe, 'utf8')).toBe('stale-package-exe');
  });

  it('rejects a linked output ancestor before creating any archive or moving a package', () => {
    const fixture = nativeFixture(), parent = path.dirname(fixture.packageOutputs.releaseRoot);
    const alias = path.join(parent, 'alias'); fs.symlinkSync(parent, alias, 'junction');
    const aliased = Object.fromEntries(Object.entries(fixture.packageOutputs)
      .map(([key, value]) => [key, path.join(alias, path.relative(parent, value))]));
    const rename = vi.spyOn(fs, 'renameSync'), callback = vi.fn();
    expect(() => withFreshPackageOutputs(aliased, callback)).toThrow(/linked|invalid/);
    expect(rename).not.toHaveBeenCalled(); expect(callback).not.toHaveBeenCalled();
    expect(fs.readFileSync(fixture.packageExe, 'utf8')).toBe('stale-package-exe');
  });

  it('does not move the old release if the initial immutable receipt cannot be written', () => {
    const fixture = nativeFixture(), primary = new Error('controlled initial receipt failure');
    const original = fs.writeFileSync.bind(fs), callback = vi.fn(), rename = vi.spyOn(fs, 'renameSync');
    vi.spyOn(fs, 'writeFileSync').mockImplementation((candidate, ...args) => {
      if (path.basename(candidate) === 'started.json') throw primary;
      return original(candidate, ...args);
    });
    expect(() => withFreshPackageOutputs(fixture.packageOutputs, callback)).toThrow(primary);
    expect(rename).not.toHaveBeenCalled(); expect(callback).not.toHaveBeenCalled();
    expect(fs.readFileSync(fixture.packageExe, 'utf8')).toBe('stale-package-exe');
    expect(JSON.parse(fs.readFileSync(path.join(retainedHistory(fixture), 'receipt.json'), 'utf8')).primaryError.message).toBe(primary.message);
  });

  it('retains both trees in place when a new descendant link prevents safe rollback', () => {
    const fixture = nativeFixture(), parent = path.dirname(fixture.packageOutputs.releaseRoot);
    const external = path.join(parent, 'external'); fs.mkdirSync(external);
    fs.writeFileSync(path.join(external, 'retained.txt'), 'outside');
    const primary = new Error('builder failed after link');
    const failure = capturePackageFailure(() => withFreshPackageOutputs(fixture.packageOutputs, () => {
      fixture.writePackage();
      fs.symlinkSync(external, path.join(fixture.packageOutputs.releaseRoot, 'link'), 'junction'); throw primary;
    }));
    expect(failure).toBeInstanceOf(AggregateError); expect(failure.errors[0]).toBe(primary);
    expect(failure.errors[1].message).toMatch(/linked|invalid/);
    expect(fs.readFileSync(path.join(retainedHistory(fixture), 'previous-release/win-unpacked/AmazonAIOpsAgent.exe'), 'utf8')).toBe('stale-package-exe');
    expect(fs.readFileSync(fixture.packageExe, 'utf8')).toBe('fresh-package-exe');
    expect(fs.readFileSync(path.join(external, 'retained.txt'), 'utf8')).toBe('outside');
  });

  it('does not overwrite a colliding failed-release destination', () => {
    const fixture = nativeFixture(), primary = new Error('builder failed before archive collision');
    const failure = capturePackageFailure(() => withFreshPackageOutputs(fixture.packageOutputs, () => {
      fixture.writePackage(); const collision = path.join(retainedHistory(fixture), 'failed-release');
      fs.mkdirSync(collision); fs.writeFileSync(path.join(collision, 'sentinel'), 'never-overwrite'); throw primary;
    }));
    expect(failure).toBeInstanceOf(AggregateError); expect(failure.errors[0]).toBe(primary);
    expect(failure.errors[1].message).toMatch(/overwrite/);
    expect(fs.readFileSync(path.join(retainedHistory(fixture), 'failed-release/sentinel'), 'utf8')).toBe('never-overwrite');
    expect(fs.readFileSync(fixture.packageExe, 'utf8')).toBe('fresh-package-exe');
    expect(JSON.parse(fs.readFileSync(path.join(retainedHistory(fixture), 'receipt.json'), 'utf8')).status).toBe('failed-retained-unrestored');
  });

  it('does not overwrite a canonical directory recreated before restoration', () => {
    const fixture = nativeFixture(), primary = new Error('builder failed before canonical collision');
    const original = fs.renameSync.bind(fs);
    vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
      const result = original(source, destination);
      if (path.basename(destination) === 'failed-release') {
        fs.mkdirSync(fixture.packageOutputs.releaseRoot);
        fs.writeFileSync(path.join(fixture.packageOutputs.releaseRoot, 'sentinel'), 'new-owner');
      }
      return result;
    });
    const failure = capturePackageFailure(() => withFreshPackageOutputs(fixture.packageOutputs, () => { fixture.writePackage(); throw primary; }));
    expect(failure).toBeInstanceOf(AggregateError); expect(failure.errors[0]).toBe(primary);
    expect(failure.errors[1].message).toMatch(/overwrite/);
    const archive = retainedHistory(fixture);
    expect(fs.readFileSync(path.join(archive, 'previous-release/win-unpacked/AmazonAIOpsAgent.exe'), 'utf8')).toBe('stale-package-exe');
    expect(fs.readFileSync(path.join(archive, 'failed-release/win-unpacked/AmazonAIOpsAgent.exe'), 'utf8')).toBe('fresh-package-exe');
    expect(fs.readFileSync(path.join(fixture.packageOutputs.releaseRoot, 'sentinel'), 'utf8')).toBe('new-owner');
  });

  it.each(['ino', 'dev', 'birthtimeNs'])('rejects an exact BigInt %s change hidden by Number rounding', field => {
    const fixture = nativeFixture(), primary = new Error('builder failed before owner check');
    const original = fs.lstatSync.bind(fs); let changed = false;
    const initial = 2n ** 54n, replacement = initial + 1n;
    expect(Number(initial)).toBe(Number(replacement));
    vi.spyOn(fs, 'lstatSync').mockImplementation((candidate, options) => {
      const stat = original(candidate, options);
      if (options?.bigint === true && (path.resolve(candidate) === fixture.packageOutputs.releaseRoot
        || ['previous-release', 'failed-release'].includes(path.basename(candidate)))) {
        return Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, { [field]: changed ? replacement : initial });
      }
      return stat;
    });
    const failure = capturePackageFailure(() => withFreshPackageOutputs(fixture.packageOutputs, () => {
      fixture.writePackage(); changed = true; throw primary;
    }));
    expect(failure).toBeInstanceOf(AggregateError); expect(failure.errors[0]).toBe(primary);
    expect(failure.errors[1].message).toMatch(/identity changed/);
    expect(fs.readFileSync(fixture.packageExe, 'utf8')).toBe('fresh-package-exe');
    expect(fs.readFileSync(path.join(retainedHistory(fixture), 'previous-release/win-unpacked/AmazonAIOpsAgent.exe'), 'utf8')).toBe('stale-package-exe');
  });

  it('preserves the first error when receipt creation and logging also fail', () => {
    const fixture = nativeFixture(), primary = new Error('controlled first failure');
    const receiptError = new Error('controlled receipt failure'), loggingError = new Error('controlled logging failure');
    const original = fs.writeFileSync.bind(fs);
    vi.spyOn(fs, 'writeFileSync').mockImplementation((candidate, ...args) => {
      if (path.basename(candidate) === 'receipt.json') throw receiptError;
      return original(candidate, ...args);
    });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => { throw loggingError; });
    const failure = capturePackageFailure(() => withFreshPackageOutputs(fixture.packageOutputs, () => { fixture.writePackage(); throw primary; }));
    expect(failure).toBeInstanceOf(AggregateError); expect(failure.errors).toEqual([primary, receiptError, loggingError]);
    const archive = retainedHistory(fixture);
    expect(fs.readFileSync(path.join(archive, 'failed-release/win-unpacked/AmazonAIOpsAgent.exe'), 'utf8')).toBe('fresh-package-exe');
    expect(fs.readFileSync(fixture.packageExe, 'utf8')).toBe('stale-package-exe');
    expect(fs.existsSync(path.join(archive, 'started.json'))).toBe(true);
  });

  it('rejects a replaced canonical root after an apparently successful callback', () => {
    const fixture = nativeFixture(), root = fixture.packageOutputs.releaseRoot;
    const displaced = path.join(path.dirname(root), 'callback-displaced-release');
    const failure = capturePackageFailure(() => withFreshPackageOutputs(fixture.packageOutputs, () => {
      fixture.writePackage(); fs.renameSync(root, displaced); fs.mkdirSync(root);
      fs.writeFileSync(path.join(root, 'sentinel'), 'replacement-owner'); return { passed: true };
    }));
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.errors[0].message).toMatch(/identity changed/);
    expect(fs.readFileSync(path.join(displaced, 'win-unpacked/AmazonAIOpsAgent.exe'), 'utf8')).toBe('fresh-package-exe');
    expect(fs.readFileSync(path.join(root, 'sentinel'), 'utf8')).toBe('replacement-owner');
    expect(fs.readFileSync(path.join(retainedHistory(fixture), 'previous-release/win-unpacked/AmazonAIOpsAgent.exe'), 'utf8')).toBe('stale-package-exe');
  });

  it('rejects an unlisted linked artifact after an apparently successful callback', () => {
    const fixture = nativeFixture(), external = path.join(path.dirname(fixture.packageOutputs.releaseRoot), 'external');
    fs.mkdirSync(external); fs.writeFileSync(path.join(external, 'sentinel'), 'outside');
    const failure = capturePackageFailure(() => withFreshPackageOutputs(fixture.packageOutputs, () => {
      fixture.writePackage(); fs.symlinkSync(external, path.join(fixture.packageOutputs.releaseRoot, 'unlisted'), 'junction');
      return { passed: true };
    }));
    expect(failure).toBeInstanceOf(AggregateError); expect(failure.errors[0].message).toMatch(/linked|invalid/);
    expect(fs.readFileSync(path.join(external, 'sentinel'), 'utf8')).toBe('outside');
    expect(fs.readFileSync(fixture.packageExe, 'utf8')).toBe('fresh-package-exe');
    expect(JSON.parse(fs.readFileSync(path.join(retainedHistory(fixture), 'receipt.json'), 'utf8')).status).toBe('failed-retained-unrestored');
  });

  it('reports receipt failure after success without granting success or deleting either tree', () => {
    const fixture = nativeFixture(), receiptError = new Error('controlled successful-build receipt failure');
    const original = fs.writeFileSync.bind(fs), logs = [];
    vi.spyOn(fs, 'writeFileSync').mockImplementation((candidate, ...args) => {
      if (path.basename(candidate) === 'receipt.json') throw receiptError;
      return original(candidate, ...args);
    });
    vi.spyOn(process.stderr, 'write').mockImplementation(text => { logs.push(JSON.parse(text)); return true; });
    expect(() => withFreshPackageOutputs(fixture.packageOutputs, () => { fixture.writePackage(); return { passed: true }; })).toThrow(receiptError);
    const archive = retainedHistory(fixture);
    expect(fs.readFileSync(path.join(archive, 'failed-release/win-unpacked/AmazonAIOpsAgent.exe'), 'utf8')).toBe('fresh-package-exe');
    expect(fs.readFileSync(fixture.packageExe, 'utf8')).toBe('stale-package-exe');
    const failureReceipt = JSON.parse(fs.readFileSync(path.join(archive, 'receipt-failure.json'), 'utf8'));
    expect(failureReceipt.status).toBe('receipt-write-failed'); expect(failureReceipt.buildOutcome).toBe('succeeded');
    expect(logs.at(-1).context.status).toBe('receipt-write-failed');
    expect(JSON.stringify(logs)).not.toContain(path.dirname(fixture.packageOutputs.releaseRoot));
  });

  it.each(['failed-release', 'release'])('preserves the primary and secondary errors when renaming %s fails', destinationName => {
    const fixture = nativeFixture(), primary = new Error('controlled original failure'), secondary = new Error('controlled rename failure');
    const original = fs.renameSync.bind(fs);
    vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
      if ((destinationName === 'failed-release' && path.basename(destination) === destinationName)
        || (destinationName === 'release' && path.basename(source) === 'previous-release')) throw secondary;
      return original(source, destination);
    });
    const failure = capturePackageFailure(() => withFreshPackageOutputs(fixture.packageOutputs, () => { fixture.writePackage(); throw primary; }));
    expect(failure).toBeInstanceOf(AggregateError); expect(failure.errors).toEqual([primary, secondary]);
    const archive = retainedHistory(fixture);
    expect(fs.readFileSync(path.join(archive, 'previous-release/win-unpacked/AmazonAIOpsAgent.exe'), 'utf8')).toBe('stale-package-exe');
    const fresh = destinationName === 'failed-release' ? fixture.packageExe : path.join(archive, 'failed-release/win-unpacked/AmazonAIOpsAgent.exe');
    expect(fs.readFileSync(fresh, 'utf8')).toBe('fresh-package-exe');
    expect(JSON.parse(fs.readFileSync(path.join(archive, 'receipt.json'), 'utf8')).secondaryErrors[0].message).toBe(secondary.message);
  });

  it('does not overwrite an existing receipt or the earlier retained build history', () => {
    const fixture = nativeFixture(), parent = path.dirname(fixture.packageOutputs.releaseRoot);
    withFreshPackageOutputs(fixture.packageOutputs, () => { fixture.writePackage(); return {}; });
    const firstArchive = retainedHistory(fixture), firstTree = packageTreeSnapshot(firstArchive);
    const failure = capturePackageFailure(() => withFreshPackageOutputs(fixture.packageOutputs, () => {
      fixture.writePackage();
      const currentArchive = fs.readdirSync(parent).map(name => path.join(parent, name))
        .find(candidate => candidate !== firstArchive && path.basename(candidate).startsWith('.amazon-ai-ops-package-rollback-'));
      fs.writeFileSync(path.join(currentArchive, 'receipt.json'), 'reserved-proof'); return {};
    }));
    expect(failure.message).toMatch(/overwrite/);
    expect(packageTreeSnapshot(firstArchive)).toEqual(firstTree);
    const archives = fs.readdirSync(parent).filter(name => name.startsWith('.amazon-ai-ops-package-rollback-'));
    expect(archives).toHaveLength(2);
    const currentArchive = path.join(parent, archives.find(name => path.join(parent, name) !== firstArchive));
    expect(fs.readFileSync(path.join(currentArchive, 'receipt.json'), 'utf8')).toBe('reserved-proof');
    expect(JSON.parse(fs.readFileSync(path.join(currentArchive, 'receipt-failure.json'), 'utf8')).status).toBe('receipt-write-failed');
  });

  it('does not turn a falsy thrown value into a successful release', () => {
    const fixture = nativeFixture(); let threw = false;
    try { withFreshPackageOutputs(fixture.packageOutputs, () => { fixture.writePackage(); throw null; }); }
    catch (error) { threw = true; expect(error).toBeNull(); }
    expect(threw).toBe(true);
    expect(fs.readFileSync(fixture.packageExe, 'utf8')).toBe('stale-package-exe');
    expect(JSON.parse(fs.readFileSync(path.join(retainedHistory(fixture), 'receipt.json'), 'utf8')).primaryError.message).toBe('null');
  });
});

function capturePackageFailure(callback) {
  try { callback(); } catch (error) { return error; }
  throw new Error('Expected a controlled package failure.');
}

function packageTreeSnapshot(root) {
  const records = {}, pending = [root];
  while (pending.length) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(candidate);
      else {
        const stat = fs.lstatSync(candidate, { bigint: true });
        records[path.relative(root, candidate)] = { bytes: fs.readFileSync(candidate).toString('hex'),
          dev: String(stat.dev), ino: String(stat.ino), birthtimeNs: String(stat.birthtimeNs), mtimeNs: String(stat.mtimeNs) };
      }
    }
  }
  return records;
}

function retainedHistory(fixture) {
  const parent = path.dirname(fixture.packageOutputs.releaseRoot);
  const entries = fs.readdirSync(parent).filter(name => name.startsWith('.amazon-ai-ops-package-rollback-'));
  expect(entries).toHaveLength(1);
  return path.join(parent, entries[0]);
}

describe('single-lock isolated Windows package orchestration', () => {
  it('uses direct entrypoints and passes the isolated binding contract only to builder', () => {
    const builderEnvironment = {
      AAO_STAGED_SQLITE_BINDING: 'D:\\isolated\\better_sqlite3.node',
      AAO_STAGED_SQLITE_SHA256: 'A'.repeat(64),
      AAO_SOURCE_DUCKDB_SHA256: 'B'.repeat(64),
      AAO_ELECTRON_VERSION: '44.2.0',
      AAO_ELECTRON_MODULES_ABI: '149',
    };
    const steps = resolveWindowsBuildSteps(builderEnvironment);
    expect(steps.map((step) => step.name)).toEqual([
      'build-main',
      'publish-main-entry',
      'build-preload',
      'publish-preload-entry',
      'build-renderer',
      'stage-playwright-chromium',
      'electron-builder-windows',
    ]);
    const commandSteps = steps.filter((step) => step.kind === 'command');
    const commandText = commandSteps
      .flatMap((step) => [step.executablePath, ...step.args])
      .join(' ');
    expect(commandSteps.some((step) => (
      /^(?:npm|pnpm)(?:\.cmd)?$/i.test(path.basename(step.executablePath))
      || step.args.some((arg) => /^(?:npm|pnpm)(?:\.cmd)?$/i.test(arg))
    ))).toBe(false);
    expect(commandText).toMatch(/stage-playwright-chromium\.js/i);
    expect(commandText).toMatch(/electron-builder[\\/]+cli\.js/i);
    expect(commandText).toMatch(/run-electron-builder-windows\.js/i);
    expect(steps.at(-1).env).toMatchObject(builderEnvironment);
    expect(steps.at(-1).env.NO_UPDATE_NOTIFIER).toBe('1');
    expect(steps.at(-2).env.AAO_STAGED_SQLITE_BINDING).toBeUndefined();
  });

  it('ships a visible portable progress, duplicate-launch, and exit-78 contract', () => {
    const contents = fs.readFileSync(PROGRESS_TEMPLATE, 'utf8');
    expect(() => assertProgressTemplateContract(contents)).not.toThrow();
    expect(contents).not.toMatch(/SetSilent\s+silent/i);
    expect(contents).toContain('MUI_PAGE_INSTFILES');
    expect(contents).toContain('!insertmacro addLangs');
    expect(contents).toContain('AmazonAIOpsAgentPortableLauncher-v1');
    expect(contents).toContain('安全校验错误 78');
    expect(contents).toMatch(/ShowWindow\s+\$HWNDPARENT\s+\$\{SW_SHOW\}/);
  });

  it('retries only the extracted directory for at most 19.5 seconds and reports cleanup failure', () => {
    const contents = fs.readFileSync(PROGRESS_TEMPLATE, 'utf8');
    const cleanup = contents.slice(contents.indexOf('portable_cleanup_retry:'));
    expect(cleanup).toContain('RMDir /r "$INSTDIR"');
    expect(cleanup).not.toMatch(/RMDir[^\n]+\$TEMP|RMDir[^\n]+userData/i);
    expect(cleanup).toMatch(/\$\{If\} \$1 < 40\s+Sleep 500\s+Goto portable_cleanup_retry/);
    expect(cleanup).toContain('GetFileAttributesW(w "$INSTDIR")');
    expect(cleanup).toMatch(/\$3 = 2\s+\$\{OrIf\} \$3 = 3\s+Goto portable_cleanup_done/);
    expect(cleanup).toContain('"event":"portable.cleanup_failed"');
    expect(cleanup).toContain('"childExitCode":$R5');
    expect(cleanup).toContain('${GetTime} "" "LS" $4 $5 $7 $8 $9 $R0 $R1');
    expect(cleanup).toContain('IntFmt $9 "%02d" $9');
    expect(cleanup).toContain('StrCpy $R2 "$7-$5-$4T$9:$R0:$R1Z"');
    expect(cleanup).toContain('"timestamp":"$R2","level":"error","event":"portable.cleanup_failed","context":{');
    expect(cleanup).not.toMatch(/\$\{GetTime\}[^\n]+\$R5/);
    expect(cleanup).toMatch(/\$\{If\} \$R5 = 0\s+SetErrorLevel 79\s+\$\{Else\}\s+SetErrorLevel \$R5/);
    expect(cleanup).toMatch(/portable_cleanup_done:\s+SetErrorLevel \$R5/);
  });

  it.each([
    ['missing counter bound', '${If} $1 < 40', '${If} $1 < 0'],
    ['missing delay', 'Sleep 500', 'Sleep 0'],
    ['lost child exit code', 'StrCpy $R5 $0', 'StrCpy $R5 0'],
    ['false absence on access denied', '${OrIf} $3 = 3', '${OrIf} $3 = 5'],
    ['masked cleanup failure', 'SetErrorLevel 79', 'SetErrorLevel 0'],
    ['missing diagnostic', '"event":"portable.cleanup_failed"', '"event":"ignored"'],
    ['local time marked as UTC', '${GetTime} "" "LS"', '${GetTime} "" "L"'],
    ['clock overwrites child exit code', '${GetTime} "" "LS" $4 $5 $7', '${GetTime} "" "LS" $R5 $5 $7'],
    ['flat diagnostic context', '"context":{"launcherPid":$6', '"launcherPid":$6'],
    ['wrong successful status', 'portable_cleanup_done:\n  SetErrorLevel $R5', 'portable_cleanup_done:\n  SetErrorLevel 0'],
  ])('refuses a portable template with %s', (_name, before, after) => {
    const contents = fs.readFileSync(PROGRESS_TEMPLATE, 'utf8').replace(/\r\n/g, '\n');
    expect(contents).toContain(before);
    expect(() => assertProgressTemplateContract(contents.replace(before, after))).toThrow(/bounded cleanup/);
  });

  it.each(['success', 'failure'])('restores the installed portable template byte-exactly after %s', (outcome) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-portable-template-'));
    tempDirectories.push(directory);
    const installedDirectory = path.join(directory, 'templates', 'nsis');
    const installedTemplate = path.join(installedDirectory, 'portable.nsi');
    const replacementTemplate = path.join(directory, 'replacement.nsi');
    const original = Buffer.from('Function .onInit\n  SetSilent silent\nFunctionEnd\n');
    fs.mkdirSync(installedDirectory, { recursive: true });
    fs.writeFileSync(installedTemplate, original);
    fs.copyFileSync(PROGRESS_TEMPLATE, replacementTemplate);

    const invoke = () => withPortableTemplateOverride({
      installedTemplate,
      replacementTemplate,
    }, () => {
      expect(fs.readFileSync(installedTemplate, 'utf8')).toContain('正在解压运行文件');
      if (outcome === 'failure') throw new Error('fake builder failure');
      return 'ok';
    });

    if (outcome === 'failure') {
      expect(invoke).toThrow(/fake builder failure/i);
    } else {
      expect(invoke()).toBe('ok');
    }
    expect(fs.readFileSync(installedTemplate).equals(original)).toBe(true);
  });

  it('holds one outer scope across isolated prep, build, package probe, and cleanup', () => {
    const fixture = nativeFixture();
    const sequence = [];
    let observedBuilderEnvironment;
    const result = buildWindowsPackage({
      ...fixture.injections,
      withLock: (callback) => {
        sequence.push('lock-enter');
        try {
          return callback();
        } finally {
          sequence.push('lock-exit');
        }
      },
      withPreparedElectron: (_paths, _metadata, callback) => {
        sequence.push('isolated-enter');
        try {
          return callback(fixture.electronPreparation);
        } finally {
          sequence.push('isolated-exit');
        }
      },
      prepareNativeRuntime: (args) => {
        sequence.push(`prepare-${args.mode}`);
        return fixture.preparePackage();
      },
      runBuildSteps: (_steps, builderEnvironment) => {
        sequence.push('build');
        observedBuilderEnvironment = builderEnvironment;
        fixture.writePackage();
        return [{ name: 'fake-package', kind: 'command', status: 0 }];
      },
    });

    expect(sequence).toEqual([
      'lock-enter',
      'isolated-enter',
      'build',
      'prepare-package',
      'isolated-exit',
      'lock-exit',
    ]);
    expect(observedBuilderEnvironment).toMatchObject({
      AAO_STAGED_SQLITE_BINDING: fixture.stagedSqliteBindingPath,
      AAO_STAGED_SQLITE_SHA256: fixture.electronPreparation.bindings.sqlite.sha256,
      AAO_SOURCE_DUCKDB_SHA256: fixture.sourceBefore.duckdbSha256,
      AAO_ELECTRON_MODULES_ABI: EXPECTED_ELECTRON_MODULES_ABI,
    });
    expect(result.sourceBindings).toMatchObject({
      before: fixture.sourceBefore,
      after: fixture.sourceBefore,
      unchangedExact: true,
      sourceReadOnly: true,
    });
    expect(result.package.freshCurrentRun).toBe(true);
    expect(result.package.defaultNoInstallDelivery).toBe('folder_zip');
    expect(result.package.folderZipPath).toBe(fixture.packageOutputs.folderZipPath);
    expect(sha256File(fixture.sourcePaths.sqliteBindingPath))
      .toBe(fixture.sourceBefore.sqliteSha256);
    expect(sha256File(fixture.sourcePaths.duckdbBindingPath))
      .toBe(fixture.sourceBefore.duckdbSha256);
  });

  it.each([
    ['build failure', 'build'],
    ['package probe failure', 'package'],
  ])('leaves source bindings unchanged after %s', (_label, failurePoint) => {
    const fixture = nativeFixture();
    expect(() => buildWindowsPackage({
      ...fixture.injections,
      withLock: (callback) => callback(),
      prepareNativeRuntime: () => {
        if (failurePoint === 'package') throw new Error('package probe failed');
        return fixture.preparePackage();
      },
      runBuildSteps: () => {
        if (failurePoint === 'build') throw new Error('builder failed');
        fixture.writePackage();
        return [];
      },
    })).toThrow(failurePoint === 'build' ? /builder failed/i : /package probe failed/i);
    expect(sha256File(fixture.sourcePaths.sqliteBindingPath))
      .toBe(fixture.sourceBefore.sqliteSha256);
    expect(sha256File(fixture.sourcePaths.duckdbBindingPath))
      .toBe(fixture.sourceBefore.duckdbSha256);
  });

  it('rejects a package whose DuckDB binding differs from the source baseline', () => {
    const fixture = nativeFixture();
    expect(() => buildWindowsPackage({
      ...fixture.injections,
      withLock: (callback) => callback(),
      prepareNativeRuntime: fixture.preparePackage,
      runBuildSteps: () => {
        fixture.writePackage();
        fs.writeFileSync(fixture.packagePaths.duckdbBindingPath, 'mutated-package-duck');
        return [];
      },
    })).toThrow(/packaged DuckDB.*baseline/i);
    expect(sha256File(fixture.sourcePaths.duckdbBindingPath))
      .toBe(fixture.sourceBefore.duckdbSha256);
  });

  it('cannot accept stale release outputs when builder reports success without replacements', () => {
    const fixture = nativeFixture();
    const staleExecutableSha256 = sha256File(fixture.packageExe);
    expect(() => buildWindowsPackage({
      ...fixture.injections,
      withLock: (callback) => callback(),
      prepareNativeRuntime: fixture.preparePackage,
      runBuildSteps: () => [],
    })).toThrow(/fresh win-unpacked|does not exist/i);
    expect(sha256File(fixture.packageExe)).toBe(staleExecutableSha256);
    expect(fs.readFileSync(fixture.packageExe, 'utf8')).toBe('stale-package-exe');
  });
});

function nativeFixture() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'amazon-ai-ops-package-build-test-'),
  );
  tempDirectories.push(directory);
  const sourceDirectory = path.join(directory, 'source');
  const isolatedDirectory = path.join(directory, 'isolated');
  const releaseRoot = path.join(directory, 'release');
  const packageDirectory = path.join(releaseRoot, 'win-unpacked');
  fs.mkdirSync(sourceDirectory, { recursive: true });
  fs.mkdirSync(isolatedDirectory, { recursive: true });
  fs.mkdirSync(packageDirectory, { recursive: true });
  const sourcePaths = {
    sqliteBindingPath: path.join(sourceDirectory, 'better_sqlite3.node'),
    duckdbBindingPath: path.join(sourceDirectory, 'duckdb.node'),
  };
  const stagedSqliteBindingPath = path.join(isolatedDirectory, 'better_sqlite3.node');
  const packagedNativeRoot = path.join(packageDirectory, 'resources', 'app', 'node_modules');
  const packagePaths = {
    sqliteBindingPath: path.join(
      packagedNativeRoot,
      'better-sqlite3',
      'build',
      'Release',
      'better_sqlite3.node',
    ),
    duckdbBindingPath: path.join(
      packagedNativeRoot,
      'duckdb',
      'lib',
      'binding',
      'duckdb.node',
    ),
  };
  const packageExe = path.join(packageDirectory, 'AmazonAIOpsAgent.exe');
  const packageOutputs = {
    releaseRoot,
    winUnpackedRoot: packageDirectory,
    executablePath: packageExe,
    installerPath: path.join(releaseRoot, 'AmazonAIOpsAgent-1.5.0.exe'),
    portablePath: path.join(releaseRoot, 'AmazonAIOpsAgent-1.5.0-portable.exe'),
    folderZipPath: path.join(releaseRoot, 'AmazonAIOpsAgent-1.5.0.zip'),
    blockmapPath: path.join(releaseRoot, 'AmazonAIOpsAgent-1.5.0.exe.blockmap'),
  };
  fs.writeFileSync(sourcePaths.sqliteBindingPath, 'source-node-sqlite');
  fs.writeFileSync(sourcePaths.duckdbBindingPath, 'source-duck');
  fs.writeFileSync(stagedSqliteBindingPath, 'isolated-electron-sqlite');
  fs.mkdirSync(path.dirname(packagePaths.sqliteBindingPath), { recursive: true });
  fs.mkdirSync(path.dirname(packagePaths.duckdbBindingPath), { recursive: true });
  fs.writeFileSync(packageExe, 'stale-package-exe');
  fs.writeFileSync(packagePaths.sqliteBindingPath, 'stale-package-sqlite');
  fs.writeFileSync(packagePaths.duckdbBindingPath, 'stale-package-duck');
  fs.writeFileSync(packageOutputs.installerPath, 'stale-installer');
  fs.writeFileSync(packageOutputs.portablePath, 'stale-portable');
  fs.writeFileSync(packageOutputs.folderZipPath, 'stale-folder-zip');
  fs.writeFileSync(packageOutputs.blockmapPath, 'stale-blockmap');
  const sourceBefore = {
    sqliteSha256: sha256File(sourcePaths.sqliteBindingPath),
    duckdbSha256: sha256File(sourcePaths.duckdbBindingPath),
  };
  const runtimeResult = (mode, sqliteBindingPath, duckdbBindingPath) => ({
    mode,
    action: mode === 'isolated-electron'
      ? 'staged-and-verified'
      : 'verified-only',
    target: {
      modulesAbi: EXPECTED_ELECTRON_MODULES_ABI,
    },
    bindings: {
      sqlite: {
        path: sqliteBindingPath,
        sha256: sha256File(sqliteBindingPath),
      },
      duckdb: {
        path: duckdbBindingPath,
        sha256: sha256File(duckdbBindingPath),
      },
    },
  });
  const electronPreparation = runtimeResult(
    'isolated-electron',
    stagedSqliteBindingPath,
    sourcePaths.duckdbBindingPath,
  );
  const preparePackage = () => runtimeResult(
    'package',
    packagePaths.sqliteBindingPath,
    packagePaths.duckdbBindingPath,
  );
  const writePackage = () => {
    fs.mkdirSync(path.dirname(packagePaths.sqliteBindingPath), { recursive: true });
    fs.mkdirSync(path.dirname(packagePaths.duckdbBindingPath), { recursive: true });
    fs.writeFileSync(packageExe, 'fresh-package-exe');
    fs.copyFileSync(stagedSqliteBindingPath, packagePaths.sqliteBindingPath);
    fs.copyFileSync(sourcePaths.duckdbBindingPath, packagePaths.duckdbBindingPath);
    fs.writeFileSync(packageOutputs.installerPath, 'fresh-installer');
    fs.writeFileSync(packageOutputs.portablePath, 'fresh-portable');
    fs.writeFileSync(packageOutputs.folderZipPath, 'fresh-folder-zip');
    fs.writeFileSync(packageOutputs.blockmapPath, 'fresh-blockmap');
  };
  return {
    sourcePaths,
    packagePaths,
    packageOutputs,
    packageExe,
    stagedSqliteBindingPath,
    sourceBefore,
    electronPreparation,
    preparePackage,
    writePackage,
    injections: {
      electronMetadata: { version: '44.2.0' },
      sourcePaths,
      packagePaths,
      packageOutputs,
      packageExe,
      withPreparedElectron: (_paths, _metadata, callback) => (
        callback(electronPreparation)
      ),
    },
  };
}

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { assessModuleSize, checkModuleBoundaries, isImplementationModule, MAX_MODULE_LINES, moduleBoundaryLog, resolveModuleCheckMode } from './check-module-boundaries.mjs';

const lines = (count, newline = '\n') => Array(count).fill('implementation').join(newline) + newline;

describe('changed module size boundary', () => {
  it('includes executable styles, templates and Python in the same module boundary', () => {
    for (const file of ['main.ts', 'page.tsx', 'probe.mjs', 'format.cjs', 'layout.css', 'layout.scss', 'layout.sass', 'layout.less', 'observer.py', 'view.html', 'view.vue', 'smoke.ps1', 'tasks.psm1', 'build.cmd', 'launch.bat', 'build.sh']) {
      expect(isImplementationModule(file), file).toBe(true);
    }
    for (const file of ['README.md', 'settings.json', 'lock.yaml', 'capture.png', 'module.ts.bak']) {
      expect(isImplementationModule(file), file).toBe(false);
    }
  });

  it('checks tracked and untracked styles and Python in a real full Git inventory', () => {
    const temporaryRoot = fs.realpathSync(os.tmpdir());
    const root = fs.mkdtempSync(path.join(temporaryRoot, 'module-resource-inventory-'));
    try {
      execFileSync('git', ['init', '--quiet'], { cwd: root });
      const styles = path.join(root, 'apps/desktop/src/styles.css');
      const python = path.join(root, 'scripts/observer.py');
      const scss = path.join(root, 'packages/theme/layout.scss');
      const powershell = path.join(root, 'scripts/package.ps1');
      const builder = path.join(root, 'apps/desktop/scripts/build.js');
      const vite = path.join(root, 'apps/desktop/vite.config.ts');
      for (const file of [styles, python, scss, powershell, builder, vite]) fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(styles, lines(1000));
      fs.writeFileSync(python, lines(1001));
      fs.writeFileSync(scss, lines(999));
      fs.writeFileSync(powershell, lines(999));
      fs.writeFileSync(builder, lines(999));
      fs.writeFileSync(vite, lines(999));
      fs.writeFileSync(path.join(root, 'scripts/README.md'), lines(1500));
      execFileSync('git', ['add', 'apps/desktop/src/styles.css'], { cwd: root });
      const result = checkModuleBoundaries({ root, mode: 'all' });
      expect({ ...result, violations: result.violations.sort((left, right) => left.filePath.localeCompare(right.filePath)) }).toMatchObject({
        checked: 6,
        violations: [
          { filePath: 'apps/desktop/src/styles.css', currentLines: 1000 },
          { filePath: 'scripts/observer.py', currentLines: 1001 },
        ],
      });
    } finally {
      if (path.dirname(fs.realpathSync(root)).toLowerCase() !== temporaryRoot.toLowerCase()) {
        throw new Error('临时模块库存目录超出本次拥有的根目录');
      }
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects oversized new modules and existing modules that newly cross the limit', () => {
    expect(assessModuleSize('new.ts', lines(1000))).toMatchObject({ currentLines: 1000, baselineLines: 0 });
    expect(assessModuleSize('existing.ts', lines(1000), lines(900))).toMatchObject({ currentLines: 1000, baselineLines: 900 });
  });

  it('allows legacy decomposition but blocks further growth of a large module', () => {
    expect(assessModuleSize('legacy.ts', lines(1800), lines(2000))).toBeNull();
    expect(assessModuleSize('legacy.ts', lines(2000), lines(2000))).toBeNull();
    expect(assessModuleSize('legacy.ts', lines(2001), lines(2000))).toMatchObject({ currentLines: 2001, baselineLines: 2000 });
  });

  it('counts CRLF and LF equally and excludes the terminal newline from the cap', () => {
    expect(assessModuleSize('windows.ts', lines(MAX_MODULE_LINES, '\r\n'))).toBeNull();
    expect(assessModuleSize('unix.ts', lines(MAX_MODULE_LINES))).toBeNull();
    expect(assessModuleSize('windows.ts', lines(1000, '\r\n'))?.currentLines).toBe(1000);
  });

  it('rejects every oversized legacy module in the full inventory mode', () => {
    expect(assessModuleSize('legacy.ts', lines(1800), lines(2000), 'all'))
      .toMatchObject({ currentLines: 1800, baselineLines: 2000, maximumLines: 999 });
    expect(assessModuleSize('unchanged.mjs', lines(2000), lines(2000), 'all'))
      .toMatchObject({ currentLines: 2000 });
    expect(assessModuleSize('boundary.cjs', lines(999), lines(2000), 'all')).toBeNull();
  });

  it('keeps the incremental command as the default and rejects ambiguous options', () => {
    expect(resolveModuleCheckMode([])).toBe('changed');
    expect(resolveModuleCheckMode(['--changed'])).toBe('changed');
    expect(resolveModuleCheckMode(['--all'])).toBe('all');
    expect(() => resolveModuleCheckMode(['--all', '--changed'])).toThrow('用法');
    expect(() => resolveModuleCheckMode(['--ignore-legacy'])).toThrow('用法');
    expect(() => assessModuleSize('legacy.ts', lines(2000), null, 'unknown')).toThrow('模式');
  });

  it('uses the common UTC event envelope for both successful checks and errors', () => {
    const now = new Date('2026-10-16T12:34:56Z');
    expect(JSON.parse(moduleBoundaryLog('info', 'module.boundaries_checked', { mode: 'all' }, now)))
      .toEqual({ timestamp: '2026-10-16T12:34:56.000Z', level: 'info', event: 'module.boundaries_checked', context: { mode: 'all' } });
    expect(JSON.parse(moduleBoundaryLog('error', 'module.boundaries_failed', { error: { message: 'git' } }, now)))
      .toMatchObject({ level: 'error', context: { error: { message: 'git' } } });
  });
});

// 新增语言走同一个完整库存门，既有六文件案例与断言保持。
it('includes native C# in the unchanged global module size policy', () => {
  expect(isImplementationModule('scripts/caption-native.cs')).toBe(true);
  expect(assessModuleSize('scripts/caption-native.cs', lines(1000), null, 'all')).toMatchObject({ currentLines: 1000, maximumLines: 999 });
});

it('checks tracked and untracked native C# in the real full Git inventory', () => {
  const temporaryRoot = fs.realpathSync(os.tmpdir()), owned = fs.mkdtempSync(path.join(temporaryRoot, 'native-csharp-boundary-'));
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: owned });
    fs.mkdirSync(path.join(owned, 'scripts'));
    fs.writeFileSync(path.join(owned, 'scripts', 'caption.cs'), lines(1000));
    expect(checkModuleBoundaries({ root: owned, mode: 'all' })).toMatchObject({ checked: 1,
      violations: [{ filePath: 'scripts/caption.cs', currentLines: 1000, maximumLines: 999 }] });
  } finally {
    if (path.dirname(fs.realpathSync(owned)).toLowerCase() !== temporaryRoot.toLowerCase()) throw new Error('本次原生模块测试目录超出拥有边界');
    fs.rmSync(owned, { recursive: true, force: true });
  }
});

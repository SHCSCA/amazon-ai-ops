import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRuntimeLogRecord } from '../packages/shared-types/src/runtime-log-format.cjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_ROOTS = [
  'apps/desktop/src', 'apps/desktop/scripts', 'apps/desktop/vite.config.ts',
  'packages', 'scripts', 'vitest.config.ts',
];
export const MAX_MODULE_LINES = 999;

export function isImplementationModule(filePath) {
  return /\.(?:[cm]?[jt]sx?|css|scss|sass|less|py|html|vue|cs|ps1|psm1|cmd|bat|sh)$/.test(filePath);
}

function lineCount(text) {
  if (!text) return 0;
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
}

export function assessModuleSize(filePath, currentText, baselineText = null, mode = 'changed') {
  if (!['changed', 'all'].includes(mode)) throw new Error(`不支持的模块检查模式：${mode}`);
  const currentLines = lineCount(currentText);
  const baselineLines = baselineText === null ? 0 : lineCount(baselineText);
  if (currentLines <= MAX_MODULE_LINES) return null;
  // 超限存量只能持平或缩小，新模块必须在上限以内。
  if (mode === 'changed' && baselineText !== null && baselineLines > MAX_MODULE_LINES && currentLines <= baselineLines) return null;
  return { filePath, currentLines, baselineLines, maximumLines: MAX_MODULE_LINES };
}

function gitList(args, root) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
}

export function checkModuleBoundaries({ mode = 'changed', root = ROOT } = {}) {
  if (!['changed', 'all'].includes(mode)) throw new Error(`不支持的模块检查模式：${mode}`);
  const baseline = mode === 'changed'
    ? new Set(gitList(['ls-tree', '-r', '--name-only', '-z', 'HEAD', '--', ...SOURCE_ROOTS], root))
    : new Set();
  const files = mode === 'all'
    ? new Set(gitList(['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', ...SOURCE_ROOTS], root))
    : new Set([
      ...gitList(['diff', '--name-only', '-z', 'HEAD', '--', ...SOURCE_ROOTS], root),
      ...gitList(['ls-files', '--others', '--exclude-standard', '-z', '--', ...SOURCE_ROOTS], root),
    ]);
  const violations = [];
  let checked = 0;
  for (const filePath of files) {
    if (!isImplementationModule(filePath)) continue;
    const absolutePath = path.join(root, filePath);
    if (!existsSync(absolutePath)) continue;
    const currentText = readFileSync(absolutePath, 'utf8');
    const baselineText = baseline.has(filePath)
      ? execFileSync('git', ['show', `HEAD:${filePath}`], { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
      : null;
    const violation = assessModuleSize(filePath, currentText, baselineText, mode);
    if (violation) violations.push(violation);
    checked++;
  }
  return { mode, checked, violations };
}

export function checkChangedModuleBoundaries() {
  return checkModuleBoundaries();
}

export function resolveModuleCheckMode(argv) {
  if (!argv.length || (argv.length === 1 && argv[0] === '--changed')) return 'changed';
  if (argv.length === 1 && argv[0] === '--all') return 'all';
  throw new Error('用法：node scripts/check-module-boundaries.mjs [--changed|--all]');
}

export function moduleBoundaryLog(level, event, context, now = new Date()) {
  return JSON.stringify(createRuntimeLogRecord(level, event, context, now));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = checkModuleBoundaries({ mode: resolveModuleCheckMode(process.argv.slice(2)) });
    process.stdout.write(`${moduleBoundaryLog('info', 'module.boundaries_checked', result)}\n`);
    if (result.violations.length > 0) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${moduleBoundaryLog('error', 'module.boundaries_failed', {
      error: error instanceof Error ? { name: error.name, message: error.message } : { message: String(error) },
    })}\n`);
    process.exitCode = 1;
  }
}

import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createMinimalIsolatedWorkPackage } from './isolated-v16-work-package.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
try {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--output' || !args[1] || args[1] !== args[1].trim()) throw new Error('用法：node scripts/create-isolated-v16-work-package.mjs --output 全新工作包目录');
  const output = path.resolve(args[1]);
  const local = path.relative(path.join(root, 'output'), output);
  if (!local || path.isAbsolute(local) || local === '..' || local.startsWith('..' + path.sep)) throw new Error('隔离工作包只能新建在本仓库 output 的独立子目录。');
  const { collectFrozenBuild } = require('../apps/desktop/scripts/v16-frozen-build.js');
  const receipt = createMinimalIsolatedWorkPackage(output, collectFrozenBuild(root));
  process.stdout.write(JSON.stringify({ timestamp: new Date().toISOString(), level: 'info', event: 'desktop.isolated_work_package_created', context: receipt }) + '\n');
} catch (error) {
  process.exitCode = 1;
  process.stderr.write(JSON.stringify({ timestamp: new Date().toISOString(), level: 'error', event: 'desktop.isolated_work_package_creation_failed',
    context: { message: error instanceof Error ? error.message : String(error) } }) + '\n');
}

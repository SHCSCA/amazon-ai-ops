const path = require('path');
const child_process = require('child_process');

const rootDir = path.join(__dirname, '..', '..', '..');
const esbuildPath = path.join(rootDir, 'node_modules/.pnpm/esbuild@0.21.5/node_modules/esbuild/bin/esbuild');
const desktopDir = path.join(rootDir, 'apps/desktop');

const args = [
  esbuildPath,
  'src/preload/index.ts',
  '--bundle',
  '--platform=node',
  '--target=node18',
  `--outfile=${path.join(desktopDir, 'dist/preload/index.cjs')}`,
  '--external:electron',
  '--format=cjs',
  '--sourcemap'
];

console.log('Building preload script...');
child_process.spawn('node', args, { stdio: 'inherit', cwd: desktopDir });
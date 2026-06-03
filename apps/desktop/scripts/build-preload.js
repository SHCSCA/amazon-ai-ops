const path = require('path');
const child_process = require('child_process');

const rootDir = path.join(__dirname, '..', '..', '..');
const esbuildPath = require.resolve('esbuild/bin/esbuild');
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
child_process.execFileSync('node', args, { stdio: 'inherit', cwd: desktopDir });

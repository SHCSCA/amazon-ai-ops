const path = require('path');
const child_process = require('child_process');

const rootDir = path.join(__dirname, '..', '..', '..');
const esbuildPath = require.resolve('esbuild/bin/esbuild');
const desktopDir = path.join(rootDir, 'apps/desktop');

const args = [
  esbuildPath,
  'src/main/index.ts',
  '--bundle',
  '--platform=node',
  '--target=node18',
  `--outfile=${path.join(desktopDir, 'dist/main/index.cjs')}`,
  '--external:electron',
  '--external:nock',
  '--external:mock-aws-s3',
  '--external:aws-sdk',
  '--external:chromium-bidi',
  '--external:@mapbox/node-pre-gyp',
  '--external:better-sqlite3',
  '--external:duckdb',
  '--format=cjs',
  '--sourcemap'
];

console.log('Building main process...');
child_process.execFileSync('node', args, { stdio: 'inherit', cwd: desktopDir });

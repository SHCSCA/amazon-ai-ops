const path = require('node:path');
const { verifyS7Bundle } = require('./verify-s7-ready-safety');

function parseArgs(argv) {
  const allowed = new Set(['bundle-manifest', 'readiness', 'help']);
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help') {
      values.help = true;
      continue;
    }
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    if (!allowed.has(key)) throw new Error(`Unexpected argument: --${key}`);
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      throw new Error(`Duplicate argument: --${key}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
    values[key] = value;
    index += 1;
  }
  return values;
}

function usage() {
  return [
    'Usage: node scripts/verify-s7-non-ready-safety.js',
    '  --bundle-manifest <absolute s7-delivery-bundle-manifest.json>',
    '  --readiness <absolute mission-control-production-readiness.json>',
  ].join('\n');
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!args['bundle-manifest']) throw new Error('Missing required argument: --bundle-manifest');
  if (!args.readiness) throw new Error('Missing required argument: --readiness');
  const result = verifyS7Bundle({
    manifestPath: path.resolve(args['bundle-manifest']),
    readinessPath: path.resolve(args.readiness),
    mode: 'non-ready',
  });
  if (!result.passed) {
    for (const failure of result.failures) process.stderr.write(`[FAIL] ${failure}\n`);
    throw new Error(`NON_READY_SAFETY rejected: ${result.failures.length} check(s) failed.`);
  }
  process.stdout.write(
    `NON_READY_SAFETY verified: faithful APP_NEEDS_WORK bundle with ${result.manifest.gateSummary.passed}/8 gates.\n`,
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  parseArgs,
};

// 按职责复用原有严格校验，公共入口继续保持兼容。
const fs = require('node:fs');
const path = require('node:path');
const { SINGLE_VALUE_OPTIONS, assertCleanAbsolutePath, entryExists, fail } = require('./production-authority-selection-contracts.js');
const { assertDirectExistingPath } = require('./production-authority-selection-files.js');
const { defaultContext, inspectProductionAuthoritySelection, validateContext } = require('./production-authority-selection-inspection.js');

function parseArgs(argv) {
    const values = {};
    let exportRequested = false;
    let help = false;
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (token === '--help' || token === '-h') {
            help = true;
            continue;
        }
        if (token === '--export') {
            if (exportRequested)
                fail('Duplicate argument: --export.');
            exportRequested = true;
            continue;
        }
        if (!token.startsWith('--'))
            fail(`Unexpected positional argument: ${token}`);
        const name = token.slice(2);
        if (!SINGLE_VALUE_OPTIONS.has(name))
            fail(`Unknown argument: --${name}.`);
        if (Object.prototype.hasOwnProperty.call(values, name)) {
            fail(`Duplicate argument: --${name}.`);
        }
        const value = argv[index + 1];
        if (value === undefined || value.startsWith('--')) {
            fail(`--${name} requires a value.`);
        }
        values[name] = value;
        index += 1;
    }
    if (!help) {
        for (const required of ['db', 'expected-user-data-dir', 'expected-main-sha256']) {
            if (!values[required])
                fail(`--${required} is required.`);
        }
        if (exportRequested && !values.out) {
            fail('--export requires --out <absolute non-existing json>.');
        }
        if (!exportRequested && values.out) {
            fail('--out is only valid together with --export.');
        }
    }
    return { exportRequested, help, values };
}

function assertSafeOutputPath(outputPath) {
    const resolved = assertCleanAbsolutePath(outputPath, '--out');
    if (path.extname(resolved).toLowerCase() !== '.json') {
        fail('--out must name a .json file.');
    }
    const parent = path.dirname(resolved);
    assertDirectExistingPath(parent, 'Authority selection output parent', 'directory');
    if (entryExists(resolved)) {
        fail(`Authority selection output already exists and will not be overwritten: ${resolved}`);
    }
    return resolved;
}

function writeJsonAtomicExclusive(outputPath, value, context) {
    const resolved = assertSafeOutputPath(outputPath);
    const parent = path.dirname(resolved);
    const nonce = String(context.randomUUID()).replace(/[^A-Za-z0-9-]/g, '');
    if (!nonce)
        fail('Authority selection randomUUID returned an invalid value.');
    const temporaryPath = path.join(parent, `.tmp-${path.basename(resolved)}-${nonce}`);
    if (entryExists(temporaryPath)) {
        fail(`Authority selection temporary output already exists: ${temporaryPath}`);
    }
    let handle = null;
    try {
        handle = fs.openSync(temporaryPath, 'wx', 0o600);
        fs.writeFileSync(handle, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
        fs.fsyncSync(handle);
        fs.closeSync(handle);
        handle = null;
        fs.linkSync(temporaryPath, resolved);
        fs.unlinkSync(temporaryPath);
        return resolved;
    }
    catch (error) {
        if (handle !== null)
            fs.closeSync(handle);
        if (entryExists(temporaryPath)) {
            const direct = assertDirectExistingPath(temporaryPath, 'Authority selection temporary output', 'file');
            fs.unlinkSync(direct.realPath);
        }
        throw error;
    }
}

function usage() {
    return [
        'Usage: node scripts/verify-production-authority-selection.js',
        '  --db <absolute amazon-ai-ops.db>',
        '  --expected-user-data-dir <absolute Electron userData>',
        '  --expected-main-sha256 <64hex>',
        '  [--export --out <absolute new .json>]',
        '',
        'Default mode is strictly read-only and writes no evidence file.',
        '--export writes one non-formal monitoring preflight with exclusive atomic creation.',
        'This command never reads business rows from non-authority candidates and never executes Ads.',
    ].join('\n');
}

async function run(argv = process.argv.slice(2), injectedContext = {}) {
    const parsed = parseArgs(argv);
    if (parsed.help) {
        const writeStdout = injectedContext.writeStdout
            ?? process.stdout.write.bind(process.stdout);
        if (typeof writeStdout !== 'function') {
            fail('Authority selection writeStdout dependency is invalid.');
        }
        writeStdout(`${usage()}\n`);
        return { exitCode: 0, evidence: null, outputPath: null };
    }
    const context = defaultContext(injectedContext);
    validateContext(context);
    const evidence = inspectProductionAuthoritySelection({
        dbPath: parsed.values.db,
        expectedUserDataDir: parsed.values['expected-user-data-dir'],
        expectedMainSha256: parsed.values['expected-main-sha256'],
    }, context);
    const outputPath = parsed.exportRequested
        ? writeJsonAtomicExclusive(parsed.values.out, evidence, context)
        : null;
    context.writeStdout(`${JSON.stringify(evidence, null, 2)}\n`);
    return { exitCode: 0, evidence, outputPath };
}

module.exports = { parseArgs, assertSafeOutputPath, writeJsonAtomicExclusive, usage, run };

// 按职责复用原有严格校验，公共入口继续保持兼容。

const { USAGE } = require('./s7-launch-operator-contracts.js');
const { executeApproved } = require('./s7-launch-operator-execution.js');
const { isolatedRecoveryOutput, writeProtectedRecoveryOutput } = require('./s7-launch-operator-filesystem.js');
const { finalizeApproved, prepareFinalization } = require('./s7-launch-operator-finalization.js');
const { createPacket, parseArgs } = require('./s7-launch-operator-packet.js');
const { assertWindows, defaultContext, validateContext } = require('./s7-launch-operator-runtime.js');

async function run(argv = process.argv.slice(2), injected = {}) {
    const parsed = parseArgs(argv);
    const context = defaultContext(injected);
    validateContext(context);
    if (parsed.mode === 'help') {
        context.writeStdout(`${USAGE}\n`);
        return { exitCode: 0, outputPath: null, receipt: null };
    }
    assertWindows(context);
    if (parsed.mode === 'prepare') {
        const packet = createPacket({
            db: parsed.values.db,
            authoritySelection: parsed.values['authority-selection'],
            migrationManifest: parsed.values['migration-manifest'],
            migrationVerification: parsed.values['migration-verification'],
            packageUiManifest: parsed.values['package-ui-manifest'],
            packageUpgradeSmoke: parsed.values['package-upgrade-smoke'],
        }, context);
        const isolatedOutput = isolatedRecoveryOutput(parsed.values.out, parsed.values['recovery-root'], packet.bindings.canonical, packet.bindings.package, [
            parsed.values['authority-selection'],
            parsed.values['migration-manifest'],
            parsed.values['migration-verification'],
            parsed.values['package-ui-manifest'] || parsed.values['package-upgrade-smoke'],
        ], context.inspectWindowsPathSecurity);
        const outputPath = writeProtectedRecoveryOutput(isolatedOutput.output, packet, context, 'Approval packet');
        context.writeStdout(`${JSON.stringify(packet, null, 2)}\n`);
        return { exitCode: 0, packet, outputPath };
    }
    if (parsed.mode === 'prepare-finalization' || parsed.mode === 'prepare-recovery') {
        const result = prepareFinalization(parsed.values, context);
        context.writeStdout(`${JSON.stringify(result.receipt, null, 2)}\n`);
        return result;
    }
    if (parsed.mode === 'finalize-approved') {
        const result = finalizeApproved(parsed.values, context);
        context.writeStdout(`${JSON.stringify(result.receipt, null, 2)}\n`);
        return result;
    }
    const result = await executeApproved(parsed.values, context);
    context.writeStdout(`${JSON.stringify(result.receipt, null, 2)}\n`);
    return result;
}

module.exports = { run };

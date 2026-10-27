// 按证据职责拆分共享夹具与断言，保留原有完整测试名称。
import { fs, path, root, spawnSync, writeValidAdversarialNodeEnvEvidence } from './v15-export-test-environment.mjs';
function ensureCurrentAdversarialNodeEnvContract(args) {
    const finalReadinessIndex = args.indexOf('--final-readiness');
    if (finalReadinessIndex < 0 || !args[finalReadinessIndex + 1])
        return args;
    const finalReadinessPath = path.resolve(args[finalReadinessIndex + 1]);
    if (!fs.existsSync(finalReadinessPath))
        return args;
    const finalReadiness = JSON.parse(fs.readFileSync(finalReadinessPath, 'utf8'));
    const fixturePath = path.join(path.dirname(finalReadinessPath), 'package-adversarial-node-env.json');
    const fixture = writeValidAdversarialNodeEnvEvidence(fixturePath, {
        executableSha256: 'A'.repeat(64),
        appContentSha256: 'B'.repeat(64),
        mainBundleSha256: 'C'.repeat(64),
        rendererEntryPath: path.join(path.dirname(finalReadinessPath), 'dist', 'renderer', 'index.html'),
    });
    finalReadiness.packageAdversarialNodeEnv = fixture.selection;
    fs.writeFileSync(finalReadinessPath, `${JSON.stringify(finalReadiness, null, 2)}\n`, 'utf8');
    const manifestPath = finalReadiness.evidenceSelection?.manifestPath;
    if (manifestPath && fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        manifest.evidence = manifest.evidence || {};
        manifest.evidence.packageAdversarialNodeEnv = fixture.manifestEntry;
        fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    }
    if (args.includes('--package-adversarial-node-env-evidence'))
        return args;
    return [...args, '--package-adversarial-node-env-evidence', fixturePath];
}

function runNode(script, args = [], options = {}) {
    const effectiveArgs = script === 'scripts/export-v15-delivery-bundle.js'
        && options.currentAdversarialContract !== false
        ? ensureCurrentAdversarialNodeEnvContract(args)
        : args;
    return spawnSync(process.execPath, [path.join(root, script), ...effectiveArgs], {
        cwd: root,
        encoding: 'utf8',
    });
}
export { ensureCurrentAdversarialNodeEnvContract, runNode };

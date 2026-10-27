// 按证据职责拆分共享夹具与断言，保留原有完整测试名称。
import { PACKAGE_MAIN_BUNDLE_SHA256, createValidAdReadbackEvidence, crypto, fs, path, root, spawnSync, writeAdReadbackAuthorityDb, writeValidPackageLaunchSmoke } from './v15-non-ready-test-environment.mjs';
function runNode(script, args = []) {
    return spawnSync(process.execPath, [path.join(root, script), ...args], {
        cwd: root,
        encoding: 'utf8',
    });
}

function writeJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function artifactRecord(filePath) {
    return {
        path: filePath,
        sizeBytes: fs.statSync(filePath).size,
        sha256: sha256File(filePath),
    };
}

function writeValidReadbackWithDb(fixtureDir, evidencePath) {
    const evidence = createValidAdReadbackEvidence(fixtureDir);
    writeJson(evidencePath, evidence);
    return writeAdReadbackAuthorityDb(path.join(fixtureDir, 'authority-db'), evidence);
}

function writeReadme(filePath, status = 'IN_PROGRESS') {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `# Fixture\n\n**DELIVERY: ${status}.** Fixture README for non-ready safety tests.\n`, 'utf8');
    return filePath;
}

function writePng(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.from(path.basename(filePath), 'utf8'),
    ]));
    return filePath;
}

function writeReport(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'placeholder report file for non-ready safety readback verifier\n', 'utf8');
    return filePath;
}

function sha256Text(content) {
    return crypto.createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex').toUpperCase();
}

function sha256File(filePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function finalPackageIndex(dir) {
    fs.mkdirSync(dir, { recursive: true });
    const installerContent = 'installer package fixture\n';
    const portableContent = 'portable package fixture\n';
    const installerPath = path.join(dir, 'AmazonAIOpsAgent-1.5.0.exe');
    const portablePath = path.join(dir, 'AmazonAIOpsAgent-1.5.0-portable.exe');
    fs.writeFileSync(installerPath, installerContent, 'utf8');
    fs.writeFileSync(portablePath, portableContent, 'utf8');
    const installerStat = fs.statSync(installerPath);
    const portableStat = fs.statSync(portablePath);
    return {
        generatedAt: '2026-07-16T08:06:00.000Z',
        present: true,
        count: 2,
        existingCount: 2,
        missingCount: 0,
        releaseDir: dir,
        error: null,
        copyPolicy: 'Installer and portable EXE binaries are not copied into readiness evidence; this index records local paths, existence, size, and SHA-256.',
        packages: [
            {
                kind: 'installer',
                sourcePath: installerPath,
                fileName: 'AmazonAIOpsAgent-1.5.0.exe',
                exists: true,
                sizeBytes: Buffer.byteLength(installerContent, 'utf8'),
                sha256: sha256Text(installerContent),
                modifiedAt: installerStat.mtime.toISOString(),
            },
            {
                kind: 'portable',
                sourcePath: portablePath,
                fileName: 'AmazonAIOpsAgent-1.5.0-portable.exe',
                exists: true,
                sizeBytes: Buffer.byteLength(portableContent, 'utf8'),
                sha256: sha256Text(portableContent),
                modifiedAt: portableStat.mtime.toISOString(),
            },
        ],
    };
}

function validPackageLaunchSmoke(dir, portablePackage) {
    const portablePath = portablePackage?.sourcePath || path.join(dir, 'AmazonAIOpsAgent-1.5.0-portable.exe');
    return writeValidPackageLaunchSmoke(dir, {
        generatedAt: '2026-07-16T08:07:10.078Z',
        portablePath,
        releaseDir: dir,
    });
}

function validPackageSecurityEvidence(smoke, packageUi) {
    const checks = [
        'PACKAGE_EXECUTABLE_HASH_MATCH',
        'PACKAGE_APP_CONTENT_HASH_MATCH',
        'PACKAGE_MAIN_BUNDLE_HASH_VALID',
        'NAVIGATION_SECURITY_MARKER_PRESENT',
        'LEGACY_LOGIN_MIGRATION_MARKER_PRESENT',
        'PACKAGED_DEV_DOWNGRADE_GUARD_PRESENT',
        'NAVIGATION_GUARDS_WIRED',
        'LEGACY_SAVED_PASSWORD_IPC_ABSENT',
        'DIRECT_EXTERNAL_URL_FORWARDING_ABSENT',
        'PLAINTEXT_CREDENTIAL_WRITER_ABSENT',
        'SQLITE_VERBOSE_LOGGING_ABSENT',
    ].map((code) => ({ code, passed: true }));
    return {
        kind: 'package-security-boundaries',
        schemaVersion: 1,
        generatedAt: '2026-07-16T08:09:30.000Z',
        passed: true,
        package: {
            executableSha256: smoke.artifacts.unpacked.sha256,
            appContentSha256: packageUi.artifactsAfter.appContent.sha256,
            mainBundleSha256: PACKAGE_MAIN_BUNDLE_SHA256,
        },
        summary: { total: checks.length, passed: checks.length, failed: 0 },
        checks,
    };
}
export { runNode, writeJson, artifactRecord, writeValidReadbackWithDb, writeReadme, writePng, writeReport, sha256Text, sha256File, finalPackageIndex, validPackageLaunchSmoke, validPackageSecurityEvidence };

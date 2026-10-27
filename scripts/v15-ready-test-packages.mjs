// 按证据职责拆分共享夹具与断言，保留原有完整测试名称。
import { crypto, fs, path, writeValidPackageLaunchSmoke } from './v15-ready-test-environment.mjs';
import { sha256Text, writeJson } from './v15-ready-test-artifacts.mjs';
function finalPackageIndex(dir) {
    const installerContent = 'installer package fixture\n';
    const portableContent = 'portable package fixture\n';
    const installerPath = path.join(dir, 'AmazonAIOpsAgent-1.5.0.exe');
    const portablePath = path.join(dir, 'AmazonAIOpsAgent-1.5.0-portable.exe');
    fs.writeFileSync(installerPath, installerContent, 'utf8');
    fs.writeFileSync(portablePath, portableContent, 'utf8');
    return {
        present: true,
        count: 2,
        existingCount: 2,
        missingCount: 0,
        releaseDir: dir,
        packages: [
            {
                kind: 'installer',
                sourcePath: installerPath,
                fileName: 'AmazonAIOpsAgent-1.5.0.exe',
                exists: true,
                sizeBytes: Buffer.byteLength(installerContent, 'utf8'),
                sha256: sha256Text(installerContent),
            },
            {
                kind: 'portable',
                sourcePath: portablePath,
                fileName: 'AmazonAIOpsAgent-1.5.0-portable.exe',
                exists: true,
                sizeBytes: Buffer.byteLength(portableContent, 'utf8'),
                sha256: sha256Text(portableContent),
            },
        ],
    };
}

function bundlePackageIndex(bundleManifestPath, finalIndex) {
    const bundleJson = 'evidence/release-package-index.json';
    writeJson(path.join(path.dirname(bundleManifestPath), bundleJson), {
        generatedAt: '2026-06-10T00:00:00.000Z',
        releaseDir: finalIndex.releaseDir,
        copyPolicy: 'Installer and portable EXE binaries are not copied into the delivery bundle.',
        packages: finalIndex.packages,
    });
    return {
        present: true,
        count: finalIndex.packages.length,
        existingCount: finalIndex.packages.filter((item) => item.exists).length,
        missingCount: 0,
        bundleJson,
    };
}

function packageLaunchSmokeFromIndex(dir, finalIndex) {
    const evidencePath = path.join(dir, 'package-launch-smoke.json');
    const portable = finalIndex.packages.find((item) => item.kind === 'portable');
    const evidence = writeValidPackageLaunchSmoke(dir, {
        evidencePath,
        generatedAt: '2026-07-17T00:00:00.000Z',
        portablePath: portable?.sourcePath,
        releaseDir: dir,
    });
    return {
        present: true,
        evidencePath,
        generatedAt: evidence.generatedAt,
        passed: true,
        artifacts: evidence.artifacts,
        checks: evidence.checks,
    };
}

function writePackageSecurityEvidence(dir, packageLaunchSmoke) {
    const evidencePath = path.join(dir, 'package-security-boundaries.json');
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
    writeJson(evidencePath, {
        kind: 'package-security-boundaries',
        schemaVersion: 1,
        generatedAt: '2026-07-17T00:00:00.000Z',
        passed: true,
        package: {
            executableSha256: packageLaunchSmoke.artifacts.unpacked.sha256,
            appContentSha256: 'B'.repeat(64),
            mainBundleSha256: 'C'.repeat(64),
        },
        summary: { total: checks.length, passed: checks.length, failed: 0 },
        checks,
    });
    return evidencePath;
}

function writePackageUiEvidence(dir, packageLaunchSmoke) {
    const evidencePath = path.join(dir, 'package-ui-manifest.json');
    const appContentSha256 = 'B'.repeat(64);
    const mainBundleSha256 = 'C'.repeat(64);
    const appContent = {
        kind: 'unpacked-app-content-manifest',
        rootPath: path.join(dir, 'win-unpacked', 'resources', 'app'),
        sha256: appContentSha256,
        files: [{ path: 'dist/main/index.js', sizeBytes: 1, sha256: mainBundleSha256 }],
    };
    writeJson(evidencePath, {
        kind: 'package-ui-evidence',
        schemaVersion: 5,
        passed: true,
        artifactHashesStable: true,
        violations: [],
        completeness: { passed: true, violations: [] },
        requested: {
            expectedExeSha256: packageLaunchSmoke.artifacts.unpacked.sha256,
            expectedAppContentSha256: appContentSha256,
        },
        artifactsBefore: {
            exe: packageLaunchSmoke.artifacts.unpacked,
            appContent,
        },
        artifactsAfter: {
            exe: packageLaunchSmoke.artifacts.unpacked,
            appContent,
        },
    });
    return evidencePath;
}

function bundlePackageUiEvidence(bundleManifestPath, sourcePath) {
    const bundlePath = 'evidence/package-ui-manifest.json';
    const targetPath = path.join(path.dirname(bundleManifestPath), bundlePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
    const hash = crypto.createHash('sha256').update(fs.readFileSync(targetPath)).digest('hex').toUpperCase();
    return {
        manifest: {
            packageUiManifest: {
                sourcePath,
                present: true,
                bundlePath,
                sha256: hash,
            },
        },
        file: {
            label: 'evidence:package-ui-manifest.json',
            sourcePath,
            bundlePath,
            sizeBytes: fs.statSync(targetPath).size,
            sha256: hash,
        },
    };
}

function bundlePackageSecurityEvidence(bundleManifestPath, sourcePath) {
    const bundlePath = 'evidence/package-security-boundaries.json';
    const targetPath = path.join(path.dirname(bundleManifestPath), bundlePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
    const hash = crypto.createHash('sha256').update(fs.readFileSync(targetPath)).digest('hex').toUpperCase();
    return {
        manifest: {
            packageSecurityBoundaries: {
                sourcePath,
                present: true,
                bundlePath,
                sha256: hash,
            },
        },
        file: {
            label: 'evidence:package-security-boundaries.json',
            sourcePath,
            bundlePath,
            sizeBytes: fs.statSync(targetPath).size,
            sha256: hash,
        },
    };
}

function writeBundleReadme(bundleManifestPath, status = 'APP_READY') {
    const readmePath = path.join(path.dirname(bundleManifestPath), 'docs', 'README.md');
    fs.mkdirSync(path.dirname(readmePath), { recursive: true });
    fs.writeFileSync(readmePath, `**DELIVERY: ${status}.** bundle README fixture.\n`, 'utf8');
    return readmePath;
}
export { finalPackageIndex, bundlePackageIndex, packageLaunchSmokeFromIndex, writePackageSecurityEvidence, writePackageUiEvidence, bundlePackageUiEvidence, bundlePackageSecurityEvidence, writeBundleReadme };

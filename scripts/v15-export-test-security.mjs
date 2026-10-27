// 按证据职责拆分共享夹具与断言，保留原有完整测试名称。
import { path } from './v15-export-test-environment.mjs';
import { writeJson } from './v15-export-test-artifacts.mjs';
function writeNonReadyFinalReadiness(runDir) {
    const evidenceManifest = path.join(runDir, 'evidence-manifest.json');
    const finalReadiness = path.join(runDir, 'final-readiness.json');
    writeJson(evidenceManifest, {
        kind: 'v15-final-readiness-evidence-manifest',
        evidence: {},
    });
    writeJson(finalReadiness, {
        status: 'APP_NEEDS_WORK',
        appReady: false,
        evidenceSelection: {
            mode: 'manifest',
            manifestPath: evidenceManifest,
        },
        gates: [],
    });
    return { evidenceManifest, finalReadiness };
}

function validPackageSecurityEvidence() {
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
        generatedAt: '2026-07-17T00:00:00.000Z',
        passed: true,
        package: {
            executableSha256: 'A'.repeat(64),
            appContentSha256: 'B'.repeat(64),
            mainBundleSha256: 'C'.repeat(64),
        },
        summary: { total: checks.length, passed: checks.length, failed: 0 },
        checks,
    };
}
export { writeNonReadyFinalReadiness, validPackageSecurityEvidence };

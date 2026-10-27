// 按证据职责拆分夹具与验收断言，测试仍归属原有入口。

import { validPackageUiWorkspaceCheck, validPackageUiMinimumWindow } from './package-ui-evidence.test-fixture.mjs';

import { bindPackageUiTestManifest } from './package-ui-evidence.test-fixture.mjs';

import { addCurrentCanaryLineage } from './execution-canary-current.test-fixture.mjs';

import fs from 'node:fs';

import crypto from 'node:crypto';

import path from 'node:path';

import os from 'node:os';

import zlib from 'node:zlib';

import { spawnSync } from 'node:child_process';

import { createRequire } from 'node:module';

import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import packageUiEvidence from './package-ui-evidence.js';

import packageSecurity from './smoke-package-security-boundaries.js';

import packageAdversarialNodeEnv from './smoke-package-adversarial-node-env.js';

import continuousOperationVerifier from './verify-s7-continuous-operation.js';

import sqliteAuthorityCurrentness from './sqlite-authority-currentness.js';

import { writeValidPackageLaunchSmoke } from './package-launch-smoke.test-fixture.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.resolve(__dirname, '..');

const requireFromLocalDb = createRequire(path.join(root, 'packages', 'local-db', 'package.json'));

const Database = requireFromLocalDb('better-sqlite3');

const verifierPath = path.join(root, 'scripts', 'verify-mission-control-production-readiness.js');

const readinessVerifier = createRequire(import.meta.url)(verifierPath);

const testTempRoot = path.join(os.tmpdir(), 'amazon-ai-ops-readiness-tests');

const EXECUTION_CANARY_AUTHORITY_QUERY_CONTRACT = 'mission-control-execution-canary-authority/v2';

const ONE_PIXEL_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

const PNG_SIGNATURE = Buffer.from('89504E470D0A1A0A', 'hex');

const CRC_TABLE = new Uint32Array(256);

for (let index = 0; index < CRC_TABLE.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
        value = (value & 1) !== 0 ? (0xEDB88320 ^ (value >>> 1)) : (value >>> 1);
    }
    CRC_TABLE[index] = value >>> 0;
}

const HASH_A = 'A'.repeat(64);

const HASH_B = 'B'.repeat(64);

const HASH_C = 'C'.repeat(64);

const V15_GATE_IDS = [
    'report-collection-delivery',
    'lingxing-listing-full-read',
    'ai-live-provider',
    'ad-recommendation-ai-explanation',
    'listing-ai-draft',
    'real-ad-execution-readback',
    'release-package-hash',
    'package-launch-smoke',
];

const { EXPECTED_OVERLAY_CHECK_IDS, EXPECTED_PACKAGE_UI_SCALES, EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS, EXPECTED_PACKAGE_UI_WORKSPACES, EXPECTED_PACKAGE_UI_ENTRIES, INTERACTIVE_LOGIN_CONTRACT, ISOLATED_PROFILE_BOOTSTRAP_CONTRACT, PACKAGE_UI_PROFILE_SEQUENCE, PACKAGE_UI_WIDE_PROFILE, buildPackageUiAttemptArtifactManifest, buildPackageUiRunnerContract, buildProcessIsolationEvidence, writeImmutableEnvelope, } = packageUiEvidence;

const { EXPECTED_PACKAGE_SECURITY_CHECK_CODES } = packageSecurity;

const { buildAdversarialNodeEnvEvidence } = packageAdversarialNodeEnv;

const { EXPECTED_REPORT_TYPES, buildEvidenceManifest: buildContinuousOperationManifest, evaluateContinuousOperationSnapshot, readContinuousOperationSnapshot, } = continuousOperationVerifier;

const { runReadonlySqliteOnlineBackupSync } = sqliteAuthorityCurrentness;

fs.mkdirSync(testTempRoot, { recursive: true });

const PACKAGE_UI_USER_DATA_DIR = 'D:\\Temp\\amazon-ai-ops-package-ui\\profile-copy';

const SCHEDULER_CONTEXT = {
    storeId: 'store-us-001',
    browserProfileId: 'profile-us-001',
    marketplace: 'US',
    currency: 'USD',
    businessTimezone: 'America/Los_Angeles',
    businessDate: '2026-07-23',
    sessionGeneration: 4,
};

const EMPTY_SCHEDULER_COUNTS = {
    workspaceQuery: 0,
    schedulerGet: 0,
    retentionPreview: 0,
    runNow: 0,
    runNowRejected: 0,
    localSchedulerStart: 0,
    storeSchedulerStart: 0,
    reconcile: 0,
    execute: 0,
};

const storeFixtures = Object.freeze([
    Object.freeze({ storeId: 'store-us-east', browserProfileId: 'profile-us-east' }),
    Object.freeze({ storeId: 'store-us-west', browserProfileId: 'profile-us-west' }),
]);
export { validPackageUiWorkspaceCheck, validPackageUiMinimumWindow, bindPackageUiTestManifest, addCurrentCanaryLineage, fs, crypto, path, zlib, spawnSync, createRequire, fileURLToPath, describe, expect, it, packageUiEvidence, packageSecurity, packageAdversarialNodeEnv, continuousOperationVerifier, sqliteAuthorityCurrentness, writeValidPackageLaunchSmoke, __dirname, root, requireFromLocalDb, Database, verifierPath, readinessVerifier, testTempRoot, EXECUTION_CANARY_AUTHORITY_QUERY_CONTRACT, ONE_PIXEL_PNG, PNG_SIGNATURE, CRC_TABLE, HASH_A, HASH_B, HASH_C, V15_GATE_IDS, EXPECTED_OVERLAY_CHECK_IDS, EXPECTED_PACKAGE_UI_SCALES, EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS, EXPECTED_PACKAGE_UI_WORKSPACES, EXPECTED_PACKAGE_UI_ENTRIES, INTERACTIVE_LOGIN_CONTRACT, ISOLATED_PROFILE_BOOTSTRAP_CONTRACT, PACKAGE_UI_PROFILE_SEQUENCE, PACKAGE_UI_WIDE_PROFILE, buildPackageUiAttemptArtifactManifest, buildPackageUiRunnerContract, buildProcessIsolationEvidence, writeImmutableEnvelope, EXPECTED_PACKAGE_SECURITY_CHECK_CODES, buildAdversarialNodeEnvEvidence, EXPECTED_REPORT_TYPES, buildContinuousOperationManifest, evaluateContinuousOperationSnapshot, readContinuousOperationSnapshot, runReadonlySqliteOnlineBackupSync, PACKAGE_UI_USER_DATA_DIR, SCHEDULER_CONTEXT, EMPTY_SCHEDULER_COUNTS, storeFixtures };

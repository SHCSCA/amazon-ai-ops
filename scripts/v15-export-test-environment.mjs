// 按证据职责拆分共享夹具与断言，保留原有完整测试名称。

import { validPackageUiWorkspaceCheck, validPackageUiMinimumWindow } from './package-ui-evidence.test-fixture.mjs';

import { bindPackageUiTestManifest } from './package-ui-evidence.test-fixture.mjs';

import fs from 'fs';

import path from 'path';

import crypto from 'crypto';

import { spawnSync } from 'child_process';

import { afterEach, describe, expect, it } from 'vitest';

import { fileURLToPath } from 'url';

import { createRequire } from 'module';

import { createValidAdReadbackEvidence, writeAdReadbackAuthorityDb, } from './ad-readback-authority-db.test-fixture.mjs';

import { writeValidAdversarialNodeEnvEvidence, } from './package-adversarial-node-env.test-fixture.mjs';

import { writeValidPackageLaunchSmoke } from './package-launch-smoke.test-fixture.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const require = createRequire(import.meta.url);

const packageUiEvidence = require('./package-ui-evidence');

const { EXPECTED_OVERLAY_CHECK_IDS, EXPECTED_PACKAGE_UI_SCALES, EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS, EXPECTED_PACKAGE_UI_WORKSPACES, EXPECTED_PACKAGE_UI_ENTRIES, INTERACTIVE_LOGIN_CONTRACT, ISOLATED_PROFILE_BOOTSTRAP_CONTRACT, PACKAGE_UI_PROFILE_SEQUENCE, PACKAGE_UI_WIDE_PROFILE, } = packageUiEvidence;

const root = path.resolve(__dirname, '..');

const evidenceDir = path.join(root, 'output', 'codex-evidence');

const cleanupPaths = [];

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

afterEach(() => {
    for (const cleanupPath of cleanupPaths.splice(0).reverse()) {
        fs.rmSync(cleanupPath, { recursive: true, force: true });
    }
});
export { validPackageUiWorkspaceCheck, validPackageUiMinimumWindow, bindPackageUiTestManifest, fs, path, crypto, spawnSync, afterEach, describe, expect, it, fileURLToPath, createRequire, createValidAdReadbackEvidence, writeAdReadbackAuthorityDb, writeValidAdversarialNodeEnvEvidence, writeValidPackageLaunchSmoke, __dirname, require, packageUiEvidence, EXPECTED_OVERLAY_CHECK_IDS, EXPECTED_PACKAGE_UI_SCALES, EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS, EXPECTED_PACKAGE_UI_WORKSPACES, EXPECTED_PACKAGE_UI_ENTRIES, INTERACTIVE_LOGIN_CONTRACT, ISOLATED_PROFILE_BOOTSTRAP_CONTRACT, PACKAGE_UI_PROFILE_SEQUENCE, PACKAGE_UI_WIDE_PROFILE, root, evidenceDir, cleanupPaths, PACKAGE_UI_USER_DATA_DIR, SCHEDULER_CONTEXT, EMPTY_SCHEDULER_COUNTS };

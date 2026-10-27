// 按证据职责拆分夹具与验收断言，测试仍归属原有入口。

import fs from 'node:fs';

import os from 'node:os';

import path from 'node:path';

import { spawn, spawnSync } from 'node:child_process';

import { createRequire } from 'node:module';

import { createInterface } from 'node:readline';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { enforceS7MainStartupGate } from '../apps/desktop/src/main/s7-migration-startup-gate.ts';

const require = createRequire(import.meta.url);

const { EXCLUSIVE_WINDOW_HELPER_BOOTSTRAP, EXCLUSIVE_WINDOW_HELPER_SCRIPT, REQUIRED_MIGRATION_VERIFICATION_CODES, defaultAcquireLaunchExclusiveWindow, defaultInspectWindowsPathSecurity, defaultProtectWindowsDirectory, defaultProtectWindowsFile, fileArtifact, postMigrationAuthorityContract, validatePackageUpgradeSmoke, parseArgs, resolveTrustedWindowsPowerShell, run, } = require('./operate-s7-live-migration-launch.js');

const { evaluatePackageUiEvidenceCompleteness, } = require('./package-ui-evidence.js');

const { REQUIRED_LIVE_MIGRATION_ACCEPTANCE_CHECK_CODES, validateS7LiveMigrationAcceptanceReceipt, } = require('./verify-s7-live-migration-acceptance.js');

const { TARGET_VERSION } = require('./migrate-current-user-db.js');

const { legacyV1Checksum, REQUIRED_TABLES } = require('./verify-production-authority-selection.js');

const roots = [];

afterEach(() => {
    for (const root of roots.splice(0)) {
        fs.rmSync(root, {
            recursive: true,
            force: true,
            maxRetries: 10,
            retryDelay: 100,
        });
    }
});
export { fs, os, path, spawn, spawnSync, createRequire, createInterface, afterEach, describe, expect, it, vi, enforceS7MainStartupGate, require, EXCLUSIVE_WINDOW_HELPER_BOOTSTRAP, EXCLUSIVE_WINDOW_HELPER_SCRIPT, REQUIRED_MIGRATION_VERIFICATION_CODES, defaultAcquireLaunchExclusiveWindow, defaultInspectWindowsPathSecurity, defaultProtectWindowsDirectory, defaultProtectWindowsFile, fileArtifact, postMigrationAuthorityContract, validatePackageUpgradeSmoke, parseArgs, resolveTrustedWindowsPowerShell, run, evaluatePackageUiEvidenceCompleteness, REQUIRED_LIVE_MIGRATION_ACCEPTANCE_CHECK_CODES, validateS7LiveMigrationAcceptanceReceipt, TARGET_VERSION, legacyV1Checksum, REQUIRED_TABLES, roots };

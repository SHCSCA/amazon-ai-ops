// 按证据职责拆分共享夹具与断言，保留原有完整测试名称。

import { validPackageUiWorkspaceCheck, validPackageUiMinimumWindow } from './package-ui-evidence.test-fixture.mjs';

import { bindPackageUiTestManifest, packageUiBindingFixture } from './package-ui-evidence.test-fixture.mjs';

import fs from 'fs';

import os from 'os';

import path from 'path';

import crypto from 'crypto';

import { spawnSync } from 'child_process';

import { createRequire } from 'module';

import { describe, expect, it } from 'vitest';

import { fileURLToPath } from 'url';

import { createValidAdReadbackEvidence, writeAdReadbackAuthorityDb, } from './ad-readback-authority-db.test-fixture.mjs';

import { bundleAdversarialNodeEnvEvidence, writeValidAdversarialNodeEnvEvidence, } from './package-adversarial-node-env.test-fixture.mjs';

import { writeValidPackageLaunchSmoke } from './package-launch-smoke.test-fixture.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.resolve(__dirname, '..');

const evidenceDir = path.join(root, 'output', 'codex-evidence');

const bundleRoot = path.join(root, 'output', 'delivery-bundles');

const PACKAGE_MAIN_BUNDLE_SHA256 = 'C'.repeat(64);

const HASH_A = 'A'.repeat(64);

const HASH_B = 'B'.repeat(64);

const require = createRequire(import.meta.url);

const { packageUiReferencedArtifactsAreBundled, } = require('./verify-v15-non-ready-safety.js');

const { EXPECTED_OVERLAY_CHECK_IDS, EXPECTED_PACKAGE_UI_SCALES, EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS, EXPECTED_PACKAGE_UI_WORKSPACES, EXPECTED_PACKAGE_UI_ENTRIES, INTERACTIVE_LOGIN_CONTRACT, ISOLATED_PROFILE_BOOTSTRAP_CONTRACT, PACKAGE_UI_PROFILE_SEQUENCE, PACKAGE_UI_WIDE_PROFILE, buildPackageUiAttemptArtifactManifest, buildPackageUiRunnerContract, evaluatePackageUiEvidenceCompleteness, validatePackageUiReadOnlyRuntimeEvidence, validateSchedulerSubviewEvidence, writeImmutableEnvelope, } = require('./package-ui-evidence.js');

const SCHEDULER_CONTEXT = {
    storeId: 'store-us-001',
    browserProfileId: 'profile-us-001',
    marketplace: 'US',
    currency: 'USD',
    businessTimezone: 'America/Los_Angeles',
    businessDate: '2026-07-16',
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

const strictNonReadyGates = () => [
    { id: 'report-collection-delivery', name: 'Report collection delivery', ok: true, status: 'passed' },
    { id: 'lingxing-listing-full-read', name: 'Lingxing Listing full read', ok: true, status: 'passed' },
    { id: 'ai-live-provider', name: 'AI live provider', ok: true, status: 'passed' },
    { id: 'ad-recommendation-ai-explanation', name: 'Ad recommendation AI explanation', ok: true, status: 'passed' },
    { id: 'listing-ai-draft', name: 'Listing AI draft', ok: true, status: 'passed' },
    { id: 'real-ad-execution-readback', name: 'Real ad execution readback', ok: false, status: 'needs_work' },
    { id: 'release-package-hash', name: 'Release package hash', ok: true, status: 'passed' },
    { id: 'package-launch-smoke', name: 'Package launch smoke', ok: true, status: 'passed' },
];
export { validPackageUiWorkspaceCheck, validPackageUiMinimumWindow, bindPackageUiTestManifest, packageUiBindingFixture, fs, os, path, crypto, spawnSync, createRequire, describe, expect, it, fileURLToPath, createValidAdReadbackEvidence, writeAdReadbackAuthorityDb, bundleAdversarialNodeEnvEvidence, writeValidAdversarialNodeEnvEvidence, writeValidPackageLaunchSmoke, __dirname, root, evidenceDir, bundleRoot, PACKAGE_MAIN_BUNDLE_SHA256, HASH_A, HASH_B, require, packageUiReferencedArtifactsAreBundled, EXPECTED_OVERLAY_CHECK_IDS, EXPECTED_PACKAGE_UI_SCALES, EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS, EXPECTED_PACKAGE_UI_WORKSPACES, EXPECTED_PACKAGE_UI_ENTRIES, INTERACTIVE_LOGIN_CONTRACT, ISOLATED_PROFILE_BOOTSTRAP_CONTRACT, PACKAGE_UI_PROFILE_SEQUENCE, PACKAGE_UI_WIDE_PROFILE, buildPackageUiAttemptArtifactManifest, buildPackageUiRunnerContract, evaluatePackageUiEvidenceCompleteness, validatePackageUiReadOnlyRuntimeEvidence, validateSchedulerSubviewEvidence, writeImmutableEnvelope, SCHEDULER_CONTEXT, EMPTY_SCHEDULER_COUNTS, strictNonReadyGates };

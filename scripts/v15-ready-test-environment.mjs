// 按证据职责拆分共享夹具与断言，保留原有完整测试名称。

import fs from 'fs';

import os from 'os';

import path from 'path';

import crypto from 'crypto';

import { spawnSync } from 'child_process';

import { describe, expect, it } from 'vitest';

import { fileURLToPath } from 'url';

import { createValidAdReadbackEvidence, writeAdReadbackAuthorityDb, } from './ad-readback-authority-db.test-fixture.mjs';

import { bundleAdversarialNodeEnvEvidence, writeValidAdversarialNodeEnvEvidence, } from './package-adversarial-node-env.test-fixture.mjs';

import { writeValidPackageLaunchSmoke } from './package-launch-smoke.test-fixture.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.resolve(__dirname, '..');
export { fs, os, path, crypto, spawnSync, describe, expect, it, fileURLToPath, createValidAdReadbackEvidence, writeAdReadbackAuthorityDb, bundleAdversarialNodeEnvEvidence, writeValidAdversarialNodeEnvEvidence, writeValidPackageLaunchSmoke, __dirname, root };

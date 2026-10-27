// 按证据职责拆分共享夹具与断言，保留原有完整测试名称。

import { createHash } from 'node:crypto';

import { spawnSync } from 'node:child_process';

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';

import http from 'node:http';

import { tmpdir } from 'node:os';

import { join } from 'node:path';

import { createRequire } from 'node:module';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import evidenceModule from './workspace-ui-evidence.js';

const require = createRequire(import.meta.url);

const { chromium } = require('./playwright-loader.js');

const { captureWorkspaceEvidence, collectWorkspaceDomMetrics, collectWorkspaceStateEvidence, normalizeWorkspaceEvidenceConfig, parseWorkspaceEvidenceArgs, runWorkspaceEvidenceTargets, } = evidenceModule;

let browser;

beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
}, 120000);

afterAll(async () => {
    await browser?.close();
}, 120000);
export { createHash, spawnSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, http, tmpdir, join, createRequire, afterAll, beforeAll, describe, expect, it, evidenceModule, require, chromium, captureWorkspaceEvidence, collectWorkspaceDomMetrics, collectWorkspaceStateEvidence, normalizeWorkspaceEvidenceConfig, parseWorkspaceEvidenceArgs, runWorkspaceEvidenceTargets, browser };

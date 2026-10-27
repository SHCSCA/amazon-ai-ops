// 按证据职责拆分共享夹具与断言，保留原有完整测试名称。

import fs from 'node:fs';

import os from 'node:os';

import path from 'node:path';

import { createRequire } from 'node:module';

import { afterEach, describe, expect, it } from 'vitest';

import operatorModule from './stage8-gate-operator.js';

import readinessModule from './verify-mission-control-production-readiness.js';

const requireFromLocalDb = createRequire(path.join(process.cwd(), 'packages', 'local-db', 'package.json'));

const Database = requireFromLocalDb('better-sqlite3');

const { EXPECTED_REPORT_TYPES, EXPORT_SEQUENCE, inspectOpenedDatabase, inspectSchema, migrationContract, parseArgs, rawCanaryCandidates, run, stableRef, validateExecuteInputs, writeAtomicLedger, } = operatorModule;

const { deterministicExecutionArtifactPath } = readinessModule;

const tempRoots = [];

afterEach(() => {
    for (const root of tempRoots.splice(0)) {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
export { fs, os, path, createRequire, afterEach, describe, expect, it, operatorModule, readinessModule, requireFromLocalDb, Database, EXPECTED_REPORT_TYPES, EXPORT_SEQUENCE, inspectOpenedDatabase, inspectSchema, migrationContract, parseArgs, rawCanaryCandidates, run, stableRef, validateExecuteInputs, writeAtomicLedger, deterministicExecutionArtifactPath, tempRoots };

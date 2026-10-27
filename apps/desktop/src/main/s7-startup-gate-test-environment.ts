// 按证据职责拆分共享夹具与验收断言，保留原有断言名称。

import * as fs from 'fs';

import * as os from 'os';

import * as path from 'path';

import { spawnSync } from 'child_process';

import Database from 'better-sqlite3';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { initGuardedExistingSqlite, SQLITE_MIGRATION_CONTRACT } from '@amazon-ai-ops/local-db/src/sqlite/db';

import { STORE_PROVIDER_IDENTITY_AUTHORITY_MIGRATION_VERSION, STORE_PROVIDER_IDENTITY_UNIQUE_INDEX, } from '@amazon-ai-ops/local-db/src/sqlite/migrations';

import { S7_STARTUP_GATE_ACTIVE_FILE, S7_STARTUP_GATE_ACTIVE_KIND, S7_STARTUP_GATE_ACTIVE_SCHEMA, S7_STARTUP_GATE_ADMISSION_FILE, S7_STARTUP_GATE_BOUND_FILE, S7_STARTUP_GATE_BOUND_KIND, S7_STARTUP_GATE_BOUND_SCHEMA, S7_STARTUP_GATE_CLOSED_FILE, S7_STARTUP_GATE_DIRECTORY, S7_STARTUP_GATE_ENV, S7_STARTUP_GATE_FINALIZED_FILE, S7_STARTUP_GATE_HANDOFF_READY_FILE, S7_STARTUP_GATE_HANDOFF_RELEASED_FILE, S7_STARTUP_GATE_POST_MIGRATION_ADMITTED_FILE, S7_STARTUP_GATE_TESTING, completeS7MainStartupAdmission, enforceS7MainStartupGate, protectFreshS7AuthorityPath, type S7StableFileArtifact, } from './s7-migration-startup-gate';

const roots: string[] = [];

afterEach(() => {
    for (const root of roots.splice(0)) {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
export { fs, os, path, spawnSync, Database, afterEach, describe, expect, it, vi, initGuardedExistingSqlite, SQLITE_MIGRATION_CONTRACT, STORE_PROVIDER_IDENTITY_AUTHORITY_MIGRATION_VERSION, STORE_PROVIDER_IDENTITY_UNIQUE_INDEX, S7_STARTUP_GATE_ACTIVE_FILE, S7_STARTUP_GATE_ACTIVE_KIND, S7_STARTUP_GATE_ACTIVE_SCHEMA, S7_STARTUP_GATE_ADMISSION_FILE, S7_STARTUP_GATE_BOUND_FILE, S7_STARTUP_GATE_BOUND_KIND, S7_STARTUP_GATE_BOUND_SCHEMA, S7_STARTUP_GATE_CLOSED_FILE, S7_STARTUP_GATE_DIRECTORY, S7_STARTUP_GATE_ENV, S7_STARTUP_GATE_FINALIZED_FILE, S7_STARTUP_GATE_HANDOFF_READY_FILE, S7_STARTUP_GATE_HANDOFF_RELEASED_FILE, S7_STARTUP_GATE_POST_MIGRATION_ADMITTED_FILE, S7_STARTUP_GATE_TESTING, completeS7MainStartupAdmission, enforceS7MainStartupGate, protectFreshS7AuthorityPath, type S7StableFileArtifact, roots };

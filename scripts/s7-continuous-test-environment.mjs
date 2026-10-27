// 按证据职责拆分夹具与验收断言，测试仍归属原有入口。

import crypto from 'node:crypto';

import fs from 'node:fs';

import { createRequire } from 'node:module';

import os from 'node:os';

import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import authoritySnapshotExporterModule from './export-mission-control-authority-snapshot.js';

import sqliteAuthorityCurrentnessModule from './sqlite-authority-currentness.js';

import verifierModule from './verify-s7-continuous-operation.js';

const { computeCanonicalPackageIdentity } = authoritySnapshotExporterModule;

const { runReadonlySqliteOnlineBackupSync } = sqliteAuthorityCurrentnessModule;

const { ACCEPTANCE_CONTRACT_VERSION, AUTHORITY_SNAPSHOT_KIND, AUTHORITY_SNAPSHOT_SCHEMA_VERSION, EXPECTED_REPORT_TYPES, US_BUSINESS_CALENDAR_VERSION, buildEvidenceManifest, evaluateContinuousOperationSnapshot, inclusiveDates, loadAuthoritySnapshotManifest, parseArgs, readContinuousOperationSnapshot, recentCompletedUsBusinessDates, run, usFederalBusinessDates, usWeekdayBusinessDates, } = verifierModule;

const requireLocalDbDependency = createRequire(path.join(process.cwd(), 'packages', 'local-db', 'package.json'));

const Database = requireLocalDbDependency('better-sqlite3');

const dates = usWeekdayBusinessDates('2026-07-13', '2026-07-21');

const generatedAt = '2026-07-22T20:00:00.000Z';

const evaluationRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-continuous-evaluation-'));

const evaluationStoresRoot = path.join(evaluationRoot, 'stores');

fs.mkdirSync(evaluationStoresRoot, { recursive: true });

afterAll(() => fs.rmSync(evaluationRoot, { recursive: true, force: true }));

const input = {
    stores: ['shc001', 'shc002'],
    dates,
    dateFrom: dates[0],
    dateTo: dates[6],
    generatedAt,
    storesRoot: evaluationStoresRoot,
};
export { crypto, fs, createRequire, os, path, afterAll, describe, expect, it, authoritySnapshotExporterModule, sqliteAuthorityCurrentnessModule, verifierModule, computeCanonicalPackageIdentity, runReadonlySqliteOnlineBackupSync, ACCEPTANCE_CONTRACT_VERSION, AUTHORITY_SNAPSHOT_KIND, AUTHORITY_SNAPSHOT_SCHEMA_VERSION, EXPECTED_REPORT_TYPES, US_BUSINESS_CALENDAR_VERSION, buildEvidenceManifest, evaluateContinuousOperationSnapshot, inclusiveDates, loadAuthoritySnapshotManifest, parseArgs, readContinuousOperationSnapshot, recentCompletedUsBusinessDates, run, usFederalBusinessDates, usWeekdayBusinessDates, requireLocalDbDependency, Database, dates, generatedAt, evaluationRoot, evaluationStoresRoot, input };

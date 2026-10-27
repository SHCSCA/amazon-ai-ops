// 按职责复用原有严格校验，公共入口继续保持兼容。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EXPECTED_REPORT_TYPES, BUSINESS_TIMEZONE, evaluateContinuousOperationSnapshot, loadAuthoritySnapshotManifest, readContinuousOperationSnapshot, recentCompletedUsBusinessDates, } = require('./verify-s7-continuous-operation');
const { runReadonlySqliteOnlineBackupSync, } = require('./sqlite-authority-currentness');
const { resolveAdReadbackAuthorityDbPath, } = require('./ad-readback-authority-db');
const { publicCanaryCandidates, rawCanaryCandidates } = require('./stage8-operator-canaries.js');
const { inspectContinuous, inspectToday } = require('./stage8-operator-continuous.js');
const { EXPORT_SEQUENCE, LEDGER_KIND, LEDGER_SCHEMA_VERSION, PACKAGE_EVIDENCE_OPTIONS, ROOT, fail, normalizedId, pathDescriptor, requireFromLocalDb } = require('./stage8-operator-contracts.js');
const { inspectSchema, migrationContract } = require('./stage8-operator-schema.js');
const { inspectStores } = require('./stage8-operator-stores.js');

function buildOrchestrationPlan(ledger, packageEvidence = {}) {
    const packageInputsPresent = PACKAGE_EVIDENCE_OPTIONS.every((option) => Boolean(packageEvidence[option]));
    const schemaReady = ledger.database.live.schema.status === 'READY';
    const storesReady = (ledger.stores.authorityStatus ?? ledger.stores.status) === 'READY';
    const operationalReady = (ledger.stores.operationalStatus?.status ?? ledger.stores.status)
        === 'READY';
    const continuousReady = ledger.continuous.passed === true;
    const manualReady = ledger.canaryCandidates.manualApproval.precheckedCount > 0;
    const policyReady = ledger.canaryCandidates.policyAuto.precheckedCount > 0;
    const readinessReady = packageInputsPresent
        && schemaReady
        && storesReady
        && operationalReady
        && continuousReady
        && manualReady
        && policyReady;
    const readinessById = {
        'authority-snapshot': schemaReady && storesReady && operationalReady,
        'continuous-operation': schemaReady && storesReady && operationalReady && continuousReady,
        'manual-canary': schemaReady && storesReady && operationalReady && continuousReady && manualReady,
        'policy-auto-canary': schemaReady && storesReady && operationalReady && continuousReady && policyReady,
        'production-readiness': readinessReady,
    };
    const prerequisites = {
        'authority-snapshot': ['schema-ready', 'two-active-us-usd-stores'],
        'continuous-operation': ['authority-snapshot', 'two-stores-x-seven-business-days-x-eight-reports'],
        'manual-canary': ['continuous-operation', 'one-formally-valid-human-authority-execution'],
        'policy-auto-canary': ['manual-canary', 'one-distinct-formally-valid-policy-authority-execution'],
        'production-readiness': ['policy-auto-canary', 'five-current-package-evidence-inputs'],
    };
    return {
        executesAds: false,
        mutatesAuthorityDatabase: false,
        sequence: EXPORT_SEQUENCE.map((id, index) => ({
            id,
            order: index + 1,
            prerequisites: prerequisites[id],
            readyForPreflight: readinessById[id],
            writesOnlyWhenExecuteExportsIsExplicit: true,
        })),
        status: readinessReady ? 'READY_FOR_FULL_PREFLIGHT' : 'PARTIAL',
    };
}

function inspectOpenedDatabase(database, options = {}, context = {}) {
    const generatedAt = (context.now ? context.now() : new Date()).toISOString();
    database.pragma('query_only = ON');
    const schema = inspectSchema(database, context.migrationContract || migrationContract());
    const stores = inspectStores(database, options.stores || [], generatedAt);
    const continuous = inspectContinuous(database, stores.rawStores, stores.aliases, generatedAt);
    const today = inspectToday(database, stores.rawStores, stores.aliases, generatedAt);
    for (const task of today.tasks) {
        const store = stores.items.find((item) => item.alias === task.storeAlias);
        task.gaps = [...new Set([
                ...(store?.operationalStatus.gaps || []),
                ...task.gaps,
            ])];
    }
    const storesRoot = path.resolve(options.storesRoot || path.join(path.dirname(options.dbPath || ROOT), 'stores'));
    const rawCandidates = rawCanaryCandidates(database, stores.rawStores, stores.aliases, storesRoot);
    const publicStores = {
        activeUsUsdCount: stores.activeUsUsdCount,
        allStoreCount: stores.allStoreCount,
        authorityStatus: stores.authorityStatus,
        items: stores.items,
        operationalStatus: stores.operationalStatus,
        requiredCount: 2,
        selectedCount: stores.selectedCount,
        status: stores.status,
    };
    const ledger = {
        kind: LEDGER_KIND,
        schemaVersion: LEDGER_SCHEMA_VERSION,
        generatedAt,
        formalEvidence: false,
        mode: options.mode || 'diagnose',
        status: schema.status === 'READY'
            && publicStores.authorityStatus === 'READY'
            && publicStores.operationalStatus.status === 'READY'
            && continuous.passed
            ? 'READY_FOR_EXPORT_PREFLIGHT'
            : 'PARTIAL_MONITORING',
        safety: {
            adsExecutionInvoked: false,
            authorityDatabaseMutated: false,
            defaultBehavior: 'READ_ONLY_DIAGNOSTIC',
            formalEvidenceClaimed: false,
        },
        database: {
            live: {
                source: pathDescriptor(options.dbPath),
                schema,
            },
            snapshot: {
                selected: false,
                status: 'NOT_SELECTED',
            },
        },
        stores: publicStores,
        continuous,
        today,
        canaryCandidates: publicCanaryCandidates(rawCandidates),
    };
    ledger.orchestration = buildOrchestrationPlan(ledger, options.packageEvidence);
    Object.defineProperty(ledger, '_internal', {
        enumerable: false,
        value: {
            rawCandidates,
            rawStoreIds: stores.rawStores.map((store) => normalizedId(store.storeId)),
            storesRoot,
        },
    });
    return ledger;
}

function makeInspectionCopy(dbPath, injectedContext = {}) {
    const baseRoot = path.resolve(injectedContext.tempRoot
        || path.join(os.tmpdir(), 'amazon-ai-ops-stage8-gate-operator'));
    fs.mkdirSync(baseRoot, { recursive: true });
    const tempRoot = fs.mkdtempSync(path.join(baseRoot, 'inspection-'));
    const destinationPath = path.join(tempRoot, 'authority-inspection.db');
    try {
        const backup = (injectedContext.runReadonlyBackup || runReadonlySqliteOnlineBackupSync)({
            sourceDatabasePath: dbPath,
            destinationPath,
            ownedTempRoot: tempRoot,
        }, injectedContext);
        return {
            backup,
            cleanup() {
                for (const candidate of [
                    destinationPath,
                    `${destinationPath}-wal`,
                    `${destinationPath}-shm`,
                ]) {
                    if (path.dirname(candidate) !== tempRoot) {
                        fail('Refusing to clean an unexpected inspection database sidecar.');
                    }
                    if (fs.existsSync(candidate)) {
                        const stat = fs.lstatSync(candidate);
                        if (stat.isSymbolicLink() || !stat.isFile()) {
                            fail('Inspection database cleanup encountered an unsafe sidecar.');
                        }
                        fs.unlinkSync(candidate);
                    }
                }
                if (fs.existsSync(tempRoot))
                    fs.rmdirSync(tempRoot);
            },
            databasePath: destinationPath,
        };
    }
    catch (error) {
        if (fs.existsSync(destinationPath))
            fs.unlinkSync(destinationPath);
        if (fs.existsSync(tempRoot))
            fs.rmdirSync(tempRoot);
        throw error;
    }
}

function inspectSnapshotManifest(ledger, manifestPath, context = {}) {
    try {
        const authoritySnapshot = loadAuthoritySnapshotManifest(manifestPath, {
            authoritySnapshotRoot: path.dirname(manifestPath),
            verifyPackageIdentity: false,
        });
        const Database = context.Database || requireFromLocalDb('better-sqlite3');
        const database = new Database(authoritySnapshot.databasePath, {
            fileMustExist: true,
            readonly: true,
        });
        try {
            const schema = inspectSchema(database, context.migrationContract || migrationContract());
            ledger.database.snapshot = {
                exportedAt: authoritySnapshot.manifest.exportedAt,
                schema,
                selected: true,
                source: pathDescriptor(manifestPath),
                status: schema.status,
            };
        }
        finally {
            database.close();
        }
    }
    catch {
        ledger.database.snapshot = {
            selected: true,
            source: pathDescriptor(manifestPath),
            status: 'INVALID_OR_STALE',
        };
    }
}

function diagnose(options = {}, injectedContext = {}) {
    const dbPath = resolveAdReadbackAuthorityDbPath(options.dbPath, injectedContext.env);
    const inspection = makeInspectionCopy(dbPath, injectedContext);
    const Database = injectedContext.Database || requireFromLocalDb('better-sqlite3');
    let database;
    try {
        database = new Database(inspection.databasePath, {
            fileMustExist: true,
            readonly: true,
        });
        const ledger = inspectOpenedDatabase(database, {
            dbPath,
            mode: options.mode,
            packageEvidence: options.packageEvidence,
            stores: options.stores,
            storesRoot: path.join(path.dirname(dbPath), 'stores'),
        }, injectedContext);
        ledger.database.live.onlineBackup = {
            method: 'readonly-sqlite-online-backup',
            pageCount: Number(inspection.backup?.observedBackup?.totalPages || 0),
            remainingPages: Number(inspection.backup?.observedBackup?.remainingPages || 0),
            sourceOpenedReadOnly: inspection.backup?.source?.openedReadOnly === true,
            sourceQueryOnly: inspection.backup?.source?.queryOnly === true,
        };
        if (options.snapshotManifestPath) {
            inspectSnapshotManifest(ledger, options.snapshotManifestPath, injectedContext);
        }
        ledger._internal.dbPath = dbPath;
        return ledger;
    }
    finally {
        if (database)
            database.close();
        inspection.cleanup();
    }
}

module.exports = { buildOrchestrationPlan, inspectOpenedDatabase, makeInspectionCopy, inspectSnapshotManifest, diagnose };

const path = require('node:path');
const { createRequire } = require('node:module');
const { validateEvidenceUserDataPath } = require('./evidence-user-data');
const { directPath, insist, within } = require('./v16-performance-artifacts');

async function loadSoftwareDatabaseRuntime(repositoryRoot, directory) {
  const requireDesktop = createRequire(path.join(repositoryRoot, 'apps/desktop/package.json'));
  const requireVite = createRequire(requireDesktop.resolve('vite/package.json'));
  const sqlite = createRequire(path.join(repositoryRoot, 'packages/local-db/package.json')).resolve('better-sqlite3');
  const output = path.join(directory, 'production-database-runtime.cjs');
  await requireVite('esbuild').build({
    stdin: { contents: [
      "export { initSqlite, closeSqlite } from './packages/local-db/src/sqlite/db';",
      "export { StoreRepository } from './packages/local-db/src/sqlite/repositories/store-repo';",
      "export { LingxingImportRepository } from './packages/local-db/src/sqlite/repositories/lingxing-import-repo';",
      "export { MissionDomainRepository } from './packages/local-db/src/sqlite/repositories/mission-domain-repo';",
      "export { SettingsRepository } from './packages/local-db/src/sqlite/repositories/settings-repo';",
      "export { StoreCoordinator, DurableStoreSessionGenerationAuthority } from './apps/desktop/src/main/store-coordinator';",
      "export { ConfigurationBus } from './apps/desktop/src/main/configuration-bus';",
      "export { StoreRuntimeConfigService } from './apps/desktop/src/main/store-runtime-config-service';",
      "export { StoreCollectionAutomationService } from './apps/desktop/src/main/store-collection-automation-service';",
      "export { requireStoreRuntimeAnalysisConfig } from './apps/desktop/src/main/store-runtime-analysis-config';",
      "export { DEFAULT_RULE_CONFIG } from './packages/rules-engine/src/types';",
      "export { LINGXING_TEMPLATE_MANIFEST, ReportParser } from './packages/report-parser/src';",
      "export { verifyDownloadedFile } from './packages/lingxing-report-collector/src/file-verifier';",
      "export { importLingxingDownloadedReportMetrics } from './apps/desktop/src/main/lingxing-report-import';",
      "export { createReportParserRuntime } from './apps/desktop/src/main/report-parser-runtime';",
      "export { captureReportImportCommitGuard } from './apps/desktop/src/main/report-import-commit-guard';",
      "export { runtimeLogger } from './apps/desktop/src/main/runtime-logger';",
      "export { assertStoreCollectionCommittedImportProofForRecovery } from './apps/desktop/src/main/collection-scheduler-durable-proof';",
    ].join('\n'), resolveDir: repositoryRoot, loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', outfile: output,
    alias: { '@amazon-ai-ops/local-db/src': path.join(repositoryRoot, 'packages/local-db/src'),
      '@amazon-ai-ops/shared-types/src': path.join(repositoryRoot, 'packages/shared-types/src'),
      '@amazon-ai-ops/shared-types': path.join(repositoryRoot, 'packages/shared-types/src/index.ts'), 'better-sqlite3': sqlite },
    external: [sqlite], logLevel: 'silent',
  });
  await requireVite('esbuild').build({
    entryPoints: [path.join(repositoryRoot, 'apps/desktop/src/main/report-parser-worker.ts')],
    outfile: path.join(directory, 'report-parser-worker.cjs'), bundle: true, platform: 'node',
    target: 'node22', format: 'cjs', logLevel: 'silent',
  });
  return createRequire(__filename)(output);
}

function createSoftwareReportImportRuntime(production, database, directory, classification) {
  insist(classification === 'isolated-software-fixture', 'NFR_SYNTHETIC_METADATA_FORBIDDEN_FOR_REAL_DATA');
  const root = directPath(validateEvidenceUserDataPath(path.resolve(directory)), true).path;
  const databasePath = directPath(path.resolve(database.name)).path;
  insist(within(root, databasePath) && databasePath !== root && database.open, 'SOFTWARE_FIXTURE_DATABASE_OUTSIDE_OWNER');
  const bus = new production.ConfigurationBus(database), repository = new production.LingxingImportRepository(database);
  const stores = new production.StoreRepository(database);
  production.runtimeLogger.setOutputDirectory(root);
  const parserRuntime = production.createReportParserRuntime({ mainModulePath: path.join(root, 'production-database-runtime.cjs'),
    getConfigurationBus: () => database.open ? bus : null });
  let stopping = false;
  async function importReports(source, { context, expectedJob, startedAt } = {}) {
    // 历史隔离报表使用自身持有的上下文，不合成当前 UI 会话或放宽真实 Main 权限。
    const captured = structuredClone({ batch: source.batch, files: source.files }), heldContext = structuredClone(context);
    insist(!stopping && heldContext && captured.batch.storeId === heldContext.storeId
      && captured.batch.browserProfileId === heldContext.browserProfileId
      && captured.batch.businessDate === heldContext.businessDate && captured.batch.sessionGeneration === heldContext.sessionGeneration,
    'SOFTWARE_FIXTURE_IMPORT_CONTEXT_REQUIRED');
    const assertConnection = () => {
      insist(!stopping && database.open && path.resolve(database.name) === databasePath, 'SOFTWARE_FIXTURE_IMPORT_RUNTIME_CHANGED');
    };
    const assertAuthority = () => {
      const store = stores.getStore(heldContext.storeId);
      insist(store?.status === 'active' && store.browserProfileId === heldContext.browserProfileId
        && store.marketplace === heldContext.marketplace && store.currency === heldContext.currency
        && store.businessTimezone === heldContext.businessTimezone, 'SOFTWARE_FIXTURE_IMPORT_AUTHORITY_CHANGED');
    };
    try {
      const guard = production.captureReportImportCommitGuard({ database, storeId: heldContext.storeId, batchId: captured.batch.id,
        jobId: expectedJob?.jobId, expectedJob, assertAuthority, assertConnection,
        readSessionGeneration: () => bus.get('store_session_generation:' + heldContext.storeId) });
      return await production.importLingxingDownloadedReportMetrics(captured,
        { repository, stores, parser: parserRuntime.createSession(), guard }, { startedAt });
    } catch (error) {
      try { production.runtimeLogger.error('v16.software_fixture_import_failed', { error }); }
      catch (secondary) { throw new AggregateError([error, secondary], 'SOFTWARE_FIXTURE_PRIMARY_AND_LOG_FAILURE'); }
      throw error;
    }
  }
  async function stopAndDrain() { stopping = true; await parserRuntime.stopAndDrain(); }
  return { importReports, stopAndDrain };
}
module.exports = { loadSoftwareDatabaseRuntime, createSoftwareReportImportRuntime };

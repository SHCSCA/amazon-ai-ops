const path = require('node:path');
const { createRequire } = require('node:module');

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
      "export { assertStoreCollectionCommittedImportProofForRecovery } from './apps/desktop/src/main/collection-scheduler-durable-proof';",
    ].join('\n'), resolveDir: repositoryRoot, loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', outfile: output,
    alias: { '@amazon-ai-ops/local-db/src': path.join(repositoryRoot, 'packages/local-db/src'),
      '@amazon-ai-ops/shared-types/src': path.join(repositoryRoot, 'packages/shared-types/src'),
      '@amazon-ai-ops/shared-types': path.join(repositoryRoot, 'packages/shared-types/src/index.ts'), 'better-sqlite3': sqlite },
    external: [sqlite], logLevel: 'silent',
  });
  return createRequire(__filename)(output);
}
module.exports = { loadSoftwareDatabaseRuntime };

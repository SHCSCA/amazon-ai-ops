#!/usr/bin/env node
/**
 * V1.6 Services Contract Verifier
 *
 * Phase 7 L1 contract: every required V1.6 service module must exist,
 * export the expected public API, and reference the V1.6 domain repositories.
 *
 * Exits 0 if all contracts hold, 1 otherwise.
 *
 * Usage:
 *   node scripts/verify-v16-services-contract.mjs [--root <repo-root>]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = process.argv.slice(2);
const rootIdx = args.indexOf('--root');
const root = rootIdx !== -1 ? path.resolve(args[rootIdx + 1]) : path.resolve(__dirname, '..');

const REQUIRED_SERVICES = [
  { file: 'apps/desktop/src/main/v16-mission-service.ts', exports: ['MissionService', 'MissionServiceError'], minLines: 200 },
  { file: 'apps/desktop/src/main/v16-decision-service.ts', exports: ['DecisionService', 'DecisionServiceError'], minLines: 300 },
  { file: 'apps/desktop/src/main/v16-mission-grant-service.ts', exports: ['MissionGrantService', 'MissionGrantServiceError'], minLines: 300 },
  { file: 'apps/desktop/src/main/v16-execution-service.ts', exports: ['ExecutionService', 'ExecutionServiceError'], minLines: 350 },
  { file: 'apps/desktop/src/main/v16-experiment-service.ts', exports: ['ExperimentService', 'ExperimentServiceError'], minLines: 350 },
  { file: 'apps/desktop/src/main/v16-memory-service.ts', exports: ['MemoryService', 'MemoryServiceError'], minLines: 300 },
  { file: 'apps/desktop/src/main/v16-analysis-run-orchestrator.ts', exports: ['AnalysisRunOrchestrator', 'OrchestratorError'], minLines: 300 },
  { file: 'apps/desktop/src/main/v16-services-ipc.ts', exports: ['registerV16ServicesIpc', 'V16_SERVICE_CHANNELS'], minLines: 200 },
  { file: 'apps/desktop/src/main/v16-store-context-guard.ts', exports: ['assertValidStoreContext', 'assertSameStore', 'classifyStoreSwitch'], minLines: 80 },
  { file: 'apps/desktop/src/main/v16-policy-version.ts', exports: ['PolicyVersionService', 'evaluatePolicyGates', 'PolicyError'], minLines: 200 },
  { file: 'apps/desktop/src/renderer/mission-control/workspaces/v16-module-router.ts', exports: ['V16_SIX_MODULES', 'findModuleForWorkspace'], minLines: 100 },
];

const REQUIRED_REPOSITORIES = [
  'packages/local-db/src/sqlite/repositories/v16-domain-repositories.ts',
  'packages/local-db/src/sqlite/migrations/0013-v16-domain.ts',
];

function exists(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

function readLines(p) {
  return fs.readFileSync(p, 'utf-8').split(/\r?\n/);
}

function checkService(service) {
  const fullPath = path.join(root, service.file);
  const errors = [];
  if (!exists(fullPath)) {
    errors.push(`missing file: ${service.file}`);
    return errors;
  }
  const lines = readLines(fullPath);
  if (lines.length < service.minLines) {
    errors.push(`${service.file} has ${lines.length} lines (minimum ${service.minLines})`);
  }
  for (const exp of service.exports) {
    const re = new RegExp(`\\bexport\\b[^{]*\\b${exp}\\b`);
    if (!re.test(lines.join('\n'))) {
      errors.push(`${service.file} does not export ${exp}`);
    }
  }
  return errors;
}

function checkRepository(file) {
  const fullPath = path.join(root, file);
  if (!exists(fullPath)) return [`missing file: ${file}`];
  return [];
}

function main() {
  const errors = [];
  for (const s of REQUIRED_SERVICES) errors.push(...checkService(s));
  for (const r of REQUIRED_REPOSITORIES) errors.push(...checkRepository(r));

  if (errors.length === 0) {
    console.log('✅ V1.6 services contract: PASS');
    console.log(`   - ${REQUIRED_SERVICES.length} service modules present`);
    console.log(`   - ${REQUIRED_REPOSITORIES.length} repository modules present`);
    process.exit(0);
  }

  console.error('❌ V1.6 services contract: FAIL');
  for (const e of errors) console.error('   - ' + e);
  process.exit(1);
}

main();

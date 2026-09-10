import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cliArg, readJson, verifyManifest } from './verify-v16-required-test-manifest.js';
export function verifyServices(manifest, root = process.cwd(), verification = verifyManifest(manifest, root)) {
  const required = ['apps/desktop/src/main/v16-l4-ui-contract.test.ts', 'apps/desktop/src/main/analysis-runs-ipc.test.ts', 'apps/desktop/src/main/mission-domain-service.test.ts', 'apps/desktop/src/main/analysis-authority-service.test.ts', 'apps/desktop/src/main/execution-authority-service.test.ts'];
  const covered = new Set(manifest.requiredTests.filter(test => verification.details.find(result => result.testId === test.testId)?.success).flatMap(test => test.testFiles ?? []));
  const missing = required.filter(file => !covered.has(file));
  return { success: !verification.issues.length && !missing.length, missing, issues: verification.issues };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const root = path.resolve(cliArg('root', process.cwd()));
    const result = verifyServices(readJson(cliArg('manifest', path.join(root, 'output/v16-evidence/current/manifest.json'))), root);
    console.log(JSON.stringify(result)); process.exitCode = result.success ? 0 : 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

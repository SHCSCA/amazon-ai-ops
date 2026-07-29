import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  GATE_IDS,
  inspectCanonicalPackage,
} = require('./export-s7-delivery-bundle.js');

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

function writeJson(filePath, value) {
  return writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function artifact(filePath) {
  const stat = fs.statSync(filePath);
  return {
    sourcePath: filePath,
    sizeBytes: stat.size,
    sha256: sha256File(filePath),
  };
}

function gateEvidence(id, fixture) {
  if (id === 's7-continuous-operation') {
    const reportPath = writeFile(
      path.join(fixture.externalRoot, 'stores', 'store-a', 'reports', '2026-07-27', 'campaign.csv'),
      'store-a,2026-07-27,campaign\n',
    );
    const report = artifact(reportPath);
    return {
      kind: 's7-continuous-operation-evidence',
      schemaVersion: 's7-continuous-operation-evidence/v1',
      generatedAt: '2026-07-28T00:00:00.000Z',
      status: 'PASSED',
      passed: true,
      verifiedFileArtifacts: [{
        filePath: report.sourcePath,
        sizeBytes: report.sizeBytes,
        sha256: report.sha256,
      }],
    };
  }
  if (id === 'manual-canary' || id === 'policy-auto-canary') {
    const manual = id === 'manual-canary';
    const suffix = manual ? 'manual' : 'policy';
    const screenshotPath = writeFile(
      path.join(fixture.evidenceRoot, 'canary', `${suffix}-before.png`),
      Buffer.from(`png:${suffix}`),
    );
    const screenshot = artifact(screenshotPath);
    return {
      kind: 'mission-control-execution-canary-evidence',
      schemaVersion: 'mission-control-execution-canary-evidence/v1',
      generatedAt: '2026-07-28T00:10:00.000Z',
      status: 'PASSED',
      passed: true,
      mode: manual ? 'manual_approval' : 'policy_auto',
      scope: { storeId: manual ? 'store-a' : 'store-b', marketplace: 'US', currency: 'USD' },
      authority: {
        missionId: `mission-${suffix}`,
        missionGrantId: `grant-${suffix}`,
        batchId: `batch-${suffix}`,
        jobId: `job-${suffix}`,
        decisionId: `decision-${suffix}`,
      },
      execution: {
        status: 'succeeded',
        evidence: [{
          artifactPath: screenshot.sourcePath,
          contentSha256: screenshot.sha256,
          sizeBytes: screenshot.sizeBytes,
        }],
      },
    };
  }
  if (id === 'package-ui') {
    const screenshotPath = writeFile(
      path.join(fixture.evidenceRoot, 'package-ui', 'today.png'),
      Buffer.from('png:package-ui'),
    );
    const screenshot = artifact(screenshotPath);
    return {
      kind: 'package-ui-evidence',
      schemaVersion: 8,
      passed: true,
      screenshot: {
        path: screenshot.sourcePath,
        sizeBytes: screenshot.sizeBytes,
        sha256: screenshot.sha256,
      },
    };
  }
  return {
    kind: `fixture-${id}`,
    schemaVersion: 1,
    passed: true,
  };
}

export function createS7BundleFixture(passedCount) {
  if (!Number.isInteger(passedCount) || passedCount < 0 || passedCount > GATE_IDS.length) {
    throw new Error('passedCount must be from 0 through 8');
  }
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-s7-bundle-test-'));
  const rootDir = path.join(tempRoot, 'repo');
  const evidenceRoot = path.join(rootDir, 'output', 'codex-evidence');
  const externalRoot = path.join(tempRoot, 'external');
  const releaseRoot = path.join(rootDir, 'apps', 'desktop', 'release');
  const appContentPath = path.join(releaseRoot, 'win-unpacked', 'resources', 'app');
  writeFile(
    path.join(releaseRoot, 'win-unpacked', 'AmazonAIOpsAgent.exe'),
    'fixture-executable',
  );
  writeJson(path.join(appContentPath, 'package.json'), {
    name: '@amazon-ai-ops/desktop',
    version: '1.5.0',
    main: 'dist/main/index.js',
  });
  writeFile(path.join(appContentPath, 'dist', 'main', 'index.js'), 'fixture-main');
  writeFile(path.join(appContentPath, 'dist', 'preload', 'index.js'), 'fixture-preload');
  writeFile(path.join(appContentPath, 'dist', 'renderer', 'index.html'), '<!doctype html>');
  writeFile(
    path.join(appContentPath, 'playwright-browsers', 'chrome-win64', 'chrome.exe'),
    'fixture-chromium',
  );
  writeJson(path.join(rootDir, 'package.json'), { name: 'fixture-root', private: true });
  const canonicalPackage = inspectCanonicalPackage({ releaseRoot });

  const authorityDbPath = writeFile(path.join(externalRoot, 'amazon-ai-ops.db'), 'live-db');
  const snapshotDbPath = writeFile(path.join(evidenceRoot, 'authority', 'authority-snapshot.db'), 'snapshot-db');
  const snapshotArtifact = artifact(snapshotDbPath);
  const snapshotManifestPath = path.join(evidenceRoot, 'authority', 'snapshot-manifest.json');
  writeJson(snapshotManifestPath, {
    kind: 'mission-control-authority-database-snapshot',
    schemaVersion: 'mission-control-authority-database-snapshot/v2',
    exportedAt: '2026-07-28T00:20:00.000Z',
    backup: {
      method: 'sqlite-online-backup',
      startedAt: '2026-07-28T00:19:59.000Z',
      completedAt: '2026-07-28T00:20:00.000Z',
      completed: true,
      totalPages: 1,
      remainingPages: 0,
    },
    source: {
      absolutePath: authorityDbPath,
      realPath: authorityDbPath,
      openedReadOnly: true,
      queryOnly: true,
      integrityCheck: ['ok'],
      foreignKeyCheck: [],
    },
    snapshot: {
      absolutePath: snapshotDbPath,
      realPath: snapshotDbPath,
      openedReadOnly: true,
      queryOnly: true,
      integrityCheck: ['ok'],
      foreignKeyCheck: [],
      sha256: snapshotArtifact.sha256,
      sizeBytes: snapshotArtifact.sizeBytes,
    },
    packageIdentity: canonicalPackage.identity,
  });

  const fixture = { evidenceRoot, externalRoot };
  const selectedPaths = {};
  const gates = [];
  for (const [index, id] of GATE_IDS.entries()) {
    const evidencePath = path.join(evidenceRoot, 'gates', `${id}.json`);
    writeJson(evidencePath, gateEvidence(id, fixture));
    const ok = index < passedCount;
    selectedPaths[id] = evidencePath;
    gates.push({
      id,
      name: `Fixture ${id}`,
      status: ok ? 'passed' : 'needs_work',
      ok,
      evidencePath,
      reason: ok ? 'Evidence passed its production contract.' : 'Fixture gate intentionally needs work.',
    });
  }
  const ready = passedCount === GATE_IDS.length;
  const currentnessCaptures = ['after-snapshot-selection', 'before-final-report-write', 'after-final-report-write']
    .map((captureLabel) => ({
      captureLabel,
      capturedAt: '2026-07-28T00:25:00.000Z',
      method: 'readonly-sqlite-online-backup',
      sourceReadOnly: true,
      observedSnapshot: {
        sha256: snapshotArtifact.sha256,
        sizeBytes: snapshotArtifact.sizeBytes,
      },
      matchesSelectedSnapshot: true,
    }));
  const readiness = {
    kind: 'mission-control-production-readiness',
    schemaVersion: 'mission-control-production-readiness/v1',
    generatedAt: '2026-07-28T00:30:00.000Z',
    status: ready ? 'APP_READY' : 'APP_NEEDS_WORK',
    appReady: ready,
    allGatesPass: ready,
    inputContractPassed: true,
    evidenceSelection: {
      explicitOnly: true,
      latestFallbackUsed: false,
      selectedPaths,
      authorityDb: authorityDbPath,
      authoritySnapshotManifest: snapshotManifestPath,
    },
    authoritySnapshot: {
      ok: true,
      evidencePath: snapshotManifestPath,
      reason: 'Evidence passed its production contract.',
      currentness: {
        schemaVersion: 'sqlite-authority-currentness-proof/v1',
        method: 'readonly-sqlite-online-backup',
        passed: true,
        expectedSnapshot: {
          sha256: snapshotArtifact.sha256,
          sizeBytes: snapshotArtifact.sizeBytes,
        },
        captures: currentnessCaptures,
        failures: [],
      },
    },
    packageIdentity: canonicalPackage.identity,
    inputErrors: [],
    summary: {
      total: GATE_IDS.length,
      passed: passedCount,
      failed: GATE_IDS.length - passedCount,
    },
    gates,
    failures: gates
      .filter((gate) => !gate.ok)
      .map((gate) => ({
        gateId: gate.id,
        evidencePath: gate.evidencePath,
        reason: gate.reason,
      })),
  };
  const readinessPath = writeJson(
    path.join(evidenceRoot, `mission-readiness-${passedCount}-of-8.json`),
    readiness,
  );
  const readmePath = writeFile(
    path.join(rootDir, 'README.md'),
    ready ? '**DELIVERY: APP_READY**\n' : '**DELIVERY: APP_NEEDS_WORK**\n',
  );
  const outDir = path.join(tempRoot, `bundle-${passedCount}-of-8`);
  const readinessRunner = (report) => ({
    exitCode: report.appReady ? 0 : 1,
    report: structuredClone(report),
    stdout: '',
    stderr: '',
  });
  return {
    canonicalPackage,
    cleanup: () => fs.rmSync(tempRoot, { recursive: true, force: true }),
    evidenceRoot,
    outDir,
    readiness,
    readinessPath,
    readinessRunner,
    readmePath,
    releaseRoot,
    rootDir,
    snapshotDbPath,
    snapshotManifestPath,
    tempRoot,
  };
}

export function rewriteJson(filePath, mutate) {
  const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  mutate(value);
  writeJson(filePath, value);
  return value;
}

import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'url';
import {
  createValidAdReadbackEvidence,
  writeAdReadbackAuthorityDb,
} from './ad-readback-authority-db.test-fixture.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const evidenceDir = path.join(root, 'output', 'codex-evidence');
const bundleRoot = path.join(root, 'output', 'delivery-bundles');

function runNode(script, args = []) {
  return spawnSync(process.execPath, [path.join(root, script), ...args], {
    cwd: root,
    encoding: 'utf8',
  });
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeValidReadbackWithDb(fixtureDir, evidencePath) {
  const evidence = createValidAdReadbackEvidence(fixtureDir);
  writeJson(evidencePath, evidence);
  return writeAdReadbackAuthorityDb(path.join(fixtureDir, 'authority-db'), evidence);
}

function writeReadme(filePath, status = 'IN_PROGRESS') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `# Fixture\n\n**DELIVERY: ${status}.** Fixture README for non-ready safety tests.\n`, 'utf8');
  return filePath;
}

function writePng(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(path.basename(filePath), 'utf8'),
  ]));
  return filePath;
}

function writeReport(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, 'placeholder report file for non-ready safety readback verifier\n', 'utf8');
  return filePath;
}

function sha256Text(content) {
  return crypto.createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex').toUpperCase();
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function finalPackageIndex(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const installerContent = 'installer package fixture\n';
  const portableContent = 'portable package fixture\n';
  const installerPath = path.join(dir, 'AmazonAIOpsAgent-1.5.0.exe');
  const portablePath = path.join(dir, 'AmazonAIOpsAgent-1.5.0-portable.exe');
  fs.writeFileSync(installerPath, installerContent, 'utf8');
  fs.writeFileSync(portablePath, portableContent, 'utf8');
  const installerStat = fs.statSync(installerPath);
  const portableStat = fs.statSync(portablePath);
  return {
    generatedAt: '2026-07-16T08:06:00.000Z',
    present: true,
    count: 2,
    existingCount: 2,
    missingCount: 0,
    releaseDir: dir,
    error: null,
    copyPolicy: 'Installer and portable EXE binaries are not copied into readiness evidence; this index records local paths, existence, size, and SHA-256.',
    packages: [
      {
        kind: 'installer',
        sourcePath: installerPath,
        fileName: 'AmazonAIOpsAgent-1.5.0.exe',
        exists: true,
        sizeBytes: Buffer.byteLength(installerContent, 'utf8'),
        sha256: sha256Text(installerContent),
        modifiedAt: installerStat.mtime.toISOString(),
      },
      {
        kind: 'portable',
        sourcePath: portablePath,
        fileName: 'AmazonAIOpsAgent-1.5.0-portable.exe',
        exists: true,
        sizeBytes: Buffer.byteLength(portableContent, 'utf8'),
        sha256: sha256Text(portableContent),
        modifiedAt: portableStat.mtime.toISOString(),
      },
    ],
  };
}

function validPackageLaunchSmoke(dir, portablePackage) {
  const unpackedContent = 'unpacked exe fixture\n';
  const portableContent = 'portable exe fixture\n';
  const unpackedPath = path.join(dir, 'win-unpacked', 'AmazonAIOpsAgent.exe');
  const portablePath = portablePackage?.sourcePath || path.join(dir, 'AmazonAIOpsAgent-1.5.0-portable.exe');
  fs.mkdirSync(path.dirname(unpackedPath), { recursive: true });
  fs.writeFileSync(unpackedPath, unpackedContent, 'utf8');
  if (!portablePackage) fs.writeFileSync(portablePath, portableContent, 'utf8');
  return {
    kind: 'package-launch-smoke',
    generatedAt: '2026-07-16T08:07:10.078Z',
    passed: true,
    artifacts: {
      unpacked: {
        path: unpackedPath,
        sizeBytes: Buffer.byteLength(unpackedContent, 'utf8'),
        sha256: sha256Text(unpackedContent),
      },
      portable: {
        path: portablePath,
        sizeBytes: portablePackage?.sizeBytes || Buffer.byteLength(portableContent, 'utf8'),
        sha256: portablePackage?.sha256 || sha256Text(portableContent),
      },
    },
    checks: [
      { kind: 'win-unpacked', ok: true, marker: '[App] ipc-ready' },
      { kind: 'portable', ok: true, appChildCount: 1 },
    ],
  };
}

function validProcessIsolation(profilePath = null) {
  const snapshot = {
    error: null,
    matching: [],
    matchingCount: 0,
    observedCount: 0,
    passed: true,
    unresolved: [],
    unresolvedCount: 0,
    ...(profilePath ? { profilePath } : {}),
  };
  return {
    before: snapshot,
    after: { ...snapshot, attempts: 1 },
    passed: true,
  };
}

function validRunDiagnostics(profileId) {
  return {
    cleanupErrors: [],
    completedAt: '2026-07-16T08:08:20.000Z',
    failure: null,
    login: {
      attempts: [],
      completedAt: '2026-07-16T08:08:10.000Z',
      outcome: 'existing-authenticated-session',
      savedCredentials: null,
      startedAt: '2026-07-16T08:08:09.000Z',
    },
    phase: 'completed',
    profileId,
    renderer: {
      consoleErrors: [],
      droppedCount: { consoleErrors: 0, pageErrors: 0 },
      limits: { consoleErrors: 100, pageErrors: 100 },
      pageErrors: [],
    },
    schemaVersion: 'package-ui-run-diagnostics/v1',
    startedAt: '2026-07-16T08:08:00.000Z',
    timeline: [
      { at: '2026-07-16T08:08:00.000Z', phase: 'created' },
      { at: '2026-07-16T08:08:20.000Z', phase: 'completed' },
    ],
  };
}

function validPackageUiEvidence(dir, smoke, authorityDbPath) {
  const protectedDbStat = fs.statSync(authorityDbPath);
  const protectedDatabaseArtifact = {
    path: authorityDbPath,
    sha256: sha256File(authorityDbPath),
    sizeBytes: protectedDbStat.size,
    mtime: protectedDbStat.mtime.toISOString(),
    mtimeMs: protectedDbStat.mtimeMs,
  };
  const appContentPath = path.join(dir, 'release', 'win-unpacked', 'resources', 'app');
  const profileDatabasePath = path.join(dir, 'profile', 'amazon-ai-ops.db');
  const profileBrowserUserDataDir = path.join(path.dirname(profileDatabasePath), 'storage', 'browser-data');
  fs.mkdirSync(path.dirname(profileDatabasePath), { recursive: true });
  fs.copyFileSync(authorityDbPath, profileDatabasePath);
  const profileDatabaseArtifact = {
    path: profileDatabasePath,
    sha256: sha256File(profileDatabasePath),
    sizeBytes: fs.statSync(profileDatabasePath).size,
  };
  const appContentSha256 = 'A'.repeat(64);
  const appContentArtifact = {
    kind: 'unpacked-app-content-manifest',
    rootPath: appContentPath,
    fileCount: 1,
    totalSizeBytes: 1,
    sha256: appContentSha256,
  };
  const run = (scalePercent, deviceScaleFactor) => ({
    actualDeviceScaleFactor: deviceScaleFactor,
    consoleErrors: [],
    diagnostics: validRunDiagnostics(`${scalePercent}-compact`),
    overlayChecks: Array.from({ length: 3 }, (_, index) => ({ id: `overlay-${index + 1}`, passed: true })),
    packageProcessIsolation: validProcessIsolation(),
    pageErrors: [],
    passed: true,
    profileProcessIsolation: validProcessIsolation(profileBrowserUserDataDir),
    scalePercent,
    screenshots: Array.from({ length: 8 }, (_, index) => ({ workspace: `workspace-${index + 1}` })),
    viewport: { width: 1200, height: 700 },
    viewportContract: { passed: true, violations: [] },
    workspaceChecks: Array.from({ length: 8 }, (_, index) => ({ workspace: `workspace-${index + 1}`, passed: true })),
  });
  const wideWorkspaceCheck = (workspace) => ({
    workspace,
    passed: true,
    experienceEvidence: { passed: true },
    inspectorEvidence: {
      passed: true,
      inspector: { mode: 'inline', ariaModal: null },
      screenshot: { sha256: 'D'.repeat(64) },
    },
  });
  return {
    kind: 'package-ui-evidence',
    schemaVersion: 5,
    generatedAt: '2026-07-16T08:08:00.000Z',
    completedAt: '2026-07-16T08:09:00.000Z',
    passed: true,
    violations: [],
    requested: {
      appContentPath,
      executablePath: smoke.artifacts.unpacked.path,
      expectedAppContentSha256: appContentSha256,
      expectedExeSha256: smoke.artifacts.unpacked.sha256,
      evidenceMode: 'package-ui',
      protectedDatabasePath: authorityDbPath,
      profileBrowserUserDataDir,
      userDataDir: path.dirname(profileDatabasePath),
      scales: [
        { scalePercent: 100, deviceScaleFactor: 1 },
        { scalePercent: 125, deviceScaleFactor: 1.25 },
      ],
      viewport: { width: 1200, height: 700 },
      wideProfile: {
        id: 'wide-1400x900-100',
        viewport: { width: 1400, height: 900 },
        deviceScaleFactor: 1,
      },
    },
    runs: [run(100, 1), run(125, 1.25)],
    wideProfile: {
      actualDeviceScaleFactor: 1,
      consoleErrors: [],
      diagnostics: validRunDiagnostics('wide-1400x900-100'),
      identity: { passed: true, violations: [] },
      packageProcessIsolation: validProcessIsolation(),
      pageErrors: [],
      passed: true,
      profileId: 'wide-1400x900-100',
      profileProcessIsolation: validProcessIsolation(profileBrowserUserDataDir),
      screenshots: [
        { workspace: 'product', sha256: 'E'.repeat(64) },
        { workspace: 'diagnosis', sha256: 'F'.repeat(64) },
      ],
      viewport: { width: 1400, height: 900 },
      viewportContract: { passed: true, violations: [] },
      workspaceChecks: [wideWorkspaceCheck('product'), wideWorkspaceCheck('diagnosis')],
    },
    protectedDatabase: {
      before: protectedDatabaseArtifact,
      after: protectedDatabaseArtifact,
      passed: true,
      unchanged: true,
    },
    profileDatabaseProvenance: {
      hashMatches: true,
      passed: true,
      pathsDistinct: true,
      profileDatabase: profileDatabaseArtifact,
      protectedDatabase: protectedDatabaseArtifact,
      sizeMatches: true,
      violations: [],
    },
    packageProcessIsolation: validProcessIsolation(),
    profileProcessIsolation: validProcessIsolation(profileBrowserUserDataDir),
    artifactsBefore: {
      exe: smoke.artifacts.unpacked,
      appContent: appContentArtifact,
    },
    artifactsAfter: {
      exe: smoke.artifacts.unpacked,
      appContent: appContentArtifact,
    },
    artifactHashesStable: true,
    freshness: { passed: true, violations: [] },
    completeness: { passed: true, violations: [] },
  };
}

const strictNonReadyGates = () => [
  { id: 'report-collection-delivery', name: 'Report collection delivery', ok: true, status: 'passed' },
  { id: 'lingxing-listing-full-read', name: 'Lingxing Listing full read', ok: true, status: 'passed' },
  { id: 'ai-live-provider', name: 'AI live provider', ok: true, status: 'passed' },
  { id: 'ad-recommendation-ai-explanation', name: 'Ad recommendation AI explanation', ok: true, status: 'passed' },
  { id: 'listing-ai-draft', name: 'Listing AI draft', ok: true, status: 'passed' },
  { id: 'real-ad-execution-readback', name: 'Real ad execution readback', ok: false, status: 'needs_work' },
  { id: 'release-package-hash', name: 'Release package hash', ok: true, status: 'passed' },
  { id: 'package-launch-smoke', name: 'Package launch smoke', ok: true, status: 'passed' },
];

function writeStrictNonReadyFixture(options) {
  const {
    artifactDir,
    evidenceManifest,
    finalReadiness,
    packageSmoke,
    packageUiManifest = path.join(artifactDir, 'package-ui-manifest.json'),
    bundleManifest,
    readme,
    mutateFinalReadiness = () => {},
  } = options;
  fs.mkdirSync(artifactDir, { recursive: true });
  const packageIndex = finalPackageIndex(path.join(artifactDir, 'release'));
  const portablePackage = packageIndex.packages.find((item) => item.kind === 'portable');
  const smoke = validPackageLaunchSmoke(path.join(artifactDir, 'release'), portablePackage);
  const authorityDbPath = path.join(artifactDir, 'authority.db');
  fs.writeFileSync(authorityDbPath, 'authority database identity fixture\n', 'utf8');
  writeReadme(readme);
  writeJson(evidenceManifest, { kind: 'v15-final-readiness-evidence-manifest', evidence: {} });
  writeJson(packageSmoke, smoke);
  const packageUi = validPackageUiEvidence(artifactDir, smoke, authorityDbPath);
  writeJson(packageUiManifest, packageUi);
  const finalReadinessJson = {
    status: 'APP_NEEDS_WORK',
    appReady: false,
    reportCollectionReady: true,
    listingReadReady: true,
    evidenceSelection: {
      mode: 'manifest',
      manifestPath: evidenceManifest,
      authorityDbPath,
    },
    packageIndex,
    packageLaunchSmoke: {
      present: true,
      evidencePath: packageSmoke,
      selectedBy: 'explicit-arg',
      generatedAt: smoke.generatedAt,
      passed: true,
      artifacts: smoke.artifacts,
      checks: smoke.checks,
    },
    gates: strictNonReadyGates(),
  };
  finalReadinessJson.gates.find((gate) => gate.id === 'package-launch-smoke').evidencePath = packageSmoke;
  mutateFinalReadiness(finalReadinessJson);
  writeJson(finalReadiness, finalReadinessJson);
  const bundlePackageIndexPath = path.join(path.dirname(bundleManifest), 'evidence', 'release-package-index.json');
  const bundledPackageUiManifestPath = path.join(path.dirname(bundleManifest), 'evidence', 'package-ui-manifest.json');
  writeJson(bundlePackageIndexPath, {
    generatedAt: packageIndex.generatedAt,
    releaseDir: packageIndex.releaseDir,
    copyPolicy: 'Installer and portable EXE binaries are not copied into the delivery bundle; this index records local paths, existence, size, and SHA-256.',
    packages: packageIndex.packages,
  });
  writeJson(bundledPackageUiManifestPath, packageUi);
  writeJson(bundleManifest, {
    status: 'APP_NEEDS_WORK',
    appReady: false,
    warning: 'Do not present this bundle as final READY until every gate passes.',
    authorityDatabase: {
      sourcePath: authorityDbPath,
      existsAtExport: true,
      copied: false,
    },
    files: [
      {
        label: 'release-package-index',
        sourcePath: 'generated',
        bundlePath: path.relative(path.dirname(bundleManifest), bundlePackageIndexPath),
        sizeBytes: fs.statSync(bundlePackageIndexPath).size,
        sha256: sha256File(bundlePackageIndexPath),
      },
      {
        label: 'evidence:package-ui-manifest.json',
        sourcePath: packageUiManifest,
        bundlePath: path.relative(path.dirname(bundleManifest), bundledPackageUiManifestPath),
        sizeBytes: fs.statSync(bundledPackageUiManifestPath).size,
        sha256: sha256File(bundledPackageUiManifestPath),
      },
    ],
    packageIndex: {
      present: true,
      count: packageIndex.count,
      existingCount: packageIndex.existingCount,
      missingCount: packageIndex.missingCount,
      bundleJson: path.relative(path.dirname(bundleManifest), bundlePackageIndexPath),
    },
    uiEvidence: {
      packageUiManifest: {
        sourcePath: packageUiManifest,
        present: true,
      },
    },
  });
  return {
    authorityDbPath,
    bundledPackageUiManifestPath,
    bundlePackageIndexPath,
    packageIndex,
    packageUi,
    packageUiManifest,
    smoke,
  };
}

function runStrictNonReadySafetyFixture(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-non-ready-strict-'));
  const paths = {
    evidenceManifest: path.join(dir, 'evidence-manifest.json'),
    finalReadiness: path.join(dir, 'final-readiness.json'),
    packageSmoke: path.join(dir, 'package-launch-smoke.json'),
    packageUiManifest: path.join(dir, 'package-ui-manifest.json'),
    bundleManifest: path.join(dir, 'delivery-bundle-manifest.json'),
    readme: path.join(dir, 'README.md'),
  };
  try {
    const fixture = writeStrictNonReadyFixture({
      artifactDir: dir,
      ...paths,
      mutateFinalReadiness: options.mutateFinalReadiness,
    });
    const context = { dir, paths, fixture };
    options.mutateAfterWrite?.(context);
    const extraArgs = typeof options.extraArgs === 'function'
      ? options.extraArgs(context)
      : options.extraArgs || [];
    return runNode('scripts/verify-v15-non-ready-safety.js', [
      '--final-readiness', paths.finalReadiness,
      '--bundle-manifest', paths.bundleManifest,
      '--package-launch-smoke', paths.packageSmoke,
      ...(options.omitPackageUiManifest ? [] : ['--package-ui-manifest', paths.packageUiManifest]),
      '--readme', paths.readme,
      ...extraArgs,
    ]);
  } finally {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
}

function mutatePackageUiFixture(context, mutate) {
  const packageUi = JSON.parse(fs.readFileSync(context.paths.packageUiManifest, 'utf8'));
  mutate(packageUi);
  writeJson(context.paths.packageUiManifest, packageUi);
  writeJson(context.fixture.bundledPackageUiManifestPath, packageUi);
  const bundle = JSON.parse(fs.readFileSync(context.paths.bundleManifest, 'utf8'));
  const packageUiFile = bundle.files.find((file) => file.sourcePath === context.paths.packageUiManifest);
  packageUiFile.sizeBytes = fs.statSync(context.fixture.bundledPackageUiManifestPath).size;
  packageUiFile.sha256 = sha256File(context.fixture.bundledPackageUiManifestPath);
  writeJson(context.paths.bundleManifest, bundle);
}

function validReadbackEvidence(dir) {
  const now = '2026-06-10T00:00:00.000Z';
  return {
    schemaVersion: 2,
    kind: 'real-ad-execution-readback',
    status: 'PASS',
    createdAt: now,
    authority: {
      recommendationId: 1,
      recommendationRevision: 1,
      recommendationStatusAtExport: 'approved',
      dateFrom: '2026-06-01',
      dateTo: '2026-06-10',
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      asin: 'B0TESTASIN',
      batchId: 'batch_1',
      checkedAt: now,
    },
    realWriteApproved: true,
    safety: {
      full8Started: false,
      listingAiDraftOnly: false,
      adWriteActionsPerformed: true,
    },
    approval: {
      operatorConfirmed: true,
      scope: 'FT-US-US / US / Campaign A / Ad Group A / close match / lower_bid',
      confirmedAt: now,
      approverName: 'Ops Owner',
      approvalArtifactPath: 'approval-ticket-123',
    },
    target: {
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      asin: 'B0TESTASIN',
      campaignName: 'Campaign A',
      adGroupName: 'Ad Group A',
      entityType: 'keyword',
      entityId: 'keyword-123',
      entityName: 'close match',
      identityProofPath: writePng(path.join(dir, 'target-identity.png')),
      actionType: 'lower_bid',
    },
    risk: {
      level: 'low',
      allowedByPolicy: true,
      rationale: 'Small reversible bid decrease on one target.',
    },
    before: {
      value: '2.40',
      capturedAt: now,
      screenshotPath: writePng(path.join(dir, 'before.png')),
      liveBidSourceNote: 'Read from Ads UI editable target bid cell before manual change.',
    },
    after: {
      value: '2.16',
      capturedAt: now,
      screenshotPath: writePng(path.join(dir, 'after.png')),
    },
    readback: {
      verified: true,
      method: 'Ads UI reload target row',
      readAt: now,
      actualValue: '2.16',
      evidencePath: writePng(path.join(dir, 'readback.png')),
    },
    execution: {
      success: true,
      verified: true,
      executionId: 'manual-ads-ui-123',
      executedAt: now,
      channel: 'manual_ads_ui',
      performedBy: 'operator@example.com',
      appExecutorUsed: false,
    },
    source: {
      recommendationId: '1',
      recommendationRevision: 1,
      batchId: 'batch_1',
      sourceFiles: [writeReport(path.join(dir, 'user-search-term.xlsx'))],
      sourceRow: 12,
      evidencePath: 'output/codex-evidence/installed-ad-ai-explanation.json',
      entityType: 'search_term',
      currentValue: '2.40',
      recommendedValue: '2.16',
    },
  };
}

describe('verify v15 non-ready safety', () => {
  it('accepts the current IN_PROGRESS README delivery state as non-ready', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-non-ready-safety-'));
    const evidenceManifest = path.join(dir, 'evidence-manifest.json');
    const finalReadiness = path.join(dir, 'final-readiness.json');
    const packageSmoke = path.join(dir, 'package-launch-smoke.json');
    const packageUiManifest = path.join(dir, 'package-ui-manifest.json');
    const bundleManifest = path.join(dir, 'delivery-bundle-manifest.json');
    const readme = path.join(dir, 'README.md');

    writeStrictNonReadyFixture({
      artifactDir: dir,
      evidenceManifest,
      finalReadiness,
      packageSmoke,
      packageUiManifest,
      bundleManifest,
      readme,
    });

    const result = runNode('scripts/verify-v15-non-ready-safety.js', [
      '--final-readiness', finalReadiness,
      '--bundle-manifest', bundleManifest,
      '--package-launch-smoke', packageSmoke,
      '--package-ui-manifest', packageUiManifest,
      '--readme', readme,
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('final readiness has exactly 8 gates, 7 passed, and only real-ad-execution-readback needs work');
    expect(result.stdout).toContain('README top-level delivery line is non-ready');
    expect(result.stdout).toContain('NON_READY_SAFETY verified');
  });

  it('accepts a 125% package UI viewport within the recorded two-pixel tolerance', () => {
    const result = runStrictNonReadySafetyFixture({
      mutateAfterWrite(context) {
        mutatePackageUiFixture(context, (packageUi) => {
          const run125 = packageUi.runs.find((run) => run.scalePercent === 125);
          run125.viewport.height = 702;
          run125.viewportContract = {
            actual: { width: 1200, height: 702, deviceScaleFactor: 1.25 },
            delta: { width: 0, height: 2, deviceScaleFactor: 0 },
            passed: true,
            requested: { width: 1200, height: 700, deviceScaleFactor: 1.25 },
            tolerance: { width: 2, height: 2, deviceScaleFactor: 0.02 },
            violations: [],
          };
        });
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('NON_READY_SAFETY verified');
  });

  it('rejects a package UI viewport outside the recorded two-pixel tolerance', () => {
    const result = runStrictNonReadySafetyFixture({
      mutateAfterWrite(context) {
        mutatePackageUiFixture(context, (packageUi) => {
          const run125 = packageUi.runs.find((run) => run.scalePercent === 125);
          run125.viewport.height = 703;
          run125.viewportContract = {
            actual: { width: 1200, height: 703, deviceScaleFactor: 1.25 },
            delta: { width: 0, height: 3, deviceScaleFactor: 0 },
            passed: true,
            requested: { width: 1200, height: 700, deviceScaleFactor: 1.25 },
            tolerance: { width: 2, height: 2, deviceScaleFactor: 0.02 },
            violations: [],
          };
        });
      },
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('explicit package UI evidence is fresh, complete, hash-bound, DB-safe, process-isolated, and bundled');
  });

  it('rejects strict APP_NEEDS_WORK verification without an explicit package UI manifest', () => {
    const result = runStrictNonReadySafetyFixture({ omitPackageUiManifest: true });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('strict APP_NEEDS_WORK requires an explicit package UI manifest');
  });

  it('rejects APP_NEEDS_WORK when release package hash evidence is stale', () => {
    const result = runStrictNonReadySafetyFixture({
      mutateFinalReadiness(finalReadiness) {
        const portable = finalReadiness.packageIndex.packages.find((item) => item.kind === 'portable');
        portable.sha256 = '0'.repeat(64);
      },
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('release-package-hash gate is passed with current package index evidence');
    expect(`${result.stdout}${result.stderr}`).toContain('NEEDS_WORK');
  });

  it('rejects APP_NEEDS_WORK when the bundled release package index differs from final readiness', () => {
    const result = runStrictNonReadySafetyFixture({
      mutateAfterWrite({ paths, fixture }) {
        const bundleIndex = JSON.parse(fs.readFileSync(fixture.bundlePackageIndexPath, 'utf8'));
        bundleIndex.packages.find((item) => item.kind === 'portable').modifiedAt = '2000-01-01T00:00:00.000Z';
        writeJson(fixture.bundlePackageIndexPath, bundleIndex);
        const bundle = JSON.parse(fs.readFileSync(paths.bundleManifest, 'utf8'));
        const indexFile = bundle.files.find((file) => file.label === 'release-package-index');
        indexFile.sizeBytes = fs.statSync(fixture.bundlePackageIndexPath).size;
        indexFile.sha256 = sha256File(fixture.bundlePackageIndexPath);
        writeJson(paths.bundleManifest, bundle);
      },
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('bundle release-package-index exactly matches final readiness and current package files');
  });

  it('rejects APP_NEEDS_WORK when explicit package UI freshness failed', () => {
    const result = runStrictNonReadySafetyFixture({
      mutateAfterWrite(context) {
        mutatePackageUiFixture(context, (packageUi) => {
          packageUi.freshness = { passed: false, violations: [{ code: 'STALE_BUILD' }] };
        });
      },
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('explicit package UI evidence is fresh, complete, hash-bound, DB-safe, process-isolated, and bundled');
  });

  it('rejects APP_NEEDS_WORK when explicit package UI completeness failed', () => {
    const result = runStrictNonReadySafetyFixture({
      mutateAfterWrite(context) {
        mutatePackageUiFixture(context, (packageUi) => {
          packageUi.completeness = { passed: false, violations: [{ code: 'SCALE_RUN_MISSING' }] };
        });
      },
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('explicit package UI evidence is fresh, complete, hash-bound, DB-safe, process-isolated, and bundled');
  });

  it.each([
    ['schema is older than v5', (context) => {
      mutatePackageUiFixture(context, (packageUi) => {
        packageUi.schemaVersion = 4;
      });
    }],
    ['EXE hash is not bound to package smoke', (context) => {
      const alternateExe = path.join(context.dir, 'alternate-unpacked.exe');
      const content = 'alternate unpacked executable\n';
      fs.writeFileSync(alternateExe, content, 'utf8');
      const artifact = {
        path: alternateExe,
        sizeBytes: Buffer.byteLength(content, 'utf8'),
        sha256: sha256Text(content),
      };
      mutatePackageUiFixture(context, (packageUi) => {
        packageUi.requested.executablePath = alternateExe;
        packageUi.requested.expectedExeSha256 = artifact.sha256;
        packageUi.artifactsBefore.exe = artifact;
        packageUi.artifactsAfter.exe = artifact;
      });
    }],
    ['authority DB isolation is not preserved', (context) => {
      mutatePackageUiFixture(context, (packageUi) => {
        packageUi.protectedDatabase.unchanged = false;
      });
    }],
    ['package process isolation is not preserved', (context) => {
      mutatePackageUiFixture(context, (packageUi) => {
        packageUi.packageProcessIsolation.after.matchingCount = 1;
      });
    }],
    ['package process isolation omits strict v5 snapshot fields', (context) => {
      mutatePackageUiFixture(context, (packageUi) => {
        packageUi.packageProcessIsolation.before = {
          error: null,
          matchingCount: 0,
          passed: true,
          unresolvedCount: 0,
        };
      });
    }],
    ['package process isolation reports inconsistent snapshot counts', (context) => {
      mutatePackageUiFixture(context, (packageUi) => {
        packageUi.runs[0].packageProcessIsolation.after.matching = [{ processId: 42 }];
      });
    }],
    ['top-level profile browser isolation is not preserved', (context) => {
      mutatePackageUiFixture(context, (packageUi) => {
        packageUi.profileProcessIsolation.after.matchingCount = 1;
      });
    }],
    ['per-scale profile browser isolation is not preserved', (context) => {
      mutatePackageUiFixture(context, (packageUi) => {
        packageUi.runs[0].profileProcessIsolation.before.unresolvedCount = 1;
      });
    }],
    ['wide product process isolation is not preserved', (context) => {
      mutatePackageUiFixture(context, (packageUi) => {
        packageUi.wideProfile.packageProcessIsolation.after.passed = false;
      });
    }],
    ['per-run structured diagnostics are missing', (context) => {
      mutatePackageUiFixture(context, (packageUi) => {
        delete packageUi.runs[1].diagnostics;
      });
    }],
    ['diagnostics retain a raw credential', (context) => {
      mutatePackageUiFixture(context, (packageUi) => {
        packageUi.wideProfile.diagnostics.login.failureMessage = 'password=hunter2';
      });
    }],
    ['diagnostics retain raw CLI credentials', (context) => {
      mutatePackageUiFixture(context, (packageUi) => {
        packageUi.runs[0].diagnostics.login.failureMessage = '--username operator@example.com --password hunter2';
      });
    }],
    ['diagnostics retain raw authorization, cookie, or session tokens', (context) => {
      mutatePackageUiFixture(context, (packageUi) => {
        packageUi.runs[1].diagnostics.login.failureMessage = [
          'Authorization: Bearer abcdef123456',
          'Cookie: sid=cookie-secret',
          'session_token=session-secret',
        ].join('\n');
      });
    }],
    ['renderer diagnostics report dropped errors', (context) => {
      mutatePackageUiFixture(context, (packageUi) => {
        packageUi.wideProfile.diagnostics.renderer.droppedCount.consoleErrors = 1;
      });
    }],
    ['profile browser path is not bound to the isolated user data directory', (context) => {
      mutatePackageUiFixture(context, (packageUi) => {
        packageUi.requested.profileBrowserUserDataDir = path.join(context.dir, 'other-browser-profile');
      });
    }],
    ['profile browser isolation persists a command line', (context) => {
      mutatePackageUiFixture(context, (packageUi) => {
        packageUi.profileProcessIsolation.after.CommandLine = '--user-data-dir=D:\\secret-profile';
      });
    }],
    ['profile database provenance is not preserved', (context) => {
      mutatePackageUiFixture(context, (packageUi) => {
        packageUi.profileDatabaseProvenance.passed = false;
        packageUi.profileDatabaseProvenance.hashMatches = false;
      });
    }],
    ['wide Product/Diagnosis profile is incomplete', (context) => {
      mutatePackageUiFixture(context, (packageUi) => {
        packageUi.wideProfile.workspaceChecks.find((item) => item.workspace === 'diagnosis').passed = false;
      });
    }],
  ])('rejects APP_NEEDS_WORK when package UI %s', (_label, mutate) => {
    const result = runStrictNonReadySafetyFixture({ mutateAfterWrite: mutate });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('explicit package UI evidence is fresh, complete, hash-bound, DB-safe, process-isolated, and bundled');
  });

  it('rejects APP_NEEDS_WORK when bundle package UI sourcePath does not match the explicit manifest', () => {
    const result = runStrictNonReadySafetyFixture({
      mutateAfterWrite({ paths }) {
        const bundle = JSON.parse(fs.readFileSync(paths.bundleManifest, 'utf8'));
        bundle.uiEvidence.packageUiManifest.sourcePath = path.join(path.dirname(paths.packageUiManifest), 'other-package-ui.json');
        writeJson(paths.bundleManifest, bundle);
      },
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('explicit package UI evidence is fresh, complete, hash-bound, DB-safe, process-isolated, and bundled');
  });

  it('does not allow explicit strict verification to substitute historical APP_READY records', () => {
    const result = runStrictNonReadySafetyFixture({
      mutateFinalReadiness(finalReadiness) {
        finalReadiness.status = 'APP_READY';
        finalReadiness.appReady = true;
      },
      mutateAfterWrite({ paths }) {
        const bundle = JSON.parse(fs.readFileSync(paths.bundleManifest, 'utf8'));
        bundle.status = 'APP_READY';
        bundle.appReady = true;
        bundle.warning = 'APP_READY evidence bundle.';
        writeJson(paths.bundleManifest, bundle);
      },
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('final readiness remains APP_NEEDS_WORK with appReady=false');
    expect(result.stdout).not.toContain('historical APP_READY final readiness is baseline only');
  });

  it('rejects APP_NEEDS_WORK when explicit package launch smoke is invalid', () => {
    const result = runStrictNonReadySafetyFixture({
      mutateAfterWrite({ paths }) {
        const smoke = JSON.parse(fs.readFileSync(paths.packageSmoke, 'utf8'));
        smoke.checks = smoke.checks.map((check) => (
          check.kind === 'portable' ? { ...check, ok: false } : check
        ));
        writeJson(paths.packageSmoke, smoke);
      },
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('package-launch-smoke gate is passed with explicit current evidence matching final readiness and package index');
    expect(`${result.stdout}${result.stderr}`).toContain('NEEDS_WORK');
  });

  it('rejects APP_NEEDS_WORK when explicit package launch smoke does not match its final readiness record', () => {
    let alternateSmokePath = '';
    const result = runStrictNonReadySafetyFixture({
      mutateFinalReadiness(finalReadiness) {
        alternateSmokePath = path.join(path.dirname(finalReadiness.evidenceSelection.manifestPath), 'other-package-launch-smoke.json');
        finalReadiness.packageLaunchSmoke.evidencePath = alternateSmokePath;
        finalReadiness.gates.find((gate) => gate.id === 'package-launch-smoke').evidencePath = alternateSmokePath;
      },
      mutateAfterWrite({ paths }) {
        fs.copyFileSync(paths.packageSmoke, alternateSmokePath);
      },
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('package-launch-smoke gate is passed with explicit current evidence matching final readiness and package index');
  });

  it('rejects APP_NEEDS_WORK when any gate besides real ad readback also fails', () => {
    const result = runStrictNonReadySafetyFixture({
      mutateFinalReadiness(finalReadiness) {
        const aiGate = finalReadiness.gates.find((gate) => gate.id === 'ai-live-provider');
        aiGate.ok = false;
        aiGate.status = 'needs_work';
      },
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('final readiness has exactly 8 gates, 7 passed, and only real-ad-execution-readback needs work');
  });

  it('rejects APP_NEEDS_WORK when the recorded authority database path no longer exists', () => {
    const result = runStrictNonReadySafetyFixture({
      mutateAfterWrite({ fixture }) {
        fs.rmSync(fixture.authorityDbPath, { force: true });
      },
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('bind the same existing SQLite authority database identity');
  });

  it('rejects APP_NEEDS_WORK when explicit --db selects another existing database without leaking its path', () => {
    let otherDbPath = '';
    const result = runStrictNonReadySafetyFixture({
      mutateAfterWrite({ dir }) {
        otherDbPath = path.join(dir, 'other-authority.db');
        fs.writeFileSync(otherDbPath, 'other authority database identity fixture\n', 'utf8');
      },
      extraArgs() {
        return ['--db', otherDbPath];
      },
    });
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).not.toBe(0);
    expect(output).toContain('bind the same existing SQLite authority database identity');
    expect(output).not.toContain(otherDbPath);
  });

  it('rejects APP_NEEDS_WORK when the delivery bundle records another authority database', () => {
    const result = runStrictNonReadySafetyFixture({
      mutateAfterWrite({ dir, paths }) {
        const otherDbPath = path.join(dir, 'bundle-authority.db');
        fs.writeFileSync(otherDbPath, 'bundle authority database identity fixture\n', 'utf8');
        const bundle = JSON.parse(fs.readFileSync(paths.bundleManifest, 'utf8'));
        bundle.authorityDatabase.sourcePath = otherDbPath;
        writeJson(paths.bundleManifest, bundle);
      },
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('bind the same existing SQLite authority database identity');
  });

  it('ignores newer smoke final-readiness files when selecting default evidence', () => {
    const runId = Date.now();
    const evidenceManifest = path.join(evidenceDir, `v15-final-readiness-evidence-manifest-non-ready-smoke-${runId}.json`);
    const finalReadiness = path.join(evidenceDir, 'final-readiness-2099-01-01.json');
    const smokeReadiness = path.join(evidenceDir, `final-readiness-smoke-${runId}.json`);
    const bundleDir = path.join(bundleRoot, `v15-non-ready-safety-smoke-${runId}`);
    const bundleManifest = path.join(bundleDir, 'delivery-bundle-manifest.json');
    const readme = path.join(bundleDir, 'README.md');
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-non-ready-default-smoke-'));
    const packageSmoke = path.join(fixtureDir, 'package-launch-smoke.json');
    const packageUiManifest = path.join(fixtureDir, 'package-ui-manifest.json');

    try {
      writeStrictNonReadyFixture({
        artifactDir: fixtureDir,
        evidenceManifest,
        finalReadiness,
        packageSmoke,
        packageUiManifest,
        bundleManifest,
        readme,
      });
      writeJson(smokeReadiness, {
        status: 'APP_READY',
        appReady: true,
        evidenceSelection: { mode: 'smoke' },
        gates: [],
      });
      const result = runNode('scripts/verify-v15-non-ready-safety.js', [
        '--package-launch-smoke', packageSmoke,
        '--package-ui-manifest', packageUiManifest,
        '--readme', readme,
      ]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('NON_READY_SAFETY verified');
    } finally {
      for (const filePath of [evidenceManifest, finalReadiness, smokeReadiness]) {
        if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
      }
      if (fs.existsSync(bundleDir)) fs.rmSync(bundleDir, { recursive: true, force: true });
      if (fs.existsSync(fixtureDir)) fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it('selects timestamp-named final-readiness evidence by default without selecting smoke artifacts', () => {
    const runId = Date.now();
    const evidenceManifest = path.join(evidenceDir, `v15-final-readiness-evidence-manifest-timestamp-default-${runId}.json`);
    const finalReadiness = path.join(evidenceDir, `final-readiness-${runId}.json`);
    const smokeReadiness = path.join(evidenceDir, `final-readiness-smoke-${runId}.json`);
    const bundleDir = path.join(bundleRoot, `v15-non-ready-safety-timestamp-default-${runId}`);
    const bundleManifest = path.join(bundleDir, 'delivery-bundle-manifest.json');
    const readme = path.join(bundleDir, 'README.md');
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-non-ready-timestamp-default-'));
    const packageSmoke = path.join(fixtureDir, 'package-launch-smoke.json');
    const packageUiManifest = path.join(fixtureDir, 'package-ui-manifest.json');

    try {
      writeStrictNonReadyFixture({
        artifactDir: fixtureDir,
        evidenceManifest,
        finalReadiness,
        packageSmoke,
        packageUiManifest,
        bundleManifest,
        readme,
      });
      writeJson(smokeReadiness, {
        status: 'APP_READY',
        appReady: true,
        evidenceSelection: { mode: 'smoke' },
        gates: [],
      });
      const result = runNode('scripts/verify-v15-non-ready-safety.js', [
        '--package-launch-smoke', packageSmoke,
        '--package-ui-manifest', packageUiManifest,
        '--readme', readme,
      ]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('final readiness remains APP_NEEDS_WORK with appReady=false');
      expect(result.stdout).toContain('NON_READY_SAFETY verified');
    } finally {
      for (const filePath of [evidenceManifest, finalReadiness, smokeReadiness]) {
        if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
      }
      if (fs.existsSync(bundleDir)) fs.rmSync(bundleDir, { recursive: true, force: true });
      if (fs.existsSync(fixtureDir)) fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it('treats default historical APP_READY evidence as baseline only when README is IN_PROGRESS', () => {
    const runId = Date.now();
    const evidenceManifest = path.join(evidenceDir, `v15-final-readiness-evidence-manifest-historical-ready-${runId}.json`);
    const finalReadiness = path.join(evidenceDir, 'final-readiness-2099-01-02.json');
    const adReadback = path.join(evidenceDir, `real-ad-execution-readback-historical-ready-${runId}.json`);
    const bundleDir = path.join(bundleRoot, `v15-non-ready-safety-historical-ready-${runId}`);
    const bundleManifest = path.join(bundleDir, 'delivery-bundle-manifest.json');
    const readme = path.join(bundleDir, 'README.md');
    const packageIndex = finalPackageIndex(path.dirname(finalReadiness));
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-non-ready-history-authority-'));

    try {
      writeReadme(readme);
      const dbPath = writeValidReadbackWithDb(fixtureDir, adReadback);
      writeJson(evidenceManifest, {
        kind: 'v15-final-readiness-evidence-manifest',
        evidence: {
          adReadback: {
            exists: true,
            absolutePath: adReadback,
          },
        },
      });
      writeJson(finalReadiness, {
        status: 'APP_READY',
        appReady: true,
        reportCollectionReady: true,
        listingReadReady: true,
        evidenceSelection: {
          mode: 'manifest',
          manifestPath: evidenceManifest,
          authorityDbPath: dbPath,
        },
        gates: [
          { name: 'AI live provider', ok: true, status: 'passed' },
          { name: 'Ad recommendation AI explanation', ok: true, status: 'passed' },
          { name: 'Listing AI draft', ok: true, status: 'passed' },
          { name: 'Real ad execution readback', ok: true, status: 'passed', evidencePath: adReadback },
          { name: 'Release package hash', ok: true, status: 'passed' },
        ],
        packageIndex,
      });
      writeJson(bundleManifest, {
        status: 'APP_READY',
        appReady: true,
        warning: 'APP_READY evidence bundle.',
      });

      const result = runNode('scripts/verify-v15-non-ready-safety.js', ['--readme', readme]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('historical APP_READY final readiness is baseline only');
      expect(result.stdout).toContain('historical APP_READY delivery bundle is baseline only');
      expect(result.stdout).toContain('README top-level delivery line is non-ready');

      const otherDbPath = writeAdReadbackAuthorityDb(
        path.join(fixtureDir, 'other-authority-db'),
        JSON.parse(fs.readFileSync(adReadback, 'utf8')),
      );
      const mismatch = runNode('scripts/verify-v15-non-ready-safety.js', [
        '--final-readiness', finalReadiness,
        '--bundle-manifest', bundleManifest,
        '--readme', readme,
        '--db', otherDbPath,
      ]);
      expect(mismatch.status).not.toBe(0);
      expect(`${mismatch.stdout}${mismatch.stderr}`).toContain('SQLite authority database mismatch');
    } finally {
      for (const filePath of [evidenceManifest, finalReadiness, adReadback]) {
        if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
      }
      if (fs.existsSync(bundleDir)) fs.rmSync(bundleDir, { recursive: true, force: true });
      if (fs.existsSync(fixtureDir)) fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it('rejects historical APP_READY baseline when package hash evidence is missing', () => {
    const runId = Date.now();
    const evidenceManifest = path.join(evidenceDir, `v15-final-readiness-evidence-manifest-historical-no-package-${runId}.json`);
    const finalReadiness = path.join(evidenceDir, 'final-readiness-2099-01-05.json');
    const adReadback = path.join(evidenceDir, `real-ad-execution-readback-historical-no-package-${runId}.json`);
    const bundleDir = path.join(bundleRoot, `v15-non-ready-safety-historical-no-package-${runId}`);
    const bundleManifest = path.join(bundleDir, 'delivery-bundle-manifest.json');
    const readme = path.join(bundleDir, 'README.md');
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-non-ready-no-package-authority-'));

    try {
      writeReadme(readme);
      const dbPath = writeValidReadbackWithDb(fixtureDir, adReadback);
      writeJson(evidenceManifest, {
        kind: 'v15-final-readiness-evidence-manifest',
        evidence: {
          adReadback: {
            exists: true,
            absolutePath: adReadback,
          },
        },
      });
      writeJson(finalReadiness, {
        status: 'APP_READY',
        appReady: true,
        reportCollectionReady: true,
        listingReadReady: true,
        evidenceSelection: {
          mode: 'manifest',
          manifestPath: evidenceManifest,
          authorityDbPath: dbPath,
        },
        gates: [
          { name: 'AI live provider', ok: true, status: 'passed' },
          { name: 'Ad recommendation AI explanation', ok: true, status: 'passed' },
          { name: 'Listing AI draft', ok: true, status: 'passed' },
          { name: 'Real ad execution readback', ok: true, status: 'passed', evidencePath: adReadback },
        ],
      });
      writeJson(bundleManifest, {
        status: 'APP_READY',
        appReady: true,
        warning: 'APP_READY evidence bundle.',
      });

      const result = runNode('scripts/verify-v15-non-ready-safety.js', [
        '--final-readiness', finalReadiness,
        '--bundle-manifest', bundleManifest,
        '--package-launch-smoke', path.join(path.dirname(finalReadiness), 'missing-package-launch-smoke.json'),
        '--readme', readme,
      ]);

      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toContain('historical APP_READY baseline has current package hash or launch smoke evidence');
      expect(`${result.stdout}${result.stderr}`).toContain('NEEDS_WORK');
    } finally {
      for (const filePath of [evidenceManifest, finalReadiness, adReadback]) {
        if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
      }
      if (fs.existsSync(bundleDir)) fs.rmSync(bundleDir, { recursive: true, force: true });
      if (fs.existsSync(fixtureDir)) fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it('accepts a historical APP_READY baseline when current package launch smoke supersedes stale package hashes', () => {
    const runId = Date.now();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-non-ready-safety-package-smoke-'));
    const evidenceManifest = path.join(dir, `v15-final-readiness-evidence-manifest-package-smoke-${runId}.json`);
    const finalReadiness = path.join(dir, 'final-readiness.json');
    const packageSmoke = path.join(dir, 'package-launch-smoke.json');
    const adReadback = path.join(dir, `real-ad-execution-readback-package-smoke-${runId}.json`);
    const bundleManifest = path.join(dir, 'delivery-bundle-manifest.json');
    const readme = writeReadme(path.join(dir, 'README.md'));

    try {
      const dbPath = writeValidReadbackWithDb(dir, adReadback);
      writeJson(packageSmoke, validPackageLaunchSmoke(path.join(dir, 'release')));
      writeJson(evidenceManifest, {
        kind: 'v15-final-readiness-evidence-manifest',
        evidence: {
          adReadback: {
            exists: true,
            absolutePath: adReadback,
          },
        },
      });
      writeJson(finalReadiness, {
        status: 'APP_READY',
        appReady: true,
        reportCollectionReady: true,
        listingReadReady: true,
        evidenceSelection: {
          mode: 'manifest',
          manifestPath: evidenceManifest,
          authorityDbPath: dbPath,
        },
        gates: [
          { name: 'AI live provider', ok: true, status: 'passed' },
          { name: 'Ad recommendation AI explanation', ok: true, status: 'passed' },
          { name: 'Listing AI draft', ok: true, status: 'passed' },
          { name: 'Real ad execution readback', ok: true, status: 'passed', evidencePath: adReadback },
          { name: 'Release package hash', ok: true, status: 'passed' },
        ],
        packageIndex: {
          present: true,
          count: 1,
          existingCount: 1,
          missingCount: 0,
          packages: [
            {
              kind: 'installer',
              sourcePath: path.join(dir, 'old-installer.exe'),
              fileName: 'old-installer.exe',
              exists: true,
              sizeBytes: 123,
              sha256: '0'.repeat(64),
            },
          ],
        },
      });
      writeJson(bundleManifest, {
        status: 'APP_READY',
        appReady: true,
        warning: 'APP_READY evidence bundle.',
      });

      const result = runNode('scripts/verify-v15-non-ready-safety.js', [
        '--final-readiness', finalReadiness,
        '--bundle-manifest', bundleManifest,
        '--package-launch-smoke', packageSmoke,
        '--readme', readme,
      ]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('historical APP_READY baseline has current package hash or launch smoke evidence');
      expect(result.stdout).toContain('NON_READY_SAFETY verified');
    } finally {
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects historical APP_READY baseline when old readback evidence lacks current source report authority', () => {
    const runId = Date.now();
    const evidenceManifest = path.join(evidenceDir, `v15-final-readiness-evidence-manifest-legacy-readback-${runId}.json`);
    const finalReadiness = path.join(evidenceDir, 'final-readiness-2099-01-04.json');
    const adReadback = path.join(evidenceDir, `real-ad-execution-readback-legacy-${runId}.json`);
    const bundleDir = path.join(bundleRoot, `v15-non-ready-safety-legacy-readback-${runId}`);
    const bundleManifest = path.join(bundleDir, 'delivery-bundle-manifest.json');
    const readme = path.join(bundleDir, 'README.md');
    const packageIndex = finalPackageIndex(path.dirname(finalReadiness));
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-non-ready-legacy-authority-'));

    try {
      writeReadme(readme);
      const legacyReadback = createValidAdReadbackEvidence(fixtureDir);
      const dbPath = writeAdReadbackAuthorityDb(path.join(fixtureDir, 'authority-db'), legacyReadback);
      delete legacyReadback.source.sourceFiles;
      delete legacyReadback.source.sourceRow;
      writeJson(adReadback, legacyReadback);
      writeJson(evidenceManifest, {
        kind: 'v15-final-readiness-evidence-manifest',
        evidence: {
          adReadback: {
            exists: true,
            absolutePath: adReadback,
          },
        },
      });
      writeJson(finalReadiness, {
        status: 'APP_READY',
        appReady: true,
        reportCollectionReady: true,
        listingReadReady: true,
        evidenceSelection: {
          mode: 'manifest',
          manifestPath: evidenceManifest,
          authorityDbPath: dbPath,
        },
        gates: [
          { name: 'AI live provider', ok: true, status: 'passed' },
          { name: 'Ad recommendation AI explanation', ok: true, status: 'passed' },
          { name: 'Listing AI draft', ok: true, status: 'passed' },
          { name: 'Real ad execution readback', ok: true, status: 'passed', evidencePath: adReadback },
          { name: 'Release package hash', ok: true, status: 'passed' },
        ],
        packageIndex,
      });
      writeJson(bundleManifest, {
        status: 'APP_READY',
        appReady: true,
        warning: 'APP_READY evidence bundle.',
      });

      const result = runNode('scripts/verify-v15-non-ready-safety.js', ['--readme', readme]);

      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toContain('NEEDS_WORK');
      expect(`${result.stdout}${result.stderr}`).toContain('historical real ad readback baseline fails current verify:ad-readback');
    } finally {
      for (const filePath of [evidenceManifest, finalReadiness, adReadback]) {
        if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
      }
      if (fs.existsSync(bundleDir)) fs.rmSync(bundleDir, { recursive: true, force: true });
      if (fs.existsSync(fixtureDir)) fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it('rejects historical APP_READY baseline when selected readback evidence fails verify:ad-readback', () => {
    const runId = Date.now();
    const evidenceManifest = path.join(evidenceDir, `v15-final-readiness-evidence-manifest-bad-historical-ready-${runId}.json`);
    const finalReadiness = path.join(evidenceDir, 'final-readiness-2099-01-03.json');
    const adReadback = path.join(evidenceDir, `real-ad-execution-readback-bad-historical-ready-${runId}.json`);
    const bundleDir = path.join(bundleRoot, `v15-non-ready-safety-bad-historical-ready-${runId}`);
    const bundleManifest = path.join(bundleDir, 'delivery-bundle-manifest.json');
    const readme = path.join(bundleDir, 'README.md');
    const packageIndex = finalPackageIndex(path.dirname(finalReadiness));
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-non-ready-bad-authority-'));

    try {
      writeReadme(readme);
      const dbPath = writeValidReadbackWithDb(fixtureDir, adReadback);
      writeJson(adReadback, { kind: 'real-ad-execution-readback', status: 'PASS', readback: { verified: true } });
      writeJson(evidenceManifest, {
        kind: 'v15-final-readiness-evidence-manifest',
        evidence: {
          adReadback: {
            exists: true,
            absolutePath: adReadback,
          },
        },
      });
      writeJson(finalReadiness, {
        status: 'APP_READY',
        appReady: true,
        reportCollectionReady: true,
        listingReadReady: true,
        evidenceSelection: {
          mode: 'manifest',
          manifestPath: evidenceManifest,
          authorityDbPath: dbPath,
        },
        gates: [
          { name: 'AI live provider', ok: true, status: 'passed' },
          { name: 'Ad recommendation AI explanation', ok: true, status: 'passed' },
          { name: 'Listing AI draft', ok: true, status: 'passed' },
          { name: 'Real ad execution readback', ok: true, status: 'passed', evidencePath: adReadback },
          { name: 'Release package hash', ok: true, status: 'passed' },
        ],
        packageIndex,
      });
      writeJson(bundleManifest, {
        status: 'APP_READY',
        appReady: true,
        warning: 'APP_READY evidence bundle.',
      });

      const result = runNode('scripts/verify-v15-non-ready-safety.js', ['--readme', readme]);

      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toContain('historical real ad readback baseline fails current verify:ad-readback');
    } finally {
      for (const filePath of [evidenceManifest, finalReadiness, adReadback]) {
        if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
      }
      if (fs.existsSync(bundleDir)) fs.rmSync(bundleDir, { recursive: true, force: true });
      if (fs.existsSync(fixtureDir)) fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });
});

const path = require('node:path');
const { insist, readArtifact, timeWithin, currentPackage, structuredFailure, withArtifactLedger, within } = require('./v16-native-artifacts');
const packages = require('./v16-native-package-adapters');
const business = require('./v16-native-business-adapters');
const scenarios = require('./v16-native-scenario-adapters');

const CHECK_ADAPTERS = Object.freeze({
  'V16-T-L4-PACKAGE-UI': {
    'six-modules-22-intents': ['package-ui'], '100-percent': ['package-ui'], '125-percent': ['package-ui'], wide: ['package-ui'],
    'minimum-window': ['package-ui'], 'dialogs-keyboard': ['package-ui'], 'chinese-recovery': ['ui-recovery'], accessibility: ['package-ui', 'ui-governance'],
  },
  'V16-T-L5-ARTIFACTS': {
    'installer-launch': ['installed-package'], 'portable-launch': ['desktop-runtime'], 'zip-launch': ['folder-zip'],
    'native-dependencies': ['desktop-runtime'], 'navigation-external-open': ['package-security'],
    'shutdown-cleanup': ['installed-package', 'desktop-runtime', 'folder-zip'], 'package-hashes': ['package-hashes'],
  },
  'V16-T-L6-FORMAL-DATA': {
    'wal-safe-backup': ['authority-snapshot', 'live-migration'], 'migration-idempotence-interruption': ['migration-scenarios'],
    'old-version-write-refused': ['migration-scenarios'], 'formal-pre-post': ['live-migration'],
    'two-stores-isolated': ['continuous-operation'], 'seven-completed-days-each': ['continuous-operation'], 'no-unexpected-writes': ['live-migration'],
  },
  'V16-T-L7-REAL-EXECUTION': {
    'manual-independent-candidate-decision-grant': ['execution-canary'], 'manual-before-after-reload': ['execution-canary'],
    'policy-independent-candidate-decision-grant': ['execution-canary'], 'policy-before-after-reload': ['execution-canary'],
    'unknown-reconciliation': ['unknown-reconciliation'], 'performance-budget': ['performance-budget'], 'ai-cost-budget': ['ai-cost-budget'],
  },
});
const ADAPTERS = Object.freeze({
  'package-ui': packages.verifyPackageUi, 'desktop-runtime': packages.verifyRuntime, 'installed-package': packages.verifyInstalled,
  'ui-recovery': require('./v16-native-ui-recovery').verifyUiRecovery,
  'ui-governance': require('./v16-native-ui-governance').verifyUiGovernance,
  'folder-zip': packages.verifyZip, 'package-security': packages.verifySecurity,
  'package-hashes': (raw, descriptor, context) => { insist(raw.kind === 'v16-current-package' && raw.schemaVersion === 1 && require('./v16-native-artifacts').same(raw.packageIdentity, context.current.packageIdentity), 'PACKAGE_HASH_REPORT_MISMATCH'); return true; },
  'authority-snapshot': business.verifyAuthority, 'continuous-operation': business.verifyContinuous, 'execution-canary': business.verifyCanary,
  'offline-migration': business.verifyOfflineMigration, 'live-migration': business.verifyLiveMigration,
  'unknown-reconciliation': business.verifyReconciliation, 'ai-cost-budget': business.verifyAiBudget,
  'migration-scenarios': scenarios.verifyMigrationScenarios, 'performance-budget': scenarios.verifyPerformance,
});
function verifyNativeEvidence(raw, test, identity, root, execution, trustedNativeEnvironment) {
  const ledger = new Map();
  try {
    const roots = require('./v16-trusted-runtime').artifactRoots(trustedNativeEnvironment);
    return withArtifactLedger(ledger, () => verifyNativeEvidenceWithLedger(raw, test, identity, root, execution, ledger, trustedNativeEnvironment, roots), roots);
  } catch (error) {
    const total = test.requiredChecks?.length ?? 0;
    return { success: false, total, passed: 0, failed: total, skipped: 0, caseIds: [], inputArtifacts: [], issues: [error.message], diagnostics: [structuredFailure('v16.native_environment_failed', error, { testId: test.testId })] };
  }
}
function verifyNativeEvidenceWithLedger(raw, test, identity, root, execution, ledger, trustedNativeEnvironment, artifactRoots) {
  const issues = [], diagnostics = [], caseIds = [], validated = new Map(), visiting = new Set();
  const total = test.requiredChecks?.length ?? 0;
  try {
    insist(raw.schemaVersion === 'v16.native-checks/1', 'NATIVE_ARTIFACT_VERIFICATION_REQUIRED');
    insist(CHECK_ADAPTERS[test.testId] && Object.keys(CHECK_ADAPTERS[test.testId]).sort().join('|') === [...test.requiredChecks].sort().join('|'), 'NATIVE_REQUIRED_CHECK_CONTRACT_MISMATCH');
    insist(raw.success === true && Array.isArray(raw.checks) && raw.checks.length === total && raw.checks.map(x => x.id).sort().join('|') === [...test.requiredChecks].sort().join('|'), 'NATIVE_CHECK_COLLECTION_MISMATCH');
    insist(typeof raw.runId === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{5,180}$/.test(raw.runId), 'NATIVE_RUN_ID_MISSING');
    insist(raw.testId === test.testId && raw.sourceSha256 === identity.sourceSha256, 'NATIVE_SOURCE_IDENTITY_MISMATCH');
    insist(Array.isArray(raw.nativeArtifacts) && raw.nativeArtifacts.length > 0 && new Set(raw.nativeArtifacts.map(x => x.id)).size === raw.nativeArtifacts.length, 'NATIVE_ARTIFACT_INVENTORY_INVALID');
    const descriptors = new Map(raw.nativeArtifacts.map(x => [x.id, x]));
    const current = trustedNativeEnvironment ? require('./v16-trusted-runtime').providedPackage(root, identity, trustedNativeEnvironment) : currentPackage(root, identity);
    const context = { root, identity, execution, current, descriptors, trustedNativeEnvironment, artifactRoots };
    context.load = (id, expectedAdapter) => {
      const descriptor = descriptors.get(id);
      insist(descriptor && descriptor.adapter === expectedAdapter && ADAPTERS[expectedAdapter], 'NATIVE_ADAPTER_OR_REFERENCE_MISMATCH:' + id);
      insist(!visiting.has(id), 'NATIVE_ARTIFACT_REFERENCE_CYCLE:' + id);
      if (validated.has(id)) return validated.get(id);
      visiting.add(id);
      try {
        const artifact = readArtifact(root, descriptor), report = artifact.json();
        const generated = report.generatedAt ?? report.exportedAt ?? report.finishedAt;
        const capturedAt = timeWithin(generated, execution, descriptor.id);
        const maximumAgeMs = ({ L4: 30, L5: 30, L6: 14, L7: 3 }[test.layer]) * 24 * 60 * 60 * 1000;
        insist(Date.now() - capturedAt <= maximumAgeMs, 'NATIVE_ARTIFACT_EXPIRED:' + descriptor.id);
        insist(typeof descriptor.runId === 'string' && descriptor.runId.length > 0, 'NATIVE_ARTIFACT_RUN_ID_MISSING');
        ADAPTERS[expectedAdapter](report, descriptor, context);
        collectVerifiedReferences(report, context);
        readArtifact(root, descriptor);
        validated.set(id, report);
        return report;
      } finally { visiting.delete(id); }
    };
    for (const checkId of test.requiredChecks) {
      try {
        const checks = (raw.checks ?? []).filter(x => x.id === checkId);
        insist(checks.length === 1 && checks[0].passed === true && Array.isArray(checks[0].nativeArtifactIds), 'NATIVE_CHECK_REFERENCE_REQUIRED:' + checkId);
        const ids = checks[0].nativeArtifactIds;
        insist(ids.length === CHECK_ADAPTERS[test.testId][checkId].length && new Set(ids).size === ids.length, 'NATIVE_CHECK_REFERENCE_COUNT:' + checkId);
        for (let i = 0; i < ids.length; i += 1) {
          const report = context.load(ids[i], CHECK_ADAPTERS[test.testId][checkId][i]);
          if (checkId.startsWith('manual-')) insist(report.mode === 'manual_approval', 'MANUAL_MODE_SUBSTITUTED');
          if (checkId.startsWith('policy-')) insist(report.mode === 'policy_auto', 'POLICY_MODE_SUBSTITUTED');
          if (checkId === 'portable-launch') insist(report.target.deliveryKind === 'portable', 'PORTABLE_FORM_SUBSTITUTED');
        }
        caseIds.push(checkId);
      } catch (error) {
        issues.push(checkId + ':' + error.message);
        diagnostics.push(structuredFailure('v16.native_check_failed', error, { testId: test.testId, checkId }));
      }
    }
    if (test.layer === 'L7') {
      require('./v16-native-canary-independence').verifyCanaryIndependence([...validated.values()], context.canaryValidations);
    }
    // 原件可能在跨 check 期间改变，发布结果之前再次重验所有已读取文件。
    for (const id of validated.keys()) readArtifact(root, descriptors.get(id));
    for (const record of ledger.values()) readArtifact(root, record, path.dirname(record.path));
    for (const [id, value] of validated) if (descriptors.get(id).adapter === 'authority-snapshot') business.verifyAuthorityCurrentness(value, 'v16-native-before-publication', context);
    for (const record of ledger.values()) readArtifact(root, record, path.dirname(record.path));
  } catch (error) {
    issues.push(error.message);
    diagnostics.push(structuredFailure('v16.native_evidence_failed', error, { testId: test.testId }));
  }
  return { success: issues.length === 0 && caseIds.length === total, total, passed: caseIds.length, failed: total - caseIds.length, skipped: 0, caseIds: issues.length ? [] : caseIds, issues, diagnostics, inputArtifacts: issues.length ? [] : [...ledger.values()].sort((a, b) => a.path.localeCompare(b.path)) };
}
function collectVerifiedReferences(value, context, baseRoot = context.root) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { for (const item of value) collectVerifiedReferences(item, context, baseRoot); return; }
  if (typeof value.rootPath === 'string' && [context.root, ...(context.artifactRoots ?? [])].some(directory => within(directory, value.rootPath))) baseRoot = value.rootPath;
  const candidate = value.path ?? value.absolutePath ?? value.artifactPath;
  const sha = value.sha256 ?? value.contentSha256;
  if (typeof candidate === 'string' && /^[a-f0-9]{64}$/i.test(sha ?? '')) {
    const file = path.resolve(baseRoot, candidate);
    const canonical = require('./ad-readback-authority-db').defaultDbCandidates({ APPDATA: process.env.APPDATA, USERPROFILE: process.env.USERPROFILE });
    const owner = [context.root, ...(context.artifactRoots ?? []), ...canonical.map(db => path.dirname(db))].find(directory => within(directory, file));
    insist(owner, 'NATIVE_REFERENCE_OUTSIDE_CURRENT_AUTHORITY:' + file);
    readArtifact(context.root, { path: file, sha256: sha, sizeBytes: value.sizeBytes }, owner);
  }
  for (const [key, item] of Object.entries(value)) {
    // ZIP 已由当前归档、当前目录包和运行身份交叉验证，清理后的临时 EXE 不再属于冻结输入。
    if (value.kind === 'folder-zip-launch-smoke' && key === 'extractedExecutable') continue;
    collectVerifiedReferences(item, context, baseRoot);
  }
}
module.exports = { CHECK_ADAPTERS, ADAPTERS, verifyNativeEvidence };

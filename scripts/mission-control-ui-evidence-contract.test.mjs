import crypto from 'node:crypto';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import evidenceContract from './mission-control-ui-evidence-contract.js';

const {
  EXPECTED_MISSION_CONTROL_SCALES,
  EXPECTED_MISSION_CONTROL_WORKSPACES,
  MISSION_CONTROL_UI_EVIDENCE_KIND,
  MISSION_CONTROL_UI_EVIDENCE_JSON_SCHEMA,
  MISSION_CONTROL_UI_EVIDENCE_SCHEMA_VERSION,
  MISSION_CONTROL_WORKSPACE_CONTRACT,
  evaluateMissionControlUiEvidenceManifest,
  validateMissionControlUiEvidenceManifest,
} = evidenceContract;

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function businessFactSentinels(projection) {
  return [...new Set([
    projection.scope.asin,
    projection.scope.batchId,
    ...projection.productAsins,
    ...projection.keywordFacts.flatMap((fact) => [fact.asin, fact.keyword]),
  ])].sort((left, right) => left.localeCompare(right, 'en-US'));
}

const SHC001_BUSINESS_FACTS = {
  scope: { asin: 'B0GTTJFQTM', batchId: 'batch_shc001_20260722' },
  productAsins: ['B0GTTJFQTM', 'B0GVRW2HPY'],
  keywordFacts: [
    { asin: 'B0GTTJFQTM', keyword: 'shc001 smart lock' },
  ],
};
const SHC002_BUSINESS_FACTS = {
  scope: { asin: 'B0SHC00201', batchId: 'batch_shc002_20260722' },
  productAsins: ['B0SHC00201', 'B0SHC00202'],
  keywordFacts: [
    { asin: 'B0SHC00201', keyword: 'shc002 smart lock' },
  ],
};

function screenshot(captureId, hash = HASH_A) {
  return {
    absolutePath: path.resolve('output', 'codex-evidence', 'mission-control-stage2', `${captureId}.png`),
    sha256: hash,
  };
}

function viewport(scalePercent) {
  return {
    width: 1487,
    height: 1058,
    clientWidth: 1487,
    scrollWidth: 1487,
    deviceScaleFactor: scalePercent === 125 ? 1.25 : 1,
    horizontalOverflow: false,
  };
}

function autonomy() {
  return {
    currentMode: 'manual_approval',
    manualApprovalAvailable: true,
    policyAutoAvailable: false,
    policyAutoState: 'BLOCKED',
    policyAutoBlockerCode: 'POLICY_AUTO_AUTHORITY_UNAVAILABLE',
  };
}

function authority(storeId = 'SHC001') {
  return { storeId, marketplace: 'US', currency: 'USD' };
}

function workspaceCapture(workspace, scalePercent, storeId = 'SHC001') {
  const contract = MISSION_CONTROL_WORKSPACE_CONTRACT[workspace];
  const captureId = `${workspace}-${scalePercent}-${storeId}`;
  return {
    captureId,
    captureType: 'workspace',
    workspace,
    defaultIntent: { ...contract.defaultIntent },
    scalePercent,
    screenshot: screenshot(captureId),
    viewport: viewport(scalePercent),
    h1: { count: 1, text: contract.heading },
    tabs: {
      renderedSubviews: [...contract.tabs],
      activeSubview: contract.defaultIntent.subview,
    },
    authority: authority(storeId),
    autonomy: autonomy(),
    errors: { console: [], page: [] },
  };
}

function validManifest() {
  const workspaceCaptures = EXPECTED_MISSION_CONTROL_WORKSPACES.flatMap((workspace) => (
    EXPECTED_MISSION_CONTROL_SCALES.map((scalePercent) => workspaceCapture(workspace, scalePercent))
  ));
  return {
    kind: MISSION_CONTROL_UI_EVIDENCE_KIND,
    schemaVersion: MISSION_CONTROL_UI_EVIDENCE_SCHEMA_VERSION,
    generatedAt: '2026-07-22T06:00:00.000Z',
    status: 'STAGE7_UI_EVIDENCE',
    readinessImpact: 'NO_FINAL_READINESS_CREDIT',
    finalReadinessCredit: false,
    source: {
      runtime: 'vite-dev-preview',
      scenario: 'diagnosis-ready',
      runnerSha256: HASH_A,
      contractSha256: HASH_B,
      rendererTreeSha256: HASH_C,
      realLoginAccessed: false,
      authorityDatabaseAccessed: false,
      adsWriteAttempted: false,
    },
    workspaceCaptures,
    storeGateCapture: {
      captureId: 'store-gate-100',
      captureType: 'store-gate',
      state: 'needs-selection',
      scalePercent: 100,
      screenshot: screenshot('store-gate-100'),
      viewport: viewport(100),
      h1: { count: 1, text: '选择本次运营店铺' },
      availableStoreIds: ['SHC001', 'SHC002'],
      activeStoreId: null,
      explicitSelectionRequired: true,
      autoSelected: false,
      marketplace: 'US',
      currency: 'USD',
      errors: { console: [], page: [] },
    },
    storeIsolationCapture: {
      ...workspaceCapture('today', 100, 'SHC002'),
      captureId: 'store-isolation-shc001-to-shc002',
      captureType: 'store-isolation',
      screenshot: screenshot('store-isolation-shc001-to-shc002', HASH_B),
      transition: {
        fromStoreId: 'SHC001',
        toStoreId: 'SHC002',
        explicitUserAction: true,
        automatic: false,
      },
      isolation: {
        previousStoreVisible: false,
        leakedStoreIds: [],
        fromBrowserProfileId: 'profile-shc001',
        toBrowserProfileId: 'profile-shc002',
        fromIdentityFingerprint: fingerprint({
          browserProfileId: 'profile-shc001',
          storeId: 'SHC001',
        }),
        toIdentityFingerprint: fingerprint({
          browserProfileId: 'profile-shc002',
          storeId: 'SHC002',
        }),
        fromBusinessFactProjection: SHC001_BUSINESS_FACTS,
        toBusinessFactProjection: SHC002_BUSINESS_FACTS,
        fromBusinessFactsFingerprint: fingerprint(SHC001_BUSINESS_FACTS),
        toBusinessFactsFingerprint: fingerprint(SHC002_BUSINESS_FACTS),
        fromBusinessFactSentinels: businessFactSentinels(SHC001_BUSINESS_FACTS),
        toBusinessFactSentinels: businessFactSentinels(SHC002_BUSINESS_FACTS),
        leakedBusinessFactSentinels: [],
      },
    },
    minimumWindowCapture: {
      ...workspaceCapture('execution', 100, 'SHC001'),
      captureId: 'execution-minimum-window-1200',
      captureType: 'minimum-window',
      viewport: {
        ...viewport(100),
        width: 1200,
        clientWidth: 1200,
        scrollWidth: 1200,
      },
      executionLayout: {
        roomColumnCount: 1,
        frameClientWidth: 920,
        tableClientWidth: 680,
        tableScrollWidth: 680,
        tableClipped: false,
        scrollContainerOverflowX: 'auto',
      },
    },
  };
}

function violationCodes(manifest) {
  return evaluateMissionControlUiEvidenceManifest(manifest).violations.map(({ code }) => code);
}

describe('Mission Control Stage7 UI evidence contract', () => {
  it('accepts the complete ten-workspace 100%/125% matrix, StoreGate and store-isolation evidence', () => {
    const manifest = validManifest();
    const result = evaluateMissionControlUiEvidenceManifest(manifest);

    expect(result).toEqual({
      passed: true,
      expectedWorkspaceCount: 10,
      expectedWorkspaceCaptureCount: 20,
      violations: [],
    });
    expect(MISSION_CONTROL_UI_EVIDENCE_JSON_SCHEMA.properties.workspaceCaptures).toMatchObject({
      minItems: 20,
      maxItems: 20,
    });
    expect(validateMissionControlUiEvidenceManifest(manifest)).toBe(manifest);
  });

  it('fails when one required workspace/scale capture is missing', () => {
    const manifest = validManifest();
    manifest.workspaceCaptures = manifest.workspaceCaptures.filter((capture) => (
      !(capture.workspace === 'memory' && capture.scalePercent === 125)
    ));

    expect(violationCodes(manifest)).toEqual(expect.arrayContaining([
      'WORKSPACE_CAPTURE_COUNT_MISMATCH',
      'WORKSPACE_SCALE_CAPTURE_MISSING',
    ]));
  });

  it('fails when source provenance is missing', () => {
    const manifest = validManifest();
    delete manifest.source;

    expect(violationCodes(manifest)).toContain('SOURCE_PROVENANCE_MISSING');
  });

  it('fails when source provenance is not the fixed preview-only runtime contract', () => {
    const manifest = validManifest();
    manifest.source = {
      ...manifest.source,
      runtime: 'production',
      scenario: 'another-scenario',
      runnerSha256: 'not-a-sha',
      realLoginAccessed: true,
      authorityDatabaseAccessed: true,
      adsWriteAttempted: true,
      unexpected: true,
    };

    expect(violationCodes(manifest)).toEqual(expect.arrayContaining([
      'SOURCE_RUNTIME_UNSAFE',
      'SOURCE_SCENARIO_UNSAFE',
      'SOURCE_PROVENANCE_FIELDS_INVALID',
      'SOURCE_SHA256_INVALID',
      'SOURCE_ACCESS_CLAIM_UNSAFE',
    ]));
  });

  it('fails when source hashes do not match the current runner, contract, and renderer tree', () => {
    const manifest = validManifest();
    const result = evaluateMissionControlUiEvidenceManifest(manifest, {
      expectedSourceHashes: {
        runnerSha256: HASH_B,
        contractSha256: HASH_C,
        rendererTreeSha256: HASH_A,
      },
    });

    expect(result.violations.filter(({ code }) => code === 'SOURCE_SHA256_MISMATCH'))
      .toHaveLength(3);
  });

  it('fails when a capture claims a non-USD currency', () => {
    const manifest = validManifest();
    manifest.workspaceCaptures[0].authority.currency = 'USDT';

    expect(violationCodes(manifest)).toContain('CURRENCY_NOT_USD');
  });

  it('fails when scrollWidth proves horizontal overflow', () => {
    const manifest = validManifest();
    manifest.workspaceCaptures[0].viewport.scrollWidth = 1492;

    expect(violationCodes(manifest)).toContain('HORIZONTAL_OVERFLOW_DETECTED');
  });

  it('fails with exact expected and actual details when a workspace h1 drifts from its registered heading', () => {
    const manifest = validManifest();
    const captureIndex = manifest.workspaceCaptures.findIndex((capture) => capture.workspace === 'decisions');
    manifest.workspaceCaptures[captureIndex].h1.text = 'AI 建议';

    const result = evaluateMissionControlUiEvidenceManifest(manifest);

    expect(result.violations).toContainEqual({
      code: 'H1_CONTRACT_INVALID',
      path: `workspaceCaptures[${captureIndex}].h1.text`,
      message: 'Workspace h1 must exactly match the registered heading: 建议与审批.',
      actual: 'AI 建议',
      expected: '建议与审批',
    });
  });

  it('accepts policy-auto availability when the Main authority projection is internally consistent', () => {
    const manifest = validManifest();
    manifest.workspaceCaptures[0].autonomy = {
      currentMode: 'manual_approval',
      manualApprovalAvailable: true,
      policyAutoAvailable: true,
      policyAutoState: 'AVAILABLE',
    };

    expect(violationCodes(manifest)).not.toContain('AUTONOMY_AUTHORITY_INCONSISTENT');
  });

  it('fails when policy-auto state contradicts its availability or active mode', () => {
    const manifest = validManifest();
    manifest.workspaceCaptures[0].autonomy = {
      currentMode: 'policy_auto',
      manualApprovalAvailable: true,
      policyAutoAvailable: false,
      policyAutoState: 'BLOCKED',
      policyAutoBlockerCode: 'POLICY_VERSION_NOT_READY',
    };

    expect(violationCodes(manifest)).toContain('AUTONOMY_AUTHORITY_INCONSISTENT');
  });

  it('fails when console or page errors are recorded', () => {
    const manifest = validManifest();
    manifest.workspaceCaptures[0].errors.console.push('Uncaught TypeError');
    manifest.storeIsolationCapture.errors.page.push('renderer crashed');

    expect(violationCodes(manifest)).toEqual(expect.arrayContaining([
      'CONSOLE_ERRORS_PRESENT',
      'PAGE_ERRORS_PRESENT',
    ]));
  });

  it('fails when a screenshot hash is absent', () => {
    const manifest = validManifest();
    delete manifest.storeGateCapture.screenshot.sha256;

    expect(violationCodes(manifest)).toContain('SCREENSHOT_SHA256_MISSING');
    expect(() => validateMissionControlUiEvidenceManifest(manifest))
      .toThrow(/SCREENSHOT_SHA256_MISSING/);
  });

  it('fails closed when CLI-level filesystem verification cannot find a referenced screenshot', () => {
    const manifest = validManifest();
    const result = evaluateMissionControlUiEvidenceManifest(manifest, { verifyScreenshotFiles: true });

    expect(result.passed).toBe(false);
    expect(result.violations.map(({ code }) => code)).toContain('SCREENSHOT_FILE_MISSING');
  });

  it('fails when the supported 1200px execution layout is still two columns or clips the table', () => {
    const manifest = validManifest();
    manifest.minimumWindowCapture.executionLayout.roomColumnCount = 2;
    manifest.minimumWindowCapture.executionLayout.tableClipped = true;

    expect(violationCodes(manifest)).toContain('MINIMUM_WINDOW_EXECUTION_CLIPPED');
  });

  it('fails when distinct store identities wrap identical business fact projections', () => {
    const manifest = validManifest();
    const isolation = manifest.storeIsolationCapture.isolation;
    isolation.toBusinessFactProjection = isolation.fromBusinessFactProjection;
    isolation.toBusinessFactsFingerprint = isolation.fromBusinessFactsFingerprint;
    isolation.toBusinessFactSentinels = isolation.fromBusinessFactSentinels;

    expect(violationCodes(manifest)).toContain('STORE_ISOLATION_FACTS_NOT_DISTINCT');
  });

  it('fails when a business fact projection is changed without updating its fingerprint', () => {
    const manifest = validManifest();
    manifest.storeIsolationCapture.isolation.toBusinessFactProjection.scope.asin = 'B0TAMPERED';

    expect(violationCodes(manifest)).toContain('STORE_ISOLATION_FACT_FINGERPRINT_MISMATCH');
  });

  it('fails when store identity is mixed into the fact projection or a prior-store sentinel leaks', () => {
    const manifest = validManifest();
    const isolation = manifest.storeIsolationCapture.isolation;
    isolation.toBusinessFactProjection.storeId = 'SHC002';
    isolation.leakedBusinessFactSentinels = [isolation.fromBusinessFactSentinels[0]];

    expect(violationCodes(manifest)).toEqual(expect.arrayContaining([
      'STORE_ISOLATION_FACT_PROJECTION_INVALID',
      'STORE_ISOLATION_BUSINESS_FACT_LEAK_DETECTED',
    ]));
  });

  it('fails when identity fingerprints do not match the separately recorded profiles', () => {
    const manifest = validManifest();
    manifest.storeIsolationCapture.isolation.toIdentityFingerprint = HASH_A;

    expect(violationCodes(manifest)).toContain('STORE_ISOLATION_IDENTITY_FINGERPRINT_INVALID');
  });

  it('fails when a browser profile identity contains only whitespace', () => {
    const manifest = validManifest();
    const isolation = manifest.storeIsolationCapture.isolation;
    isolation.fromBrowserProfileId = '   ';
    isolation.fromIdentityFingerprint = fingerprint({
      browserProfileId: isolation.fromBrowserProfileId,
      storeId: 'SHC001',
    });

    expect(violationCodes(manifest)).toContain('STORE_ISOLATION_PROFILE_NOT_DISTINCT');
  });

  it('fails when browser profile identities differ only by surrounding whitespace', () => {
    const manifest = validManifest();
    const isolation = manifest.storeIsolationCapture.isolation;
    isolation.fromBrowserProfileId = ' preview-profile-shared ';
    isolation.toBrowserProfileId = 'preview-profile-shared';
    isolation.fromIdentityFingerprint = fingerprint({
      browserProfileId: isolation.fromBrowserProfileId,
      storeId: 'SHC001',
    });
    isolation.toIdentityFingerprint = fingerprint({
      browserProfileId: isolation.toBrowserProfileId,
      storeId: 'SHC002',
    });

    expect(violationCodes(manifest)).toContain('STORE_ISOLATION_PROFILE_NOT_DISTINCT');
  });
});

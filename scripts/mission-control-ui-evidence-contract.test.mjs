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
    h1: { count: 1, text: `${workspace} workspace` },
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
        fromStoreScopedFingerprint: HASH_A,
        toStoreScopedFingerprint: HASH_B,
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
});

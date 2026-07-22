const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MISSION_CONTROL_UI_EVIDENCE_SCHEMA_VERSION = 'mission-control-ui-evidence/v1';
const MISSION_CONTROL_UI_EVIDENCE_KIND = 'mission-control-ui-evidence';
const EXPECTED_MISSION_CONTROL_SCALES = Object.freeze([100, 125]);
const EXPECTED_MISSION_CONTROL_STORE_IDS = Object.freeze(['SHC001', 'SHC002']);

const MISSION_CONTROL_WORKSPACE_CONTRACT = Object.freeze({
  today: Object.freeze({
    defaultIntent: Object.freeze({ workspace: 'today', subview: 'overview', view: 'today/overview' }),
    tabs: Object.freeze(['overview', 'events']),
  }),
  missions: Object.freeze({
    defaultIntent: Object.freeze({ workspace: 'missions', subview: 'overview', view: 'missions/overview' }),
    tabs: Object.freeze(['overview', 'facts']),
  }),
  decisions: Object.freeze({
    defaultIntent: Object.freeze({ workspace: 'decisions', subview: 'recommendations', view: 'decisions/recommendations' }),
    tabs: Object.freeze(['recommendations', 'approval', 'decided']),
  }),
  experiments: Object.freeze({
    defaultIntent: Object.freeze({ workspace: 'experiments', subview: 'ledger', view: 'experiments/ledger' }),
    tabs: Object.freeze(['ledger']),
  }),
  execution: Object.freeze({
    defaultIntent: Object.freeze({ workspace: 'execution', subview: 'live', view: 'execution/live' }),
    tabs: Object.freeze(['live', 'evidence']),
  }),
  memory: Object.freeze({
    defaultIntent: Object.freeze({ workspace: 'memory', subview: 'timeline', view: 'memory/timeline' }),
    tabs: Object.freeze(['timeline']),
  }),
  objects: Object.freeze({
    defaultIntent: Object.freeze({ workspace: 'objects', subview: 'products', view: 'objects/products' }),
    tabs: Object.freeze(['products', 'targets', 'keywords', 'listing']),
  }),
  collection: Object.freeze({
    defaultIntent: Object.freeze({ workspace: 'collection', subview: 'scope', view: 'collection/scope' }),
    tabs: Object.freeze(['scope', 'reports', 'import-check']),
  }),
  policy: Object.freeze({
    defaultIntent: Object.freeze({ workspace: 'policy', subview: 'rules', view: 'policy/rules' }),
    tabs: Object.freeze(['rules']),
  }),
  settings: Object.freeze({
    defaultIntent: Object.freeze({ workspace: 'settings', subview: 'ai-and-local', view: 'settings/ai-and-local' }),
    tabs: Object.freeze(['ai-and-local', 'scheduler', 'delivery']),
  }),
});

const EXPECTED_MISSION_CONTROL_WORKSPACES = Object.freeze(
  Object.keys(MISSION_CONTROL_WORKSPACE_CONTRACT),
);

/**
 * Machine-readable minimum shape. Cross-capture invariants (the exact
 * workspace/scale matrix, registered default intents, StoreGate behavior and
 * store isolation) intentionally remain in the validator below because JSON
 * Schema cannot express them without duplicating the product registry.
 */
const MISSION_CONTROL_UI_EVIDENCE_JSON_SCHEMA = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: MISSION_CONTROL_UI_EVIDENCE_SCHEMA_VERSION,
  title: 'Mission Control Stage2 UI evidence',
  type: 'object',
  required: [
    'kind',
    'schemaVersion',
    'generatedAt',
    'status',
    'readinessImpact',
    'finalReadinessCredit',
    'workspaceCaptures',
    'storeGateCapture',
    'storeIsolationCapture',
    'minimumWindowCapture',
  ],
  properties: {
    kind: { const: MISSION_CONTROL_UI_EVIDENCE_KIND },
    schemaVersion: { const: MISSION_CONTROL_UI_EVIDENCE_SCHEMA_VERSION },
    generatedAt: { type: 'string', format: 'date-time' },
    status: { const: 'STAGE2_UI_EVIDENCE' },
    readinessImpact: { const: 'NO_FINAL_READINESS_CREDIT' },
    finalReadinessCredit: { const: false },
    workspaceCaptures: {
      type: 'array',
      minItems: 20,
      maxItems: 20,
      items: { $ref: '#/$defs/workspaceCapture' },
    },
    storeGateCapture: { type: 'object' },
    storeIsolationCapture: { allOf: [{ $ref: '#/$defs/workspaceCapture' }, { type: 'object' }] },
    minimumWindowCapture: { allOf: [{ $ref: '#/$defs/workspaceCapture' }, { type: 'object' }] },
  },
  $defs: {
    screenshot: {
      type: 'object',
      required: ['absolutePath', 'sha256'],
      properties: {
        absolutePath: { type: 'string', minLength: 1, pattern: '\\.png$' },
        sha256: { type: 'string', pattern: '^[A-Fa-f0-9]{64}$' },
      },
    },
    viewport: {
      type: 'object',
      required: ['width', 'height', 'clientWidth', 'scrollWidth', 'deviceScaleFactor', 'horizontalOverflow'],
      properties: {
        width: { type: 'integer', minimum: 1 },
        height: { type: 'integer', minimum: 1 },
        clientWidth: { type: 'integer', minimum: 1 },
        scrollWidth: { type: 'integer', minimum: 1 },
        deviceScaleFactor: { enum: [1, 1.25] },
        horizontalOverflow: { const: false },
      },
    },
    runtimeErrors: {
      type: 'object',
      required: ['console', 'page'],
      properties: {
        console: { type: 'array', maxItems: 0 },
        page: { type: 'array', maxItems: 0 },
      },
    },
    authority: {
      type: 'object',
      required: ['storeId', 'marketplace', 'currency'],
      properties: {
        storeId: { type: 'string', minLength: 1 },
        marketplace: { const: 'US' },
        currency: { const: 'USD' },
      },
    },
    autonomy: {
      type: 'object',
      required: ['currentMode', 'policyAutoAvailable', 'policyAutoState', 'policyAutoBlockerCode'],
      properties: {
        currentMode: { const: 'manual_approval' },
        policyAutoAvailable: { const: false },
        policyAutoState: { const: 'BLOCKED' },
        policyAutoBlockerCode: { type: 'string', minLength: 1 },
      },
    },
    workspaceCapture: {
      type: 'object',
      required: [
        'captureId',
        'captureType',
        'workspace',
        'defaultIntent',
        'scalePercent',
        'screenshot',
        'viewport',
        'h1',
        'tabs',
        'authority',
        'autonomy',
        'errors',
      ],
      properties: {
        captureId: { type: 'string', minLength: 1 },
        workspace: { enum: EXPECTED_MISSION_CONTROL_WORKSPACES },
        scalePercent: { enum: EXPECTED_MISSION_CONTROL_SCALES },
        screenshot: { $ref: '#/$defs/screenshot' },
        viewport: { $ref: '#/$defs/viewport' },
        authority: { $ref: '#/$defs/authority' },
        autonomy: { $ref: '#/$defs/autonomy' },
        errors: { $ref: '#/$defs/runtimeErrors' },
      },
    },
  },
});

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sameStringArray(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function isAbsoluteScreenshotPath(value) {
  return typeof value === 'string'
    && value.length > 0
    && (path.win32.isAbsolute(value) || path.posix.isAbsolute(value))
    && path.extname(value).toLowerCase() === '.png';
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function isPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function addViolation(violations, code, evidencePath, message, details = {}) {
  violations.push({ code, path: evidencePath, message, ...details });
}

function validateScreenshot(capture, capturePath, violations, options = {}) {
  if (!isRecord(capture.screenshot)) {
    addViolation(violations, 'SCREENSHOT_MISSING', `${capturePath}.screenshot`, 'Capture must include screenshot evidence.');
    return;
  }
  if (!isAbsoluteScreenshotPath(capture.screenshot.absolutePath)) {
    addViolation(
      violations,
      'SCREENSHOT_PATH_NOT_ABSOLUTE',
      `${capturePath}.screenshot.absolutePath`,
      'Screenshot path must be an absolute PNG path.',
    );
  }
  if (!isSha256(capture.screenshot.sha256)) {
    addViolation(
      violations,
      'SCREENSHOT_SHA256_MISSING',
      `${capturePath}.screenshot.sha256`,
      'Screenshot must carry a 64-character SHA-256 digest.',
    );
  }
  if (options.verifyScreenshotFiles !== true || !isAbsoluteScreenshotPath(capture.screenshot.absolutePath)) {
    return;
  }
  if (!fs.existsSync(capture.screenshot.absolutePath)) {
    addViolation(
      violations,
      'SCREENSHOT_FILE_MISSING',
      `${capturePath}.screenshot.absolutePath`,
      'Screenshot file must exist when filesystem verification is enabled.',
    );
    return;
  }
  if (isSha256(capture.screenshot.sha256)) {
    const actualSha256 = crypto
      .createHash('sha256')
      .update(fs.readFileSync(capture.screenshot.absolutePath))
      .digest('hex');
    if (actualSha256.toLowerCase() !== capture.screenshot.sha256.toLowerCase()) {
      addViolation(
        violations,
        'SCREENSHOT_SHA256_MISMATCH',
        `${capturePath}.screenshot.sha256`,
        'Screenshot SHA-256 must match the referenced PNG bytes.',
        { actual: actualSha256, expected: capture.screenshot.sha256 },
      );
    }
  }
}

function validateViewport(capture, capturePath, violations) {
  const viewport = capture.viewport;
  if (!isRecord(viewport)) {
    addViolation(violations, 'VIEWPORT_MISSING', `${capturePath}.viewport`, 'Capture must include viewport metrics.');
    return;
  }
  for (const key of ['width', 'height', 'clientWidth', 'scrollWidth']) {
    if (!isPositiveInteger(viewport[key])) {
      addViolation(
        violations,
        'VIEWPORT_METRIC_INVALID',
        `${capturePath}.viewport.${key}`,
        `${key} must be a positive integer.`,
      );
    }
  }
  const expectedDeviceScaleFactor = capture.scalePercent === 125 ? 1.25 : 1;
  if (viewport.deviceScaleFactor !== expectedDeviceScaleFactor) {
    addViolation(
      violations,
      'DEVICE_SCALE_FACTOR_MISMATCH',
      `${capturePath}.viewport.deviceScaleFactor`,
      `deviceScaleFactor must be ${expectedDeviceScaleFactor} at ${capture.scalePercent}% evidence scale.`,
    );
  }
  if (viewport.horizontalOverflow !== false) {
    addViolation(
      violations,
      'HORIZONTAL_OVERFLOW_REPORTED',
      `${capturePath}.viewport.horizontalOverflow`,
      'Capture must explicitly report no horizontal overflow.',
    );
  }
  if (
    isPositiveInteger(viewport.clientWidth)
    && isPositiveInteger(viewport.scrollWidth)
    && viewport.scrollWidth > viewport.clientWidth
  ) {
    addViolation(
      violations,
      'HORIZONTAL_OVERFLOW_DETECTED',
      `${capturePath}.viewport.scrollWidth`,
      'scrollWidth must not exceed clientWidth.',
      { actual: viewport.scrollWidth, expectedMaximum: viewport.clientWidth },
    );
  }
}

function validateErrors(capture, capturePath, violations) {
  const errors = capture.errors;
  if (!isRecord(errors)) {
    addViolation(violations, 'RUNTIME_ERRORS_MISSING', `${capturePath}.errors`, 'Capture must include console and page error arrays.');
    return;
  }
  for (const channel of ['console', 'page']) {
    if (!Array.isArray(errors[channel])) {
      addViolation(
        violations,
        'RUNTIME_ERROR_CHANNEL_MISSING',
        `${capturePath}.errors.${channel}`,
        `${channel} errors must be recorded as an array.`,
      );
    } else if (errors[channel].length > 0) {
      addViolation(
        violations,
        channel === 'console' ? 'CONSOLE_ERRORS_PRESENT' : 'PAGE_ERRORS_PRESENT',
        `${capturePath}.errors.${channel}`,
        `${channel} errors must be empty.`,
        { count: errors[channel].length },
      );
    }
  }
}

function validateMarketAuthority(authority, authorityPath, violations, expectedStoreId) {
  if (!isRecord(authority)) {
    addViolation(violations, 'STORE_AUTHORITY_MISSING', authorityPath, 'Capture must include Main-authoritative store context.');
    return;
  }
  if (authority.storeId !== expectedStoreId) {
    addViolation(
      violations,
      'STORE_AUTHORITY_MISMATCH',
      `${authorityPath}.storeId`,
      `Authoritative storeId must be ${expectedStoreId}.`,
      { actual: authority.storeId, expected: expectedStoreId },
    );
  }
  if (authority.marketplace !== 'US') {
    addViolation(
      violations,
      'MARKETPLACE_NOT_US',
      `${authorityPath}.marketplace`,
      'Mission Control Stage2 evidence is US-only.',
      { actual: authority.marketplace, expected: 'US' },
    );
  }
  if (authority.currency !== 'USD') {
    addViolation(
      violations,
      'CURRENCY_NOT_USD',
      `${authorityPath}.currency`,
      'Mission Control Stage2 evidence must use USD.',
      { actual: authority.currency, expected: 'USD' },
    );
  }
}

function validateAutonomy(capture, capturePath, violations) {
  const autonomy = capture.autonomy;
  if (!isRecord(autonomy)) {
    addViolation(violations, 'AUTONOMY_EVIDENCE_MISSING', `${capturePath}.autonomy`, 'Capture must include autonomy authority.');
    return;
  }
  if (
    autonomy.currentMode !== 'manual_approval'
    || autonomy.policyAutoAvailable !== false
    || autonomy.policyAutoState !== 'BLOCKED'
    || typeof autonomy.policyAutoBlockerCode !== 'string'
    || autonomy.policyAutoBlockerCode.trim().length === 0
  ) {
    addViolation(
      violations,
      'POLICY_AUTO_NOT_BLOCKED',
      `${capturePath}.autonomy`,
      'Stage2 evidence must prove policy-auto is unavailable and visibly BLOCKED under manual approval.',
    );
  }
}

function validateHeading(capture, capturePath, violations) {
  const h1 = capture.h1;
  if (!isRecord(h1) || h1.count !== 1 || typeof h1.text !== 'string' || h1.text.trim().length === 0) {
    addViolation(
      violations,
      'H1_CONTRACT_INVALID',
      `${capturePath}.h1`,
      'Workspace capture must expose exactly one non-empty h1.',
    );
  }
}

function validateWorkspaceCapture(capture, capturePath, violations, options = {}) {
  if (!isRecord(capture)) {
    addViolation(violations, 'WORKSPACE_CAPTURE_INVALID', capturePath, 'Workspace capture must be an object.');
    return;
  }
  const contract = MISSION_CONTROL_WORKSPACE_CONTRACT[capture.workspace];
  if (typeof capture.captureId !== 'string' || capture.captureId.trim().length === 0) {
    addViolation(
      violations,
      'CAPTURE_ID_MISSING',
      `${capturePath}.captureId`,
      'Capture must include a stable non-empty captureId.',
    );
  }
  const expectedCaptureType = options.expectedCaptureType || 'workspace';
  if (capture.captureType !== expectedCaptureType) {
    addViolation(
      violations,
      'CAPTURE_TYPE_INVALID',
      `${capturePath}.captureType`,
      `captureType must be ${expectedCaptureType}.`,
    );
  }
  if (!contract) {
    addViolation(
      violations,
      'WORKSPACE_UNKNOWN',
      `${capturePath}.workspace`,
      `Unknown Mission Control workspace: ${String(capture.workspace)}.`,
    );
  }
  if (!EXPECTED_MISSION_CONTROL_SCALES.includes(capture.scalePercent)) {
    addViolation(
      violations,
      'SCALE_UNSUPPORTED',
      `${capturePath}.scalePercent`,
      'Workspace evidence scale must be 100 or 125.',
    );
  }
  if (contract) {
    const intent = capture.defaultIntent;
    if (
      !isRecord(intent)
      || intent.workspace !== contract.defaultIntent.workspace
      || intent.subview !== contract.defaultIntent.subview
      || intent.view !== contract.defaultIntent.view
    ) {
      addViolation(
        violations,
        'DEFAULT_INTENT_MISMATCH',
        `${capturePath}.defaultIntent`,
        `Capture must use the registered default intent ${contract.defaultIntent.view}.`,
      );
    }
    const tabs = capture.tabs;
    if (
      !isRecord(tabs)
      || !sameStringArray(tabs.renderedSubviews, contract.tabs)
      || tabs.activeSubview !== contract.defaultIntent.subview
    ) {
      addViolation(
        violations,
        'WORKSPACE_TABS_MISMATCH',
        `${capturePath}.tabs`,
        `Rendered tabs and active tab must match the ${capture.workspace} workspace contract.`,
      );
    }
  }
  validateScreenshot(capture, capturePath, violations, options);
  validateViewport(capture, capturePath, violations);
  validateHeading(capture, capturePath, violations);
  validateMarketAuthority(
    capture.authority,
    `${capturePath}.authority`,
    violations,
    options.expectedStoreId || 'SHC001',
  );
  validateAutonomy(capture, capturePath, violations);
  validateErrors(capture, capturePath, violations);
}

function validateStoreGateCapture(capture, violations, options = {}) {
  const capturePath = 'storeGateCapture';
  if (!isRecord(capture)) {
    addViolation(violations, 'STORE_GATE_CAPTURE_MISSING', capturePath, 'StoreGate evidence capture is required.');
    return;
  }
  if (capture.captureType !== 'store-gate' || capture.state !== 'needs-selection') {
    addViolation(
      violations,
      'STORE_GATE_STATE_INVALID',
      capturePath,
      'StoreGate capture must prove the needs-selection state.',
    );
  }
  if (capture.activeStoreId !== null || capture.explicitSelectionRequired !== true || capture.autoSelected !== false) {
    addViolation(
      violations,
      'STORE_GATE_AUTO_SELECTION_UNSAFE',
      capturePath,
      'StoreGate must have no active store and must require explicit selection.',
    );
  }
  if (!sameStringArray(capture.availableStoreIds, EXPECTED_MISSION_CONTROL_STORE_IDS)) {
    addViolation(
      violations,
      'STORE_GATE_STORE_SET_MISMATCH',
      `${capturePath}.availableStoreIds`,
      'StoreGate must show the two isolated preview stores in deterministic order.',
    );
  }
  if (capture.marketplace !== 'US') {
    addViolation(violations, 'MARKETPLACE_NOT_US', `${capturePath}.marketplace`, 'StoreGate must be US-only.');
  }
  if (capture.currency !== 'USD') {
    addViolation(violations, 'CURRENCY_NOT_USD', `${capturePath}.currency`, 'StoreGate must use USD.');
  }
  if (!EXPECTED_MISSION_CONTROL_SCALES.includes(capture.scalePercent)) {
    addViolation(violations, 'SCALE_UNSUPPORTED', `${capturePath}.scalePercent`, 'StoreGate evidence scale must be 100 or 125.');
  }
  validateScreenshot(capture, capturePath, violations, options);
  validateViewport(capture, capturePath, violations);
  validateHeading(capture, capturePath, violations);
  validateErrors(capture, capturePath, violations);
}

function validateStoreIsolationCapture(capture, violations, options = {}) {
  const capturePath = 'storeIsolationCapture';
  validateWorkspaceCapture(capture, capturePath, violations, {
    ...options,
    expectedCaptureType: 'store-isolation',
    expectedStoreId: 'SHC002',
  });
  if (!isRecord(capture)) return;
  const transition = capture.transition;
  if (
    !isRecord(transition)
    || transition.fromStoreId !== 'SHC001'
    || transition.toStoreId !== 'SHC002'
    || transition.explicitUserAction !== true
    || transition.automatic !== false
  ) {
    addViolation(
      violations,
      'STORE_ISOLATION_TRANSITION_INVALID',
      `${capturePath}.transition`,
      'Isolation evidence must record an explicit SHC001 to SHC002 switch.',
    );
  }
  const isolation = capture.isolation;
  if (!isRecord(isolation)) {
    addViolation(violations, 'STORE_ISOLATION_ASSERTIONS_MISSING', `${capturePath}.isolation`, 'Isolation assertions are required.');
    return;
  }
  if (
    isolation.previousStoreVisible !== false
    || !Array.isArray(isolation.leakedStoreIds)
    || isolation.leakedStoreIds.length !== 0
  ) {
    addViolation(
      violations,
      'STORE_ISOLATION_LEAK_DETECTED',
      `${capturePath}.isolation`,
      'SHC002 capture must not expose SHC001 or any leaked store identity.',
    );
  }
  if (
    typeof isolation.fromBrowserProfileId !== 'string'
    || typeof isolation.toBrowserProfileId !== 'string'
    || !isolation.fromBrowserProfileId
    || !isolation.toBrowserProfileId
    || isolation.fromBrowserProfileId === isolation.toBrowserProfileId
  ) {
    addViolation(
      violations,
      'STORE_ISOLATION_PROFILE_NOT_DISTINCT',
      `${capturePath}.isolation`,
      'The two stores must use distinct non-empty browser profile identities.',
    );
  }
  if (
    !isSha256(isolation.fromStoreScopedFingerprint)
    || !isSha256(isolation.toStoreScopedFingerprint)
    || isolation.fromStoreScopedFingerprint === isolation.toStoreScopedFingerprint
  ) {
    addViolation(
      violations,
      'STORE_ISOLATION_FACTS_NOT_DISTINCT',
      `${capturePath}.isolation`,
      'The two stores must have distinct SHA-256 store-scoped fact fingerprints.',
    );
  }
}

function validateMinimumWindowCapture(capture, violations, options = {}) {
  const capturePath = 'minimumWindowCapture';
  validateWorkspaceCapture(capture, capturePath, violations, {
    ...options,
    expectedCaptureType: 'minimum-window',
    expectedStoreId: 'SHC001',
  });
  if (!isRecord(capture)) return;
  if (capture.workspace !== 'execution' || capture.scalePercent !== 100) {
    addViolation(
      violations,
      'MINIMUM_WINDOW_CAPTURE_TARGET_INVALID',
      capturePath,
      'Minimum-window evidence must capture execution/live at 100%.',
    );
  }
  if (capture.viewport?.width !== 1200) {
    addViolation(
      violations,
      'MINIMUM_WINDOW_WIDTH_INVALID',
      `${capturePath}.viewport.width`,
      'Minimum-window evidence must use the supported 1200px application width.',
    );
  }
  const layout = capture.executionLayout;
  if (!isRecord(layout)) {
    addViolation(
      violations,
      'MINIMUM_WINDOW_LAYOUT_MISSING',
      `${capturePath}.executionLayout`,
      'Minimum-window evidence must include execution table layout measurements.',
    );
    return;
  }
  if (
    layout.roomColumnCount !== 1
    || layout.tableClipped !== false
    || layout.scrollContainerOverflowX !== 'auto'
    || !isPositiveInteger(layout.frameClientWidth)
    || !isPositiveInteger(layout.tableClientWidth)
    || !isPositiveInteger(layout.tableScrollWidth)
  ) {
    addViolation(
      violations,
      'MINIMUM_WINDOW_EXECUTION_CLIPPED',
      `${capturePath}.executionLayout`,
      'At 1200px the execution room must be one column and its wide table must not be clipped.',
    );
  }
}

function evaluateMissionControlUiEvidenceManifest(value, options = {}) {
  const violations = [];
  if (!isRecord(value)) {
    addViolation(violations, 'MANIFEST_INVALID', '$', 'Mission Control UI evidence manifest must be an object.');
    return { passed: false, violations };
  }
  if (value.kind !== MISSION_CONTROL_UI_EVIDENCE_KIND) {
    addViolation(violations, 'MANIFEST_KIND_INVALID', 'kind', `kind must be ${MISSION_CONTROL_UI_EVIDENCE_KIND}.`);
  }
  if (value.schemaVersion !== MISSION_CONTROL_UI_EVIDENCE_SCHEMA_VERSION) {
    addViolation(
      violations,
      'SCHEMA_VERSION_INVALID',
      'schemaVersion',
      `schemaVersion must be ${MISSION_CONTROL_UI_EVIDENCE_SCHEMA_VERSION}.`,
    );
  }
  if (typeof value.generatedAt !== 'string' || Number.isNaN(Date.parse(value.generatedAt))) {
    addViolation(violations, 'GENERATED_AT_INVALID', 'generatedAt', 'generatedAt must be an ISO-compatible timestamp.');
  }
  if (
    value.status !== 'STAGE2_UI_EVIDENCE'
    || value.readinessImpact !== 'NO_FINAL_READINESS_CREDIT'
    || value.finalReadinessCredit !== false
  ) {
    addViolation(
      violations,
      'READINESS_SCOPE_UNSAFE',
      'status',
      'Stage2 UI evidence must explicitly carry no final production-readiness credit.',
    );
  }

  if (!Array.isArray(value.workspaceCaptures)) {
    addViolation(violations, 'WORKSPACE_CAPTURES_MISSING', 'workspaceCaptures', 'workspaceCaptures must be an array.');
  } else {
    value.workspaceCaptures.forEach((capture, index) => {
      validateWorkspaceCapture(capture, `workspaceCaptures[${index}]`, violations, options);
    });
    const expectedCaptureCount = EXPECTED_MISSION_CONTROL_WORKSPACES.length
      * EXPECTED_MISSION_CONTROL_SCALES.length;
    if (value.workspaceCaptures.length !== expectedCaptureCount) {
      addViolation(
        violations,
        'WORKSPACE_CAPTURE_COUNT_MISMATCH',
        'workspaceCaptures',
        `Exactly ${expectedCaptureCount} workspace captures are required.`,
        { actual: value.workspaceCaptures.length, expected: expectedCaptureCount },
      );
    }
    for (const workspace of EXPECTED_MISSION_CONTROL_WORKSPACES) {
      for (const scalePercent of EXPECTED_MISSION_CONTROL_SCALES) {
        const matches = value.workspaceCaptures.filter((capture) => (
          capture?.workspace === workspace && capture?.scalePercent === scalePercent
        ));
        if (matches.length !== 1) {
          addViolation(
            violations,
            matches.length === 0 ? 'WORKSPACE_SCALE_CAPTURE_MISSING' : 'WORKSPACE_SCALE_CAPTURE_DUPLICATE',
            'workspaceCaptures',
            `Expected exactly one ${workspace} capture at ${scalePercent}%.`,
            { actual: matches.length, workspace, scalePercent },
          );
        }
      }
    }
  }

  validateStoreGateCapture(value.storeGateCapture, violations, options);
  validateStoreIsolationCapture(value.storeIsolationCapture, violations, options);
  validateMinimumWindowCapture(value.minimumWindowCapture, violations, options);

  return {
    passed: violations.length === 0,
    expectedWorkspaceCount: EXPECTED_MISSION_CONTROL_WORKSPACES.length,
    expectedWorkspaceCaptureCount: EXPECTED_MISSION_CONTROL_WORKSPACES.length
      * EXPECTED_MISSION_CONTROL_SCALES.length,
    violations,
  };
}

function validateMissionControlUiEvidenceManifest(value, options = {}) {
  const result = evaluateMissionControlUiEvidenceManifest(value, options);
  if (!result.passed) {
    const summary = result.violations
      .map((violation) => `${violation.code} at ${violation.path}: ${violation.message}`)
      .join('\n');
    const error = new Error(`Mission Control UI evidence manifest failed validation:\n${summary}`);
    error.code = 'MISSION_CONTROL_UI_EVIDENCE_INVALID';
    error.violations = result.violations;
    throw error;
  }
  return value;
}

function main(argv = process.argv.slice(2)) {
  const inputPath = argv[0];
  if (!inputPath || argv.length !== 1) {
    throw new Error('Usage: node scripts/mission-control-ui-evidence-contract.js <manifest.json>');
  }
  const absolutePath = path.resolve(inputPath);
  const manifest = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  const result = evaluateMissionControlUiEvidenceManifest(manifest, { verifyScreenshotFiles: true });
  if (!result.passed) {
    for (const violation of result.violations) {
      console.error(`[FAIL] ${violation.code} ${violation.path}: ${violation.message}`);
    }
    process.exitCode = 1;
    return result;
  }
  console.log(`[PASS] Mission Control UI evidence: ${absolutePath}`);
  console.log(`[PASS] ${result.expectedWorkspaceCaptureCount} workspace captures + StoreGate + SHC001->SHC002 isolation + 1200px minimum-window execution`);
  return result;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[FAIL] ${String(error?.message || error)}`);
    process.exitCode = 1;
  }
}

module.exports = {
  EXPECTED_MISSION_CONTROL_SCALES,
  EXPECTED_MISSION_CONTROL_STORE_IDS,
  EXPECTED_MISSION_CONTROL_WORKSPACES,
  MISSION_CONTROL_UI_EVIDENCE_KIND,
  MISSION_CONTROL_UI_EVIDENCE_JSON_SCHEMA,
  MISSION_CONTROL_UI_EVIDENCE_SCHEMA_VERSION,
  MISSION_CONTROL_WORKSPACE_CONTRACT,
  evaluateMissionControlUiEvidenceManifest,
  isAbsoluteScreenshotPath,
  isSha256,
  main,
  validateMissionControlUiEvidenceManifest,
  validateMinimumWindowCapture,
};

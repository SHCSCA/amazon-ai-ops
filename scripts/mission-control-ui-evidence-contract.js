const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MISSION_CONTROL_UI_EVIDENCE_SCHEMA_VERSION = 'mission-control-ui-evidence/v2';
const MISSION_CONTROL_UI_EVIDENCE_KIND = 'mission-control-ui-evidence';
const EXPECTED_MISSION_CONTROL_SCALES = Object.freeze([100, 125]);
const EXPECTED_MISSION_CONTROL_STORE_IDS = Object.freeze(['SHC001', 'SHC002']);

const MISSION_CONTROL_WORKSPACE_CONTRACT = Object.freeze({
  today: Object.freeze({
    defaultIntent: Object.freeze({ workspace: 'today', subview: 'overview', view: 'today/overview' }),
    heading: '今日任务',
    tabs: Object.freeze(['overview', 'events']),
  }),
  missions: Object.freeze({
    defaultIntent: Object.freeze({ workspace: 'missions', subview: 'overview', view: 'missions/overview' }),
    heading: '任务中心',
    tabs: Object.freeze(['overview', 'facts']),
  }),
  decisions: Object.freeze({
    defaultIntent: Object.freeze({ workspace: 'decisions', subview: 'recommendations', view: 'decisions/recommendations' }),
    heading: '建议与审批',
    tabs: Object.freeze(['recommendations', 'approval', 'decided']),
  }),
  experiments: Object.freeze({
    defaultIntent: Object.freeze({ workspace: 'experiments', subview: 'ledger', view: 'experiments/ledger' }),
    heading: '经营实验',
    tabs: Object.freeze(['ledger']),
  }),
  execution: Object.freeze({
    defaultIntent: Object.freeze({ workspace: 'execution', subview: 'live', view: 'execution/live' }),
    heading: '实时执行',
    tabs: Object.freeze(['live', 'evidence']),
  }),
  memory: Object.freeze({
    defaultIntent: Object.freeze({ workspace: 'memory', subview: 'timeline', view: 'memory/timeline' }),
    heading: '因果记忆',
    tabs: Object.freeze(['timeline']),
  }),
  objects: Object.freeze({
    defaultIntent: Object.freeze({ workspace: 'objects', subview: 'products', view: 'objects/products' }),
    heading: '产品与广告对象',
    tabs: Object.freeze(['products', 'targets', 'keywords', 'listing']),
  }),
  collection: Object.freeze({
    defaultIntent: Object.freeze({ workspace: 'collection', subview: 'scope', view: 'collection/scope' }),
    heading: '工作范围',
    tabs: Object.freeze(['scope', 'reports', 'import-check']),
  }),
  policy: Object.freeze({
    defaultIntent: Object.freeze({ workspace: 'policy', subview: 'rules', view: 'policy/rules' }),
    heading: '策略与风控',
    tabs: Object.freeze(['rules']),
  }),
  settings: Object.freeze({
    defaultIntent: Object.freeze({ workspace: 'settings', subview: 'ai-and-local', view: 'settings/ai-and-local' }),
    heading: '店铺与运行设置',
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
  title: 'Mission Control Stage7 UI evidence',
  type: 'object',
  required: [
    'kind',
    'schemaVersion',
    'generatedAt',
    'status',
    'readinessImpact',
    'finalReadinessCredit',
    'source',
    'workspaceCaptures',
    'storeGateCapture',
    'storeIsolationCapture',
    'minimumWindowCapture',
  ],
  properties: {
    kind: { const: MISSION_CONTROL_UI_EVIDENCE_KIND },
    schemaVersion: { const: MISSION_CONTROL_UI_EVIDENCE_SCHEMA_VERSION },
    generatedAt: { type: 'string', format: 'date-time' },
    status: { const: 'STAGE7_UI_EVIDENCE' },
    readinessImpact: { const: 'NO_FINAL_READINESS_CREDIT' },
    finalReadinessCredit: { const: false },
    source: {
      type: 'object',
      additionalProperties: false,
      required: [
        'runtime',
        'scenario',
        'runnerSha256',
        'contractSha256',
        'rendererTreeSha256',
        'realLoginAccessed',
        'authorityDatabaseAccessed',
        'adsWriteAttempted',
      ],
      properties: {
        runtime: { const: 'vite-dev-preview' },
        scenario: { const: 'diagnosis-ready' },
        runnerSha256: { type: 'string', pattern: '^[A-Fa-f0-9]{64}$' },
        contractSha256: { type: 'string', pattern: '^[A-Fa-f0-9]{64}$' },
        rendererTreeSha256: { type: 'string', pattern: '^[A-Fa-f0-9]{64}$' },
        realLoginAccessed: { const: false },
        authorityDatabaseAccessed: { const: false },
        adsWriteAttempted: { const: false },
      },
    },
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
      required: ['currentMode', 'manualApprovalAvailable', 'policyAutoAvailable', 'policyAutoState'],
      properties: {
        currentMode: { enum: ['manual_approval', 'policy_auto'] },
        manualApprovalAvailable: { const: true },
        policyAutoAvailable: { type: 'boolean' },
        policyAutoState: { enum: ['AVAILABLE', 'BLOCKED'] },
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

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function sha256Tree(rootDir) {
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (entry.isFile()) {
        files.push(absolutePath);
      }
    }
  };
  visit(rootDir);
  files.sort((left, right) => left.localeCompare(right, 'en'));
  const hash = crypto.createHash('sha256');
  for (const filePath of files) {
    hash.update(path.relative(rootDir, filePath).replace(/\\/g, '/'));
    hash.update('\0');
    hash.update(fs.readFileSync(filePath));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function currentMissionControlUiEvidenceSourceHashes(repoRoot = path.resolve(__dirname, '..')) {
  return {
    runnerSha256: sha256File(path.join(repoRoot, 'scripts', 'run-mission-control-ui-evidence.js')),
    contractSha256: sha256File(__filename),
    rendererTreeSha256: sha256Tree(path.join(repoRoot, 'apps', 'desktop', 'src', 'renderer')),
  };
}

function canonicalMissionControlEvidenceJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalMissionControlEvidenceJson).join(',')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalMissionControlEvidenceJson(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fingerprintMissionControlEvidenceValue(value) {
  return crypto
    .createHash('sha256')
    .update(canonicalMissionControlEvidenceJson(value))
    .digest('hex');
}

function missionControlBusinessFactSentinels(projection) {
  if (!isRecord(projection)) return [];
  const values = [
    projection.scope?.asin,
    projection.scope?.batchId,
    ...(Array.isArray(projection.productAsins) ? projection.productAsins : []),
    ...(Array.isArray(projection.keywordFacts)
      ? projection.keywordFacts.flatMap((fact) => [fact?.asin, fact?.keyword])
      : []),
  ];
  return [...new Set(values.filter((value) => (
    typeof value === 'string' && value.trim().length > 0
  )).map((value) => value.trim()))].sort((left, right) => left.localeCompare(right, 'en-US'));
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
      'Mission Control Stage7 evidence is US-only.',
      { actual: authority.marketplace, expected: 'US' },
    );
  }
  if (authority.currency !== 'USD') {
    addViolation(
      violations,
      'CURRENCY_NOT_USD',
      `${authorityPath}.currency`,
      'Mission Control Stage7 evidence must use USD.',
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
  const validMode = autonomy.currentMode === 'manual_approval' || autonomy.currentMode === 'policy_auto';
  const availabilityConsistent = (
    autonomy.policyAutoAvailable === true && autonomy.policyAutoState === 'AVAILABLE'
  ) || (
    autonomy.policyAutoAvailable === false
    && autonomy.policyAutoState === 'BLOCKED'
    && typeof autonomy.policyAutoBlockerCode === 'string'
    && autonomy.policyAutoBlockerCode.trim().length > 0
  );
  const activeModeAuthorized = autonomy.currentMode !== 'policy_auto' || autonomy.policyAutoAvailable === true;
  if (
    !validMode
    || autonomy.manualApprovalAvailable !== true
    || !availabilityConsistent
    || !activeModeAuthorized
  ) {
    addViolation(
      violations,
      'AUTONOMY_AUTHORITY_INCONSISTENT',
      `${capturePath}.autonomy`,
      'Stage7 evidence must show manual approval and policy-auto availability consistently with the Main authority projection.',
    );
  }
}

function validateHeading(capture, capturePath, violations, expectedHeading) {
  const h1 = capture.h1;
  if (!isRecord(h1) || h1.count !== 1 || typeof h1.text !== 'string' || h1.text.trim().length === 0) {
    addViolation(
      violations,
      'H1_CONTRACT_INVALID',
      `${capturePath}.h1`,
      'Workspace capture must expose exactly one non-empty h1.',
      { actual: h1, expected: expectedHeading || 'one non-empty h1' },
    );
    return;
  }
  if (typeof expectedHeading === 'string' && h1.text !== expectedHeading) {
    addViolation(
      violations,
      'H1_CONTRACT_INVALID',
      `${capturePath}.h1.text`,
      `Workspace h1 must exactly match the registered heading: ${expectedHeading}.`,
      { actual: h1.text, expected: expectedHeading },
    );
  }
}

function validateSourceProvenance(source, violations, options = {}) {
  if (!isRecord(source)) {
    addViolation(
      violations,
      'SOURCE_PROVENANCE_MISSING',
      'source',
      'Stage7 evidence must include its preview-only source provenance.',
    );
    return;
  }
  const expectedKeys = [
    'adsWriteAttempted',
    'authorityDatabaseAccessed',
    'contractSha256',
    'realLoginAccessed',
    'rendererTreeSha256',
    'runnerSha256',
    'runtime',
    'scenario',
  ];
  if (!sameStringArray(Object.keys(source).sort(), expectedKeys)) {
    addViolation(
      violations,
      'SOURCE_PROVENANCE_FIELDS_INVALID',
      'source',
      'Source provenance must contain exactly the registered v2 fields.',
      { actual: Object.keys(source).sort(), expected: expectedKeys },
    );
  }
  if (source.runtime !== 'vite-dev-preview') {
    addViolation(
      violations,
      'SOURCE_RUNTIME_UNSAFE',
      'source.runtime',
      'Stage7 evidence must come from the Vite development preview runtime.',
      { actual: source.runtime, expected: 'vite-dev-preview' },
    );
  }
  if (source.scenario !== 'diagnosis-ready') {
    addViolation(
      violations,
      'SOURCE_SCENARIO_UNSAFE',
      'source.scenario',
      'Stage7 evidence must use the fixed diagnosis-ready preview scenario.',
      { actual: source.scenario, expected: 'diagnosis-ready' },
    );
  }
  for (const key of ['runnerSha256', 'contractSha256', 'rendererTreeSha256']) {
    if (!isSha256(source[key])) {
      addViolation(
        violations,
        'SOURCE_SHA256_INVALID',
        `source.${key}`,
        `${key} must be a 64-character SHA-256 digest.`,
      );
    } else if (
      isRecord(options.expectedSourceHashes)
      && isSha256(options.expectedSourceHashes[key])
      && source[key].toLowerCase() !== options.expectedSourceHashes[key].toLowerCase()
    ) {
      addViolation(
        violations,
        'SOURCE_SHA256_MISMATCH',
        `source.${key}`,
        `${key} must match the current Stage7 evidence source bytes.`,
        { actual: source[key], expected: options.expectedSourceHashes[key] },
      );
    }
  }
  for (const key of ['realLoginAccessed', 'authorityDatabaseAccessed', 'adsWriteAttempted']) {
    if (source[key] !== false) {
      addViolation(
        violations,
        'SOURCE_ACCESS_CLAIM_UNSAFE',
        `source.${key}`,
        `${key} must be exactly false for preview-only Stage7 evidence.`,
        { actual: source[key], expected: false },
      );
    }
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
  validateHeading(capture, capturePath, violations, contract?.heading);
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

function validateBusinessFactProjection(projection, projectionPath, violations) {
  const invalid = (message) => addViolation(
    violations,
    'STORE_ISOLATION_FACT_PROJECTION_INVALID',
    projectionPath,
    message,
  );
  if (!isRecord(projection)) {
    invalid('Store isolation must include a normalized business fact projection.');
    return false;
  }
  if (!sameStringArray(Object.keys(projection).sort(), ['keywordFacts', 'productAsins', 'scope'])) {
    invalid('Business fact projection may contain only scope, productAsins, and keywordFacts.');
    return false;
  }
  if (
    !isRecord(projection.scope)
    || !sameStringArray(Object.keys(projection.scope).sort(), ['asin', 'batchId'])
    || typeof projection.scope.asin !== 'string'
    || !projection.scope.asin.trim()
    || typeof projection.scope.batchId !== 'string'
    || !projection.scope.batchId.trim()
  ) {
    invalid('Business fact scope must include non-empty asin and batchId sentinels.');
    return false;
  }
  if (
    !Array.isArray(projection.productAsins)
    || projection.productAsins.length === 0
    || projection.productAsins.some((asin) => typeof asin !== 'string' || !asin.trim())
  ) {
    invalid('Business fact projection must include non-empty product ASIN facts.');
    return false;
  }
  if (
    !Array.isArray(projection.keywordFacts)
    || projection.keywordFacts.length === 0
    || projection.keywordFacts.some((fact) => (
      !isRecord(fact)
      || !sameStringArray(Object.keys(fact).sort(), ['asin', 'keyword'])
      || typeof fact.asin !== 'string'
      || !fact.asin.trim()
      || typeof fact.keyword !== 'string'
      || !fact.keyword.trim()
    ))
  ) {
    invalid('Business fact projection must include normalized ASIN and keyword facts.');
    return false;
  }
  return true;
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
  const normalizedFromBrowserProfileId = typeof isolation.fromBrowserProfileId === 'string'
    ? isolation.fromBrowserProfileId.trim()
    : '';
  const normalizedToBrowserProfileId = typeof isolation.toBrowserProfileId === 'string'
    ? isolation.toBrowserProfileId.trim()
    : '';
  if (
    !normalizedFromBrowserProfileId
    || !normalizedToBrowserProfileId
    || isolation.fromBrowserProfileId !== normalizedFromBrowserProfileId
    || isolation.toBrowserProfileId !== normalizedToBrowserProfileId
    || normalizedFromBrowserProfileId === normalizedToBrowserProfileId
  ) {
    addViolation(
      violations,
      'STORE_ISOLATION_PROFILE_NOT_DISTINCT',
      `${capturePath}.isolation`,
      'The two stores must use distinct non-empty browser profile identities.',
    );
  }

  const expectedFromIdentityFingerprint = fingerprintMissionControlEvidenceValue({
    browserProfileId: isolation.fromBrowserProfileId,
    storeId: transition?.fromStoreId,
  });
  const expectedToIdentityFingerprint = fingerprintMissionControlEvidenceValue({
    browserProfileId: isolation.toBrowserProfileId,
    storeId: transition?.toStoreId,
  });
  if (
    !isSha256(isolation.fromIdentityFingerprint)
    || !isSha256(isolation.toIdentityFingerprint)
    || isolation.fromIdentityFingerprint !== expectedFromIdentityFingerprint
    || isolation.toIdentityFingerprint !== expectedToIdentityFingerprint
    || isolation.fromIdentityFingerprint === isolation.toIdentityFingerprint
  ) {
    addViolation(
      violations,
      'STORE_ISOLATION_IDENTITY_FINGERPRINT_INVALID',
      `${capturePath}.isolation`,
      'Identity fingerprints must match the separately recorded store and browser profile identities.',
    );
  }

  const fromProjectionValid = validateBusinessFactProjection(
    isolation.fromBusinessFactProjection,
    `${capturePath}.isolation.fromBusinessFactProjection`,
    violations,
  );
  const toProjectionValid = validateBusinessFactProjection(
    isolation.toBusinessFactProjection,
    `${capturePath}.isolation.toBusinessFactProjection`,
    violations,
  );
  const expectedFromFactsFingerprint = fromProjectionValid
    ? fingerprintMissionControlEvidenceValue(isolation.fromBusinessFactProjection)
    : null;
  const expectedToFactsFingerprint = toProjectionValid
    ? fingerprintMissionControlEvidenceValue(isolation.toBusinessFactProjection)
    : null;
  if (
    !isSha256(isolation.fromBusinessFactsFingerprint)
    || !isSha256(isolation.toBusinessFactsFingerprint)
    || (expectedFromFactsFingerprint && isolation.fromBusinessFactsFingerprint !== expectedFromFactsFingerprint)
    || (expectedToFactsFingerprint && isolation.toBusinessFactsFingerprint !== expectedToFactsFingerprint)
  ) {
    addViolation(
      violations,
      'STORE_ISOLATION_FACT_FINGERPRINT_MISMATCH',
      `${capturePath}.isolation`,
      'Business fact fingerprints must be recomputable from the normalized projections.',
    );
  }
  if (
    expectedFromFactsFingerprint
    && expectedToFactsFingerprint
    && expectedFromFactsFingerprint === expectedToFactsFingerprint
  ) {
    addViolation(
      violations,
      'STORE_ISOLATION_FACTS_NOT_DISTINCT',
      `${capturePath}.isolation`,
      'The two stores must have distinct business facts independent of store or browser profile identity.',
    );
  }

  const expectedFromSentinels = missionControlBusinessFactSentinels(
    isolation.fromBusinessFactProjection,
  );
  const expectedToSentinels = missionControlBusinessFactSentinels(
    isolation.toBusinessFactProjection,
  );
  const sharedSentinels = expectedFromSentinels.filter((sentinel) => (
    expectedToSentinels.includes(sentinel)
  ));
  if (
    expectedFromSentinels.length === 0
    || expectedToSentinels.length === 0
    || !sameStringArray(isolation.fromBusinessFactSentinels, expectedFromSentinels)
    || !sameStringArray(isolation.toBusinessFactSentinels, expectedToSentinels)
    || !Array.isArray(isolation.leakedBusinessFactSentinels)
    || isolation.leakedBusinessFactSentinels.length > 0
    || sharedSentinels.length > 0
  ) {
    addViolation(
      violations,
      'STORE_ISOLATION_BUSINESS_FACT_LEAK_DETECTED',
      `${capturePath}.isolation`,
      'Business fact sentinels must be normalized, store-specific, and absent after switching stores.',
      {
        leakedSentinels: Array.isArray(isolation.leakedBusinessFactSentinels)
          ? isolation.leakedBusinessFactSentinels
          : [],
        sharedSentinels,
      },
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
    value.status !== 'STAGE7_UI_EVIDENCE'
    || value.readinessImpact !== 'NO_FINAL_READINESS_CREDIT'
    || value.finalReadinessCredit !== false
  ) {
    addViolation(
      violations,
      'READINESS_SCOPE_UNSAFE',
      'status',
      'Stage7 UI evidence must explicitly carry no final production-readiness credit.',
    );
  }
  validateSourceProvenance(value.source, violations, options);

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
  const result = evaluateMissionControlUiEvidenceManifest(manifest, {
    expectedSourceHashes: currentMissionControlUiEvidenceSourceHashes(),
    verifyScreenshotFiles: true,
  });
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
  canonicalMissionControlEvidenceJson,
  currentMissionControlUiEvidenceSourceHashes,
  evaluateMissionControlUiEvidenceManifest,
  fingerprintMissionControlEvidenceValue,
  isAbsoluteScreenshotPath,
  isSha256,
  main,
  missionControlBusinessFactSentinels,
  validateMissionControlUiEvidenceManifest,
  validateMinimumWindowCapture,
};

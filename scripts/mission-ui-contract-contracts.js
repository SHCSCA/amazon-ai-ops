// 按职责复用原有严格校验，公共入口继续保持兼容。
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

const EXPECTED_MISSION_CONTROL_WORKSPACES = Object.freeze(Object.keys(MISSION_CONTROL_WORKSPACE_CONTRACT));

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

function canonicalMissionControlEvidenceJson(value) {
    if (Array.isArray(value)) {
        return `[${value.map(canonicalMissionControlEvidenceJson).join(',')}]`;
    }
    if (isRecord(value)) {
        return `{${Object.keys(value).sort().map((key) => (`${JSON.stringify(key)}:${canonicalMissionControlEvidenceJson(value[key])}`)).join(',')}}`;
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
    if (!isRecord(projection))
        return [];
    const values = [
        projection.scope?.asin,
        projection.scope?.batchId,
        ...(Array.isArray(projection.productAsins) ? projection.productAsins : []),
        ...(Array.isArray(projection.keywordFacts)
            ? projection.keywordFacts.flatMap((fact) => [fact?.asin, fact?.keyword])
            : []),
    ];
    return [...new Set(values.filter((value) => (typeof value === 'string' && value.trim().length > 0)).map((value) => value.trim()))].sort((left, right) => left.localeCompare(right, 'en-US'));
}

function isPositiveInteger(value) {
    return Number.isSafeInteger(value) && value > 0;
}

function addViolation(violations, code, evidencePath, message, details = {}) {
    violations.push({ code, path: evidencePath, message, ...details });
}

module.exports = { isRecord, sameStringArray, canonicalMissionControlEvidenceJson, fingerprintMissionControlEvidenceValue, missionControlBusinessFactSentinels, isPositiveInteger, addViolation, MISSION_CONTROL_UI_EVIDENCE_SCHEMA_VERSION, MISSION_CONTROL_UI_EVIDENCE_KIND, EXPECTED_MISSION_CONTROL_SCALES, EXPECTED_MISSION_CONTROL_STORE_IDS, MISSION_CONTROL_WORKSPACE_CONTRACT, EXPECTED_MISSION_CONTROL_WORKSPACES, MISSION_CONTROL_UI_EVIDENCE_JSON_SCHEMA };

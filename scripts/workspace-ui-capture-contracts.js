// 按职责复用原有严格校验，公共入口继续保持兼容。



const DEFAULT_OUTPUT_DIR = 'output/workspace-ui-evidence';

const DEFAULT_VIEWPORT = { width: 1400, height: 900 };

const MIN_VISIBLE_FONT_SIZE_PX = 12;

const VISUAL_STATE_IDS = new Set([
    'workspace-error-retry',
    'diagnosis-ai-running-with-inspector',
]);

const MOTION_PREFERENCES = new Set(['no-preference', 'reduce']);

const STATE_EVIDENCE_SCHEMA_VERSION = 'workspace-ui-state-evidence/v1';

const DEFAULT_EXPERIENCE_CONTRACT = Object.freeze({
    maxPageOverflowPx: 24,
    maxPageOverflowRatio: 1.05,
    maxPageScrollLeakPx: 1,
    maxRenderedRows: 30,
    maxStickyHeaderOffsetPx: 2,
    maxWorkSurfaceTopPx: 300,
    minAriaRowCount: 100,
    minFullyVisibleRows: 5,
    minQueueViewportHeightPx: 360,
    scrollProbeRatio: 0.5,
});

function argumentValue(argv, index, name) {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
        throw new Error(`${name} requires a value.`);
    }
    return value;
}

function parseViewport(value) {
    const match = /^(\d+)x(\d+)$/i.exec(value || '');
    if (!match)
        throw new Error('--viewport must use WIDTHxHEIGHT, for example 1200x700.');
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (width < 1 || height < 1)
        throw new Error('--viewport dimensions must be positive integers.');
    return { width, height };
}

function validatePreviewUrl(value, scenario, label = 'Workspace evidence URL') {
    let url;
    try {
        url = new URL(value);
    }
    catch {
        throw new Error(`${label} is invalid: ${value}`);
    }
    if (url.searchParams.get('preview') !== '1') {
        throw new Error(`${label} must explicitly include preview=1.`);
    }
    const urlScenario = url.searchParams.get('scenario');
    if (urlScenario !== scenario) {
        throw new Error(`${label} scenario ${urlScenario || '(missing)'} does not match recorded scenario ${scenario}.`);
    }
}

function validateVisualStateTarget(target, label = 'Workspace evidence target') {
    if (target.visualState === undefined && target.motionPreference === undefined)
        return;
    if (!VISUAL_STATE_IDS.has(target.visualState)) {
        throw new Error(`${label} visualState must be one of ${Array.from(VISUAL_STATE_IDS).join(', ')}.`);
    }
    if (!MOTION_PREFERENCES.has(target.motionPreference)) {
        throw new Error(`${label} motionPreference must be one of ${Array.from(MOTION_PREFERENCES).join(', ')}.`);
    }
    if (target.workspace !== 'diagnosis' || target.subview !== 'analysis' || target.scenario !== 'diagnosis-ready') {
        throw new Error(`${label} visual state evidence is restricted to diagnosis/analysis with scenario diagnosis-ready.`);
    }
    if (target.visualState === 'diagnosis-ai-running-with-inspector' && target.viewport?.width < 1400) {
        throw new Error(`${label} diagnosis-ai-running-with-inspector requires a viewport at least 1400px wide.`);
    }
    const url = new URL(target.url || 'http://127.0.0.1/');
    if (target.url && (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname))) {
        throw new Error(`${label} visual state evidence is development-preview-only and requires a local HTTP URL.`);
    }
}

function parseWorkspaceEvidenceArgs(argv) {
    const values = {};
    let allowContractFail = false;
    for (let index = 0; index < argv.length; index += 1) {
        const name = argv[index];
        if (name === '--allow-contract-fail') {
            allowContractFail = true;
            continue;
        }
        if (!name.startsWith('--'))
            throw new Error(`Unexpected argument: ${name}`);
        const value = argumentValue(argv, index, name);
        index += 1;
        switch (name) {
            case '--config':
                values.configPath = value;
                break;
            case '--url':
                values.url = value;
                break;
            case '--workspace':
                values.workspace = value;
                break;
            case '--subview':
                values.subview = value;
                break;
            case '--scenario':
                values.scenario = value;
                break;
            case '--viewport':
                values.viewport = parseViewport(value);
                break;
            case '--dpr':
                values.dpr = Number(value);
                break;
            case '--output':
                values.outputDir = value;
                break;
            case '--root':
                values.rootSelector = value;
                break;
            case '--wait-for':
                values.waitFor = value;
                break;
            case '--settle-ms':
                values.settleMs = Number(value);
                break;
            default: throw new Error(`Unknown argument: ${name}`);
        }
    }
    if (values.configPath) {
        const extra = Object.keys(values).filter((key) => key !== 'configPath');
        if (extra.length > 0 || allowContractFail) {
            throw new Error('--config cannot be combined with inline target arguments.');
        }
        return { configPath: values.configPath, mode: 'config' };
    }
    if (!values.url || !values.workspace || !values.subview || !values.scenario) {
        throw new Error('Inline evidence requires --url, --workspace, --subview and --scenario.');
    }
    validatePreviewUrl(values.url, values.scenario, 'Inline evidence URL');
    const dpr = values.dpr === undefined ? 1 : values.dpr;
    if (!Number.isFinite(dpr) || dpr <= 0)
        throw new Error('--dpr must be a positive number.');
    const settleMs = values.settleMs === undefined ? undefined : values.settleMs;
    if (settleMs !== undefined && (!Number.isFinite(settleMs) || settleMs < 0)) {
        throw new Error('--settle-ms must be a non-negative number.');
    }
    const target = {
        dpr,
        scenario: values.scenario,
        subview: values.subview,
        url: values.url,
        viewport: values.viewport || DEFAULT_VIEWPORT,
        workspace: values.workspace,
    };
    if (values.rootSelector)
        target.rootSelector = values.rootSelector;
    if (values.waitFor)
        target.waitFor = values.waitFor;
    if (settleMs !== undefined)
        target.settleMs = settleMs;
    const parsed = {
        mode: 'inline',
        outputDir: values.outputDir || DEFAULT_OUTPUT_DIR,
        target,
    };
    if (allowContractFail)
        parsed.allowContractFail = true;
    return parsed;
}

function safeSegment(value) {
    return String(value || 'unknown')
        .trim()
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'unknown';
}

function timestampSegment(date) {
    return date.toISOString().replace(/[:.]/g, '-');
}

function validateCaptureTarget(target) {
    if (!target || typeof target !== 'object')
        throw new Error('Workspace evidence target is required.');
    for (const field of ['workspace', 'subview', 'scenario']) {
        if (typeof target[field] !== 'string' || !target[field].trim()) {
            throw new Error(`Workspace evidence target requires ${field}.`);
        }
    }
    if (!target.viewport || !Number.isInteger(target.viewport.width) || !Number.isInteger(target.viewport.height)) {
        throw new Error('Workspace evidence target requires an integer viewport width and height.');
    }
    if (!Number.isFinite(target.dpr) || target.dpr <= 0) {
        throw new Error('Workspace evidence target requires a positive DPR.');
    }
    if (target.experienceContract !== undefined) {
        normalizeExperienceContract(target.experienceContract, 'programmatic');
    }
    validateVisualStateTarget(target, 'Workspace evidence target');
}

function normalizeConfigViewport(value, targetNumber) {
    if (value === undefined)
        return { ...DEFAULT_VIEWPORT };
    if (typeof value === 'string') {
        try {
            return parseViewport(value);
        }
        catch (error) {
            throw new Error(`Workspace evidence target ${targetNumber} has an invalid viewport: ${error.message}`);
        }
    }
    if (value && Number.isInteger(value.width) && Number.isInteger(value.height) && value.width > 0 && value.height > 0) {
        return { width: value.width, height: value.height };
    }
    throw new Error(`Workspace evidence target ${targetNumber} has an invalid viewport.`);
}

function normalizeExperienceContract(value, targetNumber) {
    if (value === undefined)
        return undefined;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`Workspace evidence target ${targetNumber} has an invalid experienceContract.`);
    }
    const supportedFields = new Set(Object.keys(DEFAULT_EXPERIENCE_CONTRACT));
    for (const field of Object.keys(value)) {
        if (!supportedFields.has(field)) {
            throw new Error(`Workspace evidence target ${targetNumber} experienceContract has an unknown field ${field}.`);
        }
    }
    const normalized = { ...DEFAULT_EXPERIENCE_CONTRACT, ...value };
    const positiveIntegerFields = ['maxRenderedRows', 'minAriaRowCount', 'minFullyVisibleRows'];
    const nonNegativeFields = [
        'maxPageOverflowPx',
        'maxPageScrollLeakPx',
        'maxStickyHeaderOffsetPx',
        'maxWorkSurfaceTopPx',
    ];
    for (const field of positiveIntegerFields) {
        if (!Number.isInteger(normalized[field]) || normalized[field] < 1) {
            throw new Error(`Workspace evidence target ${targetNumber} experienceContract ${field} must be a positive integer.`);
        }
    }
    for (const field of nonNegativeFields) {
        if (!Number.isFinite(normalized[field]) || normalized[field] < 0) {
            throw new Error(`Workspace evidence target ${targetNumber} experienceContract ${field} must be a non-negative number.`);
        }
    }
    if (!Number.isFinite(normalized.minQueueViewportHeightPx) || normalized.minQueueViewportHeightPx <= 0) {
        throw new Error(`Workspace evidence target ${targetNumber} experienceContract minQueueViewportHeightPx must be positive.`);
    }
    if (!Number.isFinite(normalized.maxPageOverflowRatio) || normalized.maxPageOverflowRatio < 1) {
        throw new Error(`Workspace evidence target ${targetNumber} experienceContract maxPageOverflowRatio must be at least 1.`);
    }
    if (!Number.isFinite(normalized.scrollProbeRatio)
        || normalized.scrollProbeRatio <= 0
        || normalized.scrollProbeRatio >= 1) {
        throw new Error(`Workspace evidence target ${targetNumber} experienceContract scrollProbeRatio must be between 0 and 1.`);
    }
    return normalized;
}

function normalizeWorkspaceEvidenceConfig(config) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
        throw new Error('Workspace evidence config must be a JSON object.');
    }
    if (!Array.isArray(config.targets) || config.targets.length === 0) {
        throw new Error('Workspace evidence config requires a non-empty targets array.');
    }
    const targets = config.targets.map((source, index) => {
        if (!source || typeof source !== 'object' || Array.isArray(source)) {
            throw new Error(`Workspace evidence target ${index + 1} must be an object.`);
        }
        const dpr = source.dpr === undefined ? 1 : Number(source.dpr);
        const target = {
            dpr,
            scenario: source.scenario,
            subview: source.subview,
            viewport: normalizeConfigViewport(source.viewport, index + 1),
            workspace: source.workspace,
        };
        if (source.visualState !== undefined)
            target.visualState = source.visualState;
        if (source.motionPreference !== undefined)
            target.motionPreference = source.motionPreference;
        const experienceContract = normalizeExperienceContract(source.experienceContract, index + 1);
        if (experienceContract)
            target.experienceContract = experienceContract;
        const readbackMode = source.readbackMode === undefined ? config.readbackMode : source.readbackMode;
        if (typeof readbackMode === 'string' && readbackMode.trim())
            target.readbackMode = readbackMode.trim();
        validateCaptureTarget(target);
        const sourceUrl = source.url || config.baseUrl;
        if (!sourceUrl)
            throw new Error(`Workspace evidence target ${index + 1} requires url or config.baseUrl.`);
        let url;
        try {
            url = new URL(sourceUrl);
        }
        catch {
            throw new Error(`Workspace evidence target ${index + 1} has an invalid URL: ${sourceUrl}`);
        }
        url.searchParams.set('preview', '1');
        url.searchParams.set('scenario', target.scenario);
        target.url = url.toString();
        validatePreviewUrl(target.url, target.scenario, `Workspace evidence target ${index + 1} URL`);
        validateVisualStateTarget(target, `Workspace evidence target ${index + 1}`);
        for (const field of ['rootSelector', 'waitFor']) {
            const value = source[field] === undefined ? config[field] : source[field];
            if (typeof value === 'string' && value.trim())
                target[field] = value;
        }
        const settleMs = source.settleMs === undefined ? config.settleMs : source.settleMs;
        if (settleMs !== undefined) {
            const parsedSettleMs = Number(settleMs);
            if (!Number.isFinite(parsedSettleMs) || parsedSettleMs < 0) {
                throw new Error(`Workspace evidence target ${index + 1} has an invalid settleMs.`);
            }
            target.settleMs = parsedSettleMs;
        }
        return target;
    });
    return {
        allowContractFail: Boolean(config.allowContractFail),
        outputDir: config.outputDir || DEFAULT_OUTPUT_DIR,
        targets,
    };
}

module.exports = { argumentValue, parseViewport, validatePreviewUrl, validateVisualStateTarget, parseWorkspaceEvidenceArgs, safeSegment, timestampSegment, validateCaptureTarget, normalizeConfigViewport, normalizeExperienceContract, normalizeWorkspaceEvidenceConfig, DEFAULT_OUTPUT_DIR, DEFAULT_VIEWPORT, MIN_VISIBLE_FONT_SIZE_PX, VISUAL_STATE_IDS, MOTION_PREFERENCES, STATE_EVIDENCE_SCHEMA_VERSION, DEFAULT_EXPERIENCE_CONTRACT };

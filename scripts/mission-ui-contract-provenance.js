// 按职责复用原有严格校验，公共入口继续保持兼容。

const { isSha256 } = require('./mission-ui-contract-artifacts.js');
const { addViolation, isRecord, sameStringArray } = require('./mission-ui-contract-contracts.js');

function validateSourceProvenance(source, violations, options = {}) {
    if (!isRecord(source)) {
        addViolation(violations, 'SOURCE_PROVENANCE_MISSING', 'source', 'Stage7 evidence must include its preview-only source provenance.');
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
        addViolation(violations, 'SOURCE_PROVENANCE_FIELDS_INVALID', 'source', 'Source provenance must contain exactly the registered v2 fields.', { actual: Object.keys(source).sort(), expected: expectedKeys });
    }
    if (source.runtime !== 'vite-dev-preview') {
        addViolation(violations, 'SOURCE_RUNTIME_UNSAFE', 'source.runtime', 'Stage7 evidence must come from the Vite development preview runtime.', { actual: source.runtime, expected: 'vite-dev-preview' });
    }
    if (source.scenario !== 'diagnosis-ready') {
        addViolation(violations, 'SOURCE_SCENARIO_UNSAFE', 'source.scenario', 'Stage7 evidence must use the fixed diagnosis-ready preview scenario.', { actual: source.scenario, expected: 'diagnosis-ready' });
    }
    for (const key of ['runnerSha256', 'contractSha256', 'rendererTreeSha256']) {
        if (!isSha256(source[key])) {
            addViolation(violations, 'SOURCE_SHA256_INVALID', `source.${key}`, `${key} must be a 64-character SHA-256 digest.`);
        }
        else if (isRecord(options.expectedSourceHashes)
            && isSha256(options.expectedSourceHashes[key])
            && source[key].toLowerCase() !== options.expectedSourceHashes[key].toLowerCase()) {
            addViolation(violations, 'SOURCE_SHA256_MISMATCH', `source.${key}`, `${key} must match the current Stage7 evidence source bytes.`, { actual: source[key], expected: options.expectedSourceHashes[key] });
        }
    }
    for (const key of ['realLoginAccessed', 'authorityDatabaseAccessed', 'adsWriteAttempted']) {
        if (source[key] !== false) {
            addViolation(violations, 'SOURCE_ACCESS_CLAIM_UNSAFE', `source.${key}`, `${key} must be exactly false for preview-only Stage7 evidence.`, { actual: source[key], expected: false });
        }
    }
}

module.exports = { validateSourceProvenance };

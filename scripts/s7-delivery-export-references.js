// 按职责复用原有严格校验，公共入口继续保持兼容。
const fs = require('node:fs');
const path = require('node:path');
const { GATE_IDS, HASH_KEYS, HASH_ONLY_EXTENSIONS, HASH_PATH_KEYS, SAFE_BUNDLED_EXTENSIONS, SENSITIVE_JSON_KEYS, artifactRecord, canonicalPath, isRecord, isSha256, pathIsInside, readJson, requireRegularUnlinkedFile, sha256File } = require('./s7-delivery-export-contracts.js');

function assertNoSensitiveJson(value, sourcePath, currentPath = '$') {
    if (Array.isArray(value)) {
        value.forEach((item, index) => assertNoSensitiveJson(item, sourcePath, `${currentPath}[${index}]`));
        return;
    }
    if (!isRecord(value))
        return;
    for (const [key, item] of Object.entries(value)) {
        if (SENSITIVE_JSON_KEYS.test(key)
            && ((typeof item === 'string' && item.trim() !== '') || (isRecord(item) && Object.keys(item).length > 0))) {
            throw new Error(`Refusing to bundle possible secret field ${currentPath}.${key} from ${sourcePath}.`);
        }
        assertNoSensitiveJson(item, sourcePath, `${currentPath}.${key}`);
    }
}

function collectHashedArtifactReferences(value, origin, target = [], visited = new Set()) {
    if (Array.isArray(value)) {
        for (const item of value)
            collectHashedArtifactReferences(item, origin, target, visited);
        return target;
    }
    if (!isRecord(value) || visited.has(value))
        return target;
    visited.add(value);
    const pathKey = HASH_PATH_KEYS.find((key) => (typeof value[key] === 'string' && path.isAbsolute(value[key])));
    const hashKey = HASH_KEYS.find((key) => isSha256(value[key]));
    if (pathKey && hashKey && Number.isInteger(Number(value.sizeBytes)) && Number(value.sizeBytes) > 0) {
        target.push({
            origin,
            sourcePath: value[pathKey],
            sizeBytes: Number(value.sizeBytes),
            sha256: String(value[hashKey]).toUpperCase(),
        });
    }
    for (const item of Object.values(value)) {
        collectHashedArtifactReferences(item, origin, target, visited);
    }
    return target;
}

function validateReferencedArtifact(reference) {
    const stat = requireRegularUnlinkedFile(reference.sourcePath, `${reference.origin} referenced artifact`);
    if (stat.size !== reference.sizeBytes
        || sha256File(reference.sourcePath) !== reference.sha256) {
        throw new Error(`${reference.origin} referenced artifact changed: ${reference.sourcePath}`);
    }
    return {
        ...reference,
        sourcePath: canonicalPath(reference.sourcePath),
    };
}

function classifyReferencedArtifact(reference, evidenceRoot) {
    const extension = path.extname(reference.sourcePath).toLowerCase();
    if (HASH_ONLY_EXTENSIONS.has(extension)) {
        return {
            copy: false,
            policy: 'hash-only-sensitive-or-runtime-artifact',
        };
    }
    if (SAFE_BUNDLED_EXTENSIONS.has(extension)
        && pathIsInside(reference.sourcePath, evidenceRoot)) {
        return {
            copy: true,
            policy: 'bundled-evidence-artifact',
        };
    }
    return {
        copy: false,
        policy: 'hash-only-external-artifact',
    };
}

function safeName(value) {
    return String(value).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'artifact';
}

function copyWithRecord({ bundleDir, destinationRelativePath, id, role, sourcePath, }) {
    const source = artifactRecord(sourcePath);
    const destination = path.resolve(bundleDir, destinationRelativePath);
    if (!pathIsInside(destination, bundleDir)) {
        throw new Error(`Bundle copy escapes output root: ${destinationRelativePath}`);
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source.sourcePath, destination, fs.constants.COPYFILE_EXCL);
    const bundled = artifactRecord(destination);
    if (source.sha256 !== bundled.sha256 || source.sizeBytes !== bundled.sizeBytes) {
        throw new Error(`Bundle copy changed bytes for ${source.sourcePath}.`);
    }
    return {
        id,
        role,
        sourcePath: source.sourcePath,
        sizeBytes: source.sizeBytes,
        sha256: source.sha256,
        bundlePath: path.relative(bundleDir, destination).replace(/\\/g, '/'),
    };
}

function inspectSelectedEvidence(readiness) {
    const records = [];
    for (const id of GATE_IDS) {
        const gate = readiness.gates.find((candidate) => candidate.id === id);
        const selectedPath = readiness.evidenceSelection.selectedPaths[id];
        if (typeof selectedPath !== 'string' || selectedPath.trim() === '') {
            records.push({
                gateId: id,
                status: gate.status,
                ok: gate.ok,
                sourcePath: null,
                sourceExists: false,
                sourceJson: null,
            });
            continue;
        }
        const sourceExists = fs.existsSync(selectedPath);
        if (gate.ok && !sourceExists) {
            throw new Error(`Passed gate ${id} evidence is missing: ${selectedPath}`);
        }
        if (!sourceExists) {
            records.push({
                gateId: id,
                status: gate.status,
                ok: gate.ok,
                sourcePath: canonicalPath(selectedPath),
                sourceExists: false,
                sourceJson: null,
            });
            continue;
        }
        requireRegularUnlinkedFile(selectedPath, `${id} evidence`);
        const sourceJson = readJson(selectedPath);
        assertNoSensitiveJson(sourceJson, selectedPath);
        records.push({
            gateId: id,
            status: gate.status,
            ok: gate.ok,
            sourcePath: canonicalPath(selectedPath),
            sourceExists: true,
            sourceJson,
        });
    }
    return records;
}

function validateOperationalEvidenceSemantics(selectedEvidence) {
    const byId = new Map(selectedEvidence.map((record) => [record.gateId, record]));
    const continuous = byId.get('s7-continuous-operation');
    if (continuous?.ok) {
        if (continuous.sourceJson?.kind !== 's7-continuous-operation-evidence'
            || continuous.sourceJson?.schemaVersion !== 's7-continuous-operation-evidence/v1'
            || continuous.sourceJson?.passed !== true
            || continuous.sourceJson?.status !== 'PASSED') {
            throw new Error('Passed continuous-operation evidence does not use the current passing S7 contract.');
        }
    }
    const canarySpecs = [
        ['manual-canary', 'manual_approval'],
        ['policy-auto-canary', 'policy_auto'],
    ];
    for (const [id, mode] of canarySpecs) {
        const record = byId.get(id);
        if (!record?.ok)
            continue;
        if (record.sourceJson?.kind !== 'mission-control-execution-canary-evidence'
            || record.sourceJson?.schemaVersion !== 'mission-control-execution-canary-evidence/v2'
            || record.sourceJson?.passed !== true
            || record.sourceJson?.status !== 'PASSED'
            || record.sourceJson?.mode !== mode) {
            throw new Error(`Passed ${id} evidence does not use the current ${mode} canary contract.`);
        }
    }
    const manual = byId.get('manual-canary');
    const policy = byId.get('policy-auto-canary');
    if (manual?.ok && policy?.ok) {
        const distinctFields = [
            ['scope', 'storeId'],
            ['authority', 'missionId'],
            ['authority', 'missionGrantId'],
            ['authority', 'batchId'],
            ['authority', 'jobId'],
            ['authority', 'decisionId'],
        ];
        for (const [group, field] of distinctFields) {
            const manualValue = manual.sourceJson?.[group]?.[field];
            const policyValue = policy.sourceJson?.[group]?.[field];
            if (!manualValue || !policyValue || manualValue === policyValue) {
                throw new Error(`Manual and policy-auto canaries are not independent at ${group}.${field}.`);
            }
        }
    }
}

module.exports = { assertNoSensitiveJson, collectHashedArtifactReferences, validateReferencedArtifact, classifyReferencedArtifact, safeName, copyWithRecord, inspectSelectedEvidence, validateOperationalEvidenceSemantics };

// 按职责复用原有严格校验，公共入口继续保持兼容。
const fs = require('node:fs');
const path = require('node:path');
const { SQLITE_AUTHORITY_CURRENTNESS_SCHEMA_VERSION, assertMatchingAuthorityCurrentnessProofs, captureAuthoritySnapshotCurrentness, } = require('./sqlite-authority-currentness');
const { inspectPngEvidenceFile, } = require('./canary-png-evidence');
const { captureAuthorityCurrentness, expectedAuthoritySnapshotArtifact, inspectCanonicalPackage, mergeSnapshotCurrentnessValidation, publicAuthorityCurrentnessSummary, validateAuthoritySnapshotManifest } = require('./mission-control-production-authority.js');
const { validateExecutionCanary } = require('./mission-control-production-canary.js');
const { validateContinuousOperation } = require('./mission-control-production-continuous.js');
const { AUTHORITY_SNAPSHOT_DEPENDENT_GATE_IDS, GATE_SPECS, MAX_CANARY_EVIDENCE_AGE_MS, MAX_CONTINUOUS_EVIDENCE_AGE_MS, MAX_FUTURE_SKEW_MS, MAX_PACKAGE_EVIDENCE_AGE_MS, OUTPUT_KIND, OUTPUT_SCHEMA_VERSION, PACKAGE_IDENTITY_FIELDS, currentFileMatches, defaultProductionContext, hasUnsafeFilesystemLink, isRecord, isSha256, nonEmpty, normalizeSha256, pushReason, samePath, sha256File, stableEqual, uniqueExactStrings, validationResult } = require('./mission-control-production-contracts.js');
const { validatePackageAdversarialNodeEnv, validatePackageLaunch, validatePackageSecurity, validatePackageUi, validateV15FinalReadiness } = require('./mission-control-production-package.js');

function missingGate(spec, evidencePath) {
    return {
        id: spec.id,
        name: spec.name,
        status: 'missing',
        ok: false,
        evidencePath: evidencePath || null,
        reason: evidencePath
            ? `The explicitly selected evidence path does not exist: ${evidencePath}`
            : `Missing explicit --${spec.option} evidence path.`,
    };
}

function readEvidenceSelection(spec, rawPath) {
    const evidencePath = rawPath ? path.resolve(rawPath) : null;
    if (!evidencePath || !fs.existsSync(evidencePath)) {
        return { evidence: null, evidencePath, gate: missingGate(spec, evidencePath) };
    }
    try {
        if (fs.lstatSync(evidencePath).isSymbolicLink()
            || hasUnsafeFilesystemLink(path.parse(evidencePath).root, evidencePath)) {
            throw new Error('selected evidence file may not be a symbolic link or traverse a reparse point');
        }
        const stat = fs.statSync(evidencePath);
        if (!stat.isFile())
            throw new Error('selected path is not a file');
        if (stat.nlink !== 1)
            throw new Error('selected evidence file must have exactly one filesystem link');
        return {
            evidence: JSON.parse(fs.readFileSync(evidencePath, 'utf8')),
            evidencePath,
            gate: null,
        };
    }
    catch (error) {
        return {
            evidence: null,
            evidencePath,
            gate: {
                id: spec.id,
                name: spec.name,
                status: 'needs_work',
                ok: false,
                evidencePath,
                reason: `The explicitly selected evidence could not be read: ${error instanceof Error ? error.message : String(error)}`,
            },
        };
    }
}

function validateSelection(spec, selection, context) {
    if (selection.gate) {
        return {
            ...selection.gate,
            ...(spec.supersededBy ? { supersededBy: [...spec.supersededBy] } : {}),
            _validation: null,
        };
    }
    let validation;
    try {
        switch (spec.id) {
            case 'v15-final-readiness':
                validation = validateV15FinalReadiness(selection.evidence, context);
                break;
            case 'package-launch':
                validation = validatePackageLaunch(selection.evidence, context);
                break;
            case 'package-ui':
                validation = validatePackageUi(selection.evidence);
                break;
            case 'package-security':
                validation = validatePackageSecurity(selection.evidence);
                break;
            case 'package-adversarial-node-env':
                validation = validatePackageAdversarialNodeEnv(selection.evidence);
                break;
            case 's7-continuous-operation':
                validation = validateContinuousOperation(selection.evidence, {
                    ...context,
                    evidencePath: selection.evidencePath,
                });
                break;
            case 'manual-canary':
                validation = validateExecutionCanary(selection.evidence, 'manual_approval', context);
                break;
            case 'policy-auto-canary':
                validation = validateExecutionCanary(selection.evidence, 'policy_auto', context);
                break;
            default:
                validation = validationResult([`No validator is registered for ${spec.id}`]);
        }
    }
    catch (error) {
        validation = validationResult([`Evidence validation failed closed: ${error instanceof Error ? error.message : String(error)}`]);
    }
    return {
        id: spec.id,
        name: spec.name,
        status: validation.ok ? 'passed' : 'needs_work',
        ok: validation.ok,
        evidencePath: selection.evidencePath,
        reason: validation.reason,
        ...(validation.supersededBy ? { supersededBy: [...validation.supersededBy] } : {}),
        _validation: validation,
    };
}

function appendGateFailure(gate, reason) {
    gate.ok = false;
    if (gate.status !== 'missing')
        gate.status = 'needs_work';
    gate.reason = gate.reason === 'Evidence passed its production contract.'
        ? reason
        : `${gate.reason}; ${reason}`;
}

function verifyFileArtifactsUnchanged(verifiedFileArtifacts) {
    const reasons = [];
    if (!Array.isArray(verifiedFileArtifacts) || verifiedFileArtifacts.length !== 2 * 7 * 8) {
        return validationResult(['Final Store Capsule verification did not retain exactly 112 file artifacts.']);
    }
    const seenPaths = new Set();
    for (const artifact of verifiedFileArtifacts) {
        const filePath = artifact?.filePath;
        if (!nonEmpty(filePath)
            || !path.isAbsolute(filePath)
            || filePath.includes('\0')
            || !isSha256(artifact?.sha256)
            || !Number.isInteger(artifact?.sizeBytes)
            || artifact.sizeBytes <= 0) {
            reasons.push('Final Store Capsule verification retained an invalid file artifact proof.');
            break;
        }
        const resolved = path.resolve(filePath);
        const normalizedPath = resolved.toLowerCase();
        if (!samePath(filePath, resolved) || seenPaths.has(normalizedPath)) {
            reasons.push(`Final Store Capsule verification retained a duplicate or non-canonical file path: ${filePath}`);
            break;
        }
        seenPaths.add(normalizedPath);
        const expected = {
            path: resolved,
            sha256: artifact.sha256,
            sizeBytes: artifact.sizeBytes,
        };
        try {
            if (!currentFileMatches(expected) || !currentFileMatches(expected)) {
                reasons.push(`Verified Store Capsule report file changed after continuous-operation verification: ${resolved}`);
                break;
            }
        }
        catch (error) {
            reasons.push(`Verified Store Capsule report file could not be rechecked after continuous-operation verification: ${resolved} (${error instanceof Error ? error.message : String(error)})`);
            break;
        }
    }
    return validationResult(reasons);
}

function verifyCanaryPngArtifactsUnchanged(verifiedPngArtifacts) {
    const reasons = [];
    if (!Array.isArray(verifiedPngArtifacts) || verifiedPngArtifacts.length !== 3) {
        return validationResult([
            'Final canary PNG verification did not retain exactly three immutable artifact proofs.',
        ]);
    }
    const expectedSlots = ['before', 'after', 'reload'];
    const seenPaths = new Set();
    const slots = verifiedPngArtifacts.map((artifact) => artifact?.slot);
    pushReason(reasons, uniqueExactStrings(slots, expectedSlots), 'Final canary PNG verification did not retain exact before/after/reload slots');
    for (const artifact of verifiedPngArtifacts) {
        const filePath = artifact?.filePath;
        if (!nonEmpty(filePath)
            || !path.isAbsolute(filePath)
            || filePath.includes('\0')
            || !samePath(filePath, path.resolve(filePath))
            || !isSha256(artifact?.sha256)
            || !Number.isSafeInteger(artifact?.sizeBytes)
            || artifact.sizeBytes <= 0
            || !Number.isSafeInteger(artifact?.width)
            || !Number.isSafeInteger(artifact?.height)
            || !Number.isSafeInteger(artifact?.bitDepth)
            || !Number.isSafeInteger(artifact?.colorType)
            || !Number.isSafeInteger(artifact?.idatChunks)
            || !isRecord(artifact?.fileIdentity)
            || !nonEmpty(artifact.fileIdentity.dev)
            || !nonEmpty(artifact.fileIdentity.ino)
            || !nonEmpty(artifact?.mtimeNs)
            || !nonEmpty(artifact?.ctimeNs)) {
            reasons.push('Final canary PNG verification retained an invalid immutable artifact proof.');
            break;
        }
        const resolved = path.resolve(filePath);
        const normalizedPath = resolved.toLowerCase();
        if (seenPaths.has(normalizedPath)) {
            reasons.push(`Final canary PNG verification retained a duplicate path: ${resolved}`);
            break;
        }
        seenPaths.add(normalizedPath);
        try {
            const realPath = fs.realpathSync.native(resolved);
            if (!samePath(realPath, resolved) || fs.lstatSync(resolved).isSymbolicLink()) {
                reasons.push(`Final canary PNG path changed into a filesystem link: ${resolved}`);
                break;
            }
            const current = inspectPngEvidenceFile(resolved);
            const unchanged = current.sha256 === artifact.sha256
                && current.sizeBytes === artifact.sizeBytes
                && current.width === artifact.width
                && current.height === artifact.height
                && current.bitDepth === artifact.bitDepth
                && current.colorType === artifact.colorType
                && current.idatChunks === artifact.idatChunks
                && current.fileIdentity.dev === artifact.fileIdentity.dev
                && current.fileIdentity.ino === artifact.fileIdentity.ino
                && current.mtimeNs === artifact.mtimeNs
                && current.ctimeNs === artifact.ctimeNs;
            if (!unchanged) {
                reasons.push(`Verified canary PNG changed in path identity, size, hash, dimensions, `
                    + `or strict decoding after initial verification: ${resolved}`);
                break;
            }
        }
        catch (error) {
            reasons.push(`Verified canary PNG could not be strictly rechecked: ${resolved} `
                + `(${error instanceof Error ? error.message : String(error)})`);
            break;
        }
    }
    return validationResult(reasons);
}

function refreshReportState(report) {
    const passed = report.gates.filter((gate) => gate.ok).length;
    const allGatesPass = report.inputContractPassed && passed === report.gates.length;
    report.summary = {
        total: report.gates.length,
        passed,
        failed: report.gates.length - passed,
    };
    report.allGatesPass = allGatesPass;
    report.appReady = allGatesPass;
    report.status = allGatesPass ? 'APP_READY' : 'APP_NEEDS_WORK';
    report.failures = [
        ...report.gates.filter((gate) => !gate.ok).map((gate) => ({
            gateId: gate.id,
            evidencePath: gate.evidencePath,
            reason: gate.reason,
        })),
        ...report.inputErrors.map((reason) => ({
            gateId: 'explicit-input-contract',
            evidencePath: null,
            reason,
        })),
    ];
}

function appendFinalStoreCapsuleFailure(report, reason) {
    const gate = report.gates.find((candidate) => candidate.id === 's7-continuous-operation');
    if (!gate)
        return;
    appendGateFailure(gate, reason);
    refreshReportState(report);
}

function verifyFinalStoreCapsuleEvidence(report) {
    const gate = report.gates.find((candidate) => candidate.id === 's7-continuous-operation');
    if (!gate?.ok)
        return true;
    const validation = verifyFileArtifactsUnchanged(report._verifiedFileArtifacts);
    if (validation.ok)
        return true;
    appendFinalStoreCapsuleFailure(report, `Final Store Capsule TOCTOU verification failed: ${validation.reason}`);
    return false;
}

function verifyFinalCanaryPngEvidence(report) {
    let allValid = true;
    for (const gateId of ['manual-canary', 'policy-auto-canary']) {
        const gate = report.gates.find((candidate) => candidate.id === gateId);
        if (!gate?.ok)
            continue;
        const proofs = report._verifiedCanaryPngArtifacts?.[gateId];
        const validation = verifyCanaryPngArtifactsUnchanged(proofs);
        if (validation.ok)
            continue;
        appendGateFailure(gate, `Final canary PNG TOCTOU verification failed: ${validation.reason}`);
        allValid = false;
    }
    if (!allValid)
        refreshReportState(report);
    return allValid;
}

function appendFinalAuthorityCurrentnessFailure(report, reason) {
    const state = report._authorityCurrentnessState;
    if (state && !state.failures.includes(reason))
        state.failures.push(reason);
    report.authoritySnapshot.ok = false;
    report.authoritySnapshot.reason = report.authoritySnapshot.reason === 'Evidence passed its production contract.'
        ? reason
        : `${report.authoritySnapshot.reason}; ${reason}`;
    for (const gate of report.gates.filter((candidate) => (AUTHORITY_SNAPSHOT_DEPENDENT_GATE_IDS.includes(candidate.id)))) {
        appendGateFailure(gate, reason);
    }
    report.authoritySnapshot.currentness = publicAuthorityCurrentnessSummary(state);
    refreshReportState(report);
}

function captureAndVerifyFinalAuthorityCurrentness(report, captureLabel) {
    const state = report._authorityCurrentnessState;
    if (!state) {
        appendFinalAuthorityCurrentnessFailure(report, `WAL-aware authority currentness ${captureLabel} state is unavailable.`);
        return false;
    }
    const capture = captureAuthorityCurrentness(state.sourceDatabasePath, state.expectedSnapshotArtifact, captureLabel, state.injectedContext);
    if (!capture.ok) {
        appendFinalAuthorityCurrentnessFailure(report, capture.reason);
        return false;
    }
    state.proofs.push(capture.proof);
    try {
        assertMatchingAuthorityCurrentnessProofs(state.proofs, state.expectedSnapshotArtifact, `Formal readiness ${captureLabel}`);
    }
    catch (error) {
        appendFinalAuthorityCurrentnessFailure(report, `WAL-aware authority currentness ${captureLabel} proof reconciliation failed closed: ${error instanceof Error ? error.message : String(error)}`);
        return false;
    }
    report.authoritySnapshot.currentness = publicAuthorityCurrentnessSummary(state);
    return true;
}

function reconcilePackageIdentity(gates) {
    const packageGateIds = new Set([
        'v15-final-readiness',
        'package-launch',
        'package-ui',
        'package-security',
        'package-adversarial-node-env',
        's7-continuous-operation',
        'manual-canary',
        'policy-auto-canary',
    ]);
    const providers = gates.filter((gate) => packageGateIds.has(gate.id) && gate._validation?.packageIdentity);
    const packageIdentity = {};
    for (const field of PACKAGE_IDENTITY_FIELDS) {
        const values = providers
            .map((gate) => gate._validation.packageIdentity[field])
            .filter(Boolean)
            .map((value) => String(value).toUpperCase());
        const unique = new Set(values);
        packageIdentity[field] = unique.size === 1 ? values[0] : null;
        if (unique.size > 1) {
            for (const gate of providers.filter((candidate) => candidate._validation.packageIdentity[field])) {
                appendGateFailure(gate, `Package ${field} does not match the other explicitly selected evidence.`);
            }
        }
    }
    return packageIdentity;
}

function reconcileCanonicalProvenance(gates, selections, context, canonicalPackage, snapshotValidation) {
    const packageBoundGateIds = new Set([
        'v15-final-readiness', 'package-launch', 'package-ui', 'package-security',
        'package-adversarial-node-env', 's7-continuous-operation', 'manual-canary', 'policy-auto-canary',
    ]);
    const operationalIds = ['s7-continuous-operation', 'manual-canary', 'policy-auto-canary'];
    if (!canonicalPackage.ok || !canonicalPackage.packageIdentity) {
        for (const gate of gates.filter((item) => packageBoundGateIds.has(item.id))) {
            appendGateFailure(gate, `Canonical repository package verification failed: ${canonicalPackage.reason}`);
        }
        return;
    }
    for (const gate of gates.filter((item) => packageBoundGateIds.has(item.id))) {
        const identity = gate._validation?.packageIdentity;
        if (operationalIds.includes(gate.id) && !stableEqual(identity, canonicalPackage.packageIdentity)) {
            appendGateFailure(gate, 'Operational evidence packageIdentity does not match the current canonical package.');
            continue;
        }
        for (const field of PACKAGE_IDENTITY_FIELDS) {
            if (identity?.[field] && normalizeSha256(identity[field]) !== canonicalPackage.packageIdentity[field]) {
                appendGateFailure(gate, `Package ${field} does not match the hash recomputed from the canonical repository release.`);
            }
        }
    }
    if (!snapshotValidation.ok) {
        for (const id of operationalIds) {
            appendGateFailure(gates.find((gate) => gate.id === id), `Authority snapshot provenance failed: ${snapshotValidation.reason}`);
        }
        return;
    }
    const nowMs = Number(context.nowMs);
    const builtAtMs = canonicalPackage.builtAtMs;
    const exportedAtMs = Date.parse(snapshotValidation.manifest.exportedAt);
    const operationalTimes = new Map();
    for (const id of operationalIds) {
        const gate = gates.find((item) => item.id === id);
        const generatedAtMs = Date.parse(selections.get(id)?.evidence?.generatedAt);
        operationalTimes.set(id, generatedAtMs);
        const maxAgeMs = id === 's7-continuous-operation' ? MAX_CONTINUOUS_EVIDENCE_AGE_MS : MAX_CANARY_EVIDENCE_AGE_MS;
        if (!Number.isFinite(generatedAtMs)
            || generatedAtMs < builtAtMs
            || generatedAtMs < exportedAtMs
            || generatedAtMs > nowMs + MAX_FUTURE_SKEW_MS
            || nowMs - generatedAtMs > maxAgeMs) {
            appendGateFailure(gate, 'Operational evidence is future-dated, stale, predates the package/snapshot, or has invalid ordering.');
        }
    }
    const continuousWindowEndMs = Date.parse(`${selections.get('s7-continuous-operation')?.evidence?.window?.dateTo}T23:59:59.999Z`);
    const continuousWindowStart = selections.get('s7-continuous-operation')?.evidence?.window?.dateFrom;
    const packageBuildDate = new Date(builtAtMs).toISOString().slice(0, 10);
    if (!Number.isFinite(continuousWindowEndMs)
        || typeof continuousWindowStart !== 'string'
        || continuousWindowStart < packageBuildDate
        || continuousWindowEndMs < builtAtMs
        || continuousWindowEndMs > operationalTimes.get('s7-continuous-operation')) {
        appendGateFailure(gates.find((gate) => gate.id === 's7-continuous-operation'), 'Continuous-operation business window predates the current package build or ends after evidence generation.');
    }
    if (!Number.isFinite(exportedAtMs)
        || exportedAtMs < builtAtMs
        || exportedAtMs > nowMs + MAX_FUTURE_SKEW_MS
        || nowMs - exportedAtMs > MAX_CANARY_EVIDENCE_AGE_MS) {
        for (const id of operationalIds) {
            appendGateFailure(gates.find((gate) => gate.id === id), 'Authority snapshot exportedAt is future-dated, stale, or predates the current package build.');
        }
    }
    const continuousAt = operationalTimes.get('s7-continuous-operation');
    for (const id of ['manual-canary', 'policy-auto-canary']) {
        if (Number.isFinite(continuousAt) && Number.isFinite(operationalTimes.get(id)) && continuousAt > operationalTimes.get(id)) {
            appendGateFailure(gates.find((gate) => gate.id === id), 'Canary evidence predates the continuous-operation evidence and is replayed out of order.');
        }
    }
    for (const id of ['v15-final-readiness', 'package-launch', 'package-ui', 'package-security', 'package-adversarial-node-env']) {
        const gate = gates.find((item) => item.id === id);
        const generatedAtMs = Date.parse(selections.get(id)?.evidence?.generatedAt);
        if (!Number.isFinite(generatedAtMs)
            || generatedAtMs < builtAtMs
            || generatedAtMs > nowMs + MAX_FUTURE_SKEW_MS
            || nowMs - generatedAtMs > MAX_PACKAGE_EVIDENCE_AGE_MS) {
            appendGateFailure(gate, 'Package evidence is future-dated, stale, or predates the current package build.');
        }
    }
}

function reconcileCanaryIdentity(gates, selections) {
    const manual = gates.find((gate) => gate.id === 'manual-canary');
    const policy = gates.find((gate) => gate.id === 'policy-auto-canary');
    if (!manual?._validation?.canaryBinding || !policy?._validation?.canaryBinding)
        return;
    const sameEvidencePath = samePath(selections.get('manual-canary')?.evidencePath, selections.get('policy-auto-canary')?.evidencePath);
    const distinctAuthority = ['authorityId', 'batchId', 'jobId', 'missionGrantId']
        .every((field) => manual._validation.canaryBinding[field] !== policy._validation.canaryBinding[field]);
    if (sameEvidencePath || !distinctAuthority) {
        const reason = 'Manual and policy-auto canaries must be distinct real executions with distinct authority bindings.';
        appendGateFailure(manual, reason);
        appendGateFailure(policy, reason);
    }
}

function publicGate(gate) {
    return {
        id: gate.id,
        name: gate.name,
        status: gate.status,
        ok: gate.ok,
        evidencePath: gate.evidencePath,
        reason: gate.reason,
        ...(gate.supersededBy ? { supersededBy: [...gate.supersededBy] } : {}),
    };
}

function buildReport(parsed, injectedContext = null) {
    const productionContext = defaultProductionContext(parsed.values['authority-db']);
    const context = {
        ...productionContext,
        ...(injectedContext || {}),
        authorityDbPath: productionContext.authorityDbPath,
        authorityDbError: productionContext.authorityDbError,
    };
    const selections = new Map();
    const selectedPaths = {};
    for (const spec of GATE_SPECS) {
        const selection = readEvidenceSelection(spec, parsed.values[spec.option]);
        selections.set(spec.id, selection);
        selectedPaths[spec.id] = selection.evidencePath;
    }
    const canonicalPackage = inspectCanonicalPackage(context);
    const snapshotSpec = { id: 'authority-snapshot', name: 'Canonical authority database snapshot', option: 'authority-snapshot-manifest' };
    const snapshotSelection = readEvidenceSelection(snapshotSpec, parsed.values['authority-snapshot-manifest']);
    const snapshotContractValidation = snapshotSelection.gate
        ? validationResult([snapshotSelection.gate.reason])
        : validateAuthoritySnapshotManifest(snapshotSelection, context, canonicalPackage);
    const expectedSnapshotArtifact = expectedAuthoritySnapshotArtifact(snapshotSelection);
    const initialCurrentnessCapture = snapshotContractValidation.ok
        ? captureAuthorityCurrentness(context.authorityDbPath, expectedSnapshotArtifact, 'after-snapshot-selection', injectedContext)
        : {
            ok: false,
            proof: null,
            reason: 'WAL-aware authority currentness was not credited because the authority snapshot contract did not pass.',
        };
    const snapshotValidation = snapshotContractValidation.ok
        ? mergeSnapshotCurrentnessValidation(snapshotContractValidation, initialCurrentnessCapture)
        : {
            ...snapshotContractValidation,
            initialCurrentnessProof: null,
        };
    const authoritySnapshotSourcePath = snapshotValidation.manifest?.source?.absolutePath;
    const validationContext = {
        packageLaunchPath: selections.get('package-launch').evidencePath,
        packageAdversarialPath: selections.get('package-adversarial-node-env').evidencePath,
        canonicalReleaseRoot: context.releaseRoot,
        canonicalExecutablePath: context.executablePath,
        authoritySnapshotPath: snapshotValidation.snapshotPath,
        authoritySnapshotManifestSha256: snapshotSelection.evidencePath && fs.existsSync(snapshotSelection.evidencePath)
            ? sha256File(snapshotSelection.evidencePath)
            : null,
        authoritySnapshotExportedAt: snapshotValidation.manifest?.exportedAt,
        authoritySnapshotSourcePath,
        canonicalStoresRoot: nonEmpty(authoritySnapshotSourcePath)
            ? path.resolve(path.dirname(authoritySnapshotSourcePath), 'stores')
            : null,
        nowMs: context.nowMs,
        packageBuiltAtMs: canonicalPackage.builtAtMs,
        packageIdentity: canonicalPackage.packageIdentity,
    };
    const internalGates = GATE_SPECS.map((spec) => validateSelection(spec, selections.get(spec.id), validationContext));
    reconcilePackageIdentity(internalGates);
    reconcileCanonicalProvenance(internalGates, selections, context, canonicalPackage, snapshotValidation);
    const packageIdentity = canonicalPackage.packageIdentity || {
        executableSha256: null,
        appContentSha256: null,
        mainBundleSha256: null,
    };
    reconcileCanaryIdentity(internalGates, selections);
    const gates = internalGates.map(publicGate);
    const inputContractPassed = parsed.errors.length === 0;
    const passed = gates.filter((gate) => gate.ok).length;
    const allGatesPass = inputContractPassed && passed === gates.length;
    const report = {
        kind: OUTPUT_KIND,
        schemaVersion: OUTPUT_SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        status: allGatesPass ? 'APP_READY' : 'APP_NEEDS_WORK',
        appReady: allGatesPass,
        allGatesPass,
        inputContractPassed,
        evidenceSelection: {
            explicitOnly: true,
            latestFallbackUsed: false,
            selectedPaths,
            authorityDb: context.authorityDbPath,
            authoritySnapshotManifest: snapshotSelection.evidencePath,
        },
        authoritySnapshot: {
            ok: snapshotValidation.ok,
            evidencePath: snapshotSelection.evidencePath,
            reason: snapshotValidation.reason,
        },
        packageIdentity,
        inputErrors: parsed.errors,
        summary: { total: gates.length, passed, failed: gates.length - passed },
        gates,
    };
    report.failures = [
        ...gates.filter((gate) => !gate.ok).map((gate) => ({
            gateId: gate.id,
            evidencePath: gate.evidencePath,
            reason: gate.reason,
        })),
        ...parsed.errors.map((reason) => ({ gateId: 'explicit-input-contract', evidencePath: null, reason })),
    ];
    const continuousValidation = internalGates.find((gate) => gate.id === 's7-continuous-operation')?._validation;
    Object.defineProperty(report, '_verifiedFileArtifacts', {
        configurable: false,
        enumerable: false,
        value: continuousValidation?.verifiedFileArtifacts ?? Object.freeze([]),
        writable: false,
    });
    const verifiedCanaryPngArtifacts = Object.freeze(Object.fromEntries(['manual-canary', 'policy-auto-canary'].map((gateId) => {
        const validation = internalGates.find((gate) => gate.id === gateId)?._validation;
        const proofs = Array.isArray(validation?.verifiedPngArtifacts)
            ? validation.verifiedPngArtifacts.map((artifact) => Object.freeze({
                ...artifact,
                fileIdentity: Object.freeze({ ...artifact.fileIdentity }),
            }))
            : [];
        return [gateId, Object.freeze(proofs)];
    })));
    Object.defineProperty(report, '_verifiedCanaryPngArtifacts', {
        configurable: false,
        enumerable: false,
        value: verifiedCanaryPngArtifacts,
        writable: false,
    });
    const authorityCurrentnessState = {
        expectedSnapshotArtifact,
        failures: initialCurrentnessCapture.ok
            ? []
            : [initialCurrentnessCapture.reason],
        injectedContext,
        proofs: initialCurrentnessCapture.ok
            ? [initialCurrentnessCapture.proof]
            : [],
        sourceDatabasePath: context.authorityDbPath,
    };
    Object.defineProperty(report, '_authorityCurrentnessState', {
        configurable: false,
        enumerable: false,
        value: authorityCurrentnessState,
        writable: false,
    });
    report.authoritySnapshot.currentness =
        publicAuthorityCurrentnessSummary(authorityCurrentnessState);
    return report;
}

module.exports = { missingGate, readEvidenceSelection, validateSelection, appendGateFailure, verifyFileArtifactsUnchanged, verifyCanaryPngArtifactsUnchanged, refreshReportState, appendFinalStoreCapsuleFailure, verifyFinalStoreCapsuleEvidence, verifyFinalCanaryPngEvidence, appendFinalAuthorityCurrentnessFailure, captureAndVerifyFinalAuthorityCurrentness, reconcilePackageIdentity, reconcileCanonicalProvenance, reconcileCanaryIdentity, publicGate, buildReport };

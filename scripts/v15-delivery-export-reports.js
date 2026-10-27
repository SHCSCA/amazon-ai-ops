// 按职责复用原有严格校验，公共入口继续保持兼容。
const fs = require('fs');
const path = require('path');
const { isRealReportPath, readJson, sha256 } = require('./v15-delivery-export-contracts.js');

function summarizeDataReconciliation(jsonPath, markdownPath) {
    if (!jsonPath) {
        return {
            present: false,
            sourceJsonPath: null,
            sourceMarkdownPath: markdownPath || null,
            canonicalSource: null,
            canonical: null,
            blockers: ['No current-scope data reconciliation JSON was found.'],
        };
    }
    const report = readJson(jsonPath);
    const canonical = report.canonical
        || report.db?.totals?.canonical
        || report.totals?.canonicalTotal
        || null;
    const canonicalSource = report.canonicalSource
        || report.db?.canonical?.summarySource
        || (report.totals?.canonicalTotal ? 'full8-data-reconciliation' : null);
    return {
        present: true,
        sourceJsonPath: jsonPath,
        sourceMarkdownPath: markdownPath || null,
        canonicalSource,
        canonical,
        blockers: Array.isArray(report.blockers)
            ? report.blockers
            : Array.isArray(report.db?.blockers)
                ? report.db.blockers
                : [],
    };
}

function addReportReference(map, filePath, ref) {
    if (!isRealReportPath(filePath))
        return;
    const resolved = path.resolve(String(filePath).trim());
    const current = map.get(resolved) || {
        sourcePath: resolved,
        exists: fs.existsSync(resolved) && fs.statSync(resolved).isFile(),
        sizeBytes: null,
        sha256: null,
        refs: [],
    };
    if (current.exists) {
        current.sizeBytes = fs.statSync(resolved).size;
        current.sha256 = sha256(resolved);
    }
    if (ref && !current.refs.includes(ref))
        current.refs.push(ref);
    map.set(resolved, current);
}

function collectReportReferencesFromValue(value, map, refPrefix) {
    if (Array.isArray(value)) {
        value.forEach((item, index) => collectReportReferencesFromValue(item, map, `${refPrefix}[${index}]`));
        return;
    }
    if (!value || typeof value !== 'object') {
        return;
    }
    for (const [key, nested] of Object.entries(value)) {
        const ref = `${refPrefix}.${key}`;
        if (['filePath', 'file_path', 'sourceFile', 'source_file', 'sourceFiles', 'source_files', 'reportPath', 'report_path'].includes(key)) {
            if (Array.isArray(nested))
                nested.forEach((item, index) => addReportReference(map, item, `${ref}[${index}]`));
            else
                addReportReference(map, nested, ref);
        }
        collectReportReferencesFromValue(nested, map, ref);
    }
}

function isSyntheticUiEvidenceForReportIndex(filePath) {
    const baseName = path.basename(String(filePath || ''));
    return [
        /^current-business-ui-smoke-.*\.json$/i,
        /^business-ui-.*-smoke-.*\.json$/i,
        /^v15-product-readiness-ui-smoke-.*\.json$/i,
        /^structural-ai-openai-compatible-mock-.*\.json$/i,
    ].some((pattern) => pattern.test(baseName));
}

function buildRealReportIndex({ finalReadiness, dataReconciliation, evidencePaths }) {
    const reports = new Map();
    collectReportReferencesFromValue(finalReadiness, reports, 'finalReadiness');
    if (dataReconciliation)
        collectReportReferencesFromValue(dataReconciliation, reports, 'dataReconciliation');
    for (const evidencePath of evidencePaths) {
        if (path.extname(evidencePath).toLowerCase() !== '.json')
            continue;
        if (isSyntheticUiEvidenceForReportIndex(evidencePath))
            continue;
        if (!fs.existsSync(evidencePath) || !fs.statSync(evidencePath).isFile())
            continue;
        try {
            collectReportReferencesFromValue(readJson(evidencePath), reports, `evidence:${path.basename(evidencePath)}`);
        }
        catch {
        }
    }
    return {
        generatedAt: new Date().toISOString(),
        copyPolicy: 'Raw Lingxing report spreadsheets are not copied into the delivery bundle; this index records local paths, existence, size, and hash.',
        reports: Array.from(reports.values()).sort((a, b) => a.sourcePath.localeCompare(b.sourcePath)),
    };
}

function collectFinalReadinessBlockers(finalReadiness) {
    const blockers = [
        ...(Array.isArray(finalReadiness.missing) ? finalReadiness.missing : []),
        ...(Array.isArray(finalReadiness.actionItems) ? finalReadiness.actionItems : []),
        ...(Array.isArray(finalReadiness.recommendationReviewReasons) ? finalReadiness.recommendationReviewReasons : []),
        ...(Array.isArray(finalReadiness.reviewBlockers) ? finalReadiness.reviewBlockers : []),
        ...(Array.isArray(finalReadiness.deliveryReviewReasons) ? finalReadiness.deliveryReviewReasons : []),
    ];
    for (const gate of finalReadiness.gates || []) {
        if (gate && gate.ok === false) {
            const name = String(gate.name || 'gate').trim();
            const message = String(gate.message || gate.status || '未通过').trim();
            blockers.push(`${name}: ${message}`);
        }
    }
    return Array.from(new Set(blockers.map((item) => String(item || '').trim()).filter(Boolean)));
}

function writeRealReportIndex(bundleDir, evidenceOutDir, manifest, reportIndex) {
    const indexPath = path.join(evidenceOutDir, 'real-report-file-index.json');
    fs.mkdirSync(evidenceOutDir, { recursive: true });
    fs.writeFileSync(indexPath, `${JSON.stringify(reportIndex, null, 2)}\n`, 'utf8');
    manifest.files.push({
        label: 'real-report-file-index',
        sourcePath: 'generated',
        bundlePath: path.relative(bundleDir, indexPath),
        sizeBytes: fs.statSync(indexPath).size,
        sha256: sha256(indexPath),
    });
    return indexPath;
}

module.exports = { summarizeDataReconciliation, addReportReference, collectReportReferencesFromValue, isSyntheticUiEvidenceForReportIndex, buildRealReportIndex, collectFinalReadinessBlockers, writeRealReportIndex };

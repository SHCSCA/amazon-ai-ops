// 按证据职责拆分共享夹具与断言，保留原有完整测试名称。
import { validRunDiagnostics } from './v15-non-ready-test-lineage.mjs';
import { HASH_A, HASH_B } from './v15-non-ready-test-environment.mjs';
function validPackageUiSession(profileId, { firstRun = false } = {}) {
    const diagnostics = validRunDiagnostics(profileId);
    return {
        connectionBootstrap: { ...diagnostics.login.connectionBootstrap },
        loginSessionAttestation: firstRun
            ? {
                adsSessionReady: true,
                credentialPersistence: 'saved',
                credentialSource: 'typed',
                erpSessionReady: true,
                erpSessionReused: false,
                ok: true,
                sessionIdentityVerified: true,
            }
            : {
                adsSessionReady: true,
                credentialPersistence: 'main_managed',
                credentialSource: 'saved',
                erpSessionReady: true,
                erpSessionReused: true,
                ok: true,
                sessionIdentityVerified: false,
            },
        mode: 'interactive-operator-login',
        operatorHandoff: { ...diagnostics.login.operatorHandoff },
        savedCredentialsLoginUsed: false,
        storeGate: {
            createdEvidenceStore: false,
            currency: 'USD',
            marketplace: 'US',
            outcome: 'selected-existing-store',
            selectedStore: { ...diagnostics.storeGate.selectedStore },
        },
        storeAuthorityReadback: {
            actualIdSha256: HASH_A,
            currency: 'USD',
            expectedIdSha256: HASH_A,
            marketplace: 'US',
            passed: true,
        },
    };
}

function validDatabaseMutationAudit() {
    const metrics = {
        digestSha256: HASH_A,
        serializedBytes: 49152,
        totalChanges: 8,
        dataVersion: 1,
        pageCount: 12,
        pageSize: 4096,
        schemaVersion: 9,
        userVersion: 9,
    };
    return {
        kind: 'package-ui-database-mutation-audit',
        schemaVersion: 1,
        requiredPhases: ['post-bootstrap', 'post-navigation', 'pre-close-terminal'],
        checkpoints: [
            {
                sequence: 1,
                phase: 'post-bootstrap',
                capturedAt: '2026-07-16T08:08:09.500Z',
                contextDigestSha256: HASH_B,
                metrics: { ...metrics },
            },
            {
                sequence: 2,
                phase: 'post-navigation',
                capturedAt: '2026-07-16T08:08:19.000Z',
                contextDigestSha256: HASH_B,
                metrics: { ...metrics },
            },
            {
                sequence: 3,
                phase: 'pre-close-terminal',
                capturedAt: '2026-07-16T08:08:19.500Z',
                contextDigestSha256: HASH_B,
                metrics: { ...metrics },
            },
        ],
        comparisons: {
            contextDigestMatched: true,
            digestMatched: true,
            serializedBytesMatched: true,
            totalChangesMatched: true,
            dataVersionMatched: true,
            pageCountMatched: true,
            pageSizeMatched: true,
            schemaVersionMatched: true,
            userVersionMatched: true,
        },
        passed: true,
    };
}

function databaseCheckpointReceipts(runtime) {
    const checkpoints = runtime.marker.databaseMutationAudit.checkpoints;
    return {
        postBootstrap: structuredClone(checkpoints[0]),
        postNavigation: structuredClone(checkpoints[1]),
    };
}
export { validPackageUiSession, validDatabaseMutationAudit, databaseCheckpointReceipts };

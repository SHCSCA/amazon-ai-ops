// 按证据职责拆分共享夹具与断言，保留原有完整测试名称。
import { createValidAdReadbackEvidence, path, writeAdReadbackAuthorityDb } from './v15-export-test-environment.mjs';
import { writeJson, writePng, writeReport } from './v15-export-test-artifacts.mjs';
function writeValidReadbackWithDb(runDir, evidencePath) {
    const evidence = createValidAdReadbackEvidence(runDir);
    writeJson(evidencePath, evidence);
    return writeAdReadbackAuthorityDb(path.join(runDir, 'authority-db'), evidence);
}

function writeAuthorityDbForInvalidReadback(runDir) {
    const fixtureDir = path.join(runDir, 'authority-fixture');
    const evidence = createValidAdReadbackEvidence(fixtureDir);
    return writeAdReadbackAuthorityDb(path.join(fixtureDir, 'authority-db'), evidence);
}

function validReadbackEvidence(runDir) {
    const now = '2026-06-10T00:00:00.000Z';
    return {
        schemaVersion: 2,
        kind: 'real-ad-execution-readback',
        status: 'PASS',
        createdAt: now,
        authority: {
            recommendationId: 1,
            recommendationRevision: 1,
            recommendationStatusAtExport: 'approved',
            dateFrom: '2026-06-01',
            dateTo: '2026-06-10',
            storeName: 'FT-US-US',
            marketplaceCode: 'US',
            asin: 'B0TESTASIN',
            batchId: 'batch_1',
            checkedAt: now,
        },
        realWriteApproved: true,
        safety: {
            full8Started: false,
            listingAiDraftOnly: false,
            adWriteActionsPerformed: true,
        },
        approval: {
            operatorConfirmed: true,
            scope: 'FT-US-US / US / Campaign A / Ad Group A / close match / lower_bid',
            confirmedAt: now,
            approverName: 'Ops Owner',
            approvalArtifactPath: 'approval-ticket-123',
        },
        target: {
            storeName: 'FT-US-US',
            marketplaceCode: 'US',
            asin: 'B0TESTASIN',
            campaignName: 'Campaign A',
            adGroupName: 'Ad Group A',
            entityType: 'keyword',
            entityId: 'keyword-123',
            entityName: 'close match',
            identityProofPath: writePng(path.join(runDir, 'target-identity.png')),
            actionType: 'lower_bid',
        },
        risk: {
            level: 'low',
            allowedByPolicy: true,
            rationale: 'Small reversible bid decrease on one target.',
        },
        before: {
            value: '2.40',
            capturedAt: now,
            screenshotPath: writePng(path.join(runDir, 'before.png')),
            liveBidSourceNote: 'Read from Ads UI editable target bid cell before manual change.',
        },
        after: {
            value: '2.16',
            capturedAt: now,
            screenshotPath: writePng(path.join(runDir, 'after.png')),
        },
        readback: {
            verified: true,
            method: 'Ads UI reload target row',
            readAt: now,
            actualValue: '2.16',
            evidencePath: writePng(path.join(runDir, 'readback.png')),
        },
        execution: {
            success: true,
            verified: true,
            executionId: 'manual-ads-ui-123',
            executedAt: now,
            channel: 'manual_ads_ui',
            performedBy: 'operator@example.com',
            appExecutorUsed: false,
        },
        source: {
            recommendationId: '1',
            recommendationRevision: 1,
            batchId: 'batch_1',
            sourceFiles: [writeReport(path.join(runDir, 'user-search-term.xlsx'))],
            sourceRow: 12,
            evidencePath: 'output/codex-evidence/installed-ad-ai-explanation.json',
            entityType: 'search_term',
            currentValue: '2.40',
            recommendedValue: '2.16',
        },
    };
}
export { writeValidReadbackWithDb, writeAuthorityDbForInvalidReadback, validReadbackEvidence };

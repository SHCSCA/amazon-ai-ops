// 按证据职责拆分共享夹具与断言，保留原有完整测试名称。
import { writePng, writeReport } from './v15-non-ready-test-artifacts.mjs';
import { path } from './v15-non-ready-test-environment.mjs';
function validReadbackEvidence(dir) {
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
            identityProofPath: writePng(path.join(dir, 'target-identity.png')),
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
            screenshotPath: writePng(path.join(dir, 'before.png')),
            liveBidSourceNote: 'Read from Ads UI editable target bid cell before manual change.',
        },
        after: {
            value: '2.16',
            capturedAt: now,
            screenshotPath: writePng(path.join(dir, 'after.png')),
        },
        readback: {
            verified: true,
            method: 'Ads UI reload target row',
            readAt: now,
            actualValue: '2.16',
            evidencePath: writePng(path.join(dir, 'readback.png')),
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
            sourceFiles: [writeReport(path.join(dir, 'user-search-term.xlsx'))],
            sourceRow: 12,
            evidencePath: 'output/codex-evidence/installed-ad-ai-explanation.json',
            entityType: 'search_term',
            currentValue: '2.40',
            recommendedValue: '2.16',
        },
    };
}
export { validReadbackEvidence };

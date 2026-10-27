// 按证据职责拆分共享夹具与断言，保留原有完整测试名称。
import { EMPTY_SCHEDULER_COUNTS, EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS, SCHEDULER_CONTEXT, fs, path, validatePackageUiReadOnlyRuntimeEvidence, validateSchedulerSubviewEvidence } from './v15-non-ready-test-environment.mjs';
import { validDatabaseMutationAudit } from './v15-non-ready-test-session.mjs';
import { artifactRecord } from './v15-non-ready-test-artifacts.mjs';
function schedulerAuditSnapshot(userDataDir, { counts = {}, events = [], pid = 321 } = {}) {
    const mergedCounts = { ...EMPTY_SCHEDULER_COUNTS, ...counts };
    return {
        kind: 'package-ui-scheduler-audit',
        schemaVersion: 1,
        generatedAt: '2026-07-16T08:08:09.500Z',
        pid,
        evidenceMode: 'package-ui',
        userDataDir,
        policies: { runNow: 'reject' },
        counts: mergedCounts,
        suppressed: {
            automaticReconcile: 0,
            localSchedulerStart: 1,
            startupReconcile: 1,
            storeSchedulerStart: 1,
        },
        guards: {
            localSchedulerStarted: false,
            storeCollectionSchedulerStarted: false,
            runNowIpcDisabled: true,
            startupReconcileSuppressed: true,
            automaticReconcileSuppressed: true,
            readOnlyInvariantPassed: true,
        },
        databaseMutationAudit: validDatabaseMutationAudit(),
        events,
    };
}

function validSchedulerSubviewEvidence(userDataDir) {
    const expected = EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS[0];
    const requestId = 'renderer-bootstrap-1784786120654-1';
    const events = [
        {
            sequence: 1,
            at: '2026-07-16T08:08:10.100Z',
            source: 'mission-control:query',
            outcome: 'succeeded',
            context: SCHEDULER_CONTEXT,
            request: {
                query: 'workspace-bootstrap',
                requestId,
                contextEpoch: 1,
                context: SCHEDULER_CONTEXT,
            },
            response: {
                query: 'workspace-bootstrap',
                requestId,
                contextEpoch: 1,
                authoritativeContext: SCHEDULER_CONTEXT,
                capabilities: expected.capabilities.map((capability) => ({
                    ...capability,
                    view: 'settings/scheduler',
                    workspace: 'settings',
                })),
            },
            errorCode: null,
        },
        {
            sequence: 2,
            at: '2026-07-16T08:08:10.200Z',
            source: 'store-collection-scheduler:get',
            outcome: 'succeeded',
            context: SCHEDULER_CONTEXT,
            request: { storeContext: SCHEDULER_CONTEXT },
            response: {
                businessDate: SCHEDULER_CONTEXT.businessDate,
                detail: '等待当前店铺配置的采集时间。',
                enabled: true,
                state: 'waiting',
                storeId: SCHEDULER_CONTEXT.storeId,
            },
            errorCode: null,
        },
        {
            sequence: 3,
            at: '2026-07-16T08:08:10.300Z',
            source: 'store-evidence-retention:preview',
            outcome: 'succeeded',
            context: SCHEDULER_CONTEXT,
            request: { storeContext: SCHEDULER_CONTEXT },
            response: {
                applyable: false,
                blockerCount: 0,
                candidateCount: 0,
                currency: 'USD',
                deletionSupported: false,
                marketplace: 'US',
                mode: 'dry-run',
                profileId: SCHEDULER_CONTEXT.browserProfileId,
                schemaVersion: 1,
                storeId: SCHEDULER_CONTEXT.storeId,
            },
            errorCode: null,
        },
    ];
    return {
        dom: {
            alertDialogCount: 0,
            busyControlCount: 0,
            confirmRunDialogCount: 0,
            fixedScopeText: 'US USD',
            fixedScopeTexts: ['US USD'],
            fixedScopeVisibleCount: 1,
            heading: expected.heading,
            headingCount: 1,
            legacyBoundaryCount: 1,
            legacyCapabilityState: 'LEGACY_ADAPTER',
            legacyRoute: 'scheduler',
            legacyStoreId: SCHEDULER_CONTEXT.storeId,
            pageCount: 1,
            previewMarkerCount: 0,
            loadingStateCount: 0,
            retentionPreviewCapabilityId: 'settings.scheduler.retention-preview',
            retentionPreviewControlCount: 1,
            retentionPreviewEnabledCount: 1,
            retentionBlockerCount: '0',
            retentionCandidateCount: '0',
            retentionCurrency: 'USD',
            retentionMarketplace: 'US',
            retentionProfileId: SCHEDULER_CONTEXT.browserProfileId,
            retentionStoreId: SCHEDULER_CONTEXT.storeId,
            retentionSummaryCount: 1,
            rootCount: 1,
            scheduleBusinessDate: SCHEDULER_CONTEXT.businessDate,
            scheduleCurrency: 'USD',
            scheduleEnabled: 'true',
            scheduleMarketplace: 'US',
            scheduleProjectionCount: 1,
            scheduleRefreshEnabledCount: 1,
            scheduleState: 'waiting',
            scheduleStoreId: SCHEDULER_CONTEXT.storeId,
            schedulerErrorCount: 0,
            selectedStoreId: SCHEDULER_CONTEXT.storeId,
            selectedTabCapabilityState: 'LEGACY_ADAPTER',
            selectedTabCount: 1,
            selectedTabId: expected.tabId,
            shellStoreId: SCHEDULER_CONTEXT.storeId,
            subview: expected.subview,
            workspace: expected.workspace,
        },
        ledgerBefore: schedulerAuditSnapshot(userDataDir),
        ledgerAfter: schedulerAuditSnapshot(userDataDir, {
            counts: { workspaceQuery: 1, schedulerGet: 1, retentionPreview: 1 },
            events,
        }),
    };
}

function validPackageUiReadOnlyRuntime(dir, profileId, userDataDir) {
    const marker = validSchedulerSubviewEvidence(userDataDir).ledgerAfter;
    const artifactPath = path.join(dir, 'package-ui-artifacts', `${profileId}-scheduler-audit.json`);
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    fs.writeFileSync(artifactPath, JSON.stringify(marker), 'utf8');
    return validatePackageUiReadOnlyRuntimeEvidence({
        artifact: artifactRecord(artifactPath),
        main: {
            evidenceMode: 'package-ui',
            pid: marker.pid,
            userDataDir,
        },
        marker,
        processExitConfirmed: true,
    });
}

function validPackageUiSubviewCheck(dir, scale, userDataDir) {
    const expected = EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS[0];
    const screenshotPath = path.join(dir, 'package-ui-artifacts', `${expected.workspace}-${expected.subview}-${scale.scalePercent}.png`);
    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    fs.writeFileSync(screenshotPath, `scheduler-${scale.scalePercent}`, 'utf8');
    return {
        ...expected,
        compositeEvidence: { passed: true },
        identityCapabilityEvidence: validateSchedulerSubviewEvidence(validSchedulerSubviewEvidence(userDataDir), expected),
        passed: true,
        screenshot: {
            ...artifactRecord(screenshotPath),
            subview: expected.subview,
            workspace: expected.workspace,
        },
        settleEvidence: { passed: true },
        violations: [],
    };
}
export { schedulerAuditSnapshot, validSchedulerSubviewEvidence, validPackageUiReadOnlyRuntime, validPackageUiSubviewCheck };

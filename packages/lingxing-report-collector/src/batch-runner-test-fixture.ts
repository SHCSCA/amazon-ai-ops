// 按证据职责拆分共享夹具与断言，保留原有完整测试名称。
import { type LegacyTestOptions, type LingxingCreateReportOutcome, type LingxingInPlaceResumeState, type LingxingReportDefinition, REPORT_DIMENSION_HEADER, type RunBatchOptions, TEST_STORE_CONTEXT, XLSX, downloadExistingLingxingReportBatch, fs, os, path, runLingxingReportBatch } from './batch-runner-test-environment';
import { inspectReportFileContent } from './report-file-inspector';
function writeSemanticReportFixture(filePath: string, report: LingxingReportDefinition): void {
    const headers = ['日期', '广告活动'];
    if (report.type !== 'campaign')
        headers.push('广告组');
    if (!['campaign', 'ad_group'].includes(report.type)) {
        headers.push(REPORT_DIMENSION_HEADER[report.type]);
    }
    headers.push('展现量', '点击量', '花费', '订单', '销售额');
    const worksheet = XLSX.utils.aoa_to_sheet([headers]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Report');
    fs.writeFileSync(filePath, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
}

function createdOutcome(report: LingxingReportDefinition, dateRange: {
    start: string;
    end: string;
}): LingxingCreateReportOutcome {
    return {
        status: 'created',
        identity: {
            provider: 'lingxing',
            reportType: report.type,
            externalReportName: `${report.type}-${dateRange.start}-${dateRange.end}`,
            externalReportId: `external-${report.type}`,
            dateStart: dateRange.start,
            dateEnd: dateRange.end,
            createdAt: '2026-05-25T12:00:00.000Z',
        },
    };
}

function testAuthority() {
    requestSequence += 1;
    return {
        requestId: `collector-test-${requestSequence}`,
        // 隔离测试显式适配同步夹具，不提供正式 Main 的 CPU 隔离信用。
        reportContentInspector: async (filePath: string, reportType: LingxingReportDefinition['type']) => inspectReportFileContent(filePath, reportType),
        storeContext: TEST_STORE_CONTEXT,
        storeDisplayName: 'SHC001 · 美国站',
        async progressSink() {
            return;
        },
        authorityGuard() {
            return { allowed: true } as const;
        },
        cancellationGuard() {
            return { allowed: true } as const;
        },
    };
}

function normalizeLegacyTestOptions(options: LegacyTestOptions): RunBatchOptions {
    const automation = options.automation;
    return {
        ...testAuthority(),
        ...options,
        automation: {
            ...automation,
            async createReport(report, dateRange) {
                const outcome = await automation.createReport(report, dateRange);
                return (outcome ?? createdOutcome(report, dateRange)) as LingxingCreateReportOutcome;
            },
        },
    };
}

function runTestBatch(options: LegacyTestOptions) {
    return runLingxingReportBatch(normalizeLegacyTestOptions(options));
}

function downloadExistingTestBatch(options: LegacyTestOptions) {
    return downloadExistingLingxingReportBatch(normalizeLegacyTestOptions(options));
}

async function createThreeOfEightResumeFixture() {
    const rootDownloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingxing-in-place-source-'));
    const source = await runTestBatch({
        dateStart: '2026-05-01',
        dateEnd: '2026-05-25',
        rootDownloadDir,
        automation: {
            async navigateToDownloadCenter() { },
            async createReport() { },
            async waitForReportReady() { },
            async downloadReport(report, downloadDir) {
                fs.mkdirSync(downloadDir, { recursive: true });
                const filePath = path.join(downloadDir, `${report.expectedFilenameKeyword}_2026-05-01_2026-05-25_report.xlsx`);
                writeSemanticReportFixture(filePath, report);
                return filePath;
            },
        },
    });
    const failedAt = new Date(Date.parse(source.job.updatedAt) + 1).toISOString();
    const reports = source.job.reports.map((checkpoint, index) => index < 3
        ? checkpoint
        : {
            reportType: checkpoint.reportType,
            state: 'failed' as const,
            attemptIndex: 0,
            autoRetryCount: 0,
            errorCode: 'LINGXING_COLLECTION_STEP_FAILED',
            detail: 'safe pre-create failure',
            updatedAt: failedAt,
        });
    const job = {
        ...source.job,
        state: 'failed' as const,
        reports,
        blockerCode: 'LINGXING_COLLECTION_STEP_FAILED',
        detail: 'resume fixture',
        completedAt: failedAt,
        updatedAt: failedAt,
    };
    const batch = {
        ...source.batch,
        status: 'failed' as const,
        completedAt: failedAt,
    };
    const resumeFrom: LingxingInPlaceResumeState = {
        jobId: job.jobId,
        request: job.request,
        reports,
        job,
        batch,
        files: source.files.slice(0, 3),
    };
    return { rootDownloadDir, source, resumeFrom };
}

let requestSequence = 0;
export { writeSemanticReportFixture, createdOutcome, testAuthority, normalizeLegacyTestOptions, runTestBatch, downloadExistingTestBatch, createThreeOfEightResumeFixture, requestSequence };

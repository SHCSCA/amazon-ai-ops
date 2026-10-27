// 历史开发预览职责模块；启用边界由原引导入口统一控制。
import { type PreviewScenarioContract, PREVIEW_REPORT_MANIFEST_ARTIFACT_ID } from './dev-preview-contracts';
import { previewFixtures, previewReportOptions, previewScope, PREVIEW_REPORT_FOLDER_ARTIFACT_ID, previewBatchOptions, previewReportArtifactId, previewReportFileName, previewDailyHistory } from './dev-preview-fixtures';

export function previewPipeline(scenario: PreviewScenarioContract, fixtures = previewFixtures(scenario)) {
    const reportOptions = scenario.reportsCollected
        ? previewReportOptions.map((item) => ({
            ...item,
            status: scenario.reportsImported ? 'imported' : 'downloaded',
            importedRows: scenario.reportsImported ? item.importedRows : 0,
        }))
        : previewReportOptions.map((item) => ({
            ...item,
            status: 'missing',
            realFileAvailable: false,
            importedRows: 0,
        }));
    const importedRows = scenario.reportsImported ? 1879 : 0;
    const reportBlockers = scenario.scopeReady
        ? (scenario.reportsCollected ? [] : ['预览场景：尚未采集真实报表'])
        : ['预览场景：尚未确认运营范围'];
    return {
        scope: scenario.scopeReady ? previewScope : null,
        generatedAt: new Date().toISOString(),
        collection: {
            status: scenario.reportsCollected ? 'ready' : 'blocked',
            latestBatch: scenario.reportsCollected ? {
                id: previewScope.batchId,
                status: scenario.reportsImported ? 'ready' : 'downloaded',
                dateStart: previewScope.dateFrom,
                dateEnd: previewScope.dateTo,
                storeName: previewScope.storeName,
                marketplaceCode: previewScope.marketplaceCode,
                downloadArtifactId: PREVIEW_REPORT_FOLDER_ARTIFACT_ID,
                downloadDisplayName: '浏览器预览报表目录',
                manifestArtifactId: PREVIEW_REPORT_MANIFEST_ARTIFACT_ID,
                manifestDisplayName: '浏览器预览采集清单',
                completedAt: '2026-06-24T09:00:00Z',
            } : null,
            sourceBatchIds: scenario.reportsCollected ? [previewScope.batchId] : [],
            availableBatches: previewBatchOptions(scenario),
            reportOptions,
            realReportFiles: scenario.reportsCollected ? reportOptions.map((item, index) => ({
                id: `preview-file-${item.type}`,
                batchId: previewScope.batchId,
                reportType: item.type,
                displayName: item.label,
                status: scenario.reportsImported ? 'imported' : 'downloaded',
                artifactId: previewReportArtifactId(index),
                sourceArtifactId: previewReportArtifactId(index),
                artifactDisplayName: previewReportFileName(String(item.type)),
                folderArtifactId: PREVIEW_REPORT_FOLDER_ARTIFACT_ID,
                folderDisplayName: '浏览器预览报表目录',
                fileName: previewReportFileName(String(item.type)),
                fileExtension: '.xlsx',
                fileSizeBytes: 1024,
                importedRows: item.importedRows,
            })) : [],
            evidenceArtifacts: scenario.reportsCollected
                ? [{
                        label: '浏览器预览报表目录',
                        artifactId: PREVIEW_REPORT_FOLDER_ARTIFACT_ID,
                        displayName: '浏览器预览报表目录',
                        kind: 'folder',
                    }]
                : [],
            fileAudit: {
                totalFileRecords: scenario.reportsCollected ? 8 : 0,
                downloadedFileRecords: scenario.reportsCollected ? 8 : 0,
                existingFileRecords: scenario.reportsCollected ? 8 : 0,
                realReportFileCount: scenario.reportsCollected ? 8 : 0,
                importedRowCount: importedRows,
                rejectedEvidenceFileCount: 0,
                missingReportLabels: [],
                downloadArtifactId: PREVIEW_REPORT_FOLDER_ARTIFACT_ID,
                downloadDisplayName: '浏览器预览报表目录',
                manifestArtifactId: PREVIEW_REPORT_MANIFEST_ARTIFACT_ID,
                manifestDisplayName: '浏览器预览采集清单',
            },
            blockers: reportBlockers,
            audit: {
                databaseReady: scenario.reportsImported,
                acceptedExtensions: ['.xlsx', '.xls', '.csv'],
                rejectedEvidenceExtensions: ['.json', '.png', '.html'],
                notes: ['浏览器预览数据只用于 UI 验证，不会写入本地数据库。'],
            },
        },
        quant: {
            hasImportedMetrics: scenario.reportsImported,
            importedRows,
            canonicalRows: importedRows,
            actionableRows: scenario.diagnosisReady ? 1621 : 0,
            breakdownRows: scenario.diagnosisReady ? 34 : 0,
            summarySource: scenario.reportsImported ? 'browser-preview' : 'none',
            totalSpend: scenario.reportsImported ? 784.31 : 0,
            totalSales: scenario.reportsImported ? 1289.68 : 0,
            totalOrders: scenario.reportsImported ? 25 : 0,
            totalClicks: scenario.reportsImported ? 495 : 0,
            totalImpressions: scenario.reportsImported ? 27199 : 0,
            acos: scenario.reportsImported ? 0.6081 : 0,
            cvr: scenario.reportsImported ? 0.0505 : 0,
            cpc: scenario.reportsImported ? 1.58 : 0,
            wastedSpend: scenario.reportsImported ? 403.47 : 0,
            highRiskCount: scenario.diagnosisReady ? fixtures.diagnostics.length : 0,
            adObjectTimelines: scenario.diagnosisReady ? fixtures.timelines : [],
            diagnostics: scenario.diagnosisReady ? fixtures.diagnostics : [],
            blockers: scenario.diagnosisReady ? [] : ['预览场景：诊断尚未就绪'],
        },
        operations: { events: fixtures.events, eventCount: fixtures.events.length, notes: [] },
        productContext: { products: fixtures.products, productCount: fixtures.products.length, notes: [] },
        productHistory: {
            ledgers: scenario.reportsImported ? [{
                    asin: 'B0GTTJFQTM',
                    storeName: previewScope.storeName,
                    marketplaceCode: previewScope.marketplaceCode,
                    dateFrom: previewScope.dateFrom,
                    dateTo: previewScope.dateTo,
                    activeDays: previewDailyHistory.length,
                    firstMetricDate: previewDailyHistory[0]?.date,
                    lastMetricDate: previewDailyHistory[previewDailyHistory.length - 1]?.date,
                    inferredStage: 'testing',
                    stageReasons: ['浏览器预览日级广告账本，用于验证 UI，不写入数据库。'],
                    daily: previewDailyHistory,
                    totals: {
                        impressions: previewDailyHistory.reduce((sum, day) => sum + day.impressions, 0),
                        clicks: previewDailyHistory.reduce((sum, day) => sum + day.clicks, 0),
                        cost: previewDailyHistory.reduce((sum, day) => sum + day.cost, 0),
                        orders: previewDailyHistory.reduce((sum, day) => sum + day.orders, 0),
                        sales: previewDailyHistory.reduce((sum, day) => sum + day.sales, 0),
                        acos: 0.608,
                        cpc: 1.58,
                        cvr: 0.0505,
                        currency: 'USD',
                    },
                    events: fixtures.events,
                    product: {
                        productStage: 'keyword_exploration',
                        targetAcos: 0.35,
                        targetTacos: 0.12,
                        targetNetMargin: 0.15,
                        minPrice: 33.99,
                    },
                }] : [],
        },
    };
}

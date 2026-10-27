// 历史开发预览职责模块；启用边界由原引导入口统一控制。
import type { BusinessQuantDiagnostic, BusinessQuantTimeline, OperationScope } from './types';
import { type PreviewScenarioContract, PREVIEW_REPORT_MANIFEST_ARTIFACT_ID } from './dev-preview-contracts';

export const previewScope: OperationScope = {
    dateFrom: '2026-05-21',
    dateTo: '2026-06-23',
    storeName: 'FT-US-US',
    marketplaceCode: 'US',
    asin: 'B0GTTJFQTM',
    batchId: 'batch_preview_20260625',
    currency: 'USD',
};

export const previewReportOptions = [
    ['campaign', '广告活动报告', 34],
    ['ad_group', '广告组报告', 220],
    ['placement', '广告位报告', 110],
    ['advertised_product', '广告（推广的商品）报告', 240],
    ['auto_targeting', '自动投放报告', 180],
    ['keyword', '关键词报告', 360],
    ['product_targeting', '商品投放报告', 270],
    ['user_search_term', '用户搜索词报告', 465],
].map(([type, label, importedRows]) => ({
    type,
    label,
    status: 'imported',
    realFileAvailable: true,
    importedRows,
}));

export const PREVIEW_REPORT_FOLDER_ARTIFACT_ID = 'artifact:v1:00000000-0000-4000-8000-000000000101';

export function previewReportFileName(reportType: string): string {
    return `${reportType}.xlsx`;
}

export function previewReportArtifactId(index: number): `artifact:v1:${string}` {
    return `artifact:v1:00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
}

export const previewProducts = [
    {
        id: 'preview-B0GTTJFQTM',
        asin: 'B0GTTJFQTM',
        title: 'D6',
        parent_asin: '',
        parentAsin: '',
        msku: 'D6-M',
        sku: 'D6-SKU',
        store_name: 'FT-US-US',
        marketplace_code: 'US',
        product_stage: 'keyword_exploration',
        productStage: 'keyword_exploration',
        status: 'active',
        updated_at: '2026-06-24',
        updatedAt: '2026-06-24',
        cost: {
            purchaseCost: 15.7,
            firstLegCost: 0,
            fbaFee: 6.49,
            referralFeeRate: 0.15,
            storageFee: 0,
            otherCost: 0,
            currentPrice: 49.99,
            minPrice: 33.99,
            targetNetMargin: 0.15,
            targetAcos: 0.35,
            targetTacos: 0.12,
        },
    },
    {
        id: 'preview-B0GVRW2HPY',
        asin: 'B0GVRW2HPY',
        title: 'D7',
        msku: 'D7-M',
        sku: 'D7-SKU',
        store_name: 'FT-US-US',
        marketplace_code: 'US',
        product_stage: 'scaling',
        productStage: 'scaling',
        status: 'active',
        updated_at: '2026-06-24',
        updatedAt: '2026-06-24',
        cost: { currentPrice: 49.99, targetAcos: 0.28, targetTacos: 0.1, targetNetMargin: 0.18 },
    },
    {
        id: 'preview-B0GVS5LVK2',
        asin: 'B0GVS5LVK2',
        title: 'D8',
        msku: 'D8-M',
        sku: 'D8-SKU',
        store_name: 'FT-US-US',
        marketplace_code: 'US',
        product_stage: 'declining_repair',
        productStage: 'declining_repair',
        status: 'watch',
        updated_at: '2026-06-24',
        updatedAt: '2026-06-24',
        cost: { currentPrice: 39.99, targetAcos: 0.45, targetTacos: 0.18, targetNetMargin: 0.08 },
    },
];

export function previewDiagnosticObjectKey(diagnostic: Pick<BusinessQuantDiagnostic, 'asin' | 'campaignName' | 'adGroupName' | 'objectType' | 'objectName'>): string {
    return [
        String(diagnostic.asin || '').trim().toUpperCase(),
        String(diagnostic.campaignName || '').trim().toLowerCase(),
        String(diagnostic.adGroupName || '').trim().toLowerCase(),
        'user_search_term',
        String(diagnostic.objectType || '').trim().toLowerCase(),
        String(diagnostic.objectName || '').trim().toLowerCase(),
    ].join('|');
}

export function withPreviewDiagnosticIdentity<T extends BusinessQuantDiagnostic>(diagnostic: T): T & {
    objectKey: string;
} {
    return { ...diagnostic, objectKey: previewDiagnosticObjectKey(diagnostic) };
}

export const previewDiagnostics = ([
    {
        campaignName: 'D6-精准-核心长尾',
        adGroupName: 'SP-01',
        asin: 'B0GTTJFQTM',
        objectType: 'search_term',
        objectName: 'door lock bedroom',
        spend: 111.54,
        sales: 49.99,
        orders: 1,
        clicks: 98,
        acos: 2.231,
        cvr: 0.0102,
        cpc: 1.14,
        quantStatus: 'waste',
        lifecycleStage: 'testing',
        severity: 'high',
        recommendedAction: '降价或否定',
        diagnosis: '花费偏高且转化不足',
        suggestedDirection: '先复核再降价',
    },
    {
        campaignName: 'D6-手动精准',
        adGroupName: 'SP-02',
        asin: 'B0GTTJFQTM',
        objectType: 'search_term',
        objectName: 'smart lock',
        spend: 39.68,
        sales: 99.98,
        orders: 2,
        clicks: 45,
        acos: 0.397,
        cvr: 0.044,
        cpc: 0.88,
        quantStatus: 'watch',
        lifecycleStage: 'testing',
        severity: 'medium',
        recommendedAction: '观察',
        diagnosis: '有订单但 ACOS 偏高',
        suggestedDirection: '观察',
    },
] satisfies BusinessQuantDiagnostic[]).map((diagnostic) => withPreviewDiagnosticIdentity(diagnostic));

export function buildPreviewTimelines(diagnostics: BusinessQuantDiagnostic[]): BusinessQuantTimeline[] {
    return diagnostics.map((diagnostic, index) => ({
        objectKey: String(diagnostic.objectKey || ''),
        objectType: diagnostic.objectType === 'target' || diagnostic.objectType === 'ad_group' || diagnostic.objectType === 'campaign'
            ? diagnostic.objectType
            : 'search_term',
        objectName: diagnostic.objectName || '未命名对象',
        asin: diagnostic.asin,
        campaignName: diagnostic.campaignName,
        adGroupName: diagnostic.adGroupName,
        dateFrom: previewScope.dateFrom,
        dateTo: previewScope.dateTo,
        daysActive: 34,
        lifecycleStage: diagnostic.lifecycleStage || 'testing',
        quantStatus: diagnostic.quantStatus || 'watch',
        recommendedAction: diagnostic.recommendedAction || '复核',
        recommendedValue: diagnostic.recommendedValue || '保持',
        trend: { spend: 'up', sales: index % 2 ? 'down' : 'up' },
        totals: {
            impressions: 800 + index * 20,
            clicks: diagnostic.clicks,
            cost: diagnostic.spend,
            orders: diagnostic.orders,
            sales: diagnostic.sales,
            acos: diagnostic.acos,
            cpc: diagnostic.cpc,
            cvr: diagnostic.cvr,
            currency: 'USD',
        },
        thresholds: { targetAcos: 0.35 },
        reasons: ['浏览器预览数据，不写入数据库'],
        reviewRequired: true,
    }));
}

export const previewEvents = [
    {
        id: 'preview-event-1',
        eventDate: '2026-06-18',
        eventType: 'listing_change',
        title: 'Listing 标题优化',
        description: '补充核心词和场景词',
        asin: 'B0GTTJFQTM',
        impact: 'watch',
        createdAt: '2026-06-18T09:00:00Z',
    },
];

export function previewFixtures(scenario: PreviewScenarioContract) {
    if (scenario.id !== 'diagnosis-ready') {
        return {
            diagnostics: previewDiagnostics,
            timelines: buildPreviewTimelines(previewDiagnostics),
            events: previewEvents,
            products: previewProducts,
        };
    }
    const diagnostics = Array.from({ length: 120 }, (_, index) => {
        const source = previewDiagnostics[index % previewDiagnostics.length];
        const diagnostic = {
            ...source,
            campaignName: `${source.campaignName}-${String(index + 1).padStart(3, '0')}`,
            objectName: `${source.objectName} ${String(index + 1).padStart(3, '0')}`,
        };
        return withPreviewDiagnosticIdentity(diagnostic);
    });
    return {
        diagnostics,
        timelines: buildPreviewTimelines(diagnostics),
        events: Array.from({ length: 120 }, (_, index) => {
            const source = previewEvents[index % previewEvents.length];
            return {
                ...source,
                id: `preview-event-${index + 1}`,
                title: `${source.title} ${String(index + 1).padStart(3, '0')}`,
            };
        }),
        products: Array.from({ length: 120 }, (_, index) => {
            const source = previewProducts[index % previewProducts.length];
            if (index < previewProducts.length)
                return source;
            const asin = `B0P${String(index + 1).padStart(7, '0')}`;
            return {
                ...source,
                id: `preview-${asin}`,
                asin,
                title: `${source.title} ${String(index + 1).padStart(3, '0')}`,
                msku: `PREVIEW-${String(index + 1).padStart(3, '0')}`,
                sku: `PREVIEW-SKU-${String(index + 1).padStart(3, '0')}`,
            };
        }),
    };
}

export const previewDailyHistory = Array.from({ length: 34 }, (_, index) => {
    const date = new Date(`${previewScope.dateFrom}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + index);
    const cost = Number((12 + (index % 6) * 3.4 + (index > 22 ? 8 : 0)).toFixed(2));
    const orders = index % 5 === 0 ? 0 : index % 4;
    const sales = Number((orders * 49.99).toFixed(2));
    const clicks = 8 + (index % 9) * 3;
    return {
        date: date.toISOString().slice(0, 10),
        impressions: 680 + index * 18,
        clicks,
        cost,
        orders,
        sales,
        acos: sales > 0 ? cost / sales : 0,
        cpc: clicks > 0 ? cost / clicks : 0,
        cvr: clicks > 0 ? orders / clicks : 0,
        currency: 'USD',
    };
});

export function previewBatchOptions(scenario: PreviewScenarioContract) {
    if (!scenario.reportsCollected)
        return [];
    return [{
            id: previewScope.batchId,
            status: 'ready',
            dateStart: previewScope.dateFrom,
            dateEnd: previewScope.dateTo,
            storeName: previewScope.storeName,
            marketplaceCode: previewScope.marketplaceCode,
            downloadArtifactId: PREVIEW_REPORT_FOLDER_ARTIFACT_ID,
            downloadDisplayName: '浏览器预览报表目录',
            manifestArtifactId: PREVIEW_REPORT_MANIFEST_ARTIFACT_ID,
            manifestDisplayName: '浏览器预览采集清单',
            totalFileRecords: 8,
            realReportFileCount: 8,
            importedReportTypeCount: scenario.reportsImported ? 8 : 0,
            importedRowCount: scenario.reportsImported ? 1879 : 0,
            missingReportLabels: [],
        }];
}

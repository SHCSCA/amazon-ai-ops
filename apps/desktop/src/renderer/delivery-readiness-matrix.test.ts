import { describe, expect, it } from 'vitest';
import { buildDeliveryReadinessMatrix, buildDeliveryReadinessMatrixInput } from './delivery-readiness-matrix';

describe('buildDeliveryReadinessMatrix', () => {
  it('marks the delivery matrix ready only when every business proof gate is closed', () => {
    const matrix = buildDeliveryReadinessMatrix({
      realReportCount: 8,
      importedRows: 2416,
      actionableRows: 180,
      aiAvailable: true,
      aiSuccessCount: 3,
      aiInsightOnlyCount: 1,
      operationEventCount: 2,
      productContextCount: 1,
      listingReadReady: true,
      listingDraftReady: true,
      pendingRecommendationCount: 4,
      approvedRecommendationCount: 2,
      readbackVerifiedCount: 1,
      installerAvailable: true,
      deliveryManifestReady: true,
    });

    expect(matrix.status).toBe('ready');
    expect(matrix.headline).toContain('可交付证据闭环已完成');
    expect(matrix.readyCount).toBe(matrix.totalCount);
    expect(matrix.primaryNextAction).toBe('导出交付包并记录安装包校验码');
    expect(matrix.items.find((item) => item.key === 'data')?.tone).toBe('ready');
    expect(matrix.items.find((item) => item.key === 'aiEvidence')?.detail).toContain('AI 成功 3 次');
  });

  it('keeps the ready headline and primary matrix copy business-facing', () => {
    const matrix = buildDeliveryReadinessMatrix({
      realReportCount: 8,
      importedRows: 2416,
      actionableRows: 180,
      aiAvailable: true,
      aiSuccessCount: 3,
      aiInsightOnlyCount: 1,
      operationEventCount: 2,
      productContextCount: 1,
      listingReadReady: true,
      listingDraftReady: true,
      pendingRecommendationCount: 4,
      approvedRecommendationCount: 2,
      readbackVerifiedCount: 1,
      installerAvailable: true,
      deliveryManifestReady: true,
    });
    const displayCopy = [
      matrix.headline,
      matrix.primaryNextAction,
      ...matrix.items.flatMap((item) => [
        item.label,
        item.statusLabel,
        item.detail,
        item.nextAction,
      ]),
    ].join('\n');

    expect(matrix.headline).toBe('可交付证据闭环已完成');
    expect(displayCopy).not.toMatch(/APP_|READY|manifest|gate/i);
  });

  it('uses operator-facing wording for readback and package proof details', () => {
    const matrix = buildDeliveryReadinessMatrix({
      realReportCount: 8,
      importedRows: 2416,
      actionableRows: 180,
      aiAvailable: true,
      aiSuccessCount: 3,
      operationEventCount: 2,
      productContextCount: 1,
      listingReadReady: true,
      listingDraftReady: true,
      pendingRecommendationCount: 4,
      approvedRecommendationCount: 2,
      readbackVerifiedCount: 1,
      installerAvailable: false,
      deliveryManifestReady: false,
    });

    const readback = matrix.items.find((item) => item.key === 'readback');
    const packageItem = matrix.items.find((item) => item.key === 'package');

    expect(readback?.detail).toContain('执行前/执行后/回读验证');
    expect(readback?.detail).not.toMatch(/before|after|readback/);
    expect(packageItem?.detail).toContain('最终验收汇总');
    expect(packageItem?.detail).toContain('免安装包/校验码');
    expect(packageItem?.detail).not.toMatch(/manifest|exe|hash/i);
  });

  it('blocks formal delivery when real reports or imported daily metrics are missing', () => {
    const matrix = buildDeliveryReadinessMatrix({
      realReportCount: 0,
      importedRows: 0,
      actionableRows: 0,
      aiAvailable: false,
      aiSuccessCount: 0,
      aiInsightOnlyCount: 0,
      operationEventCount: 0,
      productContextCount: 0,
      listingReadReady: false,
      listingDraftReady: false,
      pendingRecommendationCount: 0,
      approvedRecommendationCount: 0,
      readbackVerifiedCount: 0,
      installerAvailable: false,
      deliveryManifestReady: false,
    });

    expect(matrix.status).toBe('blocked');
    expect(matrix.primaryNextAction).toBe('先完成真实报表下载和 DB 日级指标导入');
    expect(matrix.items.find((item) => item.key === 'data')?.statusLabel).toBe('阻断');
    expect(matrix.items.find((item) => item.key === 'data')?.nextAction).toBe('去数据采集');
    expect(matrix.items.find((item) => item.key === 'recommendations')?.tone).toBe('blocked');
    expect(matrix.items.find((item) => item.key === 'aiEvidence')?.detail).toContain('规则兜底');
    expect(matrix.items.find((item) => item.key === 'aiEvidence')?.detail).not.toContain('fallback');
  });

  it('keeps delivery in needs work when data and AI are ready but readback and package proof are missing', () => {
    const matrix = buildDeliveryReadinessMatrix({
      realReportCount: 8,
      importedRows: 96,
      actionableRows: 12,
      aiAvailable: true,
      aiSuccessCount: 1,
      aiInsightOnlyCount: 1,
      operationEventCount: 1,
      productContextCount: 1,
      listingReadReady: true,
      listingDraftReady: true,
      pendingRecommendationCount: 1,
      approvedRecommendationCount: 0,
      readbackVerifiedCount: 0,
      installerAvailable: false,
      deliveryManifestReady: false,
    });

    expect(matrix.status).toBe('needs_work');
    expect(matrix.headline).toContain('还差执行回读和最终交付证据');
    expect(matrix.primaryNextAction).toBe('先完成审批、真实执行回读和最终交付包');
    expect(matrix.items.find((item) => item.key === 'readback')?.tone).toBe('blocked');
    expect(matrix.items.find((item) => item.key === 'package')?.tone).toBe('blocked');
    expect(matrix.items.find((item) => item.key === 'aiEvidence')?.detail).toContain('1 条仅作洞察');
  });

  it('routes missing product context repair to product management instead of the legacy product config page', () => {
    const matrix = buildDeliveryReadinessMatrix({
      realReportCount: 8,
      importedRows: 96,
      actionableRows: 12,
      aiAvailable: true,
      aiSuccessCount: 1,
      operationEventCount: 1,
      productContextCount: 0,
      listingReadReady: true,
      listingDraftReady: true,
      pendingRecommendationCount: 0,
      approvedRecommendationCount: 0,
      readbackVerifiedCount: 0,
      installerAvailable: false,
      deliveryManifestReady: false,
    });

    const contextItem = matrix.items.find((item) => item.key === 'businessContext');

    expect(contextItem?.nextAction).toBe('维护运营事件和产品配置');
    expect(contextItem?.route).toBe('product-management');
  });

  it('does not mark review-only recommendations as directly approvable', () => {
    const matrix = buildDeliveryReadinessMatrix({
      realReportCount: 8,
      importedRows: 96,
      actionableRows: 12,
      aiAvailable: true,
      aiSuccessCount: 1,
      aiInsightOnlyCount: 0,
      operationEventCount: 1,
      productContextCount: 1,
      listingReadReady: true,
      listingDraftReady: true,
      pendingRecommendationCount: 0,
      reviewRecommendationCount: 2,
      approvedRecommendationCount: 0,
      readbackVerifiedCount: 0,
      installerAvailable: false,
      deliveryManifestReady: false,
    });

    const item = matrix.items.find((entry) => entry.key === 'recommendations');

    expect(item?.statusLabel).toBe('需复核');
    expect(item?.tone).toBe('warning');
    expect(item?.detail).toContain('2 条建议需复核');
    expect(item?.nextAction).toBe('进入审批中心复核');
  });

  it('surfaces concrete review blockers for review-only recommendations in delivery detail', () => {
    const input = buildDeliveryReadinessMatrixInput({
      data: {
        collection: { fileAudit: { realReportFileCount: 8, importedRowCount: 96 }, realReportFiles: [] },
        quant: { importedRows: 96, actionableRows: 12 },
      } as any,
      readiness: null,
      aiAvailable: true,
      aiDiagnosisRuns: [],
      pendingRecommendations: [
        {
          id: 1,
          status: 'pending',
          evidence: {
            decisionAgreement: 'aligned',
            aiLifecycleStageRequiresReview: true,
            aiLifecycleStageInvalidReasons: ['AI 阶段判断引用的指标证据缺少产品 ASIN。'],
            aiEvidenceSufficiency: {
              level: 'low',
              metricEvidenceCount: 1,
              sampleDays: 1,
              totalClicks: 80,
              totalCost: 120,
              totalOrders: 0,
              canUseForFormalActions: false,
              blockers: ['当前范围指标证据缺少真实广告报表 sourceFile/sourceRow，不能用于正式 AI 动作。'],
              warnings: [],
            },
          },
        },
      ],
      needsReviewRecommendations: [
        {
          id: 2,
          status: 'needs_review',
          evidence: {
            aiInsightInvalidReasons: ['AI 候选动作无法绑定当前范围内的真实广告对象。'],
          },
        },
      ],
      approvedRecommendations: [],
    });

    const matrix = buildDeliveryReadinessMatrix({
      ...input,
      aiAvailable: true,
      aiSuccessCount: 0,
      operationEventCount: 1,
      productContextCount: 1,
      listingReadReady: true,
      listingDraftReady: true,
      readbackVerifiedCount: 0,
      installerAvailable: false,
      deliveryManifestReady: false,
    });
    const item = matrix.items.find((entry) => entry.key === 'recommendations');

    expect(input.reviewRecommendationCount).toBe(2);
    expect(item?.detail).toContain('AI 阶段判断引用的指标证据缺少产品 ASIN。');
    expect(item?.detail).toContain('sourceFile/sourceRow');
    expect(item?.detail).toContain('AI 候选动作无法绑定当前范围内的真实广告对象。');
  });

  it('derives matrix input from current business data, AI runs, recommendations, manifest gates and package evidence', () => {
    const input = buildDeliveryReadinessMatrixInput({
      data: {
        collection: {
          fileAudit: { realReportFileCount: 8, importedRowCount: 96 },
          realReportFiles: Array.from({ length: 8 }, (_, index) => ({ id: String(index) })),
        },
        quant: { importedRows: 80, actionableRows: 12 },
        operations: { eventCount: 2, events: [], notes: [] },
        productContext: { productCount: 1, products: [], notes: [] },
      } as any,
      readiness: {
        appReady: true,
        manifestDriven: true,
        gates: [
          { name: 'listing_read', ok: true },
          { name: 'listing_ai_draft', ok: true },
          { name: 'ad_readback', ok: true },
        ],
      } as any,
      evidenceStatus: {
        package: {
          installerAvailable: true,
          installerPath: 'C:/release/AmazonAIOpsAgent-1.5.0.exe',
          portablePath: 'C:/release/AmazonAIOpsAgent-1.5.0-portable.exe',
          sha256: 'ABC123',
        },
      },
      aiAvailable: true,
      aiDiagnosisRuns: [
        {
          success: true,
          diagnosis: {
            source: 'ai',
            lifecycleStageEvidenceRefs: ['timeline:batch_1:search_term:abc'],
          },
          evidencePackPreview: [{ evidenceId: 'timeline:batch_1:search_term:abc', type: 'timeline', label: '时间线' }],
          insights: [{ entityName: '洞察词' }],
        },
        { success: false, diagnosis: { source: 'ai' }, insights: [{ entityName: '失败洞察' }] },
      ] as any,
      pendingRecommendations: [{ id: 1 }],
      needsReviewRecommendations: [{ id: 4 }, { id: 5 }],
      approvedRecommendations: [{ id: 2 }, { id: 3 }],
    });

    expect(input).toMatchObject({
      realReportCount: 8,
      importedRows: 96,
      actionableRows: 12,
      aiAvailable: true,
      aiSuccessCount: 1,
      aiInsightOnlyCount: 1,
      operationEventCount: 2,
      productContextCount: 1,
      listingReadReady: true,
      listingDraftReady: true,
      pendingRecommendationCount: 1,
      reviewRecommendationCount: 2,
      approvedRecommendationCount: 2,
      readbackVerifiedCount: 1,
      installerAvailable: true,
      deliveryManifestReady: true,
    });
  });

  it('does not count AI diagnosis runs as successful evidence when lifecycle refs have no preview details', () => {
    const input = buildDeliveryReadinessMatrixInput({
      data: {
        collection: { fileAudit: { realReportFileCount: 8, importedRowCount: 96 }, realReportFiles: [] },
        quant: { importedRows: 96, actionableRows: 12 },
      } as any,
      readiness: null,
      aiAvailable: true,
      aiDiagnosisRuns: [
        {
          success: true,
          diagnosis: {
            source: 'ai',
            lifecycleStage: 'keyword_exploration',
            lifecycleStageEvidenceRefs: ['metric:batch_1:user_search_term:2026-06-12:search_term:abc'],
          },
          evidencePackPreview: [],
          insights: [],
        },
      ] as any,
      pendingRecommendations: [],
      approvedRecommendations: [],
    });

    expect(input.aiSuccessCount).toBe(0);
  });

  it('does not count insights from failed AI diagnosis runs as delivered AI insight output', () => {
    const input = buildDeliveryReadinessMatrixInput({
      data: {
        collection: { fileAudit: { realReportFileCount: 8, importedRowCount: 96 }, realReportFiles: [] },
        quant: { importedRows: 96, actionableRows: 12 },
      } as any,
      readiness: null,
      aiAvailable: true,
      aiDiagnosisRuns: [
        {
          success: false,
          diagnosis: { source: 'ai', aiFallbackReason: 'AI 输出 JSON 无法解析' },
          insights: [{ entityName: '失败输出不应计入洞察' }],
        },
      ] as any,
      pendingRecommendations: [],
      approvedRecommendations: [],
    });

    expect(input.aiSuccessCount).toBe(0);
    expect(input.aiInsightOnlyCount).toBe(0);
  });

  it('does not demote rule-only pending recommendations because of batch-level AI lifecycle review', () => {
    const input = buildDeliveryReadinessMatrixInput({
      data: {
        collection: { fileAudit: { realReportFileCount: 8, importedRowCount: 96 }, realReportFiles: [] },
        quant: { importedRows: 96, actionableRows: 12 },
      } as any,
      readiness: null,
      aiAvailable: true,
      aiDiagnosisRuns: [],
      pendingRecommendations: [
        {
          id: 1,
          status: 'pending',
          evidence: {
            aiStrategySource: 'ai',
            aiLifecycleStageRequiresReview: true,
            decisionAgreement: 'rule_only',
          },
        },
        {
          id: 2,
          status: 'pending',
          evidence: {
            aiStrategySource: 'ai',
            aiLifecycleStageRequiresReview: true,
            decisionAgreement: 'aligned',
            aiEvidenceRefs: ['metric:batch_1:keyword:2026-06-12:search_term:abc'],
            aiEvidenceDetails: [{
              evidenceId: 'metric:batch_1:keyword:2026-06-12:search_term:abc',
              type: 'metric',
              label: '关键词指标',
            }],
          },
        },
      ],
      approvedRecommendations: [],
    });

    expect(input.pendingRecommendationCount).toBe(1);
    expect(input.reviewRecommendationCount).toBe(1);
  });

  it('does not treat failed manifest gates or raw APP_READY status as closed proof', () => {
    const input = buildDeliveryReadinessMatrixInput({
      data: {
        collection: {
          fileAudit: { realReportFileCount: 8, importedRowCount: 96 },
          realReportFiles: Array.from({ length: 8 }, (_, index) => ({ id: String(index) })),
        },
        quant: { importedRows: 96, actionableRows: 12 },
      } as any,
      readiness: {
        status: 'APP_READY',
        appReady: false,
        manifestDriven: true,
        gates: [
          { name: 'listing_read', ok: false },
          { name: 'ad_readback', ok: false },
        ],
      } as any,
      aiAvailable: true,
      aiDiagnosisRuns: [{ success: true, diagnosis: { source: 'rule' }, insights: [] }] as any,
      pendingRecommendations: [],
      approvedRecommendations: [],
    });

    expect(input.listingReadReady).toBe(false);
    expect(input.readbackVerifiedCount).toBe(0);
    expect(input.installerAvailable).toBe(false);
    expect(input.deliveryManifestReady).toBe(false);
    expect(input.aiSuccessCount).toBe(0);
  });

  it('does not infer installer availability from APP_READY manifest alone', () => {
    const input = buildDeliveryReadinessMatrixInput({
      data: {
        collection: { fileAudit: { realReportFileCount: 8, importedRowCount: 96 }, realReportFiles: [] },
        quant: { importedRows: 96, actionableRows: 12 },
      } as any,
      readiness: {
        status: 'APP_READY',
        appReady: true,
        manifestDriven: true,
        gates: [
          { name: 'listing_read', ok: true },
          { name: 'ad_readback', ok: true },
        ],
      } as any,
      evidenceStatus: {
        listing: {
          readReady: true,
          draftReady: true,
          contentCount: 1,
          fullContentCount: 1,
          draftCount: 1,
          aiDraftCount: 1,
          ruleFallbackDraftCount: 0,
        },
        readback: { verifiedCount: 1 },
      },
      aiAvailable: true,
      aiDiagnosisRuns: [],
      pendingRecommendations: [],
      approvedRecommendations: [],
    });

    expect(input.deliveryManifestReady).toBe(true);
    expect(input.installerAvailable).toBe(false);
  });

  it('uses persisted delivery evidence status before falling back to manifest gate inference', () => {
    const input = buildDeliveryReadinessMatrixInput({
      data: {
        collection: { fileAudit: { realReportFileCount: 8, importedRowCount: 96 }, realReportFiles: [] },
        quant: { importedRows: 96, actionableRows: 12 },
      } as any,
      readiness: {
        appReady: false,
        manifestDriven: true,
        gates: [
          { name: 'listing_read', ok: false },
          { name: 'ad_readback', ok: false },
        ],
      } as any,
      evidenceStatus: {
        listing: {
          readReady: true,
          draftReady: true,
          contentCount: 1,
          fullContentCount: 1,
          draftCount: 1,
          aiDraftCount: 1,
          ruleFallbackDraftCount: 0,
        },
        readback: {
          verifiedCount: 2,
        },
      },
      aiAvailable: false,
      aiDiagnosisRuns: [],
      pendingRecommendations: [],
      approvedRecommendations: [],
    });

    expect(input.listingReadReady).toBe(true);
    expect(input.listingDraftReady).toBe(true);
    expect(input.readbackVerifiedCount).toBe(2);
  });
});

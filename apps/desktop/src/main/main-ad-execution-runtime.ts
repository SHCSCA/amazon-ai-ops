import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { DailyReportGenerator } from '@amazon-ai-ops/ai-adapter';
import { runtimeLog } from './runtime-log-adapter';
import { readDailyReportRecommendationSummary } from './daily-report-recommendation-summary';
import { buildAdExecutionUnavailableResult, buildActionLogForExecution, getRecommendationExecutionOutcome } from './recommendation-execution-policy';
import { adReadbackEvidenceToMarkdown, buildAdReadbackEvidence } from './ad-readback-evidence';
import { buildAuthorizedAdReadbackEvidenceInput, type ExportAuthorizedAdReadbackEvidenceRequest } from './ad-readback-authority';
import { verifyAdReadbackEvidenceFile, type VerifiedAdReadbackEvidence } from './ad-readback-evidence-verifier';
import { fillAdReadbackSession, prepareAdReadbackSession, verifyAdReadbackSession, type FilledAdReadbackSession, type PreparedAdReadbackSession, type VerifiedAdReadbackSession } from './ad-readback-session';
import { saveReadbackCaptureFile, type ReadbackCaptureSlot, type SavedReadbackCapture } from './ad-readback-capture';
import { assertStoreScopedReadbackEvidenceData, ensureStoreScopedReadbackDirectories, resolveStoreScopedReadbackReference, withReadbackStoreBinding } from './readback-store-authority';
import { resolveBusinessStoreAuthority } from './main-business-scope-runtime';
import { currentStoreScopedReadbackAccess, storeCapsuleFor } from './main-store-access-runtime';
import { getBusinessRecommendationGate } from './main-business-metrics-runtime';
import { assertRecommendationWritableTargetCurrent, validateCurrentAdReadbackEvidenceAuthority } from './main-ad-readback-authority-runtime';
import { tryCaptureExecutionScreenshot } from './main-operator-browser-runtime';
import { buildAiProviderConfig, governedAiProvider, readAiSettingsForMain } from './main-ai-settings-runtime';
import { getMainRuntimeContext } from './main-runtime-access';

export function handleExportAdReadbackEvidence(input: ExportAuthorizedAdReadbackEvidenceRequest): {
  jsonPath: string;
  markdownPath: string;
  sha256: string;
  status: string;
  readyForVerifier: boolean;
  nextAction: 'verify' | 'prepare';
  authority: { recommendationId: number; revision: number; batchId: string };
} {
  const mainRuntimeContext = getMainRuntimeContext();
  const request = input || {} as ExportAuthorizedAdReadbackEvidenceRequest;
  const { context } = resolveBusinessStoreAuthority();
  const readbackAccess = currentStoreScopedReadbackAccess(context);
  let gate: ReturnType<typeof getBusinessRecommendationGate>;
  try {
    gate = getBusinessRecommendationGate({ ...request.scope, storeContext: context }, 'readback');
  } catch (caught) {
    runtimeLog.warn('[AdReadbackAuthority]', {
      stage: 'export-gate',
      recommendationId: Number(request.recommendationId) || null,
      reason: caught instanceof Error ? caught.message : String(caught || '当前范围不可用'),
    });
    throw new Error('结果核对被阻断：当前范围无法绑定真实报表批次，请刷新范围后重试。');
  }
  const recommendation = mainRuntimeContext.state.recommendationRepo?.findByIdForStore(
    context.storeId,
    Number(request.recommendationId),
  );
  const sourceAuthority = assertRecommendationWritableTargetCurrent(
    recommendation,
    {
      storeId: gate.scope.storeId,
      dateFrom: gate.scope.dateFrom,
      dateTo: gate.scope.dateTo,
      storeName: gate.scope.storeName,
      marketplaceCode: gate.scope.marketplaceCode,
      asin: gate.scope.asin,
      batchId: gate.scope.batchId || '',
    },
    gate.metricSource.sourceFiles,
  );
  const evidenceInput = buildAuthorizedAdReadbackEvidenceInput({
    request,
    recommendation,
    resolvedScope: {
      dateFrom: gate.scope.dateFrom,
      dateTo: gate.scope.dateTo,
      storeName: gate.scope.storeName,
      marketplaceCode: gate.scope.marketplaceCode,
      asin: gate.scope.asin,
      batchId: gate.scope.batchId || '',
    },
    allowedSourceFiles: gate.metricSource.sourceFiles,
    sourceAuthority,
  });
  assertStoreScopedReadbackEvidenceData(evidenceInput, readbackAccess, { requireBinding: false });
  const evidence = withReadbackStoreBinding(buildAdReadbackEvidence(evidenceInput), readbackAccess);
  ensureStoreScopedReadbackDirectories(readbackAccess);
  const exportDir = readbackAccess.candidatesDir;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = path.join(exportDir, `real-ad-execution-readback-${stamp}.json`);
  const markdownPath = jsonPath.replace(/\.json$/i, '.md');
  const jsonContent = `${JSON.stringify(evidence, null, 2)}\n`;
  fs.writeFileSync(jsonPath, jsonContent, 'utf8');
  fs.writeFileSync(markdownPath, adReadbackEvidenceToMarkdown(evidence, jsonPath), 'utf8');
  const readyForVerifier = evidence.status === 'PASS';
  return {
    jsonPath,
    markdownPath,
    sha256: crypto.createHash('sha256').update(jsonContent, 'utf8').digest('hex').toUpperCase(),
    status: evidence.status,
    readyForVerifier,
    nextAction: readyForVerifier ? 'verify' : 'prepare',
    authority: {
      recommendationId: request.recommendationId,
      revision: request.expectedRevision,
      batchId: gate.scope.batchId || '',
    },
  };
}

export function handlePrepareAdReadbackSession(input: { sourcePath?: string; outDir?: string }): PreparedAdReadbackSession {
  const readbackAccess = currentStoreScopedReadbackAccess();
  return prepareAdReadbackSession({
    sourcePath: String(input?.sourcePath || ''),
    outDir: typeof input?.outDir === 'string' && input.outDir.trim() ? input.outDir : undefined,
    storeAccess: readbackAccess,
  });
}

export function handleVerifyAdReadbackSession(input: { sessionDir?: string }): VerifiedAdReadbackSession {
  const readbackAccess = currentStoreScopedReadbackAccess();
  return verifyAdReadbackSession(String(input?.sessionDir || ''), readbackAccess);
}

export function handleFillAdReadbackSession(input: { sessionDir?: string }): FilledAdReadbackSession {
  const readbackAccess = currentStoreScopedReadbackAccess();
  return fillAdReadbackSession(String(input?.sessionDir || ''), readbackAccess);
}

export function handleVerifyAdReadbackEvidence(input: { evidencePath?: string }): VerifiedAdReadbackEvidence {
  const readbackAccess = currentStoreScopedReadbackAccess();
  const evidencePath = resolveStoreScopedReadbackReference(
    readbackAccess,
    String(input?.evidencePath || ''),
    'root',
  );
  const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8')) as Record<string, unknown>;
  assertStoreScopedReadbackEvidenceData(evidence, readbackAccess, { requireBinding: true });
  const result = verifyAdReadbackEvidenceFile(evidencePath);
  if (!result.ready) return result;

  const authority = validateCurrentAdReadbackEvidenceAuthority(result.evidencePath, 'verify');
  if (authority.ok) {
    return {
      ...result,
      checks: [
        ...result.checks,
        { label: 'database authority is still approved and current', passed: true },
      ],
    };
  }

  return {
    ...result,
    ready: false,
    status: 'NEEDS_WORK',
    checks: [
      ...result.checks,
      { label: 'database authority is still approved and current', passed: false, details: authority.message },
    ],
    issues: [...result.issues, authority.message],
  };
}

export function handleSaveReadbackCapture(input: {
  slot?: ReadbackCaptureSlot;
  dataUrl?: string;
  fileName?: string;
  sessionDir?: string;
}): SavedReadbackCapture {
  const slot = input?.slot;
  if (!slot || !['approval', 'before', 'after', 'readback'].includes(slot)) {
    throw new Error(`Unsupported readback capture slot: ${slot || '<missing>'}`);
  }
  const readbackAccess = currentStoreScopedReadbackAccess();
  ensureStoreScopedReadbackDirectories(readbackAccess);
  return saveReadbackCaptureFile({
    slot,
    dataUrl: String(input?.dataUrl || ''),
    fileName: typeof input?.fileName === 'string' ? input.fileName : undefined,
    sessionDir: typeof input?.sessionDir === 'string' && input.sessionDir.trim() ? input.sessionDir : undefined,
    fallbackRootDir: readbackAccess.capturesDir,
    storeAccess: readbackAccess,
  });
}

export async function handleExecuteRecommendation(recommendationId: number): Promise<void> {
  const mainRuntimeContext = getMainRuntimeContext();
  const { context } = resolveBusinessStoreAuthority();
  const recommendation = mainRuntimeContext.state.recommendationRepo?.findByIdForStore(context.storeId, recommendationId);
  if (!recommendation) {
    throw new Error('执行被阻断：建议不存在，请刷新后重试。');
  }

  if (recommendation.status !== 'approved') {
    throw new Error('执行被阻断：建议必须先完成人工批准。');
  }

  const executionResult = buildAdExecutionUnavailableResult(
    recommendation,
    '真实广告执行器尚未接入可验证回读。为避免误改广告账户或产生假成功记录，本次执行已阻断。',
  );
  const executionOutcome = getRecommendationExecutionOutcome(executionResult);

  const screenshotBefore = await tryCaptureExecutionScreenshot('before');
  const screenshotAfter = await tryCaptureExecutionScreenshot('after');

  
  mainRuntimeContext.state.actionLogRepo?.insertForStore(context.storeId, buildActionLogForExecution({
    recommendationId,
    recommendation,
    executionResult,
    outcome: executionOutcome,
    screenshotBefore,
    screenshotAfter,
  }));

  if (executionOutcome.shouldMarkExecuted) {
    const updated = mainRuntimeContext.state.recommendationRepo?.updateStatusWithEvidenceIfCurrentForStore(
      context.storeId,
      recommendationId,
      recommendation.status,
      recommendation.revision ?? 0,
      executionOutcome.recommendationStatus,
      {},
    );
    if (!updated) {
      throw new Error('执行状态冲突：建议状态已变化，请刷新后重试。');
    }
    return;
  }

  throw new Error(executionResult.error || '广告执行未通过回读确认，建议状态保持为 approved。');
}

export async function runDailyReportGeneration(): Promise<void> {
  const mainRuntimeContext = getMainRuntimeContext();
  const { context, store } = resolveBusinessStoreAuthority();
  const capsule = storeCapsuleFor(store);
  const today = context.businessDate;

  
  const totalRevenue = mainRuntimeContext.state.adMetricsRepo?.getTotalSalesForStore(context.storeId, today) || 0;
  const totalCost = mainRuntimeContext.state.adMetricsRepo?.getTotalCostForStore(context.storeId, today) || 0;
  const avgAcos = totalRevenue > 0 ? totalCost / totalRevenue : 0;
  const totalClicks = mainRuntimeContext.state.adMetricsRepo?.getTotalClicksForStore(context.storeId, today) || 0;
  const totalOrders = mainRuntimeContext.state.adMetricsRepo?.getTotalOrdersForStore(context.storeId, today) || 0;

  const summary = {
    date: today,
    storeName: store.displayName,
    salesOverview: {
      totalRevenue,
      totalOrders,
      avgOrderValue: totalOrders > 0 ? totalRevenue / totalOrders : 0,
      comparedToYesterday: 0,
    },
    adPerformance: {
      totalCost,
      totalSales: totalRevenue,
      avgAcos,
      totalClicks,
      comparedToYesterday: 0,
    },
    recommendationsSummary: readDailyReportRecommendationSummary(
      mainRuntimeContext.state.recommendationRepo,
      context.storeId,
      today,
    ),
    inventoryAlerts: {
      outOfStock: 0,
      lowStock: 0,
    },
    topRisks: [] as string[],
  };

  
  const settings = readAiSettingsForMain();
  try {
    const provider = settings.aiApiKey ? governedAiProvider(buildAiProviderConfig(settings), context, 'daily_summary')
      : { chat: async () => ({ success: false, error: '未配置 AI，使用模板摘要。' }), complete: async () => ({ success: false }), healthCheck: async () => false };
    const reportGen = new DailyReportGenerator(provider);
    const report = await reportGen.generate(summary);

    
    const reportPath = path.join(capsule.reportsDir, `daily_${today}.json`);
    fs.writeFileSync(reportPath, report);
    runtimeLog.log(`[Scheduler] Daily report generated: ${reportPath}`);
  } catch (err) {
    runtimeLog.error('[Scheduler] AI report generation failed:', err);
    throw err;
  }
}

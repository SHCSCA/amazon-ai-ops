import type {
  LingxingCollectionJobSnapshot,
  LingxingReportType,
  MissionControlTodayProjection,
  StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import { missionControlContextKey } from '@amazon-ai-ops/shared-types';

const REQUIRED_REPORT_TYPES: readonly LingxingReportType[] = [
  'campaign',
  'ad_group',
  'placement',
  'advertised_product',
  'auto_targeting',
  'keyword',
  'product_targeting',
  'user_search_term',
] as const;

export interface MissionControlCollectionWindow {
  dateStart: string;
  dateEnd: string;
  jobs: LingxingCollectionJobSnapshot[];
}

export interface TodayProductFact {
  status: string;
  cost?: {
    currentPrice?: number;
    purchaseCost?: number;
    targetAcos?: number;
  };
}

export interface TodayReportImportProof {
  batchId: string;
  reportType: LingxingReportType;
  importedRows: number;
  fileHash: string;
  runId: string;
}

export interface BuildMissionControlTodayProjectionInput {
  context: StoreContextEnvelope;
  products: readonly TodayProductFact[];
  collectionJobs: readonly LingxingCollectionJobSnapshot[];
  reportImportProofs: readonly TodayReportImportProof[];
  importedMetricRows: number;
  latestMetricDate?: string;
  operationEventsToday: number;
  browserSessionReady: boolean;
  now?: Date;
}

export function buildMissionControlTodayProjection(
  input: BuildMissionControlTodayProjectionInput,
): MissionControlTodayProjection {
  const products = input.products.filter((product) => product.status !== 'archived');
  const configuredProductCount = products.filter(isProductConfigured).length;
  const productionJobs = input.collectionJobs.filter((job) => !job.request.requestId.startsWith('canary:'));
  const expectedWindowEnd = previousIsoDate(input.context.businessDate);
  const collectionWindow = selectLatestMissionControlCollectionWindow(productionJobs, input.context);
  const jobs = collectionWindow?.jobs ?? [];
  const latest = jobs[0];
  const latestReportAttempts = new Map<LingxingReportType, {
    job: LingxingCollectionJobSnapshot;
    state: LingxingCollectionJobSnapshot['reports'][number]['state'];
    checkpointUpdatedAt: string;
  }>();
  for (const job of jobs) {
    for (const report of job.reports) {
      const existing = latestReportAttempts.get(report.reportType);
      const candidateOrder = `${report.updatedAt}\u0000${job.updatedAt}\u0000${job.jobId}`;
      const existingOrder = existing
        ? `${existing.checkpointUpdatedAt}\u0000${existing.job.updatedAt}\u0000${existing.job.jobId}`
        : '';
      if (!existing || candidateOrder > existingOrder) {
        latestReportAttempts.set(report.reportType, {
          job,
          state: report.state,
          checkpointUpdatedAt: report.updatedAt,
        });
      }
    }
  }
  const downloadedReports = REQUIRED_REPORT_TYPES.filter((reportType) => (
    latestReportAttempts.get(reportType)?.state === 'downloaded'
  )).length;
  const totalReports = REQUIRED_REPORT_TYPES.length;
  const fullCollection = Boolean(latest && downloadedReports === totalReports);
  const validImportProofKeys = new Set(input.reportImportProofs
    .filter((proof) => (
      proof.batchId.trim().length > 0
      && REQUIRED_REPORT_TYPES.includes(proof.reportType)
      && Number.isInteger(proof.importedRows)
      && proof.importedRows >= 0
      && /^[0-9a-f]{64}$/i.test(proof.fileHash.trim())
      && proof.runId.trim().length > 0
    ))
    .map((proof) => `${proof.batchId}\u0000${proof.reportType}`));
  const importedReportProofs = REQUIRED_REPORT_TYPES.filter((reportType) => {
    const attempt = latestReportAttempts.get(reportType);
    return Boolean(
      attempt
      && attempt.state === 'downloaded'
      && attempt.job.importState === 'succeeded'
      && validImportProofKeys.has(`${attempt.job.jobId}\u0000${reportType}`),
    );
  }).length;
  const failedImport = REQUIRED_REPORT_TYPES.some((reportType) => {
    const attempt = latestReportAttempts.get(reportType);
    return attempt?.state === 'downloaded' && attempt.job.importState === 'failed';
  });
  const pendingImport = REQUIRED_REPORT_TYPES.some((reportType) => {
    const attempt = latestReportAttempts.get(reportType);
    return attempt?.state === 'downloaded' && attempt.job.importState !== 'succeeded';
  });
  const everyReportImported = fullCollection && importedReportProofs === totalReports;
  const metricDateWithinCollection = Boolean(
    collectionWindow
    && input.latestMetricDate
    && input.latestMetricDate >= collectionWindow.dateStart
    && input.latestMetricDate <= collectionWindow.dateEnd,
  );
  const importSucceeded = Boolean(
    everyReportImported
    && (input.importedMetricRows === 0 || metricDateWithinCollection),
  );

  const readiness: MissionControlTodayProjection['readiness'] = [
    {
      id: 'products',
      label: '产品与经营目标',
      state: products.length > 0 && configuredProductCount === products.length
        ? 'ready'
        : products.length > 0 ? 'attention' : 'blocked',
      detail: products.length === 0
        ? '当前店铺尚未建立产品对象。'
        : `${configuredProductCount}/${products.length} 个产品已配置价格、成本与目标 ACOS。`,
      targetView: 'objects/products',
    },
    {
      id: 'collection',
      label: '领星八报表',
      state: fullCollection ? 'ready' : latest ? 'attention' : 'blocked',
      detail: latest
        ? `${downloadedReports}/${totalReports} 类已下载；同一日期窗聚合 ${jobs.length} 次真实任务。`
        : productionJobs.length > 0
          ? `当前业务日只接受截止 ${expectedWindowEnd} 的美国站采集窗口；历史或越界任务不计入今日就绪。`
          : '当前店铺尚无真实领星采集任务。',
      targetView: 'collection/reports',
    },
    {
      id: 'import',
      label: '广告事实入库',
      state: importSucceeded
        ? 'ready'
        : failedImport ? 'blocked' : 'attention',
      detail: importSucceeded
        ? `${importedReportProofs}/${totalReports} 类导入证明完整；${input.importedMetricRows} 行广告事实已入库${input.latestMetricDate ? `，最新日期 ${input.latestMetricDate}` : ''}。`
        : failedImport
          ? '下载已完成，但数据库导入失败；必须补导后才能分析。'
          : pendingImport
            ? '下载已完成，数据库导入尚未确认成功。'
            : fullCollection && importedReportProofs < totalReports
              ? `只有 ${importedReportProofs}/${totalReports} 类报表具备不可变导入证明，尚不能进入分析。`
            : everyReportImported && input.importedMetricRows > 0 && !metricDateWithinCollection
              ? `导入已提交，但指标最新日期 ${input.latestMetricDate || '未知'} 不在采集日期窗 ${collectionWindow?.dateStart || '未知'} 至 ${collectionWindow?.dateEnd || '未知'} 内。`
            : '尚无可验证的广告事实导入。',
      targetView: failedImport || pendingImport
        ? 'collection/reports'
        : 'collection/import-check',
    },
    {
      id: 'browser',
      label: '可见浏览器会话',
      state: input.browserSessionReady ? 'ready' : 'attention',
      detail: input.browserSessionReady
        ? '当前店铺独立浏览器会话已确认。'
        : '当前店铺尚未建立可见领星 ERP / Amazon Ads 会话。',
      targetView: 'collection/reports',
    },
  ];

  const blockers = readiness
    .filter((item) => item.state === 'blocked')
    .map((item) => `${item.label}：${item.detail}`);
  const attentionItems = readiness
    .filter((item) => item.state === 'attention')
    .map((item) => `${item.label}：${item.detail}`);
  let nextAction: MissionControlTodayProjection['nextAction'];
  if (products.length === 0 || configuredProductCount !== products.length) {
    nextAction = {
      id: 'configure-products',
      label: products.length === 0 ? '建立产品对象' : '补齐产品经营目标',
      detail: '先确认当前店铺产品、成本、价格与目标 ACOS，避免跨店或无边界分析。',
      targetView: 'objects/products',
      requiredCapabilityId: 'objects.products.view',
      available: false,
      blockerCode: 'TARGET_CAPABILITY_NOT_AUTHORIZED',
    };
  } else if (!fullCollection) {
    nextAction = {
      id: 'collect-eight-reports',
      label: '采集领星八类报表',
      detail: '在当前店铺可见浏览器中完成八类真实报表下载。',
      targetView: 'collection/reports',
      requiredCapabilityId: 'collection.reports.view',
      available: false,
      blockerCode: 'TARGET_CAPABILITY_NOT_AUTHORIZED',
    };
  } else if (!importSucceeded) {
    nextAction = {
      id: 'recover-import',
      label: failedImport ? '补导数据库' : '确认广告事实入库',
      detail: '只有八类所选报表的导入状态均为 succeeded 且具备不可变导入证明后，才能进入分析；合法零行报表同样需要证明。',
      targetView: failedImport || pendingImport
        ? 'collection/reports'
        : 'collection/import-check',
      requiredCapabilityId: failedImport || pendingImport
        ? 'collection.reports.view'
        : 'collection.import-check.view',
      available: false,
      blockerCode: 'TARGET_CAPABILITY_NOT_AUTHORIZED',
    };
  } else {
    nextAction = {
      id: 'review-ad-facts',
      label: '进入广告事实分析',
      detail: '数据与经营目标已就绪；下一步生成可追溯诊断与建议。',
      targetView: 'missions/facts',
      requiredCapabilityId: 'missions.mission.facts.view',
      available: false,
      blockerCode: 'TARGET_CAPABILITY_NOT_AUTHORIZED',
    };
  }

  return {
    storeId: input.context.storeId,
    authorityKey: missionControlContextKey(input.context),
    businessDate: input.context.businessDate,
    marketplace: 'US',
    currency: 'USD',
    generatedAt: (input.now ?? new Date()).toISOString(),
    facts: {
      productCount: products.length,
      configuredProductCount,
      collectionJobCount: jobs.length,
      ...(latest ? {
        latestCollectionJob: {
          jobId: latest.jobId,
          state: fullCollection ? 'lineage_completed' : 'lineage_incomplete',
          importState: importSucceeded
            ? 'succeeded'
            : failedImport ? 'failed' : pendingImport ? 'pending' : 'legacy_unverified',
          downloadedReports,
          totalReports,
          updatedAt: latest.updatedAt,
        },
      } : {}),
      importedMetricRows: input.importedMetricRows,
      ...(input.latestMetricDate ? { latestMetricDate: input.latestMetricDate } : {}),
      operationEventsToday: input.operationEventsToday,
      browserSessionReady: input.browserSessionReady,
    },
    readiness,
    blockers,
    attentionItems,
    nextAction,
  };
}

export function selectLatestMissionControlCollectionWindow(
  collectionJobs: readonly LingxingCollectionJobSnapshot[],
  context: StoreContextEnvelope,
): MissionControlCollectionWindow | undefined {
  const expectedWindowEnd = previousIsoDate(context.businessDate);
  const productionJobs = collectionJobs
    .filter((job) => (
      !job.request.requestId.startsWith('canary:')
      && job.request.storeContext.storeId === context.storeId
      && job.request.storeContext.browserProfileId === context.browserProfileId
      && job.request.storeContext.marketplace === 'US'
      && job.request.storeContext.currency === 'USD'
      && job.request.storeContext.businessTimezone === context.businessTimezone
      && job.request.storeContext.businessDate === context.businessDate
      && job.request.dateStart <= job.request.dateEnd
      && job.request.dateEnd === expectedWindowEnd
    ));
  const roots = productionJobs
    .filter(isValidProductionRoot)
    .sort((left, right) => (
      // Root selection is an authority decision. Import transitions and other
      // terminal bookkeeping mutate updatedAt, so only immutable creation
      // order may decide which independent production run is current.
      right.createdAt.localeCompare(left.createdAt)
      || right.jobId.localeCompare(left.jobId)
    ));
  const root = roots[0];
  if (!root) return undefined;
  const jobs = validatedLineageFamily(root, productionJobs)
    .sort((left, right) => (
      right.updatedAt.localeCompare(left.updatedAt)
      || right.jobId.localeCompare(left.jobId)
    ));
  return {
    dateStart: root.request.dateStart,
    dateEnd: root.request.dateEnd,
    jobs,
  };
}

function previousIsoDate(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function isCompleteReportSet(reportTypes: readonly LingxingReportType[]): boolean {
  return reportTypes.length === REQUIRED_REPORT_TYPES.length
    && new Set(reportTypes).size === REQUIRED_REPORT_TYPES.length
    && REQUIRED_REPORT_TYPES.every((reportType) => reportTypes.includes(reportType));
}

function isValidProductionRoot(job: LingxingCollectionJobSnapshot): boolean {
  if (!isCompleteReportSet(job.request.reportTypes)) return false;
  // A standalone eight-report snapshot is not production authority. Main
  // issues this lineage only after it has bound the request to one durable
  // full-run root; accepting a missing lineage would let imported legacy or
  // forged snapshots unlock Today readiness.
  if (!job.lineage) return false;
  return job.lineage.lineageId === job.jobId
    && job.lineage.rootJobId === job.jobId
    && job.lineage.parentJobId === undefined
    && job.lineage.purpose === 'production_full'
    && isCompleteReportSet(job.lineage.expectedReportTypes);
}

function validatedLineageFamily(
  root: LingxingCollectionJobSnapshot,
  candidates: readonly LingxingCollectionJobSnapshot[],
): LingxingCollectionJobSnapshot[] {
  const byId = new Map(candidates.map((job) => [job.jobId, job]));
  const rootId = root.jobId;
  const valid = new Map<string, boolean>([[rootId, true]]);
  const isValidMember = (job: LingxingCollectionJobSnapshot, visiting = new Set<string>()): boolean => {
    const cached = valid.get(job.jobId);
    if (cached !== undefined) return cached;
    const lineage = job.lineage;
    if (
      !lineage
      || lineage.lineageId !== rootId
      || lineage.rootJobId !== rootId
      || !lineage.parentJobId
      || !['resume', 'retry'].includes(lineage.purpose)
      || !isCompleteReportSet(lineage.expectedReportTypes)
      || job.request.reportTypes.length < 1
      || new Set(job.request.reportTypes).size !== job.request.reportTypes.length
      || job.request.reportTypes.some((reportType) => !REQUIRED_REPORT_TYPES.includes(reportType))
    ) {
      valid.set(job.jobId, false);
      return false;
    }
    if (visiting.has(job.jobId)) {
      valid.set(job.jobId, false);
      return false;
    }
    const parent = byId.get(lineage.parentJobId);
    if (!parent) {
      valid.set(job.jobId, false);
      return false;
    }
    const nextVisiting = new Set(visiting).add(job.jobId);
    const parentValid = parent.jobId === rootId || isValidMember(parent, nextVisiting);
    valid.set(job.jobId, parentValid);
    return parentValid;
  };
  return candidates.filter((job) => job.jobId === rootId || isValidMember(job));
}

function isProductConfigured(product: TodayProductFact): boolean {
  const cost = product.cost;
  return Boolean(
    cost
    && Number.isFinite(cost.currentPrice)
    && Number(cost.currentPrice) > 0
    && Number.isFinite(cost.purchaseCost)
    && Number(cost.purchaseCost) >= 0
    && Number.isFinite(cost.targetAcos)
    && Number(cost.targetAcos) > 0
    && Number(cost.targetAcos) <= 1,
  );
}

import { type ExperimentRecord, type StoreContextEnvelope, type UsCurrency } from '@amazon-ai-ops/shared-types';
import { ExperimentMetricSourceRow } from './contracts';
import  {
  localPolicyClock,
  formatExperimentNumber,
  validateExperimentMeasurementContract,
  businessDayEnd,
  compareExperimentGuardrail,
  stateConflict,
  referenceConflict,
} from './values';
import type { MissionDomainRepositoryContext } from './context';
export function requireVerifiedExperimentBaseline(this: MissionDomainRepositoryContext, 
    context: StoreContextEnvelope,
    experiment: ExperimentRecord,
  ): Record<string, unknown>{
    const mission = this.requireMission(context, experiment.missionId);
    if (mission.status !== 'active' || !['readback', 'effect'].includes(mission.phase)) {
      throw stateConflict('运营任务尚未完成真实广告执行与刷新回读；请先在实时执行中完成并核验该动作。');
    }
    const readbackCheckpoint = this.listMissionCheckpoints(context, mission.id)
      .find((checkpoint) => checkpoint.stage === 'READBACK'
        && checkpoint.status === 'verified'
        && checkpoint.evidenceCount >= 3);
    if (!readbackCheckpoint) {
      throw stateConflict('运营任务缺少包含前值、提交后与独立刷新证据的回读检查点；请先完成真实执行证据对账。');
    }
    if (!mission.productId || !experiment.productId || mission.productId !== experiment.productId) {
      throw referenceConflict('经营实验产品必须与所选运营任务的产品完全一致；请重新选择当前任务产品。');
    }
    if (!experiment.adEntityId) {
      throw referenceConflict('经营实验必须选择已核验的具体广告对象；请返回产品与广告对象重新选择。');
    }
    const verified = this.listDecisions(context, { missionId: mission.id })
      .filter((decision) => decision.status === 'verified'
        && decision.actionType === 'set_keyword_bid'
        && decision.adEntityId === experiment.adEntityId
        && (!decision.productId || decision.productId === experiment.productId));
    if (verified.length === 0) {
      throw stateConflict('所选广告对象没有当前运营任务的已验证执行回读；请先完成该对象的执行与刷新核验。');
    }
    const latestActionRevision = Math.max(...verified.map((decision) => decision.actionRevision));
    const latest = verified.filter((decision) => decision.actionRevision === latestActionRevision);
    if (latest.length !== 1) {
      throw referenceConflict('所选广告对象存在多个同版本已验证结果，无法唯一确定实验干预；请先完成账本对账。');
    }
    const decision = latest[0];
    const currentBidUsd = Number(decision.currentValue);
    const appliedBidUsd = Number(decision.recommendedValue);
    if (!Number.isFinite(currentBidUsd) || !Number.isFinite(appliedBidUsd)
      || currentBidUsd <= 0 || appliedBidUsd <= 0) {
      throw referenceConflict('已验证决策缺少可用的竞价前后值；请重新执行并刷新回读该广告对象。');
    }
    const variant = experiment.variant && typeof experiment.variant === 'object' && !Array.isArray(experiment.variant)
      ? experiment.variant as Record<string, unknown>
      : {};
    if (variant.onlyVariable !== 'keyword_bid'
      || !Number.isFinite(Number(variant.bidUsd))
      || Math.abs(Number(variant.bidUsd) - appliedBidUsd) > 0.000_001) {
      throw referenceConflict('实验变量与已验证竞价结果不一致；请按真实回读值重新建立实验。');
    }
    const verifiedHistory = this.listDecisionHistory(context, decision.id)
      .find((event) => event.eventType === 'verified');
    if (!verifiedHistory) {
      throw referenceConflict('已验证决策缺少不可变回读历史；请先完成账本对账。');
    }
    if (Date.parse(experiment.observationStartsAt) < Date.parse(verifiedHistory.createdAt)) {
      throw stateConflict('实验观察起点不能早于已验证的竞价干预；请重新设置观察窗口。');
    }
    const proposals = this.db.prepare(`
      SELECT proposal.ad_entity_authority_id AS authorityId
      FROM analysis_proposal_decision_links link
      JOIN analysis_proposal_snapshots proposal ON proposal.store_id = link.store_id AND proposal.id = link.proposal_id
      JOIN verified_ad_entity_authority verified ON verified.store_id = proposal.store_id
        AND verified.authority_id = proposal.ad_entity_authority_id
        AND verified.ad_entity_id = proposal.ad_entity_id AND verified.entity_revision = proposal.ad_entity_revision
      JOIN analysis_evidence_packages evidence ON evidence.store_id = verified.store_id AND evidence.id = verified.evidence_package_id
      WHERE link.store_id = ? AND link.decision_id = ? AND proposal.mission_id = ?
        AND proposal.action_revision = ? AND proposal.ad_entity_id = ? AND proposal.data_batch_id = ?
        AND evidence.data_batch_id = proposal.data_batch_id
        AND proposal.current_bid_cents = ? AND proposal.proposed_bid_cents = ?
    `).all(context.storeId, decision.id, mission.id, decision.actionRevision, experiment.adEntityId,
      mission.dataBatchId, Math.round(currentBidUsd * 100), Math.round(appliedBidUsd * 100)) as Array<{ authorityId: string }>;
    if (proposals.length !== 1) {
      throw referenceConflict('已验证决策缺少唯一的原始分析对象快照；请先完成证据对账。');
    }
    return {
      source: 'verified_ads_readback',
      decisionId: decision.id,
      decisionRevision: decision.revision,
      actionRevision: decision.actionRevision,
      dataBatchId: decision.dataBatchId,
      productId: experiment.productId,
      adEntityId: experiment.adEntityId,
      adEntityAuthorityId: proposals[0].authorityId,
      currentBidUsd,
      appliedBidUsd,
      verifiedAt: verifiedHistory.createdAt,
      readbackCheckpointId: readbackCheckpoint.id,
      readbackEvidenceCount: readbackCheckpoint.evidenceCount,
    };
  }

export function captureExperimentMetrics(this: MissionDomainRepositoryContext, 
    context: StoreContextEnvelope,
    experiment: ExperimentRecord,
    dataBatchId: string,
    phase: 'baseline' | 'result',
    createdAt: string,
    baselineAuthorityId?: string,
  ): void{
    validateExperimentMeasurementContract(experiment.primaryMetric, experiment.guardrailMetrics, experiment.guardrailCriteria);
    const importRunId = this.requireCompletedDataBatch(context, dataBatchId, true);
    const rows = this.db.prepare(`
      SELECT verified.entity_revision AS entityRevision,
             SUM(metrics.clicks) AS clicks,
             SUM(metrics.cost) AS cost,
             SUM(metrics.orders) AS orders,
             SUM(metrics.sales) AS sales,
             metrics.currency AS currency,
             batch.date_start AS dateStart,
             batch.date_end AS dateEnd
      FROM verified_ad_entity_authority verified
      JOIN analysis_evidence_packages evidence
        ON evidence.store_id = verified.store_id
       AND evidence.id = verified.evidence_package_id
      JOIN report_import_runs runs
        ON runs.store_id = evidence.store_id
       AND runs.run_id = evidence.import_run_id
       AND runs.batch_id = evidence.data_batch_id
       AND runs.status = 'completed'
      JOIN report_import_file_snapshots snapshots
        ON snapshots.store_id = runs.store_id
       AND snapshots.run_id = runs.run_id
       AND snapshots.batch_id = runs.batch_id
       AND snapshots.report_type = verified.source_report_type
       AND snapshots.file_hash = verified.source_file_hash
       AND snapshots.report_file_id IS NOT NULL
      JOIN ad_daily_metrics anchor
        ON anchor.store_id = evidence.store_id
       AND anchor.batch_id = evidence.data_batch_id
       AND anchor.report_type = verified.source_report_type
       AND anchor.source_file = snapshots.file_path
       AND anchor.source_row = verified.source_row
       AND anchor.store_authority_quarantined = 0
      JOIN ad_daily_metrics metrics
        ON metrics.store_id = evidence.store_id
       AND metrics.batch_id = evidence.data_batch_id
       AND metrics.report_type = verified.source_report_type
       AND metrics.source_file = snapshots.file_path
       AND lower(trim(COALESCE(metrics.match_type, ''))) = lower(trim(COALESCE(anchor.match_type, '')))
       AND upper(trim(metrics.asin)) = upper(trim(anchor.asin))
       AND lower(trim(metrics.campaign_name)) = lower(trim(anchor.campaign_name))
       AND lower(trim(metrics.ad_group_name)) = lower(trim(anchor.ad_group_name))
       AND lower(trim(metrics.targeting)) = lower(trim(anchor.targeting))
       AND metrics.store_authority_quarantined = 0
      JOIN lingxing_report_batches batch
        ON batch.store_id = evidence.store_id
       AND batch.id = evidence.data_batch_id
       AND batch.status = 'completed'
      WHERE verified.store_id = ?
        AND verified.ad_entity_id = ?
        AND verified.entity_type = 'keyword'
        AND verified.source_report_type = 'keyword'
        AND evidence.data_batch_id = ?
        AND evidence.import_run_id = ?
        AND (? IS NULL OR verified.authority_id = ?)
        AND (? IS NOT NULL OR NOT EXISTS (
          SELECT 1 FROM verified_ad_entity_authority newer
          JOIN analysis_evidence_packages newer_evidence ON newer_evidence.store_id = newer.store_id
            AND newer_evidence.id = newer.evidence_package_id
          WHERE newer.store_id = verified.store_id AND newer.ad_entity_id = verified.ad_entity_id
            AND newer_evidence.data_batch_id = evidence.data_batch_id AND newer.entity_revision > verified.entity_revision
        ))
        AND upper(trim(metrics.asin)) = upper(trim(?))
        AND lower(trim(metrics.campaign_name)) = lower(trim(verified.campaign_name))
        AND lower(trim(metrics.ad_group_name)) = lower(trim(verified.ad_group_name))
        AND lower(trim(metrics.targeting)) = lower(trim(verified.entity_name))
        AND NOT EXISTS (
          SELECT 1
          FROM store_migration_quarantine quarantine
          WHERE quarantine.source_table = 'ad_daily_metrics'
            AND quarantine.source_row_id IN (CAST(metrics.id AS TEXT), CAST(anchor.id AS TEXT))
            AND quarantine.status = 'pending'
        )
      GROUP BY verified.authority_id, verified.entity_revision, metrics.currency, batch.date_start, batch.date_end
      HAVING COUNT(DISTINCT anchor.id) = 1 AND COUNT(*) = COUNT(DISTINCT metrics.date)
      ORDER BY verified.entity_revision DESC, verified.authority_id DESC
    `).all(
      context.storeId,
      experiment.adEntityId,
      dataBatchId,
      importRunId,
      baselineAuthorityId ?? null, baselineAuthorityId ?? null, baselineAuthorityId ?? null,
      experiment.productId,
    ) as ExperimentMetricSourceRow[];
    if (rows.length !== 1) {
      throw referenceConflict(`无法从${phase === 'baseline' ? '当前任务' : '观察结果'}批次唯一定位该广告对象的指标源行；请刷新对象权威并重新运行分析。`);
    }
    const row = rows[0];
    if (row.currency !== 'USD') {
      throw referenceConflict('经营实验 V1 只接受当前美国站 USD 指标；请检查报表币种后重试。');
    }
    const observedAt = businessDayEnd(row.dateEnd, context.businessTimezone);
    if (Date.parse(observedAt) > Date.parse(createdAt)) {
      throw stateConflict('报表所含美国业务日尚未结束，不能形成完整实验指标；请等待并导入已完成业务日。');
    }
    if (phase === 'baseline' && Date.parse(observedAt) > Date.parse(experiment.observationStartsAt)) {
      throw stateConflict('当前任务批次晚于实验观察起点，不能作为基线；请重新设置观察窗口。');
    }
    if (phase === 'result' && Date.parse(observedAt) < Date.parse(experiment.observationEndsAt)) {
      throw stateConflict('最新完成批次尚未覆盖实验观察终点；请等待并导入观察窗结束后的报表。');
    }
    if (phase === 'result' && (row.dateStart !== localPolicyClock(new Date(experiment.observationStartsAt), context.businessTimezone).businessDate
      || row.dateEnd !== localPolicyClock(new Date(Date.parse(experiment.observationEndsAt) - 1), context.businessTimezone).businessDate)) {
      throw stateConflict('结果批次必须精确覆盖观察窗口对应的美国业务日；请按实验窗口重新采集完整报表。');
    }
    const requiredMetrics = [...new Set([experiment.primaryMetric, ...experiment.guardrailMetrics])];
    requiredMetrics.forEach((metric, index) => {
      const normalized = metric.trim().toLocaleUpperCase('en-US');
      let value: number;
      let currency: UsCurrency | null = null;
      if (normalized === 'ACOS') {
        if (!(row.sales > 0)) throw stateConflict(`${phase === 'baseline' ? '基线' : '结果'}广告销售额为 0，无法计算 ACOS；请补齐有效观察数据。`);
        value = row.cost / row.sales;
      } else if (normalized === 'CVR') {
        if (!(row.clicks > 0)) throw stateConflict(`${phase === 'baseline' ? '基线' : '结果'}点击量为 0，无法计算 CVR；请补齐有效观察数据。`);
        value = row.orders / row.clicks;
      } else if (normalized === '广告订单' || normalized === 'ORDERS') {
        value = row.orders;
      } else if (normalized === '花费' || normalized === 'SPEND' || normalized === 'COST') {
        value = row.cost;
        currency = 'USD';
      } else if (normalized === '广告销售额' || normalized === 'SALES') {
        value = row.sales;
        currency = 'USD';
      } else if (normalized === 'TACOS') {
        throw stateConflict('当前数据只有广告销售额，不能冒充 TACOS 所需的产品总销售额；请改用受支持指标。');
      } else {
        throw stateConflict(`暂不支持经营实验指标“${metric.trim()}”；请改用 ACOS、CVR、广告订单、广告销售额或花费。`);
      }
      if (!Number.isFinite(value) || value < 0) {
        throw referenceConflict(`经营实验基线指标“${metric.trim()}”不是有效数值；请重新导入报表。`);
      }
      const id = `experiment-metric:${experiment.id}:${phase}:${index + 1}`;
      this.db.prepare(`
        INSERT INTO experiment_metric_snapshots (
          id, store_id, experiment_id, metric, value, currency,
          observed_at, data_batch_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, context.storeId, experiment.id, metric.trim(), value, currency,
        observedAt, dataBatchId, createdAt,
      );
      this.appendCausalInternal(context, {
        id: `causal:${id}`,
        stage: 'FACT',
        eventType: 'experiment_metric_snapshot',
        entityType: 'experiment_metric_snapshot',
        entityId: id,
        missionId: experiment.missionId,
        title: `${metric.trim()} ${phase === 'baseline' ? '基线' : '结果'}快照`,
        signal: `${metric.trim()}=${value}`,
        status: 'recorded',
        source: dataBatchId,
        actorId: 'system',
      }, createdAt);
    });
  }

export function assertExperimentMetricCoverage(this: MissionDomainRepositoryContext, 
    context: StoreContextEnvelope,
    experiment: ExperimentRecord,
  ): void{
    const snapshots = this.listExperimentMetricSnapshots(context, experiment.id);
    const requiredMetrics = [...new Set([
      experiment.primaryMetric,
      ...experiment.guardrailMetrics,
    ].map((metric) => metric.trim().toLocaleUpperCase('en-US')))];
    const missing: string[] = [];
    for (const requiredMetric of requiredMetrics) {
      const matching = snapshots.filter((snapshot) => (
        snapshot.metric.trim().toLocaleUpperCase('en-US') === requiredMetric
      ));
      const baseline = matching.find((snapshot) => (
        Date.parse(snapshot.observedAt) <= Date.parse(experiment.observationStartsAt)
      ));
      const result = matching.find((snapshot) => (
        Date.parse(snapshot.observedAt) >= Date.parse(experiment.observationEndsAt)
          && snapshot.dataBatchId !== baseline?.dataBatchId
      ));
      if (!baseline || !result) missing.push(requiredMetric);
    }
    if (missing.length > 0) {
      throw stateConflict(
        `经营实验缺少系统指标快照：${missing.join('、')}。请先完成基线采集，并在观察窗结束后导入新的完整报表。`,
      );
    }
  }

export function requireLatestExperimentResultBatch(this: MissionDomainRepositoryContext, 
    context: StoreContextEnvelope,
    experiment: ExperimentRecord,
  ): string{
    const mission = this.requireMission(context, experiment.missionId);
    const row = this.db.prepare(`
      SELECT batch.id AS batchId,
             MAX(COALESCE(runs.completed_at, runs.created_at)) AS importedAt
      FROM lingxing_report_batches batch
      JOIN report_import_runs runs
        ON runs.store_id = batch.store_id
       AND runs.batch_id = batch.id
       AND runs.status = 'completed'
      WHERE batch.store_id = ?
        AND batch.status = 'completed'
        AND batch.id <> ?
        AND batch.date_end >= ?
      GROUP BY batch.id, batch.completed_at, batch.created_at
      ORDER BY importedAt DESC, batch.completed_at DESC, batch.created_at DESC, batch.id DESC
      LIMIT 1
    `).get(
      context.storeId,
      mission.dataBatchId,
      localPolicyClock(new Date(Date.parse(experiment.observationEndsAt) - 1), context.businessTimezone).businessDate,
    ) as { batchId: string } | undefined;
    if (!row) {
      throw stateConflict('观察窗结束后还没有新的已完成导入；请先采集并导入覆盖观察终点的 8 类报表。');
    }
    return row.batchId;
  }

export function buildExperimentEvaluation(this: MissionDomainRepositoryContext, 
    context: StoreContextEnvelope,
    experiment: ExperimentRecord,
  ): {
    status: 'completed' | 'paused';
    conclusion: string;
    eventType: 'experiment_completed' | 'experiment_guardrail_triggered';
  }{
    const snapshots = this.listExperimentMetricSnapshots(context, experiment.id);
    const pairFor = (metric: string) => {
      const normalized = metric.trim().toLocaleUpperCase('en-US');
      const matching = snapshots.filter((snapshot) => (
        snapshot.metric.trim().toLocaleUpperCase('en-US') === normalized
      ));
      const baseline = matching.find((snapshot) => (
        Date.parse(snapshot.observedAt) <= Date.parse(experiment.observationStartsAt)
      ));
      const result = matching.find((snapshot) => (
        Date.parse(snapshot.observedAt) >= Date.parse(experiment.observationEndsAt)
          && snapshot.dataBatchId !== baseline?.dataBatchId
      ));
      if (!baseline || !result) {
        throw stateConflict(`经营实验指标“${metric}”缺少可比较的基线或结果快照。`);
      }
      return { baseline, result };
    };
    const primary = pairFor(experiment.primaryMetric);
    const primaryChangePct = primary.baseline.value === 0
      ? undefined
      : ((primary.result.value - primary.baseline.value) / Math.abs(primary.baseline.value)) * 100;
    const primaryLine = `${experiment.primaryMetric}：${formatExperimentNumber(primary.baseline.value)} → ${formatExperimentNumber(primary.result.value)}`
      + (primaryChangePct === undefined
        ? '（基线为 0，仅记录绝对结果）'
        : `（${primaryChangePct >= 0 ? '上升' : '下降'} ${formatExperimentNumber(Math.abs(primaryChangePct))}%）`);
    const guardrailLines: string[] = [];
    let breached = false;
    experiment.guardrailMetrics.forEach((metric, index) => {
      const criterion = experiment.guardrailCriteria[index]?.trim();
      if (!criterion) {
        throw stateConflict(`守护指标“${metric}”缺少结构化判断标准；请暂停后补充。`);
      }
      const parsed = criterion.match(/(<=|>=|<|>)\s*(-?\d+(?:\.\d+)?)\s*%\s*$/);
      if (!parsed) {
        throw stateConflict(`守护标准“${criterion}”无法安全解析；请使用例如“${metric} >= 95%”的基线比例格式。`);
      }
      const pair = pairFor(metric);
      if (pair.baseline.value === 0) {
        throw stateConflict(`守护指标“${metric}”基线为 0，无法计算相对比例；请改用可判定指标。`);
      }
      const actualPct = (pair.result.value / pair.baseline.value) * 100;
      const threshold = Number(parsed[2]);
      const passed = compareExperimentGuardrail(actualPct, parsed[1], threshold);
      if (!passed) breached = true;
      guardrailLines.push(
        `${metric}结果为基线的 ${formatExperimentNumber(actualPct)}%，要求 ${parsed[1]} ${formatExperimentNumber(threshold)}%，${passed ? '未触发' : '已触发'}`,
      );
    });
    const conclusion = `系统已根据同店铺、同任务、同广告对象的只追加指标快照完成判定。${primaryLine}。守护栏：${guardrailLines.join('；')}。`;
    return breached
      ? { status: 'paused', conclusion: `守护栏触发，实验已停止继续观察。${conclusion}`, eventType: 'experiment_guardrail_triggered' }
      : { status: 'completed', conclusion, eventType: 'experiment_completed' };
  }

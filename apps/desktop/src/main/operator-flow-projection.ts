import type {
  AdExecutionBatchProjection, CausalEventRecord, DecisionRecord, ExperimentRecord, MissionAnalysisProjection,
  MissionControlTodayProjection, MissionGrantRecord, MissionRecord, OperatorFlowStageId,
  OperatorFlowStageProjection, OperatorFlowStageState, StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import { missionControlContextKey, sanitizeCausalExportText } from '@amazon-ai-ops/shared-types';

export interface OperatorFlowDomainReader {
  listMissions(context: StoreContextEnvelope, input: { includeArchived: boolean }): MissionRecord[];
  listDecisions(context: StoreContextEnvelope, input: { includeArchived: boolean }): DecisionRecord[];
  listMissionGrants(context: StoreContextEnvelope, missionId: string): MissionGrantRecord[];
  listExperiments(context: StoreContextEnvelope, input: { includeArchived: boolean }): ExperimentRecord[];
  listCausalEvents(context: StoreContextEnvelope, input: { missionId: string }): CausalEventRecord[];
}

const STATUS: Record<OperatorFlowStageState, string> = {
  pending: '尚未开始', in_progress: '进行中', recorded: '已有记录', verified: '已核验', blocked: '已阻断', unknown: '待核验',
};
const TARGETS: Record<OperatorFlowStageId, OperatorFlowStageProjection['targetView']> = {
  'store-context': 'settings/ai-and-local', products: 'objects/products', reports: 'collection/reports', import: 'collection/import-check',
  mission: 'missions/overview', analysis: 'missions/overview', decision: 'decisions/recommendations', grant: 'decisions/recommendations',
  execution: 'execution/live', readback: 'execution/evidence', experiment: 'experiments/ledger', memory: 'memory/timeline', delivery: 'settings/delivery',
};
const LABELS: Record<OperatorFlowStageId, string> = {
  'store-context': '当前店铺', products: '产品范围', reports: '八报表采集', import: '正式导入', mission: '运营任务',
  analysis: '分析运行', decision: '建议决策', grant: '执行授权', execution: '广告执行', readback: '结果回读',
  experiment: '经营实验', memory: '经营记忆', delivery: '交付验收',
};
const NEXT: Record<OperatorFlowStageId, string> = {
  'store-context': '核对店铺与连接', products: '管理产品与目标', reports: '处理报表采集', import: '核对导入结果', mission: '管理运营任务',
  analysis: '查看分析并处理阻断', decision: '复核当前建议', grant: '核对授权与失效原因', execution: '查看执行进度', readback: '核对回读与只读对账',
  experiment: '查看观察窗与系统判定', memory: '查看事实与因果证据', delivery: '刷新当前交付核验',
};

function stage(id: OperatorFlowStageId, state: OperatorFlowStageState, latestResult: string, blocker?: string): OperatorFlowStageProjection {
  const result = sanitizeCausalExportText(latestResult);
  return { id, label: LABELS[id], state, statusLabel: STATUS[state], latestResult: /\b(?:MissionGrant|Mission|Experiment|Decision|StoreContext|Renderer|UNKNOWN|revision|fingerprint|manifest)\b/i.test(result)
    ? '该阶段已追加业务记录，请进入对应页面查看具体结果。' : result,
    blocker: sanitizeCausalExportText(blocker ?? (state === 'unknown' ? '尚无可核验的当前阶段结论。' : '当前没有持久化的阻断记录。')),
    nextAction: NEXT[id], targetView: TARGETS[id] };
}
function latest<T>(rows: readonly T[], timestamp: (row: T) => string): T | undefined {
  return [...rows].sort((a, b) => timestamp(b).localeCompare(timestamp(a)))[0];
}
function assertStore(context: StoreContextEnvelope, rows: readonly { storeId: string }[]) {
  if (rows.some(row => row.storeId !== context.storeId)) throw new Error('OPERATOR_FLOW_STORE_MISMATCH');
}

export function buildOperatorFlowProjection(input: {
  context: StoreContextEnvelope;
  today: MissionControlTodayProjection;
  domain?: OperatorFlowDomainReader | null;
  analysis: MissionAnalysisProjection | null;
  execution: readonly AdExecutionBatchProjection[];
}): OperatorFlowStageProjection[] {
  const { context, today, domain, analysis } = input;
  if (today.storeId !== context.storeId || today.businessDate !== context.businessDate
    || today.authorityKey !== missionControlContextKey(context)) throw new Error('OPERATOR_FLOW_CONTEXT_MISMATCH');
  const missions = domain?.listMissions(context, { includeArchived: true }) ?? [];
  assertStore(context, missions);
  const active = latest(missions.filter(row => row.status === 'active'), row => row.updatedAt);
  const mission = active ?? latest(missions, row => row.updatedAt);
  const decisions = (domain?.listDecisions(context, { includeArchived: true }) ?? []).filter(row => row.missionId === mission?.id);
  const grants = mission ? domain?.listMissionGrants(context, mission.id) ?? [] : [];
  const experiments = (domain?.listExperiments(context, { includeArchived: true }) ?? []).filter(row => row.missionId === mission?.id);
  const events = mission ? domain?.listCausalEvents(context, { missionId: mission.id }) ?? [] : [];
  assertStore(context, [...decisions, ...grants, ...experiments, ...events, ...input.execution.map(item => item.batch)]);
  if (analysis) {
    const records = [...analysis.evidencePackages, ...analysis.actionBatches, ...analysis.proposals];
    assertStore(context, records);
    if (records.some(row => row.missionId !== active?.id) || (analysis.analysisRun && analysis.analysisRun.missionId !== active?.id)) {
      throw new Error('OPERATOR_FLOW_MISSION_MISMATCH');
    }
  }
  if (events.some(row => row.missionId !== mission?.id)) throw new Error('OPERATOR_FLOW_MISSION_MISMATCH');
  const execution = latest(input.execution.filter(item => item.batch.missionId === mission?.id), item => item.batch.updatedAt);
  const decision = latest(decisions, row => row.updatedAt);
  const grant = latest(grants, row => row.issuedAt);
  const experiment = latest(experiments, row => row.updatedAt);
  const eventOrder = (row: CausalEventRecord) => row.createdAt + '\u0000' + String(row.sequence).padStart(20, '0');
  const receipt = latest(events.filter(row => row.entityType === 'analysis_run'), eventOrder);
  const memory = latest(events, eventOrder);
  const rows: OperatorFlowStageProjection[] = [stage('store-context', 'recorded', '已读取当前美国站店铺、本机浏览器与会话范围。')];
  for (const [id, source] of [['products', 'products'], ['reports', 'collection'], ['import', 'import']] as const) {
    const readiness = today.readiness.find(item => item.id === source);
    rows.push(stage(id, !readiness ? 'unknown' : readiness.state === 'ready' ? 'recorded' : readiness.state === 'blocked' ? 'blocked' : 'pending',
      readiness?.detail ?? '尚未读取此阶段事实。', readiness?.state !== 'ready' ? readiness?.detail : undefined));
  }
  rows.push(mission ? stage('mission', mission.status === 'active' ? 'in_progress' : ['paused', 'blocked'].includes(mission.status) ? 'blocked' : 'recorded',
    `最近任务：${mission.title}。`, mission.status === 'paused' ? '任务已暂停，请复核原因后恢复。' : mission.status === 'blocked' ? '任务当前已阻断，请核对系统原因后恢复。' : undefined)
    : stage('mission', domain ? 'pending' : 'unknown', '当前没有已读取的运营任务。', '先确认产品、数据批次和策略，再建立运营任务。'));
  const run = analysis?.analysisRun;
  rows.push(stage('analysis', run?.status === 'running' ? 'in_progress' : run?.status === 'retryable' || receipt?.status === 'failed' ? 'blocked'
    : analysis?.actionBatches.length ? 'recorded' : 'unknown',
  receipt?.signal ?? receipt?.title ?? (analysis?.actionBatches.length ? `已读取 ${analysis.proposals.length} 条持久化建议。` : '尚无本次任务的分析结果。'),
  run?.status === 'retryable' || receipt?.status === 'failed' ? '分析尚未完成，请检查数据、AI 与策略配置后重试。' : undefined));
  rows.push(decision ? stage('decision', decision.status === 'blocked' ? 'blocked' : decision.status === 'needs_approval' ? 'pending' : 'recorded',
    `最近建议：${decision.title}。${({ proposed: '待复核', needs_approval: '等待人工审批', approved: '人工审批已记录', rejected: '已拒绝', blocked: '当前条件不满足', superseded: '已由新建议替代', executed: '已记录执行', verified: '已完成结果核验' } as const)[decision.status]}。`,
    decision.status === 'blocked' ? '当前建议已阻断，请进入决策中心检查证据与权限。' : undefined)
    : stage('decision', 'pending', '尚未形成当前任务的决策记录。', '先完成分析，再复核整批建议。'));
  rows.push(grant ? stage('grant', grant.usage?.status === 'available' ? 'recorded' : 'blocked',
    `最近授权已签发；${grant.usage?.status === 'available' ? '仍需执行前重新核对全部条件' : '当前不可继续提交'}。`,
    grant.usage?.status !== 'available' ? '授权已失效、耗用或不适用于当前条件，请核对授权历史。' : undefined)
    : stage('grant', 'pending', '当前任务尚无已签发的执行授权。', '完成当前整批决策与策略校验后才能签发。'));
  rows.push(execution ? stage('execution', execution.batch.status === 'unknown' ? 'unknown' : ['blocked', 'cancelled'].includes(execution.batch.status) ? 'blocked'
    : execution.batch.status === 'succeeded' ? 'recorded' : 'in_progress',
    execution.batch.status === 'unknown' ? '已记录结果不确定的执行；不会自动重试。' : execution.batch.status === 'succeeded' ? '实际执行和后续结果已记录。'
      : execution.batch.status === 'blocked' ? '已读取实际执行阻断记录。' : execution.batch.status === 'cancelled' ? '已读取实际执行取消记录。' : '已读取实际执行队列与进度。',
    execution.batch.status === 'unknown' ? '存在未知写入结果，只能进入只读对账。'
      : execution.batch.status === 'blocked' ? '执行已阻断，请查看任务阻断原因并核对已提交意图，避免重复提交。'
        : execution.batch.status === 'cancelled' ? '执行已取消，请核对已提交与未提交任务；未知结果应先只读对账。' : undefined)
    : stage('execution', 'pending', '当前任务没有执行批次。', '先取得当前授权并核对广告对象与竞价。'));
  const verified = execution?.batch.status === 'succeeded' && execution.jobs.length > 0
    && execution.jobs.every(job => job.status === 'succeeded' && job.storeId === context.storeId && job.batchId === execution.batch.id
      && ['before', 'after', 'reload'].every(slot => job.evidence.filter(proof => proof.slot === slot
        && proof.storeId === context.storeId && proof.batchId === execution.batch.id && proof.jobId === job.id
        && proof.canonicalKeywordId === job.canonicalKeywordId && proof.objectRevision === job.identity.objectRevision
        && proof.observedBidCents === (slot === 'before' ? job.expectedBidCents : job.targetBidCents)).length === 1)
      && job.evidence.length === 3 && new Set(job.evidence.map(proof => proof.id)).size === 3);
  rows.push(stage('readback', verified ? 'verified' : execution?.batch.status === 'unknown' ? 'unknown' : 'pending',
    verified ? '当前批次的全部任务已完成核验，并保留执行前、执行后与刷新后三段证据。' : execution ? '已读取回读记录；尚未满足全部任务的完整核验条件。' : '当前任务尚无提交与回读记录。',
    verified ? undefined : execution?.batch.status === 'unknown' ? '不确定结果不能由截图齐全或值相等升级为成功。' : '完成真实提交与独立刷新回读后再检查。'));
  rows.push(experiment ? stage('experiment', experiment.status === 'running' ? 'in_progress' : experiment.status === 'paused' ? 'blocked' : 'recorded',
    experiment.conclusion ?? (experiment.status === 'running' ? '观察窗进行中，尚无系统结论。' : experiment.status === 'draft' ? '实验定义已保存，尚未启动观察窗。' : '实验生命周期记录已读取。'),
    experiment.status === 'paused' ? '实验已暂停，请复核守护栏与系统原因。' : undefined)
    : stage('experiment', 'pending', '当前任务尚无经营实验。', '先完成真实回读和基线，再建立观察窗。'));
  rows.push(memory ? stage('memory', 'recorded', memory.observedEffect ?? memory.signal ?? memory.title,
    memory.status.toLowerCase() === 'unknown' ? '该记录存在不确定结果，不能作为已验证经营效果。' : undefined)
    : stage('memory', 'pending', '当前任务尚无因果事件。', '完成业务步骤后读取系统事实；可另行记录运营观察。'));
  // 首页不触发昂贵的交付重验，也不从旧文件或历史 READY 推断本次验收结论。
  rows.push(stage('delivery', 'unknown', '首页尚未读取本次绑定当前源码与包体的交付核验结论。', '请进入交付验收显式刷新当前证据；历史状态不能替代本次核验。'));
  return rows;
}

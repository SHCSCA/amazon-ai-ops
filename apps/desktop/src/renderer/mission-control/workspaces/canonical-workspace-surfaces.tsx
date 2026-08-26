import React from 'react';
import {
  ArrowRight,
  Browser,
  CheckCircle,
  Circle,
  Clock,
  Database,
  Flask,
  GitBranch,
  ListChecks,
  LockKey,
  MonitorPlay,
  Path,
  ShieldCheck,
  Warning,
} from '@phosphor-icons/react';
import type {
  MissionControlCapabilityProjection,
  MissionControlViewId,
  StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import { WorkspaceState } from '../../components/workspace';
import {
  canonicalWorkspaceFixtureForStore,
  type CanonicalWorkspaceFixture,
} from './canonical-workspace-fixtures';
import { EXECUTION_CAPABILITY_IDS, ExecutionWorkspace } from './execution-workspace';

const CANONICAL_EXECUTION_PREVIEW_CAPABILITIES = Object.values(EXECUTION_CAPABILITY_IDS).map((capabilityId) => ({
  capabilityId,
  workspace: 'execution',
  view: 'execution/live',
  action: capabilityId === EXECUTION_CAPABILITY_IDS.view ? 'view' : 'update',
  state: 'PROTOTYPE_ONLY',
  detail: '显式开发预览能力',
})) as readonly MissionControlCapabilityProjection[];

export type CanonicalWorkspaceSurfaceKind =
  | 'today'
  | 'missions'
  | 'decisions'
  | 'experiments'
  | 'execution'
  | 'memory'
  | 'policy';

export interface CanonicalWorkspaceSurfaceProps {
  blockedReason: string;
  kind: CanonicalWorkspaceSurfaceKind;
  onInspectBoundary?: () => void;
  previewEnabled: boolean;
  storeContext: StoreContextEnvelope | null;
  view: MissionControlViewId;
}

interface ResolvedCanonicalWorkspaceSurfaceProps extends CanonicalWorkspaceSurfaceProps {
  fixture: CanonicalWorkspaceFixture;
}

function PreviewNotice({
  fixture,
  onInspectBoundary,
}: {
  fixture: CanonicalWorkspaceFixture;
  onInspectBoundary?: () => void;
}) {
  return (
    <div className="canonical-preview-notice" data-preview-store-fixture={fixture.fixtureId} role="note">
      <span>仅开发预览示例</span>
      <strong>{fixture.storeLabel}</strong>
      <small>Amazon US · USD · {fixture.primaryAsin} · {fixture.batchId} · 不写入数据库、不代表真实执行或回读</small>
      {onInspectBoundary && (
        <button className="canonical-preview-boundary-action" onClick={onInspectBoundary} type="button">
          查看接入边界
        </button>
      )}
    </div>
  );
}

function DisabledAction({ children, reason }: { children: React.ReactNode; reason: string }) {
  return (
    <button
      aria-describedby="canonical-workspace-action-boundary"
      className="canonical-disabled-action"
      disabled
      title={reason}
      type="button"
    >
      {children}
    </button>
  );
}

function EmptyAuthority({ description, reason, title }: { description: string; reason: string; title: string }) {
  return (
    <WorkspaceState
      description={description}
      details={reason}
      kind="blocked"
      title={title}
    />
  );
}

function TodaySurface(props: ResolvedCanonicalWorkspaceSurfaceProps) {
  if (!props.previewEnabled) {
    return (
      <div className="canonical-today-grid" data-canonical-surface="today">
        <section className="canonical-control-board">
          <header><span>今日运营总览</span><strong>等待当前店铺的今日运营任务</strong></header>
          <div className="canonical-mission-chain" role="list" aria-label="今日运营任务主链路">
            {['运营任务', '关键决策', '经营实验', '可见执行'].map((label, index) => (
              <div className="canonical-chain-step" key={label} role="listitem">
                <span>{index + 1}</span><strong>{label}</strong><small>等待确认</small>
              </div>
            ))}
          </div>
        </section>
        <aside className="canonical-health-rail">
          <h3>执行前检查</h3>
          <EmptyAuthority description="数据、策略、会话与实验状态尚未形成权威投影。" reason={props.blockedReason} title="今日控制面已失败关闭" />
        </aside>
      </div>
    );
  }

  const { fixture } = props;
  const chain = [
    { label: '运营任务', detail: '目标已锁定', icon: ListChecks, tone: 'ready' },
    { label: '关键决策', detail: `${fixture.mission.cruxCount} 项待判断`, icon: GitBranch, tone: 'attention' },
    { label: '经营实验', detail: `观察第 ${fixture.mission.observationDay}/${fixture.mission.observationTotal} 天`, icon: Flask, tone: 'ready' },
    { label: '可见执行', detail: '等待真实授权', icon: MonitorPlay, tone: 'blocked' },
  ] as const;
  return (
    <div data-canonical-surface="today">
      <PreviewNotice fixture={fixture} onInspectBoundary={props.onInspectBoundary} />
      <div className="canonical-today-grid">
        <section className="canonical-control-board">
          <header className="canonical-board-heading">
            <div><span>当前运营任务</span><strong>{fixture.mission.title}</strong></div>
            <b>推进度 {fixture.mission.progress}%</b>
          </header>
          <div className="canonical-progress" aria-label={`示例运营任务推进度 ${fixture.mission.progress}%`}><span style={{ width: `${fixture.mission.progress}%` }} /></div>
          <div className="canonical-mission-chain" role="list" aria-label="今日运营任务主链路">
            {chain.map(({ label, detail, icon: Icon, tone }, index) => (
              <div className="canonical-chain-step" data-tone={tone} key={label} role="listitem">
                <span><Icon aria-hidden="true" size={17} weight="duotone" /></span>
                <strong>{label}</strong><small>{detail}</small>
                {index < chain.length - 1 && <ArrowRight aria-hidden="true" size={14} />}
              </div>
            ))}
          </div>
        </section>
        <aside className="canonical-health-rail">
          <h3>执行前检查</h3>
          <ul>
            <li><span><Database size={16} />数据新鲜度</span><b>{fixture.health.freshnessMinutes} 分钟</b></li>
            <li><span><ShieldCheck size={16} />策略边界</span><b>人工审批</b></li>
            <li><span><Browser size={16} />可见浏览器</span><b data-tone="blocked">待授权</b></li>
            <li><span><Flask size={16} />因果隔离</span><b>{fixture.health.experimentState}</b></li>
          </ul>
          <DisabledAction reason={props.blockedReason}>记录运营事件</DisabledAction>
        </aside>
      </div>
      <section className="canonical-next-actions">
        <h3>下一推进动作</h3>
        <ol>
          <li><Warning size={18} weight="fill" /><span><strong>处理 {fixture.mission.cruxCount} 项关键决策</strong><small>确认 {fixture.primaryAsin} 的建议依据与人工审批边界。</small></span><DisabledAction reason={props.blockedReason}>去处理</DisabledAction></li>
          <li><MonitorPlay size={18} /><span><strong>准备真实可见执行</strong><small>必须保留 before、after 与 reload 回读。</small></span><DisabledAction reason={props.blockedReason}>打开执行</DisabledAction></li>
        </ol>
      </section>
    </div>
  );
}

function MissionSurface(props: ResolvedCanonicalWorkspaceSurfaceProps) {
  if (!props.previewEnabled) {
    return (
      <div className="canonical-mission-layout" data-canonical-surface="missions">
        <section className="canonical-flight-plan">
          <h3>运营任务检查点</h3>
          <EmptyAuthority description="等待店铺级运营任务查询、检查点和版本合同。" reason={props.blockedReason} title="暂无可验证运营任务" />
        </section>
        <aside className="canonical-agent-state"><h3>智能体状态</h3><p>运营任务来源尚未确认时不创建临时任务。</p></aside>
      </div>
    );
  }

  const { fixture } = props;
  const checkpoints = [
    ['01', '建立事实基线', `已确认 ${fixture.mission.reportCount} 类报表`],
    ['02', '识别关键决策', `${fixture.mission.cruxCount} 项等待判断`],
    ['03', '运行经营实验', `观察第 ${fixture.mission.observationDay}/${fixture.mission.observationTotal} 天`],
    ['04', '执行与回读', '等待真实授权'],
  ];
  return (
    <div data-canonical-surface="missions">
      <PreviewNotice fixture={fixture} onInspectBoundary={props.onInspectBoundary} />
      <dl className="canonical-contract-strip">
        <div><dt>经营目标</dt><dd>核心词 ACOS ≤ {fixture.mission.goalAcos}</dd></div>
        <div><dt>预算边界</dt><dd>USD {fixture.mission.budgetUsd} / 日</dd></div>
        <div><dt>观察窗口</dt><dd>{fixture.mission.observationTotal} 个业务日</dd></div>
        <div><dt>审批模式</dt><dd>人工审批</dd></div>
      </dl>
      {!props.onInspectBoundary && (
        <details>
          <summary>诊断详情</summary>
          <code>MISSION · {fixture.mission.id}</code>
        </details>
      )}
      <div className="canonical-mission-layout">
        <section className="canonical-flight-plan">
          <header><div><span>运营任务 · {fixture.primaryAsin}</span><h3>{fixture.mission.title}</h3></div><DisabledAction reason={props.blockedReason}>编辑运营任务</DisabledAction></header>
          <div className="canonical-checkpoint-list" role="list" aria-label="运营任务示例检查点">
            {checkpoints.map(([number, title, detail], index) => (
              <article data-state={index < 1 ? 'ready' : index < 3 ? 'active' : 'blocked'} key={number} role="listitem">
                <span>{index < 1 ? <CheckCircle size={18} weight="fill" /> : index < 3 ? <Clock size={18} /> : <LockKey size={18} />}</span>
                <time>{number}</time><div><strong>{title}</strong><small>{detail}</small></div>
              </article>
            ))}
          </div>
        </section>
        <aside className="canonical-agent-state">
          <h3>智能体状态</h3>
          <strong>停驻在关键决策</strong>
          <p>{fixture.mission.cruxCount} 项广告调整仍需运营者确认；不会自动进入真实写入。</p>
          <DisabledAction reason={props.blockedReason}>暂停运营任务</DisabledAction>
        </aside>
      </div>
    </div>
  );
}

function DecisionsSurface(props: ResolvedCanonicalWorkspaceSurfaceProps) {
  const activeLabel = props.view === 'decisions/approval'
    ? '待审批'
    : props.view === 'decisions/decided'
      ? '已处理'
      : '待判断';
  if (!props.previewEnabled) {
    return (
      <div className="canonical-decisions-shell" data-canonical-surface="decisions">
        <nav aria-label="决策视图"><b data-active="true">{activeLabel}</b></nav>
        <EmptyAuthority description="等待本机安全进程返回原子建议、版本校验与审批签名。" reason={props.blockedReason} title="暂无权威决策对象" />
      </div>
    );
  }

  const { fixture } = props;
  const decisions = activeLabel === '已处理'
    ? fixture.decisions.decided
    : activeLabel === '待审批'
      ? fixture.decisions.approval
      : fixture.decisions.recommendations;
  return (
    <div className="canonical-decisions-shell" data-canonical-surface="decisions">
      <PreviewNotice fixture={fixture} onInspectBoundary={props.onInspectBoundary} />
      <nav aria-label="决策视图">
        {['待判断', '待审批', '已处理'].map((label) => <b data-active={label === activeLabel || undefined} key={label}>{label}</b>)}
      </nav>
      <div className="canonical-decision-table" role="table" aria-label={`${activeLabel}示例决策`}>
        <div className="canonical-decision-row canonical-decision-head" role="row"><span>决策对象</span><span>证据 / 建议变化</span><span>风险</span><span>状态</span><span>操作</span></div>
        {decisions.map((decision) => (
          <div className="canonical-decision-row" key={decision.id} role="row">
            <span><strong>{decision.title}</strong><small>{decision.id}</small></span>
            <span>{decision.change}</span><span>{decision.risk}</span><span>{decision.status}</span>
            <span><DisabledAction reason={props.blockedReason}>查看证据</DisabledAction></span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ExperimentSurface(props: ResolvedCanonicalWorkspaceSurfaceProps) {
  if (!props.previewEnabled) {
    return (
      <div className="canonical-experiment-layout" data-canonical-surface="experiments">
        <section className="canonical-hypothesis-card"><h3>实验假设</h3><p>等待追加式实验台账与因果事件合同。</p></section>
        <EmptyAuthority description="生产 Renderer 不会把临时表单当作实验事实。" reason={props.blockedReason} title="暂无权威实验记录" />
      </div>
    );
  }
  const { fixture } = props;
  const ledger = [
    ['FACT', fixture.experiment.analysis, `${fixture.primaryAsin} · 广告事实`],
    ['ANALYSIS', fixture.experiment.analysis, 'AI 推断'],
    ['DECISION', `出价降低 ${fixture.experiment.bidReduction}，停止条件 ${fixture.experiment.stopCondition}`, '人工确认待完成'],
    ['ACTION', '等待真实可见写入', '未执行'],
    ['READBACK', '等待 Reload 证据', '未生成'],
    ['EFFECT', '7 日后评估', '未到观察窗'],
  ];
  return (
    <div data-canonical-surface="experiments">
      <PreviewNotice fixture={fixture} onInspectBoundary={props.onInspectBoundary} />
      <div className="canonical-experiment-layout">
        <section className="canonical-hypothesis-card">
          <span>EXPERIMENT · {fixture.experiment.id} · {fixture.batchId}</span><h3>{fixture.experiment.hypothesis}</h3>
          <dl><div><dt>控制变量</dt><dd>{fixture.primaryAsin} · Listing、价格、预算</dd></div><div><dt>观察窗口</dt><dd>{fixture.mission.observationTotal} 个业务日</dd></div><div><dt>停止条件</dt><dd>{fixture.experiment.stopCondition}</dd></div></dl>
          <DisabledAction reason={props.blockedReason}>编辑实验</DisabledAction>
        </section>
        <section className="canonical-ledger" aria-label="示例因果台账">
          {ledger.map(([stage, title, detail], index) => (
            <article data-state={index < 2 ? 'ready' : index === 2 ? 'attention' : 'blocked'} key={stage}>
              <span>{stage}</span><div><strong>{title}</strong><small>{detail}</small></div>
            </article>
          ))}
        </section>
      </div>
    </div>
  );
}

function ExecutionSurface(props: ResolvedCanonicalWorkspaceSurfaceProps) {
  return (
    <ExecutionWorkspace
      blockedReason={props.blockedReason}
      capabilities={props.previewEnabled ? CANONICAL_EXECUTION_PREVIEW_CAPABILITIES : []}
      onInspectBoundary={props.onInspectBoundary}
      previewEnabled={props.previewEnabled}
      storeContext={props.storeContext}
    />
  );
}

function MemorySurface(props: ResolvedCanonicalWorkspaceSurfaceProps) {
  const stages = ['FACT', 'ANALYSIS', 'DECISION', 'ACTION', 'READBACK', 'EFFECT'];
  if (!props.previewEnabled) {
    return (
      <div className="canonical-memory-timeline" data-canonical-surface="memory">
        {stages.map((stage) => <article key={stage}><span><Circle size={15} /></span><div><b>{stage}</b><strong>等待权威记录</strong><small>不会从 Renderer 临时状态生成</small></div></article>)}
      </div>
    );
  }
  const { fixture } = props;
  const records = [
    ['广告事实', fixture.experiment.analysis, `${fixture.primaryAsin} · 真实来源待接入`],
    ['量化推断', fixture.experiment.analysis, `AI 推断示例 · ${fixture.batchId}`],
    ['关键决策', `降低出价 ${fixture.experiment.bidReduction} 并观察订单`, '待人工批准'],
    ['真实动作', `${fixture.execution.searchTerm} · ${fixture.execution.campaign} 等待可见浏览器执行`, '未执行'],
    ['Reload 回读', '等待同对象重新读取', '未生成'],
    ['经营效果', '7 日窗口结束后评估', '未知'],
  ];
  return (
    <div data-canonical-surface="memory">
      <PreviewNotice fixture={fixture} onInspectBoundary={props.onInspectBoundary} />
      <div className="canonical-memory-timeline" aria-label="示例因果时间线">
        {stages.map((stage, index) => (
          <article data-state={index < 2 ? 'ready' : index === 2 ? 'attention' : 'blocked'} key={stage}>
            <span><Path size={16} /></span><div><b>{stage}</b><strong>{records[index][0]} · {records[index][1]}</strong><small>{records[index][2]}</small></div>
          </article>
        ))}
      </div>
    </div>
  );
}

function PolicySurface(props: ResolvedCanonicalWorkspaceSurfaceProps) {
  if (!props.previewEnabled) {
    return (
      <div className="canonical-policy-layout" data-canonical-surface="policy">
        <section className="canonical-policy-limits"><h3>策略硬边界</h3><EmptyAuthority description="等待版本化策略、审批签名与执行前重校验。" reason={props.blockedReason} title="暂无可启用策略版本" /></section>
        <aside className="canonical-kill-switch"><ShieldCheck size={26} /><strong>人工审批保持启用</strong><p>策略内自动失败关闭。</p></aside>
      </div>
    );
  }
  const { fixture } = props;
  const limits = [
    ['单次降价', fixture.policy.lowerBidMax, '超出转人工'],
    ['单次提价', fixture.policy.raiseBidMax, '超出转人工'],
    ['预算变化', fixture.policy.budgetChangeMax, '超出转人工'],
    ['执行币种', 'USD', '固定美国站'],
  ];
  return (
    <div data-canonical-surface="policy">
      <PreviewNotice fixture={fixture} onInspectBoundary={props.onInspectBoundary} />
      <div className="canonical-policy-layout">
        <section className="canonical-policy-limits">
          <header><div><span>POLICY · {fixture.policy.id} · v{fixture.policy.version}</span><h3>{fixture.storeLabel} · 美国站广告低风险执行边界</h3></div><DisabledAction reason={props.blockedReason}>编辑规则</DisabledAction></header>
          <div role="list">{limits.map(([label, value, detail]) => <article key={label} role="listitem"><small>{label}</small><strong>{value}</strong><span>{detail}</span></article>)}</div>
        </section>
        <aside className="canonical-kill-switch">
          <ShieldCheck size={26} weight="duotone" /><strong>当前：人工审批</strong>
          <p>AI 策略内自动在真实策略版本、会话和执行 Authority 完成前保持阻断。</p>
          <DisabledAction reason={props.blockedReason}>发布策略版本</DisabledAction>
          <DisabledAction reason={props.blockedReason}>启动熔断</DisabledAction>
        </aside>
      </div>
    </div>
  );
}

export function CanonicalWorkspaceSurface(props: CanonicalWorkspaceSurfaceProps) {
  const fixture = canonicalWorkspaceFixtureForStore(props.storeContext);
  const resolvedProps = { ...props, fixture };
  return (
    <div
      className="canonical-workspace-surface"
      data-capability-state={props.previewEnabled ? 'PROTOTYPE_ONLY' : 'BLOCKED'}
      data-mutations-disabled="true"
    >
      <p className="sr-only" id="canonical-workspace-action-boundary">{props.blockedReason}</p>
      {props.kind === 'today' && <TodaySurface {...resolvedProps} />}
      {props.kind === 'missions' && <MissionSurface {...resolvedProps} />}
      {props.kind === 'decisions' && <DecisionsSurface {...resolvedProps} />}
      {props.kind === 'experiments' && <ExperimentSurface {...resolvedProps} />}
      {props.kind === 'execution' && <ExecutionSurface {...resolvedProps} />}
      {props.kind === 'memory' && <MemorySurface {...resolvedProps} />}
      {props.kind === 'policy' && <PolicySurface {...resolvedProps} />}
    </div>
  );
}

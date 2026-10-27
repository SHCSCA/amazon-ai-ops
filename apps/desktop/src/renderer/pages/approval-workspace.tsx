import { BusinessDataConfigurationNotice } from '../components/business-data-configuration';
import { rendererRuntimeLog } from '../runtime-log';
import { WorkspaceActionButton } from '../components/workspace/action-feedback';
import { usePageOperation } from './use-page-operation';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  useBusinessDataPipeline,
  ScopeText,
} from '../components/business-data';
import { ProgressiveDetails } from '../components/progressive-details';
import {
  DecisionActionStrip,
  FormTable,
  FormTableRow,
  PageHeader,
  Panel,
  StatusPill,
} from '../components/ui';
import { useOverlayFocusScope } from '../components/workspace/overlay-focus-scope';
import { PAGE_HEADER_TITLES } from '../page-header-copy';
import {
  buildDecisionEvidenceSummary,
  formatEvidenceRefSummary,
} from '../evidence-display';
import { formatUsd } from '../formatters';
import type { RecommendationView } from '../types';
import {
  type ApprovalTab,
  type ApprovalQueueExitState,
  type ApprovalQueueExitDecision,
} from "./approval-contracts";
import {
  APPROVAL_SELECTION_STORAGE_KEY,
  APPROVAL_QUEUE_EXIT_ANIMATION_MS,
  TAB_LABELS,
} from "./approval-constants";
import {
  parseApprovalSelectionIntent,
  approvalRowsAfterDecision,
  refreshedApprovalSelection,
  runApprovalWorkflowMutation,
  buildRecommendationDecisionRequest,
  approvalDecisionFocusReturnTarget,
  approvalQueueRowClass,
} from "./approval-workflow-actions";
import {
  errorMessage,
  objectName,
  decisionLabel,
  strategyLabel,
  aiThresholdSummary,
  productStageLabel,
  optionalPercent,
  optionalMoney,
  quantSummary,
  thresholdSummary,
  compactList,
  evidenceTypeLabel,
  evidenceContextLine,
  evidenceMetricLine,
} from "./approval-presentation";
import { sourceFiles } from "./approval-identity-proof";
import {
  approvalMissing,
  approvalBlockers,
  approvalSubmitBlockers,
} from "./approval-authority-gates";
import {
  buildApprovalStampFeedback,
  approvalDecisionState,
  approvalDecisionButtonView,
  buildApprovalDecisionPayload,
} from "./approval-decision";

export function ApprovalPage() {
  const { data, scope, configurationRequired } = useBusinessDataPipeline();
  const [tab, setTab] = useState<ApprovalTab>('pending');
  const [rowsValue, setRows] = useState<RecommendationView[]>([]);
  const [selectedValue, setSelected] = useState<RecommendationView | null>(null);
  const [approverName, setApproverName] = useState('');
  const [approvalNote, setApprovalNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [decisionActionOrigin, setDecisionActionOrigin] = useState<'form' | 'strip' | null>(null);
  const [submittingDecision, setSubmittingDecision] = useState<'approved' | 'rejected' | null>(null);
  const [decisionFeedback, setDecisionFeedback] = useState<ReturnType<typeof buildApprovalStampFeedback> | null>(null);
  const [exitingDecision, setExitingDecision] = useState<ApprovalQueueExitState>(null);
  const [batchSelectionHint, setBatchSelectionHint] = useState<string | null>(null);
  const pendingSelectionIntentRef = useRef<ReturnType<typeof parseApprovalSelectionIntent>>(null);
  const exitTimerRef = useRef<number | null>(null);
  const approvalQueueFocusRef = useRef<HTMLDivElement | null>(null);
  const completedDecisionFocusTargetRef = useRef<HTMLElement | null>(null);
  const currentBatchId = scope.batchId || data?.collection.latestBatch?.id;
  const queueOperation = usePageOperation(JSON.stringify([scope, currentBatchId, tab]));
  const decisionOperation = usePageOperation(JSON.stringify([scope, currentBatchId, selectedValue?.id]));
  const [publishedQueueKey, setPublishedQueueKey] = useState<string | null>(null);
  const rows = publishedQueueKey === queueOperation.contextKey ? rowsValue : [];
  const selected = publishedQueueKey === queueOperation.contextKey ? selectedValue : null;
  useEffect(() => { setSubmittingDecision(null); setDecisionActionOrigin(null); }, [decisionOperation.contextKey]);
  useEffect(() => {
    setMessage(null); setDecisionFeedback(null); setSelected(null);
    setApproverName(''); setApprovalNote(''); setExitingDecision(null);
  }, [queueOperation.contextKey]);
  const currentRealReportSourceFiles = useMemo(
    () => (data?.collection.realReportFiles || [])
      .map((file) => file.artifactDisplayName || file.fileName || file.displayName)
      .filter(Boolean),
    [data?.collection.realReportFiles],
  );
  const selectedMissing = useMemo(
    () => approvalMissing(selected, scope, currentBatchId, currentRealReportSourceFiles),
    [currentBatchId, currentRealReportSourceFiles, scope.marketplaceCode, scope.storeName, selected],
  );
  const selectedBlockers = useMemo(() => approvalBlockers(selected), [selected]);
  const selectedSubmitBlockers = useMemo(
    () => approvalSubmitBlockers(selected, scope, currentBatchId, currentRealReportSourceFiles),
    [currentBatchId, currentRealReportSourceFiles, scope.marketplaceCode, scope.storeName, selected],
  );
  const selectedDecisionSummary = useMemo(
    () => buildDecisionEvidenceSummary(selected?.evidence),
    [selected],
  );
  const selectedApprovalDecision = useMemo(
    () => approvalDecisionState({
      selected,
      missing: selectedMissing,
      blockers: selectedBlockers,
    }),
    [selected, selectedBlockers, selectedMissing],
  );
  const approveButton = approvalDecisionButtonView({
    mode: 'approved',
    submittingDecision: decisionActionOrigin === 'form' ? submittingDecision : null,
    blocked: selectedSubmitBlockers.length > 0 || !decisionOperation.hasAuthority,
  });
  const rejectButton = approvalDecisionButtonView({
    mode: 'rejected',
    submittingDecision: decisionActionOrigin === 'form' ? submittingDecision : null,
    blocked: !decisionOperation.hasAuthority,
  });

  function decisionPayload(decision: 'approved' | 'rejected') {
    return buildApprovalDecisionPayload({
      decision,
      approverName,
      approvalNote,
      currentBatchId,
      selected,
      scope: {
        dateFrom: scope.dateFrom,
        dateTo: scope.dateTo,
        storeName: scope.storeName,
        marketplaceCode: scope.marketplaceCode,
        asin: scope.asin,
      },
    });
  }

  const filter = useMemo(() => ({
    dateFrom: scope.dateFrom,
    dateTo: scope.dateTo,
    storeName: scope.storeName,
    marketplaceCode: scope.marketplaceCode,
    asin: scope.asin,
    batchId: currentBatchId,
    status: tab,
    limit: 100,
  }), [currentBatchId, scope.asin, scope.dateFrom, scope.dateTo, scope.marketplaceCode, scope.storeName, tab]);

  useEffect(() => {
    try {
      const raw = window.sessionStorage?.getItem(APPROVAL_SELECTION_STORAGE_KEY);
      const parsed = raw ? parseApprovalSelectionIntent(JSON.parse(raw)) : null;
      if (!parsed) return;
      pendingSelectionIntentRef.current = parsed;
      setBatchSelectionHint(`来自优化建议批量提交 ${parsed.count} 项；审批中心会逐条重新校验证据和安全边界。`);
      window.sessionStorage?.removeItem(APPROVAL_SELECTION_STORAGE_KEY);
    } catch (caught) {
      rendererRuntimeLog.error('renderer.approval_workspace.failed', { error: caught });
      pendingSelectionIntentRef.current = null;
    }
  }, []);

  useEffect(() => () => {
    if (exitTimerRef.current !== null) window.clearTimeout(exitTimerRef.current);
  }, []);

  function scheduleDecisionQueueExit(recommendationId: number, decision: ApprovalQueueExitDecision, canPublish: () => boolean) {
    if (exitTimerRef.current !== null) window.clearTimeout(exitTimerRef.current);
    setExitingDecision({ id: recommendationId, decision });
    exitTimerRef.current = window.setTimeout(() => {
      if (!canPublish()) return;
      setRows((current) => approvalRowsAfterDecision(current, recommendationId));
      setExitingDecision(null);
      exitTimerRef.current = null;
      void loadRows({ clearMessage: false });
    }, APPROVAL_QUEUE_EXIT_ANIMATION_MS);
  }

  async function loadRows(options: { clearMessage?: boolean } = {}) {
    if (!queueOperation.hasAuthority) { setLoading(false); setMessage(queueOperation.blockedReason); return; }
    const ticket = queueOperation.begin();
    if (!ticket) return;
    setLoading(true);
    if (options.clearMessage !== false) setMessage(null);
    try {
      const read = (window as any).electronAPI?.getRecommendations;
      if (typeof read !== 'function') throw new Error('审批队列读取服务不可用，请重新连接当前店铺后重试。');
      const nextRows = await read(filter);
      if (!ticket.isCurrent()) return;
      setPublishedQueueKey(queueOperation.contextKey);
      const normalizedRows = Array.isArray(nextRows) ? nextRows : [];
      setRows(normalizedRows);
      const pendingIntent = pendingSelectionIntentRef.current;
      if (pendingIntent && tab === 'pending') {
        const matched = normalizedRows.find((row) => pendingIntent.ids.includes(String(row.id)));
        if (matched) {
          setSelected(matched);
          pendingSelectionIntentRef.current = null;
          window.setTimeout(showApprovalQueue, 0);
        } else {
          setSelected(null);
          setBatchSelectionHint(`来自优化建议批量提交 ${pendingIntent.count} 项，但当前审批队列没有匹配到这些建议；可能已处理或范围已变化。`);
          pendingSelectionIntentRef.current = null;
        }
      } else {
        setSelected((current) => refreshedApprovalSelection(current, normalizedRows));
      }
    } catch (caught) {
      rendererRuntimeLog.error('renderer.approval_workspace.failed', { error: caught });
      if (ticket.isCurrent()) setMessage(errorMessage(caught, '加载审批队列失败'));
    } finally {
      if (ticket.isCurrent()) setLoading(false);
      ticket.finish();
    }
  }

  async function approveSelected(origin: 'form' | 'strip' = 'form') {
    if (!decisionOperation.hasAuthority) { setMessage(decisionOperation.blockedReason); return; }
    if (!selected) return;
    if (selectedMissing.length > 0) {
      const blocked = `审批阻断：建议缺少 ${selectedMissing.join('、')}，不能推进到结果核对。`;
      setDecisionFeedback(buildApprovalStampFeedback({
        state: 'blocked',
        recommendationId: selected.id,
        targetName: objectName(selected),
      }));
      setMessage(blocked);
      return;
    }
    if (selectedBlockers.length > 0) {
      const blocked = `审批阻断：${selectedBlockers.join('、')}，不能走普通批准；需要先完成专门复核或重新生成规则确认后的建议。`;
      setDecisionFeedback(buildApprovalStampFeedback({
        state: 'blocked',
        recommendationId: selected.id,
        targetName: objectName(selected),
      }));
      setMessage(blocked);
      return;
    }
    if (!approverName.trim()) {
      const blocked = '批准前必须填写审批人。';
      setDecisionFeedback(buildApprovalStampFeedback({
        state: 'blocked',
        recommendationId: selected.id,
        targetName: objectName(selected),
      }));
      setMessage(blocked);
      return;
    }
    const ticket = decisionOperation.begin();
    if (!ticket) return;
    const canPublishQueue = queueOperation.capture();
    const currentSelected = selected;
    const targetName = objectName(currentSelected);
    setDecisionActionOrigin(origin);
    setSubmittingDecision('approved');
    setDecisionFeedback(buildApprovalStampFeedback({
      state: 'approving',
      recommendationId: currentSelected.id,
      targetName,
    }));
    try {
      const approve = (window as any).electronAPI?.approveRecommendation;
      if (typeof approve !== 'function') {
        throw new Error('批准建议接口未暴露。');
      }
      await runApprovalWorkflowMutation('approve', () => approve(buildRecommendationDecisionRequest(
        currentSelected,
        decisionPayload('approved'),
      )), undefined, ticket.isCurrent);
      if (!ticket.isCurrent()) return;
      const approvedMessage = `已批准建议 #${currentSelected.id}，审批人和备注已写入建议证据。审批范围：${scope.storeName} / ${scope.marketplaceCode} / ${currentSelected.evidence?.campaignName || '-'} / ${currentSelected.evidence?.adGroupName || '-'} / ${targetName}。`;
      setDecisionFeedback(buildApprovalStampFeedback({
        state: 'approved',
        recommendationId: currentSelected.id,
        targetName,
      }));
      setMessage(approvedMessage);
      scheduleDecisionQueueExit(currentSelected.id, 'approved', canPublishQueue);
      completedDecisionFocusTargetRef.current = approvalQueueFocusRef.current;
      setSelected(null);
      setApproverName('');
      setApprovalNote('');
    } catch (caught) {
      rendererRuntimeLog.error('renderer.approval_workspace.failed', { error: caught });
      if (!ticket.isCurrent()) return;
      const failed = errorMessage(caught, '批准建议失败');
      setDecisionFeedback(buildApprovalStampFeedback({
        state: 'blocked',
        recommendationId: currentSelected.id,
        targetName,
      }));
      setMessage(failed);
    } finally {
      if (ticket.isCurrent()) { setSubmittingDecision(null); setDecisionActionOrigin(null); }
      ticket.finish();
    }
  }

  async function rejectSelected(origin: 'form' | 'strip' = 'form') {
    if (!decisionOperation.hasAuthority) { setMessage(decisionOperation.blockedReason); return; }
    if (!selected) return;
    if (!approverName.trim()) {
      const blocked = '拒绝前必须填写处理人。';
      setDecisionFeedback(buildApprovalStampFeedback({
        state: 'blocked',
        recommendationId: selected.id,
        targetName: objectName(selected),
      }));
      setMessage(blocked);
      return;
    }
    if (!approvalNote.trim()) {
      const blocked = '拒绝前必须填写拒绝原因。';
      setDecisionFeedback(buildApprovalStampFeedback({
        state: 'blocked',
        recommendationId: selected.id,
        targetName: objectName(selected),
      }));
      setMessage(blocked);
      return;
    }
    const ticket = decisionOperation.begin();
    if (!ticket) return;
    const canPublishQueue = queueOperation.capture();
    const currentSelected = selected;
    const targetName = objectName(currentSelected);
    setDecisionActionOrigin(origin);
    setSubmittingDecision('rejected');
    setDecisionFeedback(buildApprovalStampFeedback({
      state: 'rejecting',
      recommendationId: currentSelected.id,
      targetName,
    }));
    try {
      const reject = (window as any).electronAPI?.rejectRecommendation;
      if (typeof reject !== 'function') {
        throw new Error('拒绝建议接口未暴露。');
      }
      await runApprovalWorkflowMutation('reject', () => reject(buildRecommendationDecisionRequest(
        currentSelected,
        decisionPayload('rejected'),
      )), undefined, ticket.isCurrent);
      if (!ticket.isCurrent()) return;
      const rejectedMessage = `已拒绝建议 #${currentSelected.id}，拒绝原因已写入建议证据${approvalNote ? `：${approvalNote}` : ''}`;
      setDecisionFeedback(buildApprovalStampFeedback({
        state: 'rejected',
        recommendationId: currentSelected.id,
        targetName,
      }));
      setMessage(rejectedMessage);
      scheduleDecisionQueueExit(currentSelected.id, 'rejected', canPublishQueue);
      completedDecisionFocusTargetRef.current = approvalQueueFocusRef.current;
      setSelected(null);
      setApproverName('');
      setApprovalNote('');
    } catch (caught) {
      rendererRuntimeLog.error('renderer.approval_workspace.failed', { error: caught });
      if (!ticket.isCurrent()) return;
      const failed = errorMessage(caught, '拒绝建议失败');
      setDecisionFeedback(buildApprovalStampFeedback({
        state: 'blocked',
        recommendationId: currentSelected.id,
        targetName,
      }));
      setMessage(failed);
    } finally {
      if (ticket.isCurrent()) { setSubmittingDecision(null); setDecisionActionOrigin(null); }
      ticket.finish();
    }
  }

  function showApprovalQueue() {
    const details = document.getElementById('approval-queue-details') as HTMLDetailsElement | null;
    if (details) details.open = true;
    document.getElementById('approval-queue-panel')?.scrollIntoView({ block: 'start' });
  }

  function showSelectedDecisionTarget() {
    const decisionDetails = document.getElementById('approval-decision-details');
    if (!selectedApprovalDecision.canApprove) {
      const details = decisionDetails?.querySelector('details') as HTMLDetailsElement | null;
      if (details) details.open = true;
    }
    document.getElementById(selectedApprovalDecision.canApprove ? 'approval-form' : 'approval-decision-details')?.scrollIntoView({ block: 'start' });
  }

  function closeApprovalDecisionModal() {
    if (submittingDecision) return;
    setSelected(null);
    setApproverName('');
    setApprovalNote('');
  }

  const approvalDecisionDialogFocus = useOverlayFocusScope<HTMLDivElement, HTMLElement>({
    dismissDisabled: Boolean(submittingDecision),
    onDismiss: closeApprovalDecisionModal,
    open: Boolean(selected),
    resolveFocusReturnTarget: (trigger) => {
      const target = approvalDecisionFocusReturnTarget(
        trigger,
        completedDecisionFocusTargetRef.current,
      );
      completedDecisionFocusTargetRef.current = null;
      return target;
    },
  });

  useEffect(() => {
    if (!currentBatchId) {
      setRows([]);
      setSelected(null);
      return;
    }
    loadRows();
  }, [currentBatchId, filter, queueOperation.contextKey]);

  return (
    <div>
      <PageHeader
        eyebrow="广告"
        title={PAGE_HEADER_TITLES.approval}
        description="逐条确认动作是否允许执行：批准、拒绝，或因缺证据和范围不匹配退回复核。"
      />
      {configurationRequired && <BusinessDataConfigurationNotice />}

      <div className="business-stack">
        <div id="approval-queue-panel" ref={approvalQueueFocusRef} tabIndex={-1}>
        <Panel title="审批队列" tone={rows.length ? 'warning' : 'blocked'}>
          <div className="approval-workbench-head">
            <div>
              <strong>{TAB_LABELS[tab]} {rows.length} 条</strong>
              <p>先选择一条动作，再批准或拒绝；本页只记录人工决策，不执行广告。</p>
            </div>
            <div className="approval-workbench-status">
              <StatusPill tone={currentBatchId ? 'ready' : 'warning'}>{currentBatchId || '批次待确认'}</StatusPill>
              <StatusPill tone="warning">只审批，不执行</StatusPill>
            </div>
          </div>
          {batchSelectionHint && (
            <div className="approval-batch-handoff" role="status">
              <StatusPill tone="ready">来自优化建议</StatusPill>
              <span>{batchSelectionHint}</span>
            </div>
          )}
          {decisionFeedback && (
            <div
              aria-live="polite"
              className={`approval-stamp-feedback approval-stamp-feedback-${decisionFeedback.tone}`}
              role="status"
            >
              <strong>{decisionFeedback.label}</strong>
              <span>{decisionFeedback.title}</span>
              <p>{decisionFeedback.detail}</p>
            </div>
          )}
          <div className="tab-row">
            {(Object.keys(TAB_LABELS) as ApprovalTab[]).map((item) => (
              <button
                aria-pressed={tab === item}
                className={tab === item ? 'tab-button tab-button-active' : 'tab-button'}
                key={item}
                onClick={() => {
                  setTab(item);
                  setSelected(null);
                  setDecisionFeedback(null);
                }}
                type="button"
              >
                {TAB_LABELS[item]}
              </button>
            ))}
          </div>
          <div className="table-wrap">
              <table className="business-table approval-table">
              <thead>
                <tr>
                  <th>动作</th>
                  <th>广告组合</th>
                  <th>广告活动</th>
                  <th>广告组</th>
                  <th>ASIN</th>
                  <th>对象</th>
                  <th>当前/建议</th>
                  <th>花费</th>
                  <th>风险</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr className={approvalQueueRowClass(row, exitingDecision)} key={row.id}>
                    <td>{row.actionType}</td>
                    <td>{row.evidence?.portfolioName || '-'}</td>
                    <td>{row.evidence?.campaignName || '-'}</td>
                    <td>{row.evidence?.adGroupName || '-'}</td>
                    <td>{row.evidence?.asin || '-'}</td>
                    <td>{objectName(row)}</td>
                    <td>{row.currentValue || '-'} {'→'} {row.recommendedValue || '-'}</td>
                    <td>{formatUsd(row.evidence?.cost ?? row.cost)}</td>
                    <td>
                      <div>{row.riskLevel}</div>
                      <div className="table-subtext">{approvalBlockers(row).length ? approvalBlockers(row).join(' / ') : '普通审批可处理'}</div>
                    </td>
                    <td>
                      <button
                        className="secondary-button compact-button"
                        onClick={() => {
                          completedDecisionFocusTargetRef.current = null;
                          setSelected(row);
                          setApproverName('');
                          setApprovalNote('');
                          setDecisionFeedback(null);
                        }}
                        type="button"
                      >
                        处理
                      </button>
                    </td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr>
                    <td colSpan={10}>{loading ? '加载中...' : `${TAB_LABELS[tab]}队列为空。`}</td>
                  </tr>
                )}
              </tbody>
              </table>
          </div>
        </Panel>
        </div>

        <ProgressiveDetails title="审批边界和处理要求">
        <Panel title="审批安全边界" tone="warning">
          <div className="business-split">
            <div>
              <div className="business-scope-line"><ScopeText scope={data?.scope || scope} /></div>
              <p className="muted-line">不会批量自动写入。每个动作必须绑定店铺、站点、广告活动、广告组、对象和动作，并保留审批与回读证据。</p>
            </div>
            <StatusPill tone="pending">仅审批，不执行</StatusPill>
          </div>
        </Panel>

        <Panel title="审批处理要求">
          <div className="context-summary-grid">
            <div>
              <span>本页职责</span>
              <strong>只做人工决策</strong>
              <p>批准或拒绝规则确认后的建议；AI 独立洞察和冲突建议先进入复核队列。</p>
            </div>
            <div>
              <span>批准前确认</span>
              <strong>范围和动作</strong>
              <p>核对店铺、站点、广告活动、广告组、对象、当前值和建议值。</p>
            </div>
            <div>
              <span>批准后下一步</span>
              <strong>进入结果核对</strong>
              <p>在结果核对页补录审批凭证、执行前/执行后截图、回读值和现场行证明。</p>
            </div>
            <div>
              <span>当前队列</span>
              <strong>{rows.length} 条</strong>
              <p>{TAB_LABELS[tab]}；切换标签只查看状态，不会执行动作。</p>
            </div>
          </div>
        </Panel>
        </ProgressiveDetails>

        {selected && (
          <div
            className="product-config-modal-backdrop approval-decision-modal-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeApprovalDecisionModal();
            }}
            ref={approvalDecisionDialogFocus.overlayRootRef}
            role="presentation"
          >
            <section
              aria-labelledby="approval-decision-modal-title"
              aria-modal="true"
              className="product-config-modal approval-decision-modal"
              onMouseDown={(event) => event.stopPropagation()}
              ref={approvalDecisionDialogFocus.surfaceRef}
              role="dialog"
              tabIndex={-1}
            >
              <header className="product-config-modal-header">
                <div>
                  <span>审批处理</span>
                  <h2 id="approval-decision-modal-title">人工审批决定</h2>
                </div>
                <WorkspaceActionButton disabledReason={'正在记录人工决定，请等待完成后再关闭。'}
                  className="secondary-button compact-button"
                  disabled={Boolean(submittingDecision)}
                  onClick={closeApprovalDecisionModal}
                  type="button"
                >
                  关闭
                </WorkspaceActionButton>
              </header>
              <div className="product-config-modal-body approval-decision-modal-body">
                <div className="approval-decision-panel">
            <div className="evidence-check-panel">
              <div className="business-split">
                <div>
                  <h3>{selectedApprovalDecision.statusLabel}</h3>
                  <p className={selectedApprovalDecision.canApprove ? 'muted-line' : selectedApprovalDecision.tone === 'blocked' ? 'blocked-line' : 'warning-line'}>
                    {selectedApprovalDecision.detail}
                  </p>
                </div>
                <StatusPill tone={selectedApprovalDecision.tone}>{selectedApprovalDecision.statusLabel}</StatusPill>
              </div>
              <div className="context-summary-grid compact-summary">
                <div>
                  <span>建议对象</span>
                  <strong>{objectName(selected)}</strong>
                  <p>{selected.actionType} / {selected.currentValue || '-'} {'→'} {selected.recommendedValue || '-'}</p>
                </div>
                <div>
                  <span>处理范围</span>
                  <strong>{scope.storeName || '-'} / {scope.marketplaceCode || '-'}</strong>
                  <p>这里只记录人工审批；真实广告后台操作和结果核对在后续页面完成。</p>
                </div>
                <div>
                  <span>阻断概况</span>
                  <strong>缺证据 {selectedMissing.length} / 复核项 {selectedBlockers.length}</strong>
                  <p>{selectedApprovalDecision.canApprove ? '可以批准，批准后进入结果核对。' : '不能直接批准，请查看缺证据或复核要求。'}</p>
                </div>
              </div>
              <DecisionActionStrip
                items={[
                  {
                    label: '批准，进入结果核对',
                    detail: selectedApprovalDecision.canApprove ? '写入待执行队列' : '证据或复核未通过',
                    tone: selectedApprovalDecision.canApprove ? 'ready' : 'pending',
                    disabled: !decisionOperation.hasAuthority || selectedSubmitBlockers.length > 0 || Boolean(submittingDecision),
                    disabledReason: !decisionOperation.hasAuthority ? decisionOperation.blockedReason : submittingDecision ? '正在记录人工决定，请等待本次处理完成。' : selectedApprovalDecision.detail + ' 请补齐上方证据与审批字段。',
                    busy: decisionActionOrigin === 'strip' && submittingDecision === 'approved',
                    busyLabel: '正在批准…',
                    onClick: () => { void approveSelected('strip'); },
                  },
                  {
                    label: '查看复核要求',
                    detail: `缺证据 ${selectedMissing.length} / 复核项 ${selectedBlockers.length}`,
                    tone: selectedApprovalDecision.tone === 'ready' ? 'pending' : selectedApprovalDecision.tone,
                    disabled: Boolean(submittingDecision),
                    disabledReason: '正在记录人工决定，请等待本次处理完成后查看复核要求。',
                    onClick: showSelectedDecisionTarget,
                  },
                  {
                    label: '拒绝，不进入结果核对',
                    detail: '记录拒绝结果，不进入执行',
                    tone: 'blocked',
                    disabled: !decisionOperation.hasAuthority || Boolean(submittingDecision),
                    disabledReason: !decisionOperation.hasAuthority ? decisionOperation.blockedReason : '正在记录人工决定，请等待本次处理完成。',
                    busy: decisionActionOrigin === 'strip' && submittingDecision === 'rejected',
                    busyLabel: '正在拒绝…',
                    onClick: () => { void rejectSelected('strip'); },
                  },
                ]}
              />
            </div>
            <div id="approval-decision-details">
            <ProgressiveDetails title="审批预检、AI/规则关系、阈值和引用证据" defaultOpen={false}>
            <div className="evidence-check-panel">
              <div className="business-split">
                <div>
                  <h3>AI/规则决策摘要</h3>
                  <p className="muted-line">{selectedDecisionSummary.headline}</p>
                </div>
                <StatusPill tone={selectedDecisionSummary.tone}>{selectedDecisionSummary.statusLabel}</StatusPill>
              </div>
              {selectedDecisionSummary.reasons.length > 0 && (
                <ul className="business-list">
                  {selectedDecisionSummary.reasons.slice(0, 3).map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              )}
              <div className="context-summary-grid">
                <div>
                  <span>引用证据</span>
                  <strong>{selected.evidence?.aiEvidenceRefs?.length || 0} 条</strong>
                  <p>{selectedDecisionSummary.evidenceSummary}</p>
                </div>
                <div>
                  <span>审批动作</span>
                  <strong>{selectedDecisionSummary.nextAction}</strong>
                  <p>缺证据、AI 独立洞察或规则冲突时不能走普通批准。</p>
                </div>
              </div>
              {selectedDecisionSummary.riskWarnings.length > 0 && (
                <p className="blocked-line">风险：{selectedDecisionSummary.riskWarnings.join('；')}</p>
              )}
            </div>
            <div className="detail-grid">
              <div><span>建议 ID</span><strong>{selected.id}</strong></div>
              <div><span>审批范围</span><strong>{scope.storeName} / {scope.marketplaceCode}</strong></div>
              <div><span>当前批次</span><strong>{currentBatchId || '-'}</strong></div>
              <div><span>来源批次</span><strong>{selected.evidence?.batchId || '-'}</strong></div>
              <div><span>批次校验</span><strong>{selected.evidence?.batchId && currentBatchId && selected.evidence.batchId === currentBatchId ? '来源批次匹配' : '来源批次需核对'}</strong></div>
              <div><span>指标日期</span><strong>{selected.evidence?.date || '-'}</strong></div>
              <div><span>广告组合</span><strong>{selected.evidence?.portfolioName || '-'}</strong></div>
              <div><span>广告活动</span><strong>{selected.evidence?.campaignName || '-'}</strong></div>
              <div><span>广告组</span><strong>{selected.evidence?.adGroupName || '-'}</strong></div>
              <div><span>ASIN</span><strong>{selected.evidence?.asin || '-'}</strong></div>
              <div><span>对象类型</span><strong>{selected.entityType || selected.evidence?.matchType || '-'}</strong></div>
              <div><span>对象</span><strong>{objectName(selected)}</strong></div>
              <div><span>允许动作</span><strong>{selected.actionType}</strong></div>
              <div><span>当前值/建议值</span><strong>{selected.currentValue || '-'} {'→'} {selected.recommendedValue || '-'}</strong></div>
              <div><span>来源文件</span><strong>{sourceFiles(selected)}</strong></div>
              <div><span>审批预检</span><strong>{selectedMissing.length ? `阻断：缺 ${selectedMissing.join('、')}` : '通过'}</strong></div>
              <div><span>AI/规则决策关系</span><strong>{decisionLabel(selected)}</strong></div>
              <div><span>AI 策略诊断</span><strong>{strategyLabel(selected)} / {selected.evidence?.aiLifecycleStage || '阶段待判定'}</strong></div>
              <div><span>AI 动态阈值</span><strong>{aiThresholdSummary(selected)}</strong></div>
              <div><span>产品阶段</span><strong>{productStageLabel(selected.evidence?.productStage)}</strong></div>
              <div><span>产品目标 ACOS / TACOS</span><strong>{optionalPercent(selected.evidence?.productTargetAcos)} / {optionalPercent(selected.evidence?.productTargetTacos)}</strong></div>
              <div><span>目标净利率 / 最低价</span><strong>{optionalPercent(selected.evidence?.productTargetNetMargin)} / {optionalMoney(selected.evidence?.productMinPrice)}</strong></div>
              <div><span>规则量化</span><strong>{quantSummary(selected)}</strong></div>
              <div><span>量化阈值</span><strong>{thresholdSummary(selected)}</strong></div>
              <div><span>来源行号</span><strong>{selected.evidence?.sourceRow || '-'}</strong></div>
              <div><span>普通批准</span><strong>{selectedBlockers.length ? `阻断：${selectedBlockers.join('、')}` : '允许'}</strong></div>
            </div>
            {selected.evidence?.quantReasons?.length ? (
              <p className={selected.evidence.quantReviewRequired ? 'blocked-line' : 'muted-line'}>
                规则量化依据：{selected.evidence.quantReasons.join('；')}
              </p>
            ) : null}
            {selected.evidence?.aiStrategySummary && (
              <div className="evidence-check-panel">
                <h3>AI 策略诊断</h3>
                <p className="muted-line">{selected.evidence.aiStrategySummary}</p>
                {selected.evidence.aiLifecycleStageReason && (
                  <p className={selected.evidence.aiLifecycleStageRequiresReview ? 'warning-line' : 'muted-line'}>
                    阶段判断依据：{selected.evidence.aiLifecycleStageReason}
                  </p>
                )}
                {Boolean(selected.evidence.aiLifecycleStageEvidenceRefs?.length) && (
                  <p className="muted-line">阶段引用证据：{formatEvidenceRefSummary(selected.evidence.aiLifecycleStageEvidenceRefs, selected.evidence.aiLifecycleStageEvidenceDetails)}</p>
                )}
                {selected.evidence.aiLifecycleStageRequiresReview && (
                  <p className="blocked-line">
                    阶段判断需复核：{selected.evidence.aiLifecycleStageInvalidReasons?.join('；') || 'AI 阶段判断缺少有效可回查证据。'}
                  </p>
                )}
                <p className="muted-line">AI 动态阈值：{aiThresholdSummary(selected)}</p>
                <p className="muted-line">AI 主要问题：{compactList(selected.evidence.aiMainProblems)}</p>
                <p className={selected.evidence.aiStrategyRiskWarnings?.length ? 'blocked-line' : 'muted-line'}>
                  AI 风险提示：{compactList(selected.evidence.aiStrategyRiskWarnings)}
                </p>
              </div>
            )}
            {(selected.evidence?.aiReasoningSteps?.length || selected.evidence?.aiEvidenceRefs?.length || selected.evidence?.aiInsightInvalidReasons?.length) ? (
              <div className="evidence-check-panel">
                <h3>AI 判断依据</h3>
                {selected.evidence?.aiInsightOnly && (
                  <p className="blocked-line">该建议缺少 AI 可回查证据，仅作为洞察展示，不能审批。</p>
                )}
                {Boolean(selected.evidence?.aiReasoningSteps?.length) && (
                  <ul className="business-list">
                    {selected.evidence?.aiReasoningSteps?.slice(0, 5).map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ul>
                )}
                <p className="muted-line">引用证据：{formatEvidenceRefSummary(selected.evidence?.aiEvidenceRefs, selected.evidence?.aiEvidenceDetails)}</p>
                {Boolean(selected.evidence?.aiInsightInvalidReasons?.length) && (
                  <p className="blocked-line">{selected.evidence.aiInsightInvalidReasons?.join('；')}</p>
                )}
                {Boolean(selected.evidence?.aiEvidenceDetails?.length || selected.evidence?.aiLifecycleStageEvidenceDetails?.length) && (
                  <div className="evidence-check-panel">
                    <h3>引用证据详情</h3>
                    <div className="context-summary-grid">
                      {[
                        ...(selected.evidence?.aiEvidenceDetails || []),
                        ...(selected.evidence?.aiLifecycleStageEvidenceDetails || []),
                      ].filter((item, index, all) => all.findIndex((other) => other.evidenceId === item.evidenceId) === index).slice(0, 6).map((item) => (
                        <div key={item.evidenceId}>
                          <span>{evidenceTypeLabel(item.type)}</span>
                          <strong>{item.label}</strong>
                          <p>{evidenceContextLine(item)}</p>
                          <p>{[item.campaignName || '-', item.adGroupName || '-', item.asin || '-', item.entityName || '-'].join(' / ')}</p>
                          {item.metrics && <p>{evidenceMetricLine(item)}</p>}
                          {item.event && <p>{[item.event.eventDate || '-', item.event.eventType || '-', item.event.impactExpectation || '-'].join(' / ')}</p>}
                          {item.sourceFile && <code title={item.sourceFile}>{item.sourceFile}</code>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : null}
            {(selected.evidence?.decisionReasons?.length || selected.evidence?.decisionRiskWarnings?.length) ? (
              <div className="evidence-check-panel">
                <h3>AI/规则合并依据</h3>
                <p className="muted-line">决策关系：{decisionLabel(selected)} / 来源：{selected.evidence?.decisionSource || 'rule'}</p>
                <ul className="business-list">
                  {(selected.evidence?.decisionReasons || []).map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
                {Boolean(selected.evidence?.decisionRiskWarnings?.length) && (
                  <p className="blocked-line">合并风险：{selected.evidence?.decisionRiskWarnings?.join('；')}</p>
                )}
              </div>
            ) : null}
            {selectedBlockers.length > 0 && (
              <p className="blocked-line">这条建议不能走普通批准：{selectedBlockers.join('、')}。请在复核队列处理，或重新生成规则确认后的建议。</p>
            )}
            {selectedMissing.length > 0 && (
              <p className="blocked-line">审批证据不完整：缺 {selectedMissing.join('、')}。补齐当前批次真实报表来源后才能批准。</p>
            )}
            </ProgressiveDetails>
            </div>
            <fieldset id="approval-form" disabled={Boolean(submittingDecision) || !decisionOperation.hasAuthority} aria-describedby="approval-fields-lock-reason">
              <FormTable>
                <FormTableRow label="审批/处理人" required>
                <input
                  data-overlay-initial-focus
                  onChange={(event) => setApproverName(event.target.value)}
                  placeholder="负责人姓名"
                  value={approverName}
                />
                </FormTableRow>
                <FormTableRow label="审批时间">
                <input readOnly value={new Date().toISOString()} />
                </FormTableRow>
                <FormTableRow label="审批备注/拒绝原因">
                <textarea value={approvalNote} onChange={(event) => setApprovalNote(event.target.value)} placeholder="记录审批范围、外部审批凭证或拒绝原因" />
                </FormTableRow>
              </FormTable>
            </fieldset>
            {(submittingDecision || !decisionOperation.hasAuthority) && <p id="approval-fields-lock-reason" role="status">{!decisionOperation.hasAuthority ? decisionOperation.blockedReason : '正在记录人工决定，请等待处理完成后修改审批字段。'}</p>}
            <p className="muted-line">审批人、备注、范围和数据批次会写入建议证据；真实广告后台操作和审批凭证路径仍必须在“结果核对”页逐条补齐。</p>
            <div className="action-row">
              <WorkspaceActionButton disabledReason={!decisionOperation.hasAuthority ? decisionOperation.blockedReason : submittingDecision ? '正在记录人工决定，请等待本次处理完成。' : selectedApprovalDecision.detail + ' 请按上方阻断提示补齐证据并填写审批人。'}
                aria-busy={approveButton.ariaBusy}
                className={approveButton.className}
                disabled={approveButton.disabled || Boolean(submittingDecision)}
                onClick={() => { void approveSelected('form'); }}
                type="button"
              >
                {approveButton.ariaBusy && <span className="button-spinner" aria-hidden="true" />}
                {approveButton.label}
              </WorkspaceActionButton>
              <WorkspaceActionButton disabledReason={!decisionOperation.hasAuthority ? decisionOperation.blockedReason : submittingDecision ? '正在记录人工决定，请等待本次处理完成。' : '请填写处理人与具体拒绝原因后重试。'}
                aria-busy={rejectButton.ariaBusy}
                className={rejectButton.className}
                disabled={rejectButton.disabled || !decisionOperation.hasAuthority || Boolean(submittingDecision)}
                onClick={() => { void rejectSelected('form'); }}
                type="button"
              >
                {rejectButton.ariaBusy && <span className="button-spinner" aria-hidden="true" />}
                {rejectButton.label}
              </WorkspaceActionButton>
            </div>
                </div>
              </div>
            </section>
          </div>
        )}

        {message && <p className={message.includes('失败') || message.includes('必须') ? 'blocked-line' : 'muted-line'}>{message}</p>}
      </div>
    </div>
  );
}

import { isTerminalMissionGrantEventType } from '@amazon-ai-ops/shared-types';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { rendererRuntimeLog } from '../../runtime-log';
import { WorkspaceActionButton } from '../../components/workspace/action-feedback';
import { useCanonicalWorkspaceOperation } from './use-canonical-workspace-operation';
import {
  ArrowRight,
  Check,
  CheckCircle,
  ClockCounterClockwise,
  FileText,
  PencilSimple,
  Plus,
  Prohibit,
  ShieldCheck,
  ThumbsDown,
  X,
} from '@phosphor-icons/react';
import {
  canonicalizeAmazonAsin,
  missionControlContextKey,
  type AnalysisEvidencePackageRecord,
  type AnalysisProposalSnapshotRecord,
  type AuthorizeAnalysisProposalBatchRequest,
  type BindRecommendationWritableTargetRequest,
  type BindRecommendationWritableTargetResult,
  type CreateDecisionInput,
  type DecisionHistoryRecord,
  type DecisionRecord,
  type DecisionStatus,
  type MissionControlCapabilityProjection,
  type MissionGrantEventRecord,
  type MissionGrantRecord,
  type MissionAnalysisProjection,
  type RunMissionAnalysisRequest,
  type ReviseDecisionInput,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import { PageFrame, ReasonRequiredDialog, SummaryStrip, TaskBanner, WorkbenchPanel, WorkspaceState } from '../../components/workspace';
import {
  assertDecisionBelongsToContext,
  assertMissionAuthorityContext,
  readDecisionDomainWindowApi,
  type DecisionDomainRendererApi,
  type HumanDecisionResolutionInput,
} from './mission-domain-window-api';
import {
  assertAnalysisProjectionBelongsToContext,
  readAnalysisAuthorityWindowApi,
  type AnalysisAuthorityRendererApi,
} from './analysis-authority-window-api';
import './decisions-workspace.css';
import { type DecisionsWorkspaceProps, type DecisionDraft } from './decision-workspace-contracts';
import { VIEW_COPY, decisionCapabilityReady, PAGE_SIZE, preferredDecisionId, authorizationMissionIds, analysisActionBatchOptions, message, responseMatchesDecisionDetail, OPERATOR, STATUS_LABELS, preferredDecisionIdAfterTargetVerification, targetVerificationOperatorError, buildAnalysisBatchAuthorizationRequest, decisionActionVisibility, decisionOperatorCopy, decisionRevisionDisplayLabel, decisionListScopeLabel, formatDecisionMoney, DecisionEvidenceFacts, decisionHistoryEventLabel, grantTerminalDisplayLabel } from './decision-workspace-model';
import { readRecommendationTargetBindingWindowApi, proposalHasVerifiedAdsAuthority, proposalIsSafeTargetVerificationCandidate, findSafeTargetVerificationProposal, buildProposalTargetVerificationPlan, AnalysisProposalAuthorityStatus } from './decision-workspace-authority';
import { buildReviseDecisionInput, buildCreateDecisionInput, decisionDraft, DecisionDialog } from './decision-workspace-editor';
import { AnalysisProposalBusinessTable } from './decision-workspace-analysis';

export function DecisionsWorkspace({ apiOverride, analysisApiOverride, blockedReason, capabilities, onInspectBoundary, previewMode, storeContext, view }: DecisionsWorkspaceProps) {
  const copy = VIEW_COPY[view];
  const [decisionRows, setDecisions] = useState<DecisionRecord[]>([]);
  const [publishedKey, setPublishedKey] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [history, setHistory] = useState<DecisionHistoryRecord[]>([]);
  const [grants, setGrants] = useState<MissionGrantRecord[]>([]);
  const [grantEvents, setGrantEvents] = useState<MissionGrantEventRecord[]>([]);
  const [analysis, setAnalysis] = useState<MissionAnalysisProjection | null>(null);
  const [authorizationAnalysis, setAuthorizationAnalysis] = useState<MissionAnalysisProjection | null>(null);
  const [authorizationMissionId, setAuthorizationMissionId] = useState('');
  const [authorizationBatchId, setAuthorizationBatchId] = useState('');
  const [authorizationAnalysisLoading, setAuthorizationAnalysisLoading] = useState(false);
  const [authorizationAnalysisError, setAuthorizationAnalysisError] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ready' | 'blocked' | 'error'>('idle');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [editor, setEditor] = useState<{ record: DecisionRecord | null; draft: DecisionDraft } | null>(null);
  const [resolution, setResolution] = useState<HumanDecisionResolutionInput['status'] | null>(null);
  const [grantToRevoke, setGrantToRevoke] = useState<MissionGrantRecord | null>(null);
  const sequence = useRef(0);
  const detailSequence = useRef(0);
  const analysisSequence = useRef(0);
  const authorizationAnalysisSequence = useRef(0);
  const mutationSequence = useRef(0);
  const authority = useCanonicalWorkspaceOperation(storeContext, capabilities, view);
  const authorityKey = authority.key;
  const operation = authority.operation;
  const renderedAuthority = useRef(`${authorityKey}|${view}`);
  if (renderedAuthority.current !== `${authorityKey}|${view}`) {
    renderedAuthority.current = `${authorityKey}|${view}`;
    mutationSequence.current++; sequence.current++; detailSequence.current++;
    analysisSequence.current++; authorizationAnalysisSequence.current++;
  }
  const authorityRef = useRef(authorityKey); authorityRef.current = authorityKey;
  const api = useMemo(() => apiOverride ?? readDecisionDomainWindowApi(), [apiOverride]);
  const analysisApi = analysisApiOverride ?? readAnalysisAuthorityWindowApi();
  const targetBindingApi = previewMode || typeof window === 'undefined'
    ? null
    : readRecommendationTargetBindingWindowApi((window as unknown as { electronAPI?: unknown }).electronAPI);
  const expectedState = previewMode ? 'PROTOTYPE_ONLY' : 'PRODUCTION_NATIVE';
  const viewId = view === 'decisions/recommendations' ? 'decisions.recommendations.view' : view === 'decisions/approval' ? 'decisions.approval.view' : 'decisions.decided.view';
  const viewReady = authority.ready && decisionCapabilityReady(capabilities, viewId, view, previewMode);
  const can = (id: string) => Boolean(api && storeContext && viewReady && decisionCapabilityReady(capabilities, id, view, previewMode));
  const decisions = publishedKey === authority.projectionKey ? decisionRows : [];
  const filtered = useMemo(() => {
    const allowed = view === 'decisions/recommendations'
      ? new Set<DecisionStatus>(['proposed', 'blocked'])
      : view === 'decisions/approval'
        ? new Set<DecisionStatus>(['needs_approval'])
        : new Set<DecisionStatus>(['approved', 'rejected', 'blocked', 'superseded', 'executed', 'verified']);
    const normalized = query.trim().toLowerCase();
    return decisions.filter((item) => allowed.has(item.status) && (!normalized || `${item.id} ${decisionOperatorCopy(item.title, '未命名经营决策')} ${item.recommendation} ${item.productId ?? ''}`.toLowerCase().includes(normalized)));
  }, [decisions, query, view]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const rows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const selected = filtered.find((item) => item.id === selectedId)
    ?? filtered.find((item) => item.id === preferredDecisionId(view, filtered))
    ?? null;
  const selectedRef = useRef(selected?.id ?? '');
  selectedRef.current = selected?.id ?? '';
  const selectedMissionRef = useRef(selected?.missionId ?? '');
  selectedMissionRef.current = selected?.missionId ?? '';
  const authorizationMissionRef = useRef(authorizationMissionId);
  authorizationMissionRef.current = authorizationMissionId;
  const authorizationMissions = useMemo(() => authorizationMissionIds(decisions.filter((item) => (
    storeContext && String(item.storeId) === String(storeContext.storeId)
  ))), [decisions, storeContext?.storeId]);
  const authorizationBatches = useMemo(
    () => analysisActionBatchOptions(authorizationAnalysis),
    [authorizationAnalysis],
  );
  const busy = operation.busy;
  const terminalGrantEvent = (grant: MissionGrantRecord) => grantEvents.find((event) => (
    event.grantId === grant.id && isTerminalMissionGrantEventType(event.eventType)
  )) ?? (Date.parse(grant.expiresAt) <= Date.now() ? {
    id: `derived-expired:${grant.id}`, storeId: grant.storeId, grantId: grant.id,
    eventType: 'expired' as const, actorId: 'clock', createdAt: grant.expiresAt,
  } : undefined);

  const load = async (context: StoreContextEnvelope, key: string) => {
    const isCurrent = operation.capture();
    const current = ++sequence.current;
    if (!viewReady || !api) { setPhase('blocked'); setDecisions([]); setError(!viewReady ? `${copy.title}未获得生产能力，当前已失败关闭。` : '生产经营决策服务未接入；界面不会回退到示例数据。'); return; }
    setPhase('loading'); setError(''); setFeedback('');
    try {
      assertMissionAuthorityContext(context);
      const result = await api.listDecisions(context);
      if (!isCurrent() || authorityRef.current !== key || sequence.current !== current) return;
      result.forEach((item) => assertDecisionBelongsToContext(item, context));
      setPublishedKey(authority.projectionKey); setDecisions(result); setSelectedId((id) => result.some((item) => item.id === id) ? id : ''); setPhase('ready');
    } catch (loadError) { rendererRuntimeLog.error('decisions.operation_failed', { error: loadError });  if (isCurrent() && authorityRef.current === key && sequence.current === current) { setPhase('error'); setDecisions([]); setError(message(loadError)); } }
  };

  const refresh = async () => {
    if (!storeContext) return;
    const ticket = operation.begin();
    if (!ticket) return;
    setPending('refresh');
    try { await load(storeContext, authorityKey); }
    finally { if (ticket.isCurrent()) setPending(null); ticket.finish(); }
  };

  useEffect(() => {
    detailSequence.current += 1;
    analysisSequence.current += 1;
    authorizationAnalysisSequence.current += 1;
    mutationSequence.current += 1;
    setPending(null); setQuery(''); setPage(1); setEditor(null); setResolution(null); setGrantToRevoke(null); setGrantEvents([]); setAnalysis(null);
    setAuthorizationAnalysis(null); setAuthorizationMissionId(''); setAuthorizationBatchId('');
    setAuthorizationAnalysisLoading(false); setAuthorizationAnalysisError('');
    if (storeContext) void load(storeContext, authorityKey); else { setPhase('blocked'); setError('等待本机安全进程确认当前店铺范围。'); }
  }, [authorityKey, apiOverride, viewReady, view]);

  useEffect(() => { setSelectedId((id) => filtered.some((item) => item.id === id) ? id : preferredDecisionId(view, filtered)); }, [view, filtered]);

  useEffect(() => {
    if (view !== 'decisions/decided') {
      setAuthorizationMissionId('');
      return;
    }
    setAuthorizationMissionId((current) => (
      authorizationMissions.includes(current) ? current : authorizationMissions[0] ?? ''
    ));
  }, [authorizationMissions, view]);

  useEffect(() => {
    if (authorizationBatches.some((batch) => batch.id === authorizationBatchId)) return;
    setAuthorizationBatchId(authorizationBatches[0]?.id ?? '');
  }, [authorizationBatchId, authorizationBatches]);

  useEffect(() => {
    if (!selected || !storeContext || !api || phase !== 'ready') {
      detailSequence.current += 1;
      setHistory([]); setGrants([]); setGrantEvents([]); return;
    }
    const isCurrent = operation.capture();
    const capturedKey = authorityKey; const capturedId = selected.id;
    const capturedSequence = ++detailSequence.current;
    void Promise.all([
      api.getDecisionHistory(storeContext, selected.id),
      api.listHumanGrants(storeContext, selected.missionId),
      api.listHumanGrantEvents(storeContext, selected.missionId),
    ]).then(([historyRows, grantRows, eventRows]) => {
      if (!isCurrent() || !responseMatchesDecisionDetail(authorityRef.current, capturedKey, selectedRef.current, capturedId, detailSequence.current, capturedSequence)) return;
      if (grantRows.some((grant) => String(grant.storeId) !== String(storeContext.storeId) || grant.missionId !== selected.missionId)
        || eventRows.some((event) => String(event.storeId) !== String(storeContext.storeId))) {
        throw new Error('本机安全进程返回了不属于当前运营任务的授权记录。');
      }
      setHistory(historyRows);
      setGrants(grantRows);
      setGrantEvents(eventRows);
    }).catch((loadError) => {
      rendererRuntimeLog.error('decisions.load_failed', { error: loadError });
      if (isCurrent() && responseMatchesDecisionDetail(authorityRef.current, capturedKey, selectedRef.current, capturedId, detailSequence.current, capturedSequence)) setError(message(loadError));
    });
  }, [selected?.id, authorityKey, api, phase]);

  useEffect(() => {
    if (!selected || !storeContext || !analysisApi || phase !== 'ready') {
      analysisSequence.current += 1;
      setAnalysis(null);
      return;
    }
    const isCurrent = operation.capture();
    const capturedKey = authorityKey;
    const capturedMissionId = selected.missionId;
    const current = ++analysisSequence.current;
    void analysisApi.getMissionProjection(storeContext, selected.missionId).then((projection) => {
      if (!isCurrent() || authorityRef.current !== capturedKey || selectedMissionRef.current !== capturedMissionId || analysisSequence.current !== current) return;
      assertAnalysisProjectionBelongsToContext(storeContext, capturedMissionId, projection);
      setAnalysis(projection);
    }).catch((loadError) => {
      rendererRuntimeLog.error('decisions.load_failed', { error: loadError });
      if (isCurrent() && authorityRef.current === capturedKey && selectedMissionRef.current === capturedMissionId && analysisSequence.current === current) {
        setAnalysis(null);
        setError(message(loadError));
      }
    });
  }, [analysisApi, authorityKey, phase, selected?.missionId, storeContext]);

  useEffect(() => {
    if (view !== 'decisions/decided' || !authorizationMissionId || !authorizationMissions.includes(authorizationMissionId)
      || !storeContext || !analysisApi || phase !== 'ready') {
      authorizationAnalysisSequence.current += 1;
      setAuthorizationAnalysis(null);
      setAuthorizationBatchId('');
      setAuthorizationAnalysisLoading(false);
      setAuthorizationAnalysisError('');
      return;
    }
    const isCurrent = operation.capture();
    const capturedKey = authorityKey;
    const capturedMissionId = authorizationMissionId;
    const current = ++authorizationAnalysisSequence.current;
    setAuthorizationAnalysis(null);
    setAuthorizationBatchId('');
    setAuthorizationAnalysisLoading(true);
    setAuthorizationAnalysisError('');
    void analysisApi.getMissionProjection(storeContext, capturedMissionId).then((projection) => {
      if (!isCurrent() || authorityRef.current !== capturedKey || authorizationMissionRef.current !== capturedMissionId
        || authorizationAnalysisSequence.current !== current) return;
      assertAnalysisProjectionBelongsToContext(storeContext, capturedMissionId, projection);
      setAuthorizationAnalysis(projection);
    }).catch((loadError) => {
      rendererRuntimeLog.error('decisions.load_failed', { error: loadError });
      if (isCurrent() && authorityRef.current === capturedKey && authorizationMissionRef.current === capturedMissionId
        && authorizationAnalysisSequence.current === current) {
        setAuthorizationAnalysis(null);
        setAuthorizationAnalysisError(message(loadError));
      }
    }).finally(() => {
      if (isCurrent() && authorityRef.current === capturedKey && authorizationMissionRef.current === capturedMissionId
        && authorizationAnalysisSequence.current === current) setAuthorizationAnalysisLoading(false);
    });
  }, [analysisApi, authorityKey, authorizationMissionId, authorizationMissions, phase, storeContext, view]);

  const mutate = async <T,>(key: string, domainOperation: (domain: DecisionDomainRendererApi, context: StoreContextEnvelope) => Promise<T>): Promise<T | null> => {
    if (!api || !storeContext || busy) return null;
    const ticket = operation.begin();
    if (!ticket) return null;
    const capturedContext = storeContext;
    const capturedKey = authorityKey;
    const current = ++mutationSequence.current;
    setPending(key); setError(''); setFeedback('');
    try {
      const result = await domainOperation(api, capturedContext);
      if (!ticket.isCurrent() || authorityRef.current !== capturedKey || mutationSequence.current !== current) return null;
      return result;
    } catch (mutationError) { rendererRuntimeLog.error('decisions.operation_failed', { error: mutationError });
      if (ticket.isCurrent() && authorityRef.current === capturedKey && mutationSequence.current === current) setError(message(mutationError));
      return null;
    } finally {
      if (ticket.isCurrent() && authorityRef.current === capturedKey && mutationSequence.current === current) setPending(null);
      ticket.finish();
    }
  };

  const saveDecision = async () => {
    if (!editor || !storeContext) return;
    const isCurrent = operation.capture();
    try {
      const saved = editor.record
        ? await mutate('decision-save', (domain, context) => domain.reviseDecision(context, buildReviseDecisionInput(editor.record!, editor.draft)))
        : await mutate('decision-save', (domain, context) => domain.createDecision(context, buildCreateDecisionInput(editor.draft, `DECISION-${String(storeContext.storeId)}-${Date.now()}`)));
      if (!saved || !isCurrent()) return; assertDecisionBelongsToContext(saved, storeContext);
      setDecisions((items) => items.some((item) => item.id === saved.id) ? items.map((item) => item.id === saved.id ? saved : item) : [saved, ...items]);
      setEditor(null); setFeedback(editor.record ? '经营决策已通过版本校验修订。' : '经营决策已创建。');
    } catch (validationError) { rendererRuntimeLog.error('decisions.operation_failed', { error: validationError }); if (isCurrent()) setError(message(validationError)); }
  };

  const resolveDecision = async (reasonFromDialog: string) => {
    const isCurrent = operation.capture();
    if (view !== 'decisions/approval') { setError('人工决议只能在审批工作台执行。'); return; }
    const trimmedReason = reasonFromDialog.trim();
    if (!selected || !resolution || !trimmedReason) { setError('人工决议必须填写原因。'); return; }
    const saved = await mutate('resolve', (domain, context) => domain.resolveDecisionHuman(context, { id: selected.id, expectedRevision: selected.revision, status: resolution, reason: trimmedReason, actorId: OPERATOR }));
    if (!saved || !isCurrent()) return;
    setDecisions((items) => items.map((item) => item.id === saved.id ? saved : item)); setResolution(null); setFeedback(`经营决策已${STATUS_LABELS[saved.status]}；这不代表真实 Ads 已执行。`);
  };

  const revokeGrant = async (grant: MissionGrantRecord, reason: string) => {
    const isCurrent = operation.capture();
    if (view !== 'decisions/decided') { setError('人工授权只能在已决策工作台撤销。'); return; }
    if (!reason.trim()) { setError('撤销授权必须填写业务原因。'); return; }
    const event = await mutate('grant-revoke', (domain, context) => domain.revokeHumanGrant(context, { id: `GRANT-EVENT-${grant.id}-${Date.now()}`, grantId: grant.id, reason: reason.trim(), actorId: OPERATOR }));
    if (!event || !isCurrent()) return;
    if (selectedMissionRef.current === grant.missionId) setGrantEvents((events) => [event, ...events]);
    setFeedback('人工授权已撤销，原记录保留在审计链。');
    setGrantToRevoke(null);
  };

  const authorizationProposals = authorizationBatchId
    ? authorizationAnalysis?.proposals.filter((proposal) => proposal.actionBatchId === authorizationBatchId) ?? []
    : [];
  const canAuthorizeAnalysisBatch = Boolean(analysisApi)
    && can('decisions.grants.issue');
  const selectedProposalLink = selected
    ? analysis?.decisionLinks.find((link) => link.decisionId === selected.id)
    : undefined;
  const selectedProposal = selectedProposalLink
    ? analysis?.proposals.find((proposal) => proposal.id === selectedProposalLink.proposalId)
    : undefined;
  const selectedMissionBatchId = analysisActionBatchOptions(analysis)[0]?.id;
  const selectedMissionProposals = selectedMissionBatchId
    ? analysis?.proposals.filter((proposal) => proposal.actionBatchId === selectedMissionBatchId) ?? []
    : [];
  const selectProposalDecision = (proposal: AnalysisProposalSnapshotRecord) => {
    const decisionId = analysis?.decisionLinks.find((link) => link.proposalId === proposal.id)?.decisionId;
    if (decisionId && filtered.some((decision) => decision.id === decisionId)) setSelectedId(decisionId);
  };

  const verifySelectedProposalTarget = async () => {
    if (!selectedProposal || !selected || !storeContext || !analysisApi || !api || !targetBindingApi || busy) {
      setError('当前建议无法核验 Ads 对象；请确认店铺与 Ads 已连接后重试。');
      return;
    }
    if (proposalHasVerifiedAdsAuthority(selectedProposal)) {
      setFeedback('当前建议的 Ads 对象版本已经核验，无需重复操作。');
      return;
    }
    const ticket = operation.begin();
    if (!ticket) return;
    const capturedKey = authorityKey;
    const current = ++mutationSequence.current;
    setPending('target-verify'); setError(''); setFeedback('');
    try {
      const operationScope = await targetBindingApi.getOperationScope(storeContext);
      if (!ticket.isCurrent()) return;
      let verificationEvidencePackages = analysis?.evidencePackages ?? [];
      let safetyProposal = proposalIsSafeTargetVerificationCandidate(selectedProposal)
        ? selectedProposal
        : undefined;
      if (!safetyProposal) {
        const prepared = await analysisApi.runMissionAnalysis({ context: storeContext, missionId: selected.missionId });
        if (!ticket.isCurrent()) return;
        safetyProposal = findSafeTargetVerificationProposal(prepared.proposals, selectedProposal);
        verificationEvidencePackages = [prepared.evidencePackage];
      }
      if (!safetyProposal) {
        throw new Error('重新分析后没有生成单次降幅不超过 10% 的安全建议，未核验 Ads 对象。');
      }
      const discovery = await targetBindingApi.executionAuthority.discoverRecommendationTarget({
        context: storeContext,
        recommendationId: safetyProposal.legacyRecommendationId,
      });
      if (!ticket.isCurrent()) return;
      const verificationPlan = buildProposalTargetVerificationPlan(
        storeContext,
        selected.missionId,
        safetyProposal,
        verificationEvidencePackages,
        operationScope,
        discovery.recommendationAsin,
      );
      if (!ticket.isCurrent() || authorityRef.current !== capturedKey || mutationSequence.current !== current) return;
      if (discovery.recommendationId !== safetyProposal.legacyRecommendationId
        || discovery.writableTarget.entityType !== 'keyword'
        || discovery.writableTarget.entityId !== discovery.pageIdentity.keywordId
        || discovery.pageIdentity.bidCents !== safetyProposal.currentBidCents
        || !discovery.recommendationAsin.trim()
        || !discovery.recommendationMatchType.trim()
        || !Number.isInteger(discovery.recommendationRevision)
        || discovery.recommendationRevision < 0) {
        throw new Error('当前 Ads 页面与建议中的店铺、关键词或竞价不一致，未保存核验结果。');
      }
      await targetBindingApi.bindRecommendationWritableTarget({
        recommendationId: discovery.recommendationId,
        expectedRevision: discovery.recommendationRevision,
        scope: verificationPlan.bindingScope,
        binding: {
          boundBy: OPERATOR,
          note: '已通过当前店铺可见 Ads 页面唯一核验对象和当前竞价。',
          writableTarget: discovery.writableTarget,
        },
      });
      if (!ticket.isCurrent() || authorityRef.current !== capturedKey || mutationSequence.current !== current) return;
      const rerun = await analysisApi.runMissionAnalysis(verificationPlan.analysisRequest);
      if (!ticket.isCurrent()) return;
      const verified = rerun.proposals.find((proposal) => (
        proposal.legacyRecommendationId === discovery.recommendationId
        && proposalHasVerifiedAdsAuthority(proposal)
      ));
      if (!verified) {
        throw new Error('对象核验已保存，但重新分析没有生成对应的安全建议；请刷新后检查，不要重复核验。');
      }
      const [projection, refreshedDecisions] = await Promise.all([
        analysisApi.getMissionProjection(storeContext, selected.missionId),
        api.listDecisions(storeContext),
      ]);
      if (!ticket.isCurrent() || authorityRef.current !== capturedKey || mutationSequence.current !== current) return;
      assertAnalysisProjectionBelongsToContext(storeContext, selected.missionId, projection);
      refreshedDecisions.forEach((item) => assertDecisionBelongsToContext(item, storeContext));
      setAnalysis(projection);
      setDecisions(refreshedDecisions);
      setSelectedId((id) => preferredDecisionIdAfterTargetVerification(
        id,
        verified.id,
        projection,
        refreshedDecisions,
        view,
      ));
      setFeedback(`Ads 对象已核验；新分析批次已生成，当前值 $${(verified.currentBidCents / 100).toFixed(2)}，建议值 $${(verified.proposedBidCents / 100).toFixed(2)}。尚未批准或执行。`);
    } catch (verificationError) { rendererRuntimeLog.error('decisions.operation_failed', { error: verificationError });
      if (ticket.isCurrent() && authorityRef.current === capturedKey && mutationSequence.current === current) {
        setError(targetVerificationOperatorError(verificationError));
      }
    } finally {
      if (ticket.isCurrent() && authorityRef.current === capturedKey && mutationSequence.current === current) setPending(null);
      ticket.finish();
    }
  };

  const authorizeSelectedBatch = async () => {
    if (view !== 'decisions/decided' || !canAuthorizeAnalysisBatch || !analysisApi || !api || !storeContext
      || !authorizationMissionId || !authorizationBatchId || authorizationProposals.length === 0 || pending) {
      setError('当前没有可整批授权的真实分析建议。');
      return;
    }
    const ticket = operation.begin();
    if (!ticket) return;
    const capturedKey = authorityKey;
    const current = ++mutationSequence.current;
    setPending('analysis-authorize'); setError(''); setFeedback('');
    try {
      const request = buildAnalysisBatchAuthorizationRequest(
        storeContext,
        authorizationMissionId,
        authorizationBatchId,
        authorizationAnalysis,
      );
      const result = await analysisApi.authorizeProposalBatch(request);
      if (!ticket.isCurrent() || authorityRef.current !== capturedKey || mutationSequence.current !== current) return;
      if (!result.authorized || !result.grant) {
        rendererRuntimeLog.warn('decisions.authorization_blocked', { blockers: result.blockers });
        setError('整批授权未通过当前证据核验，请刷新当前店铺后重试。');
        return;
      }
      if (selectedMissionRef.current === authorizationMissionId) {
        setGrants((items) => items.some((grant) => grant.id === result.grant!.id) ? items : [result.grant!, ...items]);
      }
      let refreshWarning = '';
      try {
        const refreshed = await api.listDecisions(storeContext);
        if (ticket.isCurrent() && authorityRef.current === capturedKey && mutationSequence.current === current) {
          refreshed.forEach((item) => assertDecisionBelongsToContext(item, storeContext));
          setDecisions(refreshed);
        }
      } catch (refreshError) { rendererRuntimeLog.error('decisions.operation_failed', { error: refreshError });
        refreshWarning = ' 经营决策列表刷新失败，请手动刷新；不要重复授权。';
      }
      if (!ticket.isCurrent() || authorityRef.current !== capturedKey || mutationSequence.current !== current) return;
      setFeedback(`${result.mode === 'policy_auto' ? '策略自动' : '人工审批'}已签发同一执行授权：${result.proposalIds.length} 条建议整批授权，尚未执行 Ads。${refreshWarning}`);
    } catch (authorizationError) { rendererRuntimeLog.error('decisions.operation_failed', { error: authorizationError });
      if (ticket.isCurrent() && authorityRef.current === capturedKey && mutationSequence.current === current) setError(message(authorizationError));
    } finally {
      if (ticket.isCurrent() && authorityRef.current === capturedKey && mutationSequence.current === current) setPending(null);
      ticket.finish();
    }
  };

  const actionVisibility = selected ? decisionActionVisibility(view, selected.status) : null;
  const visibleFeedback = decisionOperatorCopy(
    error || feedback,
    error
      ? '当前经营决策操作未完成，请刷新当前店铺后重试。'
      : '经营决策状态已更新，请刷新列表确认。',
  );
  const visibleBlockedReason = decisionOperatorCopy(
    error || blockedReason,
    '当前经营决策不可用，请确认店铺连接后刷新重试。',
  );
  const visibleAuthorizationAnalysisError = decisionOperatorCopy(
    authorizationAnalysisError,
    '分析建议读取失败，请重新选择运营任务后重试。',
  );
  return <div className="mission-control-workspace-root decision-domain-workspace" data-canonical-surface="decisions" data-capability-state={viewReady ? expectedState : 'BLOCKED'} data-preview-mode={previewMode || undefined} data-view={view}>
    <p className="sr-only">{viewReady && api ? `${copy.title}经营决策服务已接入。` : `${copy.title}已失败关闭；${!api ? '生产决策服务未接入。' : visibleBlockedReason}`}</p>
    <PageFrame className="decision-domain-page" pageId={view.replace('/', '-')} title="建议与审批" description={copy.description} task={<TaskBanner compact eyebrow={previewMode ? '开发预览 · 经营决策' : '经营决策'} title={copy.task} description={previewMode ? copy.taskDescription : `${copy.taskDescription} 建议必须绑定当前运营任务。`} primaryAction={{ actionId: 'decisions.recommendations.create', label: '新建经营决策', disabled: view !== 'decisions/recommendations' || !can('decisions.recommendations.create') || busy, disabledReason: busy ? '当前决策操作进行中，请稍候。' : view !== 'decisions/recommendations' ? '新建经营决策请到待判断工作台。' : visibleBlockedReason, onClick: () => storeContext && setEditor({ record: null, draft: decisionDraft(storeContext) }) }} secondaryActions={onInspectBoundary ? [{ actionId: 'decision-boundary', label: '查看接入边界', onClick: onInspectBoundary }] : []} status={<span className="decision-domain-authority" data-state={viewReady ? expectedState : 'BLOCKED'}>{previewMode ? '仅开发预览' : viewReady ? '生产服务已接入' : '已阻断'}</span>}>{previewMode && <p className="decision-domain-preview-note">仅开发预览 · Amazon 美国站 · USD · 批准不代表执行</p>}</TaskBanner>} summary={<SummaryStrip ariaLabel="经营决策当前范围" items={[{ id: 'store', label: '当前店铺', value: storeContext ? '已选择' : '等待选择' }, { id: 'view', label: '当前队列', value: copy.title }, { id: 'count', label: '匹配经营决策', value: `${filtered.length} 条` }, { id: 'currency', label: '站点 / 币种', value: 'US / USD' }]} />}>
      <div className="decision-domain-layout">
        <WorkbenchPanel className="decision-domain-list-panel" title={copy.title} description="视图默认按决策状态分流。" footer={`第 ${safePage}/${pageCount} 页 · ${filtered.length} 条`} toolbar={<><WorkspaceActionButton className="workspace-button workspace-button--secondary" disabled={!storeContext || !viewReady || !api || busy} disabledReason={busy ? '当前决策操作进行中，请等待完成后刷新。' : '请先选择店铺并确认连接及读取权限后刷新。'} busy={pending === 'refresh' && busy} busyLabel="刷新中…" onClick={() => void refresh()} type="button">刷新经营决策</WorkspaceActionButton><WorkspaceActionButton className="workspace-button workspace-button--primary" disabled={view !== 'decisions/recommendations' || !can('decisions.recommendations.create') || busy} onClick={() => storeContext && setEditor({ record: null, draft: decisionDraft(storeContext) })} type="button" disabledReason={busy ? '当前决策操作进行中，请稍候。' : '请到待判断工作台，确认当前店铺已开放新建经营决策。'}><Plus size={15} />新建</WorkspaceActionButton></>}>
          {view === 'decisions/decided' && (
            <section className="decision-domain-batch-authority decision-domain-analysis-batch" aria-label="分析建议整批授权">
              <header>
                <div>
                  <strong>整批授权一次</strong>
                  <small>人工审批须先在“待审批”逐条填写原因并批准，再签发整个最新批次的授权。策略内自动由当前策略核验完整批次，不需要人工补签。</small>
                </div>
                <WorkspaceActionButton className="workspace-button workspace-button--primary" disabled={!canAuthorizeAnalysisBatch || authorizationProposals.length === 0 || busy || authorizationAnalysisLoading} onClick={() => void authorizeSelectedBatch()} type="button" disabledReason={busy ? '当前决策操作进行中，请稍候。' : authorizationAnalysisLoading ? '正在读取当前分析批次，请稍候。' : '请先选择当前运营任务及完整最新建议批次，并确认该模式具备授权权限。'} busy={pending === 'analysis-authorize'} busyLabel="授权校验中…"><ShieldCheck size={14} />{pending === 'analysis-authorize' ? '授权校验中…' : `授权 ${authorizationProposals.length} 条`}</WorkspaceActionButton>
              </header>
              <p id="decision-authorization-selector-reason">{busy ? '当前授权操作进行中，选择器暂时锁定，请稍候。' : authorizationAnalysisLoading ? '正在读取所选任务的最新动作批次，请稍候。' : '请先选择包含当前完整分析建议的运营任务，再核对其最新动作批次。'}</p><div className="decision-domain-analysis-scope">
                <label>
                  <span>授权运营任务</span>
                  <select aria-describedby="decision-authorization-selector-reason" aria-label="选择授权运营任务" disabled={busy || authorizationMissions.length === 0} value={authorizationMissionId} onChange={(event) => setAuthorizationMissionId(event.target.value)}>
                    <option value="">{authorizationMissions.length ? '请选择运营任务' : '暂无可授权运营任务'}</option>
                    {authorizationMissions.map((missionId, index) => <option key={missionId} value={missionId}>运营任务 {index + 1}</option>)}
                  </select>
                </label>
                <label>
                  <span>最新动作批次</span>
                  <select aria-describedby="decision-authorization-selector-reason" aria-label="选择最新动作批次" disabled={busy || authorizationAnalysisLoading || authorizationBatches.length === 0} value={authorizationBatchId} onChange={(event) => setAuthorizationBatchId(event.target.value)}>
                    <option value="">{authorizationAnalysisLoading ? '正在读取动作批次…' : authorizationBatches.length ? '等待最新批次' : '暂无动作批次'}</option>
                    {authorizationBatches.map((batch) => <option key={batch.id} value={batch.id}>最新动作批次 · {batch.proposalCount} 条</option>)}
                  </select>
                </label>
              </div>
              {authorizationAnalysisError ? <p className="decision-domain-analysis-error">{visibleAuthorizationAnalysisError}</p> : authorizationAnalysisLoading ? <p>正在读取所选运营任务的分析建议…</p> : authorizationProposals.length ? <AnalysisProposalBusinessTable busy={busy} proposals={authorizationProposals} /> : <p>请选择包含分析建议的运营任务；策略内自动可以直接校验待审批或待复核经营决策。</p>}
              <details><summary>诊断详情</summary><code>{authorizationMissionId || '—'}</code><code>{authorizationBatchId || '—'}</code></details>
            </section>
          )}
          <input className="decision-domain-search" aria-label="搜索经营决策" placeholder="搜索标题、动作或产品" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} />
          {phase === 'loading' && <WorkspaceState kind="loading" title="读取经营决策" description="正在读取当前店铺决策与历史。" />}
          {(phase === 'blocked' || phase === 'error') && <WorkspaceState kind="blocked" title="经营决策已失败关闭" description="生产模式不会使用界面临时数据。" details={visibleBlockedReason} />}
          {phase === 'ready' && !rows.length && <WorkspaceState kind="empty" title={`${copy.title}暂无记录`} description="切换其他经营决策视图或创建新建议。" />}
          <ul className="decision-domain-list" aria-label={`${copy.title}列表`}>{rows.map((item) => <li key={item.id}><button aria-pressed={item.id === selected?.id} data-selected={item.id === selected?.id || undefined} onClick={() => setSelectedId(item.id)} type="button"><span><em data-status={item.status}>{STATUS_LABELS[item.status]}</em><time>{decisionRevisionDisplayLabel(item.revision)}</time></span><strong>{decisionOperatorCopy(item.title, '未命名经营决策')}</strong><small>{decisionListScopeLabel(item)}</small><b>置信度 {Math.round(item.confidence * 100)}%</b></button></li>)}</ul>
          <nav className="decision-domain-pagination" aria-label="经营决策分页"><WorkspaceActionButton disabled={safePage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} type="button" disabledReason={'已经是第一页。'}>上一页</WorkspaceActionButton><span>{safePage}/{pageCount}</span><WorkspaceActionButton disabled={safePage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} type="button" disabledReason={'已经是最后一页。'}>下一页</WorkspaceActionButton></nav>
        </WorkbenchPanel>
        <div className="decision-domain-detail">{selected ? <>
          {view === 'decisions/recommendations' && selectedMissionProposals.length > 0 && <section className="decision-domain-analysis-overview" aria-label="本次分析建议">
            <header><div><h3>本次分析建议</h3><p>按广告活动、广告组、对象和变更列展示；表内只显示当前运营任务的最新动作批次。</p></div></header>
            <AnalysisProposalBusinessTable
              busy={busy}
              onSelect={selectProposalDecision}
              proposals={selectedMissionProposals}
              selectedProposalId={selectedProposal?.id}
            />
          </section>}
          <section className="decision-domain-detail-head">
            <div>
              <span>经营决策</span>
              <h2>{decisionOperatorCopy(selected.title, '未命名经营决策')}</h2>
              <p>已绑定运营任务、数据批次与策略版本</p>
              <details><summary>诊断详情</summary><code>{selected.id}</code><code>{selected.missionId}</code><code>{selected.dataBatchId}</code><code>{selected.revision}</code></details>
            </div>
            <em data-status={selected.status}>{STATUS_LABELS[selected.status]}</em>
            <div className="decision-domain-actions">{actionVisibility?.revise && <WorkspaceActionButton className="workspace-button workspace-button--primary" disabled={!can('decisions.recommendations.update') || busy} onClick={() => storeContext && setEditor({ record: selected, draft: decisionDraft(storeContext, selected) })} type="button" disabledReason={busy ? '当前决策操作进行中，请稍候。' : '当前决策状态或权限不允许修订，请刷新当前店铺后重试。'}><PencilSimple size={15} />修订</WorkspaceActionButton>}{actionVisibility?.resolve && <><WorkspaceActionButton className="workspace-button workspace-button--primary" disabled={!can('decisions.approval.approve') || busy} onClick={() => setResolution('approved')} type="button" disabledReason={busy ? '当前决策操作进行中，请稍候。' : '当前店铺未开放此人工决议，请在待审批工作台核对权限后重试。'}><Check size={15} />批准</WorkspaceActionButton><WorkspaceActionButton className="workspace-button workspace-button--secondary" disabled={!can('decisions.approval.reject') || busy} onClick={() => setResolution('rejected')} type="button" disabledReason={busy ? '当前决策操作进行中，请稍候。' : '当前店铺未开放此人工决议，请在待审批工作台核对权限后重试。'}><ThumbsDown size={15} />拒绝</WorkspaceActionButton><WorkspaceActionButton className="workspace-button workspace-button--secondary" disabled={!can('decisions.approval.reject') || busy} onClick={() => setResolution('blocked')} type="button" disabledReason={busy ? '当前决策操作进行中，请稍候。' : '当前店铺未开放此人工决议，请在待审批工作台核对权限后重试。'}><Prohibit size={15} />阻断</WorkspaceActionButton><WorkspaceActionButton className="workspace-button workspace-button--secondary" disabled={!can('decisions.approval.reject') || busy} onClick={() => setResolution('superseded')} type="button" disabledReason={busy ? '当前决策操作进行中，请稍候。' : '当前店铺未开放此人工决议，请在待审批工作台核对权限后重试。'}><ArrowRight size={15} />标记被替代</WorkspaceActionButton></>}</div>
          </section>
          <section className="decision-domain-recommendation">
            <div><FileText size={20} weight="duotone" /><div><span>推荐动作</span><strong>{decisionOperatorCopy(selected.recommendation, '推荐动作待补充')}</strong><p>{decisionOperatorCopy(selected.rationale, '判断依据待补充')}</p>{selectedProposal && <div className="decision-domain-proposal-source"><small>{selectedProposal.source === 'rule_ai' ? '规则 + AI 一致' : '单一分析来源'} · 证据已锁定</small><AnalysisProposalAuthorityStatus busy={pending === 'target-verify'} onVerify={targetBindingApi ? () => void verifySelectedProposalTarget() : undefined} proposal={selectedProposal} /></div>}</div></div>
            <dl><div><dt>当前值</dt><dd>{formatDecisionMoney(selected.currentValue, selectedProposal?.currentBidCents)}</dd></div><div><dt>推荐值</dt><dd>{formatDecisionMoney(selected.recommendedValue, selectedProposal?.proposedBidCents)}</dd></div><div><dt>策略快照</dt><dd>已锁定策略版本</dd></div><div><dt>有效期</dt><dd>{selected.validUntil?.slice(0, 10) ?? '未设置'}</dd></div></dl>
            <details><summary>诊断详情</summary><code>{selected.policyVersionId}</code><code>{selected.policyRevision}</code>{selectedProposal && <><code>{selectedProposal.evidencePackageHash}</code><code>{selectedProposal.adEntityRevision ?? '—'}</code></>}</details>
          </section>
          <div className="decision-domain-evidence-grid"><section><h3>可核验事实</h3><DecisionEvidenceFacts facts={selected.facts} /></section><section><h3>备选方案</h3>{selected.alternatives.length ? <ol>{selected.alternatives.map((alternative) => <li key={decisionOperatorCopy(alternative, '备选方案待补充')}>{decisionOperatorCopy(alternative, '备选方案待补充')}</li>)}</ol> : <p>未记录备选方案。</p>}<strong>预期效果</strong><p>{decisionOperatorCopy(selected.expectedEffect, '未记录')}</p></section></div>
          <section className="decision-domain-history">
            <header><div><h3>决策历史</h3><p>每次修订与人工决议都保留快照。</p></div><ClockCounterClockwise size={19} /></header>
            <div>{history.map((item) => <article key={item.id}><span>{decisionHistoryEventLabel(item.eventType)}</span><strong>版本快照已保留</strong><small>{decisionOperatorCopy(item.reason || item.createdAt, '历史变更已保留')}</small><details><summary>诊断详情</summary><code>{item.id}</code><code>{item.eventType}</code><code>{item.decisionRevision}</code><code>{item.actorId}</code></details></article>)}</div>
          </section>
          <section className="decision-domain-grants">
            <header><div><h3>执行授权</h3><p>人工审批与策略自动共用同一不可变授权模型；终态从持久化授权事件派生。</p></div><ShieldCheck size={19} /></header>
            {grants.length ? <div>{grants.map((grant) => { const terminal = terminalGrantEvent(grant); return <article data-revoked={terminal?.eventType === 'revoked' || undefined} data-terminal={terminal?.eventType} key={grant.id}><div><strong>执行授权</strong><small>{grant.issuer.type === 'policy' ? '策略自动' : '人工审批'} · {grant.allowedAdEntityIds.length} 个对象 · ≤ {grant.maxChangePct}% · ${grant.totalImpactBudget} · {grantTerminalDisplayLabel(grant.usage?.status ?? terminal?.eventType)}</small>{grant.usage && <small>总额度 {grant.usage.totalSlots} 次 · 提交中 {grant.usage.reservedSlots} 次 · 已消费 {grant.usage.spentSlots} 次 · 剩余 {grant.usage.residualSlots} 次；消费不代表执行成功。</small>}<details><summary>诊断详情</summary><code>{grant.id}</code><code>{grant.allowedAdEntityIds.join(',')}</code><code>{terminal?.eventType ?? 'issued'}</code></details></div>{view === 'decisions/decided' && grant.issuer.type === 'human' && <WorkspaceActionButton className="workspace-button workspace-button--secondary" disabled={!can('decisions.grants.revoke') || busy || Boolean(terminal)} onClick={() => setGrantToRevoke(grant)} type="button" disabledReason={busy ? '当前决策操作进行中，请稍候。' : terminal ? '该执行授权已终结，无需重复撤销。' : '当前店铺未开放撤销人工授权，请刷新后重试。'}>{terminal ? grantTerminalDisplayLabel(terminal.eventType) : '撤销人工授权'}</WorkspaceActionButton>}</article>; })}</div> : <p>当前运营任务没有授权。</p>}
          </section>
        </> : phase === 'ready' ? <WorkspaceState kind="empty" title={`等待选择${copy.title}`} description="从左侧选择经营决策，查看事实、审批历史与授权边界。" /> : null}</div>
      </div>
      {(error || feedback) && <p className="decision-domain-feedback" data-tone={error ? 'error' : 'success'} aria-live="polite">{visibleFeedback}</p>}
    </PageFrame>
    {editor && <DecisionDialog record={editor.record} draft={editor.draft} busy={pending === 'decision-save'} onChange={(draft) => setEditor((current) => current ? { ...current, draft } : current)} onClose={() => setEditor(null)} onSave={() => void saveDecision()} />}
        {view === 'decisions/approval' && resolution && selected && (
      <ReasonRequiredDialog
        open
        eyebrow="人工经营决策"
        title={`${STATUS_LABELS[resolution]}"${decisionOperatorCopy(selected.title, '未命名经营决策')}"`}
        description="状态写入使用版本校验；批准不代表 Ads 已执行。"
        tone={resolution === 'approved' ? 'primary' : 'danger'}
        confirmLabel={`确认${STATUS_LABELS[resolution]}`}
        reasonLabel="决议原因 *"
        busy={Boolean(pending)}
        reasonMinLength={1}
        diagnosticDetails={<><code>id={selected.id}</code><code>revision={selected.revision}</code></>}
        onConfirm={(reason) => void resolveDecision(reason)}
        onClose={() => setResolution(null)}
      />
    )}
    {grantToRevoke && <ReasonRequiredDialog open eyebrow="执行授权" title="撤销人工授权" description="填写业务原因后撤销剩余授权，历史判断和已提交结果继续保留。" tone="danger" confirmLabel="确认撤销" reasonLabel="撤销原因 *" reasonMinLength={1} busy={Boolean(pending)} onConfirm={reason => void revokeGrant(grantToRevoke, reason)} onClose={() => setGrantToRevoke(null)} />}
  </div>;
}
export { decisionActionVisibility, decisionCapabilityReady, preferredDecisionId, preferredDecisionIdAfterTargetVerification, authorizationMissionIds, analysisActionBatchOptions, buildAnalysisBatchAuthorizationRequest, formatDecisionMoney, decisionRevisionDisplayLabel, decisionFactProjection, DecisionEvidenceFacts, decisionListScopeLabel, decisionOperatorCopy, targetVerificationOperatorError, responseMatchesDecisionDetail } from './decision-workspace-model';
export { type DecisionWorkspaceView, type DecisionsWorkspaceProps, type AnalysisProposalBusinessRow, type DecisionDraft, type AnalysisActionBatchOption } from './decision-workspace-contracts';
export { proposalHasVerifiedAdsAuthority, proposalIsSafeTargetVerificationCandidate, findSafeTargetVerificationProposal, buildProposalTargetVerificationPlan, AnalysisProposalAuthorityStatus } from './decision-workspace-authority';
export { analysisProposalMatchTypeLabel, analysisProposalBusinessRow, AnalysisProposalBusinessTable } from './decision-workspace-analysis';
export { buildCreateDecisionInput, buildReviseDecisionInput, DecisionDialog } from './decision-workspace-editor';

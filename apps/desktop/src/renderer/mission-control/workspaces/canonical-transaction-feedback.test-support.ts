export type CanonicalFeedbackPanel = 'decisions' | 'execution' | 'memory';

export function canonicalTransactionFixture(panel: CanonicalFeedbackPanel): string {
  return `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { normalizeStoreContextEnvelope, createCausalTimelineExport } from '@amazon-ai-ops/shared-types';
import { DecisionsWorkspace } from './decisions-workspace';
import { ExecutionWorkspace } from './execution-workspace';
import { MemoryWorkspace } from './memory-workspace';
import { MissionControlStoreContextProvider, useMissionControlStoreContext } from '../store-context';
const calls = {}, pending = {};
const logs = [], errors = [];
window.electronAPI = { reportRuntimeLog: async record => logs.push(record) };
window.addEventListener('error', event => errors.push(event.message));
window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
const state = { id: 'A', generation: 1, view: 'decisions/recommendations', mounted: true, deferReads: false, failReads: false };
const context = () => normalizeStoreContextEnvelope({ storeId: 'fixture-store-' + state.id, browserProfileId: 'fixture-profile-' + state.id,
  sessionGeneration: state.generation, marketplace: 'US', currency: 'USD', businessTimezone: 'America/Los_Angeles', businessDate: '2026-10-16' });
function deferred(kind, input, value) { const list = calls[kind] ??= []; list.push(structuredClone(input));
  return new Promise((resolve, reject) => (pending[kind] ??= []).push({ resolve, reject, value })); }
function read(kind, ctx, value) { if (state.failReads) return Promise.reject(new Error('读取暂时失败，请刷新后重试。'));
  return state.deferReads ? deferred(kind, ctx, value) : Promise.resolve(value); }
const now = '2026-10-16T01:00:00.000Z';
function decision(ctx, status = 'proposed') { return { id: 'decision-' + status, storeId: ctx.storeId, missionId: 'mission-fixture', dataBatchId: 'batch-fixture', policyVersionId: 'policy-fixture',
  policyRevision: 1, actionRevision: 1, title: '当前店铺经营判断-' + ctx.storeId + '-' + status, rationale: '当前完整事实支持人工复核', recommendation: '保持观察', facts: ['事实记录完整'], alternatives: [],
  actionType: 'set_keyword_bid', confidence: .8, status, revision: 1, createdAt: now, updatedAt: now }; }
const decisions = ctx => ['proposed', 'needs_approval', 'approved'].map(status => decision(ctx, status));
function grant(ctx) { return { id: 'grant-fixture', storeId: ctx.storeId, marketplace: 'US', currency: 'USD', missionId: 'mission-fixture', missionRevision: 1, decisionIds: ['decision-approved'],
  actionRevision: 1, allowedActionTypes: ['set_keyword_bid'], allowedAdEntityIds: ['entity-fixture'], maxChangePct: 10, totalImpactBudget: .1, expiresAt: '2099-10-17T00:00:00.000Z',
  policyVersionId: 'policy-fixture', policyRevision: 1, requiredEvidence: [], stopConditions: [], issuer: { type: 'human', actorId: 'fixture-operator' }, issuedAt: now, createdSessionGeneration: ctx.sessionGeneration }; }
function event(ctx) { return { id: 'causal-fixture', storeId: ctx.storeId, stage: 'FACT', eventType: 'operator_fact', entityType: 'operation_note', entityId: 'object-fixture',
  title: '当前店铺事实-' + ctx.storeId, signal: '完整事实', status: 'recorded', source: 'fixture-api', actorId: 'fixture-operator', businessDate: ctx.businessDate,
  sessionGeneration: ctx.sessionGeneration, sequence: 1, createdAt: now }; }
function batch(ctx) { const id = 'execution-' + ctx.storeId; return { batch: { id, storeId: ctx.storeId, marketplace: 'US', currency: 'USD', missionId: 'mission-fixture', missionRevision: 1,
  grantId: 'grant-fixture', actionRevision: 1, status: 'queued', revision: 1, createdSessionGeneration: ctx.sessionGeneration, createdAt: now, updatedAt: now }, jobs: [{ id: id + '-job', storeId: ctx.storeId,
  batchId: id, ordinal: 1, missionId: 'mission-fixture', grantId: 'grant-fixture', proposalId: 'proposal-fixture', decisionId: 'decision-approved', decisionRevision: 1, actionRevision: 1,
  actionType: 'set_keyword_bid', canonicalKeywordId: 'keyword-fixture', adEntityId: 'entity-fixture', entityRevision: 1,
  identity: { storeId: ctx.storeId, marketplace: 'US', currency: 'USD', adsAccountId: 'account-fixture', campaignId: 'campaign-fixture', adGroupId: 'group-fixture', keywordId: 'keyword-fixture', objectRevision: 1 },
  pageIdentityHash: 'a'.repeat(64), expectedBidCents: 120, targetBidCents: 108, changePct: -10, idempotencyKey: id + '-intent', status: 'queued', revision: 1,
  createdSessionGeneration: ctx.sessionGeneration, createdAt: now, updatedAt: now, evidence: [], events: [] }] }; }
const decisionApi = {
  listDecisions: ctx => read('decisionRead', ctx, decisions(ctx)), getDecisionHistory: async () => [], listHumanGrants: async ctx => [grant(ctx)], listHumanGrantEvents: async () => [],
  createDecision: (ctx, input) => deferred('create', {ctx,input}, {...decision(ctx), ...input, storeId: ctx.storeId}),
  reviseDecision: (ctx, input) => deferred('revise', {ctx,input}, {...decision(ctx), ...input, storeId: ctx.storeId, revision: 2}),
  resolveDecisionHuman: (ctx, input) => deferred('resolve', {ctx,input}, {...decision(ctx,input.status), id:input.id, revision: 2}),
  revokeHumanGrant: (ctx,input) => deferred('revoke', {ctx,input}, { ...input, storeId:ctx.storeId, eventType:'revoked', createdAt:now })
};
const executionApi = { listBatches: ctx => read('executionRead', ctx, [batch(ctx)]),
  takeOverVisibleBrowser: input => deferred('takeover', input, { success:true }),
  cancelBatch: input => deferred('cancel', input, {...batch(input.context), batch:{...batch(input.context).batch, status:'cancelled'}}),
  resolveIdentity: input => deferred('identity',input,{}), createBatch: input => deferred('queue',input,{}), startBatch: input => deferred('start',input,{}),
  reconcileUnknownBatch: input => deferred('reconcile',input,{}), onProgress: () => () => {} };
const memoryApi = { listCausalEvents: ctx => read('memoryRead', ctx, [event(ctx)]),
  appendManualCausalEvent: (ctx,input) => deferred('append', {ctx,input}, {...event(ctx),...input,id:input.id,sequence:2}),
  exportCausalTimeline: ctx => deferred('export',ctx,createCausalTimelineExport(ctx,[event(ctx)],[])) };
const caps = (workspace, ids, view) => ids.map(capabilityId => ({capabilityId,workspace,view,action:capabilityId.endsWith('.view')?'view':'update',state:'PRODUCTION_NATIVE',detail:'生产接口组件隔离测试'}));
const decisionCaps = () => ['recommendations','approval','decided'].flatMap(view => caps('decisions',
  ['decisions.'+view+'.view', ...({recommendations:['decisions.recommendations.create','decisions.recommendations.update'],approval:['decisions.approval.approve','decisions.approval.reject'],decided:['decisions.grants.issue','decisions.grants.revoke']}[view])], 'decisions/'+view));
const listeners = [];
let currentProvider;
const store = ctx => ({storeId:ctx.storeId,browserProfileId:ctx.browserProfileId,displayName:'同名店铺',marketplace:'US',currency:'USD',businessTimezone:ctx.businessTimezone,status:'active',createdAt:now,updatedAt:now});
const workspace = () => ({store:store(context()),context:context(),connections:[],sessions:[]});
const providerApi = {listStores:async()=>[store(context())],listStoreDailyStatuses:async()=>({stores:[],generatedAt:now}),getActiveStoreWorkspaceView:async()=>workspace(),
  onStoreContextChanged:callback=>{listeners.push(callback);return()=>listeners.splice(listeners.indexOf(callback),1);},onStoresChanged:()=>()=>{}};
const root = createRoot(document.getElementById('root'));
function App() { currentProvider=useMissionControlStoreContext(); const ctx=currentProvider.authoritativeContext; return <><output id="fixture-authority">{state.id+'/'+state.generation+'/'+state.view}</output>{state.mounted && ctx && (${JSON.stringify(panel)} === 'decisions'
  ? <DecisionsWorkspace apiOverride={decisionApi} analysisApiOverride={null} capabilities={decisionCaps()} previewMode={false} storeContext={ctx} view={state.view} blockedReason="请确认当前店铺连接。" />
  : ${JSON.stringify(panel)} === 'execution' ? <ExecutionWorkspace apiOverride={executionApi} capabilities={caps('execution',['execution.queue.view','execution.queue.start','execution.queue.takeover','execution.queue.cancel','execution.queue.reconcile-unknown'],'execution/queue')} previewEnabled={false} storeContext={ctx} />
  : <MemoryWorkspace apiOverride={memoryApi} capabilities={caps('memory',['memory.timeline.view','memory.timeline.create','memory.timeline.correct','memory.timeline.export','memory.timeline.rebuild-index'],'memory/timeline')} previewMode={false} storeContext={ctx} blockedReason="请确认当前店铺连接。" />)}</>; }
function render() { flushSync(() => root.render(<MissionControlStoreContextProvider api={providerApi}><App/></MissionControlStoreContextProvider>)); }
window.canonicalFeedback = { calls, logs, errors, state, select(id,generation=1) {state.id=id;state.generation=generation;flushSync(()=>listeners.forEach(callback=>callback(workspace())));render();}, view(view) {state.view=view;render();}, mount(mounted) {state.mounted=mounted;render();},
  reconnect() {providerApi.getActiveStoreWorkspaceView=()=>deferred('bootstrap',{},workspace());void currentProvider.retryBootstrap();}, complete(kind,index,failed=false) { const item=pending[kind][index]; failed?item.reject(new Error('暂时无法完成，请重试。')):item.resolve(item.value); } };
window.confirm=()=>true;
render();
`;
}

import { describe, expect, it } from 'vitest';
import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import {
  assertMissionAuthorityContext,
  createMissionDomainWindowSurface,
  createPreviewDecisionDomainApi,
  createPreviewExperimentMemoryDomainSuite,
  createPreviewMissionDomainApi,
  createPreviewPolicyDomainApi,
  readDecisionDomainWindowApi,
  readExperimentDomainWindowApi,
  readMemoryDomainWindowApi,
  readMissionDomainWindowApi,
  readPolicyDomainWindowApi,
} from './mission-domain-window-api';

const firstContext = {
  storeId: 'preview-store-shc001',
  browserProfileId: 'preview-profile-shc001',
  marketplace: 'US',
  currency: 'USD',
  businessTimezone: 'America/Los_Angeles',
  businessDate: '2026-07-22',
  sessionGeneration: 1,
} as StoreContextEnvelope;

const secondContext = {
  ...firstContext,
  storeId: 'preview-store-shc002',
  browserProfileId: 'preview-profile-shc002',
} as StoreContextEnvelope;

describe('mission domain window adapter', () => {
  it('accepts only a complete nested missionDomain surface', () => {
    expect(readMissionDomainWindowApi({ electronAPI: {} })).toBeNull();
    expect(readMissionDomainWindowApi({ electronAPI: { missionDomain: { missions: { list: async () => [] } } } })).toBeNull();

    const missionDomain = createPreviewMissionDomainApi();
    const windowSurface = createMissionDomainWindowSurface(missionDomain);
    expect(readMissionDomainWindowApi({ electronAPI: { missionDomain: windowSurface } })).not.toBeNull();
  });

  it('normalizes the complete decision/grant and policy preload groups independently', () => {
    const experimentMemory = createPreviewExperimentMemoryDomainSuite();
    const surface = createMissionDomainWindowSurface(
      createPreviewMissionDomainApi(),
      createPreviewDecisionDomainApi(),
      createPreviewPolicyDomainApi(),
      experimentMemory.experiments,
      experimentMemory.memory,
    );
    const target = { electronAPI: { missionDomain: surface } };
    expect(readDecisionDomainWindowApi(target)).not.toBeNull();
    expect(readPolicyDomainWindowApi(target)).not.toBeNull();
    expect(readExperimentDomainWindowApi(target)).not.toBeNull();
    expect(readMemoryDomainWindowApi(target)).not.toBeNull();
    expect(readDecisionDomainWindowApi({ electronAPI: { missionDomain: { decisions: surface.decisions } } })).toBeNull();
    expect(readPolicyDomainWindowApi({ electronAPI: { missionDomain: { policies: surface.policies } } })).toBeNull();
    expect(readExperimentDomainWindowApi({ electronAPI: { missionDomain: { experiments: surface.experiments } } })).toBeNull();
    expect(readMemoryDomainWindowApi({ electronAPI: { missionDomain: { causal: { listEvents: surface.causal?.listEvents } } } })).toBeNull();
  });

  it('fails closed outside the US and USD V1 authority', () => {
    expect(() => assertMissionAuthorityContext({ ...firstContext, marketplace: 'CA' } as unknown as StoreContextEnvelope)).toThrow(/美国站|失败关闭/);
    expect(() => assertMissionAuthorityContext({ ...firstContext, currency: 'CAD' } as unknown as StoreContextEnvelope)).toThrow(/USD|失败关闭/);
  });
});

describe('preview experiment and causal-memory domain adapter', () => {
  it('supports CAS, the explicit lifecycle, archive/restore and append-only correction', async () => {
    const { experiments } = createPreviewExperimentMemoryDomainSuite();
    const created = await experiments.createExperiment(firstContext, {
      id: 'EXPERIMENT-CUSTOM-001', missionId: 'MISSION-SHC001-001', name: '自定义单变量实验',
      hypothesis: '竞价下降 10% 会改善 ACOS 且守住订单', primaryMetric: 'ACOS',
      guardrailMetrics: ['广告订单'], guardrailCriteria: ['订单下降 < 15%'], productId: 'B0GTTJFQTM',
      adEntityId: 'KW-CUSTOM-001', baseline: { bidUsd: 1.2 }, variant: { bidUsd: 1.08 },
      observationStartsAt: '2026-07-22T07:00:00.000Z', observationEndsAt: '2026-07-29T07:00:00.000Z',
    });
    const updated = await experiments.updateExperiment(firstContext, {
      id: created.id, expectedRevision: created.revision, actorId: 'operator', patch: { name: '自定义单变量实验（修订）' },
    });
    await expect(experiments.updateExperiment(firstContext, {
      id: created.id, expectedRevision: created.revision, actorId: 'operator', patch: { name: '覆盖并发修改' },
    })).rejects.toThrow(/版本冲突|revision/);
    const running = await experiments.transitionExperiment(firstContext, {
      id: updated.id, expectedRevision: updated.revision, status: 'running', actorId: 'operator',
    });
    await expect(experiments.archiveExperiment(firstContext, {
      id: running.id, expectedRevision: running.revision, actorId: 'operator',
    })).rejects.toThrow(/先暂停/);
    const paused = await experiments.transitionExperiment(firstContext, {
      id: running.id, expectedRevision: running.revision, status: 'paused', actorId: 'operator',
    });
    const observation = await experiments.appendExperimentObservation(firstContext, {
      id: 'OBS-CUSTOM-001', experimentId: paused.id, observationType: 'observation', title: '第 1 天观察',
      observation: 'ACOS 开始下降，订单稳定。', observedAt: '2026-07-23T07:00:00.000Z', actorId: 'operator',
    });
    const correction = await experiments.appendExperimentObservation(firstContext, {
      id: 'OBS-CUSTOM-002', experimentId: paused.id, observationType: 'correction', title: '修正第 1 天观察',
      observation: '订单为 23，不是 24。', observedAt: '2026-07-23T08:00:00.000Z', actorId: 'operator',
      correctsRecordId: observation.id,
    });
    expect(correction.correctsRecordId).toBe(observation.id);
    expect((await experiments.listExperimentObservations(firstContext, paused.id)).map((item) => item.id))
      .toEqual(expect.arrayContaining([observation.id, correction.id]));
    const completed = await experiments.transitionExperiment(firstContext, {
      id: paused.id, expectedRevision: paused.revision, status: 'completed', actorId: 'operator', reason: 'ACOS 改善 12%',
    });
    expect(completed).toMatchObject({ status: 'completed', conclusion: 'ACOS 改善 12%' });
    const archived = await experiments.archiveExperiment(firstContext, {
      id: completed.id, expectedRevision: completed.revision, actorId: 'operator',
    });
    const restored = await experiments.restoreExperiment(firstContext, {
      id: archived.id, expectedRevision: archived.revision, actorId: 'operator',
    });
    expect(restored.status).toBe('paused');
  });

  it('isolates observation and metric detail when two Experiments share one Mission', async () => {
    const { experiments } = createPreviewExperimentMemoryDomainSuite();
    const rows = await experiments.listExperiments(firstContext, { includeArchived: true });
    const first = rows.find((item) => item.id === 'EXPERIMENT-SHC001-001')!;
    const second = rows.find((item) => item.id === 'EXPERIMENT-SHC001-002')!;
    expect(first.missionId).toBe(second.missionId);
    const firstObservations = await experiments.listExperimentObservations(firstContext, first.id);
    const secondObservations = await experiments.listExperimentObservations(firstContext, second.id);
    expect(firstObservations.map((item) => item.id)).toEqual(['OBS-SHC001-001']);
    expect(secondObservations.map((item) => item.id)).toEqual(['OBS-SHC001-002']);
    expect((await experiments.listExperimentMetricSnapshots(firstContext, first.id))).toHaveLength(2);
    expect((await experiments.listExperimentMetricSnapshots(firstContext, second.id))).toEqual([]);
  });

  it('allows Renderer memory writes only for FACT/ANALYSIS and preserves corrections', async () => {
    const { memory } = createPreviewExperimentMemoryDomainSuite();
    const fact = await memory.appendManualCausalEvent(firstContext, {
      id: 'CAUSAL-MANUAL-001', stage: 'FACT', eventType: 'operator_fact', entityType: 'operation_note',
      entityId: 'NOTE-001', missionId: 'MISSION-SHC001-001', title: '促销开始时间已确认',
      signal: '优惠券 07:00 生效', status: 'recorded', source: 'forged-source', actorId: 'forged-actor',
    });
    const correction = await memory.appendManualCausalEvent(firstContext, {
      id: 'CAUSAL-MANUAL-002', stage: 'FACT', eventType: 'operator_fact_correction', entityType: 'operation_note',
      entityId: 'NOTE-001', missionId: 'MISSION-SHC001-001', title: '修正促销时间', signal: '优惠券 08:00 生效',
      status: 'recorded', source: 'forged-source', actorId: 'forged-actor', correctsEventId: fact.id,
    });
    expect(fact).toMatchObject({ source: 'mission-domain-ui', actorId: 'desktop-operator' });
    expect(correction.correctsEventId).toBe(fact.id);
    await expect(memory.appendManualCausalEvent(firstContext, {
      id: 'CAUSAL-FORGED-ACTION', stage: 'ACTION', eventType: 'forged_action', entityType: 'ad_execution',
      entityId: 'EXEC-001', title: '伪造执行', status: 'confirmed', source: 'ui', actorId: 'operator',
    })).rejects.toThrow(/FACT|ANALYSIS|Main-only/);
    expect((await memory.listCausalEvents(secondContext)).every((item) => item.storeId === secondContext.storeId)).toBe(true);
  });
});

describe('preview decision domain adapter', () => {
  it('supports CAS history and human-only resolution without exposing grant issuance', async () => {
    const api = createPreviewDecisionDomainApi();
    const base = {
      missionId: 'MISSION-SHC001-001', dataBatchId: 'BATCH-SHC001-0722', policyVersionId: 'POL-SHC001-US-V3',
      policyRevision: 1, actionRevision: 11, rationale: '批次事实一致', recommendation: '降价 10%', facts: ['花费高'],
      alternatives: ['不变'], actionType: 'set_keyword_bid', productId: 'B0GTTJFQTM', confidence: 0.8, status: 'needs_approval' as const,
      actorId: 'operator',
    };
    const first = await api.createDecision(firstContext, { ...base, id: 'DECISION-BATCH-1', title: '批次一', adEntityId: 'KW-BATCH-1', currentValue: 1.2, recommendedValue: 1.08 });
    const second = await api.createDecision(firstContext, { ...base, id: 'DECISION-BATCH-2', title: '批次二', adEntityId: 'KW-BATCH-2', currentValue: 1.1, recommendedValue: 0.99 });
    const revised = await api.reviseDecision(firstContext, { id: first.id, expectedRevision: first.revision, title: '批次一修订', actorId: 'operator' });
    const revisedSecond = await api.reviseDecision(firstContext, { id: second.id, expectedRevision: second.revision, title: '批次二修订', actorId: 'operator' });
    await expect(api.reviseDecision(firstContext, { id: first.id, expectedRevision: first.revision, title: '覆盖并发变更', actorId: 'operator' })).rejects.toThrow(/revision|版本冲突/);
    const approvedOne = await api.resolveDecisionHuman(firstContext, { id: revised.id, expectedRevision: revised.revision, status: 'approved', reason: '人工确认', actorId: 'operator' });
    await api.resolveDecisionHuman(firstContext, { id: revisedSecond.id, expectedRevision: revisedSecond.revision, status: 'approved', reason: '人工确认', actorId: 'operator' });
    const history = await api.getDecisionHistory(firstContext, approvedOne.id);
    expect(history.map((row) => row.eventType)).toEqual(expect.arrayContaining(['created', 'revised', 'approved']));
    await expect(api.resolveDecisionHuman(firstContext, { id: approvedOne.id, expectedRevision: approvedOne.revision, status: 'executed' as never, reason: '越权', actorId: 'operator' })).rejects.toThrow(/只能人工/);

    expect(api).not.toHaveProperty('issueHumanGrant');
  });

  it('isolates decision identities by store and session generation', async () => {
    const api = createPreviewDecisionDomainApi();
    const first = await api.listDecisions(firstContext);
    const second = await api.listDecisions(secondContext);
    expect(first.every((row) => row.storeId === firstContext.storeId)).toBe(true);
    expect(second.every((row) => row.storeId === secondContext.storeId)).toBe(true);
    expect(first.map((row) => row.id)).not.toEqual(second.map((row) => row.id));
    const next = await api.listDecisions({ ...firstContext, sessionGeneration: 2 } as StoreContextEnvelope);
    expect(next.map((row) => row.id)).toEqual(first.map((row) => row.id));
    expect(next).not.toBe(first);
  });
});

describe('preview mission domain adapter', () => {
  it('keeps stores isolated and preserves US/USD identities', async () => {
    const api = createPreviewMissionDomainApi();
    const first = await api.listMissions(firstContext, { includeArchived: true });
    const second = await api.listMissions(secondContext, { includeArchived: true });

    expect(first).toHaveLength(7);
    expect(second).toHaveLength(7);
    expect(first.every((mission) => mission.storeId === firstContext.storeId && mission.marketplace === 'US' && mission.currency === 'USD')).toBe(true);
    expect(second.every((mission) => mission.storeId === secondContext.storeId && mission.marketplace === 'US' && mission.currency === 'USD')).toBe(true);
    expect(first.map((mission) => mission.id)).not.toEqual(second.map((mission) => mission.id));
    expect(first.some((mission) => mission.title.includes('智能门锁'))).toBe(true);
    expect(second.some((mission) => mission.title.includes('车库门'))).toBe(true);
  });

  it('supports create, CAS edit, pause, archive, restore, checkpoint and lineage', async () => {
    const api = createPreviewMissionDomainApi();
    const created = await api.createMission(firstContext, {
      id: 'MISSION-CUSTOM-001',
      dataBatchId: 'BATCH-SHC001-0722',
      policyVersionId: 'POL-SHC001-US-V3',
      title: '验证新核心词效率',
      objective: '7 天内降低 ACOS 并守住订单',
      priority: 'P1',
      productId: 'B0GTTJFQTM',
      observationStartsAt: '2026-07-22T07:00:00.000Z',
      observationEndsAt: '2026-07-29T07:00:00.000Z',
      successCriteria: ['ACOS 改善 ≥ 10%'],
      guardrails: ['UNKNOWN 立即停止'],
      actorId: 'operator',
    });
    expect(created.status).toBe('draft');
    expect(created.revision).toBe(1);

    const updated = await api.updateMission(firstContext, {
      id: created.id,
      expectedRevision: created.revision,
      actorId: 'operator',
      patch: { title: '验证新核心词效率（修订）' },
    });
    expect(updated.revision).toBe(2);
    await expect(api.updateMission(firstContext, {
      id: created.id,
      expectedRevision: 1,
      actorId: 'operator',
      patch: { title: '覆盖并发变更' },
    })).rejects.toThrow(/版本冲突|revision/);

    const running = await api.transitionMission(firstContext, {
      id: updated.id,
      expectedRevision: updated.revision,
      status: 'active',
      actorId: 'operator',
    });
    const paused = await api.transitionMission(firstContext, {
      id: running.id,
      expectedRevision: running.revision,
      status: 'paused',
      actorId: 'operator',
    });
    expect(paused.status).toBe('paused');

    const checkpoint = await api.appendMissionCheckpoint(firstContext, {
      id: 'CHECKPOINT-CUSTOM-001',
      missionId: paused.id,
      stage: 'FACT',
      title: '真实报表口径已确认',
      status: 'completed',
      evidenceCount: 8,
      actorId: 'operator',
    });
    expect(checkpoint.evidenceCount).toBe(8);

    const archived = await api.archiveMission(firstContext, {
      id: paused.id,
      expectedRevision: paused.revision,
      actorId: 'operator',
    });
    expect(archived.status).toBe('archived');
    expect((await api.listMissions(firstContext)).some((mission) => mission.id === archived.id)).toBe(false);

    const restored = await api.restoreMission(firstContext, {
      id: archived.id,
      expectedRevision: archived.revision,
      actorId: 'operator',
    });
    expect(restored.status).toBe('paused');
    const lineage = await api.getMissionLineage(firstContext, restored.id);
    expect(lineage.checkpoints).toEqual(expect.arrayContaining([expect.objectContaining({ id: checkpoint.id })]));
    expect(lineage.links.map((link) => link.linkType)).toEqual(expect.arrayContaining(['data_batch', 'policy_version', 'product']));
  });

  it('invalidates the preview store snapshot when the session generation changes', async () => {
    const api = createPreviewMissionDomainApi();
    await api.createMission(firstContext, {
      id: 'MISSION-OLD-SESSION', dataBatchId: 'BATCH-SHC001-0722', policyVersionId: 'POL-SHC001-US-V3',
      title: '旧会话任务', objective: '不得跨会话复用', priority: 'P2',
      observationStartsAt: '2026-07-22T07:00:00.000Z', observationEndsAt: '2026-07-29T07:00:00.000Z',
      successCriteria: ['不跨会话'], guardrails: ['失败关闭'], actorId: 'operator',
    });
    const nextGeneration = { ...firstContext, sessionGeneration: 2 } as StoreContextEnvelope;
    const rows = await api.listMissions(nextGeneration, { includeArchived: true });
    expect(rows.some((mission) => mission.id === 'MISSION-OLD-SESSION')).toBe(false);
    expect(rows.every((mission) => mission.createdSessionGeneration === 2)).toBe(true);
  });
});

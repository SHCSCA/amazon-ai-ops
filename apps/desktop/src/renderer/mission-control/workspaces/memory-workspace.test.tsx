import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CausalEventRecord, MissionControlCapabilityProjection, StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { createPreviewExperimentMemoryDomainSuite } from './mission-domain-window-api';
import {
  MemoryEditor,
  MemoryWorkspace,
  buildManualCausalEventInput,
  memoryDraftFor,
  memoryOperatorCopy,
  memoryOperatorMessage,
} from './memory-workspace';

const context = {
  storeId: 'preview-store-shc001', browserProfileId: 'preview-profile-shc001',
  marketplace: 'US', currency: 'USD', businessTimezone: 'America/Los_Angeles',
  businessDate: '2026-07-22', sessionGeneration: 1,
} as StoreContextEnvelope;

function capability(capabilityId: string, state: MissionControlCapabilityProjection['state'] = 'PROTOTYPE_ONLY'): MissionControlCapabilityProjection {
  return { capabilityId, workspace: 'memory', view: 'memory/timeline', action: capabilityId.endsWith('.view') ? 'view' : capabilityId.endsWith('.correct') ? 'update' : 'create', state, detail: `${capabilityId} ${state}` };
}

const previewCapabilities = [
  capability('memory.timeline.view'),
  capability('memory.timeline.create'),
  capability('memory.timeline.correct'),
];

function ordinaryVisibleCopy(markup: string): string {
  return markup
    .replace(/<details\b[\s\S]*?<\/details>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:nbsp|#x27|quot|amp|lt|gt);/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('MemoryWorkspace', () => {
  it('keeps internal causal vocabulary out of ordinary operator copy', () => {
    const suite = createPreviewExperimentMemoryDomainSuite();
    const markup = renderToStaticMarkup(<MemoryWorkspace
      apiOverride={suite.memory}
      blockedReason="Memory Main Authority 未接入"
      capabilities={previewCapabilities}
      previewMode
      storeContext={context}
    />);
    const copy = ordinaryVisibleCopy(markup);

    expect(copy).toContain('事实');
    expect(copy).toContain('分析');
    expect(copy).toContain('决策');
    expect(copy).toContain('执行');
    expect(copy).toContain('结果核验');
    expect(copy).toContain('经营效果');
    expect(copy).not.toMatch(/Renderer|Main(?:-only)?|Crux Decision|sequence|append-only ledger|correction|DECISION|ACTION|READBACK|EFFECT|Mission ID|\bMission\b/);
  });

  it('turns validation failures into a Chinese reason and next step', () => {
    const copy = memoryOperatorMessage(new Error('置信度必须在 0–1 之间。'));
    expect(copy).toContain('置信度必须在 0–1 之间');
    expect(copy).toContain('请修正后重试');
    expect(copy).not.toMatch(/Renderer|Main(?:-only)?|UNKNOWN|capability|revision/);

    const runtimeCopy = memoryOperatorMessage(new Error('Renderer Main-only UNKNOWN capability revision failed'));
    expect(runtimeCopy).toContain('因果记忆服务暂不可用');
    expect(runtimeCopy).toContain('请刷新后重试');
    expect(runtimeCopy).not.toMatch(/Renderer|Main(?:-only)?|UNKNOWN|capability|revision/);
  });

  it('translates stored technical values before they reach ordinary copy', () => {
    const copy = memoryOperatorCopy('同 Mission 的 Before / After / Reload；Renderer Main-only UNKNOWN，CAUSAL-SHC001-FACT-001');
    expect(copy).toContain('同运营任务');
    expect(copy).toContain('操作前 / 操作后 / 刷新后');
    expect(copy).toContain('结果不确定');
    expect(copy).toContain('内部标识已隐藏');
    expect(copy).not.toMatch(/Renderer|Main(?:-only)?|UNKNOWN|Before|After|Reload|CAUSAL-|\bMission\b/);
  });

  it('renders the full six-stage append-only memory surface', () => {
    const suite = createPreviewExperimentMemoryDomainSuite();
    const markup = renderToStaticMarkup(<MemoryWorkspace
      apiOverride={suite.memory}
      blockedReason="仅开发预览"
      capabilities={previewCapabilities}
      previewMode
      storeContext={context}
    />);
    expect(markup).toContain('data-canonical-surface="memory"');
    expect(markup).toContain('因果记忆');
    expect(markup).toContain('FACT');
    expect(markup).toContain('ANALYSIS');
    expect(markup).toContain('DECISION');
    expect(markup).toContain('ACTION');
    expect(markup).toContain('READBACK');
    expect(markup).toContain('EFFECT');
    expect(markup).toContain('Main-only 只读');
    expect(markup).toContain('data-task-density="compact"');
    expect(markup).toContain('aria-label="因果阶段权限"');
    expect(markup).toContain('data-scroll-owner="memory-event-detail"');
    expect(markup).toContain('aria-label="因果记忆事件详情"');
    expect(markup).not.toContain('删除事件');
  });

  it('fails closed when Main causal authority is unavailable', () => {
    const markup = renderToStaticMarkup(<MemoryWorkspace
      blockedReason="Memory Main Authority 未接入"
      capabilities={[capability('memory.timeline.view', 'BLOCKED')]}
      previewMode={false}
      storeContext={context}
    />);
    expect(markup).toContain('data-capability-state="BLOCKED"');
    expect(markup).toContain('已阻断');
    expect(markup).not.toContain('显式内存 adapter');
  });

  it('locks correction lineage fields and keeps original lineage in the built input', () => {
    const target = {
      id: 'CAUSAL-FACT-001', storeId: context.storeId, stage: 'FACT', eventType: 'source_fact',
      entityType: 'data_batch', entityId: 'BATCH-001', missionId: 'MISSION-001', title: '原事实',
      signal: '原信号', status: 'recorded', source: 'collector', actorId: 'main-agent', businessDate: '2026-07-22',
      sessionGeneration: 1, sequence: 1, createdAt: '2026-07-22T00:00:00.000Z',
    } as CausalEventRecord;
    const draft = memoryDraftFor(target);
    const markup = renderToStaticMarkup(<MemoryEditor
      busy={false}
      draft={draft}
      onCancel={() => undefined}
      onChange={() => undefined}
      onSave={() => undefined}
    />);
    expect(markup).toMatch(/阶段 \*<\/span><select disabled=""/);
    expect(markup).toMatch(/Mission ID<\/span><input disabled=""/);
    expect(markup).toMatch(/对象类型 \*<\/span><input disabled=""/);
    expect(markup).toMatch(/对象 ID \*<\/span><input disabled=""/);
    expect(markup).toContain('<summary>诊断详情</summary>');
    expect(ordinaryVisibleCopy(markup)).not.toMatch(/Mission ID|MISSION-|CAUSAL-|correction|Renderer|Main(?:-only)?/);

    const forgedDraft = {
      ...draft,
      stage: 'ANALYSIS' as const,
      entityType: 'forged_type',
      entityId: 'FORGED-ID',
      missionId: 'MISSION-FORGED',
      title: '修正原事实',
      signal: '新信号',
    };
    expect(buildManualCausalEventInput(forgedDraft, 'CAUSAL-CORRECTION-001')).toMatchObject({
      stage: 'FACT',
      entityType: 'data_batch',
      entityId: 'BATCH-001',
      missionId: 'MISSION-001',
      correctsEventId: target.id,
    });
  });

  it('rejects Renderer attempts to append a Main-only stage', () => {
    expect(() => buildManualCausalEventInput({
      ...memoryDraftFor(), stage: 'ACTION' as never, entityType: 'ad_execution', entityId: 'EXEC-1', title: '伪造动作',
    }, 'CAUSAL-FORGED')).toThrow(/FACT|ANALYSIS/);
  });
});

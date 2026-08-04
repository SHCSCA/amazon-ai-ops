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

describe('MemoryWorkspace', () => {
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

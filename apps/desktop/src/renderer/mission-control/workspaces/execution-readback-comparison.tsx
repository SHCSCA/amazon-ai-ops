import React from 'react';
import { CheckCircle, Circle } from '@phosphor-icons/react';
import type { AdExecutionBatchProjection } from '@amazon-ai-ops/shared-types';
import { evidenceForExecutionJob } from './execution-workspace-evidence';
import { selectExecutionReadbackGate } from './execution-workspace-gate';
import { EVIDENCE_SLOT_LABELS, formatTime, money } from './execution-workspace-model';

export function ExecutionReadbackComparison({ projection, jobId, previewOnly = false }: {
  projection: AdExecutionBatchProjection | null;
  jobId: string | null;
  previewOnly?: boolean;
}) {
  const verified = !previewOnly && selectExecutionReadbackGate(projection, jobId, projection?.batch.grantId ?? null).eligible;
  return (
    <section className="execution-evidence">
      <h3>变更前 / 提交后 / 刷新后</h3>
      {(['before', 'after', 'reload'] as const).map(slot => {
        const evidence = projection && jobId ? evidenceForExecutionJob(projection, jobId, slot) : undefined;
        const state = evidence ? verified ? 'ready' : 'attached' : 'pending';
        return (
          <article data-state={state} key={slot}>
            <span>{state === 'ready' ? <CheckCircle size={17} weight="fill" /> : <Circle size={17} />}</span>
            <div>
              <strong>{EVIDENCE_SLOT_LABELS[slot]}</strong>
              <small>{evidence ? `${money(evidence.observedBidCents)} · ${formatTime(evidence.capturedAt)}`
                : slot === 'before' ? '提交意图前捕获' : slot === 'after' ? '提交后捕获' : '刷新后同对象核验'}</small>
              {state === 'attached' && <small>已附加，尚未完成结果核验</small>}
              {evidence && <details><summary>诊断详情</summary><code>{evidence.contentSha256.slice(0, 12)}…</code></details>}
            </div>
          </article>
        );
      })}
    </section>
  );
}

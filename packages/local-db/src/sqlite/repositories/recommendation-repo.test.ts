import { describe, expect, it } from 'vitest';
import type { ActionRecommendation } from '@amazon-ai-ops/shared-types';
import { RecommendationRepository } from './recommendation-repo';

function createRepo() {
  const rows: any[] = [];
  let beforeDuplicateUpdate: (() => void) | undefined;
  const db = {
    transaction<T extends (...args: any[]) => any>(fn: T) {
      const transaction = ((...args: Parameters<T>) => fn(...args)) as T & {
        immediate: (...args: Parameters<T>) => ReturnType<T>;
      };
      transaction.immediate = (...args: Parameters<T>) => fn(...args);
      return transaction;
    },
    prepare(sql: string) {
      if (sql.includes('INSERT INTO action_recommendations')) {
        return {
          run(input: any) {
            rows.push({
              id: rows.length + 1,
              task_id: input.taskId,
              store_name: input.storeName,
              marketplace_code: input.marketplaceCode,
              asin: input.asin,
              msku: input.msku,
              entity_type: input.entityType,
              entity_id: input.entityId,
              entity_name: input.entityName,
              action_type: input.actionType,
              current_value: input.currentValue,
              recommended_value: input.recommendedValue,
              reason: input.reason,
              evidence_json: input.evidenceJson,
              confidence: input.confidence,
              risk_level: input.riskLevel,
              status: input.status,
              revision: 0,
              created_at: '2026-06-17 10:00:00',
              updated_at: '2026-06-17 10:00:00',
            });
            return { lastInsertRowid: rows.length };
          },
        };
      }
      if (sql.includes('COUNT(*)')) {
        return {
          get(...params: any[]) {
            return { total: filterRows(sql, rows, params).length };
          },
        };
      }
      if (sql.includes('UPDATE action_recommendations') && sql.includes('SET task_id = @taskId')) {
        return {
          run(input: any) {
            beforeDuplicateUpdate?.();
            beforeDuplicateUpdate = undefined;
            const index = rows.findIndex((row) => (
              row.id === input.id
              && (!sql.includes('AND status = @expectedStatus') || row.status === input.expectedStatus)
              && (!sql.includes('AND revision = @expectedRevision') || row.revision === input.expectedRevision)
              && (!sql.includes("status IN ('pending', 'needs_review')") || ['pending', 'needs_review'].includes(row.status))
            ));
            if (index !== -1) {
              rows[index] = {
                ...rows[index],
                task_id: input.taskId,
                store_name: input.storeName,
                marketplace_code: input.marketplaceCode,
                asin: input.asin,
                msku: input.msku,
                entity_type: input.entityType,
                entity_id: input.entityId,
                entity_name: input.entityName,
                action_type: input.actionType,
                current_value: input.currentValue,
                recommended_value: input.recommendedValue,
                reason: input.reason,
                evidence_json: input.evidenceJson,
                confidence: input.confidence,
                risk_level: input.riskLevel,
                status: input.status,
                revision: sql.includes('revision = revision + 1')
                  ? rows[index].revision + 1
                  : rows[index].revision,
                updated_at: '2026-06-17 10:01:00',
              };
            }
            return { changes: index === -1 ? 0 : 1 };
          },
        };
      }
      if (
        sql.includes('UPDATE action_recommendations')
        && sql.includes('SET status = ?')
        && sql.includes('evidence_json = ?')
      ) {
        return {
          run(status: string, evidenceJson: string, id: number, expectedStatus?: string, expectedRevision?: number) {
            const index = rows.findIndex((row) => (
              row.id === id
              && (!sql.includes('AND status = ?') || row.status === expectedStatus)
              && (!sql.includes('AND revision = ?') || row.revision === expectedRevision)
            ));
            if (index !== -1) {
              rows[index] = {
                ...rows[index],
                status,
                evidence_json: evidenceJson,
                revision: sql.includes('revision = revision + 1')
                  ? rows[index].revision + 1
                  : rows[index].revision,
                updated_at: '2026-06-17 10:02:00',
              };
            }
            return { changes: index === -1 ? 0 : 1 };
          },
        };
      }
      if (
        sql.includes('UPDATE action_recommendations')
        && sql.includes('SET status = ?')
        && !sql.includes('evidence_json = ?')
      ) {
        return {
          run(status: string, id: number) {
            const index = rows.findIndex((row) => row.id === id);
            if (index !== -1) {
              rows[index] = {
                ...rows[index],
                status,
                revision: sql.includes('revision = revision + 1')
                  ? rows[index].revision + 1
                  : rows[index].revision,
                updated_at: '2026-06-17 10:03:00',
              };
            }
            return { changes: index === -1 ? 0 : 1 };
          },
        };
      }
      if (sql.includes('FROM action_recommendations')) {
        return {
          all(...params: any[]) {
            return filterRows(sql, rows, params);
          },
          get(...params: any[]) {
            return filterRows(sql, rows, params)[0];
          },
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  return {
    repo: new RecommendationRepository(db as any),
    simulateDecisionBeforeNextDuplicateUpdate(
      id: number,
      status: string,
      evidencePatch: Record<string, unknown>,
    ) {
      beforeDuplicateUpdate = () => {
        const row = rows.find((candidate) => candidate.id === id);
        if (!row) return;
        row.status = status;
        row.revision += 1;
        row.evidence_json = JSON.stringify({
          ...JSON.parse(row.evidence_json || '{}'),
          ...evidencePatch,
        });
      };
    },
  };
}

function filterRows(sql: string, rows: any[], params: any[]) {
  if (sql.includes('WHERE id = ?')) {
    const [id] = params;
    return rows.filter((row) => row.id === id);
  }
  return rows.filter((row) => {
    let paramIndex = 0;
    const evidence = JSON.parse(row.evidence_json || '{}');
    function nextParam() {
      return params[paramIndex++];
    }
    if (sql.includes('store_name = ?')) {
      const storeName = nextParam();
      if (row.store_name !== storeName) return false;
    }
    if (sql.includes('marketplace_code = ?')) {
      const marketplaceCode = nextParam();
      if (row.marketplace_code !== marketplaceCode) return false;
    }
    if (sql.includes('upper(asin) = upper(?)')) {
      const asin = nextParam();
      if (String(row.asin).toUpperCase() !== String(asin).toUpperCase()) return false;
    }
    if (sql.includes('AND asin = ?')) {
      const asin = nextParam();
      if (row.asin !== asin) return false;
    }
    if (sql.includes('risk_level = ?')) {
      const riskLevel = nextParam();
      if (row.risk_level !== riskLevel) return false;
    }
    if (sql.includes('status = ?')) {
      const status = nextParam();
      if (row.status !== status) return false;
    }
    if (sql.includes('entity_id = ?')) {
      const entityId = nextParam();
      if (row.entity_id !== entityId) return false;
    }
    if (sql.includes('action_type = ?')) {
      const actionType = nextParam();
      if (row.action_type !== actionType) return false;
    }
    if (sql.includes("COALESCE(NULLIF(json_extract(evidence_json, '$.date'), ''), '') = ?")) {
      const evidenceDate = nextParam();
      if (String(evidence.date || '') !== String(evidenceDate || '')) return false;
    }
    if (sql.includes('recommendation_date_end')) {
      const dateFrom = nextParam();
      if (evidenceDateEnd(evidence.date, row.created_at) < String(dateFrom)) return false;
    }
    if (sql.includes('recommendation_date_start')) {
      const dateTo = nextParam();
      if (evidenceDateStart(evidence.date, row.created_at) > String(dateTo)) return false;
    }
    if (sql.includes("status IN ('pending', 'needs_review', 'approved', 'rejected', 'executed')")) {
      if (!['pending', 'needs_review', 'approved', 'rejected', 'executed'].includes(row.status)) return false;
    }
    return true;
  });
}

function evidenceDateStart(value: unknown, fallback: string) {
  const text = String(value || fallback || '').trim();
  return text.slice(0, 10);
}

function evidenceDateEnd(value: unknown, fallback: string) {
  const text = String(value || fallback || '').trim();
  return text.length >= 10 ? text.slice(-10) : text.slice(0, 10);
}

function recommendation(overrides: Partial<ActionRecommendation> = {}): Omit<ActionRecommendation, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    taskId: 'task_1',
    storeName: 'FT-US-US',
    marketplaceCode: 'US',
    asin: 'B0TESTASIN',
    msku: 'MSKU-1',
    entityType: 'search_term',
    entityId: 'search_term_1',
    entityName: 'door lock',
    actionType: 'lower_bid',
    currentValue: '1.20',
    recommendedValue: '1.08',
    reason: 'ACOS too high',
    evidence: {
      impressions: 1000,
      clicks: 40,
      cost: 52,
      orders: 1,
      sales: 80,
      acos: 0.65,
      cpc: 1.3,
      cvr: 0.025,
      date: '2026-06-12',
      campaignName: 'SP exact',
      adGroupName: 'Main',
      searchTerm: 'door lock',
      batchId: 'batch_1',
      sourceFiles: ['C:/reports/user-search-term.xlsx'],
      sourceRow: 12,
      currency: 'USD',
    },
    confidence: 0.82,
    riskLevel: 'APPROVAL',
    status: 'pending',
    ...overrides,
  };
}

describe('RecommendationRepository', () => {
  it('atomically moves a pending recommendation to approved and merges decision evidence', () => {
    const { repo } = createRepo();
    const id = repo.insert(recommendation());

    const updated = repo.updateStatusWithEvidenceIfCurrent(id, 'pending', 0, 'approved', {
      approvalDecision: {
        approvedBy: 'Alice',
        decision: 'approved',
      },
    });

    expect(updated).toBe(true);
    expect(repo.findById(id)).toMatchObject({
      status: 'approved',
      revision: 1,
      evidence: {
        cost: 52,
        sourceRow: 12,
        approvalDecision: {
          approvedBy: 'Alice',
          decision: 'approved',
        },
      },
    });
  });

  it('does not overwrite a completed decision or its evidence when a stale writer loses the CAS', () => {
    const { repo } = createRepo();
    const id = repo.insert(recommendation());

    expect(repo.updateStatusWithEvidenceIfCurrent(id, 'pending', 0, 'approved', {
      approvalDecision: {
        approvedBy: 'Alice',
        note: 'Approved from the first decision window.',
        decision: 'approved',
      },
    })).toBe(true);

    expect(repo.updateStatusWithEvidenceIfCurrent(id, 'pending', 0, 'rejected', {
      approvalDecision: {
        rejectedBy: 'Bob',
        note: 'Stale rejection must not win.',
        decision: 'rejected',
      },
    })).toBe(false);
    expect(repo.findById(id)).toMatchObject({
      status: 'approved',
      revision: 1,
      evidence: {
        approvalDecision: {
          approvedBy: 'Alice',
          note: 'Approved from the first decision window.',
          decision: 'approved',
        },
      },
    });
  });

  it('advances revision for every legacy status mutation path', () => {
    const { repo } = createRepo();
    const id = repo.insert(recommendation());

    repo.updateStatus(id, 'approved');
    expect(repo.findById(id)).toMatchObject({ status: 'approved', revision: 1 });

    repo.updateStatusWithEvidence(id, 'executed', { executionTrace: 'trace-1' });
    expect(repo.findById(id)).toMatchObject({
      status: 'executed',
      revision: 2,
      evidence: {
        cost: 52,
        executionTrace: 'trace-1',
      },
    });
  });

  it('filters recommendations by ASIN without case-sensitive misses', () => {
    const { repo } = createRepo();

    repo.insert(recommendation({ asin: 'B0TESTASIN' }));

    const result = repo.findByFilter({
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      asin: 'b0testasin',
    });

    expect(result.total).toBe(1);
    expect(result.items[0].asin).toBe('B0TESTASIN');
  });

  it('includes recommendations whose evidence date range overlaps the requested date range', () => {
    const { repo } = createRepo();

    repo.insert(recommendation({
      evidence: {
        ...recommendation().evidence,
        date: '2026-06-01 ~ 2026-06-11',
      },
    }));

    const result = repo.findByFilter({
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      dateFrom: '2026-06-01',
      dateTo: '2026-06-12',
    });

    expect(result.total).toBe(1);
    expect(result.items[0].evidence.date).toBe('2026-06-01 ~ 2026-06-11');
  });

  it('refreshes an incomplete pending duplicate when regenerated evidence is executable and traceable', () => {
    const { repo } = createRepo();
    const staleId = repo.insert(recommendation({
      currentValue: '1.54',
      recommendedValue: '',
      status: 'needs_review',
      evidence: {
        ...recommendation().evidence,
        sourceFiles: ['C:/reports/campaign.xlsx', 'C:/reports/search-term.xlsx'],
        sourceRow: undefined,
      },
    }));

    const result = repo.insertIfNoDuplicate(recommendation({
      taskId: 'task_refreshed',
      currentValue: '1.54',
      recommendedValue: '1.39',
      reason: 'Regenerated with source row and executable value',
      status: 'pending',
      evidence: {
        ...recommendation().evidence,
        sourceFiles: ['C:/reports/auto-targeting.xlsx'],
        sourceRow: 12,
      },
    }));

    expect(result).toEqual({ id: staleId, inserted: false, updated: true });
    const refreshed = repo.findById(staleId);
    expect(refreshed?.taskId).toBe('task_refreshed');
    expect(refreshed?.recommendedValue).toBe('1.39');
    expect(refreshed?.status).toBe('pending');
    expect(refreshed?.evidence.sourceFiles).toEqual(['C:/reports/auto-targeting.xlsx']);
    expect(refreshed?.evidence.sourceRow).toBe(12);
  });

  it('does not overwrite approved duplicates even when the incoming recommendation is more complete', () => {
    const { repo } = createRepo();
    const approvedId = repo.insert(recommendation({
      taskId: 'task_approved',
      currentValue: '1.54',
      recommendedValue: '',
      status: 'approved',
      evidence: {
        ...recommendation().evidence,
        sourceFiles: [],
        sourceRow: undefined,
      },
    }));

    const result = repo.insertIfNoDuplicate(recommendation({
      taskId: 'task_new',
      currentValue: '1.54',
      recommendedValue: '1.39',
      status: 'pending',
      evidence: {
        ...recommendation().evidence,
        sourceFiles: ['C:/reports/auto-targeting.xlsx'],
        sourceRow: 12,
      },
    }));

    expect(result).toEqual({ id: approvedId, inserted: false });
    const preserved = repo.findById(approvedId);
    expect(preserved?.taskId).toBe('task_approved');
    expect(preserved?.recommendedValue).toBe('');
    expect(preserved?.status).toBe('approved');
  });

  it('does not overwrite a reviewed pending duplicate or its immutable review audit', () => {
    const { repo } = createRepo();
    const id = repo.insert(recommendation({ status: 'needs_review' }));
    const writableTarget = {
      entityType: 'keyword' as const,
      entityId: 'amzn-keyword-opaque-123',
      entityName: 'door lock',
      campaignName: 'SP exact',
      adGroupName: 'Main',
      metricDate: '2026-06-12',
      sourceFile: 'C:/reports/keyword.xlsx',
      sourceRow: 12,
      identitySource: 'ads_ui' as const,
      verifiedBy: 'Alice',
      verifiedAt: '2026-07-16T03:00:00.000Z',
      verificationNote: 'Matched the editable keyword row.',
      identityProofPath: 'C:/evidence/keyword-identity.png',
    };
    expect(repo.updateStatusWithEvidenceIfCurrent(id, 'needs_review', 0, 'pending', {
      writableTarget,
      reviewResolution: {
        schemaVersion: 1,
        fromStatus: 'needs_review',
        fromRevision: 0,
        resolvedRevision: 1,
        reviewedBy: 'Alice',
        reviewedAt: '2026-07-16T03:00:00.000Z',
        rationale: 'Reviewed current quant evidence.',
        resolvedBlockers: ['quant_review_required'],
        scope: {
          dateFrom: '2026-06-01',
          dateTo: '2026-06-12',
          storeName: 'FT-US-US',
          marketplaceCode: 'US',
          asin: 'B0TESTASIN',
          batchId: 'batch_1',
        },
        metricSource: {
          batchId: 'batch_1',
          sourceFiles: ['C:/reports/user-search-term.xlsx'],
          sourceRow: 12,
        },
        writableTarget,
      },
    })).toBe(true);

    const result = repo.insertIfNoDuplicate(recommendation({
      taskId: 'task_should_not_replace_review',
      evidence: {
        ...recommendation().evidence,
        explanationSource: 'ai',
        aiExplanation: 'New explanation must not erase the completed review.',
      },
    }));

    expect(result).toEqual({ id, inserted: false });
    expect(repo.findById(id)).toMatchObject({
      status: 'pending',
      revision: 1,
      evidence: {
        reviewResolution: {
          reviewedBy: 'Alice',
          resolvedRevision: 1,
        },
      },
    });
  });

  it.each(['approved', 'rejected', 'executed', 'expired'] as const)(
    'does not let duplicate refresh write an incoming %s terminal status',
    (incomingStatus) => {
      const { repo } = createRepo();
      const pendingId = repo.insert(recommendation({
        taskId: 'task_pending',
        recommendedValue: '',
        status: 'pending',
        evidence: {
          ...recommendation().evidence,
          sourceFiles: [],
          sourceRow: undefined,
        },
      }));

      const result = repo.insertIfNoDuplicate(recommendation({
        taskId: `task_illegal_${incomingStatus}`,
        recommendedValue: '1.08',
        status: incomingStatus,
      }));

      expect(result).toEqual({ id: pendingId, inserted: false });
      expect(repo.findById(pendingId)).toMatchObject({
        taskId: 'task_pending',
        recommendedValue: '',
        status: 'pending',
        revision: 0,
      });
    },
  );

  it('rejects a stale decision after a same-status duplicate refresh changes recommendation content', () => {
    const { repo } = createRepo();
    const id = repo.insert(recommendation({
      taskId: 'task_before_refresh',
      recommendedValue: '',
      status: 'pending',
      evidence: {
        ...recommendation().evidence,
        sourceFiles: [],
        sourceRow: undefined,
      },
    }));
    const staleDecisionRevision = repo.findById(id)?.revision ?? 0;

    expect(repo.insertIfNoDuplicate(recommendation({
      taskId: 'task_after_refresh',
      recommendedValue: '1.08',
      status: 'pending',
    }))).toEqual({ id, inserted: false, updated: true });

    expect(repo.updateStatusWithEvidenceIfCurrent(id, 'pending', staleDecisionRevision, 'approved', {
      approvalDecision: {
        approvedBy: 'Alice',
        decision: 'approved',
      },
    })).toBe(false);
    expect(repo.findById(id)).toMatchObject({
      taskId: 'task_after_refresh',
      recommendedValue: '1.08',
      status: 'pending',
      revision: 1,
    });
    expect(repo.findById(id)).not.toMatchObject({
      evidence: {
        approvalDecision: expect.anything(),
      },
    });
  });

  it('does not report or apply a duplicate refresh when a concurrent decision wins first', () => {
    const { repo, simulateDecisionBeforeNextDuplicateUpdate } = createRepo();
    const staleId = repo.insert(recommendation({
      taskId: 'task_stale',
      recommendedValue: '',
      status: 'pending',
      evidence: {
        ...recommendation().evidence,
        sourceFiles: [],
        sourceRow: undefined,
      },
    }));
    simulateDecisionBeforeNextDuplicateUpdate(staleId, 'approved', {
      approvalDecision: {
        approvedBy: 'Alice',
        decision: 'approved',
      },
    });

    const result = repo.insertIfNoDuplicate(recommendation({
      taskId: 'task_refresh_that_lost',
      recommendedValue: '1.08',
      status: 'pending',
    }));

    expect(result).toEqual({ id: staleId, inserted: false });
    expect(repo.findById(staleId)).toMatchObject({
      taskId: 'task_stale',
      recommendedValue: '',
      status: 'approved',
      evidence: {
        approvalDecision: {
          approvedBy: 'Alice',
          decision: 'approved',
        },
      },
    });
  });

  it('refreshes a traceable pending duplicate when regenerated AI evidence is better', () => {
    const { repo } = createRepo();
    const staleId = repo.insert(recommendation({
      status: 'needs_review',
      evidence: {
        ...recommendation().evidence,
        explanationSource: 'rule',
        aiFallbackReason: 'AI 响应无法解析为标准 JSON',
        aiActionFallbackReason: 'AI 响应无法解析为标准 JSON',
      },
    }));

    const result = repo.insertIfNoDuplicate(recommendation({
      taskId: 'task_ai_refreshed',
      status: 'needs_review',
      reason: 'AI 已提供结构化解释',
      evidence: {
        ...recommendation().evidence,
        explanationSource: 'ai',
        aiExplanation: '结构化中文解释。',
        aiRiskWarnings: ['继续观察。'],
        aiFallbackReason: undefined,
        aiActionFallbackReason: undefined,
        aiStrategyFallbackReason: 'AI 策略诊断回退规则，但动作解释成功。',
        aiStrategySource: 'ai',
      },
    }));

    expect(result).toEqual({ id: staleId, inserted: false, updated: true });
    const refreshed = repo.findById(staleId);
    expect(refreshed?.taskId).toBe('task_ai_refreshed');
    expect(refreshed?.reason).toBe('AI 已提供结构化解释');
    expect(refreshed?.evidence.explanationSource).toBe('ai');
    expect(refreshed?.evidence.aiFallbackReason).toBeUndefined();
    expect(refreshed?.evidence.aiActionFallbackReason).toBeUndefined();
  });
});

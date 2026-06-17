import { describe, expect, it } from 'vitest';
import type { ActionRecommendation } from '@amazon-ai-ops/shared-types';
import { RecommendationRepository } from './recommendation-repo';

function createRepo() {
  const rows: any[] = [];
  const db = {
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
            const index = rows.findIndex((row) => row.id === input.id);
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
                updated_at: '2026-06-17 10:01:00',
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
  return { repo: new RecommendationRepository(db as any) };
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

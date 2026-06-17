import { describe, expect, it } from 'vitest';
import { AiDiagnosisRunRepository } from './ai-diagnosis-run-repo';

function createRepo() {
  const rows: any[] = [];
  const db = {
    prepare(sql: string) {
      if (sql.includes('INSERT INTO ai_diagnosis_runs')) {
        return {
          run(input: any) {
            rows.push({
              id: rows.length + 1,
              prompt_key: input.promptKey,
              prompt_version: input.promptVersion,
              model: input.model,
              scope_json: input.scopeJson,
              evidence_pack_summary_json: input.evidencePackSummaryJson,
              evidence_pack_preview_json: input.evidencePackPreviewJson,
              diagnosis_json: input.diagnosisJson,
              insights_json: input.insightsJson,
              formal_recommendation_count: input.formalRecommendationCount,
              success: input.success,
              error_message: input.errorMessage,
              created_at: '2026-06-16 12:00:00',
            });
            return { lastInsertRowid: rows.length };
          },
        };
      }
      if (sql.includes('SELECT *')) {
        return {
          all(params: number | Record<string, any>) {
            const limit = typeof params === 'number' ? params : params.limit;
            let nextRows = rows.slice();
            if (typeof params === 'object') {
              nextRows = nextRows.filter((row) => {
                const scope = JSON.parse(row.scope_json || '{}');
                for (const key of ['dateFrom', 'dateTo', 'storeName', 'marketplaceCode', 'asin', 'batchId']) {
                  if (params[key] && scope[key] !== params[key]) return false;
                }
                return true;
              });
            }
            return nextRows.reverse().slice(0, limit);
          },
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  return { repo: new AiDiagnosisRunRepository(db as any), rows };
}

describe('AiDiagnosisRunRepository', () => {
  it('records diagnosis run scope, evidence summary, diagnosis, insights and formal count', () => {
    const { repo } = createRepo();

    repo.insert({
      promptKey: 'ad_strategy_diagnosis',
      promptVersion: 'ad_strategy_diagnosis_v1',
      model: 'deepseek-chat',
      scope: {
        dateFrom: '2026-06-01',
        dateTo: '2026-06-12',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        batchId: 'batch_1',
      },
      evidencePackSummary: { total: 4, metric: 1, operationEvent: 1, productContext: 1, ruleCandidate: 1 },
      diagnosis: {
        schemaVersion: 'ad_strategy_diagnosis_v1',
        lifecycleStage: 'keyword_exploration',
        summary: 'AI 诊断摘要',
      },
      insights: [{
        entityType: 'search_term',
        entityName: 'unbound term',
        actionType: 'observe',
        invalidReasons: ['无法绑定真实广告对象'],
      }],
      evidencePackPreview: [{
        evidenceId: 'metric:batch_1:user_search_term:2026-06-12:search_term:abc',
        type: 'metric',
        label: 'search_term test search term / 2026-06-12',
        dateRange: '2026-06-12~2026-06-12',
        batchId: 'batch_1',
        reportType: 'user_search_term',
        sourceFile: 'C:/reports/user_search_term.xlsx',
        sourceRow: 12,
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        entityType: 'search_term',
        entityName: 'test search term',
        metrics: {
          cost: 170.25,
          sales: 300.5,
          orders: 3,
          clicks: 88,
          currency: 'USD',
        },
      }],
      formalRecommendationCount: 1,
      success: true,
    });

    const [record] = repo.findRecent();
    expect(record).toMatchObject({
      promptKey: 'ad_strategy_diagnosis',
      promptVersion: 'ad_strategy_diagnosis_v1',
      model: 'deepseek-chat',
      formalRecommendationCount: 1,
    });
    expect(record.scope).toMatchObject({ storeName: 'FT-US-US', batchId: 'batch_1' });
    expect(record.evidencePackSummary).toMatchObject({ total: 4, metric: 1 });
    expect(record.diagnosis).toMatchObject({ lifecycleStage: 'keyword_exploration' });
    expect(record.insights[0]).toMatchObject({
      entityName: 'unbound term',
      invalidReasons: ['无法绑定真实广告对象'],
    });
    expect(record.evidencePackPreview?.[0]).toMatchObject({
      evidenceId: 'metric:batch_1:user_search_term:2026-06-12:search_term:abc',
      sourceFile: 'C:/reports/user_search_term.xlsx',
      sourceRow: 12,
      metrics: {
        cost: 170.25,
        sales: 300.5,
        orders: 3,
        clicks: 88,
        currency: 'USD',
      },
    });
    expect(record.success).toBe(true);
  });

  it('records fallback diagnosis runs as failed with a recoverable error message', () => {
    const { repo, rows } = createRepo();

    repo.insert({
      promptKey: 'ad_strategy_diagnosis',
      promptVersion: 'ad_strategy_diagnosis_v1',
      model: 'deepseek-chat',
      scope: {
        dateFrom: '2026-06-01',
        dateTo: '2026-06-12',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        batchId: 'batch_1',
      },
      evidencePackSummary: { total: 2, metric: 1 },
      diagnosis: {
        schemaVersion: 'ad_strategy_diagnosis_v1',
        source: 'rule',
        lifecycleStage: 'unknown',
        summary: 'AI 诊断不可用，当前使用规则引擎兜底。',
        aiFallbackReason: 'AI 输出 schemaVersion 错误：legacy_strategy_v0',
      },
      insights: [],
      formalRecommendationCount: 0,
      success: false,
      errorMessage: 'AI 输出 schemaVersion 错误：legacy_strategy_v0',
    });

    const [record] = repo.findRecent();
    expect(record.success).toBe(false);
    expect(record.errorMessage).toBe('AI 输出 schemaVersion 错误：legacy_strategy_v0');
    expect(rows[0].success).toBe(0);
    expect(rows[0].error_message).toBe('AI 输出 schemaVersion 错误：legacy_strategy_v0');
  });

  it('redacts bearer headers and api key fields from diagnosis run snapshots', () => {
    const { repo, rows } = createRepo();

    repo.insert({
      promptKey: 'ad_strategy_diagnosis',
      promptVersion: 'ad_strategy_diagnosis_v1',
      model: 'deepseek-chat',
      scope: {
        dateFrom: '2026-06-01',
        dateTo: '2026-06-12',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        authorization: 'Bearer diagnosis-live-token-123456789',
      },
      evidencePackSummary: {
        deepseek_api_key: 'sk-diagnosis-live-123456789',
      },
      evidencePackPreview: [{
        evidenceId: 'metric_1',
        type: 'metric',
        apiKey: 'plain-diagnosis-api-key',
      }],
      diagnosis: {
        schemaVersion: 'ad_strategy_diagnosis_v1',
        summary: 'AI 诊断摘要',
        providerEcho: { Authorization: 'Bearer diagnosis-live-token-123456789' },
      },
      insights: [{
        reason: 'DEEPSEEK_API_KEY=sk-diagnosis-live-123456789',
        api_key: 'plain-diagnosis-api-key',
      }],
      formalRecommendationCount: 0,
      success: false,
      errorMessage: 'Authorization: Bearer diagnosis-live-token-123456789; api_key=plain-diagnosis-api-key',
    });

    const [record] = repo.findRecent();
    const persisted = JSON.stringify({
      rows,
      record,
    });

    expect(persisted).not.toContain('diagnosis-live-token-123456789');
    expect(persisted).not.toContain('sk-diagnosis-live-123456789');
    expect(persisted).not.toContain('plain-diagnosis-api-key');
    expect(persisted).toContain('[redacted]');
  });

  it('filters recent diagnosis runs to the current operation scope', () => {
    const { repo } = createRepo();
    const baseInput = {
      promptKey: 'ad_strategy_diagnosis',
      promptVersion: 'ad_strategy_diagnosis_v1',
      model: 'deepseek-chat',
      evidencePackSummary: { total: 1 },
      diagnosis: { lifecycleStage: 'keyword_exploration' },
      insights: [],
      formalRecommendationCount: 0,
      success: true,
    };

    repo.insert({
      ...baseInput,
      scope: {
        dateFrom: '2026-06-01',
        dateTo: '2026-06-12',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        batchId: 'current_batch',
      },
      formalRecommendationCount: 2,
    });
    repo.insert({
      ...baseInput,
      scope: {
        dateFrom: '2026-06-01',
        dateTo: '2026-06-12',
        storeName: 'OTHER',
        marketplaceCode: 'US',
        batchId: 'other_batch',
      },
      formalRecommendationCount: 99,
    });

    const records = repo.findRecent({
      dateFrom: '2026-06-01',
      dateTo: '2026-06-12',
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      batchId: 'current_batch',
      limit: 5,
    });

    expect(records).toHaveLength(1);
    expect(records[0].scope).toMatchObject({ storeName: 'FT-US-US', batchId: 'current_batch' });
    expect(records[0].formalRecommendationCount).toBe(2);
  });

  it('filters recent diagnosis runs by ASIN when current scope is product-specific', () => {
    const { repo } = createRepo();
    const baseInput = {
      promptKey: 'ad_strategy_diagnosis',
      promptVersion: 'ad_strategy_diagnosis_v1',
      model: 'deepseek-chat',
      evidencePackSummary: { total: 1 },
      diagnosis: { lifecycleStage: 'keyword_exploration' },
      insights: [],
      formalRecommendationCount: 0,
      success: true,
    };

    repo.insert({
      ...baseInput,
      scope: {
        dateFrom: '2026-06-01',
        dateTo: '2026-06-12',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        asin: 'B0AAA',
        batchId: 'current_batch',
      },
      formalRecommendationCount: 1,
    });
    repo.insert({
      ...baseInput,
      scope: {
        dateFrom: '2026-06-01',
        dateTo: '2026-06-12',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        asin: 'B0BBB',
        batchId: 'current_batch',
      },
      formalRecommendationCount: 9,
    });

    const records = repo.findRecent({
      dateFrom: '2026-06-01',
      dateTo: '2026-06-12',
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      asin: 'B0AAA',
      batchId: 'current_batch',
      limit: 5,
    });

    expect(records).toHaveLength(1);
    expect(records[0].scope).toMatchObject({ asin: 'B0AAA' });
    expect(records[0].formalRecommendationCount).toBe(1);
  });
});

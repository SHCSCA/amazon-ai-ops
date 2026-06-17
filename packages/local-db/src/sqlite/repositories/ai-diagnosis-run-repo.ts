import type { Database } from 'better-sqlite3';
import { redactSecrets } from './secret-redaction';

export interface AiDiagnosisRunInput {
  promptKey: string;
  promptVersion: string;
  model: string;
  scope: Record<string, unknown>;
  evidencePackSummary: unknown;
  evidencePackPreview?: unknown[];
  diagnosis: unknown;
  insights: unknown[];
  formalRecommendationCount: number;
  success: boolean;
  errorMessage?: string;
}

export interface AiDiagnosisRunRecord extends AiDiagnosisRunInput {
  id: number;
  createdAt: string;
}

export interface AiDiagnosisRunFilter {
  limit?: number;
  dateFrom?: string;
  dateTo?: string;
  storeName?: string;
  marketplaceCode?: string;
  asin?: string;
  batchId?: string;
}

export class AiDiagnosisRunRepository {
  constructor(private db: Database) {}

  insert(input: AiDiagnosisRunInput): number {
    const result = this.db.prepare(`
      INSERT INTO ai_diagnosis_runs (
        prompt_key,
        prompt_version,
        model,
        scope_json,
        evidence_pack_summary_json,
        evidence_pack_preview_json,
        diagnosis_json,
        insights_json,
        formal_recommendation_count,
        success,
        error_message
      ) VALUES (
        @promptKey,
        @promptVersion,
        @model,
        @scopeJson,
        @evidencePackSummaryJson,
        @evidencePackPreviewJson,
        @diagnosisJson,
        @insightsJson,
        @formalRecommendationCount,
        @success,
        @errorMessage
      )
    `).run({
      promptKey: input.promptKey,
      promptVersion: input.promptVersion,
      model: input.model,
      scopeJson: redactSecrets(JSON.stringify(input.scope)),
      evidencePackSummaryJson: redactSecrets(JSON.stringify(input.evidencePackSummary || null)),
      evidencePackPreviewJson: redactSecrets(JSON.stringify(input.evidencePackPreview || [])),
      diagnosisJson: redactSecrets(JSON.stringify(input.diagnosis || null)),
      insightsJson: redactSecrets(JSON.stringify(input.insights || [])),
      formalRecommendationCount: input.formalRecommendationCount,
      success: input.success ? 1 : 0,
      errorMessage: input.errorMessage ? redactSecrets(input.errorMessage) : null,
    });
    return Number(result.lastInsertRowid);
  }

  findRecent(filterOrLimit: AiDiagnosisRunFilter | number = 20): AiDiagnosisRunRecord[] {
    const filter = typeof filterOrLimit === 'number' ? { limit: filterOrLimit } : filterOrLimit;
    const limit = Math.max(1, Math.min(100, Number(filter.limit || 20)));
    const predicates: string[] = [];
    const params: Record<string, unknown> = { limit };
    if (filter.dateFrom) {
      predicates.push("json_extract(scope_json, '$.dateFrom') = @dateFrom");
      params.dateFrom = filter.dateFrom;
    }
    if (filter.dateTo) {
      predicates.push("json_extract(scope_json, '$.dateTo') = @dateTo");
      params.dateTo = filter.dateTo;
    }
    if (filter.storeName) {
      predicates.push("json_extract(scope_json, '$.storeName') = @storeName");
      params.storeName = filter.storeName;
    }
    if (filter.marketplaceCode) {
      predicates.push("json_extract(scope_json, '$.marketplaceCode') = @marketplaceCode");
      params.marketplaceCode = filter.marketplaceCode;
    }
    if (filter.asin) {
      predicates.push("json_extract(scope_json, '$.asin') = @asin");
      params.asin = filter.asin;
    }
    if (filter.batchId) {
      predicates.push("json_extract(scope_json, '$.batchId') = @batchId");
      params.batchId = filter.batchId;
    }
    const whereClause = predicates.length ? `WHERE ${predicates.join(' AND ')}` : '';
    const rows = this.db.prepare(`
      SELECT *
      FROM ai_diagnosis_runs
      ${whereClause}
      ORDER BY created_at DESC, id DESC
      LIMIT @limit
    `).all(params) as any[];

    return rows.map((row) => ({
      id: row.id,
      promptKey: row.prompt_key,
      promptVersion: row.prompt_version,
      model: row.model,
      scope: parseJson(row.scope_json, {}),
      evidencePackSummary: parseJson(row.evidence_pack_summary_json, null),
      evidencePackPreview: parseJson(row.evidence_pack_preview_json, []),
      diagnosis: parseJson(row.diagnosis_json, null),
      insights: parseJson(row.insights_json, []),
      formalRecommendationCount: Number(row.formal_recommendation_count || 0),
      success: row.success === undefined || row.success === null ? true : Boolean(row.success),
      errorMessage: row.error_message || undefined,
      createdAt: row.created_at,
    }));
  }
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

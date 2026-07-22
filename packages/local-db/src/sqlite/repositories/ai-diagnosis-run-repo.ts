import type { Database } from 'better-sqlite3';
import { normalizeStoreId, type StoreId } from '@amazon-ai-ops/shared-types';
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

export interface StoreScopedAiDiagnosisRunRecord extends AiDiagnosisRunRecord {
  storeId: StoreId;
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

  /** @deprecated Legacy unscoped write. Stage 2 must use insertForStore. */
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

  insertForStore(storeId: StoreId, input: AiDiagnosisRunInput): number {
    const scope = this.normalizeStoreScope(storeId, input.scope);
    const result = this.db.prepare(`
      INSERT INTO ai_diagnosis_runs (
        store_id,
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
        @storeId,
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
      storeId,
      promptKey: input.promptKey,
      promptVersion: input.promptVersion,
      model: input.model,
      scopeJson: redactSecrets(JSON.stringify(scope)),
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

  /** @deprecated Legacy unscoped read. Stage 2 must use findRecentForStore. */
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

    return rows.map((row) => this.mapRow(row));
  }

  findRecentForStore(
    storeId: StoreId,
    filterOrLimit: Omit<AiDiagnosisRunFilter, 'storeName'> | number = 20,
  ): StoreScopedAiDiagnosisRunRecord[] {
    const filter = typeof filterOrLimit === 'number' ? { limit: filterOrLimit } : filterOrLimit;
    const limit = Math.max(1, Math.min(100, Number(filter.limit || 20)));
    const predicates: string[] = ['store_id = @storeId'];
    const params: Record<string, unknown> = { storeId, limit };
    if (filter.dateFrom) {
      predicates.push("json_extract(scope_json, '$.dateFrom') = @dateFrom");
      params.dateFrom = filter.dateFrom;
    }
    if (filter.dateTo) {
      predicates.push("json_extract(scope_json, '$.dateTo') = @dateTo");
      params.dateTo = filter.dateTo;
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
    const rows = this.db.prepare(`
      SELECT * FROM ai_diagnosis_runs
      WHERE ${predicates.join(' AND ')}
      ORDER BY created_at DESC, id DESC
      LIMIT @limit
    `).all(params) as any[];
    return rows.map((row) => this.mapStoreScopedRow(row));
  }

  findByIdForStore(storeId: StoreId, id: number): StoreScopedAiDiagnosisRunRecord | undefined {
    const row = this.db.prepare(`
      SELECT * FROM ai_diagnosis_runs WHERE id = ? AND store_id = ?
    `).get(id, storeId) as any;
    return row ? this.mapStoreScopedRow(row) : undefined;
  }

  private mapRow(row: any): AiDiagnosisRunRecord {
    return {
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
    };
  }

  private mapStoreScopedRow(row: any): StoreScopedAiDiagnosisRunRecord {
    return {
      ...this.mapRow(row),
      storeId: row.store_id as StoreId,
    };
  }

  private normalizeStoreScope(
    storeId: StoreId,
    scope: Record<string, unknown>,
  ): Record<string, unknown> {
    const authority = this.db.prepare(`
      SELECT display_name AS displayName, marketplace, currency, status
      FROM stores
      WHERE store_id = ?
    `).get(storeId) as {
      displayName: string;
      marketplace: string;
      currency: string;
      status: string;
    } | undefined;
    if (!authority) throw new Error(`未知店铺 ${storeId}。`);
    if (authority.status !== 'active') {
      throw new Error(`店铺 ${storeId} 当前状态为 ${authority.status}，禁止写入。`);
    }
    const normalize = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
    if (
      (scope.storeId !== undefined && normalizeStoreId(scope.storeId) !== storeId)
      || (scope.storeName !== undefined && normalize(scope.storeName) !== normalize(authority.displayName))
      || (
        scope.marketplaceCode !== undefined
        && String(scope.marketplaceCode).trim().toUpperCase() !== authority.marketplace
      )
      || (scope.currency !== undefined && String(scope.currency).trim().toUpperCase() !== authority.currency)
    ) throw new Error(`诊断范围与 store_id ${storeId} 的权威记录不一致。`);
    if (scope.batchId !== undefined) {
      this.assertBatchOwnershipIfKnown(storeId, scope.batchId);
    }
    return {
      ...scope,
      storeId,
      storeName: authority.displayName,
      marketplaceCode: authority.marketplace,
      currency: authority.currency,
    };
  }

  private assertBatchOwnershipIfKnown(storeId: StoreId, batchIdInput: unknown): void {
    if (typeof batchIdInput !== 'string' || batchIdInput.trim() === '') {
      throw new Error('诊断范围中的 batchId 必须是非空批次 id。');
    }
    const batchId = batchIdInput.trim();
    const rows = this.db.prepare(`
      SELECT store_id AS storeId
      FROM lingxing_report_batches
      WHERE id = ?
    `).all(batchId) as Array<{ storeId?: string | null }>;
    if (rows.length > 0 && !rows.some((row) => row.storeId === storeId)) {
      throw new Error(`诊断批次 ${batchId} 不属于店铺 ${storeId}。`);
    }
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

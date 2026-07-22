import type { Database } from 'better-sqlite3';
import type { StoreId } from '@amazon-ai-ops/shared-types';
import { redactSecrets } from './secret-redaction';

export interface AiCallLogInput {
  promptKey: string;
  promptVersion: string;
  model: string;
  inputHash: string;
  outputJson: string;
  success: boolean;
  errorMessage?: string;
  schemaVersion?: string;
  evidencePackSummary?: unknown;
}

export interface AiCallLogRecord extends AiCallLogInput {
  id: number;
  createdAt: string;
}

export interface StoreScopedAiCallLogRecord extends AiCallLogRecord {
  storeId: StoreId;
}

export class AiCallLogRepository {
  constructor(private db: Database) {}

  /** @deprecated Legacy unscoped write. Stage 2 must use insertForStore. */
  insert(input: AiCallLogInput): number {
    const outputJson = redactSecrets(wrapOutput(input));
    const errorMessage = input.errorMessage ? redactSecrets(input.errorMessage) : undefined;
    const evidencePackSummaryJson = redactSecrets(JSON.stringify(input.evidencePackSummary || null));
    const result = this.db.prepare(`
      INSERT INTO ai_call_logs (
        prompt_key, prompt_version, model, input_hash, output_json, schema_version, evidence_pack_summary_json, success, error_message
      ) VALUES (
        @promptKey, @promptVersion, @model, @inputHash, @outputJson, @schemaVersion, @evidencePackSummaryJson, @success, @errorMessage
      )
    `).run({
      promptKey: input.promptKey,
      promptVersion: input.promptVersion,
      model: input.model,
      inputHash: input.inputHash,
      outputJson,
      schemaVersion: input.schemaVersion,
      evidencePackSummaryJson,
      success: input.success ? 1 : 0,
      errorMessage,
    });
    return Number(result.lastInsertRowid);
  }

  insertForStore(storeId: StoreId, input: AiCallLogInput): number {
    this.assertStoreWritable(storeId);
    const outputJson = redactSecrets(wrapOutput(input));
    const errorMessage = input.errorMessage ? redactSecrets(input.errorMessage) : undefined;
    const evidencePackSummaryJson = redactSecrets(JSON.stringify(input.evidencePackSummary || null));
    const result = this.db.prepare(`
      INSERT INTO ai_call_logs (
        store_id, prompt_key, prompt_version, model, input_hash, output_json,
        schema_version, evidence_pack_summary_json, success, error_message
      ) VALUES (
        @storeId, @promptKey, @promptVersion, @model, @inputHash, @outputJson,
        @schemaVersion, @evidencePackSummaryJson, @success, @errorMessage
      )
    `).run({
      storeId,
      promptKey: input.promptKey,
      promptVersion: input.promptVersion,
      model: input.model,
      inputHash: input.inputHash,
      outputJson,
      schemaVersion: input.schemaVersion,
      evidencePackSummaryJson,
      success: input.success ? 1 : 0,
      errorMessage,
    });
    return Number(result.lastInsertRowid);
  }

  /** @deprecated Legacy unscoped read. Stage 2 must use findRecentForStore. */
  findRecent(limit = 20): AiCallLogRecord[] {
    const rows = this.db.prepare(`
      SELECT *
      FROM ai_call_logs
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).all(limit) as any[];
    return rows.map((row) => this.mapRow(row));
  }

  findRecentForStore(storeId: StoreId, limit = 20): StoreScopedAiCallLogRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM ai_call_logs
      WHERE store_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).all(storeId, limit) as any[];
    return rows.map((row) => this.mapStoreScopedRow(row));
  }

  findByIdForStore(storeId: StoreId, id: number): StoreScopedAiCallLogRecord | undefined {
    const row = this.db.prepare(`
      SELECT * FROM ai_call_logs WHERE id = ? AND store_id = ?
    `).get(id, storeId) as any;
    return row ? this.mapStoreScopedRow(row) : undefined;
  }

  private mapRow(row: any): AiCallLogRecord {
    return {
      id: row.id,
      promptKey: row.prompt_key,
      promptVersion: row.prompt_version,
      model: row.model,
      inputHash: row.input_hash,
      outputJson: row.output_json,
      schemaVersion: row.schema_version || parseWrappedOutput(row.output_json).schemaVersion,
      evidencePackSummary: row.evidence_pack_summary_json
        ? parseJsonOrText(row.evidence_pack_summary_json)
        : parseWrappedOutput(row.output_json).evidencePackSummary,
      success: Boolean(row.success),
      errorMessage: row.error_message || undefined,
      createdAt: row.created_at,
    };
  }

  private mapStoreScopedRow(row: any): StoreScopedAiCallLogRecord {
    return {
      ...this.mapRow(row),
      storeId: row.store_id as StoreId,
    };
  }

  private assertStoreWritable(storeId: StoreId): void {
    const row = this.db.prepare(`
      SELECT status FROM stores WHERE store_id = ?
    `).get(storeId) as { status: string } | undefined;
    if (!row) throw new Error(`未知店铺 ${storeId}。`);
    if (row.status !== 'active') throw new Error(`店铺 ${storeId} 当前状态为 ${row.status}，禁止写入。`);
  }
}

function parseWrappedOutput(value: string): { schemaVersion?: string; evidencePackSummary?: unknown } {
  const parsed = parseJsonOrText(value);
  if (!parsed || typeof parsed !== 'object') return {};
  const record = parsed as Record<string, unknown>;
  return {
    schemaVersion: typeof record.schemaVersion === 'string' ? record.schemaVersion : undefined,
    evidencePackSummary: record.evidencePackSummary,
  };
}

function wrapOutput(input: AiCallLogInput): string {
  const rawOutput = parseJsonOrText(input.outputJson);
  return JSON.stringify({
    schemaVersion: input.schemaVersion,
    evidencePackSummary: input.evidencePackSummary,
    output: rawOutput,
  });
}

function parseJsonOrText(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

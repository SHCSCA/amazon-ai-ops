import type { Database } from 'better-sqlite3';
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

export class AiCallLogRepository {
  constructor(private db: Database) {}

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

  findRecent(limit = 20): AiCallLogRecord[] {
    const rows = this.db.prepare(`
      SELECT *
      FROM ai_call_logs
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).all(limit) as any[];
    return rows.map((row) => ({
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
    }));
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

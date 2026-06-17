import { describe, expect, it } from 'vitest';
import { AiCallLogRepository } from './ai-call-log-repo';

function createRepo() {
  const rows: any[] = [];
  const db = {
    prepare(sql: string) {
      if (sql.includes('INSERT INTO ai_call_logs')) {
        return {
          run(input: any) {
            rows.push({
              id: rows.length + 1,
              prompt_key: input.promptKey,
              prompt_version: input.promptVersion,
              model: input.model,
              input_hash: input.inputHash,
              output_json: input.outputJson,
              schema_version: input.schemaVersion,
              evidence_pack_summary_json: input.evidencePackSummaryJson,
              success: input.success,
              error_message: input.errorMessage,
              created_at: '2026-06-16 10:00:00',
            });
            return { lastInsertRowid: rows.length };
          },
        };
      }
      if (sql.includes('SELECT *')) {
        return {
          all(limit: number) {
            return rows.slice().reverse().slice(0, limit);
          },
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  return { rows, repo: new AiCallLogRepository(db as any) };
}

describe('AiCallLogRepository', () => {
  it('records successful AI calls with schema version and evidence pack summary', () => {
    const { repo, rows } = createRepo();

    repo.insert({
      promptKey: 'ad_strategy_diagnosis',
      promptVersion: 'ad_strategy_diagnosis_v1',
      model: 'deepseek-chat',
      inputHash: 'hash_1',
      outputJson: JSON.stringify({ schemaVersion: 'ad_strategy_diagnosis_v1', summary: 'ok' }),
      success: true,
      schemaVersion: 'ad_strategy_diagnosis_v1',
      evidencePackSummary: { total: 3, metric: 1 },
    });

    const [record] = repo.findRecent();
    expect(record).toMatchObject({
      promptKey: 'ad_strategy_diagnosis',
      promptVersion: 'ad_strategy_diagnosis_v1',
      model: 'deepseek-chat',
      inputHash: 'hash_1',
      schemaVersion: 'ad_strategy_diagnosis_v1',
      evidencePackSummary: { total: 3, metric: 1 },
      success: true,
    });
    expect(rows[0].schema_version).toBe('ad_strategy_diagnosis_v1');
    expect(JSON.parse(rows[0].evidence_pack_summary_json)).toMatchObject({ total: 3, metric: 1 });
    expect(JSON.parse(record.outputJson)).toMatchObject({
      schemaVersion: 'ad_strategy_diagnosis_v1',
      evidencePackSummary: { total: 3, metric: 1 },
      output: { summary: 'ok' },
    });
  });

  it('records failed JSON parse or provider errors', () => {
    const { repo } = createRepo();

    repo.insert({
      promptKey: 'ad_strategy_diagnosis',
      promptVersion: 'ad_strategy_diagnosis_v1',
      model: 'deepseek-chat',
      inputHash: 'hash_2',
      outputJson: 'not json',
      success: false,
      errorMessage: 'AI response was not valid JSON',
    });

    const [record] = repo.findRecent();
    expect(record.success).toBe(false);
    expect(record.errorMessage).toBe('AI response was not valid JSON');
    expect(JSON.parse(record.outputJson).output).toBe('not json');
  });

  it('redacts sk-style secrets from output, errors, and evidence summaries', () => {
    const { repo, rows } = createRepo();

    repo.insert({
      promptKey: 'ad_strategy_diagnosis',
      promptVersion: 'ad_strategy_diagnosis_v1',
      model: 'deepseek-chat',
      inputHash: 'hash_3',
      outputJson: JSON.stringify({ leaked: 'sk-1234567890abcdef' }),
      success: false,
      errorMessage: 'provider rejected sk-1234567890abcdef',
      evidencePackSummary: { diagnostic: 'sk-1234567890abcdef' },
    });

    const [record] = repo.findRecent();
    expect(record.outputJson).not.toContain('sk-1234567890abcdef');
    expect(record.outputJson).toContain('sk-***REDACTED***');
    expect(record.errorMessage).not.toContain('sk-1234567890abcdef');
    expect(record.errorMessage).toContain('sk-***REDACTED***');
    expect(rows[0].evidence_pack_summary_json).not.toContain('sk-1234567890abcdef');
    expect(rows[0].evidence_pack_summary_json).toContain('sk-***REDACTED***');
    expect(JSON.stringify(record.evidencePackSummary)).not.toContain('sk-1234567890abcdef');
  });

  it('redacts bearer headers and api key fields from persisted AI logs', () => {
    const { repo, rows } = createRepo();

    repo.insert({
      promptKey: 'ad_strategy_diagnosis',
      promptVersion: 'ad_strategy_diagnosis_v1',
      model: 'deepseek-chat',
      inputHash: 'hash_4',
      outputJson: JSON.stringify({
        authorization: 'Bearer deepseek-live-token-123456789',
        deepseek_api_key: 'sk-live-deepseek-123456789',
        nested: { apiKey: 'plain-api-key-should-not-persist' },
      }),
      success: false,
      errorMessage: 'Authorization: Bearer deepseek-live-token-123456789; DEEPSEEK_API_KEY=sk-live-deepseek-123456789',
      evidencePackSummary: {
        requestHeaders: { Authorization: 'Bearer deepseek-live-token-123456789' },
        api_key: 'plain-api-key-should-not-persist',
      },
    });

    const [record] = repo.findRecent();
    const persisted = JSON.stringify({
      outputJson: record.outputJson,
      errorMessage: record.errorMessage,
      evidencePackSummaryJson: rows[0].evidence_pack_summary_json,
      evidencePackSummary: record.evidencePackSummary,
    });

    expect(persisted).not.toContain('deepseek-live-token-123456789');
    expect(persisted).not.toContain('sk-live-deepseek-123456789');
    expect(persisted).not.toContain('plain-api-key-should-not-persist');
    expect(persisted).toContain('[redacted]');
  });
});

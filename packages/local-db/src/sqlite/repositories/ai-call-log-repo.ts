import type { Database } from 'better-sqlite3';
import type { StoreId } from '@amazon-ai-ops/shared-types';
import { AI_PURPOSES, type AiCostRecord, type AiSpendPolicy, type AiSpendPolicyInput, type AiSpendProjection, type PaidAiPurpose, type StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { createHash, randomUUID } from 'node:crypto';
import { MissionDomainRepository } from './mission-domain-repo';
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
  constructor(private db: Database, private readonly now: () => Date = () => new Date()) {}

  getSpendProjection(context: StoreContextEnvelope): AiSpendProjection {
    new MissionDomainRepository(this.db).assertContext(context);
    const policy = this.currentSpendPolicy(context.storeId);
    const records = (this.db.prepare('SELECT record_json FROM ai_cost_records WHERE store_id=? ORDER BY started_at DESC,id DESC LIMIT 50')
      .all(context.storeId) as Array<{ record_json: string }>).map(row => JSON.parse(row.record_json) as AiCostRecord);
    const audits = records.length ? this.db.prepare(`SELECT input_hash,output_json FROM ai_call_logs
      WHERE store_id=? AND prompt_key='paid-ai-output' AND input_hash IN (${records.map(() => '?').join(',')})`)
      .all(context.storeId, ...records.map(record => costAuditHash(record.id))) as Array<{ input_hash: string; output_json: string }> : [];
    for (const record of records) {
      const matching = audits.filter(audit => audit.input_hash === costAuditHash(record.id));
      const output = matching.length === 1 ? costAuditOutput(matching[0].output_json) : undefined;
      record.outputStatus = output?.costRecordId === record.id && ['accepted','invalid','discarded'].includes(output.status) ? output.status : 'unvalidated';
      if (record.outputStatus === 'invalid' || record.outputStatus === 'discarded') record.fallback = AI_PURPOSES[record.purpose].fallback;
    }
    const totals = this.windowSpend(policy ?? { storeId: context.storeId, windowStartsAt: '1970-01-01T00:00:00.000Z', windowEndsAt: '9999-12-31T23:59:59.999Z' });
    return { policy, records, ...totals, remainingMicrousd: policy && totals.unknownCount === 0
      ? Math.max(0, policy.budgetMicrousd - totals.committedMicrousd - totals.reservedMicrousd) : undefined };
  }

  saveSpendPolicy(context: StoreContextEnvelope, input: AiSpendPolicyInput): AiSpendPolicy {
    return this.db.transaction(() => {
      new MissionDomainRepository(this.db).assertContext(context);
      const previous = this.currentSpendPolicy(context.storeId);
      if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision !== (previous?.revision ?? 0)) throw spendError('AI_SPEND_STALE', 'AI 预算已更新，请刷新后重试。');
      const keys = ['expectedRevision','enabled','providerBaseUrl','model','windowStartsAt','windowEndsAt','budgetMicrousd','contextTokenLimit','outputTokenLimit','inputMicrousdPerMillion','outputMicrousdPerMillion','pricingReference','reason'];
      if (Object.keys(input).some(key => !keys.includes(key)) || typeof input.enabled !== 'boolean') throw spendError('AI_SPEND_INVALID', 'AI 预算字段不完整或包含不支持的内容。');
      const approvedAt = this.now().toISOString();
      const startsAt = isoDate(input.windowStartsAt), endsAt = isoDate(input.windowEndsAt);
      if (startsAt >= endsAt || (input.enabled && endsAt <= approvedAt)) throw spendError('AI_SPEND_INVALID', '请设置尚未结束的 AI 预算窗口。');
      const policy: AiSpendPolicy = {
        storeId: context.storeId, revision: (previous?.revision ?? 0) + 1, owner: 'operator', currency: 'USD', approvedAt,
        enabled: input.enabled, providerBaseUrl: providerEndpoint(input.providerBaseUrl), model: safeModel(input.model),
        windowStartsAt: startsAt, windowEndsAt: endsAt, budgetMicrousd: positiveInt(input.budgetMicrousd),
        contextTokenLimit: positiveInt(input.contextTokenLimit), outputTokenLimit: positiveInt(input.outputTokenLimit),
        inputMicrousdPerMillion: positiveInt(input.inputMicrousdPerMillion), outputMicrousdPerMillion: positiveInt(input.outputMicrousdPerMillion),
        pricingReference: publicReference(input.pricingReference), reason: safeReason(input.reason),
      };
      if (policy.outputTokenLimit > policy.contextTokenLimit || maximumCallCost(policy) > policy.budgetMicrousd) throw spendError('AI_SPEND_INVALID', '预算须覆盖已复核模型上限的一次调用，输出上限不能超过上下文上限。');
      this.db.prepare('INSERT INTO ai_spend_policies(store_id,revision,policy_json) VALUES(?,?,?)').run(context.storeId, policy.revision, JSON.stringify(policy));
      return policy;
    }).immediate();
  }

  beginCost(context: StoreContextEnvelope, input: { providerBaseUrl: string; model: string; purpose: PaidAiPurpose; automatic: boolean; maxOutputTokens: number }): AiCostRecord {
    return this.db.transaction(() => {
      new MissionDomainRepository(this.db).assertContext(context);
      if (!(input.purpose in AI_PURPOSES) || input.purpose === ('authority' as string) || typeof input.automatic !== 'boolean') throw spendError('AI_PURPOSE_INVALID', '此场景不允许付费 AI 调用。');
      const now = this.now().toISOString();
      const origin = providerEndpoint(input.providerBaseUrl), model = safeModel(input.model);
      positiveInt(input.maxOutputTokens);
      const candidate = this.currentSpendPolicy(context.storeId);
      const policy = candidate?.enabled && candidate.windowStartsAt <= now && now < candidate.windowEndsAt
        && candidate.providerBaseUrl === origin && candidate.model === model ? candidate : undefined;
      let reasonCode: string | undefined;
      const reservedMicrousd = policy ? maximumCallCost(policy) : undefined;
      if (input.automatic) {
        if (!policy) reasonCode = 'AI_SPEND_POLICY_REQUIRED';
        else {
          const totals = this.windowSpend(policy);
          if (totals.unknownCount > 0) reasonCode = 'AI_SPEND_UNKNOWN';
          else if (input.maxOutputTokens > policy.outputTokenLimit) reasonCode = 'AI_SPEND_OUTPUT_LIMIT';
          else if (totals.committedMicrousd + totals.reservedMicrousd + reservedMicrousd! > policy.budgetMicrousd) reasonCode = 'AI_SPEND_EXHAUSTED';
        }
      }
      const record: AiCostRecord = { id: randomUUID(), storeContext: { ...context }, providerBaseUrl: origin, model,
        purpose: input.purpose, automatic: input.automatic, policyRevision: policy?.revision, startedAt: now,
        status: reasonCode ? 'blocked' : 'started', costStatus: 'unknown', reservedMicrousd: reasonCode ? undefined : reservedMicrousd,
        endedAt: reasonCode ? now : undefined, fallback: reasonCode ? AI_PURPOSES[input.purpose].fallback : 'none', reasonCode };
      this.db.prepare('INSERT INTO ai_cost_records(id,store_id,policy_revision,started_at,status,record_json) VALUES(?,?,?,?,?,?)')
        .run(record.id, context.storeId, record.policyRevision ?? null, now, record.status, JSON.stringify(record));
      return record;
    }).immediate();
  }

  finishCost(id: string, outcome: { status: 'succeeded' | 'failed' | 'interrupted'; usage?: AiCostRecord['usage'] }): AiCostRecord {
    // Settlement binds the original request; a late response may record its bill but never change the active store.
    return this.db.transaction(() => {
      const row = this.db.prepare('SELECT record_json FROM ai_cost_records WHERE id=?').get(id) as { record_json: string } | undefined;
      if (!row) throw spendError('AI_COST_NOT_FOUND', '找不到本次 AI 调用账本。');
      const record = JSON.parse(row.record_json) as AiCostRecord;
      if (record.status !== 'started') throw spendError('AI_COST_TERMINAL', 'AI 调用已结束，不能重复结算。');
      const usage = validUsage(outcome.usage) ? outcome.usage : undefined;
      const policyRow = record.policyRevision ? this.db.prepare('SELECT policy_json FROM ai_spend_policies WHERE store_id=? AND revision=?')
        .get(record.storeContext.storeId, record.policyRevision) as { policy_json: string } | undefined : undefined;
      const policy = policyRow ? JSON.parse(policyRow.policy_json) as AiSpendPolicy : undefined;
      const costMicrousd = usage && policy ? tokenCost(policy, usage.promptTokens, usage.completionTokens) : undefined;
      const finished: AiCostRecord = { ...record, status: outcome.status, usage, endedAt: this.now().toISOString(), costMicrousd,
        costStatus: costMicrousd === undefined ? 'unknown' : 'estimated', fallback: outcome.status === 'succeeded' ? 'none' : AI_PURPOSES[record.purpose].fallback,
        reasonCode: costMicrousd !== undefined && record.reservedMicrousd !== undefined && costMicrousd > record.reservedMicrousd ? 'AI_BILLING_BOUND_EXCEEDED' : undefined };
      this.db.prepare("UPDATE ai_cost_records SET status=?,record_json=? WHERE id=? AND status='started'").run(finished.status, JSON.stringify(finished), id);
      return finished;
    }).immediate();
  }

  recoverInterruptedCosts(): number {
    return this.db.transaction(() => {
      const rows = this.db.prepare("SELECT id FROM ai_cost_records WHERE status='started'").all() as Array<{ id: string }>;
      for (const row of rows) this.finishCost(row.id, { status: 'interrupted' });
      return rows.length;
    }).immediate();
  }

  recordOutputOutcome(id: string, status: 'accepted' | 'invalid' | 'discarded'): void {
    this.db.transaction(() => {
      if (!['accepted','invalid','discarded'].includes(status)) throw spendError('AI_OUTPUT_INVALID', 'AI 输出审计状态无效。');
      const row = this.db.prepare('SELECT record_json FROM ai_cost_records WHERE id=?').get(id) as { record_json: string } | undefined;
      if (!row) throw spendError('AI_COST_NOT_FOUND', '找不到本次 AI 调用账本。');
      const cost = JSON.parse(row.record_json) as AiCostRecord;
      if (cost.status === 'started' || (status === 'accepted' && cost.status !== 'succeeded')) throw spendError('AI_OUTPUT_INVALID', '尚无成功响应，不能记录有效输出。');
      const inputHash = costAuditHash(id);
      const previous = this.db.prepare("SELECT output_json FROM ai_call_logs WHERE store_id=? AND prompt_key='paid-ai-output' AND input_hash=?")
        .all(cost.storeContext.storeId, inputHash) as Array<{ output_json: string }>;
      if (previous.length) {
        const output = previous.length === 1 ? costAuditOutput(previous[0].output_json) : undefined;
        if (output?.costRecordId === id && output.status === status) return;
        throw spendError('AI_OUTPUT_IMMUTABLE', 'AI 输出结果已审计，不能重新改写。');
      }
      // Settlement/audit follows the original call even after store archive or session changes.
      // Reuse the existing AI audit log; no prompts, responses, business names or paths are copied here.
      this.db.prepare(`INSERT INTO ai_call_logs(store_id,prompt_key,prompt_version,model,input_hash,output_json,schema_version,success,created_at)
        VALUES(?,'paid-ai-output','v16/1',?,?,?,'paid-ai-output/v16',?,?)`).run(cost.storeContext.storeId,cost.model,inputHash,
          JSON.stringify({ schemaVersion: 'paid-ai-output/v16', output: { costRecordId: id, status } }),status === 'accepted' ? 1 : 0,this.now().toISOString());
    }).immediate();
  }

  private currentSpendPolicy(storeId: StoreId): AiSpendPolicy | undefined {
    const row = this.db.prepare('SELECT policy_json FROM ai_spend_policies WHERE store_id=? ORDER BY revision DESC LIMIT 1').get(storeId) as { policy_json: string } | undefined;
    return row ? JSON.parse(row.policy_json) as AiSpendPolicy : undefined;
  }

  private windowSpend(policy: Pick<AiSpendPolicy, 'storeId' | 'windowStartsAt' | 'windowEndsAt'>): Pick<AiSpendProjection, 'committedMicrousd' | 'reservedMicrousd' | 'unknownCount'> {
    const totals = this.db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN status<>'started' AND cost IS NOT NULL AND boundCode IS NOT 'AI_BILLING_BOUND_EXCEEDED' THEN cost ELSE 0 END),0) AS committedMicrousd,
      COALESCE(SUM(CASE WHEN status='started' AND reserved IS NOT NULL THEN reserved ELSE 0 END),0) AS reservedMicrousd,
      COALESCE(SUM(CASE WHEN status='started' AND reserved IS NOT NULL THEN 0
        WHEN status<>'started' AND cost IS NOT NULL AND boundCode IS NOT 'AI_BILLING_BOUND_EXCEEDED' THEN 0 ELSE 1 END),0) AS unknownCount
      FROM (SELECT status,json_extract(record_json,'$.costMicrousd') AS cost,json_extract(record_json,'$.reservedMicrousd') AS reserved,
        json_extract(record_json,'$.reasonCode') AS boundCode FROM ai_cost_records
        WHERE store_id=? AND started_at>=? AND started_at<? AND status<>'blocked')`)
      .get(policy.storeId, policy.windowStartsAt, policy.windowEndsAt) as Pick<AiSpendProjection, 'committedMicrousd' | 'reservedMicrousd' | 'unknownCount'>;
    if (!Number.isSafeInteger(totals.committedMicrousd) || !Number.isSafeInteger(totals.reservedMicrousd)) totals.unknownCount += 1;
    return totals;
  }

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

function spendError(code: string, message: string): Error & { code: string } { return Object.assign(new Error(message), { code }); }
function costAuditHash(id: string): string { return createHash('sha256').update(`paid-ai-output:${id}`).digest('hex'); }
function costAuditOutput(value: string): { costRecordId: string; status: 'accepted' | 'invalid' | 'discarded' } | undefined {
  const parsed = parseJsonOrText(value) as { schemaVersion?: unknown; output?: { costRecordId?: unknown; status?: unknown } } | null;
  const output = parsed?.output;
  if (parsed?.schemaVersion !== 'paid-ai-output/v16' || typeof output?.costRecordId !== 'string'
    || !['accepted','invalid','discarded'].includes(String(output.status))) return undefined;
  return output as { costRecordId: string; status: 'accepted' | 'invalid' | 'discarded' };
}
function positiveInt(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw spendError('AI_SPEND_INVALID', 'AI 预算、报价和模型上限必须为正整数。');
  return value;
}
function isoDate(value: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw spendError('AI_SPEND_INVALID', 'AI 预算日期无效。');
  return new Date(value).toISOString();
}
function publicReference(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw spendError('AI_SPEND_INVALID', '请提供无凭证的公开 HTTPS 报价来源。'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || redactSecrets(url.href) !== url.href) throw spendError('AI_SPEND_INVALID', '报价来源不能携带秘密或查询参数。');
  return url.href;
}
function providerEndpoint(value: string): string { return publicReference(value).replace(/\/+$/, ''); }
function safeModel(value: string): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/.test(value) || /^(?:[a-z]:|file:|https?:)/i.test(value) || redactSecrets(value) !== value) throw spendError('AI_SPEND_INVALID', '模型名称无效。');
  return value;
}
function safeReason(value: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 1000 || redactSecrets(value) !== value || /(?:[a-z]:[\\/]|\\\\|file:\/\/)/i.test(value)) throw spendError('AI_SPEND_INVALID', '请填写不含秘密或文件路径的预算批准说明。');
  return value.trim();
}
function validUsage(usage: AiCostRecord['usage']): usage is NonNullable<AiCostRecord['usage']> {
  return Boolean(usage && [usage.promptTokens, usage.completionTokens, usage.totalTokens].every(value => Number.isSafeInteger(value) && value >= 0)
    && usage.totalTokens === usage.promptTokens + usage.completionTokens);
}
function tokenCost(policy: AiSpendPolicy, input: number, output: number): number {
  const micros = (BigInt(input) * BigInt(policy.inputMicrousdPerMillion) + BigInt(output) * BigInt(policy.outputMicrousdPerMillion) + 999999n) / 1000000n;
  if (micros > BigInt(Number.MAX_SAFE_INTEGER)) throw spendError('AI_SPEND_INVALID', 'AI 报价超出可安全计算的范围。');
  return Number(micros);
}
function maximumCallCost(policy: AiSpendPolicy): number { return tokenCost(policy, policy.contextTokenLimit, policy.outputTokenLimit); }

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

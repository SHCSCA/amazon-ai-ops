import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiCallLogRepository } from '@amazon-ai-ops/local-db';
import { type AiSpendPolicyInput } from '@amazon-ai-ops/shared-types';
import { createGovernedAiProvider } from './ai-spend-governance';
import { AdActionReasonExplainer } from '@amazon-ai-ops/ai-adapter';
import { createHarness, NOW } from './analysis-authority.test-support';

afterEach(() => { vi.unstubAllGlobals(); });
const policy: AiSpendPolicyInput = { expectedRevision: 0, enabled: true, providerBaseUrl: 'https://ai.example/v1', model: 'bounded-model',
  windowStartsAt: '2026-07-22T00:00:00.000Z', windowEndsAt: '2026-07-30T00:00:00.000Z', budgetMicrousd: 2000,
  contextTokenLimit: 1000, outputTokenLimit: 200, inputMicrousdPerMillion: 1000000, outputMicrousdPerMillion: 2000000,
  pricingReference: 'https://ai.example/pricing', reason: '隔离用例报价与模型上限，非真实预算批准。' };
function setup() {
  const h = createHarness();
  const repository = new AiCallLogRepository(h.database, () => new Date(NOW));
  const assertCurrentContext = vi.fn();
  const config = { apiKey: 'secret-test-only', model: policy.model, baseUrl: policy.providerBaseUrl, maxTokens: 200 };
  const provider = createGovernedAiProvider({ config, repository, context: h.context, automatic: true, purpose: 'strategy_analysis', assertCurrentContext });
  return { ...h, repository, config, provider, assertCurrentContext };
}
const response = (usage?: object) => new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage }));

describe('AI paid-call budget and durable cost boundary', () => {
  it('does not treat an unvalidated response as accepted and cannot rewrite its eventual audit or charge', async () => {
    const h = setup(); h.repository.saveSpendPolicy(h.context, policy);
    vi.stubGlobal('fetch', vi.fn(async () => response({ prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 })));
    const result = await h.provider.complete('private business input');
    expect(h.repository.getSpendProjection(h.context).records[0]).toMatchObject({ outputStatus: 'unvalidated', costMicrousd: 18 });
    expect(typeof result.reportOutput).toBe('function');
    result.reportOutput!('invalid'); result.reportOutput!('invalid');
    expect(() => result.reportOutput!('accepted')).toThrow(/不能重新改写/);
    expect(new AiCallLogRepository(h.database).getSpendProjection(h.context).records[0]).toMatchObject({ outputStatus: 'invalid', costMicrousd: 18, fallback: 'rules' });
    const audits = h.database.prepare("SELECT output_json FROM ai_call_logs WHERE prompt_key='paid-ai-output'").all();
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits)).not.toMatch(/private business input|secret-test-only/);
  });
  it('retains the charge when HTTP succeeds but validated business output falls back', async () => {
    const h = setup();
    h.repository.saveSpendPolicy(h.context, { ...policy, outputTokenLimit: 1000, budgetMicrousd: 4000 });
    vi.stubGlobal('fetch', vi.fn(async () => response({ prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 })));
    const provider = createGovernedAiProvider({ config: h.config, repository: h.repository, context: h.context,
      purpose: 'action_explanation', automatic: true, assertCurrentContext: h.assertCurrentContext });
    const explanation = await new AdActionReasonExplainer(provider).explain({ actionType: 'lower_bid', entityName: 'isolated private keyword',
      currentMetrics: { impressions: 100, clicks: 10, cost: 20, orders: 1, sales: 10, acos: 2 }, recommendedAction: '1.35' });
    expect(explanation.source).toBe('rule');
    const projection = h.repository.getSpendProjection(h.context);
    expect(projection.records[0]).toMatchObject({ status: 'succeeded', costStatus: 'estimated', costMicrousd: 18, outputStatus: 'invalid', fallback: 'template' });
    expect(projection.committedMicrousd).toBe(18);
    expect(JSON.stringify(projection)).not.toMatch(/isolated private keyword|secret-test-only/);
  });
  it('falls back with zero requests without a current policy and never sends the prompt into accounting', async () => {
    const h = setup(), fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect(await h.provider.complete('private business input')).toMatchObject({ success: false });
    expect(fetch).not.toHaveBeenCalled();
    const projection = h.repository.getSpendProjection(h.context);
    expect(projection.records[0]).toMatchObject({ status: 'blocked', costStatus: 'unknown', reasonCode: 'AI_SPEND_POLICY_REQUIRED', fallback: 'rules' });
    expect(JSON.stringify(projection)).not.toMatch(/private business input|secret-test-only/);
  });
  it('reserves the reviewed full model bound atomically and prevents concurrent overspend', async () => {
    const h = setup(); h.repository.saveSpendPolicy(h.context, policy);
    let resolve!: (value: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>(done => { resolve = done; })); vi.stubGlobal('fetch', fetch);
    const first = h.provider.complete('first');
    expect(h.repository.getSpendProjection(h.context)).toMatchObject({ reservedMicrousd: 1400, remainingMicrousd: 600 });
    expect(await h.provider.complete('second')).toMatchObject({ success: false });
    expect(fetch).toHaveBeenCalledTimes(1);
    resolve(response({ prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 })); await first;
    expect(h.repository.getSpendProjection(h.context)).toMatchObject({ committedMicrousd: 18, reservedMicrousd: 0, remainingMicrousd: 1982 });
    expect(h.repository.getSpendProjection(h.context).records.find(row => row.status === 'succeeded')).toMatchObject({ costStatus: 'estimated', costMicrousd: 18, policyRevision: 1 });
  });
  it.each(['missing_usage', 'disconnect', 'process_crash'])('keeps %s cost unknown across new policy revisions and never retries automatically', async failure => {
    const h = setup(); h.repository.saveSpendPolicy(h.context, policy);
    const fetch = vi.fn(async () => { if (failure === 'disconnect') throw new Error('network secret-test-only'); return response(); }); vi.stubGlobal('fetch', fetch);
    if (failure === 'process_crash') {
      h.repository.beginCost(h.context, { providerBaseUrl: policy.providerBaseUrl, model: policy.model, purpose: 'strategy_analysis', automatic: true, maxOutputTokens: 200 });
      expect(h.repository.recoverInterruptedCosts()).toBe(1);
      expect(h.repository.recoverInterruptedCosts()).toBe(0);
    } else await h.provider.complete('first');
    const count = fetch.mock.calls.length;
    h.repository.saveSpendPolicy(h.context, { ...policy, expectedRevision: 1, budgetMicrousd: 5000 });
    expect(await h.provider.complete('must not retry')).toMatchObject({ success: false });
    expect(fetch).toHaveBeenCalledTimes(count);
    const totals = h.repository.getSpendProjection(h.context);
    expect(totals.unknownCount).toBe(1); expect(totals.remainingMicrousd).toBeUndefined();
    expect(totals.records.find(row => row.status !== 'blocked')?.costMicrousd).toBeUndefined();
    expect(JSON.stringify(totals)).not.toContain('secret-test-only');
  });
  it('records a late bill against its original context but refuses a stale business response', async () => {
    const h = setup(); h.repository.saveSpendPolicy(h.context, policy);
    let resolve!: (value: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(done => { resolve = done; })));
    const pending = h.provider.complete('first');
    h.assertCurrentContext.mockImplementation(() => { throw new Error('store switched A-B-A'); });
    resolve(response({ prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 }));
    await expect(pending).rejects.toThrow(/A-B-A/);
    expect(h.repository.getSpendProjection(h.context).records[0]).toMatchObject({ storeContext: h.context, costMicrousd: 18, status: 'succeeded', outputStatus: 'discarded' });
    await expect(h.provider.complete('stale retry')).rejects.toThrow(/A-B-A/);
    expect(h.repository.getSpendProjection(h.context).records).toHaveLength(1);
  });
  it('logs explicit connection-test cost as unknown without claiming a free request or Ads authority', async () => {
    const h = setup(), fetch = vi.fn(async () => response()); vi.stubGlobal('fetch', fetch);
    const manual = createGovernedAiProvider({ config: h.config, repository: h.repository, context: h.context,
      purpose: 'connection_test', automatic: false, assertCurrentContext: h.assertCurrentContext });
    await manual.complete('only ok', { maxTokens: 32 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(h.repository.getSpendProjection(h.context).records[0]).toMatchObject({ automatic: false, status: 'succeeded', costStatus: 'unknown' });
    expect(h.repository.getSpendProjection(h.context).unknownCount).toBe(1);
    expect(h.database.prepare('SELECT COUNT(*) AS count FROM mission_grants').get()).toEqual({ count: 0 });
  });
  it('rejects stale policy revisions, secrets, provider/model drift and excess output before requests', async () => {
    const h = setup(), fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    for (const patch of [{ pricingReference: 'https://user:password@ai.example/pricing' }, { pricingReference: 'https://ai.example/pricing?api_key=secret' }, { reason: 'C:/private/file' }, { budgetMicrousd: -1 }]) {
      expect(() => h.repository.saveSpendPolicy(h.context, { ...policy, ...patch })).toThrow();
    }
    h.repository.saveSpendPolicy(h.context, policy);
    expect(() => h.repository.saveSpendPolicy(h.context, policy)).toThrow(/已更新/);
    expect(await h.provider.complete('too long', { maxTokens: 201 })).toMatchObject({ success: false });
    expect(await h.provider.complete('other model', { model: 'unreviewed' })).toMatchObject({ success: false });
    const otherPath = createGovernedAiProvider({ config: { ...h.config, baseUrl: 'https://ai.example/other' }, repository: h.repository,
      context: h.context, purpose: 'strategy_analysis', automatic: true, assertCurrentContext: h.assertCurrentContext });
    expect(await otherPath.complete('other billing endpoint')).toMatchObject({ success: false });
    expect(fetch).not.toHaveBeenCalled();
    expect(() => h.database.prepare('DELETE FROM ai_spend_policies').run()).toThrow(/immutable/);
    expect(() => h.database.prepare('DELETE FROM ai_cost_records').run()).toThrow(/retained/);
  });
});

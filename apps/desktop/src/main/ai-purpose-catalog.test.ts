import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { OpenAICompatibleProvider } from '@amazon-ai-ops/ai-adapter';
import { AiCallLogRepository } from '@amazon-ai-ops/local-db';
import { AI_PURPOSES, type PaidAiPurpose } from '@amazon-ai-ops/shared-types';
import { createHarness, NOW } from './analysis-authority.test-support';
afterEach(() => { vi.unstubAllGlobals(); });

describe('canonical AI purpose declaration', () => {
  it('declares value level, necessity, fallback and blocking boundary for every production AI purpose', () => {
    expect(AI_PURPOSES).toEqual({
      authority: { label: '权限与数值门禁', level: 'A0', necessary: false, fallback: 'rules', mayBlock: false },
      connection_test: { label: 'AI 连接测试', level: 'A1', necessary: false, fallback: 'no_generation', mayBlock: false },
      action_explanation: { label: '建议解释', level: 'A1', necessary: false, fallback: 'template', mayBlock: false },
      daily_summary: { label: '每日摘要', level: 'A1', necessary: false, fallback: 'template', mayBlock: false },
      listing_draft: { label: 'Listing 草案', level: 'A2', necessary: false, fallback: 'rules', mayBlock: false },
      strategy_analysis: { label: '结构化广告分析', level: 'A3', necessary: false, fallback: 'rules', mayBlock: true },
    });
  });
  it.each(['connection_test', 'action_explanation', 'daily_summary', 'listing_draft', 'strategy_analysis'] as const)(
    'records the declared %s fallback at the real unpaid admission boundary', purpose => {
      const h = createHarness();
      const repository = new AiCallLogRepository(h.database, () => new Date(NOW));
      const receipt = repository.beginCost(h.context, { purpose, providerBaseUrl: 'https://ai.example/v1', model: 'declared-model', automatic: true, maxOutputTokens: 200 });
      expect(receipt).toMatchObject({ purpose, status: 'blocked', reasonCode: 'AI_SPEND_POLICY_REQUIRED', fallback: AI_PURPOSES[purpose].fallback });
      expect(repository.getSpendProjection(h.context).records).toEqual([expect.objectContaining({ id: receipt.id,
        purpose, storeContext: h.context, status: 'blocked', reasonCode: 'AI_SPEND_POLICY_REQUIRED', fallback: AI_PURPOSES[purpose].fallback })]);
      expect(h.database.prepare('SELECT COUNT(*) AS count FROM mission_grants').get()).toEqual({ count: 0 });
    },
  );
  it.each(['authority', 'unregistered_scene'])(
    'rejects the non-paid or undeclared purpose %s without adding an accounting or authority record', purpose => {
      const h = createHarness();
      const repository = new AiCallLogRepository(h.database, () => new Date(NOW));
      const before = h.database.prepare('SELECT total_changes() AS count').get();
      expect(() => repository.beginCost(h.context, { purpose: purpose as PaidAiPurpose, providerBaseUrl: 'https://ai.example/v1', model: 'declared-model', automatic: true, maxOutputTokens: 200 })).toThrow();
      expect(h.database.prepare('SELECT total_changes() AS count').get()).toEqual(before);
    },
  );
  it('keeps provider construction inert and sends only the explicitly requested prompt to the selected endpoint with credentials outside its body', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const credential = 'isolated-provider-credential';
    const provider = new OpenAICompatibleProvider({ apiKey: credential, model: 'selected-model', baseUrl: 'https://selected-ai.example/v1' });
    expect(fetch).not.toHaveBeenCalled();
    await provider.complete('明确提交的本次分析输入');
    expect(fetch).toHaveBeenCalledOnce();
    const [url, request] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://selected-ai.example/v1/chat/completions');
    expect(request.headers).toMatchObject({ Authorization: `Bearer ${credential}` });
    const body = JSON.parse(String(request.body));
    expect(body.messages).toEqual([{ role: 'user', content: '明确提交的本次分析输入' }]);
    expect(JSON.stringify(body)).not.toContain(credential);
    expect(JSON.stringify(body)).not.toMatch(/password|cookie|browserProfile|storageState|telemetry/i);
  });
  it('keeps all production direct fetch transports in the one declared AI adapter and rejects undeclared cloud telemetry imports', () => {
    const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8', windowsHide: true })
      .split('\0').filter(file => /^(?:apps\/desktop\/src|packages\/[^/]+\/src)\/.+\.(?:[cm]?[jt]sx?)$/.test(file)
        && !/\.(?:test|spec)\.|test-support|test-fixture|test-harness/.test(file));
    const calls: string[] = [];
    for (const file of new Set(files)) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(/(?:from\s*|require\s*\(\s*)['"](?:@sentry\/|electron-updater|axios|undici|node:https?|https?['"])/);
      for (const _call of source.matchAll(/\bfetch\s*\(/g)) calls.push(file);
    }
    expect(calls).toEqual(['packages/ai-adapter/src/openai-compatible.ts', 'packages/ai-adapter/src/openai-compatible.ts']);
  });
});

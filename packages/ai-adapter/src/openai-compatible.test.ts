import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAICompatibleProvider, __test__ } from './openai-compatible';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenAICompatibleProvider request body', () => {
  it('disables DeepSeek thinking and requests JSON object output for structured prompts', () => {
    const body = __test__.buildChatCompletionBody(
      { apiKey: 'test-key', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash' },
      'deepseek-v4-flash',
      [{ role: 'user', content: '只回复 ok' }],
      0,
      32,
      'json_object',
    );

    expect(body).toMatchObject({
      model: 'deepseek-v4-flash',
      max_tokens: 32,
      thinking: { type: 'disabled' },
      response_format: { type: 'json_object' },
    });
  });

  it('does not request JSON object output for DeepSeek text health probes', () => {
    const body = __test__.buildChatCompletionBody(
      { apiKey: 'test-key', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash' },
      'deepseek-v4-flash',
      [{ role: 'user', content: '只回复 ok' }],
      0,
      32,
    );

    expect(body).toMatchObject({
      model: 'deepseek-v4-flash',
      thinking: { type: 'disabled' },
    });
    expect(body).not.toHaveProperty('response_format');
  });

  it('does not add DeepSeek-specific fields to non-DeepSeek providers', () => {
    const body = __test__.buildChatCompletionBody(
      { apiKey: 'test-key', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
      'gpt-4o-mini',
      [{ role: 'user', content: 'ok' }],
      0,
      32,
    );

    expect(body).not.toHaveProperty('thinking');
    expect(body).not.toHaveProperty('response_format');
  });

  it('uses configured temperature and maxTokens when per-call options omit them', async () => {
    const requestBodies: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      requestBodies.push(JSON.parse(String(init?.body || '{}')));
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"ok":true}' } }],
        usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    const provider = new OpenAICompatibleProvider({
      apiKey: 'test-key',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
      temperature: 0.3,
      maxTokens: 8192,
    });

    const result = await provider.chat(
      [{ role: 'user', content: '只返回 JSON' }],
      { responseFormat: 'json_object' },
    );

    expect(result.success).toBe(true);
    expect(requestBodies[0]).toMatchObject({
      model: 'deepseek-v4-flash',
      temperature: 0.3,
      max_tokens: 8192,
      response_format: { type: 'json_object' },
    });
  });
});

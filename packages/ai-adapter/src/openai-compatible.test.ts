import { describe, expect, it } from 'vitest';
import { __test__ } from './openai-compatible';

describe('OpenAICompatibleProvider request body', () => {
  it('disables DeepSeek thinking so short structured prompts return visible content', () => {
    const body = __test__.buildChatCompletionBody(
      { apiKey: 'test-key', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash' },
      'deepseek-v4-flash',
      [{ role: 'user', content: '只回复 ok' }],
      0,
      32,
    );

    expect(body).toMatchObject({
      model: 'deepseek-v4-flash',
      max_tokens: 32,
      thinking: { type: 'disabled' },
    });
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
  });
});

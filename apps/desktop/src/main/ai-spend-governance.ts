import { OpenAICompatibleProvider, type AIProvider, type AIConfig, type AIResponse, type ChatMessage, type ChatOptions } from '@amazon-ai-ops/ai-adapter';
import type { AiCallLogRepository } from '@amazon-ai-ops/local-db';
import type { PaidAiPurpose, StoreContextEnvelope } from '@amazon-ai-ops/shared-types';

export const AI_SPEND_BLOCK_MESSAGES: Record<string, string> = {
  AI_SPEND_POLICY_REQUIRED: '当前店铺尚无匹配的有效 AI 预算，使用规则或模板结果。请到系统设置复核报价和预算。',
  AI_SPEND_UNKNOWN: '本预算窗口内有费用未知的 AI 调用，已停止自动付费并使用规则或模板结果。',
  AI_SPEND_OUTPUT_LIMIT: 'AI 输出上限超过已批准预算的模型边界，已使用规则或模板结果。',
  AI_SPEND_EXHAUSTED: '当前 AI 预算不足以覆盖本次调用上限，已使用规则或模板结果。',
};

/** One paid-call boundary for all Main AI purposes. No request body, response, key or path enters the cost ledger. */
export function createGovernedAiProvider(input: {
  config: AIConfig;
  context: StoreContextEnvelope;
  purpose: PaidAiPurpose;
  automatic: boolean;
  repository: AiCallLogRepository;
  assertCurrentContext: (context: StoreContextEnvelope) => unknown;
}): AIProvider {
  const provider = new OpenAICompatibleProvider(input.config);
  const context = { ...input.context };
  async function chat(messages: ChatMessage[], options?: ChatOptions): Promise<AIResponse> {
    options?.signal?.throwIfAborted();
    input.assertCurrentContext(context);
    const record = input.repository.beginCost(context, {
      providerBaseUrl: input.config.baseUrl || 'https://api.openai.com/v1',
      model: options?.model || input.config.model,
      purpose: input.purpose, automatic: input.automatic,
      maxOutputTokens: options?.maxTokens ?? input.config.maxTokens ?? 2000,
    });
    if (record.status === 'blocked') return { success: false, error: AI_SPEND_BLOCK_MESSAGES[record.reasonCode!] ?? 'AI 预算检查未通过，使用规则或模板结果。' };
    let response: AIResponse;
    try {
      // No await between reservation and submit: a policy edit cannot slip into this interval.
      response = await provider.chat(messages, options);
    } catch (error) {
      input.repository.finishCost(record.id, { status: 'interrupted' });
      throw error;
    }
    input.repository.finishCost(record.id, { status: response.success ? 'succeeded' : 'failed', usage: response.usage });
    try { input.assertCurrentContext(context); }
    catch (error) { input.repository.recordOutputOutcome(record.id, 'discarded'); throw error; }
    return { ...response, reportOutput: status => input.repository.recordOutputOutcome(record.id, status) };
  }
  return { chat, complete: (prompt, options) => chat([{ role: 'user', content: prompt }], options),
    healthCheck: async () => { input.assertCurrentContext(context); return provider.healthCheck(); } };
}

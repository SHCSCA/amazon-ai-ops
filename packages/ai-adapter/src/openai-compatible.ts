import { BaseAIProvider } from './provider';
import type { AIConfig, AIResponse } from './types';
import type { ChatMessage } from './provider';

function shouldDisableDeepSeekThinking(baseUrl: string | undefined, model: string): boolean {
  const target = `${baseUrl || ''} ${model}`.toLowerCase();
  return target.includes('deepseek');
}

function buildChatCompletionBody(
  config: AIConfig,
  model: string,
  messages: ChatMessage[],
  temperature: number,
  maxTokens: number
) {
  return {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    ...(shouldDisableDeepSeekThinking(config.baseUrl, model)
      ? { thinking: { type: 'disabled' } }
      : {}),
  };
}

export class OpenAICompatibleProvider extends BaseAIProvider {
  private defaultModel: string;

  constructor(config: AIConfig) {
    super(config);
    this.defaultModel = config.model || 'gpt-4o-mini';
  }

  async chat(
    messages: ChatMessage[],
    options?: { model?: string; temperature?: number; maxTokens?: number }
  ): Promise<AIResponse> {
    const url = this.buildUrl('/chat/completions');
    const model = options?.model || this.defaultModel;
    const temperature = options?.temperature ?? 0.7;
    const maxTokens = options?.maxTokens || 2000;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(buildChatCompletionBody(this.config, model, messages, temperature, maxTokens)),
      });

      if (!response.ok) {
        const error = await response.text();
        return {
          success: false,
          error: `API error ${response.status}: ${error}`,
        };
      }

      const data = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };
      };
      
      return {
        success: true,
        content: data.choices?.[0]?.message?.content || '',
        usage: {
          promptTokens: data.usage?.prompt_tokens || 0,
          completionTokens: data.usage?.completion_tokens || 0,
          totalTokens: data.usage?.total_tokens || 0,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Network error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  async complete(
    prompt: string,
    options?: { model?: string; temperature?: number; maxTokens?: number }
  ): Promise<AIResponse> {
    const messages: ChatMessage[] = [{ role: 'user', content: prompt }];
    return this.chat(messages, options);
  }

  async healthCheck(): Promise<boolean> {
    try {
      const url = this.buildUrl('/models');
      const response = await fetch(url, {
        method: 'GET',
        headers: this.buildHeaders(),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

export const __test__ = {
  buildChatCompletionBody,
  shouldDisableDeepSeekThinking,
};

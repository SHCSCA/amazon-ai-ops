import type { AIConfig, AIResponse } from './types';

export interface AIProvider {
  /**
   * 发送对话请求
   */
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<AIResponse>;
  
  /**
   * 发送补全请求
   */
  complete(prompt: string, options?: CompleteOptions): Promise<AIResponse>;
  
  /**
   * 检查连接是否正常
   */
  healthCheck(): Promise<boolean>;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stop?: string[];
  responseFormat?: 'json_object' | 'text';
}

export interface CompleteOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stop?: string[];
  responseFormat?: 'json_object' | 'text';
}

export abstract class BaseAIProvider implements AIProvider {
  constructor(protected config: AIConfig) {}

  abstract chat(messages: ChatMessage[], options?: ChatOptions): Promise<AIResponse>;
  abstract complete(prompt: string, options?: CompleteOptions): Promise<AIResponse>;
  abstract healthCheck(): Promise<boolean>;

  protected buildHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.config.apiKey}`,
    };
  }

  protected buildUrl(path: string): string {
    const base = this.config.baseUrl || 'https://api.openai.com/v1';
    return `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
  }
}

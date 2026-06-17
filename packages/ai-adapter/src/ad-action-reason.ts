import type { AIProvider, ChatMessage } from './provider';
import type { AdActionExplainInput, AdActionExplainOutput } from './types';

export interface AdActionReasonExplainerOptions {
  persona?: string;
  outputLanguage?: string;
}

const DEFAULT_OUTPUT_LANGUAGE = '简体中文';
const DEFAULT_PERSONA = '你是中文亚马逊广告优化专家，负责解释广告动作为什么被建议，并评估其风险。';

function buildSystemPrompt(options: AdActionReasonExplainerOptions): string {
  const persona = options.persona?.trim() || DEFAULT_PERSONA;
  const outputLanguage = options.outputLanguage?.trim() || DEFAULT_OUTPUT_LANGUAGE;
  return `${persona}

解释要求：
1. 清晰说明动作建议的理由
2. 指出可能的风险和注意事项
3. 提供可替代的建议（如果有）
4. 金额全部使用 USD 货币格式，避免其他货币称谓或符号
5. 所有自然语言字段必须使用${outputLanguage}
6. 只输出 JSON，不要输出 Markdown、解释段落或代码块

输出格式（JSON）：
{
  "schemaVersion": "ad_action_reason_v1",
  "explanation": "详细的解释",
  "riskWarnings": ["风险警告1", "风险警告2"],
  "alternativeSuggestions": ["替代建议1"]
}`;
}

export class AdActionReasonExplainer {
  constructor(
    private provider: AIProvider,
    private readonly options: AdActionReasonExplainerOptions = {},
  ) {}

  async explain(input: AdActionExplainInput): Promise<AdActionExplainOutput> {
    const userPrompt = `广告动作类型: ${input.actionType}
关键词/Target: ${input.entityName}

当前数据表现：
- 展现量: ${input.currentMetrics.impressions}
- 点击量: ${input.currentMetrics.clicks}
- 花费: USD ${input.currentMetrics.cost.toFixed(2)}
- 订单数: ${input.currentMetrics.orders}
- 销售额: USD ${input.currentMetrics.sales.toFixed(2)}
- ACOS: ${(input.currentMetrics.acos * 100).toFixed(1)}%

建议动作: ${input.recommendedAction}

请给出详细的解释和风险评估，输出 JSON 格式；自然语言必须使用${this.outputLanguage()}。`;

    const messages: ChatMessage[] = [
      { role: 'system', content: buildSystemPrompt(this.options) },
      { role: 'user', content: userPrompt },
    ];

    const response = await this.provider.chat(messages, {
      temperature: 0.5,
      maxTokens: 800,
      responseFormat: 'json_object',
    });

    if (!response.success) {
      return {
        schemaVersion: 'ad_action_reason_v1',
        explanation: `建议${input.recommendedAction}：基于当前 ACOS ${(input.currentMetrics.acos * 100).toFixed(1)}%、花费 USD ${input.currentMetrics.cost.toFixed(2)} 的表现做出的判断。`,
        riskWarnings: ['无法获取 AI 详细解释，需人工复核。'],
        source: 'rule',
        aiFallbackReason: response.error || 'AI 未返回解释，使用规则解释',
      };
    }

    try {
      const parsed = parseJsonObject(response.content || '{}');
      if (parsed.schemaVersion !== 'ad_action_reason_v1') {
        return this.ruleFallback(input, `AI 输出 schemaVersion 错误：${String(parsed.schemaVersion || 'missing')}`);
      }
      const output: AdActionExplainOutput = {
        schemaVersion: 'ad_action_reason_v1',
        explanation: typeof parsed.explanation === 'string' ? parsed.explanation : '',
        riskWarnings: Array.isArray(parsed.riskWarnings) ? parsed.riskWarnings.map((item) => String(item)) : [],
        alternativeSuggestions: Array.isArray(parsed.alternativeSuggestions)
          ? parsed.alternativeSuggestions.map((item) => String(item))
          : [],
        source: 'ai',
      };
      if (requiresCjkLanguage(this.outputLanguage()) && hasNonChineseNaturalLanguage([
        output.explanation,
        ...output.riskWarnings,
        ...(output.alternativeSuggestions || []),
      ])) {
        return this.ruleFallback(input, `AI 返回的自然语言字段不是${this.outputLanguage()}。`);
      }
      return output;
    } catch {
      return {
        schemaVersion: 'ad_action_reason_v1',
        explanation: 'AI 响应无法解析为标准 JSON，已回退到规则解释。',
        riskWarnings: ['AI 输出结构异常，不能直接作为审批依据。'],
        source: 'rule',
        aiFallbackReason: 'AI 响应无法解析为标准 JSON',
      };
    }
  }

  private outputLanguage(): string {
    return this.options.outputLanguage?.trim() || DEFAULT_OUTPUT_LANGUAGE;
  }

  private ruleFallback(input: AdActionExplainInput, reason: string): AdActionExplainOutput {
    return {
      schemaVersion: 'ad_action_reason_v1',
      explanation: `建议${input.recommendedAction}：基于当前 ACOS ${(input.currentMetrics.acos * 100).toFixed(1)}%、花费 USD ${input.currentMetrics.cost.toFixed(2)} 的表现做出的判断。`,
      riskWarnings: ['AI 输出未达到中文结构化要求，需人工复核。'],
      source: 'rule',
      aiFallbackReason: reason,
    };
  }
}

function parseJsonObject(content: string): Record<string, unknown> {
  const trimmed = content.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(withoutFence);
  } catch {
    const extracted = withoutFence.match(/\{[\s\S]*\}/)?.[0];
    if (!extracted) throw new Error('AI response was not valid JSON');
    return JSON.parse(extracted);
  }
}

function requiresCjkLanguage(language: string): boolean {
  return /中文|简体|繁体|繁體|Chinese/i.test(language);
}

function containsCjk(value: string): boolean {
  return /[\u3400-\u9fff]/.test(value);
}

function hasNonChineseNaturalLanguage(values: string[]): boolean {
  return values.some((value) => {
    const trimmed = value.trim();
    return Boolean(trimmed) && !containsCjk(trimmed);
  });
}

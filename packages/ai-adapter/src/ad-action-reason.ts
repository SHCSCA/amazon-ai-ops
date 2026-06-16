import type { AIProvider, ChatMessage } from './provider';
import type { AdActionExplainInput, AdActionExplainOutput } from './types';

const SYSTEM_PROMPT = `你是一个亚马逊广告优化专家。你需要解释为什么某个广告动作被建议，并评估其风险。

解释要求：
1. 清晰说明动作建议的理由
2. 指出可能的风险和注意事项
3. 提供可替代的建议（如果有）
4. 金额全部使用 USD 货币格式，避免其他货币称谓或符号

输出格式（JSON）：
{
  "explanation": "详细的解释",
  "riskWarnings": ["风险警告1", "风险警告2"],
  "alternativeSuggestions": ["替代建议1"]
}`;

export class AdActionReasonExplainer {
  constructor(private provider: AIProvider) {}

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

请给出详细的解释和风险评估，输出JSON格式。`;

    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ];

    const response = await this.provider.chat(messages, {
      temperature: 0.5,
      maxTokens: 800,
    });

    if (!response.success) {
      return {
        explanation: `建议${input.recommendedAction}：基于当前 ACOS ${(input.currentMetrics.acos * 100).toFixed(1)}%、花费 USD ${input.currentMetrics.cost.toFixed(2)} 的表现做出的判断。`,
        riskWarnings: ['无法获取AI详细解释'],
        source: 'rule',
        aiFallbackReason: response.error || 'AI 未返回解释，使用规则解释',
      };
    }

    try {
      const parsed = JSON.parse(response.content || '{}');
      return {
        explanation: parsed.explanation || '',
        riskWarnings: parsed.riskWarnings || [],
        alternativeSuggestions: parsed.alternativeSuggestions || [],
        source: 'ai',
      };
    } catch {
      return {
        explanation: response.content || '无法解析AI响应',
        riskWarnings: [],
        source: 'ai',
      };
    }
  }
}

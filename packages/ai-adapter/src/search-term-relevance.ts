import type { AIProvider, ChatMessage } from './provider';
import type { SearchTermRelevanceInput, SearchTermRelevanceOutput } from './types';

const SYSTEM_PROMPT = `你是一个亚马逊广告优化专家。你的任务是根据产品信息判断搜索词是否与产品相关。

判断标准：
1. 搜索词是否描述了产品的核心功能/特性
2. 搜索词是否与产品的使用场景匹配
3. 搜索词是否与目标客户群体相关
4. 搜索词是否存在误导性（吸引非目标客户）

输出要求（JSON格式）：
{
  "isRelevant": true/false,
  "confidence": 0.0-1.0,
  "reason": "判断理由",
  "suggestions": ["相关搜索词建议1", "相关搜索词建议2"]
}`;

export class SearchTermRelevanceAnalyzer {
  constructor(private provider: AIProvider) {}

  async analyze(input: SearchTermRelevanceInput): Promise<SearchTermRelevanceOutput> {
    const userPrompt = `产品ASIN: ${input.asin}
产品标题: ${input.productTitle || '未知'}
产品类目: ${input.category || '未知'}

待判断搜索词: "${input.searchTerm}"

请判断这个搜索词与产品的相关性，并给出JSON格式的判断结果。`;

    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ];

    const response = await this.provider.chat(messages, {
      temperature: 0.3,
      maxTokens: 500,
      responseFormat: 'json_object',
    });

    if (!response.success) {
      return {
        isRelevant: true, // 降级：无法判断时默认相关
        confidence: 0,
        reason: `AI判断失败: ${response.error}`,
      };
    }

    try {
      const parsed = JSON.parse(response.content || '{}');
      return {
        isRelevant: parsed.isRelevant ?? true,
        confidence: parsed.confidence ?? 0.5,
        reason: parsed.reason || '无法解析AI响应',
        suggestions: parsed.suggestions || [],
      };
    } catch {
      // 降级策略：无法解析时使用关键词匹配
      const term = input.searchTerm.toLowerCase();
      const title = (input.productTitle || '').toLowerCase();
      const isRelevant = title.includes(term) || term.split(' ').some(w => title.includes(w));
      
      return {
        isRelevant,
        confidence: 0.5,
        reason: '无法解析AI响应，使用关键词匹配降级判断',
      };
    }
  }
}

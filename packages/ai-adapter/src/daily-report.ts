import type { AIProvider, ChatMessage } from './provider';
import type { DailyReportSummaryInput } from './types';

const SYSTEM_PROMPT = `你是一个亚马逊运营专家。你需要根据以下数据生成一份简洁的每日运营日报。

要求：
1. 突出重点，不用面面俱到
2. 给出可操作的建议
3. 语气专业、简洁
4. 中文输出
5. 金额全部使用 USD 货币格式，避免其他货币称谓或符号

日报格式（JSON）：
{
  "title": "YYYY-MM-DD 日报标题",
  "summary": "整体概述（2-3句话）",
  "highlights": ["要点1", "要点2", "要点3"],
  "concerns": ["关注点1", "关注点2"],
  "tomorrowFocus": ["明日重点1", "明日重点2"],
  "generatedBy": "AI"
}`;

export class DailyReportGenerator {
  constructor(private provider: AIProvider) {}

  async generate(input: DailyReportSummaryInput): Promise<string> {
    const comparedToYesterday = (diff: number) => {
      const sign = diff >= 0 ? '+' : '';
      return `${sign}${(diff * 100).toFixed(1)}%`;
    };

    const userPrompt = `日期: ${input.date}
店铺: ${input.storeName}

销售概况：
- 总营收: USD ${input.salesOverview.totalRevenue.toFixed(2)}
- 总订单: ${input.salesOverview.totalOrders}
- 平均客单价: USD ${input.salesOverview.avgOrderValue.toFixed(2)}
- 相比昨日: ${comparedToYesterday(input.salesOverview.comparedToYesterday)}

广告表现：
- 总花费: USD ${input.adPerformance.totalCost.toFixed(2)}
- 广告销售: USD ${input.adPerformance.totalSales.toFixed(2)}
- 平均ACOS: ${(input.adPerformance.avgAcos * 100).toFixed(1)}%
- 总点击: ${input.adPerformance.totalClicks}
- 相比昨日: ${comparedToYesterday(input.adPerformance.comparedToYesterday)}

建议汇总：
- 总建议数: ${input.recommendationsSummary.total}
- 自动执行: ${input.recommendationsSummary.auto}
- 待审批: ${input.recommendationsSummary.pending}
- 已执行: ${input.recommendationsSummary.executed}

库存预警：
- 缺货: ${input.inventoryAlerts.outOfStock} 个
- 低库存: ${input.inventoryAlerts.lowStock} 个

风险提示：${input.topRisks.join('; ') || '无'}

请生成JSON格式的日报。`;

    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ];

    const response = await this.provider.chat(messages, {
      temperature: 0.6,
      maxTokens: 1500,
    });

    if (!response.success) {
      return this.generateFallbackReport(input);
    }

    return response.content || this.generateFallbackReport(input);
  }

  private generateFallbackReport(input: DailyReportSummaryInput): string {
    // 无法使用 AI 时，生成结构化日报
    const report = {
      title: `${input.date} 日报`,
      summary: `今日广告花费 USD ${input.adPerformance.totalCost.toFixed(2)}，产生销售 USD ${input.adPerformance.totalSales.toFixed(2)}，ACOS ${(input.adPerformance.avgAcos * 100).toFixed(1)}%。`,
      highlights: [
        `广告销售 USD ${input.adPerformance.totalSales.toFixed(2)}`,
        `产生 ${input.recommendationsSummary.total} 条建议，其中 ${input.recommendationsSummary.auto} 条已自动执行`,
        `库存预警：缺货 ${input.inventoryAlerts.outOfStock} 个，低库存 ${input.inventoryAlerts.lowStock} 个`,
      ],
      concerns: input.topRisks,
      tomorrowFocus: [
        '关注高ACOS广告活动',
        '检查低库存产品补货情况',
      ],
      generatedBy: '规则引擎',
    };

    return JSON.stringify(report, null, 2);
  }
}

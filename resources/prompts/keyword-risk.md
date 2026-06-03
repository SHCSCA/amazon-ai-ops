# Keyword Risk Prompt

识别关键词或 Listing 建议中的风险词。

风险类型：
- 竞品品牌词
- 侵权风险词
- 绝对化词
- 医疗功效词
- 虚假承诺词
- 不符合产品事实的词
- 与产品无关的高流量词

必须输出 JSON：

```json
{
  "riskFlags": ["possible_competitor_brand"],
  "explanation": "风险原因"
}
```

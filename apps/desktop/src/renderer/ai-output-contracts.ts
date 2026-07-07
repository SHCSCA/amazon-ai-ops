export type AiOutputContractTone = 'ready' | 'warning';

export interface AiOutputContract {
  key: 'ad-strategy' | 'ad-action' | 'listing-draft';
  label: string;
  version: 'ad_strategy_diagnosis_v1' | 'ad_action_reason_v1' | 'listing_rewrite_v1';
  usedBy: string;
  consumedAs: string;
}

export interface AiContractTag {
  label: string;
  tone: AiOutputContractTone;
  detail: string;
}

export const aiOutputContracts: AiOutputContract[] = [
  {
    key: 'ad-strategy',
    label: '广告诊断',
    version: 'ad_strategy_diagnosis_v1',
    usedBy: '广告表现、优化建议',
    consumedAs: '阶段判断、阈值建议、候选动作',
  },
  {
    key: 'ad-action',
    label: '广告解释',
    version: 'ad_action_reason_v1',
    usedBy: '优化建议、审批中心',
    consumedAs: '动作解释、风险说明、证据摘要',
  },
  {
    key: 'listing-draft',
    label: 'Listing 草案',
    version: 'listing_rewrite_v1',
    usedBy: 'Listing 优化',
    consumedAs: '草案文本、修改理由',
  },
];

export function aiOutputContractTags(): AiContractTag[] {
  return [
    ...aiOutputContracts.map((contract) => ({
      label: `${contract.label} v1`,
      tone: 'ready' as const,
      detail: `${contract.usedBy} 读取固定字段：${contract.consumedAs}`,
    })),
    {
      label: '异常回退规则',
      tone: 'warning',
      detail: '字段缺失、版本不符或解析失败时，不进入正式可执行建议，改用规则兜底。',
    },
  ];
}

export function aiContractPrimaryCopy(): string {
  return 'AI 输出合同由系统固定，页面只读取已校验字段；人设只影响表达风格，不改变字段结构。';
}

export function hasRawJsonPrimaryCopy(text: string): boolean {
  return /\bJSON\b|schemaVersion|manifest|gate/i.test(text);
}

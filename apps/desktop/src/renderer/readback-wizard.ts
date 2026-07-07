export type ReadbackWizardStepId = 'target-source' | 'approval' | 'evidence' | 'verify-export';

export type ReadbackWizardStep = {
  id: ReadbackWizardStepId;
  title: string;
  fields: string[];
};

export const readbackWizardSteps: ReadbackWizardStep[] = [
  {
    id: 'target-source',
    title: '1. 选择已批准动作',
    fields: [
      '店铺',
      '站点',
      'ASIN',
      '广告活动',
      '广告组',
      '对象类型',
      '对象名称',
      '动作类型',
      '来源当前值',
      '来源建议值',
      '来源批次',
      '指标日期',
      '来源行号',
      '推荐来源文件',
      '推荐来源文件必须是真实报表',
      '推荐来源文件必须全部是真实报表',
      '来源批次必须等于当前批次',
    ],
  },
  {
    id: 'approval',
    title: '2. 填写审批凭证',
    fields: [
      '审批人',
      '审批凭证',
      '审批时间',
      '审批时间不是可解析时间',
      '审批人确认范围',
      '外部审批允许',
      '低风险策略允许',
    ],
  },
  {
    id: 'evidence',
    title: '3. 记录执行和回读',
    fields: [
      '执行人',
      '执行编号',
      '执行时间',
      '执行时间不是可解析时间',
      '执行前值',
      '执行前时间',
      '执行前时间不是可解析时间',
      '执行前截图',
      '执行后值',
      '执行后时间',
      '执行后时间不是可解析时间',
      '执行后截图',
      '回读值',
      '回读时间',
      '回读时间不是可解析时间',
      '回读证据',
      '现场行证明',
      '执行前、执行后和回读证据文件不能复用',
      '降价动作必须证明执行后值低于执行前值',
    ],
  },
  {
    id: 'verify-export',
    title: '4. 校验并导出证据',
    fields: [
      '执行成功确认',
      '执行核验',
      '回读核验',
      '执行前值和执行后值不能相同',
      '回读值必须等于执行后值',
      '时间顺序必须为审批≤执行前≤执行动作≤执行后≤回读',
    ],
  },
];

export function firstIncompleteReadbackStep(missing: string[]): ReadbackWizardStepId {
  const missingSet = new Set(missing);
  return readbackWizardSteps.find((step) => step.fields.some((field) => missingSet.has(field)))?.id || 'verify-export';
}

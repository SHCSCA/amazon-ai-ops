// 保留页面编排与原有交互，纯值规则和展示规则按职责复用。


export type ProductStage = 'cold_start' | 'keyword_exploration' | 'stable_conversion' | 'scaling' | 'profit_harvesting' | 'declining_repair';

export const STAGE_OPTIONS: Array<{
    value: ProductStage;
    label: string;
    description: string;
}> = [
    { value: 'cold_start', label: '冷启动', description: '数据少，允许适度试错，但要严格观察点击和首单。' },
    { value: 'keyword_exploration', label: '测词期', description: '重点找有效搜索词，阈值可比利润期宽松。' },
    { value: 'stable_conversion', label: '稳定转化', description: '已有稳定订单，重点控 ACOS 和预算效率。' },
    { value: 'scaling', label: '放量期', description: '可接受阶段性更高 ACOS，但必须跟踪库存和转化。' },
    { value: 'profit_harvesting', label: '利润收割', description: '严格控制 ACOS，优先降本和保利润。' },
    { value: 'declining_repair', label: '异常修复', description: '转化或 ACOS 异常，优先排查价格、库存、Listing 和流量质量。' },
];

export const DEFAULT_COST = {
    purchaseCost: 0,
    firstLegCost: 0,
    fbaFee: 0,
    referralFeeRate: 0.15,
    storageFee: 0,
    otherCost: 0,
    currentPrice: 0,
    minPrice: 0,
    targetNetMargin: 0.15,
    targetAcos: 0.35,
    targetTacos: 0.12,
};

export type ProductCostInput = typeof DEFAULT_COST;

export type ProductCostKey = keyof ProductCostInput;

export type InlineSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export type ProductConfigMetricKey = 'grossCost' | 'margin' | 'targetAcos' | 'targetTacos';

export type ProductConfigMetricTone = 'ready' | 'warning' | 'blocked' | 'pending';

export interface ProductConfigActionButtonInput {
    active: boolean;
    baseClassName: string;
    label: string;
    busyLabel: string;
    disabled?: boolean;
    groupBusy?: boolean;
}

export interface ProductConfigActionButtonView {
    ariaBusy?: true;
    className: string;
    disabled: boolean;
    label: string;
    showSpinner: boolean;
}

export interface ProductConfigLoadButtonView {
    ariaPressed: boolean;
    className: string;
    label: string;
}

export interface ProductConfigRowTargetAcosView {
    ariaLabel: string;
    className: string;
    disabled: boolean;
    feedbackLabel: string;
    inputValue: string;
}

export interface ProductConfigRowHealthView {
    ariaLabel: string;
    className: string;
    detail: string;
    label: string;
    tone: ProductConfigMetricTone;
}

export const PRODUCT_COST_FIELD_LABELS: Record<ProductCostKey, string> = {
    purchaseCost: '采购成本',
    firstLegCost: '头程费用',
    fbaFee: 'FBA 费用',
    referralFeeRate: '推荐费率',
    storageFee: '仓储费',
    otherCost: '其他成本',
    currentPrice: '当前售价',
    minPrice: '最低可接受售价',
    targetNetMargin: '目标净利率',
    targetAcos: '目标 ACOS',
    targetTacos: '目标 TACOS',
};

export const RATE_COST_FIELDS = new Set<ProductCostKey>(['referralFeeRate', 'targetNetMargin', 'targetAcos', 'targetTacos']);

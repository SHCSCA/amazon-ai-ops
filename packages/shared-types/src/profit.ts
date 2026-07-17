export interface ProductCost {
  id?: number;
  productId: number;
  purchaseCost: number;           // 采购成本
  firstLegCost: number;           // 头程费用
  fbaFee: number;                 // FBA 费用
  referralFeeRate: number;         // 推荐费比率
  storageFee: number;             // 仓储费
  otherCost: number;               // 其他成本
  currentPrice: number;            // 当前售价
  minPrice: number;               // 最低价
  targetNetMargin: number;         // 目标净利润率
  targetAcos: number;             // 目标 ACOS
  targetTacos: number;            // 目标 TACOS
  updatedAt?: string;
}

export interface ProfitMetrics {
  asin: string;
  msku: string;
  marketplaceCode: string;
  date: string;
  revenue: number;                 // 营收
  productCost: number;            // 产品成本
  logisticsCost: number;           // 物流成本
  fbaFee: number;                 // FBA 费用
  referralFee: number;            // 推荐费
  storageFee: number;             // 仓储费
  advertisingCost: number;         // 广告费
  otherCost: number;              // 其他成本
  netProfit: number;              // 净利润
  netMargin: number;              // 净利率 = netProfit/revenue
  profitChange: number;           // 相比上期
}

export interface ProfitAnomaly {
  asin: string;
  msku: string;
  anomalyType: 'margin_drop' | 'cost_surge' | 'revenue_drop';
  severity: 'warning' | 'critical';
  currentValue: number;
  expectedValue: number;
  deviation: number;              // 偏差百分比
  reason: string;
}

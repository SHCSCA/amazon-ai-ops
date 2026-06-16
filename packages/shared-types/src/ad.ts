export interface AdDailyMetrics {
  id?: number;
  date: string;                    // YYYY-MM-DD
  storeName: string;
  marketplaceCode: string;
  asin: string;
  msku: string;
  campaignName: string;
  adGroupName: string;
  targeting: string;               // 关键词或 ASIN
  searchTerm: string;
  matchType: 'broad' | 'phrase' | 'exact' | 'auto';
  impressions: number;
  clicks: number;
  cost: number;                    // 花费，单位：USD
  orders: number;
  sales: number;                   // 销售额
  currency?: 'USD' | string;       // 跨境广告金额统一按 USD 入库和展示
  acos: number;                    // 广告成本销售比 = cost/sales
  cpc: number;                     // 点击成本 = cost/clicks
  cvr: number;                     // 转化率 = orders/clicks
  sourceFile: string;
  sourceRow?: number;
  batchId?: string;
  reportType?: string;
  portfolioName?: string;
  createdAt?: string;
}

export interface AdCampaign {
  id: string;
  storeName: string;
  marketplaceCode: string;
  campaignName: string;
  campaignType: 'sponsored' | 'brand' | 'display';
  status: 'enabled' | 'paused' | 'archived';
  dailyBudget: number;
  startDate: string;
}

export interface AdGroup {
  id: string;
  campaignId: string;
  adGroupName: string;
  status: 'enabled' | 'paused';
  defaultBid: number;
}

export interface SearchTermMetrics {
  date: string;
  storeName: string;
  marketplaceCode: string;
  asin: string;
  campaignName: string;
  adGroupName: string;
  searchTerm: string;
  matchType: string;
  impressions: number;
  clicks: number;
  cost: number;
  orders: number;
  sales: number;
  acos: number;
  cpc: number;
}

export interface AdMetricsSummary {
  totalImpressions: number;
  totalClicks: number;
  totalCost: number;
  totalOrders: number;
  totalSales: number;
  avgAcos: number;
  avgCpc: number;
  acosChange: number;             // 相比上期
  cpcChange: number;
}

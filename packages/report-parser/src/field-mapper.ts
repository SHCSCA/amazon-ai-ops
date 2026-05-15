// 领星 ERP 广告报表字段映射
// 键：领星报表中的可能列名（部分匹配）
// 值：标准字段名

export const AD_REPORT_FIELD_MAPPING: Record<string, string> = {
  // 日期/店铺
  '日期': 'date',
  '日期范围': 'date',
  '数据日期': 'date',
  '店铺': 'storeName',
  '店铺名称': 'storeName',
  '店铺名': 'storeName',
  '站点': 'marketplaceCode',
  '站点/市场': 'marketplaceCode',
  
  // ASIN/MSKU
  'ASIN': 'asin',
  'asin': 'asin',
  'Asin': 'asin',
  'MSKU': 'msku',
  'msku': 'msku',
  'Msku': 'msku',
  'SKU': 'sku',
  'sku': 'sku',
  
  // 广告活动
  '广告活动': 'campaignName',
  '广告活动名称': 'campaignName',
  'Campaign': 'campaignName',
  'campaign name': 'campaignName',
  '广告组': 'adGroupName',
  'Ad Group': 'adGroupName',
  'ad group': 'adGroupName',
  '广告组名称': 'adGroupName',
  
  // 关键词/定向
  '关键词': 'targeting',
  '关键词/ASIN': 'targeting',
  '投放关键词': 'targeting',
  'Target': 'targeting',
  'target': 'targeting',
  'Search Term': 'searchTerm',
  'search term': 'searchTerm',
  '搜索词': 'searchTerm',
  '搜索词报告': 'searchTerm',
  
  // 匹配方式
  '匹配方式': 'matchType',
  'match type': 'matchType',
  'Match Type': 'matchType',
  '匹配类型': 'matchType',
  
  // 展现量
  '展现量': 'impressions',
  '展示量': 'impressions',
  'Impressions': 'impressions',
  'impressions': 'impressions',
  
  // 点击量
  '点击量': 'clicks',
  '点击': 'clicks',
  'Clicks': 'clicks',
  'clicks': 'clicks',
  
  // 花费
  '花费': 'cost',
  '花费金额': 'cost',
  '消耗': 'cost',
  'Cost': 'cost',
  'cost': 'cost',
  'Spend': 'cost',
  'spend': 'cost',
  
  // 订单数
  '订单数': 'orders',
  '订单': 'orders',
  'Orders': 'orders',
  'orders': 'orders',
  '转化数': 'orders',
  
  // 销售额
  '销售额': 'sales',
  '销售': 'sales',
  'Sales': 'sales',
  'sales': 'sales',
  'GMV': 'sales',
  'Revenue': 'sales',
  
  // ACOS
  'ACOS': 'acos',
  'acos': 'acos',
  'Acos': 'acos',
  'ROAS': 'acos',
  
  // CPC
  'CPC': 'cpc',
  'cpc': 'cpc',
  '平均点击成本': 'cpc',
  '点击成本': 'cpc',
  
  // 转化率
  '转化率': 'cvr',
  'CVR': 'cvr',
  'cvr': 'cvr',
  'Conversion Rate': 'cvr',
};

export function normalizeFieldName(fieldName: string): string {
  const trimmed = fieldName.trim();
  return AD_REPORT_FIELD_MAPPING[trimmed] ?? AD_REPORT_FIELD_MAPPING[trimmed.toLowerCase()] ?? trimmed;
}

export function mapRowFields(row: Record<string, any>): Record<string, any> {
  const mapped: Record<string, any> = {};
  for (const [key, value] of Object.entries(row)) {
    const normalizedKey = normalizeFieldName(key);
    if (normalizedKey && normalizedKey !== key) {
      mapped[normalizedKey] = value;
    } else if (!Object.values(AD_REPORT_FIELD_MAPPING).includes(key)) {
      // 非标准字段保留原名
      mapped[key] = value;
    }
  }
  return mapped;
}

// Observed Lingxing exports: 48 SHA-256-matched files, eight shapes (2026-09-08).
// Header-only rows carry no metrics; unsupported shapes require explicit registration.
import { AD_REPORT_FIELD_MAPPING, normalizeFieldName } from './field-mapper';
import type { LingxingReportType } from '@amazon-ai-ops/shared-types';

const OBSERVED_HEADERS: Record<LingxingReportType, readonly string[]> = {
  ad_group: ["店铺名称","国家","类型","广告组合","广告活动","广告组","广告组投放类型","当前竞价-本币","日期","备注","曝光量","点击","CTR","CPC-本币","花费-本币","广告销售额-本币","直接销售额-本币","间接销售额-本币","ACoS","ROAS","直接ACoS","直接ROAS","间接ACoS","间接ROAS","广告订单","直接订单","间接订单","间接订单占比","CPA-本币","CVR","广告笔单价-本币","直接笔单价-本币","间接笔单价-本币","广告销量","直接销量","间接销量","vCPM","可见次数","DPV","5秒观看次数","5秒观看率","视频播1/4的次数","视频播一半的次数","视频播3/4的次数","视频完播的次数","视频取消静音的次数","VTR","vCTR","品牌搜索次数","平均触达次数","累计触达用户"],
  advertised_product: ["店铺名称","国家","类型","广告组合","广告活动","广告组","广告组投放类型","广告名称","ASIN","MSKU","日期","备注","曝光量","点击","CTR","CPC-本币","花费-本币","广告销售额-本币","直接销售额-本币","间接销售额-本币","ACoS","ROAS","直接ACoS","直接ROAS","间接ACoS","间接ROAS","广告订单","直接订单","间接订单","间接订单占比","CPA-本币","CVR","广告笔单价-本币","直接笔单价-本币","间接笔单价-本币","广告销量","直接销量","间接销量","vCPM","可见次数","DPV","5秒观看次数","5秒观看率","视频播1/4的次数","视频播一半的次数","视频播3/4的次数","视频完播的次数","视频取消静音的次数","VTR","vCTR","品牌搜索次数"],
  auto_targeting: ["店铺名称","国家","类型","广告组合","广告活动","广告组","投放","日期","备注","曝光量","IS","点击","CTR","CPC-本币","花费-本币","广告销售额-本币","直接销售额-本币","间接销售额-本币","ACoS","ROAS","直接ACoS","直接ROAS","间接ACoS","间接ROAS","广告订单","直接订单","间接订单","间接订单占比","CPA-本币","CVR","广告笔单价-本币","直接笔单价-本币","间接笔单价-本币"],
  campaign: ["店铺名称","国家","类型","广告组合","广告活动","有效状态","日期","备注","曝光量","IS","点击","CTR","CPC-本币","花费-本币","广告销售额-本币","直接销售额-本币","间接销售额-本币","ACoS","ROAS","直接ACoS","直接ROAS","间接ACoS","间接ROAS","广告订单","直接订单","间接订单","间接订单占比","CPA-本币","CVR","广告笔单价-本币","直接笔单价-本币","间接笔单价-本币","品牌新客订单","品牌新客CVR","品牌新客销售额-本币","品牌新客销量","广告销量","直接销量","间接销量","vCPM","可见次数","DPV","5秒观看次数","5秒观看率","视频播1/4的次数","视频播一半的次数","视频播3/4的次数","视频完播的次数","视频取消静音的次数","VTR","vCTR","品牌搜索次数","平均触达次数","累计触达用户"],
  keyword: ["店铺名称","国家","类型","广告组合","广告活动","广告组","关键词","匹配方式","日期","备注","曝光量","IS","点击","CTR","CPC-本币","花费-本币","广告销售额-本币","直接销售额-本币","间接销售额-本币","ACoS","ROAS","直接ACoS","直接ROAS","间接ACoS","间接ROAS","广告订单","直接订单","间接订单","间接订单占比","CPA-本币","CVR","广告笔单价-本币","直接笔单价-本币","间接笔单价-本币","品牌新客订单","品牌新客CVR","品牌新客销售额-本币","品牌新客销量","广告销量","直接销量","间接销量","可见次数","DPV","5秒观看次数","5秒观看率","视频播1/4的次数","视频播一半的次数","视频播3/4的次数","视频完播的次数","视频取消静音的次数","VTR","vCTR","品牌搜索次数"],
  placement: ["店铺名称","国家","类型","广告组合","广告活动","广告位","日期","备注","曝光量","点击","CTR","CPC-本币","花费-本币","广告销售额-本币","直接销售额-本币","间接销售额-本币","ACoS","ROAS","直接ACoS","直接ROAS","间接ACoS","间接ROAS","广告订单","直接订单","间接订单","间接订单占比","CPA-本币","CVR","广告笔单价-本币","直接笔单价-本币","间接笔单价-本币","品牌新客订单","品牌新客CVR","品牌新客销售额-本币","品牌新客销量","广告销量","直接销量","间接销量","DPV","5秒观看次数","5秒观看率","视频播1/4的次数","视频播一半的次数","视频播3/4的次数","视频完播的次数","视频取消静音的次数","VTR","vCTR","品牌搜索次数"],
  product_targeting: ["店铺名称","国家","类型","广告组合","广告活动","广告组","投放","日期","备注","曝光量","IS","点击","CTR","CPC-本币","花费-本币","广告销售额-本币","直接销售额-本币","间接销售额-本币","ACoS","ROAS","直接ACoS","直接ROAS","间接ACoS","间接ROAS","广告订单","直接订单","间接订单","间接订单占比","CPA-本币","CVR","广告笔单价-本币","直接笔单价-本币","间接笔单价-本币","品牌新客订单","品牌新客CVR","品牌新客销售额-本币","品牌新客销量","广告销量","直接销量","间接销量","vCPM","可见次数","DPV","视频播1/4的次数","视频播一半的次数","视频播3/4的次数","视频完播的次数","视频取消静音的次数","VTR","vCTR","品牌搜索次数"],
  user_search_term: ["店铺名称","国家","类型","广告组合","广告活动","广告组","关键词","匹配方式","投放","用户搜索词","日期","备注","曝光量","点击","CTR","CPC-本币","花费-本币","广告销售额-本币","直接销售额-本币","间接销售额-本币","ACoS","ROAS","直接ACoS","直接ROAS","间接ACoS","间接ROAS","广告订单","直接订单","间接订单","间接订单占比","CPA-本币","CVR","广告笔单价-本币","直接笔单价-本币","间接笔单价-本币","可见次数","VTR","vCTR"],
};
const DIMENSIONS: Record<LingxingReportType, readonly string[]> = {
  "campaign": [
    "campaignName"
  ],
  "ad_group": [
    "campaignName",
    "adGroupName"
  ],
  "placement": [
    "campaignName",
    "广告位"
  ],
  "advertised_product": [
    "campaignName",
    "adGroupName",
    "asin",
    "msku"
  ],
  "auto_targeting": [
    "campaignName",
    "adGroupName",
    "targetingExpression"
  ],
  "keyword": [
    "campaignName",
    "adGroupName",
    "targeting",
    "matchType"
  ],
  "product_targeting": [
    "campaignName",
    "adGroupName",
    "targetingExpression"
  ],
  "user_search_term": [
    "campaignName",
    "adGroupName",
    "targeting",
    "matchType",
    "targetingExpression",
    "searchTerm"
  ]
};
const IMPORTED_UNITS: Record<string, string> = { date: 'US business date', storeName: 'label', marketplaceCode: 'US', campaignName: 'label', adGroupName: 'label', asin: 'ASIN', msku: 'MSKU', targeting: 'keyword', targetingExpression: 'provider expression', searchTerm: 'search term', matchType: 'match type', impressions: 'count', clicks: 'count', orders: 'count', cost: 'USD', sales: 'USD' };
export const LINGXING_TEMPLATE_MANIFEST = Object.freeze(Object.entries(OBSERVED_HEADERS).map(([reportType, headers]) => ({
  revision: 'lingxing-us-' + reportType + '-20260908-v1',
  reportType: reportType as LingxingReportType,
  marketplace: 'US', currency: 'USD', headers,
  grain: ['storeName', 'marketplaceCode', 'date', '类型', '广告组合', ...DIMENSIONS[reportType as LingxingReportType]],
  // Display names are not writable Ads IDs. Physical provenance preserves same-name rows.
  uniqueKey: ['sourceFileHash', 'sourceRow'],
  fields: headers.map(header => {
    const canonical = normalizeFieldName(header);
    return { canonical, aliases: [...new Set([header, canonical, ...Object.entries(AD_REPORT_FIELD_MAPPING).filter(([, field]) => field === canonical).map(([alias]) => alias)])],
      requiredHeader: true, blank: 'provider optional metadata; metric rows validated separately',
      unit: IMPORTED_UNITS[canonical] ?? 'not imported; provider metadata', imported: canonical in IMPORTED_UNITS };
  }),
})));

export interface TemplateCompatibility {
  revision?: string;
  reportType?: LingxingReportType;
  error?: { code: 'REPORT_TEMPLATE_UNKNOWN' | 'REPORT_TEMPLATE_AMBIGUOUS' | 'REPORT_TEMPLATE_TYPE_MISMATCH' | 'REPORT_TEMPLATE_CURRENCY'; message: string };
}

export function matchLingxingTemplate(headers: readonly string[], declaredType?: string): TemplateCompatibility {
  const canonical = headers.map(header => normalizeFieldName(header).toLowerCase());
  if (new Set(canonical).size !== canonical.length) return { error: { code: 'REPORT_TEMPLATE_AMBIGUOUS', message: '报表存在重复或同义列，请重新导出原始报表。' } };
  const actual = new Set(canonical);
  const matches = LINGXING_TEMPLATE_MANIFEST.filter(template => template.fields.length === actual.size && template.fields.every(field => actual.has(field.canonical.toLowerCase())));
  if (matches.length !== 1) {
    const expected = LINGXING_TEMPLATE_MANIFEST.find(template => template.reportType === declaredType);
    const missing = expected?.fields.filter(field => !actual.has(field.canonical.toLowerCase())).map(field => field.aliases[0]) ?? [];
    const known = new Set(expected?.fields.map(field => field.canonical.toLowerCase()) ?? []);
    const unknown = expected ? headers.filter(header => !known.has(normalizeFieldName(header).toLowerCase())) : [];
    return { error: { code: matches.length ? 'REPORT_TEMPLATE_AMBIGUOUS' : 'REPORT_TEMPLATE_UNKNOWN',
      message: '报表模板未登记或无法唯一识别，请重新下载受支持的原始报表。' + (missing.length ? ' 缺列：' + missing.join('、') + '。' : '') + (unknown.length ? ' 未登记列：' + unknown.join('、') + '。' : '') } };
  }
  if (declaredType && matches[0].reportType !== declaredType) return { error: { code: 'REPORT_TEMPLATE_TYPE_MISMATCH', message: '报表内容与本次下载类型不一致，请重新下载该类型报表。' } };
  return { revision: matches[0].revision, reportType: matches[0].reportType };
}

export function validateLingxingTemplateRows(rows: readonly Record<string, any>[]): TemplateCompatibility['error'] {
  const invalid = rows.find(row => String(row.marketplaceCode ?? '').trim() !== 'US'
    || ['cost', 'sales'].some(field => /[¥￥€£%]/.test(String(row[field] ?? ''))));
  return invalid ? { code: 'REPORT_TEMPLATE_CURRENCY', message: '报表国家或金额单位不符合 US/USD，请选择美国店铺并重新导出本币报表。' } : undefined;
}

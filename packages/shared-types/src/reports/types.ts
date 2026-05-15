// =============================================
// Report & Field Mapping Types
// =============================================

export type ReportType =
  | 'campaign'
  | 'targeting'
  | 'search_term'
  | 'placement'
  | 'product_performance'
  | 'inventory'
  | 'profit';

export interface FieldMapping {
  report_type: ReportType;
  mappings: Record<string, string>;
  required_fields: string[];
  optional_fields: string[];
}

export interface ParsedReportRow {
  date?: string;
  store?: string;
  marketplace?: string;
  asin?: string;
  msku?: string;
  campaign_name?: string;
  ad_group_name?: string;
  targeting?: string;
  search_term?: string;
  match_type?: string;
  impressions?: number;
  clicks?: number;
  cost?: number;
  orders?: number;
  sales?: number;
  acos?: number;
  cpc?: number;
  cvr?: number;
  available_qty?: number;
  reserved_qty?: number;
  inbound_qty?: number;
  sales_7d?: number;
  sales_14d?: number;
  sales_30d?: number;
  purchase_cost?: number;
  first_leg_cost?: number;
  fba_fee?: number;
  referral_fee?: number;
  coupon_cost?: number;
  refund_loss?: number;
  net_profit?: number;
  net_margin?: number;
}

export interface ReportParseResult {
  success: boolean;
  total_rows: number;
  parsed_rows: number;
  failed_rows: number;
  failed_row_numbers?: number[];
  error_message?: string;
  standard_data: ParsedReportRow[];
}

export interface AIConfig {
  apiKey: string;
  baseUrl?: string;  // OpenAI compatible endpoint
  model: string;     // e.g., 'gpt-4o-mini'
  maxTokens?: number;
  temperature?: number;
}

export interface AIResponse {
  success: boolean;
  content?: string;
  error?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface SearchTermRelevanceInput {
  searchTerm: string;
  asin: string;
  productTitle?: string;
  category?: string;
}

export interface SearchTermRelevanceOutput {
  isRelevant: boolean;
  confidence: number;  // 0-1
  reason: string;
  suggestions?: string[];
}

export interface AdActionExplainInput {
  actionType: string;
  entityName: string;
  currentMetrics: {
    impressions: number;
    clicks: number;
    cost: number;
    orders: number;
    sales: number;
    acos: number;
  };
  recommendedAction: string;
}

export interface AdActionExplainOutput {
  explanation: string;
  riskWarnings: string[];
  alternativeSuggestions?: string[];
  source: 'ai' | 'rule';
  aiFallbackReason?: string;
}

export interface DailyReportSummaryInput {
  date: string;
  storeName: string;
  salesOverview: {
    totalRevenue: number;
    totalOrders: number;
    avgOrderValue: number;
    comparedToYesterday: number;
  };
  adPerformance: {
    totalCost: number;
    totalSales: number;
    avgAcos: number;
    totalClicks: number;
    comparedToYesterday: number;
  };
  recommendationsSummary: {
    total: number;
    auto: number;
    pending: number;
    executed: number;
  };
  inventoryAlerts: {
    outOfStock: number;
    lowStock: number;
  };
  topRisks: string[];
}

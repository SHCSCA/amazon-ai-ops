import type { TaskStatus } from './common';

export type TaskType = 
  | 'download_report'
  | 'parse_report'
  | 'generate_recommendations'
  | 'execute_action'
  | 'check_session'
  | 'generate_daily_report';

export interface Task {
  id: string;
  taskType: TaskType;
  status: TaskStatus;
  priority: number;
  payload: TaskPayload;
  result?: TaskResult;
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface TaskPayload {
  storeName?: string;
  marketplaceCode?: string;
  asin?: string;
  dateRange?: { from: string; to: string };
  reportType?: 'campaign' | 'targeting' | 'search-term';
  actionId?: string;
}

export interface TaskResult {
  success: boolean;
  data?: Record<string, unknown>;
  message?: string;
}

export interface DailyReport {
  date: string;
  storeName: string;
  marketplaceCode: string;
  content: DailyReportContent;
  generatedAt: string;
  hasAiSummary: boolean;
}

export interface DailyReportContent {
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
    agedInventory: number;
  };
  profitAnomalies: {
    marginDrop: number;
    costSurge: number;
  };
  tomorrowFocus: string[];
}

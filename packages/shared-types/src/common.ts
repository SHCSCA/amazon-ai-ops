// 通用类型
export type MarketplaceCode = 'US' | 'UK' | 'DE' | 'FR' | 'IT' | 'ES' | 'JP' | 'CA' | 'MX' | 'AU' | 'AE' | 'NL' | 'SE' | 'PL' | 'SG';

export type RiskLevel = 'AUTO' | 'APPROVAL' | 'FORBIDDEN';

export type ExecutionStatus = 'pending' | 'running' | 'success' | 'failed' | 'blocked' | 'expired';

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface BaseEntity {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface Store {
  id: number;
  name: string;
  marketplaceCode: MarketplaceCode;
  status: 'active' | 'inactive';
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

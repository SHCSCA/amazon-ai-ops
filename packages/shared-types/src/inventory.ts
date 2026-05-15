export interface InventoryDailyMetrics {
  id?: number;
  date: string;
  storeName: string;
  marketplaceCode: string;
  asin: string;
  msku: string;
  fnSku: string;
  availableQty: number;
  reservedQty: number;
  inboundQty: number;
  sales7d: number;
  sales14d: number;
  sales30d: number;
  inventoryDays: number;          // 可售天数 = availableQty / avgDailySales
  invAge0To30: number;
  invAge31To60: number;
  invAge61To90: number;
  invAge91To180: number;
  invAge180Plus: number;
  createdAt?: string;
}

export interface InventoryAlert {
  asin: string;
  msku: string;
  alertType: 'out_of_stock' | 'low_stock' | 'overstock' | 'aged_inventory';
  severity: 'warning' | 'critical';
  currentQty: number;
  suggestedAction: string;
  daysUntilStockout?: number;
}

export interface ReplenishmentSuggestion {
  asin: string;
  msku: string;
  currentAvailable: number;
  salesVelocity: number;          // 7天日均销量
  suggestedReorderQty: number;
  suggestedDeliveryDate: string;
}

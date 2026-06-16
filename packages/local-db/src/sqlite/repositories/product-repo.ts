import type { Database } from 'better-sqlite3';
import type { ProductCost } from '@amazon-ai-ops/shared-types';

export interface Product {
  id: number;
  marketplace_code: string;
  store_name: string;
  asin: string;
  parent_asin: string;
  msku: string;
  sku: string;
  title: string;
  product_stage: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export class ProductRepository {
  constructor(private db: Database) {}

  upsert(product: Partial<Product> & { asin: string; store_name: string; marketplace_code: string }): number {
    const stmt = this.db.prepare(`
      INSERT INTO products (asin, store_name, marketplace_code, parent_asin, msku, sku, title, product_stage, status)
      VALUES (@asin, @store_name, @marketplace_code, @parent_asin, @msku, @sku, @title, @product_stage, @status)
      ON CONFLICT(asin, store_name, marketplace_code) 
      DO UPDATE SET 
        parent_asin = excluded.parent_asin,
        title = excluded.title,
        msku = excluded.msku,
        sku = excluded.sku,
        product_stage = excluded.product_stage,
        status = excluded.status,
        updated_at = datetime('now')
    `);
    const result = stmt.run(product);
    return result.lastInsertRowid as number;
  }

  findByAsin(asin: string, storeName: string, marketplaceCode: string): Product | undefined {
    return this.db.prepare(
      'SELECT * FROM products WHERE asin = ? AND store_name = ? AND marketplace_code = ?'
    ).get(asin, storeName, marketplaceCode) as Product | undefined;
  }

  findAll(storeName?: string): Product[] {
    if (storeName) {
      return this.db.prepare('SELECT * FROM products WHERE store_name = ?').all(storeName) as Product[];
    }
    return this.db.prepare('SELECT * FROM products').all() as Product[];
  }

  updateCost(productId: number, cost: Partial<ProductCost>): void {
    const entries = Object.entries(cost).filter(([key, value]) => key !== 'id' && key !== 'productId' && value !== undefined);
    if (entries.length === 0) return;
    const columnFor = (key: string) => key.replace(/[A-Z]/g, m => '_' + m.toLowerCase());
    const fields = entries.map(([key]) => `${columnFor(key)} = @${key}`);
    const columns = entries.map(([key]) => columnFor(key));
    const values = entries.map(([key]) => `@${key}`);
    const stmt = this.db.prepare(`
      INSERT INTO product_costs (product_id, ${columns.join(', ')}, updated_at)
      VALUES (@productId, ${values.join(', ')}, datetime('now'))
      ON CONFLICT(product_id) DO UPDATE SET ${fields.join(', ')}, updated_at = datetime('now')
    `);
    stmt.run({ productId, ...cost });
  }

  getCost(productId: number): ProductCost | undefined {
    const row = this.db.prepare('SELECT * FROM product_costs WHERE product_id = ?').get(productId) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      id: Number(row.id),
      productId: Number(row.product_id),
      purchaseCost: Number(row.purchase_cost || 0),
      firstLegCost: Number(row.first_leg_cost || 0),
      fbaFee: Number(row.fba_fee || 0),
      referralFeeRate: Number(row.referral_fee_rate || 0),
      storageFee: Number(row.storage_fee || 0),
      otherCost: Number(row.other_cost || 0),
      minPrice: Number(row.min_price || 0),
      targetNetMargin: Number(row.target_net_margin || 0),
      targetAcos: Number(row.target_acos || 0),
      targetTacos: Number(row.target_tacos || 0),
      updatedAt: String(row.updated_at || ''),
    };
  }

  // Desktop 主进程使用的方法
  insert(product: Omit<Product, 'id' | 'created_at' | 'updated_at'>): number {
    const stmt = this.db.prepare(`
      INSERT INTO products (store_name, marketplace_code, asin, parent_asin, msku, sku, title, product_stage, status)
      VALUES (@store_name, @marketplace_code, @asin, @parent_asin, @msku, @sku, @title, @product_stage, @status)
    `);
    const result = stmt.run(product);
    return result.lastInsertRowid as number;
  }
}

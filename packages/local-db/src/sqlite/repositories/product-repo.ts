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
        title = excluded.title,
        msku = excluded.msku,
        sku = excluded.sku,
        product_stage = excluded.product_stage,
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
    const fields = Object.keys(cost).map(k => `${k.replace(/[A-Z]/g, m => '_' + m.toLowerCase())} = @${k}`);
    const stmt = this.db.prepare(`
      INSERT INTO product_costs (product_id, ${fields.join(', ')}, updated_at)
      VALUES (@productId, ${fields.map(f => '@' + f.split(' = ')[0]).join(', ')}, datetime('now'))
      ON CONFLICT(product_id) DO UPDATE SET ${fields.join(', ')}, updated_at = datetime('now')
    `);
    stmt.run({ productId, ...cost });
  }

  getCost(productId: number): ProductCost | undefined {
    return this.db.prepare('SELECT * FROM product_costs WHERE product_id = ?').get(productId) as ProductCost | undefined;
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

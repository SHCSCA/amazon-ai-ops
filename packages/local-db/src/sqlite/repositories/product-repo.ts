import type { Database } from 'better-sqlite3';
import {
  canonicalizeAmazonAsin,
  inspectAmazonAsin,
  type ProductCost,
  type StoreId,
} from '@amazon-ai-ops/shared-types';

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

export interface ProductWithCost extends Product {
  cost?: ProductCost;
}

export interface StoreScopedProduct extends Product {
  storeId: StoreId;
  asinValid: boolean;
}

export interface StoreScopedProductWithCost extends StoreScopedProduct {
  cost?: ProductCost;
}

export interface ProductTargetAcosUpdate {
  asin: string;
  storeName: string;
  marketplaceCode: string;
  targetAcos: number;
}

export interface StoreProductTargetAcosUpdate {
  asin: string;
  targetAcos: number;
}

export class ProductRepository {
  constructor(private db: Database) {}

  /**
   * Serializes a revision read, comparison, mutation, and readback under one
   * IMMEDIATE transaction. Requiring the expected revision at this repository
   * boundary prevents Main mutation paths from silently falling back to a
   * read-then-write sequence outside the database lock.
   */
  runImmediateRevisionTransaction<T>(
    expectedRevision: string,
    operation: () => T,
  ): T {
    if (!expectedRevision.trim()) throw new Error('expectedRevision is required for a CAS transaction.');
    return this.db.transaction(operation).immediate();
  }

  /** @deprecated Legacy unscoped write. Stage 2 must use upsertForStore. */
  upsert(product: Partial<Product> & { asin: string; store_name: string; marketplace_code: string }): number {
    const routedStoreId = this.resolveLegacyWriteStoreId(product.store_name, product.marketplace_code);
    if (routedStoreId) return this.upsertForStore(routedStoreId, product);
    const params = this.normalizeProductParams(undefined, product);
    const upsert = this.db.transaction(() => {
      const existing = this.db.prepare(`
        SELECT id
        FROM products
        WHERE store_id IS NULL
          AND upper(trim(asin)) = @asin
          AND lower(trim(store_name)) = lower(trim(@store_name))
          AND upper(trim(marketplace_code)) = @marketplace_code
        LIMIT 1
      `).get(params) as { id: number } | undefined;
      if (existing) {
        this.db.prepare(`
          UPDATE products
          SET parent_asin = @parent_asin,
              title = @title,
              msku = @msku,
              sku = @sku,
              product_stage = @product_stage,
              status = @status,
              updated_at = datetime('now')
          WHERE id = @id AND store_id IS NULL
        `).run({ ...params, id: existing.id });
        this.quarantineLegacyProduct(existing.id, params);
        return existing.id;
      }
      const result = this.db.prepare(`
        INSERT INTO products (
          asin, store_name, marketplace_code, parent_asin, msku, sku,
          title, product_stage, status
        ) VALUES (
          @asin, @store_name, @marketplace_code, @parent_asin, @msku, @sku,
          @title, @product_stage, @status
        )
      `).run(params);
      const productId = Number(result.lastInsertRowid);
      this.quarantineLegacyProduct(productId, params);
      return productId;
    });
    return upsert.immediate();
  }

  upsertForStore(
    storeId: StoreId,
    product: Partial<Product> & { asin: string; store_name: string; marketplace_code: string },
  ): number {
    this.assertLegacyStoreIdentity(storeId, product.store_name, product.marketplace_code);
    const params = this.normalizeProductParams(storeId, product);
    const upsert = this.db.transaction(() => {
      const existing = this.db.prepare(`
        SELECT id
        FROM products
        WHERE store_id = @storeId AND upper(trim(asin)) = @asin
        LIMIT 1
      `).get(params) as { id: number } | undefined;

      if (existing) {
        this.db.prepare(`
          UPDATE products
          SET store_name = @store_name,
              marketplace_code = @marketplace_code,
              parent_asin = @parent_asin,
              title = @title,
              msku = @msku,
              sku = @sku,
              product_stage = @product_stage,
              status = @status,
              updated_at = datetime('now')
          WHERE id = @id AND store_id = @storeId
        `).run({ ...params, id: existing.id });
        return existing.id;
      }

      const result = this.db.prepare(`
        INSERT INTO products (
          store_id, asin, store_name, marketplace_code, parent_asin, msku, sku,
          title, product_stage, status
        ) VALUES (
          @storeId, @asin, @store_name, @marketplace_code, @parent_asin, @msku, @sku,
          @title, @product_stage, @status
        )
      `).run(params);
      return Number(result.lastInsertRowid);
    });

    return upsert.immediate();
  }

  /** @deprecated Legacy store-name scoped read. Stage 2 must use findByAsinForStore. */
  findByAsin(asin: string, storeName: string, marketplaceCode: string): Product | undefined {
    return this.db.prepare(
      'SELECT * FROM products WHERE asin = ? AND store_name = ? AND marketplace_code = ?'
    ).get(asin, storeName, marketplaceCode) as Product | undefined;
  }

  findByAsinForStore(storeId: StoreId, asin: string): StoreScopedProduct | undefined {
    const normalizedAsin = inspectAmazonAsin(asin).canonical;
    if (!normalizedAsin) return undefined;
    const row = this.db.prepare(`
      SELECT * FROM products
      WHERE store_id = ? AND upper(trim(asin)) = ?
      LIMIT 1
    `).get(storeId, normalizedAsin) as Record<string, unknown> | undefined;
    return row ? this.mapStoreScopedProduct(row) : undefined;
  }

  /** @deprecated Legacy optionally unscoped read. Stage 2 must use findAllForStore. */
  findAll(storeName?: string): Product[] {
    if (storeName) {
      return this.db.prepare('SELECT * FROM products WHERE store_name = ?').all(storeName) as Product[];
    }
    return this.db.prepare('SELECT * FROM products').all() as Product[];
  }

  findAllForStore(storeId: StoreId): StoreScopedProduct[] {
    const rows = this.db.prepare(`
      SELECT * FROM products
      WHERE store_id = ?
      ORDER BY id ASC
    `).all(storeId) as Record<string, unknown>[];
    return rows.map((row) => this.mapStoreScopedProduct(row));
  }

  /** @deprecated Legacy optionally unscoped read. Stage 2 must use findAllWithCostsForStore. */
  findAllWithCosts(storeName?: string): ProductWithCost[] {
    return this.findAll(storeName).map((product) => ({
      ...product,
      cost: this.getCost(product.id),
    }));
  }

  findAllWithCostsForStore(storeId: StoreId): StoreScopedProductWithCost[] {
    return this.findAllForStore(storeId).map((product) => ({
      ...product,
      cost: this.getCostForStore(storeId, product.id),
    }));
  }

  /** @deprecated Legacy unscoped row write. Stage 2 must use updateCostForStore. */
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

  updateCostForStore(storeId: StoreId, productId: number, cost: Partial<ProductCost>): boolean {
    this.getWritableStoreAuthority(storeId);
    const update = this.db.transaction(() => {
      const owner = this.db.prepare(`
        SELECT id FROM products WHERE id = ? AND store_id = ?
      `).get(productId, storeId) as { id: number } | undefined;
      if (!owner) return false;

      const costColumns: Record<string, string> = {
        purchaseCost: 'purchase_cost',
        firstLegCost: 'first_leg_cost',
        fbaFee: 'fba_fee',
        referralFeeRate: 'referral_fee_rate',
        storageFee: 'storage_fee',
        otherCost: 'other_cost',
        currentPrice: 'current_price',
        minPrice: 'min_price',
        targetNetMargin: 'target_net_margin',
        targetAcos: 'target_acos',
        targetTacos: 'target_tacos',
      };
      const forbiddenKeys = Object.keys(cost).filter((key) => (
        ['id', 'productId', 'updatedAt'].includes(key)
      ));
      if (forbiddenKeys.length > 0) {
        throw new Error(`产品成本元数据不可由调用方覆盖：${forbiddenKeys.join(', ')}。`);
      }
      const unknownKeys = Object.keys(cost).filter((key) => !(key in costColumns));
      if (unknownKeys.length > 0) throw new Error(`不支持的产品成本字段：${unknownKeys.join(', ')}。`);
      const entries = Object.entries(cost).filter(
        ([key, value]) => key in costColumns && value !== undefined,
      );
      if (entries.length === 0) return true;
      const fields = entries.map(([key]) => `${costColumns[key]} = @${key}`);
      const columns = entries.map(([key]) => costColumns[key]);
      const values = entries.map(([key]) => `@${key}`);
      const params = { ...cost, storeId, productId };
      const existing = this.db.prepare(`
        SELECT product_id
        FROM product_costs
        WHERE product_id = @productId AND store_id = @storeId
      `).get(params) as { product_id: number } | undefined;

      if (existing) {
        this.db.prepare(`
          UPDATE product_costs
          SET ${fields.join(', ')}, updated_at = datetime('now')
          WHERE product_id = @productId AND store_id = @storeId
        `).run(params);
      } else {
        this.db.prepare(`
          INSERT INTO product_costs (store_id, product_id, ${columns.join(', ')}, updated_at)
          VALUES (@storeId, @productId, ${values.join(', ')}, datetime('now'))
        `).run(params);
      }
      return true;
    });
    return update.immediate();
  }

  /** @deprecated Legacy unscoped row read. Stage 2 must use getCostForStore. */
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
      currentPrice: Number(row.current_price || 0),
      minPrice: Number(row.min_price || 0),
      targetNetMargin: Number(row.target_net_margin || 0),
      targetAcos: Number(row.target_acos || 0),
      targetTacos: Number(row.target_tacos || 0),
      updatedAt: String(row.updated_at || ''),
    };
  }

  getCostForStore(storeId: StoreId, productId: number): ProductCost | undefined {
    const row = this.db.prepare(`
      SELECT pc.*
      FROM product_costs pc
      INNER JOIN products p ON p.id = pc.product_id
      WHERE p.id = ? AND p.store_id = ? AND pc.store_id = ?
    `).get(productId, storeId, storeId) as Record<string, unknown> | undefined;
    return row ? this.mapCost(row) : undefined;
  }

  /** @deprecated Legacy store-name scoped write. Stage 2 must use updateTargetAcosManyForStore. */
  updateTargetAcosMany(updates: ProductTargetAcosUpdate[]): ProductWithCost[] {
    const updateMany = this.db.transaction((targets: ProductTargetAcosUpdate[]) => targets.map((target) => {
      const asin = String(target.asin || '').trim();
      const storeName = String(target.storeName || '').trim();
      const marketplaceCode = String(target.marketplaceCode || '').trim();
      const targetAcos = Number(target.targetAcos);
      if (!asin || !storeName || !marketplaceCode) {
        throw new Error('批量目标 ACOS 更新需要 ASIN、店铺和站点。');
      }
      if (!Number.isFinite(targetAcos) || targetAcos <= 0 || targetAcos > 1) {
        throw new Error(`产品 ${asin} 的目标 ACOS 必须大于 0 且不超过 100%。`);
      }
      const product = this.findByAsin(asin, storeName, marketplaceCode);
      if (!product?.id) {
        throw new Error(`未找到产品 ${asin}，批量更新已回滚。`);
      }
      this.updateCost(product.id, { productId: product.id, targetAcos });
      return {
        ...product,
        cost: this.getCost(product.id),
      };
    }));

    return updateMany(updates);
  }

  updateTargetAcosManyForStore(
    storeId: StoreId,
    updates: StoreProductTargetAcosUpdate[],
  ): StoreScopedProductWithCost[] {
    const updateMany = this.db.transaction((targets: StoreProductTargetAcosUpdate[]) => targets.map((target) => {
      const asin = canonicalizeAmazonAsin(target.asin);
      const targetAcos = Number(target.targetAcos);
      if (!asin) throw new Error('批量目标 ACOS 更新需要 ASIN。');
      if (!Number.isFinite(targetAcos) || targetAcos <= 0 || targetAcos > 1) {
        throw new Error(`产品 ${asin} 的目标 ACOS 必须大于 0 且不超过 100%。`);
      }
      const product = this.findByAsinForStore(storeId, asin);
      if (!product?.id) throw new Error(`当前店铺未找到产品 ${asin}，批量更新已回滚。`);
      if (!this.updateCostForStore(storeId, product.id, { targetAcos })) {
        throw new Error(`产品 ${asin} 不属于当前店铺，批量更新已回滚。`);
      }
      return { ...product, cost: this.getCostForStore(storeId, product.id) };
    }));

    return updateMany.immediate(updates);
  }

  // Desktop 主进程使用的方法
  /** @deprecated Legacy unscoped write. Stage 2 must use insertForStore. */
  insert(product: Omit<Product, 'id' | 'created_at' | 'updated_at'>): number {
    const routedStoreId = this.resolveLegacyWriteStoreId(product.store_name, product.marketplace_code);
    if (routedStoreId) return this.insertForStore(routedStoreId, product);
    const params = this.normalizeProductParams(undefined, product);
    const stmt = this.db.prepare(`
      INSERT INTO products (store_name, marketplace_code, asin, parent_asin, msku, sku, title, product_stage, status)
      VALUES (@store_name, @marketplace_code, @asin, @parent_asin, @msku, @sku, @title, @product_stage, @status)
    `);
    const result = stmt.run(params);
    const productId = Number(result.lastInsertRowid);
    this.quarantineLegacyProduct(productId, params);
    return productId;
  }

  insertForStore(
    storeId: StoreId,
    product: Omit<Product, 'id' | 'created_at' | 'updated_at'>,
  ): number {
    this.assertLegacyStoreIdentity(storeId, product.store_name, product.marketplace_code);
    const params = this.normalizeProductParams(storeId, product);
    const result = this.db.prepare(`
      INSERT INTO products (
        store_id, store_name, marketplace_code, asin, parent_asin, msku, sku,
        title, product_stage, status
      ) VALUES (
        @storeId, @store_name, @marketplace_code, @asin, @parent_asin, @msku, @sku,
        @title, @product_stage, @status
      )
    `).run(params);
    return Number(result.lastInsertRowid);
  }

  /**
   * Creates the product row and its optional cost/target row as one durable
   * store-scoped write. A rejected cost payload must not leave behind a
   * half-created product that the renderer would later mistake for success.
   */
  insertWithCostForStore(
    storeId: StoreId,
    product: Omit<Product, 'id' | 'created_at' | 'updated_at'>,
    cost?: Partial<ProductCost>,
  ): number {
    const insert = this.db.transaction(() => {
      const productId = this.insertForStore(storeId, product);
      if (cost && !this.updateCostForStore(storeId, productId, cost)) {
        throw new Error('产品成本写入未应用，产品创建已回滚。');
      }
      return productId;
    });
    return insert.immediate();
  }

  /**
   * Updates identity fields and optional cost/target fields atomically. This
   * keeps optimistic-revision writes all-or-nothing even when the cost row is
   * rejected after the product row has been prepared.
   */
  upsertWithCostForStore(
    storeId: StoreId,
    product: Partial<Product> & { asin: string; store_name: string; marketplace_code: string },
    cost?: Partial<ProductCost>,
  ): number {
    const update = this.db.transaction(() => {
      const productId = this.upsertForStore(storeId, product);
      if (cost && !this.updateCostForStore(storeId, productId, cost)) {
        throw new Error('产品成本写入未应用，产品更新已回滚。');
      }
      return productId;
    });
    return update.immediate();
  }

  private mapStoreScopedProduct(row: Record<string, unknown>): StoreScopedProduct {
    const asin = inspectAmazonAsin(row.asin);
    return {
      ...(row as unknown as Product),
      asin: asin.canonical,
      storeId: row.store_id as StoreId,
      asinValid: asin.valid,
    };
  }

  private mapCost(row: Record<string, unknown>): ProductCost {
    return {
      id: Number(row.id),
      productId: Number(row.product_id),
      purchaseCost: Number(row.purchase_cost || 0),
      firstLegCost: Number(row.first_leg_cost || 0),
      fbaFee: Number(row.fba_fee || 0),
      referralFeeRate: Number(row.referral_fee_rate || 0),
      storageFee: Number(row.storage_fee || 0),
      otherCost: Number(row.other_cost || 0),
      currentPrice: Number(row.current_price || 0),
      minPrice: Number(row.min_price || 0),
      targetNetMargin: Number(row.target_net_margin || 0),
      targetAcos: Number(row.target_acos || 0),
      targetTacos: Number(row.target_tacos || 0),
      updatedAt: String(row.updated_at || ''),
    };
  }

  private getWritableStoreAuthority(storeId: StoreId): { displayName: string; marketplace: string } {
    const row = this.db.prepare(`
      SELECT display_name AS displayName, marketplace, status
      FROM stores
      WHERE store_id = ?
    `).get(storeId) as { displayName: string; marketplace: string; status: string } | undefined;
    if (!row) throw new Error(`未知店铺 ${storeId}。`);
    if (row.status !== 'active') throw new Error(`店铺 ${storeId} 当前状态为 ${row.status}，禁止写入。`);
    return row;
  }

  private assertLegacyStoreIdentity(
    storeId: StoreId,
    storeName: string,
    marketplaceCode: string,
  ): void {
    const authority = this.getWritableStoreAuthority(storeId);
    const normalize = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
    if (
      normalize(storeName) !== normalize(authority.displayName)
      || String(marketplaceCode ?? '').trim().toUpperCase() !== authority.marketplace
    ) {
      throw new Error(`店铺标识与 store_id ${storeId} 的权威记录不一致。`);
    }
  }

  private normalizeProductParams(
    storeId: StoreId | undefined,
    product: Partial<Product> & { asin: string; store_name: string; marketplace_code: string },
  ): Record<string, unknown> {
    const marketplaceCode = String(product.marketplace_code ?? '').trim().toUpperCase();
    if (marketplaceCode !== 'US') throw new Error('产品仅支持美国站（US）。');
    const storeName = String(product.store_name ?? '').trim().replace(/\s+/g, ' ');
    if (!storeName) throw new Error('产品店铺名称不能为空。');
    const parentAsinInput = String(product.parent_asin ?? '').trim();
    return {
      storeId,
      asin: canonicalizeAmazonAsin(product.asin),
      store_name: storeName,
      marketplace_code: marketplaceCode,
      parent_asin: parentAsinInput ? canonicalizeAmazonAsin(parentAsinInput) : '',
      msku: String(product.msku ?? '').trim(),
      sku: String(product.sku ?? '').trim(),
      title: String(product.title ?? '').trim(),
      product_stage: String(product.product_stage ?? '').trim(),
      status: String(product.status ?? 'active').trim() || 'active',
    };
  }

  private resolveLegacyWriteStoreId(storeName: string, marketplaceCode: string): StoreId | undefined {
    const stores = this.db.prepare(`
      SELECT store_id AS storeId
      FROM stores
      WHERE marketplace = upper(trim(?))
        AND (
          lower(trim(display_name)) = lower(trim(?))
          OR (
            legacy_store_name_normalized = lower(trim(?))
            AND legacy_marketplace_code_normalized = upper(trim(?))
          )
        )
      ORDER BY store_id
    `).all(marketplaceCode, storeName, storeName, marketplaceCode) as Array<{ storeId: StoreId }>;
    if (stores.length === 0) {
      const authorityExists = this.db.prepare('SELECT 1 FROM stores LIMIT 1').get();
      if (authorityExists) {
        throw new Error('无法将旧产品店铺标识解析为唯一 store_id，已拒绝无范围写入。');
      }
      return undefined;
    }
    if (stores.length > 1) {
      throw new Error('旧产品店铺标识匹配多个 store_id，已拒绝可能串店的写入。');
    }
    return stores[0].storeId;
  }

  private quarantineLegacyProduct(productId: number, params: Record<string, unknown>): void {
    const migration = this.db.prepare(`
      SELECT status FROM schema_migrations WHERE version = 3
    `).get() as { status: string } | undefined;
    if (migration?.status !== 'applied') return;
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO store_migration_quarantine (
        migration_version, source_table, source_row_id, reason,
        normalized_store_name, normalized_marketplace_code,
        candidate_store_ids_json, source_identity_json,
        status, created_at, updated_at
      ) VALUES (
        3, 'products', @sourceRowId, 'unresolved_product_owner',
        @normalizedStoreName, @normalizedMarketplaceCode,
        '[]', @sourceIdentityJson,
        'pending', @createdAt, @updatedAt
      )
      ON CONFLICT(migration_version, source_table, source_row_id) DO UPDATE SET
        source_identity_json = excluded.source_identity_json,
        updated_at = excluded.updated_at
      WHERE store_migration_quarantine.status = 'pending'
    `).run({
      sourceRowId: String(productId),
      normalizedStoreName: String(params.store_name ?? '').trim().toLowerCase() || null,
      normalizedMarketplaceCode: String(params.marketplace_code ?? '').trim().toUpperCase() || null,
      sourceIdentityJson: JSON.stringify({
        storeName: params.store_name,
        marketplaceCode: params.marketplace_code,
        asin: params.asin,
      }),
      createdAt: now,
      updatedAt: now,
    });
  }
}

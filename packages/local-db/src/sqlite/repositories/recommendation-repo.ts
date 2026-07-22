import type { Database } from 'better-sqlite3';
import type {
  ActionRecommendation,
  RecommendationFilter,
  StoreId,
} from '@amazon-ai-ops/shared-types';

export type StoreScopedActionRecommendation = ActionRecommendation & { storeId: StoreId };
export type StoreRecommendationFilter = Omit<RecommendationFilter, 'storeName'>;

export class RecommendationRepository {
  constructor(private db: Database) {}

  private metricDateExpression(): string {
    return "date(COALESCE(NULLIF(json_extract(evidence_json, '$.date'), ''), created_at))";
  }

  private recommendationDateTextExpression(): string {
    return "COALESCE(NULLIF(json_extract(evidence_json, '$.date'), ''), created_at)";
  }

  private recommendationDateStartExpression(): string {
    const text = this.recommendationDateTextExpression();
    return `date(substr(${text}, 1, 10)) /* recommendation_date_start */`;
  }

  private recommendationDateEndExpression(): string {
    const text = this.recommendationDateTextExpression();
    return `date(CASE WHEN length(${text}) >= 10 THEN substr(${text}, -10, 10) ELSE substr(${text}, 1, 10) END) /* recommendation_date_end */`;
  }

  /** @deprecated Legacy store-name scoped write. Stage 2 must use insertForStore. */
  insert(rec: Omit<ActionRecommendation, 'id' | 'createdAt' | 'updatedAt'>): number {
    const stmt = this.db.prepare(`
      INSERT INTO action_recommendations (
        task_id, store_name, marketplace_code, asin, msku,
        entity_type, entity_id, entity_name, action_type,
        current_value, recommended_value, reason, evidence_json,
        confidence, risk_level, status
      ) VALUES (
        @taskId, @storeName, @marketplaceCode, @asin, @msku,
        @entityType, @entityId, @entityName, @actionType,
        @currentValue, @recommendedValue, @reason, @evidenceJson,
        @confidence, @riskLevel, @status
      )
    `);
    const result = stmt.run({
      taskId: rec.taskId,
      storeName: rec.storeName,
      marketplaceCode: rec.marketplaceCode,
      asin: rec.asin,
      msku: rec.msku,
      entityType: rec.entityType,
      entityId: rec.entityId,
      entityName: rec.entityName,
      actionType: rec.actionType,
      currentValue: rec.currentValue,
      recommendedValue: rec.recommendedValue,
      reason: rec.reason,
      evidenceJson: JSON.stringify(rec.evidence),
      confidence: rec.confidence,
      riskLevel: rec.riskLevel,
      status: rec.status,
    });
    return result.lastInsertRowid as number;
  }

  insertForStore(
    storeId: StoreId,
    rec: Omit<ActionRecommendation, 'id' | 'createdAt' | 'updatedAt'>,
  ): number {
    this.assertRecommendationStoreIdentity(storeId, rec);
    const result = this.db.prepare(`
      INSERT INTO action_recommendations (
        store_id, task_id, store_name, marketplace_code, asin, msku,
        entity_type, entity_id, entity_name, action_type,
        current_value, recommended_value, reason, evidence_json,
        confidence, risk_level, status
      ) VALUES (
        @storeId, @taskId, @storeName, @marketplaceCode, @asin, @msku,
        @entityType, @entityId, @entityName, @actionType,
        @currentValue, @recommendedValue, @reason, @evidenceJson,
        @confidence, @riskLevel, @status
      )
    `).run({
      storeId,
      taskId: rec.taskId,
      storeName: rec.storeName,
      marketplaceCode: rec.marketplaceCode,
      asin: rec.asin,
      msku: rec.msku,
      entityType: rec.entityType,
      entityId: rec.entityId,
      entityName: rec.entityName,
      actionType: rec.actionType,
      currentValue: rec.currentValue,
      recommendedValue: rec.recommendedValue,
      reason: rec.reason,
      evidenceJson: JSON.stringify(rec.evidence),
      confidence: rec.confidence,
      riskLevel: rec.riskLevel,
      status: rec.status,
    });
    return Number(result.lastInsertRowid);
  }

  /** @deprecated Legacy store-name scoped write. Stage 2 must use insertIfNoDuplicateForStore. */
  insertIfNoDuplicate(rec: Omit<ActionRecommendation, 'id' | 'createdAt' | 'updatedAt'>): { id: number; inserted: boolean; updated?: boolean } {
    const insertOrRefresh = this.db.transaction(() => {
      const duplicate = this.findDuplicate(rec);
      if (duplicate?.id) {
        if (shouldReplaceIncompleteDuplicate(duplicate, rec)) {
          const updated = this.updateDuplicateRecommendation(
            duplicate.id,
            duplicate.status,
            duplicate.revision ?? 0,
            rec,
          );
          return updated
            ? { id: duplicate.id, inserted: false, updated: true }
            : { id: duplicate.id, inserted: false };
        }
        return { id: duplicate.id, inserted: false };
      }
      return { id: this.insert(rec), inserted: true };
    });

    return insertOrRefresh.immediate();
  }

  insertIfNoDuplicateForStore(
    storeId: StoreId,
    rec: Omit<ActionRecommendation, 'id' | 'createdAt' | 'updatedAt'>,
  ): { id: number; inserted: boolean; updated?: boolean } {
    this.assertRecommendationStoreIdentity(storeId, rec);
    const insertOrRefresh = this.db.transaction(() => {
      const duplicate = this.findDuplicateForStore(storeId, rec);
      if (duplicate?.id) {
        if (shouldReplaceIncompleteDuplicate(duplicate, rec)) {
          const updated = this.updateDuplicateRecommendationForStore(
            storeId,
            duplicate.id,
            duplicate.status,
            duplicate.revision ?? 0,
            rec,
          );
          return updated
            ? { id: duplicate.id, inserted: false, updated: true }
            : { id: duplicate.id, inserted: false };
        }
        return { id: duplicate.id, inserted: false };
      }
      return { id: this.insertForStore(storeId, rec), inserted: true };
    });
    return insertOrRefresh.immediate();
  }

  /** @deprecated Legacy store-name scoped read. Stage 2 must use findDuplicateForStore. */
  findDuplicate(rec: Omit<ActionRecommendation, 'id' | 'createdAt' | 'updatedAt'>): ActionRecommendation | undefined {
    const evidenceDate = rec.evidence?.date || '';
    const row = this.db.prepare(`
      SELECT *
      FROM action_recommendations
      WHERE store_name = ?
        AND marketplace_code = ?
        AND upper(asin) = upper(?)
        AND entity_id = ?
        AND action_type = ?
        AND COALESCE(NULLIF(json_extract(evidence_json, '$.date'), ''), '') = ?
        AND status IN ('pending', 'needs_review', 'approved', 'rejected', 'executed')
      ORDER BY created_at DESC
      LIMIT 1
    `).get(
      rec.storeName,
      rec.marketplaceCode,
      rec.asin,
      rec.entityId,
      rec.actionType,
      evidenceDate,
    ) as any;
    return row ? this.mapRow(row) : undefined;
  }

  findDuplicateForStore(
    storeId: StoreId,
    rec: Omit<ActionRecommendation, 'id' | 'createdAt' | 'updatedAt'>,
  ): StoreScopedActionRecommendation | undefined {
    const evidenceDate = rec.evidence?.date || '';
    const row = this.db.prepare(`
      SELECT * FROM action_recommendations
      WHERE store_id = ?
        AND upper(asin) = upper(?)
        AND entity_id = ?
        AND action_type = ?
        AND COALESCE(NULLIF(json_extract(evidence_json, '$.date'), ''), '') = ?
        AND status IN ('pending', 'needs_review', 'approved', 'rejected', 'executed')
      ORDER BY created_at DESC
      LIMIT 1
    `).get(storeId, rec.asin, rec.entityId, rec.actionType, evidenceDate) as any;
    return row ? this.mapStoreScopedRow(row) : undefined;
  }

  /** @deprecated Legacy unscoped row read. Stage 2 must use findByIdForStore. */
  findById(id: number): ActionRecommendation | undefined {
    const row = this.db.prepare('SELECT * FROM action_recommendations WHERE id = ?').get(id) as any;
    return row ? this.mapRow(row) : undefined;
  }

  findByIdForStore(storeId: StoreId, id: number): StoreScopedActionRecommendation | undefined {
    const row = this.db.prepare(`
      SELECT * FROM action_recommendations WHERE id = ? AND store_id = ?
    `).get(id, storeId) as any;
    return row ? this.mapStoreScopedRow(row) : undefined;
  }

  /** @deprecated Legacy optionally unscoped read. Stage 2 must use findByFilterForStore. */
  findByFilter(filter: RecommendationFilter): { items: ActionRecommendation[]; total: number } {
    let sql = 'SELECT * FROM action_recommendations WHERE 1=1';
    let countSql = 'SELECT COUNT(*) as total FROM action_recommendations WHERE 1=1';
    const params: any[] = [];

    if (filter.storeName) {
      sql += ' AND store_name = ?';
      countSql += ' AND store_name = ?';
      params.push(filter.storeName);
    }
    if (filter.marketplaceCode) {
      sql += ' AND marketplace_code = ?';
      countSql += ' AND marketplace_code = ?';
      params.push(filter.marketplaceCode);
    }
    if (filter.asin) {
      sql += ' AND upper(asin) = upper(?)';
      countSql += ' AND upper(asin) = upper(?)';
      params.push(filter.asin);
    }
    if (filter.riskLevel) {
      sql += ' AND risk_level = ?';
      countSql += ' AND risk_level = ?';
      params.push(filter.riskLevel);
    }
    if (filter.status) {
      sql += ' AND status = ?';
      countSql += ' AND status = ?';
      params.push(filter.status);
    }
    if (filter.dateFrom) {
      sql += ` AND ${this.recommendationDateEndExpression()} >= ?`;
      countSql += ` AND ${this.recommendationDateEndExpression()} >= ?`;
      params.push(filter.dateFrom);
    }
    if (filter.dateTo) {
      sql += ` AND ${this.recommendationDateStartExpression()} <= ?`;
      countSql += ` AND ${this.recommendationDateStartExpression()} <= ?`;
      params.push(filter.dateTo);
    }

    const total = (this.db.prepare(countSql).get(...params) as any).total;
    
    sql += ' ORDER BY created_at DESC';
    if (filter.page !== undefined && filter.pageSize !== undefined) {
      sql += ' LIMIT ? OFFSET ?';
      params.push(filter.pageSize, filter.page * filter.pageSize);
    }

    const rows = this.db.prepare(sql).all(...params) as any[];
    return {
      items: rows.map(this.mapRow),
      total,
    };
  }

  findByFilterForStore(
    storeId: StoreId,
    filter: StoreRecommendationFilter,
  ): { items: StoreScopedActionRecommendation[]; total: number } {
    let sql = 'SELECT * FROM action_recommendations WHERE store_id = ?';
    let countSql = 'SELECT COUNT(*) as total FROM action_recommendations WHERE store_id = ?';
    const params: any[] = [storeId];
    if (filter.marketplaceCode) {
      sql += ' AND marketplace_code = ?';
      countSql += ' AND marketplace_code = ?';
      params.push(filter.marketplaceCode);
    }
    if (filter.asin) {
      sql += ' AND upper(asin) = upper(?)';
      countSql += ' AND upper(asin) = upper(?)';
      params.push(filter.asin);
    }
    if (filter.riskLevel) {
      sql += ' AND risk_level = ?';
      countSql += ' AND risk_level = ?';
      params.push(filter.riskLevel);
    }
    if (filter.actionType) {
      sql += ' AND action_type = ?';
      countSql += ' AND action_type = ?';
      params.push(filter.actionType);
    }
    if (filter.status) {
      sql += ' AND status = ?';
      countSql += ' AND status = ?';
      params.push(filter.status);
    }
    if (filter.dateFrom) {
      sql += ` AND ${this.recommendationDateEndExpression()} >= ?`;
      countSql += ` AND ${this.recommendationDateEndExpression()} >= ?`;
      params.push(filter.dateFrom);
    }
    if (filter.dateTo) {
      sql += ` AND ${this.recommendationDateStartExpression()} <= ?`;
      countSql += ` AND ${this.recommendationDateStartExpression()} <= ?`;
      params.push(filter.dateTo);
    }
    const total = (this.db.prepare(countSql).get(...params) as any).total;
    sql += ' ORDER BY created_at DESC';
    if (filter.page !== undefined && filter.pageSize !== undefined) {
      sql += ' LIMIT ? OFFSET ?';
      params.push(filter.pageSize, filter.page * filter.pageSize);
    }
    const rows = this.db.prepare(sql).all(...params) as any[];
    return { items: rows.map((row) => this.mapStoreScopedRow(row)), total };
  }

  /** @deprecated Legacy unscoped row write. Stage 2 must use updateStatusForStore. */
  updateStatus(id: number, status: string): void {
    this.db.prepare(`
      UPDATE action_recommendations 
      SET status = ?, revision = revision + 1, updated_at = datetime('now')
      WHERE id = ?
    `).run(status, id);
  }

  updateStatusForStore(storeId: StoreId, id: number, status: string): boolean {
    this.getWritableStoreAuthority(storeId);
    const result = this.db.prepare(`
      UPDATE action_recommendations
      SET status = ?, revision = revision + 1, updated_at = datetime('now')
      WHERE id = ? AND store_id = ?
    `).run(status, id, storeId);
    return result.changes === 1;
  }

  /** @deprecated Legacy unscoped row write. Stage 2 must use updateStatusWithEvidenceForStore. */
  updateStatusWithEvidence(id: number, status: string, evidencePatch: Record<string, unknown>): void {
    const current = this.findById(id);
    const nextEvidence = {
      ...(current?.evidence || {}),
      ...evidencePatch,
    };
    this.db.prepare(`
      UPDATE action_recommendations
      SET status = ?,
          evidence_json = ?,
          revision = revision + 1,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(status, JSON.stringify(nextEvidence), id);
  }

  updateStatusWithEvidenceForStore(
    storeId: StoreId,
    id: number,
    status: string,
    evidencePatch: Record<string, unknown>,
  ): boolean {
    this.getWritableStoreAuthority(storeId);
    const update = this.db.transaction(() => {
      const current = this.findByIdForStore(storeId, id);
      if (!current) return false;
      const nextEvidence = { ...(current.evidence || {}), ...evidencePatch };
      this.assertRecommendationStoreIdentity(storeId, {
        storeName: current.storeName,
        marketplaceCode: current.marketplaceCode,
        evidence: nextEvidence,
      });
      const result = this.db.prepare(`
        UPDATE action_recommendations
        SET status = ?, evidence_json = ?, revision = revision + 1, updated_at = datetime('now')
        WHERE id = ? AND store_id = ?
      `).run(status, JSON.stringify(nextEvidence), id, storeId);
      return result.changes === 1;
    });
    return update.immediate();
  }

  /** @deprecated Legacy unscoped CAS. Stage 2 must use updateStatusWithEvidenceIfCurrentForStore. */
  updateStatusWithEvidenceIfCurrent(
    id: number,
    expectedStatus: string,
    expectedRevision: number,
    status: string,
    evidencePatch: Record<string, unknown>,
  ): boolean {
    const update = this.db.transaction(() => {
      const current = this.findById(id);
      if (!current) return false;
      const nextEvidence = {
        ...(current.evidence || {}),
        ...evidencePatch,
      };
      const result = this.db.prepare(`
        UPDATE action_recommendations
        SET status = ?,
            evidence_json = ?,
            revision = revision + 1,
            updated_at = datetime('now')
        WHERE id = ? AND status = ? AND revision = ?
      `).run(status, JSON.stringify(nextEvidence), id, expectedStatus, expectedRevision);
      return result.changes === 1;
    });

    return update.immediate();
  }

  updateStatusWithEvidenceIfCurrentForStore(
    storeId: StoreId,
    id: number,
    expectedStatus: string,
    expectedRevision: number,
    status: string,
    evidencePatch: Record<string, unknown>,
  ): boolean {
    this.getWritableStoreAuthority(storeId);
    const update = this.db.transaction(() => {
      const current = this.findByIdForStore(storeId, id);
      if (!current) return false;
      const nextEvidence = { ...(current.evidence || {}), ...evidencePatch };
      this.assertRecommendationStoreIdentity(storeId, {
        storeName: current.storeName,
        marketplaceCode: current.marketplaceCode,
        evidence: nextEvidence,
      });
      const result = this.db.prepare(`
        UPDATE action_recommendations
        SET status = ?, evidence_json = ?, revision = revision + 1, updated_at = datetime('now')
        WHERE id = ? AND store_id = ? AND status = ? AND revision = ?
      `).run(status, JSON.stringify(nextEvidence), id, storeId, expectedStatus, expectedRevision);
      return result.changes === 1;
    });
    return update.immediate();
  }

  /** @deprecated Legacy unscoped CAS. Stage 2 must use bindWritableTargetIfCurrentForStore. */
  bindWritableTargetIfCurrent(
    id: number,
    expectedRevision: number,
    evidencePatch: Record<string, unknown>,
  ): boolean {
    const bind = this.db.transaction(() => {
      const current = this.findById(id);
      if (
        !current
        || current.status !== 'pending'
        || current.evidence?.writableTarget
        || current.evidence?.writableTargetBinding
      ) return false;
      const nextEvidence = {
        ...(current.evidence || {}),
        ...evidencePatch,
      };
      const result = this.db.prepare(`
        UPDATE action_recommendations
        SET status = 'pending',
            evidence_json = ?,
            revision = revision + 1,
            updated_at = datetime('now')
        WHERE id = ?
          AND status = 'pending'
          AND revision = ?
          AND json_type(evidence_json, '$.writableTarget') IS NULL
          AND json_type(evidence_json, '$.writableTargetBinding') IS NULL
      `).run(JSON.stringify(nextEvidence), id, expectedRevision);
      return result.changes === 1;
    });

    return bind.immediate();
  }

  bindWritableTargetIfCurrentForStore(
    storeId: StoreId,
    id: number,
    expectedRevision: number,
    evidencePatch: Record<string, unknown>,
  ): boolean {
    this.getWritableStoreAuthority(storeId);
    const bind = this.db.transaction(() => {
      const current = this.findByIdForStore(storeId, id);
      if (
        !current
        || current.status !== 'pending'
        || current.evidence?.writableTarget
        || current.evidence?.writableTargetBinding
      ) return false;
      const nextEvidence = { ...(current.evidence || {}), ...evidencePatch };
      this.assertRecommendationStoreIdentity(storeId, {
        storeName: current.storeName,
        marketplaceCode: current.marketplaceCode,
        evidence: nextEvidence,
      });
      const result = this.db.prepare(`
        UPDATE action_recommendations
        SET status = 'pending', evidence_json = ?, revision = revision + 1, updated_at = datetime('now')
        WHERE id = ?
          AND store_id = ?
          AND status = 'pending'
          AND revision = ?
          AND json_type(evidence_json, '$.writableTarget') IS NULL
          AND json_type(evidence_json, '$.writableTargetBinding') IS NULL
      `).run(JSON.stringify(nextEvidence), id, storeId, expectedRevision);
      return result.changes === 1;
    });
    return bind.immediate();
  }

  private updateDuplicateRecommendation(
    id: number,
    expectedStatus: string,
    expectedRevision: number,
    rec: Omit<ActionRecommendation, 'id' | 'createdAt' | 'updatedAt'>,
  ): boolean {
    const result = this.db.prepare(`
      UPDATE action_recommendations
      SET task_id = @taskId,
          store_name = @storeName,
          marketplace_code = @marketplaceCode,
          asin = @asin,
          msku = @msku,
          entity_type = @entityType,
          entity_id = @entityId,
          entity_name = @entityName,
          action_type = @actionType,
          current_value = @currentValue,
          recommended_value = @recommendedValue,
          reason = @reason,
          evidence_json = @evidenceJson,
          confidence = @confidence,
          risk_level = @riskLevel,
          status = @status,
          revision = revision + 1,
          updated_at = datetime('now')
      WHERE id = @id
        AND status = @expectedStatus
        AND revision = @expectedRevision
        AND status IN ('pending', 'needs_review')
    `).run({
      id,
      expectedStatus,
      expectedRevision,
      taskId: rec.taskId,
      storeName: rec.storeName,
      marketplaceCode: rec.marketplaceCode,
      asin: rec.asin,
      msku: rec.msku,
      entityType: rec.entityType,
      entityId: rec.entityId,
      entityName: rec.entityName,
      actionType: rec.actionType,
      currentValue: rec.currentValue,
      recommendedValue: rec.recommendedValue,
      reason: rec.reason,
      evidenceJson: JSON.stringify(rec.evidence),
      confidence: rec.confidence,
      riskLevel: rec.riskLevel,
      status: rec.status,
    });
    return result.changes === 1;
  }

  private updateDuplicateRecommendationForStore(
    storeId: StoreId,
    id: number,
    expectedStatus: string,
    expectedRevision: number,
    rec: Omit<ActionRecommendation, 'id' | 'createdAt' | 'updatedAt'>,
  ): boolean {
    this.assertRecommendationStoreIdentity(storeId, rec);
    const result = this.db.prepare(`
      UPDATE action_recommendations
      SET task_id = @taskId,
          store_name = @storeName,
          marketplace_code = @marketplaceCode,
          asin = @asin,
          msku = @msku,
          entity_type = @entityType,
          entity_id = @entityId,
          entity_name = @entityName,
          action_type = @actionType,
          current_value = @currentValue,
          recommended_value = @recommendedValue,
          reason = @reason,
          evidence_json = @evidenceJson,
          confidence = @confidence,
          risk_level = @riskLevel,
          status = @status,
          revision = revision + 1,
          updated_at = datetime('now')
      WHERE id = @id
        AND store_id = @storeId
        AND status = @expectedStatus
        AND revision = @expectedRevision
        AND status IN ('pending', 'needs_review')
    `).run({
      storeId,
      id,
      expectedStatus,
      expectedRevision,
      taskId: rec.taskId,
      storeName: rec.storeName,
      marketplaceCode: rec.marketplaceCode,
      asin: rec.asin,
      msku: rec.msku,
      entityType: rec.entityType,
      entityId: rec.entityId,
      entityName: rec.entityName,
      actionType: rec.actionType,
      currentValue: rec.currentValue,
      recommendedValue: rec.recommendedValue,
      reason: rec.reason,
      evidenceJson: JSON.stringify(rec.evidence),
      confidence: rec.confidence,
      riskLevel: rec.riskLevel,
      status: rec.status,
    });
    return result.changes === 1;
  }

  /** @deprecated Legacy unscoped aggregate. Stage 2 must use countByDateForStore. */
  countByDate(date: string): number {
    const row = this.db.prepare(
      `SELECT COUNT(*) as total FROM action_recommendations WHERE ${this.recommendationDateStartExpression()} <= ? AND ${this.recommendationDateEndExpression()} >= ?`
    ).get(date, date) as { total: number };
    return row.total;
  }

  countByDateForStore(storeId: StoreId, date: string): number {
    const row = this.db.prepare(
      `SELECT COUNT(*) as total FROM action_recommendations WHERE store_id = ? AND ${this.recommendationDateStartExpression()} <= ? AND ${this.recommendationDateEndExpression()} >= ?`,
    ).get(storeId, date, date) as { total: number };
    return row.total;
  }

  /** @deprecated Legacy unscoped aggregate. Stage 2 must use countByDateAndStatusForStore. */
  countByDateAndStatus(date: string, status: string): number {
    const row = this.db.prepare(
      `SELECT COUNT(*) as total FROM action_recommendations WHERE ${this.recommendationDateStartExpression()} <= ? AND ${this.recommendationDateEndExpression()} >= ? AND status = ?`
    ).get(date, date, status) as { total: number };
    return row.total;
  }

  countByDateAndStatusForStore(storeId: StoreId, date: string, status: string): number {
    const row = this.db.prepare(
      `SELECT COUNT(*) as total FROM action_recommendations WHERE store_id = ? AND ${this.recommendationDateStartExpression()} <= ? AND ${this.recommendationDateEndExpression()} >= ? AND status = ?`,
    ).get(storeId, date, date, status) as { total: number };
    return row.total;
  }

  /** @deprecated Legacy unscoped read. Stage 2 must use findByDateAndStatusForStore. */
  findByDateAndStatus(date: string, status: string, limit = 100): ActionRecommendation[] {
    const rows = this.db.prepare(
      `SELECT * FROM action_recommendations WHERE ${this.recommendationDateStartExpression()} <= ? AND ${this.recommendationDateEndExpression()} >= ? AND status = ? ORDER BY created_at DESC LIMIT ?`
    ).all(date, date, status, limit) as any[];
    return rows.map(this.mapRow);
  }

  findByDateAndStatusForStore(
    storeId: StoreId,
    date: string,
    status: string,
    limit = 100,
  ): StoreScopedActionRecommendation[] {
    const rows = this.db.prepare(
      `SELECT * FROM action_recommendations WHERE store_id = ? AND ${this.recommendationDateStartExpression()} <= ? AND ${this.recommendationDateEndExpression()} >= ? AND status = ? ORDER BY created_at DESC LIMIT ?`,
    ).all(storeId, date, date, status, limit) as any[];
    return rows.map((row) => this.mapStoreScopedRow(row));
  }

  private mapRow(row: any): ActionRecommendation {
    return {
      id: row.id,
      taskId: row.task_id,
      storeName: row.store_name,
      marketplaceCode: row.marketplace_code,
      asin: row.asin,
      msku: row.msku,
      entityType: row.entity_type,
      entityId: row.entity_id,
      entityName: row.entity_name,
      actionType: row.action_type,
      currentValue: row.current_value,
      recommendedValue: row.recommended_value,
      reason: row.reason,
      evidence: JSON.parse(row.evidence_json || '{}'),
      confidence: row.confidence,
      riskLevel: row.risk_level,
      status: row.status,
      revision: Number(row.revision ?? 0),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapStoreScopedRow(row: any): StoreScopedActionRecommendation {
    return {
      ...this.mapRow(row),
      storeId: row.store_id as StoreId,
    };
  }

  private getWritableStoreAuthority(storeId: StoreId): {
    displayName: string;
    marketplace: string;
  } {
    const row = this.db.prepare(`
      SELECT display_name AS displayName, marketplace, status
      FROM stores
      WHERE store_id = ?
    `).get(storeId) as { displayName: string; marketplace: string; status: string } | undefined;
    if (!row) throw new Error(`未知店铺 ${storeId}。`);
    if (row.status !== 'active') throw new Error(`店铺 ${storeId} 当前状态为 ${row.status}，禁止写入。`);
    return row;
  }

  private assertRecommendationStoreIdentity(
    storeId: StoreId,
    rec: Pick<ActionRecommendation, 'storeName' | 'marketplaceCode' | 'evidence'>,
  ): void {
    const authority = this.getWritableStoreAuthority(storeId);
    const normalize = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
    if (
      normalize(rec.storeName) !== normalize(authority.displayName)
      || String(rec.marketplaceCode ?? '').trim().toUpperCase() !== authority.marketplace
    ) throw new Error(`建议店铺标识与 store_id ${storeId} 的权威记录不一致。`);
    this.assertNestedStoreIdentity(storeId, rec.evidence, authority, new Set<object>());
  }

  private assertNestedStoreIdentity(
    storeId: StoreId,
    value: unknown,
    authority: { displayName: string; marketplace: string },
    seen: Set<object>,
  ): void {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (!Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      const normalize = (candidate: unknown) => String(candidate ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
      if (
        (record.storeName !== undefined && normalize(record.storeName) !== normalize(authority.displayName))
        || (
          record.marketplaceCode !== undefined
          && String(record.marketplaceCode).trim().toUpperCase() !== authority.marketplace
        )
      ) throw new Error(`建议证据与 store_id ${storeId} 的权威记录不一致。`);
      for (const key of ['batchId', 'sourceBatchId'] as const) {
        const batchId = record[key];
        if (batchId === undefined) continue;
        if (typeof batchId !== 'string' || batchId.trim() === '') {
          throw new Error(`建议证据中的 ${key} 必须是非空批次 id。`);
        }
        this.assertBatchOwnershipIfKnown(storeId, batchId.trim());
      }
    }
    for (const nested of Object.values(value)) {
      this.assertNestedStoreIdentity(storeId, nested, authority, seen);
    }
  }

  private assertBatchOwnershipIfKnown(storeId: StoreId, batchId: string): void {
    const rows = this.db.prepare(`
      SELECT store_id AS storeId
      FROM lingxing_report_batches
      WHERE id = ?
    `).all(batchId) as Array<{ storeId?: string | null }>;
    if (rows.length > 0 && !rows.some((row) => row.storeId === storeId)) {
      throw new Error(`建议批次 ${batchId} 不属于店铺 ${storeId}。`);
    }
  }
}

function shouldReplaceIncompleteDuplicate(
  existing: ActionRecommendation,
  incoming: Omit<ActionRecommendation, 'id' | 'createdAt' | 'updatedAt'>,
): boolean {
  if (!['pending', 'needs_review'].includes(existing.status)) return false;
  if (!['pending', 'needs_review'].includes(incoming.status)) return false;
  if (hasCurrentReviewResolution(existing) || hasCurrentWritableTargetBinding(existing)) return false;
  return (
    (!hasExecutionTraceability(existing) && hasExecutionTraceability(incoming))
    || hasBetterAiEvidence(existing, incoming)
  );
}

function hasCurrentReviewResolution(recommendation: ActionRecommendation): boolean {
  const resolution = recommendation.evidence?.reviewResolution;
  return recommendation.status === 'pending'
    && resolution?.schemaVersion === 1
    && resolution.fromStatus === 'needs_review'
    && resolution.fromRevision + 1 === resolution.resolvedRevision
    && resolution.resolvedRevision === (recommendation.revision ?? 0);
}

function hasCurrentWritableTargetBinding(recommendation: ActionRecommendation): boolean {
  const binding = recommendation.evidence?.writableTargetBinding;
  const target = recommendation.evidence?.writableTarget;
  const boundTarget = binding?.writableTarget;
  const sourceFiles = recommendation.evidence?.sourceFiles || [];
  const boundSourceFiles = binding?.metricSource?.sourceFiles || [];
  const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase();
  const normalizePath = (value: unknown) => normalize(value).replace(/\\/g, '/');
  const sameTarget = Boolean(target && boundTarget)
    && target?.entityType === boundTarget?.entityType
    && normalize(target?.entityId) === normalize(boundTarget?.entityId)
    && normalize(target?.entityName) === normalize(boundTarget?.entityName)
    && normalize(target?.campaignName) === normalize(boundTarget?.campaignName)
    && normalize(target?.adGroupName) === normalize(boundTarget?.adGroupName)
    && normalizePath(target?.sourceFile) === normalizePath(boundTarget?.sourceFile)
    && Number(target?.sourceRow) === Number(boundTarget?.sourceRow)
    && target?.identitySource === boundTarget?.identitySource
    && normalizePath(target?.identityProofPath) === normalizePath(boundTarget?.identityProofPath);
  const targetComplete = Boolean(target)
    && ['keyword', 'auto_targeting', 'product_targeting'].includes(String(target?.entityType || ''))
    && [
      target?.entityId,
      target?.entityName,
      target?.campaignName,
      target?.adGroupName,
      target?.metricDate,
      target?.sourceFile,
      target?.verifiedBy,
      target?.verifiedAt,
      target?.verificationNote,
      target?.identityProofPath,
    ].every(hasText)
    && Number.isInteger(Number(target?.sourceRow))
    && Number(target?.sourceRow) > 0
    && ['ads_ui', 'ads_api'].includes(String(target?.identitySource || ''));
  const scopeMatches = Boolean(binding)
    && hasText(binding?.scope?.dateFrom)
    && hasText(binding?.scope?.dateTo)
    && normalize(binding?.scope?.storeName) === normalize(recommendation.storeName)
    && normalize(binding?.scope?.marketplaceCode) === normalize(recommendation.marketplaceCode)
    && normalize(binding?.scope?.asin) === normalize(recommendation.asin || recommendation.evidence?.asin)
    && normalize(binding?.scope?.batchId) === normalize(recommendation.evidence?.batchId);
  const sourceMatches = sourceFiles.length > 0
    && sourceFiles.length === boundSourceFiles.length
    && sourceFiles.every((filePath, index) => normalizePath(filePath) === normalizePath(boundSourceFiles[index]))
    && normalize(binding?.metricSource?.batchId) === normalize(recommendation.evidence?.batchId)
    && Number(binding?.metricSource?.sourceRow) === Number(recommendation.evidence?.sourceRow)
    && Number.isInteger(Number(binding?.metricSource?.sourceRow))
    && Number(binding?.metricSource?.sourceRow) > 0;

  return recommendation.status === 'pending'
    && binding?.schemaVersion === 1
    && Number.isInteger(binding.fromRevision)
    && binding.fromRevision >= 0
    && binding.fromRevision + 1 === binding.boundRevision
    && binding.boundRevision === (recommendation.revision ?? 0)
    && hasText(binding.boundBy)
    && hasText(binding.boundAt)
    && Number.isFinite(Date.parse(binding.boundAt))
    && hasText(binding.note)
    && targetComplete
    && sameTarget
    && scopeMatches
    && sourceMatches;
}

function hasExecutionTraceability(rec: Pick<ActionRecommendation, 'currentValue' | 'recommendedValue' | 'evidence'>): boolean {
  const sourceFiles = Array.isArray(rec.evidence?.sourceFiles) ? rec.evidence.sourceFiles : [];
  const sourceRow = Number(rec.evidence?.sourceRow);
  return hasText(rec.currentValue)
    && hasText(rec.recommendedValue)
    && sourceFiles.length > 0
    && sourceFiles.every((filePath) => /\.(xlsx|xls|csv)$/i.test(String(filePath || '').trim()))
    && Number.isFinite(sourceRow)
    && sourceRow > 0;
}

function hasBetterAiEvidence(
  existing: ActionRecommendation,
  incoming: Omit<ActionRecommendation, 'id' | 'createdAt' | 'updatedAt'>,
): boolean {
  const existingEvidence = existing.evidence || {};
  const incomingEvidence = incoming.evidence || {};
  const existingHasFallback = Boolean(
    existingEvidence.aiFallbackReason
    || existingEvidence.aiActionFallbackReason
    || existingEvidence.aiStrategyFallbackReason,
  );
  const incomingHasActionFallback = Boolean(
    incomingEvidence.aiFallbackReason
    || incomingEvidence.aiActionFallbackReason,
  );
  const incomingHasAiExplanation = incomingEvidence.explanationSource === 'ai'
    && hasText(incomingEvidence.aiExplanation);
  const incomingHasAiStrategy = incomingEvidence.aiStrategySource === 'ai'
    || Array.isArray(incomingEvidence.aiEvidenceRefs)
    || Array.isArray(incomingEvidence.aiReasoningSteps);
  const existingMissingAi = existingEvidence.explanationSource !== 'ai'
    || existingHasFallback
    || !hasText(existingEvidence.aiExplanation);

  return !incomingHasActionFallback
    && (incomingHasAiExplanation || incomingHasAiStrategy)
    && existingMissingAi
    && hasExecutionTraceability(incoming);
}

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

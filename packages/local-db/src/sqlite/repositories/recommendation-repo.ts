import type { Database } from 'better-sqlite3';
import type { ActionRecommendation, RecommendationFilter } from '@amazon-ai-ops/shared-types';

export class RecommendationRepository {
  constructor(private db: Database) {}

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

  findById(id: number): ActionRecommendation | undefined {
    const row = this.db.prepare('SELECT * FROM action_recommendations WHERE id = ?').get(id) as any;
    return row ? this.mapRow(row) : undefined;
  }

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
      sql += ' AND asin = ?';
      countSql += ' AND asin = ?';
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
      sql += ' AND date(created_at) >= ?';
      countSql += ' AND date(created_at) >= ?';
      params.push(filter.dateFrom);
    }
    if (filter.dateTo) {
      sql += ' AND date(created_at) <= ?';
      countSql += ' AND date(created_at) <= ?';
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

  updateStatus(id: number, status: string): void {
    this.db.prepare(`
      UPDATE action_recommendations 
      SET status = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(status, id);
  }

  countByDate(date: string): number {
    const row = this.db.prepare(
      "SELECT COUNT(*) as total FROM action_recommendations WHERE date(created_at) = ?"
    ).get(date) as { total: number };
    return row.total;
  }

  countByDateAndStatus(date: string, status: string): number {
    const row = this.db.prepare(
      "SELECT COUNT(*) as total FROM action_recommendations WHERE date(created_at) = ? AND status = ?"
    ).get(date, status) as { total: number };
    return row.total;
  }

  findByDateAndStatus(date: string, status: string, limit = 100): ActionRecommendation[] {
    const rows = this.db.prepare(
      "SELECT * FROM action_recommendations WHERE date(created_at) = ? AND status = ? ORDER BY created_at DESC LIMIT ?"
    ).all(date, status, limit) as any[];
    return rows.map(this.mapRow);
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
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

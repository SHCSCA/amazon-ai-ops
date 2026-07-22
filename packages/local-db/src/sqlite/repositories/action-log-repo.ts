import type { Database } from 'better-sqlite3';
import type { ActionLog, StoreId } from '@amazon-ai-ops/shared-types';

export type StoreScopedActionLog = ActionLog & { storeId: StoreId };

export class ActionLogRepository {
  constructor(private db: Database) {}

  /** @deprecated Legacy unscoped write. Stage 2 must use insertForStore. */
  insert(log: Omit<ActionLog, 'id' | 'createdAt'>): number {
    const stmt = this.db.prepare(`
      INSERT INTO action_logs (
        recommendation_id, task_id, action_type, entity_type, entity_id, entity_name,
        before_value, after_value, execution_status, failure_reason,
        screenshot_before, screenshot_after, trace_path, page_url
      ) VALUES (
        @recommendationId, @taskId, @actionType, @entityType, @entityId, @entityName,
        @beforeValue, @afterValue, @executionStatus, @failureReason,
        @screenshotBefore, @screenshotAfter, @tracePath, @pageUrl
      )
    `);
    const result = stmt.run({
      recommendationId: log.recommendationId,
      taskId: log.taskId,
      actionType: log.actionType,
      entityType: log.entityType,
      entityId: log.entityId,
      entityName: log.entityName,
      beforeValue: log.beforeValue,
      afterValue: log.afterValue,
      executionStatus: log.executionStatus,
      failureReason: log.failureReason,
      screenshotBefore: log.screenshotBefore,
      screenshotAfter: log.screenshotAfter,
      tracePath: log.tracePath,
      pageUrl: log.pageUrl,
    });
    return result.lastInsertRowid as number;
  }

  insertForStore(storeId: StoreId, log: Omit<ActionLog, 'id' | 'createdAt'>): number {
    this.assertStoreWritable(storeId);
    if (log.recommendationId !== undefined) {
      const recommendation = this.db.prepare(`
        SELECT id FROM action_recommendations WHERE id = ? AND store_id = ?
      `).get(log.recommendationId, storeId);
      if (!recommendation) {
        throw new Error(`建议 ${log.recommendationId} 不属于店铺 ${storeId}。`);
      }
    }
    const result = this.db.prepare(`
      INSERT INTO action_logs (
        store_id, recommendation_id, task_id, action_type, entity_type, entity_id, entity_name,
        before_value, after_value, execution_status, failure_reason,
        screenshot_before, screenshot_after, trace_path, page_url
      ) VALUES (
        @storeId, @recommendationId, @taskId, @actionType, @entityType, @entityId, @entityName,
        @beforeValue, @afterValue, @executionStatus, @failureReason,
        @screenshotBefore, @screenshotAfter, @tracePath, @pageUrl
      )
    `).run({
      storeId,
      recommendationId: log.recommendationId,
      taskId: log.taskId,
      actionType: log.actionType,
      entityType: log.entityType,
      entityId: log.entityId,
      entityName: log.entityName,
      beforeValue: log.beforeValue,
      afterValue: log.afterValue,
      executionStatus: log.executionStatus,
      failureReason: log.failureReason,
      screenshotBefore: log.screenshotBefore,
      screenshotAfter: log.screenshotAfter,
      tracePath: log.tracePath,
      pageUrl: log.pageUrl,
    });
    return Number(result.lastInsertRowid);
  }

  /** @deprecated Legacy unscoped read. Stage 2 must use findByDateRangeForStore. */
  findByDateRange(dateFrom: string, dateTo: string, limit = 100): ActionLog[] {
    const rows = this.db.prepare(`
      SELECT * FROM action_logs 
      WHERE date(created_at) >= ? AND date(created_at) <= ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(dateFrom, dateTo, limit) as any[];
    return rows.map(this.mapRow);
  }

  findByDateRangeForStore(
    storeId: StoreId,
    dateFrom: string,
    dateTo: string,
    limit = 100,
  ): StoreScopedActionLog[] {
    const rows = this.db.prepare(`
      SELECT * FROM action_logs
      WHERE store_id = ? AND date(created_at) >= ? AND date(created_at) <= ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(storeId, dateFrom, dateTo, limit) as any[];
    return rows.map((row) => this.mapStoreScopedRow(row));
  }

  findByIdForStore(storeId: StoreId, id: number): StoreScopedActionLog | undefined {
    const row = this.db.prepare(`
      SELECT * FROM action_logs WHERE id = ? AND store_id = ?
    `).get(id, storeId) as any;
    return row ? this.mapStoreScopedRow(row) : undefined;
  }

  private mapRow(row: any): ActionLog {
    return {
      id: row.id,
      recommendationId: row.recommendation_id,
      taskId: row.task_id,
      actionType: row.action_type,
      entityType: row.entity_type,
      entityId: row.entity_id,
      entityName: row.entity_name,
      beforeValue: row.before_value,
      afterValue: row.after_value,
      executionStatus: row.execution_status,
      failureReason: row.failure_reason,
      screenshotBefore: row.screenshot_before,
      screenshotAfter: row.screenshot_after,
      tracePath: row.trace_path,
      pageUrl: row.page_url,
      createdAt: row.created_at,
    };
  }

  private mapStoreScopedRow(row: any): StoreScopedActionLog {
    return {
      ...this.mapRow(row),
      storeId: row.store_id as StoreId,
    };
  }

  private assertStoreWritable(storeId: StoreId): void {
    const row = this.db.prepare(`
      SELECT status FROM stores WHERE store_id = ?
    `).get(storeId) as { status: string } | undefined;
    if (!row) throw new Error(`未知店铺 ${storeId}。`);
    if (row.status !== 'active') throw new Error(`店铺 ${storeId} 当前状态为 ${row.status}，禁止写入。`);
  }
}

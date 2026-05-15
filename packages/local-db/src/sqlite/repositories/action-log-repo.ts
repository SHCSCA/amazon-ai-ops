import type { Database } from 'better-sqlite3';
import type { ActionLog } from '@amazon-ai-ops/shared-types';

export class ActionLogRepository {
  constructor(private db: Database) {}

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

  findByDateRange(dateFrom: string, dateTo: string, limit = 100): ActionLog[] {
    const rows = this.db.prepare(`
      SELECT * FROM action_logs 
      WHERE date(created_at) >= ? AND date(created_at) <= ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(dateFrom, dateTo, limit) as any[];
    return rows.map(this.mapRow);
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
}

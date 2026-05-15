import { ActionLogRepository } from '@amazon-ai-ops/local-db';
import type { ActionLog, AdActionType, ExecutionStatus } from '@amazon-ai-ops/shared-types';
import type { Database } from 'better-sqlite3';

export class AuditLogger {
  private repo: ActionLogRepository;

  constructor(db: Database) {
    this.repo = new ActionLogRepository(db);
  }

  /**
   * 记录动作执行
   */
  logExecution(params: {
    recommendationId?: number;
    taskId: string;
    actionType: AdActionType;
    entityType: string;
    entityId: string;
    entityName: string;
    beforeValue: string;
    afterValue: string;
    executionStatus: ExecutionStatus;
    failureReason?: string;
    screenshotBefore?: string;
    screenshotAfter?: string;
    tracePath?: string;
    pageUrl?: string;
  }): number {
    return this.repo.insert({
      recommendationId: params.recommendationId,
      taskId: params.taskId,
      actionType: params.actionType,
      entityType: params.entityType,
      entityId: params.entityId,
      entityName: params.entityName,
      beforeValue: params.beforeValue,
      afterValue: params.afterValue,
      executionStatus: params.executionStatus,
      failureReason: params.failureReason,
      screenshotBefore: params.screenshotBefore,
      screenshotAfter: params.screenshotAfter,
      tracePath: params.tracePath,
      pageUrl: params.pageUrl,
    });
  }

  /**
   * 查询操作日志
   */
  queryLogs(dateFrom: string, dateTo: string, limit = 100): ActionLog[] {
    return this.repo.findByDateRange(dateFrom, dateTo, limit);
  }

  /**
   * 记录截图路径
   */
  getScreenshotPath(label: 'before' | 'after' | 'error'): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `storage/screenshots/${label}_${timestamp}.png`;
  }
}

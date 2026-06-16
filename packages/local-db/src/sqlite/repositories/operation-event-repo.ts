import type { Database } from 'better-sqlite3';
import type {
  CreateOperationEventInput,
  OperationEvent,
  OperationEventFilter,
  UpdateOperationEventInput,
} from '@amazon-ai-ops/shared-types';

export class OperationEventRepository {
  constructor(private db: Database) {}

  create(input: CreateOperationEventInput): number {
    const result = this.db.prepare(`
      INSERT INTO operation_events (
        event_date, store_name, marketplace_code, asin, campaign_name, ad_group_name, event_type,
        title, impact_expectation, notes, evidence_path, created_at, updated_at
      )
      VALUES (
        @eventDate, @storeName, @marketplaceCode, @asin, @campaignName, @adGroupName, @eventType,
        @title, @impactExpectation, @notes, @evidencePath, datetime('now'), datetime('now')
      )
    `).run({
      eventDate: input.eventDate,
      storeName: input.storeName,
      marketplaceCode: input.marketplaceCode,
      asin: input.asin ?? null,
      campaignName: input.campaignName ?? null,
      adGroupName: input.adGroupName ?? null,
      eventType: input.eventType,
      title: input.title,
      impactExpectation: input.impactExpectation ?? null,
      notes: input.notes ?? null,
      evidencePath: input.evidencePath ?? null,
    });

    return Number(result.lastInsertRowid);
  }

  getById(id: number): OperationEvent | null {
    const row = this.db.prepare('SELECT * FROM operation_events WHERE id = ?').get(id);
    return row ? this.mapRow(row) : null;
  }

  findByScope(filter: OperationEventFilter = {}): OperationEvent[] {
    const where: string[] = [];
    const params: unknown[] = [];

    if (filter.dateFrom) {
      where.push('event_date >= ?');
      params.push(filter.dateFrom);
    }
    if (filter.dateTo) {
      where.push('event_date <= ?');
      params.push(filter.dateTo);
    }
    if (filter.storeName) {
      where.push('store_name = ?');
      params.push(filter.storeName);
    }
    if (filter.marketplaceCode) {
      where.push('marketplace_code = ?');
      params.push(filter.marketplaceCode);
    }
    if (filter.asin) {
      where.push("lower(COALESCE(asin, '')) = lower(?)");
      params.push(filter.asin);
    }
    if (filter.campaignName) {
      where.push("lower(COALESCE(campaign_name, '')) = lower(?)");
      params.push(filter.campaignName);
    }
    if (filter.adGroupName) {
      where.push("lower(COALESCE(ad_group_name, '')) = lower(?)");
      params.push(filter.adGroupName);
    }
    if (filter.eventType) {
      where.push('event_type = ?');
      params.push(filter.eventType);
    }

    const limit = Math.max(1, Math.min(Number(filter.limit ?? 200), 1000));
    const sql = `
      SELECT *
      FROM operation_events
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY event_date DESC, id DESC
      LIMIT ?
    `;

    return (this.db.prepare(sql).all(...params, limit) as unknown[]).map((row) => this.mapRow(row));
  }

  update(id: number, patch: UpdateOperationEventInput): boolean {
    const fields: string[] = [];
    const params: Record<string, unknown> = { id };
    const set = (column: string, key: keyof UpdateOperationEventInput) => {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        fields.push(`${column} = @${key}`);
        params[key] = patch[key] ?? null;
      }
    };

    set('event_date', 'eventDate');
    set('store_name', 'storeName');
    set('marketplace_code', 'marketplaceCode');
    set('asin', 'asin');
    set('campaign_name', 'campaignName');
    set('ad_group_name', 'adGroupName');
    set('event_type', 'eventType');
    set('title', 'title');
    set('impact_expectation', 'impactExpectation');
    set('notes', 'notes');
    set('evidence_path', 'evidencePath');

    if (fields.length === 0) return false;
    fields.push("updated_at = datetime('now')");

    const result = this.db.prepare(`
      UPDATE operation_events
      SET ${fields.join(', ')}
      WHERE id = @id
    `).run(params);
    return result.changes > 0;
  }

  delete(id: number): boolean {
    const result = this.db.prepare('DELETE FROM operation_events WHERE id = ?').run(id);
    return result.changes > 0;
  }

  private mapRow(row: any): OperationEvent {
    return {
      id: row.id,
      eventDate: row.event_date,
      storeName: row.store_name,
      marketplaceCode: row.marketplace_code,
      asin: row.asin ?? undefined,
      campaignName: row.campaign_name ?? undefined,
      adGroupName: row.ad_group_name ?? undefined,
      eventType: row.event_type,
      title: row.title,
      impactExpectation: row.impact_expectation ?? undefined,
      notes: row.notes ?? undefined,
      evidencePath: row.evidence_path ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import type { MissionDomainRepositoryContext } from './context';
export function expireMissionGrants(this: MissionDomainRepositoryContext, contextInput: StoreContextEnvelope): number {
  const context = this.assertContext(contextInput);
  const expire = this.db.transaction(() => {
    this.assertContext(context);
    const now = this.timestamp();
    const grants = this.db.prepare(`SELECT grant_record.id FROM mission_grants grant_record
      WHERE grant_record.store_id=? AND julianday(grant_record.expires_at)<=julianday(?)
        AND NOT EXISTS (SELECT 1 FROM mission_grant_events event
          WHERE event.store_id=grant_record.store_id AND event.grant_id=grant_record.id
            AND event.event_type IN ('revoked','consumed','expired','invalidated'))
      ORDER BY grant_record.expires_at,grant_record.id`).all(context.storeId, now) as Array<{ id: string }>;
    for (const grant of grants) {
      this.appendMissionGrantEvent(context, {
        id: `grant-expired:${grant.id}`,
        grantId: grant.id,
        eventType: 'expired',
        actorId: 'authority-maintenance',
        reason: '执行授权已达到有效期；仅关闭剩余写入权限，不改变既有执行事实。',
      });
    }
    return grants.length;
  });
  return expire.immediate();
}

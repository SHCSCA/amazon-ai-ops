export interface ConnectionOperationAuthority {
  authorityKey: string | null;
  contextEpoch: number;
  phase: string;
}

export interface ConnectionOperationTicket {
  isCurrent(): boolean;
  finish(): void;
}

export type ConnectionOperationKind = 'initial' | 'retry-ads' | 'reconnect-all' | 'reset'
  | 'bind-lingxing' | 'confirm-ads' | 'unbind-lingxing' | 'unbind-amazon_ads';

export function createConnectionOperationGuard() {
  let authority: ConnectionOperationAuthority | null = null;
  let generation = 0;
  let active: object | null = null;
  return {
    update(next: ConnectionOperationAuthority) {
      if (authority?.authorityKey !== next.authorityKey
        || authority.contextEpoch !== next.contextEpoch || authority.phase !== next.phase) {
        generation += 1;
        active = null;
      }
      authority = { ...next };
    },
    invalidate() { generation += 1; active = null; },
    isBusy() { return active !== null; },
    begin(): ConnectionOperationTicket | null {
      if (active || authority?.phase !== 'ready' || !authority.authorityKey) return null;
      const token = {};
      const requested = generation;
      active = token;
      return {
        isCurrent: () => requested === generation && active === token,
        finish() {
          // 旧操作不能释放新范围中已取得的准入令牌。
          if (active === token) active = null;
        },
      };
    },
    capture() {
      const requested = generation;
      // 世代使 A→B→A 和组件卸载后返回的旧登录结果失效。
      return () => requested === generation;
    },
  };
}
